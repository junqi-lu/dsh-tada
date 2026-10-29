import test from 'node:test'
import assert from 'node:assert/strict'

import {
  Config,
  clampText,
  extractText,
  isQuietTime,
  messageText,
  normalizeConfig,
  parseQuietHours,
  resolveLanguage,
} from '../index.js'

/* ------------------------------------------------------------------ */
/* Config and helpers                                                  */
/* ------------------------------------------------------------------ */

test('Config defaults are complete and Standard-Schema shaped', () => {
  const config = normalizeConfig()
  assert.equal(config.enabled, true)
  assert.equal(config.notifyOnTurnEnd, true)
  assert.equal(config.notifyOnError, true)
  assert.equal(config.notifyOnApproval, true)
  assert.equal(config.notifyOnQuestion, true)
  assert.equal(config.notifyOnSubagentEnd, false)
  assert.equal(config.notifyOnWorkflowEnd, false)
  assert.equal(config.notifyOnGoalComplete, false)
  assert.equal(config.notifySubagentSessions, false)
  assert.equal(config.includePreview, true)
  assert.equal(config.webNotifications, true)
  assert.equal(config.inAppNotifications, true)
  assert.equal(config.suppressActiveSession, true)
  assert.equal(config.inAppToastDismiss, 'auto')
  assert.equal(config.inAppHoldMs, 5000)
  assert.equal(config.appName, 'DSH')
  assert.equal(config.quietHours, '')
  assert.equal(config.minIntervalMs, 1500)
  assert.equal(config.bodyMaxLength, 160)
  assert.equal(config.language, 'auto')

  const validated = Config['~standard'].validate({ suppressActiveSession: false, notifyOnSubagentEnd: 'yes' })
  assert.equal(validated.value.suppressActiveSession, false)
  assert.equal(validated.value.notifyOnSubagentEnd, true)
  assert.equal(validated.value.notifyOnTurnEnd, true)
  assert.equal(Config['~standard'].version, 1)
})

test('normalizeConfig coerces strings, clamps numbers, and drops unknown keys', () => {
  const config = normalizeConfig({
    enabled: 'off',
    notifyOnError: 0,
    minIntervalMs: -10,
    bodyMaxLength: 5000,
    quietHours: '22:00 - 08:00',
    language: 'fr',
    appName: '  ',
    inAppNotifications: 'no',
    suppressActiveSession: 'false',
    inAppToastDismiss: ' MANUAL ',
    inAppHoldMs: 999999,
    unknownKey: 'ignored',
  })
  assert.equal(config.enabled, false)
  assert.equal(config.notifyOnError, false)
  assert.equal(config.minIntervalMs, 0)
  assert.equal(config.bodyMaxLength, 500)
  assert.equal(config.quietHours, '22:00-08:00')
  assert.equal(config.language, 'auto')
  assert.equal(config.appName, 'DSH')
  assert.equal(config.inAppNotifications, false)
  assert.equal(config.suppressActiveSession, false)
  assert.equal(config.inAppToastDismiss, 'manual')
  assert.equal(config.inAppHoldMs, 30000)
  assert.equal('unknownKey' in config, false)
})

test('inAppToastDismiss accepts only auto and manual, defaulting to auto', () => {
  assert.equal(normalizeConfig({ inAppToastDismiss: 'auto' }).inAppToastDismiss, 'auto')
  assert.equal(normalizeConfig({ inAppToastDismiss: 'manual' }).inAppToastDismiss, 'manual')
  // The fade duration and the manual switch are independent settings.
  const manual = normalizeConfig({ inAppToastDismiss: 'manual', inAppHoldMs: 8000 })
  assert.equal(manual.inAppToastDismiss, 'manual')
  assert.equal(manual.inAppHoldMs, 8000)
  // Unknown values and configs without the field keep the 5s auto fade.
  assert.equal(normalizeConfig({ inAppToastDismiss: 'sticky' }).inAppToastDismiss, 'auto')
  assert.equal(normalizeConfig({ inAppToastDismiss: 1 }).inAppToastDismiss, 'auto')
  assert.equal(normalizeConfig().inAppHoldMs, 5000)
})

test('quiet hours parse and evaluate across midnight', () => {
  assert.equal(parseQuietHours('22:00-08:00'), '22:00-08:00')
  assert.equal(parseQuietHours('22:00 - 08:00'), '22:00-08:00')
  assert.equal(parseQuietHours('9:05-17:30'), '09:05-17:30')
  assert.equal(parseQuietHours('25:00-08:00'), '')
  assert.equal(parseQuietHours('nope'), '')

  const overnight = '22:00-08:00'
  assert.equal(isQuietTime(overnight, new Date(2026, 0, 1, 23, 30)), true)
  assert.equal(isQuietTime(overnight, new Date(2026, 0, 1, 7, 59)), true)
  assert.equal(isQuietTime(overnight, new Date(2026, 0, 1, 8, 0)), false)
  assert.equal(isQuietTime(overnight, new Date(2026, 0, 1, 12, 0)), false)
  assert.equal(isQuietTime('09:00-17:00', new Date(2026, 0, 1, 10, 0)), true)
  assert.equal(isQuietTime('09:00-17:00', new Date(2026, 0, 1, 18, 0)), false)
  assert.equal(isQuietTime('', new Date()), false)
})

test('text helpers collapse whitespace, truncate, and flatten content blocks', () => {
  assert.equal(clampText('  hello\n\nworld  '), 'hello world')
  const truncated = clampText('x'.repeat(50), 10)
  assert.equal(truncated.length, 10)
  assert.ok(truncated.endsWith('…'))

  assert.equal(extractText([{ type: 'text', text: ' a ' }, { type: 'reasoning', text: 'r' }, { type: 'text', text: 'b' }]), 'a\nb')
  assert.equal(messageText({ content: [{ type: 'text', text: 'done' }] }), 'done')
  assert.equal(messageText(undefined), '')
})

test('language normalization', () => {
  assert.equal(resolveLanguage('zh'), 'zh')
  assert.equal(resolveLanguage('en'), 'en')
  // The platform preference locale wins over Node's LANG/ICU, which GUI apps often leave as C.
  assert.equal(resolveLanguage('auto', { LANG: 'en_US.UTF-8' }, () => 'zh_CN'), 'zh')
  assert.equal(resolveLanguage('auto', { LANG: 'zh_CN.UTF-8' }, () => ''), 'zh')
  assert.equal(resolveLanguage('zh', {}, () => 'en_US'), 'zh')
})
