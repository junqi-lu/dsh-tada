// dsh-tada — native system notification owned by DeepSeek Harness.

import { focusWindow, notificationApi, openSession } from './host.js'

/**
 * Turn one Host frame into a native Notification. The page is the source of
 * truth for the app's identity: a notification created here is owned by the
 * Electron renderer, so the OS credits DeepSeek Harness and the click handler
 * can reveal the exact Session.
 *
 * @returns whether the OS accepted a banner request
 */
export function showSystemNotification(ctx, payload) {
  const api = notificationApi()
  if (!api || api.permission !== 'granted') return false
  if (!payload || typeof payload.title !== 'string') return false
  const sessionId = typeof payload.sessionId === 'string' ? payload.sessionId : undefined
  let notification
  try {
    notification = new api(payload.title, {
      body: typeof payload.body === 'string' ? payload.body : '',
      tag: `dsh-tada:${sessionId || 'global'}:${payload.kind || 'notification'}`,
    })
  } catch {
    return false
  }
  notification.onclick = () => {
    focusWindow()
    openSession(ctx, sessionId)
    try {
      notification.close()
    } catch {
      /* already closed */
    }
  }
  return true
}
