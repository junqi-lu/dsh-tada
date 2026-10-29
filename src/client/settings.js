// dsh-tada — Settings → "Notifications": edit the notification content
// templates, the in-app toast behavior, and the plugin-Config notification
// behavior (which events notify, delivery channels, quiet hours, formatting).
//
// The Host owns the actual composition (lib/display.js) and persists the
// settings through the loopback SETTINGS_ROUTE; this page edits them and
// previews the result locally. The page is plain React (no Harness primitives)
// and stays absent — never failing boot — on pages that lack React, the slots
// service, or the settings section.

import { SETTINGS_ROUTE } from './config.js'
import { service } from './host.js'
import { installNotificationNavIcon } from './nav-icon.js'
import { TOAST_NEWLINE_CSS } from './toast.js'
import { React } from './ui.js'

/** Preset catalog used before the Host answers, or when it cannot. */
const FALLBACK_PRESETS = ['app', 'event', 'session', 'workspace', 'detail']

/** Local defaults, identical to the Host's DEFAULT_DISPLAY. */
const DEFAULT_DISPLAY = { title: '{{event}}', body: '{{session}}' }

/** Local toast defaults, identical to the plugin Config defaults. */
const DEFAULT_TOAST = { dismiss: 'auto', holdMs: 5000 }

/**
 * Local mirror of the Host plugin-Config defaults (lib/config.js), used before
 * the Host answers and when it cannot. Every key the notification page edits is
 * listed so a failed GET still renders a complete, resettable form.
 */
const CONFIG_DEFAULTS = Object.freeze({
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

/** Bounds the Host clamps every Config number to. */
const CONFIG_LIMITS = Object.freeze({
  minIntervalMs: Object.freeze([0, 600000]),
  bodyMaxLength: Object.freeze([20, 500]),
})

/** Longest app name the Host stores. */
const APP_NAME_MAX_LENGTH = 40

/** Languages the Host accepts; anything else falls back to `auto`. */
const CONFIG_LANGUAGES = Object.freeze(['auto', 'zh', 'en'])

/** Event switches, in card order: [Config key, copy id]. */
const EVENT_SWITCHES = Object.freeze([
  ['notifyOnTurnEnd', 'turnEnd'],
  ['notifyOnError', 'error'],
  ['notifyOnApproval', 'approval'],
  ['notifyOnQuestion', 'question'],
  ['notifyOnSubagentEnd', 'subagentEnd'],
  ['notifyOnWorkflowEnd', 'workflowEnd'],
  ['notifyOnGoalComplete', 'goalComplete'],
])

/** Delivery-channel switches, in card order: [Config key, copy id]. */
const CHANNEL_SWITCHES = Object.freeze([
  ['webNotifications', 'web'],
  ['inAppNotifications', 'inApp'],
  ['suppressActiveSession', 'suppressActive'],
])

/** Toast duration bounds, matching the Host's normalization. */
const TOAST_HOLD_MIN_MS = 1000
const TOAST_HOLD_MAX_MS = 30000

/** Longest template the editor accepts, matching the Host's storage cap. */
const MAX_TEMPLATE_LENGTH = 200

/** Placeholder syntax: `{{app}}`, `{{ event }}`, … */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g

const COPY = {
  zh: {
    nav: '通知',
    contentHeading: '通知内容',
    contentIntro: '标题和正文共同组成通知文本，可以混排下方预设。',
    titleLabel: '标题',
    bodyLabel: '正文',
    presets: '可用预设',
    presetLabels: {
      app: '应用名',
      event: '事件',
      session: '会话标题',
      workspace: '工作区名',
      detail: '内容',
    },
    sample: {
      event: '任务完成',
      session: '修复登录问题',
      workspace: 'dsh-tada',
      detail: '本轮对话已处理完毕',
    },
    preview: '预览',
    toastHeading: '应用内提醒',
    toastIntro: '当 DSH 在前台但停留在其他会话时，提醒会以 toast 显示。',
    dismissLabel: '关闭方式',
    autoLabel: '自动消失',
    autoHint: '显示一段时间后自动淡出',
    manualLabel: '手动关闭',
    manualHint: '一直显示，直到点击「关闭」或打开会话',
    durationLabel: '显示时长',
    secondsUnit: '秒',
    durationHint: '1–30 秒，默认 5 秒',
    durationOff: '手动关闭模式下不生效',
    invalidSeconds: '请输入 1–30 之间的秒数',
    toastPreview: 'TOAST 预览',
    toastOpen: '查看',
    toastClose: '关闭',
    previewAuto: '{seconds} 秒后自动消失',
    previewManual: '不会自动消失，点击「关闭」收起',
    save: '保存',
    saving: '保存中…',
    saved: '已保存',
    reset: '恢复默认',
    failed: '保存失败，请重试',
    loadFailed: '读取设置失败，当前显示的是默认值',
    behaviorHeading: '通知行为',
    behaviorIntro: '控制是否提醒，以及哪些事件会触发提醒。',
    masterLabel: '启用通知',
    masterHint: '关闭后不再发送系统或应用内提醒',
    eventsLabel: '事件通知',
    events: {
      turnEnd: { label: '轮次结束', hint: '每轮对话完成时提醒' },
      error: { label: '出错', hint: '任务或工具执行失败时提醒' },
      approval: { label: '等待批准', hint: '需要你批准操作时提醒' },
      question: { label: '等待回答', hint: '需要你回答问题或选择时提醒' },
      subagentEnd: { label: '子任务结束', hint: '子代理任务完成时提醒' },
      workflowEnd: { label: '工作流结束', hint: '工作流运行完成时提醒' },
      goalComplete: { label: '目标完成', hint: '长期目标完成时提醒' },
    },
    otherLabel: '其他',
    notifySubagentSessionsLabel: '子会话通知',
    notifySubagentSessionsHint: '子代理会话中的提醒也照常送达',
    includePreviewLabel: '附带内容预览',
    includePreviewHint: '通知正文包含回复内容摘要',
    advancedHeading: '高级',
    advancedIntro: '调整通知通道、内容格式与提醒频率。',
    channelsLabel: '通知通道',
    channels: {
      web: { label: '系统通知', hint: '在桌面系统上弹出通知横幅' },
      inApp: { label: '应用内提醒', hint: '在 DSH 页面内显示 toast' },
      suppressActive: { label: '当前会话静默', hint: '正在查看的会话完成时不重复提醒' },
    },
    appNameLabel: '应用名',
    appNameHint: '通知中 {{app}} 预设显示的名称',
    languageLabel: '语言',
    languageHint: '通知正文使用的语言',
    languageAuto: '跟随应用',
    languageZh: '中文',
    languageEn: 'English',
    quietHoursLabel: '免打扰时段',
    quietHoursPlaceholder: '22:00-08:00',
    quietHoursHint: '留空表示不启用；格式 HH:MM-HH:MM，支持跨夜',
    minIntervalLabel: '最小提醒间隔',
    minIntervalUnit: '毫秒',
    minIntervalHint: '0–600000 毫秒，避免提醒过于频繁',
    bodyMaxLengthLabel: '正文最大长度',
    bodyMaxLengthHint: '20–500 个字符',
  },
  en: {
    nav: 'Notifications',
    contentHeading: 'Notification content',
    contentIntro: 'The title and body form the notification text; mix in the presets below.',
    titleLabel: 'Title',
    bodyLabel: 'Body',
    presets: 'Presets',
    presetLabels: {
      app: 'App name',
      event: 'Event',
      session: 'Session title',
      workspace: 'Workspace',
      detail: 'Content',
    },
    sample: {
      event: 'Turn complete',
      session: 'Fix login bug',
      workspace: 'dsh-tada',
      detail: 'The turn finished.',
    },
    preview: 'Preview',
    toastHeading: 'In-app toast',
    toastIntro: 'While DSH is focused on another conversation, alerts appear as an in-app toast.',
    dismissLabel: 'Dismissal',
    autoLabel: 'Auto-dismiss',
    autoHint: 'Fades out after the duration below',
    manualLabel: 'Manual dismiss',
    manualHint: 'Stays until you click Dismiss or open the Session',
    durationLabel: 'Duration',
    secondsUnit: 's',
    durationHint: '1–30 seconds, 5 s by default',
    durationOff: 'Not used in manual mode',
    invalidSeconds: 'Enter a duration between 1 and 30 seconds',
    toastPreview: 'TOAST PREVIEW',
    toastOpen: 'Open',
    toastClose: 'Dismiss',
    previewAuto: 'Disappears after {seconds}s',
    previewManual: 'Stays until dismissed',
    save: 'Save',
    saving: 'Saving…',
    saved: 'Saved',
    reset: 'Restore defaults',
    failed: 'Save failed, please retry',
    loadFailed: 'Could not load the settings; showing the defaults',
    behaviorHeading: 'Notification behavior',
    behaviorIntro: 'Control whether alerts are delivered and which events can trigger them.',
    masterLabel: 'Enable notifications',
    masterHint: 'Off means no system or in-app alerts at all',
    eventsLabel: 'Event alerts',
    events: {
      turnEnd: { label: 'Turn complete', hint: 'Alert when a turn finishes' },
      error: { label: 'Errors', hint: 'Alert when a task or tool fails' },
      approval: { label: 'Approval needed', hint: 'Alert when your approval is required' },
      question: { label: 'Question asked', hint: 'Alert when a question needs your answer' },
      subagentEnd: { label: 'Subagent finished', hint: 'Alert when a subagent task completes' },
      workflowEnd: { label: 'Workflow finished', hint: 'Alert when a workflow run completes' },
      goalComplete: { label: 'Goal complete', hint: 'Alert when a long-running goal is achieved' },
    },
    otherLabel: 'Other',
    notifySubagentSessionsLabel: 'Subagent-session alerts',
    notifySubagentSessionsHint: 'Deliver alerts raised inside subagent sessions too',
    includePreviewLabel: 'Include content preview',
    includePreviewHint: 'The notification body carries a reply excerpt',
    advancedHeading: 'Advanced',
    advancedIntro: 'Adjust delivery channels, content format, and alert frequency.',
    channelsLabel: 'Delivery channels',
    channels: {
      web: { label: 'System notifications', hint: 'Show desktop notification banners' },
      inApp: { label: 'In-app alerts', hint: 'Show an in-app toast inside DSH' },
      suppressActive: { label: 'Silence the open session', hint: 'No alert for the Session you are already viewing' },
    },
    appNameLabel: 'App name',
    appNameHint: 'Shown where templates use the {{app}} preset',
    languageLabel: 'Language',
    languageHint: 'Language of the notification text',
    languageAuto: 'Follow the app',
    languageZh: '中文',
    languageEn: 'English',
    quietHoursLabel: 'Quiet hours',
    quietHoursPlaceholder: '22:00-08:00',
    quietHoursHint: 'Leave empty to disable; HH:MM-HH:MM, overnight windows are fine',
    minIntervalLabel: 'Minimum interval',
    minIntervalUnit: 'ms',
    minIntervalHint: '0–600000 ms, avoids alert flooding',
    bodyMaxLengthLabel: 'Maximum body length',
    bodyMaxLengthHint: '20–500 characters',
  },
}

const CSS = [
  '.tada-settings{display:flex;flex-direction:column;gap:16px;padding:2px 0 24px;max-width:720px;color:var(--dsw-alias-label-primary,#e6e6e6);font:400 14px/22px system-ui,-apple-system,sans-serif}',
  '.tada-settings-card{display:flex;flex-direction:column;gap:12px;padding:14px 16px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:12px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.06))}',
  '.tada-settings-field{display:flex;flex-direction:column;gap:7px}',
  '.tada-settings-label{display:flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:12px;font-weight:600;line-height:18px;letter-spacing:.02em}',
  '.tada-settings-field input{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,#e6e6e6);font:13px/20px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;border-radius:8px;padding:0 11px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}',
  '.tada-settings-field input::placeholder{color:var(--dsw-alias-label-caption,#7f858d)}',
  '.tada-settings-field input:focus{border-color:var(--dsw-static-deepseek-400,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.18)}',
  '.tada-settings-field input:disabled{opacity:.6;cursor:not-allowed}',
  '.tada-settings-field select{box-sizing:border-box;width:100%;height:36px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10));color:var(--dsw-alias-label-primary,#e6e6e6);font:13px/20px system-ui,-apple-system,sans-serif;border-radius:8px;padding:0 11px;outline:none;transition:border-color .15s ease,box-shadow .15s ease}',
  '.tada-settings-field select:focus{border-color:var(--dsw-static-deepseek-400,#5686fe);box-shadow:0 0 0 3px rgba(86,134,254,.18)}',
  '.tada-settings-field select:disabled{opacity:.6;cursor:not-allowed}',
  '.tada-settings-divider{width:100%;height:0;margin:0;border:0;border-top:1px solid var(--dsw-alias-border-l2,#3a3f46);opacity:.85}',
  '.tada-settings-presets{display:flex;flex-direction:column;gap:8px}',
  '.tada-settings-preset-list{display:flex;flex-wrap:wrap;gap:8px}',
  '.tada-settings-preset{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:999px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.08));font-size:12px;line-height:18px}',
  '.tada-settings-preset code{font:12px/18px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:var(--dsw-static-deepseek-400,#5686fe)}',
  '.tada-settings-preset-label{color:var(--dsw-alias-label-caption,#7f858d)}',
  '.tada-settings-preview{display:flex;flex-direction:column;gap:5px;padding:12px 16px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:12px;background:var(--dsw-alias-bg-layer-2,#1c2128)}',
  '.tada-settings-preview-caption{color:var(--dsw-alias-label-caption,#7f858d);font-size:11px;line-height:16px;letter-spacing:.04em}',
  '.tada-settings-preview-title{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:14px;font-weight:600;line-height:21px;word-break:break-word}',
  '.tada-settings-preview-body{color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:13px;line-height:20px;word-break:break-word}',
  '.tada-settings-heading{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:600;line-height:20px}',
  '.tada-settings-desc{margin:0;color:var(--dsw-alias-label-caption,#7f858d);font-size:12px;line-height:18px}',
  '.tada-settings-choice{display:flex;flex-wrap:wrap;gap:10px}',
  '.tada-settings-choice-btn{box-sizing:border-box;flex:1 1 220px;display:flex;flex-direction:column;align-items:flex-start;gap:3px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:border-color .15s ease,background .15s ease,box-shadow .15s ease}',
  '.tada-settings-choice-btn:hover:not(:disabled){background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10))}',
  '.tada-settings-choice-btn[aria-pressed="true"]{border-color:var(--dsw-static-deepseek-400,#5686fe);background:rgba(86,134,254,.12);box-shadow:inset 0 0 0 1px var(--dsw-static-deepseek-400,#5686fe)}',
  '.tada-settings-choice-btn:disabled{opacity:.6;cursor:not-allowed}',
  '.tada-settings-choice-label{color:var(--dsw-alias-label-primary,#e6e6e6);font-size:13px;font-weight:600;line-height:20px}',
  '.tada-settings-choice-hint{color:var(--dsw-alias-label-caption,#7f858d);font-size:12px;line-height:18px}',
  '.tada-settings-group-label{color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:12px;font-weight:600;line-height:18px;letter-spacing:.02em}',
  '.tada-settings-switch-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}',
  '.tada-settings-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:10px;background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.06))}',
  '.tada-settings-switch-text{display:flex;flex-direction:column;gap:2px;min-width:0}',
  '.tada-settings-switch{box-sizing:border-box;flex:none;position:relative;width:38px;height:22px;padding:0;border:1px solid var(--dsw-alias-border-l2,#3a3f46);border-radius:999px;background:var(--dsw-alias-bg-layer-2,#1c2128);cursor:pointer;transition:background .15s ease,border-color .15s ease}',
  '.tada-settings-switch[aria-checked="true"]{border-color:var(--dsw-static-deepseek-400,#5686fe);background:var(--dsw-static-deepseek-400,#5686fe)}',
  '.tada-settings-switch:disabled{opacity:.6;cursor:not-allowed}',
  '.tada-settings-switch-thumb{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s ease}',
  '.tada-settings-switch[aria-checked="true"] .tada-settings-switch-thumb{transform:translateX(16px)}',
  '.tada-settings-config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}',
  '.tada-settings-row{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.tada-settings-field .tada-settings-number{width:112px;flex:none}',
  '.tada-settings-unit{color:var(--dsw-alias-label-secondary,#c4c7cc);font-size:13px;line-height:20px}',
  '.tada-settings-hint{color:var(--dsw-alias-label-caption,#7f858d);font-size:12px;line-height:18px}',
  '.tada-settings-hint-error{color:var(--dsw-alias-label-error,#e5484d)}',
  '.tada-settings-toast-preview{display:flex;flex-direction:column;gap:1px;max-width:100%;padding:10px 14px;border-radius:10px;background:var(--dsw-alias-toast-bg,#2c2c2e);color:var(--dsw-alias-toast-label,#fff);box-shadow:var(--dsw-shadow-lv3,0 8px 24px #00000033);font-size:13px;line-height:20px}',
  '.tada-settings-toast-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}',
  '.tada-settings-toast-row{display:flex;align-items:center;gap:8px;min-width:0}',
  '.tada-settings-toast-body{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-toast-label,#fff);opacity:.82}',
  '.tada-settings-toast-actions{flex:none;color:var(--dsw-static-deepseek-400,#5686fe);white-space:nowrap}',
  // The in-app toast keeps the title/body line break the client half composes;
  // see TOAST_NEWLINE_CSS for why this stylesheet owns it as well.
  TOAST_NEWLINE_CSS,
  '.tada-settings-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
  '.tada-settings-btn{box-sizing:border-box;font:inherit;font-size:13px;font-weight:500;line-height:30px;height:30px;border-radius:8px;border:1px solid transparent;padding:0 15px;cursor:pointer;transition:background .15s ease,border-color .15s ease,opacity .15s ease}',
  '.tada-settings-btn-primary{background:var(--dsw-static-deepseek-400,#5686fe);color:#fff}',
  '.tada-settings-btn-primary:hover:not(:disabled){background:var(--dsw-static-deepseek-500,#4574e8)}',
  '.tada-settings-btn-primary:disabled{opacity:.6;cursor:not-allowed}',
  '.tada-settings-btn-ghost{background:transparent;color:var(--dsw-alias-label-secondary,#c4c7cc);border-color:var(--dsw-alias-border-l2,#3a3f46)}',
  '.tada-settings-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-bg-module-platform,rgba(127,127,127,.10))}',
  '.tada-settings-msg{color:var(--dsw-alias-label-tertiary,#9aa0a6);font-size:12px;line-height:18px;min-height:18px}',
].join('')

function ensureStyle() {
  try {
    if (typeof document === 'undefined' || !document.head || typeof document.createElement !== 'function') return
    // A hot-reloaded module leaves its old `<style>` tag behind, so overwrite
    // the text rather than skipping an existing tag.
    const existing = typeof document.head.querySelector === 'function'
      ? document.head.querySelector('style[data-plugin-css="dsh-tada"]')
      : null
    if (existing) {
      if (existing.textContent !== CSS) existing.textContent = CSS
      return
    }
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin-css', 'dsh-tada')
    tag.textContent = CSS
    document.head.appendChild(tag)
  } catch {
    /* styling is best effort */
  }
}

/** Active page language: the GUI keeps `<html lang>` current for us. */
function pageLanguage() {
  try {
    const lang = (typeof document !== 'undefined' && document.documentElement ? document.documentElement.lang : '') || ''
    if (/^zh/i.test(lang)) return 'zh'
    if (lang !== '') return 'en'
  } catch {
    /* fall through */
  }
  try {
    const nav = typeof navigator !== 'undefined' && typeof navigator.language === 'string' ? navigator.language : ''
    return /^zh/i.test(nav) ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

function copy() {
  return COPY[pageLanguage()]
}

/** Accept the Host's templates, restoring each missing part's default. */
function normalizeDisplay(value, defaults = DEFAULT_DISPLAY) {
  const template = (candidate, fallback) =>
    typeof candidate === 'string' && candidate.trim() !== ''
      ? candidate.slice(0, MAX_TEMPLATE_LENGTH)
      : fallback
  return {
    title: template(value?.title, defaults.title),
    body: template(value?.body, defaults.body),
  }
}

function normalizePresets(value) {
  const presets = Array.isArray(value)
    ? value.filter((id) => typeof id === 'string' && id !== '')
    : []
  return presets.length > 0 ? presets : [...FALLBACK_PRESETS]
}

/** Format a hold duration as the seconds value the number input edits. */
function formatSeconds(holdMs) {
  const seconds = holdMs / 1000
  return Number.isInteger(seconds) ? String(seconds) : String(Number(seconds.toFixed(2)))
}

/** Parse the seconds input back to milliseconds, falling back when invalid. */
function holdMsOf(secondsText, fallback) {
  const seconds = Number(secondsText)
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : fallback
}

/** Toast behavior as this page edits it: the mode plus seconds as text. */
function normalizeToast(value, fallback = DEFAULT_TOAST) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const fallbackDismiss = fallback.dismiss === 'manual' ? 'manual' : 'auto'
  const dismiss = source.dismiss === 'manual' ? 'manual' : source.dismiss === 'auto' ? 'auto' : fallbackDismiss
  const fallbackHold = Number.isFinite(Number(fallback.holdMs))
    ? Number(fallback.holdMs)
    : Number(fallback.seconds) * 1000
  const sourceHold = Number(source.holdMs)
  const hold = Number.isFinite(sourceHold)
    ? sourceHold
    : Number.isFinite(fallbackHold)
      ? fallbackHold
      : DEFAULT_TOAST.holdMs
  const holdMs = Math.min(TOAST_HOLD_MAX_MS, Math.max(TOAST_HOLD_MIN_MS, Math.round(hold)))
  return { dismiss, seconds: formatSeconds(holdMs) }
}

/** Coerce a Config boolean; a malformed value keeps the fallback. */
function boolValue(value, fallback) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(text)) return true
    if (['0', 'false', 'no', 'off'].includes(text)) return false
  }
  return typeof fallback === 'boolean' ? fallback : false
}

/** Coerce a Config integer, clamped to [min, max]; malformed keeps the fallback. */
function intValue(value, fallback, [min, max]) {
  if (typeof value === 'string' && value.trim() === '') return fallback
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.floor(number)))
}

/**
 * Local mirror of the Host's Config normalization: unknown keys are dropped,
 * booleans and numbers are coerced/clamped, malformed values fall back to the
 * supplied defaults (the Host's `configDefaults`, or the local mirror). The
 * draft values this page edits may be text (number inputs); saving normalizes
 * them back into the full object the Host expects.
 */
function normalizeConfig(value, defaults = CONFIG_DEFAULTS) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const fallback = defaults && typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : CONFIG_DEFAULTS
  const appName = typeof input.appName === 'string' ? input.appName.trim() : ''
  const language = typeof input.language === 'string' ? input.language.trim().toLowerCase() : ''
  const dismiss = typeof input.inAppToastDismiss === 'string'
    ? input.inAppToastDismiss.trim().toLowerCase()
    : ''
  const quietHours = typeof input.quietHours === 'string' ? input.quietHours.trim() : ''
  return {
    enabled: boolValue(input.enabled, fallback.enabled),
    notifyOnTurnEnd: boolValue(input.notifyOnTurnEnd, fallback.notifyOnTurnEnd),
    notifyOnError: boolValue(input.notifyOnError, fallback.notifyOnError),
    notifyOnApproval: boolValue(input.notifyOnApproval, fallback.notifyOnApproval),
    notifyOnQuestion: boolValue(input.notifyOnQuestion, fallback.notifyOnQuestion),
    notifyOnSubagentEnd: boolValue(input.notifyOnSubagentEnd, fallback.notifyOnSubagentEnd),
    notifyOnWorkflowEnd: boolValue(input.notifyOnWorkflowEnd, fallback.notifyOnWorkflowEnd),
    notifyOnGoalComplete: boolValue(input.notifyOnGoalComplete, fallback.notifyOnGoalComplete),
    notifySubagentSessions: boolValue(input.notifySubagentSessions, fallback.notifySubagentSessions),
    includePreview: boolValue(input.includePreview, fallback.includePreview),
    webNotifications: boolValue(input.webNotifications, fallback.webNotifications),
    inAppNotifications: boolValue(input.inAppNotifications, fallback.inAppNotifications),
    suppressActiveSession: boolValue(input.suppressActiveSession, fallback.suppressActiveSession),
    inAppToastDismiss: dismiss === 'auto' || dismiss === 'manual'
      ? dismiss
      : fallback.inAppToastDismiss === 'manual'
        ? 'manual'
        : 'auto',
    inAppHoldMs: intValue(input.inAppHoldMs, fallback.inAppHoldMs, [TOAST_HOLD_MIN_MS, TOAST_HOLD_MAX_MS]),
    appName: appName !== ''
      ? appName.slice(0, APP_NAME_MAX_LENGTH)
      : typeof fallback.appName === 'string' && fallback.appName.trim() !== ''
        ? fallback.appName.trim().slice(0, APP_NAME_MAX_LENGTH)
        : CONFIG_DEFAULTS.appName,
    quietHours: typeof input.quietHours === 'string'
      ? quietHours
      : typeof fallback.quietHours === 'string'
        ? fallback.quietHours.trim()
        : '',
    minIntervalMs: intValue(input.minIntervalMs, fallback.minIntervalMs, CONFIG_LIMITS.minIntervalMs),
    bodyMaxLength: intValue(input.bodyMaxLength, fallback.bodyMaxLength, CONFIG_LIMITS.bodyMaxLength),
    language: CONFIG_LANGUAGES.includes(language)
      ? language
      : CONFIG_LANGUAGES.includes(fallback.language)
        ? fallback.language
        : 'auto',
  }
}

/** Render one template with the preview sample; unknown presets stay visible. */
function render(template, sample) {
  const text = String(template ?? '').replace(PLACEHOLDER, (token, id) => {
    const key = id.toLowerCase()
    return Object.prototype.hasOwnProperty.call(sample, key) ? sample[key] : token
  })
  return text.replace(/\s+/g, ' ').trim()
}

function TemplateField(props) {
  const { part, label, value, disabled, onChange } = props
  return React.createElement(
    'label',
    { className: 'tada-settings-field' },
    React.createElement('span', { className: 'tada-settings-label' }, label),
    React.createElement('input', {
      type: 'text',
      value,
      maxLength: MAX_TEMPLATE_LENGTH,
      placeholder: DEFAULT_DISPLAY[part],
      disabled,
      spellCheck: false,
      autoComplete: 'off',
      onChange: (event) => onChange(part, event.target.value),
    }),
  )
}

/** One option of the dismissal segmented control. */
function ChoiceButton(props) {
  const { active, label, hint, disabled, onClick } = props
  return React.createElement(
    'button',
    {
      type: 'button',
      className: 'tada-settings-choice-btn',
      'aria-pressed': active,
      disabled,
      onClick,
    },
    React.createElement('span', { className: 'tada-settings-choice-label' }, label),
    React.createElement('span', { className: 'tada-settings-choice-hint' }, hint),
  )
}

/** One Config switch: a label/hint block beside an accessible switch button. */
function SwitchField(props) {
  const { label, hint, checked, disabled, onChange } = props
  return React.createElement(
    'div',
    { className: 'tada-settings-switch-row' },
    React.createElement(
      'div',
      { className: 'tada-settings-switch-text' },
      React.createElement('span', { className: 'tada-settings-choice-label' }, label),
      hint !== '' ? React.createElement('span', { className: 'tada-settings-hint' }, hint) : null,
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        role: 'switch',
        className: 'tada-settings-switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        onClick: () => onChange(!checked),
      },
      React.createElement('span', { className: 'tada-settings-switch-thumb' }),
    ),
  )
}

/** One free-text Config field (app name, quiet hours). */
function ConfigTextField(props) {
  const { label, hint, value, placeholder, maxLength, disabled, onChange } = props
  return React.createElement(
    'label',
    { className: 'tada-settings-field' },
    React.createElement('span', { className: 'tada-settings-label' }, label),
    React.createElement('input', {
      type: 'text',
      value,
      placeholder,
      maxLength,
      disabled,
      spellCheck: false,
      autoComplete: 'off',
      'aria-label': label,
      onChange: (event) => onChange(event.target.value),
    }),
    hint !== '' ? React.createElement('span', { className: 'tada-settings-hint' }, hint) : null,
  )
}

/** One Config select (the notification language). */
function ConfigSelectField(props) {
  const { label, hint, value, options, disabled, onChange } = props
  return React.createElement(
    'label',
    { className: 'tada-settings-field' },
    React.createElement('span', { className: 'tada-settings-label' }, label),
    React.createElement(
      'select',
      {
        value,
        disabled,
        'aria-label': label,
        onChange: (event) => onChange(event.target.value),
      },
      options.map((option) => React.createElement(
        'option',
        { key: option.value, value: option.value },
        option.label,
      )),
    ),
    hint !== '' ? React.createElement('span', { className: 'tada-settings-hint' }, hint) : null,
  )
}

/** One bounded Config number, with the Host-clamped range shown beside it. */
function ConfigNumberField(props) {
  const { label, hint, value, min, max, unit, disabled, onChange } = props
  return React.createElement(
    'div',
    { className: 'tada-settings-field' },
    React.createElement('span', { className: 'tada-settings-label' }, label),
    React.createElement(
      'div',
      { className: 'tada-settings-row' },
      React.createElement('input', {
        type: 'number',
        className: 'tada-settings-number',
        min,
        max,
        step: 1,
        inputMode: 'numeric',
        value,
        disabled,
        'aria-label': label,
        onChange: (event) => onChange(event.target.value),
      }),
      unit !== '' ? React.createElement('span', { className: 'tada-settings-unit' }, unit) : null,
      React.createElement('span', { className: 'tada-settings-hint' }, hint),
    ),
  )
}

function SettingsSection() {
  const [state, setState] = React.useState({
    status: 'loading',
    display: DEFAULT_DISPLAY,
    defaults: DEFAULT_DISPLAY,
    presets: FALLBACK_PRESETS,
    toast: normalizeToast(DEFAULT_TOAST),
    toastDefaults: normalizeToast(DEFAULT_TOAST),
    config: { ...CONFIG_DEFAULTS },
    configDefaults: { ...CONFIG_DEFAULTS },
    saving: false,
    message: '',
  })
  const t = copy()
  const update = (patch) => setState((prev) => ({ ...prev, ...patch }))

  React.useEffect(() => {
    let alive = true
    ensureStyle()
    const load = async () => {
      try {
        const res = await fetch(SETTINGS_ROUTE, { headers: { accept: 'application/json' } })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!alive) return
        const defaults = normalizeDisplay(data?.defaults ?? DEFAULT_DISPLAY, DEFAULT_DISPLAY)
        const toastDefaults = normalizeToast(data?.toastDefaults ?? DEFAULT_TOAST, normalizeToast(DEFAULT_TOAST))
        const configDefaults = normalizeConfig(data?.configDefaults, CONFIG_DEFAULTS)
        const configSource = data?.config && typeof data.config === 'object' && !Array.isArray(data.config)
          ? data.config
          : { ...configDefaults }
        update({
          status: 'ready',
          display: normalizeDisplay(data?.display ?? defaults, defaults),
          defaults,
          presets: normalizePresets(data?.presets),
          toast: normalizeToast(data?.toast ?? toastDefaults, toastDefaults),
          toastDefaults,
          config: normalizeConfig(configSource, configDefaults),
          configDefaults,
          message: '',
        })
      } catch {
        if (!alive) return
        update({
          status: 'error',
          display: DEFAULT_DISPLAY,
          defaults: DEFAULT_DISPLAY,
          presets: FALLBACK_PRESETS,
          toast: normalizeToast(DEFAULT_TOAST),
          toastDefaults: normalizeToast(DEFAULT_TOAST),
          config: { ...CONFIG_DEFAULTS },
          configDefaults: { ...CONFIG_DEFAULTS },
          message: t.loadFailed,
        })
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  const setTemplate = (part, value) => {
    update({ display: { ...state.display, [part]: value }, message: '' })
  }
  const setToast = (patch) => {
    update({ toast: { ...state.toast, ...patch }, message: '' })
  }
  const setConfig = (patch) => {
    update({ config: { ...state.config, ...patch }, message: '' })
  }

  const seconds = Number(state.toast.seconds)
  const secondsValid =
    state.toast.seconds.trim() !== '' &&
    Number.isFinite(seconds) &&
    seconds >= TOAST_HOLD_MIN_MS / 1000 &&
    seconds <= TOAST_HOLD_MAX_MS / 1000
  const manual = state.toast.dismiss === 'manual'
  // In manual mode the duration is inert, so an edited-to-invalid value must not
  // block saving the mode; fall back to the default duration the Host clamps.
  const sentHoldMs = secondsValid ? Math.round(seconds * 1000) : holdMsOf(state.toastDefaults.seconds, DEFAULT_TOAST.holdMs)

  const save = async () => {
    if (state.saving || (!manual && !secondsValid)) return
    update({ saving: true, message: '' })
    // The Config carries the full notification behavior; the toast card doubles
    // as the editor for its in-app dismissal parts, so mirror them here.
    const config = normalizeConfig({
      ...state.config,
      inAppToastDismiss: state.toast.dismiss,
      inAppHoldMs: sentHoldMs,
    }, state.configDefaults)
    try {
      const res = await fetch(SETTINGS_ROUTE, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          display: state.display,
          toast: { dismiss: state.toast.dismiss, holdMs: sentHoldMs },
          config,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json().catch(() => ({}))
      update({
        display: normalizeDisplay(data?.display ?? state.display, state.defaults),
        toast: normalizeToast(
          data?.toast ?? { dismiss: state.toast.dismiss, holdMs: sentHoldMs },
          state.toastDefaults,
        ),
        config: normalizeConfig(data?.config ?? config, state.configDefaults),
        saving: false,
        message: t.saved,
      })
    } catch {
      update({ saving: false, message: t.failed })
    }
  }

  const loading = state.status === 'loading'
  const disabled = loading || state.saving
  const sample = { ...t.sample, app: state.config.appName }
  const previewTitle = render(state.display.title, sample) || `${sample.app} · ${sample.event}`
  const previewBody = render(state.display.body, sample) || sample.detail
  const durationInvalid = !manual && !secondsValid
  const durationHint = manual ? t.durationOff : secondsValid ? t.durationHint : t.invalidSeconds
  const previewSeconds = secondsValid ? state.toast.seconds : state.toastDefaults.seconds
  const config = state.config
  const languageOptions = [
    { value: 'auto', label: t.languageAuto },
    { value: 'zh', label: t.languageZh },
    { value: 'en', label: t.languageEn },
  ]

  return React.createElement(
    'div',
    { className: 'tada-settings' },
    // Notification content: templates, presets and the composed preview all live
    // in one card, mirroring the in-app toast card below.
    React.createElement(
      'div',
      { className: 'tada-settings-card' },
      React.createElement('div', { className: 'tada-settings-heading' }, t.contentHeading),
      React.createElement('p', { className: 'tada-settings-desc' }, t.contentIntro),
      React.createElement(TemplateField, {
        part: 'title',
        label: t.titleLabel,
        value: state.display.title,
        disabled,
        onChange: setTemplate,
      }),
      // The divider makes the two templates read as the notification's two parts.
      React.createElement('hr', { className: 'tada-settings-divider' }),
      React.createElement(TemplateField, {
        part: 'body',
        label: t.bodyLabel,
        value: state.display.body,
        disabled,
        onChange: setTemplate,
      }),
      React.createElement('hr', { className: 'tada-settings-divider' }),
      React.createElement(
        'div',
        { className: 'tada-settings-presets' },
        React.createElement('span', { className: 'tada-settings-label' }, t.presets),
        React.createElement(
          'div',
          { className: 'tada-settings-preset-list' },
          state.presets.map((id) => React.createElement(
            'span',
            { key: id, className: 'tada-settings-preset' },
            React.createElement('code', null, `{{${id}}}`),
            React.createElement('span', { className: 'tada-settings-preset-label' }, t.presetLabels[id] ?? id),
          )),
        ),
      ),
      React.createElement(
        'div',
        { className: 'tada-settings-preview' },
        React.createElement('span', { className: 'tada-settings-preview-caption' }, t.preview),
        React.createElement('span', { className: 'tada-settings-preview-title' }, previewTitle),
        React.createElement('span', { className: 'tada-settings-preview-body' }, previewBody),
      ),
    ),
    // In-app toast behavior: the same card grammar as the template card above.
    React.createElement(
      'div',
      { className: 'tada-settings-card' },
      React.createElement('div', { className: 'tada-settings-heading' }, t.toastHeading),
      React.createElement('p', { className: 'tada-settings-desc' }, t.toastIntro),
      React.createElement(
        'div',
        { className: 'tada-settings-field' },
        React.createElement('span', { className: 'tada-settings-label' }, t.dismissLabel),
        React.createElement(
          'div',
          { className: 'tada-settings-choice', role: 'group', 'aria-label': t.dismissLabel },
          React.createElement(ChoiceButton, {
            active: !manual,
            label: t.autoLabel,
            hint: t.autoHint,
            disabled,
            onClick: () => setToast({ dismiss: 'auto' }),
          }),
          React.createElement(ChoiceButton, {
            active: manual,
            label: t.manualLabel,
            hint: t.manualHint,
            disabled,
            onClick: () => setToast({ dismiss: 'manual' }),
          }),
        ),
      ),
      React.createElement('hr', { className: 'tada-settings-divider' }),
      React.createElement(
        'div',
        { className: 'tada-settings-field' },
        React.createElement('span', { className: 'tada-settings-label' }, t.durationLabel),
        React.createElement(
          'div',
          { className: 'tada-settings-row' },
          React.createElement('input', {
            type: 'number',
            className: 'tada-settings-number',
            min: TOAST_HOLD_MIN_MS / 1000,
            max: TOAST_HOLD_MAX_MS / 1000,
            step: 1,
            inputMode: 'numeric',
            value: state.toast.seconds,
            disabled: disabled || manual,
            'aria-label': t.durationLabel,
            'aria-invalid': durationInvalid,
            onChange: (event) => setToast({ seconds: event.target.value }),
          }),
          React.createElement('span', { className: 'tada-settings-unit' }, t.secondsUnit),
          React.createElement(
            'span',
            { className: `tada-settings-hint${durationInvalid ? ' tada-settings-hint-error' : ''}` },
            durationHint,
          ),
        ),
      ),
      React.createElement(
        'div',
        { className: 'tada-settings-preview' },
        React.createElement('span', { className: 'tada-settings-preview-caption' }, t.toastPreview),
        React.createElement(
          'div',
          { className: 'tada-settings-toast-preview' },
          // Title and body stack like the notification's two parts; the actions
          // stay inline after the body, as they do in the real toast.
          React.createElement('span', { className: 'tada-settings-toast-title' }, previewTitle),
          React.createElement(
            'div',
            { className: 'tada-settings-toast-row' },
            React.createElement('span', { className: 'tada-settings-toast-body' }, previewBody),
            React.createElement(
              'span',
              { className: 'tada-settings-toast-actions' },
              manual ? `${t.toastOpen} · ${t.toastClose}` : t.toastOpen,
            ),
          ),
        ),
        React.createElement(
          'span',
          { className: 'tada-settings-hint' },
          manual ? t.previewManual : t.previewAuto.replace('{seconds}', previewSeconds),
        ),
      ),
    ),
    // Notification behavior: one master switch, the event switches, then the
    // cross-cutting switches, grouped so the list stays scannable.
    React.createElement(
      'div',
      { className: 'tada-settings-card' },
      React.createElement('div', { className: 'tada-settings-heading' }, t.behaviorHeading),
      React.createElement('p', { className: 'tada-settings-desc' }, t.behaviorIntro),
      React.createElement(SwitchField, {
        label: t.masterLabel,
        hint: t.masterHint,
        checked: config.enabled,
        disabled,
        onChange: (value) => setConfig({ enabled: value }),
      }),
      React.createElement('hr', { className: 'tada-settings-divider' }),
      React.createElement(
        'div',
        { className: 'tada-settings-field' },
        React.createElement('span', { className: 'tada-settings-group-label' }, t.eventsLabel),
        React.createElement(
          'div',
          { className: 'tada-settings-switch-grid' },
          EVENT_SWITCHES.map(([key, id]) => React.createElement(SwitchField, {
            key,
            label: t.events[id].label,
            hint: t.events[id].hint,
            checked: config[key],
            disabled,
            onChange: (value) => setConfig({ [key]: value }),
          })),
        ),
      ),
      React.createElement('hr', { className: 'tada-settings-divider' }),
      React.createElement(
        'div',
        { className: 'tada-settings-field' },
        React.createElement('span', { className: 'tada-settings-group-label' }, t.otherLabel),
        React.createElement(
          'div',
          { className: 'tada-settings-switch-grid' },
          React.createElement(SwitchField, {
            label: t.notifySubagentSessionsLabel,
            hint: t.notifySubagentSessionsHint,
            checked: config.notifySubagentSessions,
            disabled,
            onChange: (value) => setConfig({ notifySubagentSessions: value }),
          }),
          React.createElement(SwitchField, {
            label: t.includePreviewLabel,
            hint: t.includePreviewHint,
            checked: config.includePreview,
            disabled,
            onChange: (value) => setConfig({ includePreview: value }),
          }),
        ),
      ),
    ),
    // Advanced: channels, content format (app name/language), and frequency.
    React.createElement(
      'div',
      { className: 'tada-settings-card' },
      React.createElement('div', { className: 'tada-settings-heading' }, t.advancedHeading),
      React.createElement('p', { className: 'tada-settings-desc' }, t.advancedIntro),
      React.createElement(
        'div',
        { className: 'tada-settings-field' },
        React.createElement('span', { className: 'tada-settings-group-label' }, t.channelsLabel),
        React.createElement(
          'div',
          { className: 'tada-settings-switch-grid' },
          CHANNEL_SWITCHES.map(([key, id]) => React.createElement(SwitchField, {
            key,
            label: t.channels[id].label,
            hint: t.channels[id].hint,
            checked: config[key],
            disabled,
            onChange: (value) => setConfig({ [key]: value }),
          })),
        ),
      ),
      React.createElement('hr', { className: 'tada-settings-divider' }),
      React.createElement(
        'div',
        { className: 'tada-settings-config-grid' },
        React.createElement(ConfigTextField, {
          label: t.appNameLabel,
          hint: t.appNameHint,
          value: config.appName,
          maxLength: APP_NAME_MAX_LENGTH,
          disabled,
          onChange: (value) => setConfig({ appName: value }),
        }),
        React.createElement(ConfigSelectField, {
          label: t.languageLabel,
          hint: t.languageHint,
          value: config.language,
          options: languageOptions,
          disabled,
          onChange: (value) => setConfig({ language: value }),
        }),
      ),
      React.createElement(
        'div',
        { className: 'tada-settings-config-grid' },
        React.createElement(ConfigTextField, {
          label: t.quietHoursLabel,
          hint: t.quietHoursHint,
          value: config.quietHours,
          placeholder: t.quietHoursPlaceholder,
          maxLength: 11,
          disabled,
          onChange: (value) => setConfig({ quietHours: value }),
        }),
        React.createElement(ConfigNumberField, {
          label: t.minIntervalLabel,
          hint: t.minIntervalHint,
          value: config.minIntervalMs,
          min: CONFIG_LIMITS.minIntervalMs[0],
          max: CONFIG_LIMITS.minIntervalMs[1],
          unit: t.minIntervalUnit,
          disabled,
          onChange: (value) => setConfig({ minIntervalMs: value }),
        }),
        React.createElement(ConfigNumberField, {
          label: t.bodyMaxLengthLabel,
          hint: t.bodyMaxLengthHint,
          value: config.bodyMaxLength,
          min: CONFIG_LIMITS.bodyMaxLength[0],
          max: CONFIG_LIMITS.bodyMaxLength[1],
          unit: '',
          disabled,
          onChange: (value) => setConfig({ bodyMaxLength: value }),
        }),
      ),
    ),
    React.createElement(
      'div',
      { className: 'tada-settings-actions' },
      React.createElement('button', {
        type: 'button',
        className: 'tada-settings-btn tada-settings-btn-primary',
        disabled: disabled || durationInvalid,
        onClick: save,
      }, state.saving ? t.saving : t.save),
      React.createElement('button', {
        type: 'button',
        className: 'tada-settings-btn tada-settings-btn-ghost',
        disabled,
        onClick: () => update({
          display: { ...state.defaults },
          toast: { ...state.toastDefaults },
          config: { ...state.configDefaults },
          message: '',
        }),
      }, t.reset),
      React.createElement('span', { className: 'tada-settings-msg' }, state.message),
    ),
  )
}

/**
 * Register the "Notifications" settings page (content templates, in-app toast
 * behavior, notification-behavior switches, and advanced Config fields) and
 * give its Settings-nav row the notification bell.
 *
 * `icon` is the forward-compatible hint for hosts that render section icons;
 * hosts that only fall back to the generic gear are handled by nav-icon.js,
 * which swaps the glyph on the rendered row. Returns the disposer; on a page
 * without React or the settings slots the plugin simply has no page.
 */
export function registerSettingsSection(ctx) {
  if (!React || typeof React.createElement !== 'function') return () => {}
  const slots = service(ctx, 'slots')
  if (!slots || typeof slots.inject !== 'function' || typeof slots.register !== 'function') return () => {}
  try {
    const disposeSection = slots.inject('settings.section', () => {
      ensureStyle()
      return slots.register(
        { name: 'settings.section', id: 'dsh-tada-content', order: 30, label: () => copy().nav, icon: 'bell' },
        () => React.createElement(SettingsSection),
      )
    })
    const disposeNavIcon = installNotificationNavIcon(() => copy().nav)
    return () => {
      try {
        disposeNavIcon()
      } catch {
        /* already released */
      }
      disposeSection()
    }
  } catch {
    return () => {}
  }
}
