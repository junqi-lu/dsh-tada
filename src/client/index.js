// dsh-tada — client half entry.
//
// Built by tsdown into client/client.js, a classic script that registers one
// lazy CommonJS factory with the page's module loader:
//
//   window.__ModuleLoader__.load({ id: 'dsh-tada', factory: (require) => {...} })
//
// Everything below is bundled into that factory. React and the Harness UI
// primitives are resolved from the page's module table at materialization and
// remain optional, so a page without them still activates the plugin and uses
// the plain-DOM toast fallback.
//
// The page is also the source of truth for what the user is currently doing:
//  - if the DSH window has focus and *this* conversation is open, the alert is
//    dropped (it is on screen already);
//  - if the DSH window has focus but another conversation is open, the alert is
//    shown as a DeepSeek Harness in-app toast instead of a system notification;
//  - if the DSH window is not focused, a native system Notification is shown.
//
// The Host routes each alert from the state this module reports, and this module
// re-checks focus at display time so a stale report can never interrupt someone
// who is reading the very conversation being reported about.

import { apply } from './apply.js'

export { apply }

/** Services the loader injects before materializing this client plugin. */
export const inject = ['slots']
