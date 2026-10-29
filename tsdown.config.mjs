/**
 * Client-half build: src/client/*.js -> client/client.js.
 *
 * A DSH client bundle is a **classic script**, not an ES module: the Web shell
 * loads it with a plain <script> element, and all it may do is register a lazy
 * CommonJS factory with window.__ModuleLoader__. So tsdown emits CJS and the
 * banner/footer/intro below supply the loader envelope and the injected
 * `require` the bundle must resolve platform modules through.
 *
 * React and the Harness UI primitives stay external (the page's module table
 * answers them); everything else is inlined, because a require() the table
 * cannot answer is a runtime throw. The source resolves those two specifiers
 * through `optionalRequire` in src/client/host.js, which uses the factory's own
 * `require` and therefore degrades to the plain-DOM toast when a page does not
 * have them.
 *
 * The bundle is committed (client/client.js) so a directory install works
 * without installing devDependencies or running a build. `npm run check` and
 * scripts/preflight.mjs guard the committed artifact.
 */
import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsdown'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const id = pkg.name

/** Specifiers answered by the page's module table instead of being bundled. */
const CLIENT_EXTERNALS = ['react', '@deepseek-ai/dsh-client-ui-primitives']

export default defineConfig({
  name: `${id}/client`,
  entry: { client: 'src/client/index.js' },
  // package.json exports "./client" points at client/client.js, so the bundle
  // lands there directly.
  outDir: 'client',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  // No sourcemap: the artifact is committed, and a one-line map would become a
  // whole-file conflict on every client change.
  sourcemap: false,
  clean: false,
  // The loader module table answers the externals; anything else must inline,
  // because a require() the table cannot answer is a guaranteed runtime throw.
  deps: {
    neverBundle: CLIENT_EXTERNALS,
    alwaysBundle: (source) => !CLIENT_EXTERNALS.includes(source),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})
