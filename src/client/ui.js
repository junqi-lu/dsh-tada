// dsh-tada — the page modules the client half optionally uses.
//
// Both stay optional: a page without React or the Harness UI primitives still
// activates the plugin and falls back to the plain-DOM toast. They are resolved
// once here so every consumer shares the same lookup through the bundle's
// injected require.

import { optionalRequire } from './host.js'

export const React = optionalRequire('react')
export const primitives = optionalRequire('@deepseek-ai/dsh-client-ui-primitives')
