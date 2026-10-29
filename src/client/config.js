// Routes and timing shared by the client half.
//
// The Host mounts these loopback-only routes (see lib/routes.js); the client
// half only ever speaks to them same-origin.

/** SSE stream carrying Host alerts to the page. */
export const EVENTS_ROUTE = '/dsh-tada/events'

/** Page → Host state reports (focus, open conversation, permission). */
export const STATE_ROUTE = '/dsh-tada/state'

/** Default in-app toast hold time when the Host does not send holdMs. */
export const DEFAULT_HOLD_MS = 5000

/** Page ↔ Host notification-settings route (Settings → Notifications). */
export const SETTINGS_ROUTE = '/dsh-tada/settings'
