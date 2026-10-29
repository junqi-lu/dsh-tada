/**
 * User-composable display of notifications: the title and body are templates
 * the user edits, with `{{preset}}` placeholders the Host fills in.
 *
 * A notification decision produces `fields` instead of a fixed title/body: the
 * `app` name, an event label, the Session title, the Workspace title, and the
 * free-form `detail` (preview, error message, question, tool name, …). The
 * display settings are two user-written templates, so the Settings page can
 * let the user reword and recompose every automatic alert without touching the
 * code.
 */

import { clampText } from './text.js'

/** Presets a template may reference, in the order the settings page shows them. */
export const DISPLAY_PRESETS = Object.freeze(['app', 'event', 'session', 'workspace', 'detail'])

const PRESET_SET = new Set(DISPLAY_PRESETS)

/** Longest accepted template, in characters. */
const MAX_TEMPLATE_LENGTH = 200

/** Title clamp shared with the delivery payload. */
const MAX_TITLE_LENGTH = 80

/** Default join used by the blank-title fallback. */
const DEFAULT_SEPARATOR = ' · '

/** Display settings used when nothing was saved, or a saved value is invalid. */
export const DEFAULT_DISPLAY = Object.freeze({
  title: '{{event}}',
  body: '{{session}}',
})

/** A literal that is only a join separator (so it can vanish with an empty value). */
const SEPARATOR_ONLY = /^[\s·|,;:，；：、/\\\-–—]+$/

/** Placeholder syntax: `{{app}}`, `{{ event }}`, … */
const PLACEHOLDER = /\{\{\s*([a-zA-Z][\w-]*)\s*\}\}/g

/** Flatten a template to one line and enforce the storage cap. */
function cleanTemplate(value) {
  if (typeof value !== 'string') return ''
  const flat = value
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.slice(0, MAX_TEMPLATE_LENGTH).trim()
}

/**
 * Validate and fill display settings. Unknown or empty templates restore their
 * default.
 */
export function normalizeDisplay(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const template = (value) => (typeof value === 'string' ? cleanTemplate(value) : '')
  return {
    title: template(input.title) || DEFAULT_DISPLAY.title,
    body: template(input.body) || DEFAULT_DISPLAY.body,
  }
}

/** Split a template into literal and placeholder segments. */
function segmentsOf(template) {
  const segments = []
  let last = 0
  PLACEHOLDER.lastIndex = 0
  for (let match = PLACEHOLDER.exec(template); match !== null; match = PLACEHOLDER.exec(template)) {
    if (match.index > last) segments.push({ literal: template.slice(last, match.index) })
    segments.push({ preset: match[1].toLowerCase(), token: match[0] })
    last = PLACEHOLDER.lastIndex
  }
  if (last < template.length) segments.push({ literal: template.slice(last) })
  return segments
}

/**
 * Render a template with one notification's fields.
 *
 * Known placeholders are filled; an unknown placeholder is left verbatim so a
 * typo is visible instead of silently vanishing. An empty field is dropped
 * together with one separator-only literal next to it, so `{{session}} · {{detail}}`
 * does not leave a dangling ` · ` when there is no Session title.
 */
export function renderTemplate(template, fields, maxLength = MAX_TEMPLATE_LENGTH) {
  if (typeof template !== 'string' || template === '') return ''
  const parts = []
  for (const segment of segmentsOf(template)) {
    if (segment.literal !== undefined) {
      if (segment.literal !== '') parts.push({ text: segment.literal, literal: true })
      continue
    }
    const known = PRESET_SET.has(segment.preset)
    const value = known && typeof fields?.[segment.preset] === 'string'
      ? clampText(fields[segment.preset], maxLength)
      : ''
    parts.push({ text: known ? value : segment.token, literal: false })
  }
  // Drop each empty value plus one adjacent separator-only literal.
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (part.literal || part.text !== '') continue
    const next = parts[index + 1]
    if (next && next.literal && SEPARATOR_ONLY.test(next.text)) {
      parts.splice(index, 2)
      index -= 1
      continue
    }
    const previous = parts[index - 1]
    if (previous && previous.literal && SEPARATOR_ONLY.test(previous.text)) {
      parts.splice(index - 1, 2)
      index -= 2
      continue
    }
    parts.splice(index, 1)
    index -= 1
  }
  return clampText(parts.map((part) => part.text).join(''), maxLength)
}

/** Compose the title from the user's title template. */
export function composeTitle(fields, display) {
  const template = typeof display?.title === 'string' && display.title !== ''
    ? display.title
    : DEFAULT_DISPLAY.title
  const title = renderTemplate(template, fields, MAX_TITLE_LENGTH)
  if (title !== '') return title
  // A title must never be blank; the app name and the event label always exist.
  return clampText(
    [fields?.app, fields?.event].filter((value) => typeof value === 'string' && value !== '').join(DEFAULT_SEPARATOR),
    MAX_TITLE_LENGTH,
  )
}

/** Compose the body from the user's body template, falling back to the detail. */
export function composeBody(fields, display, fallback = '', maxLength = 160) {
  const template = typeof display?.body === 'string' && display.body !== ''
    ? display.body
    : DEFAULT_DISPLAY.body
  const body = renderTemplate(template, fields, maxLength)
  return clampText(body !== '' ? body : fallback, maxLength)
}

/**
 * Replace a decision's default title/body with the user's templates. Only
 * automatic notifications carry `fields`; anything without them is passed
 * through unchanged.
 */
export function shapeNotification(notification, display, config) {
  if (!notification || typeof notification !== 'object' || !notification.fields) return notification
  return {
    ...notification,
    title: composeTitle(notification.fields, display),
    body: composeBody(notification.fields, display, notification.body, config?.bodyMaxLength ?? 160),
  }
}
