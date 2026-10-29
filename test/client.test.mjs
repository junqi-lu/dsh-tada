import test from 'node:test'
import assert from 'node:assert/strict'

import { createClientPageHarness, readClientBundle } from './helpers.mjs'

/* ------------------------------------------------------------------ */
/* Client half                                                         */
/* ------------------------------------------------------------------ */

test('client half routes frames from live focus and the open conversation', async () => {
  const code = await readClientBundle()
  const page = createClientPageHarness()
  let registration = null
  page.window.__ModuleLoader__ = {
    load(value) {
      registration = value
    },
  }

  Function(
    'window', 'document', 'location', 'EventSource', 'Notification', 'fetch', 'crypto',
    code,
  )(page.window, page.document, page.location, page.EventSource, page.Notification, page.fetch, undefined)

  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return { createElement() {}, useState() {}, useEffect() {} }
    throw new Error(`client half required unexpected module ${specifier}`)
  })
  assert.doesNotThrow(() => exports.apply(page.ctx))

  // Connected to the SSE route with the live state the Host routes from.
  assert.equal(page.state.sources.length, 1)
  const sseUrl = new URL(page.state.sources[0].url, 'http://127.0.0.1:53803')
  assert.equal(sseUrl.pathname, '/dsh-tada/events')
  assert.equal(sseUrl.searchParams.get('focused'), '1')
  assert.equal(sseUrl.searchParams.get('sessionId'), 'session-A')
  assert.ok(sseUrl.searchParams.get('clientId'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(page.state.stateReports.length > 0, true)
  assert.equal(page.state.stateReports[0].body.focused, true)
  assert.equal(page.state.stateReports[0].body.activeSessionId, 'session-A')

  const frame = (overrides = {}) => ({
    id: 'frame-1',
    kind: 'turn-end',
    channel: 'system',
    title: 'DSH · 任务完成',
    body: '本轮对话已处理完毕',
    sessionId: 'session-A',
    actionLabel: '查看',
    ...overrides,
  })

  // Focused on the conversation that finished → no OS alert and no toast.
  page.pushFrame(frame())
  assert.equal(page.state.notifications.length, 0)
  assert.equal(page.toastElement(), null)

  // Focused on another conversation → in-app toast, never a system notification.
  page.state.activeSessionId = 'session-B'
  page.pushFrame(frame())
  assert.equal(page.state.notifications.length, 0)
  let toast = page.toastElement()
  assert.ok(toast, 'expected an in-app toast element')
  // Title and body share one copy run, kept on separate lines by the newline.
  assert.equal(toast.childNodes[0].textContent, 'DSH · 任务完成\n本轮对话已处理完毕')
  assert.match(JSON.stringify(toast.childNodes.map((node) => node.textContent)), /本轮对话已处理完毕/)
  const action = toast.childNodes.find((node) => node.tagName === 'button')
  assert.ok(action, 'expected an open action on the toast')
  assert.equal(action.textContent, '查看')
  action.dispatch('click')
  assert.deepEqual(page.state.openedSessions, ['session-A'])
  assert.equal(page.toastElement(), null)

  // Unfocused app → native system notification, even with the same conversation open.
  page.setFocused(false)
  page.pushFrame(frame({ id: 'frame-2' }))
  assert.equal(page.state.notifications.length, 1)
  assert.equal(page.state.notifications[0].title, 'DSH · 任务完成')
  assert.equal(page.state.notifications[0].options.body, '本轮对话已处理完毕')

  // Stale Host routing (an in-app frame after focus was lost) still raises an OS banner.
  page.pushFrame(frame({ id: 'frame-3', channel: 'in-app' }))
  assert.equal(page.state.notifications.length, 2)

  // And a stale system frame while focused is converted into an in-app toast.
  page.setFocused(true)
  page.state.activeSessionId = 'session-C'
  page.pushFrame(frame({ id: 'frame-4', channel: 'system' }))
  assert.equal(page.state.notifications.length, 2)
  assert.ok(page.toastElement())

  page.dispose()
})

test('the line-break rule exists before the Settings page ever renders', async () => {
  const code = await readClientBundle()
  const page = createClientPageHarness()
  // A plain page: no Harness UI primitives, no Settings section stylesheet yet.
  page.document.head = {
    childNodes: [],
    querySelector() {
      return null
    },
    appendChild(child) {
      child.parentNode = this
      this.childNodes.push(child)
      return child
    },
  }
  let registration = null
  page.window.__ModuleLoader__ = {
    load(value) {
      registration = value
    },
  }
  Function(
    'window', 'document', 'location', 'EventSource', 'Notification', 'fetch', 'crypto',
    code,
  )(page.window, page.document, page.location, page.EventSource, page.Notification, page.fetch, undefined)

  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return { createElement() {}, useState() {}, useEffect() {} }
    throw new Error(`client half required unexpected module ${specifier}`)
  })
  try {
    assert.doesNotThrow(() => exports.apply(page.ctx))
    const style = page.document.head.childNodes.find(
      (node) => node.attributes?.['data-plugin-css'] === 'dsh-tada',
    )
    assert.ok(style, 'expected the client half to own a dsh-tada stylesheet')
    assert.match(style.textContent, /white-space:pre-line/)
  } finally {
    page.dispose()
  }
})

test('a manual in-app toast waits for 查看/关闭 instead of fading', async () => {
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const code = await readClientBundle()
  const page = createClientPageHarness()
  let registration = null
  page.window.__ModuleLoader__ = {
    load(value) {
      registration = value
    },
  }
  Function(
    'window', 'document', 'location', 'EventSource', 'Notification', 'fetch', 'crypto',
    code,
  )(page.window, page.document, page.location, page.EventSource, page.Notification, page.fetch, undefined)

  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return { createElement() {}, useState() {}, useEffect() {} }
    throw new Error(`client half required unexpected module ${specifier}`)
  })
  assert.doesNotThrow(() => exports.apply(page.ctx))
  page.state.activeSessionId = 'session-B'

  const frame = (overrides = {}) => ({
    id: 'manual-1',
    kind: 'turn-end',
    channel: 'in-app',
    title: 'DSH · 任务完成',
    body: '本轮对话已处理完毕',
    sessionId: 'session-A',
    actionLabel: '查看',
    dismiss: 'manual',
    dismissLabel: '关闭',
    // Deliberately tiny: a manual toast must ignore the auto-fade duration.
    holdMs: 10,
    ...overrides,
  })
  const button = (toast, marker) => toast.childNodes.find((node) => node.attributes?.[marker] !== undefined)

  page.pushFrame(frame())
  const toast = page.toastElement()
  assert.ok(toast, 'expected a manual in-app toast')
  assert.equal(toast.attributes['data-dsh-tada-dismiss'], 'manual')
  const open = button(toast, 'data-dsh-tada-open')
  const close = button(toast, 'data-dsh-tada-close')
  assert.ok(open, 'expected an open action')
  assert.ok(close, 'expected a close action in manual mode')
  assert.equal(open.textContent, '查看')
  assert.equal(close.textContent, '关闭')

  // Past the hold time the toast is still on screen.
  await delay(60)
  assert.ok(page.toastElement(), 'manual toast must not fade on its own')

  // The close action dismisses it without navigating.
  close.dispatch('click')
  assert.equal(page.toastElement(), null)
  assert.deepEqual(page.state.openedSessions, [])

  // The open action reveals the Session and dismisses the toast.
  page.pushFrame(frame({ id: 'manual-2' }))
  button(page.toastElement(), 'data-dsh-tada-open').dispatch('click')
  assert.deepEqual(page.state.openedSessions, ['session-A'])
  assert.equal(page.toastElement(), null)

  // A stale system frame converted to a toast keeps the same manual behavior.
  page.pushFrame(frame({ id: 'manual-3', channel: 'system' }))
  assert.equal(page.toastElement().attributes['data-dsh-tada-dismiss'], 'manual')
  button(page.toastElement(), 'data-dsh-tada-close').dispatch('click')
  assert.equal(page.toastElement(), null)

  // Auto mode still fades after its own hold time.
  page.pushFrame(frame({ id: 'auto-1', dismiss: 'auto', dismissLabel: '' }))
  assert.ok(page.toastElement())
  await delay(60)
  assert.equal(page.toastElement(), null)

  page.dispose()
})

/* ------------------------------------------------------------------ */
/* Client bundle contract                                             */
/* ------------------------------------------------------------------ */

test('client bundle registers the exact package id and exposes a slot plugin', async () => {
  const { readFile } = await import('node:fs/promises')
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const code = await readClientBundle()

  let registration = null
  const fakeWindow = {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
    addEventListener() {},
    removeEventListener() {},
  }
  // The bundle is a classic script that must run in the page's global scope.
  // Evaluating it here catches syntax errors and id drift before installation.
  Function('window', code)(fakeWindow)

  assert.ok(registration, 'client.js must call window.__ModuleLoader__.load')
  assert.equal(registration.id, pkg.name)

  // Runtime imports are limited to page module-table seeds, so the bundle
  // works without any compiled chunk or package-local module table.
  const required = []
  const fakeReact = {
    createElement() {
      return {}
    },
    useState(initial) {
      return [initial, () => {}]
    },
    useEffect() {},
  }
  const exports = registration.factory((specifier) => {
    required.push(specifier)
    if (specifier === 'react') return fakeReact
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return { Toast() {} }
    throw new Error(`client.js required an unexpected module: ${specifier}`)
  })
  assert.equal(typeof exports.apply, 'function')
  assert.deepEqual(exports.inject, ['slots'])
  assert.deepEqual(required.sort(), ['@deepseek-ai/dsh-client-ui-primitives', 'react'])
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.exports['./client'], './client/client.js')

  // Activation must be harmless even in a page with no Notification/EventSource
  // and no Harness services: a throwing client entry aborts the whole Web boot
  // audit.
  const cleanups = []
  const fakeCtx = {
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    get() {
      return undefined
    },
  }
  assert.doesNotThrow(() => exports.apply(fakeCtx))
  for (const cleanup of cleanups) assert.doesNotThrow(() => cleanup())
})

/* ------------------------------------------------------------------ */
/* Settings section registration                                       */
/* ------------------------------------------------------------------ */

test('client half registers the notification settings section', async () => {
  const code = await readClientBundle()
  const page = createClientPageHarness()
  // Pretend a previous client hot-reload left its stylesheet behind.
  const staleStyle = page.document.createElement('style')
  staleStyle.setAttribute('data-plugin-css', 'dsh-tada')
  staleStyle.textContent = '.tada-settings-template{display:flex}'
  page.document.head = {
    childNodes: [staleStyle],
    querySelector() {
      return staleStyle
    },
    appendChild(child) {
      this.childNodes.push(child)
      return child
    },
  }
  let registration = null
  page.window.__ModuleLoader__ = {
    load(value) {
      registration = value
    },
  }
  Function(
    'window', 'document', 'location', 'EventSource', 'Notification', 'fetch', 'crypto',
    code,
  )(page.window, page.document, page.location, page.EventSource, page.Notification, page.fetch, undefined)

  const cleanups = []
  const sections = []
  const ctx = {
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    },
    get(name) {
      if (name === 'slots') {
        return {
          inject(slot, callback) {
            callback()
            return () => {}
          },
          register(options, component) {
            sections.push({ name: options.name, options, component })
            return () => {}
          },
        }
      }
      return page.ctx.get(name)
    },
  }

  const exports = registration.factory((specifier) => {
    if (specifier === 'react') return { createElement() {}, useState() {}, useEffect() {} }
    if (specifier === '@deepseek-ai/dsh-client-ui-primitives') return {}
    throw new Error(`client half required unexpected module ${specifier}`)
  })
  try {
    assert.doesNotThrow(() => exports.apply(ctx))

    const section = sections.find((entry) => entry.name === 'settings.section')
    assert.ok(section, 'expected a settings.section registration')
    assert.equal(section.options.id, 'dsh-tada-content')
    assert.equal(section.options.icon, 'bell')
    assert.equal(typeof section.options.label, 'function')
    assert.match(section.options.label(), /通知|Notifications/)
    assert.equal(typeof section.component, 'function')

    // The stale stylesheet is rewritten in place instead of being skipped, so a
    // hot-reloaded client gets the new card/divider/preset and toast rules.
    const styleTag = page.document.head.childNodes[0]
    assert.equal(page.document.head.childNodes.length, 1)
    assert.match(styleTag.textContent, /\.tada-settings-card\{/)
    assert.match(styleTag.textContent, /\.tada-settings-divider\{/)
    assert.match(styleTag.textContent, /\.tada-settings-choice-btn\{/)
    assert.match(styleTag.textContent, /\.tada-settings-toast-preview\{/)
    // The in-app toast composes title and body on two lines, so the stylesheet
    // that renders it has to keep the newline instead of collapsing it.
    assert.match(styleTag.textContent, /white-space:pre-line/)
    assert.doesNotMatch(styleTag.textContent, /\.tada-settings-template\{/)
  } finally {
    // Release the client half's timers/listeners or node --test never exits.
    for (const cleanup of cleanups.splice(0)) assert.doesNotThrow(() => cleanup())
  }
})
