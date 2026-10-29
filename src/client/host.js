// dsh-tada — browser host helpers shared by the client half.
//
// `require` here is the module-table require injected into the bundle factory
// by window.__ModuleLoader__; it is a free identifier inside the factory scope,
// which is why these helpers work without importing React or the Harness UI
// primitives. Both are optional: a page without them still activates the
// plugin and uses the plain-DOM toast fallback.

/** Resolve an optional platform module from the page's module table. */
export function optionalRequire(specifier) {
  try {
    return require(specifier)
  } catch {
    return undefined
  }
}

export function service(ctx, name) {
  try {
    return ctx && typeof ctx.get === 'function' ? ctx.get(name) : undefined
  } catch {
    return undefined
  }
}

export function notificationApi() {
  try {
    return typeof Notification === 'undefined' ? undefined : Notification
  } catch {
    return undefined
  }
}

export function permission() {
  const api = notificationApi()
  return api ? api.permission : 'unsupported'
}

export function requestPermission() {
  const api = notificationApi()
  if (!api) return Promise.resolve('unsupported')
  if (api.permission !== 'default') return Promise.resolve(api.permission)
  try {
    const result = api.requestPermission()
    if (result && typeof result.then === 'function') return result.catch(() => 'default')
    return Promise.resolve(result)
  } catch {
    return Promise.resolve('default')
  }
}

export function focusWindow() {
  try {
    window.focus()
  } catch {
    /* focus may be denied */
  }
}

/** Reveal the Session that produced the notification (best effort). */
export function openSession(ctx, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.length === 0) return
  try {
    const uiWorkspace = service(ctx, 'uiWorkspace')
    if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
      uiWorkspace.openSession(sessionId)
    }
  } catch {
    /* navigation is best effort */
  }
}

/** True when this page (the DSH window/tab) is the focused document. */
export function isPageFocused() {
  try {
    if (typeof document === 'undefined') return false
    if (typeof document.hasFocus === 'function') return document.hasFocus() === true
    return document.visibilityState === 'visible'
  } catch {
    return false
  }
}

export function pageLabel() {
  try {
    if (typeof location === 'undefined') return ''
    return `${location.protocol}//${location.host}`.slice(0, 120)
  } catch {
    return ''
  }
}

export function createClientId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    /* fall through */
  }
  return `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
