/**
 * dsh-tada — native desktop notifications for DeepSeek Harness.
 *
 * The Host half of the bundle. It observes Cordis events (turn completion,
 * errors, approvals, questions, subagent/workflow/goal outcomes) and streams
 * each alert to the connected Web GUI page, where the renderer raises a
 * Notification owned by DeepSeek Harness.
 *
 * Zero runtime dependencies: only Node builtins. Notification text travels to
 * the page as JSON over a loopback SSE stream, never interpolated into code.
 *
 * Config is a hand-written Standard Schema (`~standard` v1), so a linked local
 * bundle needs no package dependency resolution.
 *
 * Implementation lives in `lib/`; this entry only re-exports the public Host
 * API that `apply`, the client half, and the tests consume.
 */

export const name = 'dsh-tada'

export { TEXT, clampText, extractText, isQuietTime, messageText, parseQuietHours, readSystemLocale, resolveLanguage } from './lib/text.js'
export { Config, normalizeConfig } from './lib/config.js'
export { DEFAULT_DISPLAY, DISPLAY_PRESETS, composeBody, composeTitle, normalizeDisplay, renderTemplate, shapeNotification } from './lib/display.js'
export { DEFAULT_TOAST, TOAST_DISMISS_MODES, TOAST_HOLD_MAX_MS, TOAST_HOLD_MIN_MS, normalizeToast, resolveToast } from './lib/toast-settings.js'
export { decideApprovalNotification, decideGoalNotification, decideQuestionNotification, decideSubagentEndNotification, decideTurnNotification, decideWorkflowEndNotification } from './lib/decisions.js'
export { createWebChannel, normalizeClientState } from './lib/channel.js'
export { SETTINGS_ROUTE, STATE_ROUTE, STATUS_ROUTE, WEB_ROUTE, createSettingsHandler, createSseHandler, createStateHandler, createStatusHandler, isLoopbackAddress, isLoopbackOrigin } from './lib/routes.js'
export { buildWebPayload, deliverNotification, planNotificationDelivery } from './lib/delivery.js'
export { apply } from './lib/plugin.js'
