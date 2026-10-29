/** The Cordis plugin: event wiring and route mounting. */

import { createWebChannel } from './channel.js'
import { normalizeConfig } from './config.js'
import { decideApprovalNotification, decideGoalNotification, decideQuestionNotification, decideSubagentEndNotification, decideTurnNotification, decideWorkflowEndNotification } from './decisions.js'
import { deliverNotification } from './delivery.js'
import { shapeNotification } from './display.js'
import { displayFilePath, loadSettings, saveSettings } from './display-store.js'
import { VENDOR } from './package.js'
import { SETTINGS_ROUTE, STATE_ROUTE, STATUS_ROUTE, WEB_ROUTE, createSettingsHandler, createSseHandler, createStateHandler, createStatusHandler } from './routes.js'
import { TEXT, messageText, resolveLanguage, toMessage } from './text.js'
import { resolveToast } from './toast-settings.js'

/** Effective Config: plugin-Config defaults, then the overrides saved by the GUI. */
function effectiveConfig(defaults, saved) {
  return normalizeConfig(saved.config ? { ...defaults, ...saved.config } : defaults)
}

/** Register the page routes once the web server service is available. */
function mountWebChannel(ctx, channel, log, settings) {
  let mounted = false
  const mount = (serviceCtx) => {
    if (mounted) return
    const webServer = typeof serviceCtx.get === 'function' ? serviceCtx.get('webServer') : undefined
    if (!webServer || typeof webServer.register !== 'function') return
    mounted = true
    const sseHandler = createSseHandler({ channel, log })
    const stateHandler = createStateHandler({ channel, log })
    const clientModules = typeof serviceCtx.get === 'function' ? serviceCtx.get('clientModules') : undefined
    const statusHandler = createStatusHandler({ channel, getConfig: settings.getConfig, clientModules, toast: settings.getToast })
    const settingsHandler = createSettingsHandler({
      readSettings: settings.read,
      writeSettings: settings.write,
      getConfig: settings.getConfig,
      getConfigDefaults: settings.getConfigDefaults,
      toastDefaults: settings.toastDefaults,
      log,
    })
    // Every route stays mounted. The `webNotifications` switch gates delivery,
    // not the page-facing settings/diagnostics surface, and the page must be
    // able to turn delivery back on without a plugin restart.
    const register = () => {
      const disposers = [
        webServer.register({ kind: 'exact', path: SETTINGS_ROUTE, handler: settingsHandler }),
        webServer.register({ kind: 'exact', path: WEB_ROUTE, handler: sseHandler }),
        webServer.register({ kind: 'exact', path: STATE_ROUTE, handler: stateHandler }),
        webServer.register({ kind: 'exact', path: STATUS_ROUTE, handler: statusHandler }),
      ]
      const timer = setInterval(() => channel.heartbeat(), 20000)
      if (typeof timer.unref === 'function') timer.unref()
      return () => {
        clearInterval(timer)
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* already removed */
          }
        }
        channel.closeAll()
      }
    }
    if (typeof serviceCtx.effect === 'function') serviceCtx.effect(register)
    else register()
    log('info', `web channel mounted at ${WEB_ROUTE} (state reports at ${STATE_ROUTE}, settings at ${SETTINGS_ROUTE})`)
  }
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined
  if (webServer) mount(ctx)
  else if (typeof ctx.inject === 'function') ctx.inject(['webServer'], (injected) => mount(injected))
  else log('warn', 'web server service is unavailable; the Web notification channel is disabled')
}

function pruneMap(map, maxSize) {
  if (map.size <= maxSize) return
  const excess = map.size - maxSize
  let removed = 0
  for (const key of map.keys()) {
    map.delete(key)
    if (++removed >= excess) break
  }
}

export function apply(ctx, rawConfig) {
  const pluginDefaults = normalizeConfig(rawConfig)
  const channel = createWebChannel()
  const previewBySession = new Map()
  const lastNotifyAt = new Map()
  const settingsPath = displayFilePath()
  let savedSettings = loadSettings(settingsPath)
  // The GUI-persisted settings win over the plugin Config defaults.
  let config = effectiveConfig(pluginDefaults, savedSettings)
  let language = resolveLanguage(config.language)
  let text = TEXT[language]
  let display = savedSettings.display
  const toastDefaults = resolveToast({ dismiss: pluginDefaults.inAppToastDismiss, holdMs: pluginDefaults.inAppHoldMs })
  const currentToast = () => resolveToast(savedSettings.toast, toastDefaults)

  const log = (level, message) => {
    const logger = ctx.logger
    const method = logger && typeof logger[level] === 'function' ? logger[level] : undefined
    try {
      if (method) method.call(logger, `[${VENDOR}] ${message}`)
      else if (level === 'warn') console.warn(`[${VENDOR}] ${message}`)
    } catch {
      /* logging must never break notifications */
    }
  }

  // Session title (renameable in DSH) and Workspace title (renameable project)
  // are label fields the display settings can include. Both services are
  // optional: without them a field is simply empty, never an error.
  const liveSession = (sessionId) => {
    try {
      const sessions = ctx.get('sessions')
      return sessions && typeof sessions.get === 'function' ? sessions.get(sessionId) : undefined
    } catch {
      return undefined
    }
  }
  const sessionTitleOf = (session) => {
    try {
      const titles = ctx.get('sessionTitle')
      const snapshot = titles && typeof titles.get === 'function' ? titles.get(session) : undefined
      return typeof snapshot?.title === 'string' ? snapshot.title : ''
    } catch {
      return ''
    }
  }
  const workspaceTitleOf = (sessionId) => {
    if (typeof sessionId !== 'string' || sessionId === '') return ''
    try {
      const registry = ctx.get('workspaceRegistry')
      const workspaces = registry && typeof registry.list === 'function' ? registry.list() : []
      for (const workspace of workspaces) {
        const ids = workspace?.sessionIds
        if (Array.isArray(ids) && ids.includes(sessionId)) {
          return typeof workspace.title === 'string' ? workspace.title : ''
        }
      }
      return ''
    } catch {
      return ''
    }
  }
  const labelsFor = (sessionId, session) => {
    const live = session ?? (typeof sessionId === 'string' && sessionId !== '' ? liveSession(sessionId) : undefined)
    return {
      sessionTitle: live ? sessionTitleOf(live) : '',
      workspaceTitle: workspaceTitleOf(sessionId),
    }
  }

  const send = (notification, options = {}) => {
    if (!config.enabled || !notification) return
    if (options.throttle === true && options.sessionId !== undefined) {
      const now = Date.now()
      const previous = lastNotifyAt.get(options.sessionId) ?? 0
      if (now - previous < config.minIntervalMs) return
      lastNotifyAt.set(options.sessionId, now)
      pruneMap(lastNotifyAt, 512)
    }
    const toast = currentToast()
    void deliverNotification(shapeNotification(notification, display, config), {
      config,
      channel: config.webNotifications ? channel : undefined,
      force: options.force === true,
      sessionId: options.sessionId,
      actionLabel: text.openAction,
      dismissLabel: text.dismissAction,
      dismiss: toast.dismiss,
      holdMs: toast.holdMs,
    })
      .then((outcome) => {
        if (
          !outcome.delivered &&
          outcome.backend !== 'quiet-hours' &&
          outcome.backend !== 'disabled' &&
          outcome.backend !== 'suppressed'
        ) {
          log('warn', `notification not delivered: ${outcome.reason ?? outcome.backend}`)
        }
      })
      .catch((error) => log('warn', `notification failed: ${toMessage(error)}`))
  }

  const guarded = (label, handler) => (...args) => {
    try {
      handler(...args)
    } catch (error) {
      log('warn', `${label} handler failed: ${toMessage(error)}`)
    }
  }

  // Turn completion / failure / interruption. `session/event` is the durable
  // append feed: it also carries the assistant text we preview in the body.
  ctx.on('session/event', guarded('session/event', (session, event) => {
    if (!config.enabled || !session || !event) return
    const sessionId = session.id

    if (event.type === 'assistant/message') {
      if (!config.includePreview || sessionId === undefined) return
      const preview = messageText(event.data?.message)
      if (!preview) return
      previewBySession.set(sessionId, preview)
      pruneMap(previewBySession, 256)
      return
    }

    if (event.type !== 'turn/end') return
    const preview = sessionId === undefined ? '' : previewBySession.get(sessionId) ?? ''
    if (sessionId !== undefined) previewBySession.delete(sessionId)
    const notification = decideTurnNotification(session, event.data?.reason, preview, config, text, labelsFor(sessionId, session))
    if (!notification) return
    send(notification, { sessionId, throttle: true })
  }))

  // Approvals block the Agent: notify immediately, then delegate downstream.
  ctx.on('approval/request', (request, next) => {
    try {
      const notification = decideApprovalNotification(request, config, text, language, labelsFor(request.agent?.id))
      if (notification) send(notification, { force: true, sessionId: request.agent?.id })
    } catch (error) {
      log('warn', `approval notification failed: ${toMessage(error)}`)
    }
    return next()
  })

  // Agent questions also block the turn; same contract as approvals.
  ctx.on('user-questions/request', (request, next) => {
    try {
      const notification = decideQuestionNotification(request, config, text, labelsFor(request.agent?.id))
      if (notification) send(notification, { force: true, sessionId: request.agent?.id })
    } catch (error) {
      log('warn', `question notification failed: ${toMessage(error)}`)
    }
    return next()
  })

  ctx.on('subagent/end', guarded('subagent/end', (info) => {
    const notification = decideSubagentEndNotification(info, config, text, labelsFor(info?.id))
    if (notification) send(notification, { force: true, sessionId: info?.id })
  }))

  ctx.on('workflow/end', guarded('workflow/end', (info, result) => {
    const notification = decideWorkflowEndNotification(info, result, config, text, labelsFor(undefined))
    if (notification) send(notification, { force: true })
  }))

  ctx.on('goal/changed', guarded('goal/changed', (payload) => {
    const notification = decideGoalNotification(payload, config, text, labelsFor(payload.agent?.id))
    if (notification) send(notification, { force: true, sessionId: payload.agent?.id })
  }))

  // Apply a saved settings document: display, effective Config, and language
  // copy all follow the GUI immediately.
  const applySavedSettings = (saved) => {
    savedSettings = saved
    display = saved.display
    config = effectiveConfig(pluginDefaults, saved)
    language = resolveLanguage(config.language)
    text = TEXT[language]
  }

  // Browser-visible delivery: the Desktop app owns the resulting notification.
  // Every page route stays mounted; the `webNotifications` switch only gates
  // delivery, so the Settings page can always turn it back on.
  mountWebChannel(ctx, channel, log, {
    read: () => savedSettings,
    getToast: currentToast,
    getConfig: () => config,
    getConfigDefaults: () => pluginDefaults,
    write: async (value) => {
      const saved = await saveSettings(value, settingsPath)
      applySavedSettings(saved)
      const toast = currentToast()
      log(
        'info',
        `notification settings saved (language=${language}, appName=${config.appName}, title=${saved.display.title}, body=${saved.display.body}, toast=${toast.dismiss}/${toast.holdMs}ms, events=${Number(config.notifyOnTurnEnd)}/${Number(config.notifyOnError)}/${Number(config.notifyOnApproval)}/${Number(config.notifyOnQuestion)}, web=${Number(config.webNotifications)})`,
      )
      return saved
    },
    toastDefaults,
  })

  // Dispose: close SSE clients and drop routing state.
  ctx.effect(() => () => {
    channel.closeAll()
    previewBySession.clear()
    lastNotifyAt.clear()
  })

  const toast = currentToast()
  log('info', `plugin active (language=${language}, webClients=${channel.size()}, webNotifications=${config.webNotifications}, inApp=${config.inAppNotifications}, suppressActive=${config.suppressActiveSession}, quietHours=${config.quietHours || 'off'}, display=${display.title}/${display.body}, toast=${toast.dismiss}/${toast.holdMs}ms)`)
}
