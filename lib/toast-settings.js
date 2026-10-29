/**
 * In-app toast behavior: the dismissal mode and the auto-fade duration.
 *
 * These settings live in the same user-edited document as the notification
 * content templates (`display.json`), so the Settings page can configure them
 * without a plugin reload. The plugin Config provides the fallback defaults;
 * a saved document simply overrides the parts it stores.
 */

/** Defaults, identical to the plugin Config defaults. */
export const DEFAULT_TOAST = Object.freeze({ dismiss: 'auto', holdMs: 5000 })

/** Accepted dismissal modes: `auto` fades, `manual` waits for the user. */
export const TOAST_DISMISS_MODES = Object.freeze(['auto', 'manual'])

/** Bounds shared with the Config normalization and the Settings page input. */
export const TOAST_HOLD_MIN_MS = 1000
export const TOAST_HOLD_MAX_MS = 30000

/**
 * Normalize a toast document value.
 *
 * A part that is missing or invalid stays `null` instead of being filled with a
 * default: the persisted document then keeps overriding only what the user
 * actually saved, and {@link resolveToast} supplies the Config default for the
 * rest.
 */
export function normalizeToast(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const mode = typeof input.dismiss === 'string' ? input.dismiss.trim().toLowerCase() : ''
  const dismiss = mode === 'auto' || mode === 'manual' ? mode : null
  const hold = Number(input.holdMs)
  const holdMs =
    input.holdMs === undefined ||
    input.holdMs === null ||
    input.holdMs === '' ||
    !Number.isFinite(hold)
      ? null
      : Math.min(TOAST_HOLD_MAX_MS, Math.max(TOAST_HOLD_MIN_MS, Math.round(hold)))
  return { dismiss, holdMs }
}

/** Fill a normalized toast document from a complete fallback. */
export function resolveToast(saved, fallback = DEFAULT_TOAST) {
  const value = normalizeToast(saved)
  const defaults = normalizeToast(fallback)
  return {
    dismiss: value.dismiss ?? defaults.dismiss ?? DEFAULT_TOAST.dismiss,
    holdMs: value.holdMs ?? defaults.holdMs ?? DEFAULT_TOAST.holdMs,
  }
}
