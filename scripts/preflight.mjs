#!/usr/bin/env node
/**
 * Pre-flight guard for the published package shape.
 *
 * These are plain strings no compiler checks: the bundle's loader id, the
 * cordis patch row name, the published client path, and the `files` list that
 * decides what a tarball actually contains. A rename that misses one of them
 * installs cleanly and then fails to load, so this runs before pack/check.
 */
import fs from 'node:fs'

const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const name = manifest.name
const failures = []

const bundlePath = 'client/client.js'
const bundle = fs.readFileSync(bundlePath, 'utf8')
const required = `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: (require) => {`
if (!bundle.startsWith(required)) {
  failures.push(`${bundlePath} must start with the loader registration ${JSON.stringify(required)} (run npm run build:client)`)
}

if (manifest.dsh?.client?.platform !== 'web') {
  failures.push('package.json dsh.client.platform must be "web"')
}

if (manifest.exports?.['./client'] !== `./${bundlePath}`) {
  failures.push(`package.json exports["./client"] must be "./${bundlePath}"`)
}

const patch = fs.readFileSync('cordis.patch.yml', 'utf8')
if (!patch.includes(`name: ${name}`)) {
  failures.push(`cordis.patch.yml must insert the plugin by package name ${JSON.stringify(name)}`)
}

if (!fs.existsSync('index.js')) {
  failures.push('index.js host entry is missing')
}

const published = Array.isArray(manifest.files) ? manifest.files : []
for (const entry of ['index.js', 'lib', bundlePath, 'cordis.patch.yml', 'locale/*.json', 'icon.svg', 'README.md', 'LICENSE']) {
  if (!published.includes(entry)) failures.push(`package.json files must include ${JSON.stringify(entry)}`)
}

if (failures.length > 0) {
  console.error('preflight failed:\n- ' + failures.join('\n- '))
  process.exit(1)
}
console.log(`preflight ok: ${name}`)
