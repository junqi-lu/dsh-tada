/** Delivery planning and the JSON frame a page turns into a notification. */

import { normalizeConfig } from './config.js'
import { clampText, isQuietTime } from './text.js'

/**
 * Choose the least intrusive channel for one alert.
 *
 * 1. DSH focused on the exact conversation → nothing (it is on screen already).
 * 2. DSH focused, another conversation → in-app toast in the focused page.
 * 3. DSH unfocused → one system notification (via the Electron page, so the OS
 *    notification center credits DeepSeek Harness).
 * 4. No page connected at all → `unavailable`; the Host has no second channel.
 *
 * The page re-checks focus at display time, so a slightly stale Host view only
 * changes which client-side presentation is used, never whether the user is
 * interrupted while reading the conversation itself.
 */
export function planNotificationDelivery(clients, sessionId, config) {
  const list = Array.isArray(clients) ? clients.filter((client) => client && typeof client === 'object') : []
  const focused = list.filter((client) => client.focused === true)
  if (focused.length > 0) {
    const viewingTarget =
      typeof sessionId === 'string' && sessionId !== '' && focused.some((client) => client.activeSessionId === sessionId)
    if (viewingTarget && config.suppressActiveSession) {
      return {
        mode: 'suppressed',
        recipients: [],
        reason: 'the conversation is open and focused in the app',
      }
    }
    if (config.inAppNotifications) {
      return {
        mode: 'in-app',
        recipients: focused.map((client) => client.id).filter((id) => typeof id === 'string' && id !== ''),
      }
    }
  }
  const granted = list.filter((client) => client.permission === 'granted' && typeof client.id === 'string')
  if (granted.length > 0) {
    const target = granted.slice().sort((left, right) => (right.seenAt ?? 0) - (left.seenAt ?? 0))[0]
    return { mode: 'system', recipients: [target.id] }
  }
  return {
    mode: 'unavailable',
    recipients: [],
    reason: 'no connected Web GUI page can show this notification',
  }
}

/**
 * Build the JSON frame a page turns into a native Notification (system mode) or
 * a DeepSeek Harness in-app toast (`in-app` mode).
 *
 * `dismiss` is carried on both channels: the page re-checks focus at display
 * time, so a frame routed as `system` for a stale Host view can still be shown
 * as an in-app toast, and it must keep the configured dismissal behavior.
 */
export function buildWebPayload(notification = {}, options = {}) {
  const channel = options.channel === 'in-app' ? 'in-app' : 'system'
  return {
    id: typeof options.id === 'string' ? options.id : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind: typeof notification.kind === 'string' ? notification.kind : 'notification',
    channel,
    title: clampText(notification.title || 'DSH', 80),
    body: clampText(notification.body || '', 500),
    sessionId: typeof options.sessionId === 'string' && options.sessionId.length > 0 ? options.sessionId : null,
    actionLabel: typeof options.actionLabel === 'string' ? clampText(options.actionLabel, 24) : '',
    dismiss: options.dismiss === 'manual' ? 'manual' : 'auto',
    dismissLabel: typeof options.dismissLabel === 'string' ? clampText(options.dismissLabel, 24) : '',
    ...(channel === 'in-app' && Number.isFinite(options.holdMs) ? { holdMs: options.holdMs } : {}),
  }
}

/**
 * Deliver one alert through the least intrusive channel.
 *
 * The page decides which presentation applies from its live focus and
 * open-Session state, so the Host never has to guess how many windows a browser
 * has: focused on the same conversation → drop; focused elsewhere → in-app
 * toast in the focused page; not focused → one system notification owned by
 * DeepSeek Harness. Without a connected page there is no delivery channel left,
 * so the outcome is an honest failure.
 *
 * @param {{ title?: string, body?: string, kind?: string }} notification
 * @param {{
 *   config?: ReturnType<typeof normalizeConfig>,
 *   channel?: any,
 *   sessionId?: string,
 *   actionLabel?: string,
 *   dismissLabel?: string,
 *   dismiss?: 'auto' | 'manual',
 *   holdMs?: number,
 *   id?: string,
 *   force?: boolean,
 *   now?: Date,
 * }} [options]
 * @returns {Promise<{ delivered: boolean, backend: string, reason?: string }>}
 */
export async function deliverNotification(notification = {}, options = {}) {
  const config = options.config ?? normalizeConfig()
  const now = options.now instanceof Date ? options.now : new Date()
  if (!config.enabled) {
    return { delivered: false, backend: 'disabled', reason: 'notifications are disabled' }
  }
  if (options.force !== true && isQuietTime(config.quietHours, now)) {
    return { delivered: false, backend: 'quiet-hours', reason: 'inside quiet hours' }
  }
  const title = clampText(notification.title || config.appName, 80) || config.appName
  const body = clampText(notification.body || '', config.bodyMaxLength)
  if (!body) {
    return { delivered: false, backend: 'web', reason: 'notification body is empty' }
  }
  if (!config.webNotifications) {
    return { delivered: false, backend: 'web', reason: 'web notifications are disabled' }
  }
  if (!options.channel) {
    return { delivered: false, backend: 'web', reason: 'no connected Web GUI page can show this notification' }
  }
  const channel = options.channel
  const clients = typeof channel.snapshotClients === 'function' ? channel.snapshotClients() : []
  const plan = planNotificationDelivery(clients, options.sessionId, config)
  if (plan.mode === 'suppressed') {
    return { delivered: false, backend: 'suppressed', reason: plan.reason ?? 'the conversation is focused' }
  }
  if (plan.mode !== 'in-app' && plan.mode !== 'system') {
    return {
      delivered: false,
      backend: 'web',
      reason: plan.reason ?? 'no connected Web GUI page can show this notification',
    }
  }
  const payload = buildWebPayload(
    { ...notification, title, body },
    {
      id: options.id,
      sessionId: options.sessionId,
      channel: plan.mode,
      actionLabel: options.actionLabel,
      dismissLabel: options.dismissLabel,
      dismiss: options.dismiss ?? config.inAppToastDismiss,
      holdMs: options.holdMs ?? config.inAppHoldMs,
    },
  )
  const delivered = channel.broadcast(payload, plan.recipients)
  if (delivered > 0) {
    return { delivered: true, backend: plan.mode === 'in-app' ? 'in-app' : 'web' }
  }
  return { delivered: false, backend: 'web', reason: 'the connected Web GUI page could not receive the notification' }
}
