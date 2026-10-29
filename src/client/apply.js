// dsh-tada — client half: reporting page state and presenting alerts.
//
// Activation must never throw: a failing plugin entry aborts the whole Web
// boot audit, so failures inside the effect are caught and logged instead of
// escaping the bundle.

import { EVENTS_ROUTE, STATE_ROUTE } from './config.js'
import { createClientId, isPageFocused, pageLabel, permission, requestPermission } from './host.js'
import { present } from './present.js'
import { readActiveSession, watchActiveSession } from './session.js'
import { registerSettingsSection } from './settings.js'
import { createToastPresenter } from './toast.js'

export function apply(ctx) {
  try {
    ctx.effect(() => {
      if (typeof window === 'undefined') return () => {}
      let stopped = false
      let source = null
      let reconnectTimer = null
      let permissionTimer = null
      let reportTimer = null
      let lastPermission = permission()
      let lastReported = ''

      const clientId = createClientId()
      let activeSessionId = readActiveSession(ctx)
      let focused = isPageFocused()
      const toast = createToastPresenter(ctx)
      const disposeSettings = registerSettingsSection(ctx)

      function reportPermission() {
        const current = permission()
        return current === 'granted' || current === 'denied' ? current : 'default'
      }

      function reportState(force = false) {
        if (stopped) return
        const snapshot = {
          clientId,
          focused,
          activeSessionId,
          permission: reportPermission(),
          page: pageLabel(),
        }
        let serialized
        try {
          serialized = JSON.stringify(snapshot)
        } catch {
          return
        }
        if (!force && serialized === lastReported) return
        lastReported = serialized
        try {
          if (typeof fetch !== 'function') return
          const pending = fetch(STATE_ROUTE, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: serialized,
            keepalive: true,
          })
          if (pending && typeof pending.catch === 'function') pending.catch(() => {})
        } catch {
          /* state reporting is best effort */
        }
      }

      function scheduleReport() {
        if (stopped || reportTimer !== null) return
        reportTimer = setTimeout(() => {
          reportTimer = null
          reportState()
        }, 40)
      }

      function refreshActiveSession() {
        const next = readActiveSession(ctx)
        if (next === activeSessionId) return
        activeSessionId = next
        scheduleReport()
      }

      function scheduleReconnect() {
        if (stopped || reconnectTimer !== null) return
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null
          connect()
        }, 3000)
      }

      function disconnect() {
        if (source) {
          try {
            source.close()
          } catch {
            /* already closed */
          }
          source = null
        }
      }

      function connect() {
        if (stopped || typeof EventSource === 'undefined') return
        lastPermission = permission()
        const query = new URLSearchParams()
        query.set('permission', reportPermission())
        query.set('page', pageLabel())
        query.set('clientId', clientId)
        query.set('focused', focused ? '1' : '0')
        if (activeSessionId) query.set('sessionId', activeSessionId)
        let next
        try {
          next = new EventSource(`${EVENTS_ROUTE}?${query.toString()}`)
        } catch {
          scheduleReconnect()
          return
        }
        source = next
        next.addEventListener('message', (event) => {
          if (stopped) return
          let payload
          try {
            payload = JSON.parse(event.data)
          } catch {
            return
          }
          present(ctx, toast, payload)
        })
        next.addEventListener('error', () => {
          if (stopped) return
          disconnect()
          scheduleReconnect()
        })
        reportState(true)
      }

      // Electron grants notifications without a prompt; browsers require a
      // user gesture, so fall back to requesting on the first interaction.
      function ensurePermission() {
        if (permission() !== 'default') return
        requestPermission().then(() => {
          if (stopped) return
          if (permission() !== lastPermission) {
            lastPermission = permission()
            reportState()
          }
        })
      }

      function onGesture() {
        ensurePermission()
      }

      function onFocus() {
        focused = true
        scheduleReport()
        refreshActiveSession()
      }

      function onBlur() {
        focused = isPageFocused()
        scheduleReport()
      }

      function onVisibility() {
        focused = isPageFocused()
        refreshActiveSession()
        scheduleReport()
      }

      window.addEventListener('focus', onFocus)
      window.addEventListener('blur', onBlur)
      window.addEventListener('pointerdown', onGesture, true)
      window.addEventListener('keydown', onGesture, true)
      window.addEventListener('pageshow', onVisibility)
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        document.addEventListener('visibilitychange', onVisibility)
      }
      const unwatchSessions = watchActiveSession(ctx, (next) => {
        if (next === activeSessionId) return
        activeSessionId = next
        scheduleReport()
      })
      if (lastPermission === 'default') ensurePermission()
      connect()

      // Poll the state the page has no reliable event for: permission can
      // change outside the page (OS or browser settings), and the refresh
      // picks up a sessions service that mounted after activation.
      permissionTimer = setInterval(() => {
        if (stopped) return
        const current = permission()
        if (current !== lastPermission) {
          lastPermission = current
          if (current === 'default') ensurePermission()
          reportState(true)
        }
        refreshActiveSession()
      }, 4000)

      return () => {
        stopped = true
        if (permissionTimer !== null) clearInterval(permissionTimer)
        if (reconnectTimer !== null) clearTimeout(reconnectTimer)
        if (reportTimer !== null) clearTimeout(reportTimer)
        try {
          unwatchSessions()
        } catch {
          /* already released */
        }
        disconnect()
        toast.dispose()
        try {
          disposeSettings()
        } catch {
          /* already released */
        }
        window.removeEventListener('focus', onFocus)
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('pointerdown', onGesture, true)
        window.removeEventListener('keydown', onGesture, true)
        window.removeEventListener('pageshow', onVisibility)
        if (typeof document !== 'undefined' && typeof document.removeEventListener === 'function') {
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }
    })
  } catch (error) {
    try {
      console.error('[dsh-tada] client initialization failed:', error)
    } catch {
      /* logging is best effort */
    }
  }
}
