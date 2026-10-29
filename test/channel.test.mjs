import test from 'node:test'
import assert from 'node:assert/strict'

import {
  STATE_ROUTE,
  createSseHandler,
  createStateHandler,
  createStatusHandler,
  createWebChannel,
  isLoopbackAddress,
  isLoopbackOrigin,
  normalizeClientState,
  normalizeConfig,
} from '../index.js'
import { fakeResponse } from './helpers.mjs'

/* ------------------------------------------------------------------ */
/* Web GUI channel                                                     */
/* ------------------------------------------------------------------ */

test('loopback guards accept only local addresses and origins', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true)
  assert.equal(isLoopbackAddress('127.0.0.42'), true)
  assert.equal(isLoopbackAddress('::1'), true)
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  assert.equal(isLoopbackAddress('10.0.0.2'), false)
  assert.equal(isLoopbackAddress(''), false)
  assert.equal(isLoopbackAddress(undefined), false)

  assert.equal(isLoopbackOrigin('http://127.0.0.1:53803'), true)
  assert.equal(isLoopbackOrigin('http://localhost:53803'), true)
  assert.equal(isLoopbackOrigin('https://harness.deepseek.com'), false)
  assert.equal(isLoopbackOrigin('null'), false)
  assert.equal(isLoopbackOrigin(''), false)
})

test('state reports normalize page focus and the open conversation', () => {
  assert.deepEqual(normalizeClientState({ clientId: 'c1', focused: true, activeSessionId: 's1', permission: 'granted' }), {
    clientId: 'c1',
    focused: true,
    permission: 'granted',
    activeSessionId: 's1',
  })
  assert.deepEqual(normalizeClientState({ clientId: 'c1', activeSessionId: null }), { clientId: 'c1', activeSessionId: null })
  assert.equal(normalizeClientState({ clientId: '  ' }), null)
  assert.equal(normalizeClientState({ focused: true }), null)
  assert.equal(normalizeClientState(null), null)
  assert.equal(normalizeClientState('nope'), null)
  assert.deepEqual(normalizeClientState({ clientId: 'c1', permission: 'weird', focused: 'yes' }), { clientId: 'c1', permission: 'default' })
})

test('web channel exposes page state and fan-out to explicit recipients', () => {
  const channel = createWebChannel()
  const first = fakeResponse()
  const second = fakeResponse()
  channel.addClient(first, 'granted', { clientId: 'page-a', page: 'http://127.0.0.1:1', focused: true, activeSessionId: 's1' })
  channel.addClient(second, 'denied', { clientId: 'page-b' })
  assert.equal(channel.size(), 2)

  const clients = channel.snapshotClients()
  assert.equal(clients.length, 2)
  assert.deepEqual(
    clients.map((client) => ({ id: client.id, permission: client.permission, focused: client.focused, activeSessionId: client.activeSessionId })),
    [
      { id: 'page-a', permission: 'granted', focused: true, activeSessionId: 's1' },
      { id: 'page-b', permission: 'denied', focused: false, activeSessionId: null },
    ],
  )

  // Explicit recipients are addressed regardless of permission (in-app toasts
  // need no OS permission).
  assert.equal(channel.broadcast({ title: 'first' }, ['page-a']), 1)
  assert.equal(first.chunks.length, 1)
  assert.equal(second.chunks.length, 0)
  assert.equal(channel.broadcast({ title: 'in-app' }, ['page-b']), 1)
  assert.equal(second.chunks.length, 1)
  assert.equal(first.chunks.length, 1)

  assert.equal(channel.updateClientState({ clientId: 'page-b', focused: true, activeSessionId: 's2' }), true)
  const updated = channel.snapshotClients().find((client) => client.id === 'page-b')
  assert.equal(updated.focused, true)
  assert.equal(updated.activeSessionId, 's2')

  // A report for a page that has not connected yet is buffered and applied.
  assert.equal(channel.updateClientState({ clientId: 'page-c', focused: false, activeSessionId: 's3' }), false)
  const third = fakeResponse()
  channel.addClient(third, 'granted', { clientId: 'page-c' })
  const buffered = channel.snapshotClients().find((client) => client.id === 'page-c')
  assert.equal(buffered.focused, false)
  assert.equal(buffered.activeSessionId, 's3')

  channel.heartbeat()
  assert.equal(first.chunks.length, 2)
  assert.equal(second.chunks.length, 2)
  assert.equal(third.chunks.length, 1)

  channel.closeAll()
  assert.equal(channel.size(), 0)
  assert.equal(first.ended, true)
})

test('web channel evicts a page whose stream write throws', () => {
  const channel = createWebChannel()
  const broken = fakeResponse()
  broken.write = () => {
    throw new Error('stream closed')
  }
  channel.addClient(broken, 'granted', { clientId: 'dead' })
  assert.equal(channel.broadcast({ title: 'x' }, ['dead']), 0)
  assert.equal(channel.size(), 0)
})

test('SSE handler rejects non-GET and non-loopback callers, then registers page state', () => {
  const channel = createWebChannel()
  const handler = createSseHandler({ channel })

  const wrongMethod = fakeResponse()
  handler({ method: 'POST', socket: { remoteAddress: '127.0.0.1' }, url: '/dsh-tada/events' }, wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)

  const remote = fakeResponse()
  handler({ method: 'GET', socket: { remoteAddress: '10.0.0.2' }, url: '/dsh-tada/events' }, remote)
  assert.equal(remote.statusCode, 403)

  const ok = fakeResponse()
  handler({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    url: '/dsh-tada/events?permission=granted&page=http%3A%2F%2F127.0.0.1%3A1&clientId=page-a&focused=1&sessionId=s1',
    on() {},
  }, ok)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.headers['Content-Type'], 'text/event-stream; charset=utf-8')
  assert.equal(ok.chunks[0], ': connected\n\n')
  assert.deepEqual(
    channel.snapshotClients().map((client) => ({
      id: client.id,
      page: client.page,
      focused: client.focused,
      activeSessionId: client.activeSessionId,
    })),
    [{ id: 'page-a', page: 'http://127.0.0.1:1', focused: true, activeSessionId: 's1' }],
  )
  assert.equal(channel.broadcast({ title: 'x' }, ['page-a']), 1)
})

test('state handler accepts loopback same-origin POSTs and rejects the rest', async () => {
  const channel = createWebChannel()
  const handler = createStateHandler({ channel })
  const tick = () => new Promise((resolve) => setImmediate(resolve))

  const remote = fakeResponse()
  handler({ method: 'POST', socket: { remoteAddress: '10.0.0.2' }, headers: {}, body: '{}' }, remote)
  assert.equal(remote.statusCode, 403)

  const wrongMethod = fakeResponse()
  handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' }, headers: {} }, wrongMethod)
  assert.equal(wrongMethod.statusCode, 405)

  const foreignOrigin = fakeResponse()
  handler({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ clientId: 'c1', focused: true }),
  }, foreignOrigin)
  assert.equal(foreignOrigin.statusCode, 403)

  const badJson = fakeResponse()
  handler({ method: 'POST', socket: { remoteAddress: '127.0.0.1' }, headers: {}, body: '{' }, badJson)
  await tick()
  assert.equal(badJson.statusCode, 400)

  channel.addClient(fakeResponse(), 'granted', { clientId: 'c1' })
  const ok = fakeResponse()
  handler({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ clientId: 'c1', focused: true, activeSessionId: 's1', permission: 'denied' }),
  }, ok)
  await tick()
  assert.equal(ok.statusCode, 204)
  const client = channel.snapshotClients()[0]
  assert.equal(client.focused, true)
  assert.equal(client.activeSessionId, 's1')
  assert.equal(client.permission, 'denied')
  assert.equal(STATE_ROUTE, '/dsh-tada/state')
})

test('status handler reports channel state and routing settings to loopback callers only', () => {
  const channel = createWebChannel()
  channel.addClient(fakeResponse(), 'granted', { clientId: 'page-a', page: 'dsh-app:', focused: true, activeSessionId: 's1' })
  const handler = createStatusHandler({ channel, config: normalizeConfig() })

  const remote = fakeResponse()
  handler({ method: 'GET', socket: { remoteAddress: '10.0.0.2' } }, remote)
  assert.equal(remote.statusCode, 403)

  const ok = fakeResponse()
  handler({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, ok)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.headers['Content-Type'], 'application/json; charset=utf-8')
  const body = JSON.parse(ok.chunks[0])
  assert.equal(body.webNotifications, true)
  assert.equal(body.inAppNotifications, true)
  assert.equal(body.suppressActiveSession, true)
  assert.equal(body.inAppToastDismiss, 'auto')
  assert.equal(body.inAppHoldMs, 5000)
  assert.equal(body.routes.state, STATE_ROUTE)
  assert.deepEqual(body.clients, [
    {
      id: 'page-a',
      page: 'dsh-app:',
      permission: 'granted',
      focused: true,
      activeSessionId: 's1',
      seenAt: body.clients[0].seenAt,
    },
  ])
})
