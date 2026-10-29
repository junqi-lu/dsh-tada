/** Package identity shared by the Host half: vendor tag and browser module id. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const VENDOR = 'dsh-tada'

/** Browser module id of this bundle's client half (the package name). */
export const PACKAGE_NAME = (() => {
  try {
    return JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).name
  } catch {
    return 'dsh-tada'
  }
})()
