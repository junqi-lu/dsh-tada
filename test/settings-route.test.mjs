import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_DISPLAY, DEFAULT_TOAST, createSettingsHandler, normalizeConfig } from '../index.js'
import { fakeResponse } from './helpers.mjs'

/* ------------------------------------------------------------------ */
/* Settings route                                                      */
/* ------------------------------------------------------------------ */

function request(handler, overrides = {}) {
  const response = fakeResponse()
  handler({
    method: 'GET',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {},
    url: '/dsh-tada/settings',
    ...overrides,
  }, response)
  return response
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

const EMPTY_TOAST = { dismiss: null, holdMs: null }
const emptyState = () => ({ display: DEFAULT_DISPLAY, toast: EMPTY_TOAST, config: null })

function settingsHandler({ state, writeSettings, getConfig, getConfigDefaults, ...overrides } = {}) {
  const writes = []
  const readState = () => state ?? emptyState()
  const handler = createSettingsHandler({
    readSettings: readState,
    writeSettings: writeSettings ?? (async (value) => {
      writes.push(value)
      return value
    }),
    // Mirrors how the plugin wires the route: the effective Config is the
    // plugin defaults with any saved Config applied, and the page also gets the
    // untrimmed plugin defaults to diff against.
    getConfig: getConfig ?? (() => normalizeConfig(readState().config ?? {})),
    getConfigDefaults: getConfigDefaults ?? (() => normalizeConfig()),
    toastDefaults: DEFAULT_TOAST,
    ...overrides,
  })
  return { handler, writes }
}

test('settings GET reports saved display/toast plus the effective Config and its defaults', () => {
  const display = { title: '{{session}}', body: '{{workspace}} | {{detail}}' }
  const savedConfig = normalizeConfig({ enabled: false, notifyOnError: false, language: 'zh', appName: 'Tada' })
  const pluginDefaults = normalizeConfig({ appName: 'Tada', inAppHoldMs: 6000 })
  const { handler } = settingsHandler({
    state: { display, toast: { dismiss: 'manual', holdMs: 8000 }, config: savedConfig },
    getConfig: () => normalizeConfig({ ...pluginDefaults, ...savedConfig }),
    getConfigDefaults: () => pluginDefaults,
  })
  const response = request(handler)
  assert.equal(response.statusCode, 200)
  const body = JSON.parse(response.chunks[0])
  assert.deepEqual(body.display, display)
  assert.deepEqual(body.defaults, DEFAULT_DISPLAY)
  assert.deepEqual(body.presets, ['app', 'event', 'session', 'workspace', 'detail'])
  assert.equal(body.appName, 'Tada')
  assert.deepEqual(body.toast, { dismiss: 'manual', holdMs: 8000 })
  assert.deepEqual(body.toastDefaults, DEFAULT_TOAST)
  assert.deepEqual(body.config, normalizeConfig({ ...pluginDefaults, ...savedConfig }))
  assert.deepEqual(body.configDefaults, pluginDefaults)
})

test('settings GET reports the plugin-Config defaults when nothing was saved', () => {
  const { handler } = settingsHandler({
    state: { display: DEFAULT_DISPLAY, toast: EMPTY_TOAST, config: null },
    toastDefaults: { dismiss: 'manual', holdMs: 8000 },
  })
  const body = JSON.parse(request(handler).chunks[0])
  assert.deepEqual(body.toast, { dismiss: 'manual', holdMs: 8000 })
  assert.deepEqual(body.toastDefaults, { dismiss: 'manual', holdMs: 8000 })
  assert.deepEqual(body.config, normalizeConfig())
  assert.deepEqual(body.configDefaults, normalizeConfig())
  assert.equal(body.appName, 'DSH')
})

test('settings POST saves display and toast together, preserving the omitted part and the absent Config', async () => {
  const display = { title: '{{session}}', body: '{{detail}}' }

  // Display-only save keeps the saved toast behavior and the absent Config.
  {
    const { handler, writes } = settingsHandler({ state: { display, toast: { dismiss: 'manual', holdMs: 8000 }, config: null } })
    const incoming = { title: '{{app}} — {{event}}', body: '{{detail}}' }
    const response = request(handler, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:53803' },
      body: JSON.stringify({ display: incoming }),
    })
    await tick()
    assert.equal(response.statusCode, 200)
    assert.deepEqual(writes[0], { display: incoming, toast: { dismiss: 'manual', holdMs: 8000 }, config: null })
    const body = JSON.parse(response.chunks[0])
    assert.deepEqual(body.display, incoming)
    assert.deepEqual(body.toast, { dismiss: 'manual', holdMs: 8000 })
    assert.deepEqual(body.config, normalizeConfig())
  }

  // Toast-only save keeps the content, fills the omitted toast part from the
  // current effective value, and leaves the Config absent.
  {
    const { handler, writes } = settingsHandler({ state: { display, toast: { dismiss: 'auto', holdMs: 6000 }, config: null } })
    const response = request(handler, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:53803' },
      body: JSON.stringify({ toast: { dismiss: 'manual' } }),
    })
    await tick()
    assert.equal(response.statusCode, 200)
    assert.deepEqual(writes[0], { display, toast: { dismiss: 'manual', holdMs: 6000 }, config: null })
    assert.deepEqual(JSON.parse(response.chunks[0]).toast, { dismiss: 'manual', holdMs: 6000 })
  }

  // Both parts, with the duration clamped by the Host.
  {
    const { handler, writes } = settingsHandler()
    request(handler, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:53803' },
      body: JSON.stringify({ display: { title: 'T', body: 'B' }, toast: { dismiss: 'manual', holdMs: 999999 } }),
    })
    await tick()
    assert.deepEqual(writes[0], {
      display: { title: 'T', body: 'B' },
      toast: { dismiss: 'manual', holdMs: 30000 },
      config: null,
    })
  }
})

test('settings POST config-only patches the effective Config and preserves display/toast', async () => {
  const display = { title: '{{session}}', body: '{{detail}}' }
  const toast = { dismiss: 'manual', holdMs: 8000 }
  const savedConfig = normalizeConfig({ enabled: false, notifyOnError: false, inAppHoldMs: 7000 })
  const pluginDefaults = normalizeConfig({ appName: 'Tada', inAppHoldMs: 6000 })
  const { handler, writes } = settingsHandler({
    state: { display, toast, config: savedConfig },
    getConfig: () => normalizeConfig({ ...pluginDefaults, ...savedConfig }),
    getConfigDefaults: () => pluginDefaults,
  })
  const response = request(handler, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ config: { inAppToastDismiss: 'manual', language: 'zh', bodyMaxLength: 9999 } }),
  })
  await tick()
  assert.equal(response.statusCode, 200)
  const nextConfig = normalizeConfig({
    ...normalizeConfig({ ...pluginDefaults, ...savedConfig }),
    inAppToastDismiss: 'manual',
    language: 'zh',
    bodyMaxLength: 9999,
  })
  assert.deepEqual(writes[0], { display, toast, config: nextConfig })
  // A full normalized Config is what gets persisted, not just the posted patch.
  assert.equal(Object.keys(writes[0].config).length, Object.keys(normalizeConfig()).length)
  const body = JSON.parse(response.chunks[0])
  assert.deepEqual(body.display, display)
  assert.deepEqual(body.toast, toast)
  assert.deepEqual(body.config, nextConfig)
})

test('settings POST refuses a malformed Config without writing', async () => {
  for (const config of ['manual', null, [], 42]) {
    const { handler, writes } = settingsHandler()
    const response = request(handler, {
      method: 'POST',
      headers: { origin: 'http://127.0.0.1:53803' },
      body: JSON.stringify({ config }),
    })
    await tick()
    assert.equal(response.statusCode, 400, `config ${JSON.stringify(config)} should be refused`)
    assert.equal(writes.length, 0)
  }
})

test('settings POST refuses a body without display, toast, or config', async () => {
  const { handler, writes } = settingsHandler()
  const response = request(handler, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ title: '{{app}}', body: '{{detail}}' }),
  })
  await tick()
  assert.equal(response.statusCode, 400)
  assert.equal(writes.length, 0)
})

test('settings POST refuses malformed bodies, malformed toast values, cross-origin callers, and write failures', async () => {
  const { handler } = settingsHandler()

  const malformed = request(handler, { method: 'POST', headers: { origin: 'http://127.0.0.1:53803' }, body: 'not json' })
  await tick()
  assert.equal(malformed.statusCode, 400)

  const badToast = request(handler, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ toast: 'manual' }),
  })
  await tick()
  assert.equal(badToast.statusCode, 400)

  const crossOrigin = request(handler, {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ display: DEFAULT_DISPLAY }),
  })
  assert.equal(crossOrigin.statusCode, 403)

  const failing = settingsHandler({
    writeSettings: async () => {
      throw new Error('disk full')
    },
  })
  const failedWrite = request(failing.handler, {
    method: 'POST',
    headers: { origin: 'http://127.0.0.1:53803' },
    body: JSON.stringify({ display: DEFAULT_DISPLAY }),
  })
  await tick()
  assert.equal(failedWrite.statusCode, 500)
  assert.match(failedWrite.chunks[0], /could not be saved/)
})

test('settings route is loopback-only and rejects unsupported methods', () => {
  const { handler } = settingsHandler()

  const remote = request(handler, { socket: { remoteAddress: '192.168.1.20' } })
  assert.equal(remote.statusCode, 403)

  const put = request(handler, { method: 'PUT' })
  assert.equal(put.statusCode, 405)
})
