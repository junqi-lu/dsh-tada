import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

import { normalizeConfig } from '../lib/config.js'
import { DEFAULT_DISPLAY } from '../lib/display.js'
import { DEFAULT_TOAST } from '../lib/toast-settings.js'
import { dshHome, displayFilePath, loadSettings, normalizeSettings, saveSettings } from '../lib/display-store.js'

/* ------------------------------------------------------------------ */
/* Notification settings persistence                                   */
/* ------------------------------------------------------------------ */

const EMPTY_TOAST = { dismiss: null, holdMs: null }
const emptySettings = () => ({ display: DEFAULT_DISPLAY, toast: EMPTY_TOAST, config: null })

test('dshHome and displayFilePath honor $DSH_HOME and ignore blank values', () => {
  assert.equal(dshHome({ DSH_HOME: '/srv/dsh-home' }), '/srv/dsh-home')
  assert.equal(dshHome({ DSH_HOME: '  ' }), join(homedir(), '.dsh'))
  assert.equal(dshHome({}), join(homedir(), '.dsh'))
  assert.equal(displayFilePath({ DSH_HOME: '/srv/dsh-home' }), join('/srv/dsh-home', 'dsh-tada', 'display.json'))
})

test('normalizeSettings reads nested and flat documents, keeping Config absence distinct from defaults', () => {
  // No document at all: defaults with no saved Config.
  assert.deepEqual(normalizeSettings(), emptySettings())

  // Nested in-memory shape with the full Config.
  const config = normalizeConfig({ enabled: false, language: 'zh', inAppHoldMs: 9000 })
  assert.deepEqual(
    normalizeSettings({ display: { title: 'T', body: 'B' }, toast: { dismiss: 'manual' }, config }),
    {
      display: { title: 'T', body: 'B' },
      toast: { dismiss: 'manual', holdMs: null },
      config,
    },
  )

  // Flat durable document (the on-disk shape) may carry toast and Config too.
  const flat = normalizeSettings({
    title: '{{app}}',
    body: '{{detail}}',
    toast: { holdMs: 7000 },
    config: { notifyOnError: false, appName: 'Tada' },
  })
  assert.deepEqual(flat.display, { title: '{{app}}', body: '{{detail}}' })
  assert.deepEqual(flat.toast, { dismiss: null, holdMs: 7000 })
  assert.deepEqual(flat.config, normalizeConfig({ notifyOnError: false, appName: 'Tada' }))

  // A non-object Config counts as absent rather than as defaults.
  assert.equal(normalizeSettings({ config: 'nope' }).config, null)
  assert.equal(normalizeSettings({ config: [] }).config, null)
  assert.equal(normalizeSettings({ config: null }).config, null)
})

test('saveSettings persists templates, toast, and the full Config, loadSettings reads them back', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-tada-settings-'))
  try {
    const file = join(dir, 'nested', 'display.json')
    const config = normalizeConfig({ enabled: false, language: 'zh', inAppHoldMs: 9000, appName: 'Tada' })
    const saved = await saveSettings({
      display: { title: '{{session}} — {{app}}', body: '{{workspace}}' },
      toast: { dismiss: 'manual', holdMs: 8000 },
      config,
    }, file)
    assert.deepEqual(saved, {
      display: { title: '{{session}} — {{app}}', body: '{{workspace}}' },
      toast: { dismiss: 'manual', holdMs: 8000 },
      config,
    })
    assert.deepEqual(loadSettings(file), saved)
    const document = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(document, {
      title: '{{session}} — {{app}}',
      body: '{{workspace}}',
      toast: { dismiss: 'manual', holdMs: 8000 },
      config,
    })

    // A missing or malformed file falls back to the defaults with no saved
    // toast override and no saved Config.
    assert.deepEqual(loadSettings(join(dir, 'missing.json')), emptySettings())
    const broken = join(dir, 'broken.json')
    await writeFile(broken, '{not json')
    assert.deepEqual(loadSettings(broken), emptySettings())

    // Saving templates only must not invent a toast override or a Config.
    const templatesOnly = await saveSettings({ display: { title: '{{event}}', body: '{{detail}}' } }, file)
    assert.deepEqual(templatesOnly, {
      display: { title: '{{event}}', body: '{{detail}}' },
      toast: EMPTY_TOAST,
      config: null,
    })
    const templatesDocument = JSON.parse(await readFile(file, 'utf8'))
    assert.equal('toast' in templatesDocument, false)
    assert.equal('config' in templatesDocument, false)

    // Saving the Config only writes the full normalized Config and keeps the
    // default display, with no toast override invented.
    const configOnly = await saveSettings({ config: { enabled: false, inAppHoldMs: 9000 } }, file)
    assert.deepEqual(configOnly, {
      display: DEFAULT_DISPLAY,
      toast: EMPTY_TOAST,
      config: normalizeConfig({ enabled: false, inAppHoldMs: 9000 }),
    })
    const configDocument = JSON.parse(await readFile(file, 'utf8'))
    assert.deepEqual(configDocument, {
      title: DEFAULT_DISPLAY.title,
      body: DEFAULT_DISPLAY.body,
      config: normalizeConfig({ enabled: false, inAppHoldMs: 9000 }),
    })
    assert.equal('toast' in configDocument, false)

    // Invalid values are normalized: the mode is dropped, the duration clamped.
    const clamped = await saveSettings({ toast: { dismiss: 'sometimes', holdMs: 999999 } }, file)
    assert.deepEqual(clamped.toast, { dismiss: null, holdMs: 30000 })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).toast, { holdMs: 30000 })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('the default toast matches the plugin Config defaults', () => {
  assert.deepEqual(DEFAULT_TOAST, { dismiss: 'auto', holdMs: 5000 })
})
