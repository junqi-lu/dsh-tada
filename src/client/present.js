// dsh-tada — choose the least intrusive presentation for one Host frame.

import { isPageFocused } from './host.js'
import { readActiveSession } from './session.js'
import { showSystemNotification } from './system.js'

/**
 * Turn one Host frame into the right presentation, re-checking focus and the
 * open conversation at display time (the Host's view may be a few hundred
 * milliseconds stale).
 */
export function present(ctx, toast, payload) {
  if (!payload || typeof payload !== 'object') return
  if (typeof payload.title !== 'string') return
  const focused = isPageFocused()
  const target = typeof payload.sessionId === 'string' && payload.sessionId !== '' ? payload.sessionId : null
  const active = target !== null ? readActiveSession(ctx) : null
  const viewingTarget = target !== null && active === target

  // The conversation is on screen right now: nothing to alert about.
  if (focused && viewingTarget) return

  if (focused) {
    // In the app, looking elsewhere: an in-app toast, never a system notification.
    toast.push(payload)
    return
  }

  // The app is in the background: prefer the OS banner, keep the toast as a
  // fallback for pages that cannot raise one (e.g. permission revoked).
  if (!showSystemNotification(ctx, payload)) toast.push(payload)
}
