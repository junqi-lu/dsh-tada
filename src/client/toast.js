// dsh-tada — in-app toast presentation.
//
// The Harness-styled toast uses the page's React and UI primitives when they
// are present; otherwise a plain-DOM toast themed with Harness design tokens is
// used, so the plugin still activates in a page without them.

import { DEFAULT_HOLD_MS } from './config.js'
import { focusWindow, openSession, service } from './host.js'
import { React, primitives } from './ui.js'

/**
 * Manual-dismiss toast hold time, in milliseconds.
 *
 * The Harness Toast primitive always schedules its own fade and unmount: the
 * CSS animation starts after `--dsh-toast-hold` and the JS timer fires at
 * `holdMs + 1000`. There is no "never" value, so manual mode uses a delay far
 * beyond any session (about 23 days) and the toast is removed by the user's
 * 查看/关闭 action long before that.
 */
const PERSISTENT_HOLD_MS = 2_000_000_000

/**
 * The Harness Toast primitive renders its copy as one text run, so the toast
 * passes the composed copy with the title and body separated by a newline.
 * Collapsing whitespace would silently join them again, hence this rule: it
 * keeps that newline, and it follows the primitive's public `role="alert"`
 * banner and its trailing copy span. Scoped to the primitive's root `div`; our
 * own fallback toast styles the line break inline.
 *
 * Exported because the Settings stylesheet owns the same `<style
 * data-plugin-css="dsh-tada">` tag: when it is (re)written, this rule has to
 * survive in it.
 */
export const TOAST_NEWLINE_CSS = 'div[role="alert"]>span:last-child{white-space:pre-line}'

/**
 * Make sure the newline rule is live before the first toast, even on a page
 * whose Settings section has not rendered (and so has not written the full
 * stylesheet). Reuses the Settings tag so a later rewrite it in place.
 */
function ensureToastStyle() {
  try {
    if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return
    const existing = typeof document.head.querySelector === 'function'
      ? document.head.querySelector('style[data-plugin-css="dsh-tada"]')
      : null
    if (existing) {
      if (typeof existing.textContent === 'string' && !existing.textContent.includes(TOAST_NEWLINE_CSS)) {
        existing.textContent += TOAST_NEWLINE_CSS
      }
      return
    }
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin-css', 'dsh-tada')
    tag.textContent = TOAST_NEWLINE_CSS
    document.head.appendChild(tag)
  } catch {
    /* styling is best effort */
  }
}

/** Localized label of the manual toast's dismiss action. */
function dismissLabelOf(notice) {
  return typeof notice.dismissLabel === 'string' && notice.dismissLabel !== '' ? notice.dismissLabel : 'Dismiss'
}

/* ------------------------------------------------------------------ */
/* In-app toast queue                                                   */
/* ------------------------------------------------------------------ */

function createToastStore() {
  const queued = []
  let current = null
  const listeners = new Set()
  const emit = () => {
    for (const listener of Array.from(listeners)) {
      try {
        listener()
      } catch {
        /* a broken consumer must not break notification delivery */
      }
    }
  }
  const advance = () => {
    if (current !== null || queued.length === 0) return
    current = queued.shift()
    emit()
  }
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot() {
      return current
    },
    push(notice) {
      if (!notice || typeof notice.text !== 'string' || notice.text === '') return
      queued.push(notice)
      while (queued.length > 6) queued.shift()
      advance()
    },
    dismiss(id) {
      if (current === null) return
      if (id !== undefined && current.id !== id) return
      current = null
      emit()
      advance()
    },
    clear() {
      queued.length = 0
      current = null
      emit()
    },
  }
}

function clampToastText(value, maxLength = 240) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

/** Longest toast copy, title line included. */
const TOAST_TEXT_MAX_LENGTH = 240

/** Longest title line; leaves the rest of the budget to the body. */
const TOAST_TITLE_MAX_LENGTH = 120

/**
 * Compose the toast copy with the title on its own line and the body below it,
 * mirroring the Settings → 通知 toast preview. The primitive keeps the break
 * (see {@link TOAST_NEWLINE_CSS}); the fallback toast sets `white-space`
 * inline.
 */
function toastText(payload) {
  const title = clampToastText(payload.title, TOAST_TITLE_MAX_LENGTH)
  const body = clampToastText(payload.body, Math.max(40, TOAST_TEXT_MAX_LENGTH - title.length))
  if (body === '') return title
  if (title === '') return body
  return `${title}\n${body}`
}

/** Harness-styled toast: the primitive inside `shell.overlay`. */
function createReactToastHost(ctx, store) {
  const Toast = primitives && primitives.Toast
  const slots = service(ctx, 'slots')
  if (!React || typeof React.createElement !== 'function' || !Toast) return undefined
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return undefined

  function NotificationToast() {
    const [notice, setNotice] = React.useState(store.getSnapshot())
    React.useEffect(() => {
      const dispose = store.subscribe(() => setNotice(store.getSnapshot()))
      return () => {
        try {
          dispose()
        } catch {
          /* already released */
        }
      }
    }, [])
    if (notice === null) return null
    const manual = notice.manual === true
    const actions = []
    if (typeof notice.sessionId === 'string' && notice.sessionId !== '') {
      actions.push({
        label: notice.actionLabel || 'Open',
        onClick: () => {
          focusWindow()
          openSession(ctx, notice.sessionId)
          store.dismiss(notice.id)
        },
      })
    }
    if (manual) {
      // A manual toast never fades on its own: the user closes it here, or
      // opens the Session above, which dismisses it as well.
      actions.push({
        prefix: actions.length > 0 ? ' · ' : '',
        label: dismissLabelOf(notice),
        onClick: () => store.dismiss(notice.id),
      })
    }
    return React.createElement(Toast, {
      key: notice.id,
      text: notice.text,
      holdMs: manual ? PERSISTENT_HOLD_MS : notice.holdMs,
      ...(actions.length > 0 ? { actions } : {}),
      onDone: () => store.dismiss(notice.id),
    })
  }

  try {
    const disposeInject = slots.inject('shell.overlay', () =>
      slots.register({ name: 'shell.overlay', id: 'dsh-tada-toast', order: 100 }, NotificationToast),
    )
    return () => {
      try {
        if (typeof disposeInject === 'function') disposeInject()
      } catch {
        /* already released */
      }
      store.clear()
    }
  } catch {
    return undefined
  }
}

/** Plain-DOM toast fallback, themed with Harness design tokens. */
function createDomToastHost(ctx, store) {
  try {
    if (typeof document === 'undefined' || !document.body) return undefined
  } catch {
    return undefined
  }
  let element = null
  let timer = null
  const render = () => {
    const notice = store.getSnapshot()
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (notice === null) {
      if (element !== null && element.parentNode) element.parentNode.removeChild(element)
      element = null
      return
    }
    if (element === null) {
      element = document.createElement('div')
      element.setAttribute('role', 'alert')
      element.setAttribute('data-dsh-tada-toast', '')
      Object.assign(element.style, {
        position: 'fixed',
        top: '40px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: '1100',
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        maxWidth: 'min(640px, calc(100vw - 48px))',
        padding: '12px 16px',
        borderRadius: 'var(--dsw-radius-lg, 12px)',
        background: 'var(--dsw-alias-toast-bg, #2c2c2e)',
        color: 'var(--dsw-alias-toast-label, #fff)',
        font: '400 14px/22px system-ui, -apple-system, sans-serif',
        boxShadow: '0 8px 24px #00000033',
        pointerEvents: 'none',
      })
      document.body.appendChild(element)
    }
    const manual = notice.manual === true
    element.setAttribute('data-dsh-tada-dismiss', manual ? 'manual' : 'auto')
    for (const child of Array.from(element.childNodes)) child.remove()
    const text = document.createElement('span')
    text.textContent = notice.text
    // The copy carries a newline between title and body; keep it in this
    // fallback surface too (the primitive is handled by TOAST_NEWLINE_CSS).
    text.style.whiteSpace = 'pre-line'
    element.appendChild(text)
    if (typeof notice.sessionId === 'string' && notice.sessionId !== '') {
      const action = document.createElement('button')
      action.type = 'button'
      action.textContent = notice.actionLabel || 'Open'
      action.setAttribute('data-dsh-tada-open', '')
      Object.assign(action.style, {
        display: 'inline',
        padding: '0',
        border: '0',
        background: 'none',
        color: 'var(--dsw-static-deepseek-400, #5686fe)',
        font: 'inherit',
        cursor: 'pointer',
        pointerEvents: 'auto',
      })
      action.addEventListener('click', () => {
        focusWindow()
        openSession(ctx, notice.sessionId)
        store.dismiss(notice.id)
      })
      element.appendChild(action)
    }
    if (manual) {
      // Manual mode: no timer, the user closes the toast (or opens the
      // Session, which dismisses it) through an explicit action.
      const close = document.createElement('button')
      close.type = 'button'
      close.textContent = dismissLabelOf(notice)
      close.setAttribute('data-dsh-tada-close', '')
      close.setAttribute('aria-label', dismissLabelOf(notice))
      Object.assign(close.style, {
        display: 'inline',
        padding: '0',
        border: '0',
        background: 'none',
        color: 'var(--dsw-alias-label-tertiary, #c4c7cc)',
        font: 'inherit',
        cursor: 'pointer',
        pointerEvents: 'auto',
      })
      close.addEventListener('click', () => store.dismiss(notice.id))
      element.appendChild(close)
    } else {
      const holdMs = Number.isFinite(notice.holdMs) && notice.holdMs > 0 ? notice.holdMs : DEFAULT_HOLD_MS
      timer = setTimeout(() => store.dismiss(notice.id), holdMs)
    }
  }
  const unsubscribe = store.subscribe(render)
  render()
  return () => {
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
    if (element !== null && element.parentNode) element.parentNode.removeChild(element)
  }
}

export function createToastPresenter(ctx) {
  ensureToastStyle()
  const store = createToastStore()
  let dispose = createReactToastHost(ctx, store)
  if (dispose === undefined) dispose = createDomToastHost(ctx, store)
  return {
    push(payload) {
      store.push({
        id: typeof payload.id === 'string' ? payload.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        text: toastText(payload),
        sessionId: typeof payload.sessionId === 'string' ? payload.sessionId : null,
        actionLabel: typeof payload.actionLabel === 'string' ? payload.actionLabel : '',
        dismissLabel: typeof payload.dismissLabel === 'string' ? payload.dismissLabel : '',
        manual: payload.dismiss === 'manual',
        holdMs: Number.isFinite(payload.holdMs) ? payload.holdMs : undefined,
      })
    },
    dispose() {
      if (typeof dispose === 'function') {
        try {
          dispose()
        } catch {
          /* already released */
        }
      }
      store.clear()
    },
  }
}
