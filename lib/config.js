/** Plugin Config: defaults, coercion, and the hand-written Standard Schema. */

import { VENDOR } from './package.js'
import { clampText, parseQuietHours } from './text.js'

const DEFAULT_DEFAULTS = Object.freeze({
  enabled: true,
  notifyOnTurnEnd: true,
  notifyOnError: true,
  notifyOnApproval: true,
  notifyOnQuestion: true,
  notifyOnSubagentEnd: false,
  notifyOnWorkflowEnd: false,
  notifyOnGoalComplete: false,
  notifySubagentSessions: false,
  includePreview: true,
  webNotifications: true,
  inAppNotifications: true,
  suppressActiveSession: true,
  inAppToastDismiss: 'auto',
  inAppHoldMs: 5000,
  appName: 'DSH',
  quietHours: '',
  minIntervalMs: 1500,
  bodyMaxLength: 160,
  language: 'auto',
})

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  const text = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}

function parseInteger(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.floor(number)
}

function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/**
 * Validate and fill the plugin Config. Unknown keys are dropped and every
 * value is coerced into the shape `apply` expects.
 */
export function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const languageRaw = typeof input.language === 'string' ? input.language.trim().toLowerCase() : 'auto'
  // `auto` fades after inAppHoldMs; `manual` waits for the user's 查看/关闭 click.
  const dismissRaw = typeof input.inAppToastDismiss === 'string' ? input.inAppToastDismiss.trim().toLowerCase() : ''
  const appName = typeof input.appName === 'string' && input.appName.trim() !== ''
    ? clampText(input.appName, 40)
    : DEFAULT_DEFAULTS.appName
  return {
    enabled: parseBoolean(input.enabled, DEFAULT_DEFAULTS.enabled),
    notifyOnTurnEnd: parseBoolean(input.notifyOnTurnEnd, DEFAULT_DEFAULTS.notifyOnTurnEnd),
    notifyOnError: parseBoolean(input.notifyOnError, DEFAULT_DEFAULTS.notifyOnError),
    notifyOnApproval: parseBoolean(input.notifyOnApproval, DEFAULT_DEFAULTS.notifyOnApproval),
    notifyOnQuestion: parseBoolean(input.notifyOnQuestion, DEFAULT_DEFAULTS.notifyOnQuestion),
    notifyOnSubagentEnd: parseBoolean(input.notifyOnSubagentEnd, DEFAULT_DEFAULTS.notifyOnSubagentEnd),
    notifyOnWorkflowEnd: parseBoolean(input.notifyOnWorkflowEnd, DEFAULT_DEFAULTS.notifyOnWorkflowEnd),
    notifyOnGoalComplete: parseBoolean(input.notifyOnGoalComplete, DEFAULT_DEFAULTS.notifyOnGoalComplete),
    notifySubagentSessions: parseBoolean(input.notifySubagentSessions, DEFAULT_DEFAULTS.notifySubagentSessions),
    includePreview: parseBoolean(input.includePreview, DEFAULT_DEFAULTS.includePreview),
    webNotifications: parseBoolean(input.webNotifications, DEFAULT_DEFAULTS.webNotifications),
    inAppNotifications: parseBoolean(input.inAppNotifications, DEFAULT_DEFAULTS.inAppNotifications),
    suppressActiveSession: parseBoolean(input.suppressActiveSession, DEFAULT_DEFAULTS.suppressActiveSession),
    inAppToastDismiss: dismissRaw === 'manual' ? 'manual' : DEFAULT_DEFAULTS.inAppToastDismiss,
    inAppHoldMs: clampInteger(parseInteger(input.inAppHoldMs, DEFAULT_DEFAULTS.inAppHoldMs), 1000, 30000),
    appName,
    quietHours: parseQuietHours(input.quietHours),
    minIntervalMs: clampInteger(parseInteger(input.minIntervalMs, DEFAULT_DEFAULTS.minIntervalMs), 0, 600000),
    bodyMaxLength: clampInteger(parseInteger(input.bodyMaxLength, DEFAULT_DEFAULTS.bodyMaxLength), 20, 500),
    language: languageRaw === 'zh' || languageRaw === 'en' ? languageRaw : 'auto',
  }
}

/** Cordis Config: a hand-written Standard Schema v1 (zero dependencies). */
export const Config = {
  '~standard': {
    version: 1,
    vendor: VENDOR,
    validate(value) {
      return { value: normalizeConfig(value) }
    },
  },
}
