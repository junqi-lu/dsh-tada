import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_TOAST,
  TOAST_DISMISS_MODES,
  TOAST_HOLD_MAX_MS,
  TOAST_HOLD_MIN_MS,
  normalizeToast,
  resolveToast,
} from '../index.js'

/* ------------------------------------------------------------------ */
/* In-app toast settings                                               */
/* ------------------------------------------------------------------ */

test('normalizeToast keeps only valid saved parts and clamps the duration', () => {
  assert.deepEqual(normalizeToast(undefined), { dismiss: null, holdMs: null })
  assert.deepEqual(normalizeToast({}), { dismiss: null, holdMs: null })
  assert.deepEqual(normalizeToast('manual'), { dismiss: null, holdMs: null })

  assert.deepEqual(normalizeToast({ dismiss: 'manual', holdMs: 8000 }), { dismiss: 'manual', holdMs: 8000 })
  assert.deepEqual(normalizeToast({ dismiss: ' AUTO ' }), { dismiss: 'auto', holdMs: null })
  assert.deepEqual(normalizeToast({ dismiss: 'sticky', holdMs: 'nope' }), { dismiss: null, holdMs: null })

  assert.equal(normalizeToast({ holdMs: 0 }).holdMs, TOAST_HOLD_MIN_MS)
  assert.equal(normalizeToast({ holdMs: 999999 }).holdMs, TOAST_HOLD_MAX_MS)
  assert.equal(normalizeToast({ holdMs: 5500.6 }).holdMs, 5501)
})

test('resolveToast fills a saved document from the plugin Config defaults', () => {
  assert.deepEqual(DEFAULT_TOAST, { dismiss: 'auto', holdMs: 5000 })
  assert.deepEqual(TOAST_DISMISS_MODES, ['auto', 'manual'])

  // No saved override → the Config defaults.
  assert.deepEqual(resolveToast(undefined), DEFAULT_TOAST)
  assert.deepEqual(resolveToast(undefined, { dismiss: 'manual', holdMs: 8000 }), { dismiss: 'manual', holdMs: 8000 })

  // A partial saved override changes only the part the user saved.
  assert.deepEqual(resolveToast({ dismiss: 'manual' }, { dismiss: 'auto', holdMs: 6000 }), {
    dismiss: 'manual',
    holdMs: 6000,
  })
  assert.deepEqual(resolveToast({ holdMs: 2000 }, { dismiss: 'manual', holdMs: 6000 }), {
    dismiss: 'manual',
    holdMs: 2000,
  })
  assert.deepEqual(resolveToast({ dismiss: 'auto', holdMs: 3000 }), { dismiss: 'auto', holdMs: 3000 })

  // An unusable fallback still resolves to a complete value.
  assert.deepEqual(resolveToast(undefined, {}), DEFAULT_TOAST)
})
