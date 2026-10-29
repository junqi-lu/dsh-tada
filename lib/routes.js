/** Web GUI page routes: the SSE stream, state reports, notification settings, and the loopback status route. */

import { normalizeSessionId } from './channel.js'
import { normalizeConfig } from './config.js'
import { DEFAULT_DISPLAY, DISPLAY_PRESETS, normalizeDisplay } from './display.js'
import { normalizeSettings } from './display-store.js'
import { PACKAGE_NAME } from './package.js'
import { toMessage } from './text.js'
import { DEFAULT_TOAST, resolveToast } from './toast-settings.js'

/**
 * The Desktop app renders the Web GUI inside Electron, so a notification
 * created from the page is owned by DeepSeek Harness (correct app identity and
 * icon) and its click handler can reveal the exact Session. The Host therefore
 * detects events and streams them to connected pages, which are the only
 * delivery channel.
 *
 * Pages also report two pieces of live state — whether the app window has focus
 * and which conversation is open — so the Host can pick the least intrusive
 * presentation for each alert (see {@link planNotificationDelivery}).
 */
export const WEB_ROUTE = '/dsh-tada/events'

/** Page → Host state reports (focus, open conversation, permission). */
export const STATE_ROUTE = '/dsh-tada/state'

/** Loopback-only diagnostic route (clients, permission, routing settings). */
export const STATUS_ROUTE = '/dsh-tada/status'

/** Page ↔ Host notification-settings route (Settings → Notifications). */
export const SETTINGS_ROUTE = '/dsh-tada/settings'

/** Loopback-only guard shared by the page routes (the Web server binds locally). */
export function isLoopbackAddress(address) {
  if (typeof address !== 'string' || address === '') return false
  return address === '::1' || address === '::ffff:127.0.0.1' || /^127(?:\.\d{1,3}){3}$/.test(address)
}

/** Same-origin guard for the page → Host state route. */
export function isLoopbackOrigin(origin) {
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return false
  try {
    const url = new URL(origin)
    const host = url.hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  } catch {
    return false
  }
}

/** Read a JSON request body with a hard size cap (state reports and settings saves). */
function readRequestBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    if (req.body !== undefined) {
      resolve(typeof req.body === 'string' ? req.body : JSON.stringify(req.body))
      return
    }
    if (typeof req.on !== 'function') {
      resolve('')
      return
    }
    let size = 0
    let failed = false
    const chunks = []
    req.on('data', (chunk) => {
      if (failed) return
      size += chunk?.length ?? String(chunk).length
      if (size > limit) {
        failed = true
        reject(new Error('request body is too large'))
        return
      }
      chunks.push(String(chunk))
    })
    req.on('end', () => {
      if (!failed) resolve(chunks.join(''))
    })
    req.on('error', (error) => {
      if (!failed) reject(error)
    })
  })
}

/**
 * One page state report: loopback-only, same-origin, JSON. The route is a
 * sibling of the SSE stream rather than a reconnect because focus and session
 * changes happen far more often than permission changes.
 */
export function createStateHandler({ channel, log = () => {} } = {}) {
  return (req, res) => {
    const address = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
    if (!isLoopbackAddress(address)) {
      if (typeof res.writeHead === 'function') res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.statusCode = 403
      if (typeof res.end === 'function') res.end('Forbidden')
      return
    }
    if (req.method !== 'POST') {
      if (typeof res.writeHead === 'function') res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', allow: 'POST' })
      else res.statusCode = 405
      if (typeof res.end === 'function') res.end('Method Not Allowed')
      return
    }
    const origin = req.headers?.origin
    if (typeof origin === 'string' && origin !== '' && !isLoopbackOrigin(origin)) {
      if (typeof res.writeHead === 'function') res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.statusCode = 403
      if (typeof res.end === 'function') res.end('Forbidden')
      return
    }
    readRequestBody(req).then(
      (text) => {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          if (typeof res.writeHead === 'function') res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' })
          else res.statusCode = 400
          if (typeof res.end === 'function') res.end('Bad Request')
          return
        }
        const updated = channel.updateClientState(parsed)
        if (!updated) log('debug', 'page state report arrived before its SSE stream; it was buffered')
        if (typeof res.writeHead === 'function') res.writeHead(204)
        else res.statusCode = 204
        if (typeof res.end === 'function') res.end()
      },
      (error) => {
        if (typeof res.writeHead === 'function') res.writeHead(413, { 'Content-Type': 'text/plain; charset=utf-8' })
        else res.statusCode = 413
        if (typeof res.end === 'function') res.end(`Payload Too Large: ${toMessage(error)}`)
      },
    )
  }
}

/** One SSE request: same-origin page, loopback only. */
export function createSseHandler({ channel, log = () => {} } = {}) {
  return (req, res) => {
    if (req.method !== 'GET') {
      if (typeof res.writeHead === 'function') res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', allow: 'GET' })
      else res.statusCode = 405
      if (typeof res.end === 'function') res.end('Method Not Allowed')
      return
    }
    const address = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
    if (!isLoopbackAddress(address)) {
      if (typeof res.writeHead === 'function') res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.statusCode = 403
      if (typeof res.end === 'function') res.end('Forbidden')
      return
    }
    let permission = 'default'
    let page = ''
    let clientId = ''
    let focused = false
    let activeSessionId = null
    try {
      const url = new URL(req.url ?? WEB_ROUTE, 'http://127.0.0.1')
      const reported = url.searchParams.get('permission')
      if (reported === 'granted' || reported === 'denied') permission = reported
      page = url.searchParams.get('page') ?? ''
      clientId = (url.searchParams.get('clientId') ?? '').slice(0, 128)
      focused = url.searchParams.get('focused') === '1'
      activeSessionId = normalizeSessionId(url.searchParams.get('sessionId'))
    } catch {
      /* keep defaults */
    }
    if (typeof res.writeHead === 'function') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
    } else {
      res.statusCode = 200
    }
    if (typeof res.write === 'function') res.write(': connected\n\n')
    const remove = channel.addClient(res, permission, { page, clientId, focused, activeSessionId })
    let removed = false
    const cleanup = () => {
      if (removed) return
      removed = true
      remove()
    }
    if (typeof req.on === 'function') req.on('close', cleanup)
    if (typeof res.on === 'function') {
      res.on('close', cleanup)
      res.on('error', cleanup)
    }
    log(
      'debug',
      `web client connected (client=${clientId || 'anonymous'}, permission=${permission}, focused=${focused}, session=${activeSessionId ?? '-'}, total=${channel.size()})`,
    )
  }
}

/**
 * Loopback-only diagnostic endpoint: what the Host believes about the channel.
 * The effective Config is read on every request so the report reflects settings
 * the page saved since the route was mounted (`getConfig` wins over the static
 * `config` snapshot).
 */
export function createStatusHandler({ channel, config, getConfig, clientModules, toast }) {
  const readConfig = typeof getConfig === 'function' ? getConfig : () => config
  return (req, res) => {
    const address = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
    if (!isLoopbackAddress(address)) {
      if (typeof res.writeHead === 'function') res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.statusCode = 403
      if (typeof res.end === 'function') res.end('Forbidden')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (typeof res.writeHead === 'function') res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' })
      else res.statusCode = 405
      if (typeof res.end === 'function') res.end('Method Not Allowed')
      return
    }
    let clientModule
    try {
      const graph = clientModules && typeof clientModules.graph === 'function' ? clientModules.graph() : undefined
      const entries = graph && Array.isArray(graph.entries) ? graph.entries : []
      const entry = entries.find((row) => row && row.id === PACKAGE_NAME)
      clientModule = {
        packageName: PACKAGE_NAME,
        entry: entry ? { id: entry.id, rev: entry.rev ?? null } : null,
        graphRev: graph ? graph.rev ?? null : null,
        entryCount: entries.length,
        clientPath: clientModules && typeof clientModules.clientPath === 'function' ? clientModules.clientPath(PACKAGE_NAME) ?? null : null,
      }
    } catch (error) {
      clientModule = { packageName: PACKAGE_NAME, error: toMessage(error) }
    }
    const effective = readConfig() ?? {}
    const effectiveToast = typeof toast === 'function' ? toast() : toast
    const body = JSON.stringify({
      webNotifications: effective.webNotifications,
      inAppNotifications: effective.inAppNotifications,
      suppressActiveSession: effective.suppressActiveSession,
      inAppToastDismiss: effectiveToast?.dismiss ?? effective.inAppToastDismiss,
      inAppHoldMs: effectiveToast?.holdMs ?? effective.inAppHoldMs,
      platform: process.platform,
      routes: { events: WEB_ROUTE, state: STATE_ROUTE, settings: SETTINGS_ROUTE },
      clients: typeof channel.describe === 'function' ? channel.describe() : [],
      clientModule,
    })
    if (typeof res.writeHead === 'function') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
    } else {
      res.statusCode = 200
    }
    if (typeof res.end === 'function') res.end(body)
  }
}

/** Write one JSON response in the plain-Node style the page routes use. */
function writeJson(res, status, value) {
  const body = JSON.stringify(value)
  if (typeof res.writeHead === 'function') {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  } else {
    res.statusCode = status
  }
  if (typeof res.end === 'function') res.end(body)
}

/**
 * Settings page ⇄ Host notification settings. GET reports the saved content
 * templates, the effective in-app toast behavior, the effective Config, the
 * plugin-Config defaults (`configDefaults`), and the preset catalog the page
 * renders. POST validates and durably saves the display, the toast behavior,
 * and/or the full plugin Config so the next notification and toast use them.
 * Loopback-only, and a cross-origin POST is refused like the state route.
 */
export function createSettingsHandler({ readSettings, writeSettings, getConfig, getConfigDefaults, toastDefaults, log = () => {} } = {}) {
  const read = typeof readSettings === 'function' ? readSettings : () => normalizeSettings()
  const write = typeof writeSettings === 'function' ? writeSettings : (value) => Promise.resolve(normalizeSettings(value))
  const readConfig = typeof getConfig === 'function' ? getConfig : () => normalizeConfig()
  const readConfigDefaults = typeof getConfigDefaults === 'function' ? getConfigDefaults : () => normalizeConfig()
  const defaults = resolveToast(toastDefaults ?? DEFAULT_TOAST)
  return (req, res) => {
    const address = req.socket?.remoteAddress ?? req.connection?.remoteAddress ?? ''
    if (!isLoopbackAddress(address)) {
      if (typeof res.writeHead === 'function') res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.statusCode = 403
      if (typeof res.end === 'function') res.end('Forbidden')
      return
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const current = normalizeSettings(read())
      const effectiveConfig = readConfig()
      writeJson(res, 200, {
        display: current.display,
        defaults: normalizeDisplay(DEFAULT_DISPLAY),
        presets: [...DISPLAY_PRESETS],
        appName: effectiveConfig?.appName ?? 'DSH',
        toast: resolveToast(current.toast, defaults),
        toastDefaults: defaults,
        config: effectiveConfig,
        configDefaults: readConfigDefaults(),
      })
      return
    }
    if (req.method !== 'POST') {
      if (typeof res.writeHead === 'function') res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', allow: 'GET, HEAD, POST' })
      else res.statusCode = 405
      if (typeof res.end === 'function') res.end('Method Not Allowed')
      return
    }
    const origin = req.headers?.origin
    if (typeof origin === 'string' && origin !== '' && !isLoopbackOrigin(origin)) {
      if (typeof res.writeHead === 'function') res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
      else res.statusCode = 403
      if (typeof res.end === 'function') res.end('Forbidden')
      return
    }
    readRequestBody(req, 8192).then(
      (text) => {
        let parsed
        try {
          parsed = JSON.parse(text)
        } catch {
          writeJson(res, 400, { error: 'expected a JSON body' })
          return
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          writeJson(res, 400, { error: 'expected a notification settings object' })
          return
        }
        const current = normalizeSettings(read())
        const hasDisplay = Object.prototype.hasOwnProperty.call(parsed, 'display')
        const hasToast = Object.prototype.hasOwnProperty.call(parsed, 'toast')
        const hasConfig = Object.prototype.hasOwnProperty.call(parsed, 'config')
        if (!hasDisplay && !hasToast && !hasConfig) {
          writeJson(res, 400, { error: 'expected a display, toast, or config object' })
          return
        }
        if (hasToast && (!parsed.toast || typeof parsed.toast !== 'object' || Array.isArray(parsed.toast))) {
          writeJson(res, 400, { error: 'expected a toast settings object' })
          return
        }
        if (hasConfig && (!parsed.config || typeof parsed.config !== 'object' || Array.isArray(parsed.config))) {
          writeJson(res, 400, { error: 'expected a config object' })
          return
        }
        const next = {
          display: hasDisplay ? normalizeDisplay(parsed.display) : current.display,
          // Fill the parts the caller omitted from the effective value, so a
          // mode-only save does not surprise-reset the saved duration.
          toast: hasToast
            ? resolveToast({ ...resolveToast(current.toast, defaults), ...parsed.toast })
            : current.toast,
          // A Config save patches the effective Config; an absent Config keeps
          // whatever was saved (including "nothing" as null).
          config: hasConfig
            ? normalizeConfig({ ...readConfig(), ...parsed.config })
            : current.config,
        }
        Promise.resolve(write(next)).then(
          (saved) => {
            const normalized = normalizeSettings(saved)
            const defaultsNow = readConfigDefaults()
            writeJson(res, 200, {
              display: normalized.display,
              toast: resolveToast(normalized.toast, defaults),
              config: normalizeConfig(normalized.config ? { ...defaultsNow, ...normalized.config } : defaultsNow),
            })
          },
          (error) => {
            log('warn', `notification settings write failed: ${toMessage(error)}`)
            writeJson(res, 500, { error: 'notification settings could not be saved' })
          },
        )
      },
      (error) => {
        writeJson(res, 413, { error: `Payload Too Large: ${toMessage(error)}` })
      },
    )
  }
}
