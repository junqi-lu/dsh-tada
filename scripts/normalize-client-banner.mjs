#!/usr/bin/env node
/**
 * Post-build normalization of client/client.js, a COMMITTED and PUBLISHED
 * artifact. Rolldown pretty-prints the tsdown banner into a three-line header;
 * the published contract (enforced by scripts/preflight.mjs) requires the file
 * to START with the exact one-line loader registration. Collapse the header
 * onto one line and leave blank lines in place of the folded ones so future
 * debugging line numbers stay stable.
 */
import fs from 'node:fs'

const file = 'client/client.js'
const name = JSON.parse(fs.readFileSync('package.json', 'utf8')).name
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`

let code = fs.readFileSync(file, 'utf8')

if (!code.startsWith(required)) {
  const lines = code.split('\n')
  const head = [
    'window.__ModuleLoader__.load({',
    `\tid: ${JSON.stringify(name)},`,
    '\tfactory: (require) => {',
  ]
  if (lines[0] !== head[0] || lines[1] !== head[1] || lines[2] !== head[2]) {
    console.error(`normalize-client-banner: unexpected ${file} header:\n` + lines.slice(0, 3).join('\n'))
    process.exit(1)
  }
  lines[0] = required
  lines[1] = ''
  lines[2] = ''
  code = lines.join('\n')
}

fs.writeFileSync(file, code)
console.log(`normalize-client-banner ok: ${file}`)
