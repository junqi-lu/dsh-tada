import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { fakeResponse, pluginHarness, ssePayloads } from './helpers.mjs'

/* ------------------------------------------------------------------ */
/* Plugin wiring                                                       */
/* ------------------------------------------------------------------ */

test('plugin wiring turns turn-end events into the right page frame', async () => {
  // Explicit language so the close-label assertion below is locale-independent.
  const harness = pluginHarness({ minIntervalMs: 0, language: 'en' })
  const events = harness.handlers.get('session/event')
  assert.equal(events.length, 1)
  assert.ok(harness.routes.has('/dsh-tada/events'))
  assert.ok(harness.routes.has('/dsh-tada/state'))
  assert.ok(harness.routes.has('/dsh-tada/status'))

  const sse = fakeResponse()
  harness.routes.get('/dsh-tada/events')({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    url: '/dsh-tada/events?permission=granted&page=dsh-app%3A%2F%2Fapp&clientId=page-a&focused=1&sessionId=s1',
    on() {},
  }, sse)

  const session = { id: 's1', header: { cwd: '/tmp/work' } }
  const completed = { type: 'turn/end', data: { reason: { kind: 'completed' } } }
  const tick = () => new Promise((resolve) => setImmediate(resolve))

  // Focused on the conversation that finished → no frame at all.
  events[0](session, completed)
  await tick()
  await tick()
  assert.equal(ssePayloads(sse).length, 0)

  // Focused elsewhere → in-app frame.
  harness.routes.get('/dsh-tada/state')({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ clientId: 'page-a', focused: true, activeSessionId: 's2' }),
  }, fakeResponse())
  await tick()
  events[0](session, completed)
  await tick()
  await tick()
  let frames = ssePayloads(sse)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].channel, 'in-app')
  assert.equal(frames[0].sessionId, 's1')
  assert.equal(frames[0].dismiss, 'auto')
  assert.equal(frames[0].holdMs, 5000)
  assert.equal(frames[0].dismissLabel, 'Dismiss')

  // Unfocused → native system frame.
  harness.routes.get('/dsh-tada/state')({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ clientId: 'page-a', focused: false, activeSessionId: 's1' }),
  }, fakeResponse())
  await tick()
  events[0](session, completed)
  await tick()
  await tick()
  frames = ssePayloads(sse)
  assert.equal(frames.length, 2)
  assert.equal(frames[1].channel, 'system')

  // The status route reports the live page state the decisions were based on.
  const status = fakeResponse()
  harness.routes.get('/dsh-tada/status')({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, status)
  const body = JSON.parse(status.chunks[0])
  assert.equal(body.clients[0].id, 'page-a')
  assert.equal(body.clients[0].focused, false)
  assert.equal(body.inAppToastDismiss, 'auto')
  assert.equal(body.inAppHoldMs, 5000)
  assert.equal(body.clients[0].activeSessionId, 's1')

  // The settings page reads the same effective toast behavior it can edit.
  const settings = fakeResponse()
  harness.routes.get('/dsh-tada/settings')({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, settings)
  const settingsBody = JSON.parse(settings.chunks[0])
  assert.deepEqual(settingsBody.toast, { dismiss: 'auto', holdMs: 5000 })
  assert.deepEqual(settingsBody.toastDefaults, { dismiss: 'auto', holdMs: 5000 })

  harness.dispose()
})

test('manual in-app dismissal travels in the frame with its localized close label', async () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const harness = pluginHarness({ minIntervalMs: 0, language: 'zh', inAppToastDismiss: 'manual' })
  const events = harness.handlers.get('session/event')
  const sse = fakeResponse()
  harness.routes.get('/dsh-tada/events')({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    url: '/dsh-tada/events?permission=granted&page=dsh-app%3A%2F%2Fapp&clientId=page-a&focused=1&sessionId=s2',
    on() {},
  }, sse)
  harness.routes.get('/dsh-tada/state')({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ clientId: 'page-a', focused: true, activeSessionId: 's2' }),
  }, fakeResponse())
  await tick()

  events[0]({ id: 's1', header: { cwd: '/tmp/work' } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await tick()
  await tick()
  const frames = ssePayloads(sse)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].channel, 'in-app')
  assert.equal(frames[0].dismiss, 'manual')
  assert.equal(frames[0].dismissLabel, '关闭')
  assert.equal(frames[0].actionLabel, '查看')
  // The fade duration is still reported, but a manual toast ignores it.
  assert.equal(frames[0].holdMs, 5000)
  harness.dispose()
})

test('the settings route saves toast behavior and the next in-app frame uses it', async () => {
  const tick = () => new Promise((resolve) => setImmediate(resolve))
  const waitFor = async (predicate) => {
    for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const harness = pluginHarness({ minIntervalMs: 0, language: 'zh' })

  // A focused page looking at another conversation receives in-app frames.
  const sse = fakeResponse()
  harness.routes.get('/dsh-tada/events')({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    url: '/dsh-tada/events?permission=granted&page=dsh-app%3A%2F%2Fapp&clientId=page-a&focused=1&sessionId=s2',
    on() {},
  }, sse)
  harness.routes.get('/dsh-tada/state')({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ clientId: 'page-a', focused: true, activeSessionId: 's2' }),
  }, fakeResponse())
  await tick()

  const settings = (method, body) => {
    const response = fakeResponse()
    harness.routes.get('/dsh-tada/settings')({
      method,
      socket: { remoteAddress: '127.0.0.1' },
      headers: method === 'POST' ? { origin: 'http://127.0.0.1:53803' } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, response)
    return response
  }

  // The page's initial state is the Config default (auto, 5 s).
  const initial = settings('GET')
  const initialBody = JSON.parse(initial.chunks[0])
  assert.deepEqual(initialBody.toast, { dismiss: 'auto', holdMs: 5000 })
  assert.deepEqual(initialBody.toastDefaults, { dismiss: 'auto', holdMs: 5000 })

  // Saving from the page persists the override and applies it immediately.
  const post = settings('POST', { toast: { dismiss: 'manual', holdMs: 8000 } })
  await waitFor(() => post.chunks.length > 0)
  assert.equal(post.statusCode, 200)
  assert.deepEqual(JSON.parse(post.chunks[0]).toast, { dismiss: 'manual', holdMs: 8000 })
  const document = JSON.parse(await readFile(join(harness.settingsHome, 'dsh-tada', 'display.json'), 'utf8'))
  assert.deepEqual(document.toast, { dismiss: 'manual', holdMs: 8000 })

  const event = [{ id: 's1', header: { cwd: '/tmp/work' } }, { type: 'turn/end', data: { reason: { kind: 'completed' } } }]
  harness.handlers.get('session/event')[0](...event)
  await tick()
  await tick()
  let frames = ssePayloads(sse)
  assert.equal(frames.length, 1)
  assert.equal(frames[0].dismiss, 'manual')
  assert.equal(frames[0].holdMs, 8000)
  assert.equal(frames[0].dismissLabel, '关闭')

  // Diagnostics report the saved value, not just the Config default.
  const status = fakeResponse()
  harness.routes.get('/dsh-tada/status')({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, status)
  const statusBody = JSON.parse(status.chunks[0])
  assert.equal(statusBody.inAppToastDismiss, 'manual')
  assert.equal(statusBody.inAppHoldMs, 8000)

  // Changing the behavior again needs no reload either.
  const second = settings('POST', { toast: { dismiss: 'auto', holdMs: 2000 } })
  await waitFor(() => second.chunks.length > 0)
  harness.handlers.get('session/event')[0](...event)
  await tick()
  await tick()
  frames = ssePayloads(sse)
  assert.equal(frames.length, 2)
  assert.equal(frames[1].dismiss, 'auto')
  assert.equal(frames[1].holdMs, 2000)

  // GET now reports the saved value alongside the untouched Config default.
  const after = JSON.parse(settings('GET').chunks[0])
  assert.deepEqual(after.toast, { dismiss: 'auto', holdMs: 2000 })
  assert.deepEqual(after.toastDefaults, { dismiss: 'auto', holdMs: 5000 })
  harness.dispose()
})

/* ------------------------------------------------------------------ */
/* Display composition through the settings route                      */
/* ------------------------------------------------------------------ */

const tick = () => new Promise((resolve) => setImmediate(resolve))
const waitFor = async (predicate) => {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('display settings compose notifications and persist through the settings route', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-tada-plugin-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const settingsFile = join(home, 'dsh-tada', 'display.json')
    await mkdir(dirname(settingsFile), { recursive: true })
    await writeFile(settingsFile, JSON.stringify({ title: '{{session}}', body: '{{workspace}} | {{detail}}' }))

    const harness = pluginHarness({ minIntervalMs: 0, language: 'zh' }, {
      settingsHome: home,
      sessionTitle: { get: () => ({ title: '修复登录问题' }) },
      workspaceRegistry: { list: () => [{ title: 'dsh-tada', sessionIds: ['s1'] }] },
    })
    const events = harness.handlers.get('session/event')
    const session = { id: 's1', header: { cwd: '/tmp/work' } }
    const completed = { type: 'turn/end', data: { reason: { kind: 'completed' } } }

    // A focused page looking at another conversation receives an in-app frame.
    const sse = fakeResponse()
    harness.routes.get('/dsh-tada/events')({
      method: 'GET',
      socket: { remoteAddress: '127.0.0.1' },
      url: '/dsh-tada/events?permission=granted&page=dsh-app%3A%2F%2Fapp&clientId=page-a&focused=1&sessionId=s2',
      on() {},
    }, sse)
    harness.routes.get('/dsh-tada/state')({
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { origin: 'http://127.0.0.1:53803' },
      body: JSON.stringify({ clientId: 'page-a', focused: true, activeSessionId: 's2' }),
    }, fakeResponse())
    await tick()

    events[0](session, completed)
    await tick()
    await tick()
    let frames = ssePayloads(sse)
    assert.equal(frames.length, 1)
    assert.equal(frames[0].title, '修复登录问题')
    assert.equal(frames[0].body, 'dsh-tada | 本轮对话已处理完毕')

    // GET reports the saved templates, the defaults, and the preset catalog.
    const get = fakeResponse()
    harness.routes.get('/dsh-tada/settings')({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, get)
    const described = JSON.parse(get.chunks[0])
    assert.deepEqual(described.display, { title: '{{session}}', body: '{{workspace}} | {{detail}}' })
    assert.deepEqual(described.defaults, { title: '{{event}}', body: '{{session}}' })
    assert.deepEqual(described.presets, ['app', 'event', 'session', 'workspace', 'detail'])

    // POST new templates: they are persisted and the next alert uses them.
    const post = fakeResponse()
    harness.routes.get('/dsh-tada/settings')({
      method: 'POST',
      socket: { remoteAddress: '127.0.0.1' },
      headers: { origin: 'http://127.0.0.1:53803' },
      body: JSON.stringify({ display: { title: '{{app}} — {{event}}', body: '{{detail}}' } }),
    }, post)
    await waitFor(() => post.chunks.length > 0)
    assert.equal(post.statusCode, 200)
    assert.deepEqual(JSON.parse(post.chunks[0]).display, { title: '{{app}} — {{event}}', body: '{{detail}}' })
    assert.deepEqual(JSON.parse(await readFile(settingsFile, 'utf8')), {
      title: '{{app}} — {{event}}',
      body: '{{detail}}',
    })

    events[0](session, completed)
    await tick()
    await tick()
    frames = ssePayloads(sse)
    assert.equal(frames.length, 2)
    assert.equal(frames[1].title, 'DSH — 任务完成')
    assert.equal(frames[1].body, '本轮对话已处理完毕')

    harness.dispose()
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
    await rm(home, { recursive: true, force: true })
  }
})

/* ------------------------------------------------------------------ */
/* GUI-managed behavior config                                         */
/* ------------------------------------------------------------------ */

function settingsRequest(harness) {
  return (method, body) => {
    const response = fakeResponse()
    harness.routes.get('/dsh-tada/settings')({
      method,
      socket: { remoteAddress: '127.0.0.1' },
      headers: method === 'POST' ? { origin: 'http://127.0.0.1:53803' } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, response)
    return response
  }
}

function connectPage(harness, { clientId = 'page-a', activeSessionId = 's2', focused = true } = {}) {
  const sse = fakeResponse()
  harness.routes.get('/dsh-tada/events')({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    url: `/dsh-tada/events?permission=granted&page=dsh-app%3A%2F%2Fapp&clientId=${clientId}&focused=${focused ? 1 : 0}&sessionId=${activeSessionId}`,
    on() {},
  }, sse)
  harness.routes.get('/dsh-tada/state')({
    method: 'POST',
    socket: { remoteAddress: '127.0.0.1' },
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ clientId, focused, activeSessionId }),
  }, fakeResponse())
  return sse
}

test('GUI behavior config applies immediately to events, copy, and delivery', async () => {
  const harness = pluginHarness({ minIntervalMs: 0, language: 'zh' })
  const settings = settingsRequest(harness)
  const events = harness.handlers.get('session/event')
  const sse = connectPage(harness)
  await tick()

  const session = { id: 's1', header: { cwd: '/tmp/work' } }
  const completed = { type: 'turn/end', data: { reason: { kind: 'completed' } } }

  // Baseline: the default behavior sends an in-app frame.
  events[0](session, completed)
  await tick()
  await tick()
  assert.equal(ssePayloads(sse).length, 1)

  // Turn-end alerts off through the GUI: the next turn is silent.
  let post = settings('POST', { config: { notifyOnTurnEnd: false } })
  await waitFor(() => post.chunks.length > 0)
  assert.equal(post.statusCode, 200)
  events[0](session, completed)
  await tick()
  await tick()
  assert.equal(ssePayloads(sse).length, 1)

  // Copy settings (language/app name) take effect on the next frame. The app
  // name reaches the title through the display template, like any alert field.
  post = settings('POST', {
    display: { title: '{{app}} · {{event}}', body: '{{session}}' },
    config: { notifyOnTurnEnd: true, language: 'en', appName: 'Tada' },
  })
  await waitFor(() => post.chunks.length > 0)
  events[0](session, completed)
  await tick()
  await tick()
  let frames = ssePayloads(sse)
  assert.equal(frames.length, 2)
  assert.equal(frames[1].title, 'Tada · Turn complete')
  assert.equal(frames[1].actionLabel, 'Open')
  assert.equal(frames[1].dismissLabel, 'Dismiss')

  // An off-by-default event switch can be turned on from the GUI.
  post = settings('POST', { config: { notifyOnSubagentEnd: true } })
  await waitFor(() => post.chunks.length > 0)
  harness.handlers.get('subagent/end')[0]({
    id: 's3',
    provider: 'spawn',
    stopReason: 'completed',
    lastAssistantMessage: [{ type: 'text', text: 'subagent done' }],
  })
  await tick()
  await tick()
  frames = ssePayloads(sse)
  assert.equal(frames.length, 3)
  assert.equal(frames[2].kind, 'subagent-end')

  // webNotifications off: routes stay mounted and settings stay editable, but
  // the next alert is not delivered.
  post = settings('POST', { config: { webNotifications: false } })
  await waitFor(() => post.chunks.length > 0)
  assert.equal(post.statusCode, 200)
  assert.equal(harness.routes.has('/dsh-tada/events'), true)
  events[0](session, completed)
  await tick()
  await tick()
  assert.equal(ssePayloads(sse).length, 3)
  const offStatus = fakeResponse()
  harness.routes.get('/dsh-tada/status')({ method: 'GET', socket: { remoteAddress: '127.0.0.1' } }, offStatus)
  assert.equal(JSON.parse(offStatus.chunks[0]).webNotifications, false)

  // And delivery comes back on without a restart.
  post = settings('POST', { config: { webNotifications: true } })
  await waitFor(() => post.chunks.length > 0)
  events[0](session, completed)
  await tick()
  await tick()
  assert.equal(ssePayloads(sse).length, 4)

  // The saved document carries the full normalized config, not just one field.
  const document = JSON.parse(await readFile(join(harness.settingsHome, 'dsh-tada', 'display.json'), 'utf8'))
  assert.equal(typeof document.config, 'object')
  assert.equal(document.config.notifyOnTurnEnd, true)
  assert.equal(document.config.notifyOnSubagentEnd, true)
  assert.equal(document.config.language, 'en')
  assert.equal(document.config.appName, 'Tada')
  assert.equal(document.config.webNotifications, true)
  assert.equal(document.config.enabled, true)
  harness.dispose()
})

test('plugin starts with webNotifications off but keeps settings and diagnostics reachable', async () => {
  const harness = pluginHarness({ minIntervalMs: 0, language: 'zh', webNotifications: false })
  assert.ok(harness.routes.has('/dsh-tada/events'))
  assert.ok(harness.routes.has('/dsh-tada/state'))
  assert.ok(harness.routes.has('/dsh-tada/status'))
  assert.ok(harness.routes.has('/dsh-tada/settings'))

  const sse = connectPage(harness)
  await tick()
  const session = { id: 's1', header: { cwd: '/tmp/work' } }
  harness.handlers.get('session/event')[0](session, { type: 'turn/end', data: { reason: { kind: 'completed' } } })
  await tick()
  await tick()
  assert.equal(ssePayloads(sse).length, 0)

  const settings = settingsRequest(harness)
  const described = JSON.parse(settings('GET').chunks[0])
  assert.equal(described.config.webNotifications, false)
  // `configDefaults` are the plugin-Config values this install started with;
  // resetting the GUI form restores them.
  assert.equal(described.configDefaults.webNotifications, false)
  harness.dispose()
})
