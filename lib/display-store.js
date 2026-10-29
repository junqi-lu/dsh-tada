/** Durable notification settings: `<DSH_HOME or ~/.dsh>/dsh-tada/display.json`. */

import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { normalizeConfig } from './config.js'
import { normalizeDisplay } from './display.js'
import { normalizeToast } from './toast-settings.js'

/** Directory name of the DeepSeek Harness data root under the OS home. */
const DSH_HOME_DIR_NAME = '.dsh'

/**
 * Resolve the Harness data root the way the rest of the harness does: the
 * `$DSH_HOME` override wins over `~/.dsh`; a blank value counts as unset.
 */
export function dshHome(env = process.env) {
  const fromEnv = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return fromEnv !== '' ? fromEnv : join(homedir(), DSH_HOME_DIR_NAME)
}

/** Absolute path of this plugin's notification-settings file. */
export function displayFilePath(env = process.env) {
  return join(dshHome(env), 'dsh-tada', 'display.json')
}

/**
 * Normalize the in-memory settings shape (`{ display, toast, config }`). A flat
 * durable document (`{ title, body, toast, config }`) is accepted too, so load
 * and save can pass either form. Missing parts restore their defaults.
 *
 * `config` is the full plugin Config the Settings page saved, normalized and
 * filled with defaults, or `null` when the document stores no Config at all.
 * Keeping absence distinguishable from defaults is what lets a save of only
 * display/toast leave the plugin Config untouched.
 */
export function normalizeSettings(raw) {
  const input = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const display =
    input.display && typeof input.display === 'object' && !Array.isArray(input.display)
      ? input.display
      : input
  const config = input.config && typeof input.config === 'object' && !Array.isArray(input.config)
    ? normalizeConfig(input.config)
    : null
  return {
    display: normalizeDisplay(display),
    toast: normalizeToast(input.toast),
    config,
  }
}

/**
 * Read the saved notification settings. A missing, unreadable, or malformed
 * file yields the defaults — notification delivery must never depend on it.
 */
export function loadSettings(file = displayFilePath()) {
  try {
    return normalizeSettings(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return normalizeSettings()
  }
}

/**
 * Persist notification settings atomically: write a sibling temp file, then
 * rename over the target, so a crash cannot leave a half-written settings file.
 * Returns the normalized value that was written.
 */
export async function saveSettings(value, file = displayFilePath()) {
  const settings = normalizeSettings(value)
  const document = { ...settings.display }
  const toast = {}
  if (settings.toast.dismiss !== null) toast.dismiss = settings.toast.dismiss
  if (settings.toast.holdMs !== null) toast.holdMs = settings.toast.holdMs
  if (Object.keys(toast).length > 0) document.toast = toast
  // A null Config means "nothing saved yet": omit the key so the plugin Config
  // defaults keep applying rather than being frozen into the document.
  if (settings.config !== null) document.config = settings.config
  await mkdir(dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, { mode: 0o600 })
  await rename(temp, file)
  return settings
}
