import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_DISPLAY,
  DISPLAY_PRESETS,
  composeBody,
  composeTitle,
  normalizeDisplay,
  renderTemplate,
  shapeNotification,
} from '../lib/display.js'

/* ------------------------------------------------------------------ */
/* Display templates                                                   */
/* ------------------------------------------------------------------ */

test('normalizeDisplay keeps template strings and fills blank parts with defaults', () => {
  assert.deepEqual(DISPLAY_PRESETS, ['app', 'event', 'session', 'workspace', 'detail'])
  assert.deepEqual(DEFAULT_DISPLAY, { title: '{{event}}', body: '{{session}}' })
  assert.deepEqual(normalizeDisplay(undefined), DEFAULT_DISPLAY)
  assert.deepEqual(normalizeDisplay({}), DEFAULT_DISPLAY)
  assert.deepEqual(normalizeDisplay({ title: '  ', body: '\n' }), DEFAULT_DISPLAY)

  const display = { title: '任务完成 · {{event}}', body: '{{session}} — {{detail}}' }
  assert.deepEqual(normalizeDisplay(display), display)

  // Templates are stored on one line and capped at the storage limit.
  assert.equal(normalizeDisplay({ title: '{{app}}\n{{event}}' }).title, '{{app}} {{event}}')
  assert.equal(normalizeDisplay({ title: 'x'.repeat(500) }).title.length, 200)
})

test('renderTemplate fills known presets and keeps unknown tokens visible', () => {
  const fields = { app: 'DSH', event: '任务完成', session: '修复登录问题', workspace: 'dsh-tada', detail: '全部完成' }
  assert.equal(renderTemplate('{{app}} · {{event}}', fields), 'DSH · 任务完成')
  assert.equal(renderTemplate('{{ app }} | {{session}}', fields), 'DSH | 修复登录问题')
  assert.equal(renderTemplate('{{app}} — {{missing}}', fields), 'DSH — {{missing}}')
  assert.equal(renderTemplate('任务完成 · {{event}}', fields), '任务完成 · 任务完成')
  assert.equal(renderTemplate('', fields), '')
  assert.equal(renderTemplate('no presets', fields), 'no presets')
})

test('renderTemplate drops an empty field together with one adjacent separator', () => {
  const fields = { app: 'DSH', event: '任务完成', session: '', workspace: '', detail: 'D' }
  assert.equal(renderTemplate('{{session}} · {{detail}}', fields), 'D')
  assert.equal(renderTemplate('{{app}} · {{session}} · {{detail}}', fields), 'DSH · D')
  assert.equal(renderTemplate('{{app}} · {{session}}', fields), 'DSH')
  assert.equal(renderTemplate('{{session}}·{{detail}}', fields), 'D')
  // Literal text around a missing value is kept; only separator-only literals vanish.
  assert.equal(renderTemplate('任务：{{session}} 完成', fields), '任务： 完成')
})

test('composeTitle and composeBody render the user templates', () => {
  const fields = { app: 'DSH', event: '任务完成', session: '修复登录问题', workspace: 'dsh-tada', detail: '全部完成' }
  assert.equal(composeTitle(fields, normalizeDisplay({ title: '{{app}} · {{event}}' })), 'DSH · 任务完成')
  assert.equal(
    composeTitle(fields, { title: '{{app}} | {{event}} | {{session}}' }),
    'DSH | 任务完成 | 修复登录问题',
  )
  assert.equal(
    composeBody(fields, { body: '{{session}} · {{workspace}} · {{detail}}' }, 'fallback', 160),
    '修复登录问题 · dsh-tada · 全部完成',
  )
  // A template with nothing to show falls back to the notification's own text.
  assert.equal(
    composeBody({ session: '', workspace: '' }, { body: '{{session}} · {{workspace}}' }, 'detail', 160),
    'detail',
  )
  // A blank or missing template also restores the host defaults.
  assert.equal(composeTitle(fields, { title: '' }), '任务完成')
  assert.equal(composeBody(fields, {}), '修复登录问题')
})

test('shapeNotification composes automatic alerts and passes through alerts without fields', () => {
  const config = { bodyMaxLength: 160 }
  const display = normalizeDisplay({ title: '{{app}} | {{event}} | {{session}}', body: '{{workspace}} | {{detail}}' })
  const automatic = {
    kind: 'turn-end',
    title: 'ignored',
    body: 'ignored',
    fields: { app: 'DSH', event: '任务完成', session: '修复登录问题', workspace: 'dsh-tada', detail: '全部完成' },
  }
  assert.deepEqual(shapeNotification(automatic, display, config), {
    ...automatic,
    title: 'DSH | 任务完成 | 修复登录问题',
    body: 'dsh-tada | 全部完成',
  })

  const bare = { kind: 'turn-end', title: 'Untemplated title', body: 'Untemplated body' }
  assert.equal(shapeNotification(bare, display, config), bare)

  // Body composition is clamped by the configured cap after rendering.
  const long = shapeNotification(
    { kind: 'turn-end', body: 'x'.repeat(200), fields: { app: 'DSH', event: 'E', detail: 'y'.repeat(200) } },
    normalizeDisplay({ body: '{{detail}}' }),
    { bodyMaxLength: 20 },
  )
  assert.equal(long.body.length, 20)
  assert.ok(long.body.endsWith('…'))
})
