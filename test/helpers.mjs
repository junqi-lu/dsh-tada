import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TEXT, apply, createWebChannel } from '../index.js'

export const zh = TEXT.zh
// Neutral placeholder Session: fixtures must not point at a real machine or user.
export const rootSession = { id: 's1', header: { cwd: '/Users/example/code/dsh-tada' } }
export const childSession = { id: 's2', header: { cwd: '/tmp/work', origin: 'subagent' } }

export function fakeResponse() {
  return {
    chunks: [],
    statusCode: 0,
    headers: null,
    ended: false,
    writeHead(status, headers) {
      this.statusCode = status
      this.headers = headers
    },
    write(chunk) {
      this.chunks.push(String(chunk))
      return true
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(String(chunk))
      this.ended = true
    },
    on() {},
  }
}

export function fakeChannel(
  broadcastResult = 1,
  clients = [{ id: 'page-a', permission: 'granted', focused: false, activeSessionId: null, seenAt: 1 }],
) {
  const payloads = []
  return {
    payloads,
    snapshotClients() {
      return clients
    },
    broadcast(payload) {
      payloads.push(payload)
      return typeof broadcastResult === 'function' ? broadcastResult(payload) : broadcastResult
    },
  }
}

export function ssePayloads(response) {
  return response.chunks
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => JSON.parse(chunk.slice('data: '.length)))
}

export function routedChannel(clients) {
  const channel = createWebChannel()
  const responses = clients.map(() => fakeResponse())
  for (let index = 0; index < clients.length; index += 1) {
    channel.addClient(responses[index], clients[index].permission ?? 'default', clients[index])
  }
  return { channel, responses }
}

/**
 * Boot the real plugin against fake Host services to exercise its routes.
 * `services` overrides the optional Host services the plugin reads (session
 * titles, workspace registry, session store); absent ones stay unavailable.
 * The plugin reads its notification settings from `$DSH_HOME`, so each harness
 * gets a fresh temporary home (or `services.settingsHome` when a test needs to
 * seed the file before apply).
 */
export function pluginHarness(config, services = {}) {
  const previousHome = process.env.DSH_HOME
  const settingsHome = typeof services.settingsHome === 'string' && services.settingsHome !== ''
    ? services.settingsHome
    : mkdtempSync(join(tmpdir(), 'dsh-tada-harness-'))
  const ownsHome = settingsHome !== services.settingsHome
  process.env.DSH_HOME = settingsHome
  const handlers = new Map()
  const routes = new Map()
  const cleanups = []
  const ctx = {
    logger: { info() {}, warn() {}, debug() {}, error() {} },
    get(name) {
      if (name === 'webServer') {
        return {
          register(route) {
            routes.set(route.path, route.handler)
            return () => routes.delete(route.path)
          },
          getOrigin: () => 'http://127.0.0.1:53803',
        }
      }
      if (name === 'sessionTitle' && services.sessionTitle) return services.sessionTitle
      if (name === 'workspaceRegistry' && services.workspaceRegistry) return services.workspaceRegistry
      if (name === 'sessions' && services.sessions) return services.sessions
      return undefined
    },
    on(name, handler) {
      const list = handlers.get(name) ?? []
      list.push(handler)
      handlers.set(name, list)
      return () => {}
    },
    effect(callback) {
      const cleanup = callback()
      const entry = typeof cleanup === 'function' ? cleanup : undefined
      if (entry) cleanups.push(entry)
      let disposed = false
      return () => {
        if (disposed) return
        disposed = true
        if (!entry) return
        const index = cleanups.indexOf(entry)
        if (index >= 0) cleanups.splice(index, 1)
        entry()
      }
    },
    inject(_names, callback) {
      callback(ctx)
    },
  }
  apply(ctx, config)
  return {
    handlers,
    routes,
    settingsHome,
    dispose() {
      for (const cleanup of cleanups.splice(0)) cleanup()
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
      if (ownsHome) rmSync(settingsHome, { recursive: true, force: true })
    },
  }
}

/** Minimal browser page: enough DOM for the client half's in-app toast. */
export function createClientPageHarness() {
  const body = createFakeElement('body')
  let focused = true
  const state = {
    openedSessions: [],
    notifications: [],
    stateReports: [],
    sources: [],
    cleanups: [],
    activeSessionId: 'session-A',
  }

  function createFakeElement(tagName) {
    return {
      tagName,
      childNodes: [],
      parentNode: null,
      style: {},
      attributes: {},
      listeners: {},
      textContent: '',
      setAttribute(name, value) {
        this.attributes[name] = value
      },
      appendChild(child) {
        child.parentNode = this
        this.childNodes.push(child)
        return child
      },
      removeChild(child) {
        const index = this.childNodes.indexOf(child)
        if (index >= 0) this.childNodes.splice(index, 1)
        child.parentNode = null
      },
      remove() {
        if (this.parentNode) this.parentNode.removeChild(this)
      },
      addEventListener(type, listener) {
        ;(this.listeners[type] ??= []).push(listener)
      },
      dispatch(type) {
        for (const listener of this.listeners[type] ?? []) listener({ type })
      },
    }
  }

  const document = {
    body,
    visibilityState: 'visible',
    hasFocus: () => focused,
    addEventListener() {},
    removeEventListener() {},
    createElement(tagName) {
      return createFakeElement(tagName)
    },
  }

  class FakeEventSource {
    constructor(url) {
      this.url = url
      this.listeners = {}
      this.closed = false
      state.sources.push(this)
    }
    addEventListener(type, listener) {
      ;(this.listeners[type] ??= []).push(listener)
    }
    close() {
      this.closed = true
    }
    emit(payload) {
      for (const listener of this.listeners.message ?? []) listener({ data: JSON.stringify(payload) })
    }
  }

  class FakeNotification {
    static permission = 'granted'
    static requestPermission() {
      return Promise.resolve('granted')
    }
    constructor(title, options) {
      this.title = title
      this.options = options
      this.onclick = null
      state.notifications.push(this)
    }
    close() {}
  }

  const sessionsStore = {
    getSnapshot() {
      const byId = {}
      if (state.activeSessionId !== null) {
        byId[state.activeSessionId] = { id: state.activeSessionId, retainedBy: { mainView: 1 } }
      }
      return { byId }
    },
    subscribe() {
      return () => {}
    },
  }

  const ctx = {
    effect(callback) {
      const cleanup = callback()
      if (typeof cleanup === 'function') state.cleanups.push(cleanup)
    },
    get(name) {
      if (name === 'sessions') return { list: sessionsStore }
      if (name === 'uiWorkspace') {
        return {
          openSession(sessionId) {
            state.openedSessions.push(sessionId)
          },
        }
      }
      return undefined
    },
  }

  return {
    state,
    ctx,
    document,
    window: {
      addEventListener() {},
      removeEventListener() {},
      focus() {},
    },
    location: { protocol: 'dsh-app:', host: 'app' },
    EventSource: FakeEventSource,
    Notification: FakeNotification,
    fetch(url, init) {
      state.stateReports.push({ url, body: JSON.parse(init.body) })
      return Promise.resolve({ ok: true, status: 204 })
    },
    setFocused(value) {
      focused = value
    },
    toastElement() {
      return body.childNodes.find((node) => node.attributes['data-dsh-tada-toast'] !== undefined) ?? null
    },
    pushFrame(payload) {
      for (const source of state.sources) if (!source.closed) source.emit(payload)
    },
    dispose() {
      for (const cleanup of state.cleanups.splice(0)) cleanup()
    },
  }
}

/** Read the built client bundle (new build output path). */
export async function readClientBundle() {
  const { readFile } = await import('node:fs/promises')
  return readFile(new URL('../client/client.js', import.meta.url), 'utf8')
}
