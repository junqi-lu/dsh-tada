/** Pure text, locale, and error-message helpers (exported for tests). */

import { spawnSync } from 'node:child_process'

/** Bilingual notification copy. `auto` picks one from the system locale. */
export const TEXT = {
  zh: {
    turnEnd: '任务完成',
    turnError: '任务出错',
    turnBlocked: '任务被阻塞',
    turnMaxTokens: '达到输出上限',
    turnAborted: '任务已中止',
    approval: '等待审批',
    question: '需要你的回答',
    subagentEnd: '子代理结束',
    workflowEnd: 'Workflow 结束',
    goalComplete: '目标完成',
    turnEndBody: '本轮对话已处理完毕',
    errorFallback: '任务执行出错',
    approvalBody: 'Agent 正在等待你的审批',
    questionBody: 'Agent 正在等待你的回答',
    goalCompleteBody: '目标已完成',
    openAction: '查看',
    dismissAction: '关闭',
  },
  en: {
    turnEnd: 'Turn complete',
    turnError: 'Turn failed',
    turnBlocked: 'Turn blocked',
    turnMaxTokens: 'Output limit reached',
    turnAborted: 'Turn aborted',
    approval: 'Approval needed',
    question: 'Answer needed',
    subagentEnd: 'Subagent finished',
    workflowEnd: 'Workflow finished',
    goalComplete: 'Goal complete',
    turnEndBody: 'The turn finished.',
    errorFallback: 'The turn failed.',
    approvalBody: 'An Agent is waiting for your approval',
    questionBody: 'An Agent is waiting for your answer',
    goalCompleteBody: 'The goal completed.',
    openAction: 'Open',
    dismissAction: 'Dismiss',
  },
}

/** Collapse whitespace and truncate with an ellipsis, notification-safe. */
export function clampText(value, maxLength = 200) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= maxLength) return text
  const limit = Math.max(0, maxLength - 1)
  return `${text.slice(0, limit).trimEnd()}…`
}

/** Normalize `HH:MM-HH:MM` quiet-hour input; invalid input disables it. */
export function parseQuietHours(value) {
  if (typeof value !== 'string') return ''
  const match = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return ''
  const startHour = Number(match[1])
  const startMinute = Number(match[2])
  const endHour = Number(match[3])
  const endMinute = Number(match[4])
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return ''
  const pad = (number) => String(number).padStart(2, '0')
  return `${pad(startHour)}:${pad(startMinute)}-${pad(endHour)}:${pad(endMinute)}`
}

/** True when `when` falls inside the quiet window (overnight windows work). */
export function isQuietTime(quietHours, when = new Date()) {
  if (!quietHours) return false
  const [start, end] = quietHours.split('-')
  const toMinutes = (value) => {
    const [hour, minute] = value.split(':').map(Number)
    return hour * 60 + minute
  }
  const current = when.getHours() * 60 + when.getMinutes()
  const from = toMinutes(start)
  const to = toMinutes(end)
  if (from === to) return false
  return from < to ? current >= from && current < to : current >= from || current < to
}

/** Extract plain text from a ContentBlock[] array. */
export function extractText(blocks) {
  if (!Array.isArray(blocks)) return ''
  const parts = []
  for (const block of blocks) {
    if (!block || block.type !== 'text') continue
    const text = typeof block.text === 'string' ? block.text.trim() : ''
    if (text) parts.push(text)
  }
  return parts.join('\n')
}

/** Extract plain text from a Message (`assistant/message` payload). */
export function messageText(message) {
  return message && Array.isArray(message.content) ? extractText(message.content) : ''
}

/** macOS preference locale (AppleLocale); empty on other platforms or when unavailable. */
export function readSystemLocale() {
  if (process.platform !== 'darwin') return ''
  try {
    const result = spawnSync('/usr/bin/defaults', ['read', '-g', 'AppleLocale'], {
      encoding: 'utf8',
      timeout: 2000,
    })
    if (result.error || result.status !== 0) return ''
    return typeof result.stdout === 'string' ? result.stdout.trim() : ''
  } catch {
    return ''
  }
}

/**
 * Resolve `auto` language: an explicit preference wins, then the platform
 * preference locale (macOS `AppleLocale` when available), then Node's ICU
 * locale and language environment variables (GUI apps often leave `LANG` as
 * `C`, so ICU alone can be misleading).
 */
export function resolveLanguage(preference, env = process.env, systemLocale = readSystemLocale) {
  if (preference === 'zh' || preference === 'en') return preference
  let intlLocale = ''
  try {
    intlLocale = Intl.DateTimeFormat().resolvedOptions().locale ?? ''
  } catch {
    intlLocale = ''
  }
  let detected = ''
  try {
    detected = typeof systemLocale === 'function' ? systemLocale() : ''
  } catch {
    detected = ''
  }
  const haystack = [detected, env.LC_ALL, env.LC_MESSAGES, env.LANG, intlLocale]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .join(' ')
  return /zh/i.test(haystack) ? 'zh' : 'en'
}

/** Turn a thrown value into its message string. */
export function toMessage(error) {
  return error instanceof Error ? error.message : String(error)
}
