/** Web GUI channel: connected pages, their focus/session state, and fan-out. */

function normalizePermission(value) {
  return value === 'granted' || value === 'denied' ? value : 'default'
}

export function normalizeSessionId(value, maxLength = 256) {
  return typeof value === 'string' && value !== '' ? value.slice(0, maxLength) : null
}

/**
 * Validate one page state report. Only fields the page actually sent are kept,
 * so the same helper serves both the initial SSE query and later POST updates.
 * @returns {null | { clientId: string, focused?: boolean, activeSessionId?: string | null, permission?: string, page?: string }}
 */
export function normalizeClientState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const clientId = typeof value.clientId === 'string' ? value.clientId.trim().slice(0, 128) : ''
  if (!clientId) return null
  const state = { clientId }
  if (typeof value.focused === 'boolean') state.focused = value.focused
  if (typeof value.permission === 'string') state.permission = normalizePermission(value.permission)
  if (value.activeSessionId === null) state.activeSessionId = null
  else if (typeof value.activeSessionId === 'string') state.activeSessionId = normalizeSessionId(value.activeSessionId)
  if (typeof value.page === 'string') state.page = value.page.slice(0, 120)
  return state
}

const MAX_CLIENTS = 32
const MAX_PENDING_STATES = 32

/**
 * Connected pages plus their live focus/conversation state.
 *
 * `broadcast(payload, recipients)` sends to the explicitly named client ids. A
 * page write that throws evicts the page, so a dead target cannot silently
 * swallow an alert.
 */
export function createWebChannel({ now = () => Date.now() } = {}) {
  const clients = new Set()
  const byId = new Map()
  /** States that arrived before their page's SSE stream registered. */
  const pending = new Map()
  let anonymous = 0

  const forget = (client) => {
    clients.delete(client)
    if (byId.get(client.id) === client) byId.delete(client.id)
  }

  const applyState = (client, state) => {
    if (typeof state.permission === 'string') client.permission = normalizePermission(state.permission)
    if (typeof state.focused === 'boolean') client.focused = state.focused
    if (state.activeSessionId !== undefined) client.activeSessionId = state.activeSessionId
    if (typeof state.page === 'string' && state.page !== '') client.page = state.page.slice(0, 120)
    client.seenAt = now()
  }

  const createClient = (res, permission, info = {}) => {
    const requestedId = typeof info.clientId === 'string' ? info.clientId.trim().slice(0, 128) : ''
    const id = requestedId || `anon-${++anonymous}`
    const focused = info.focused === true
    return {
      id,
      res,
      permission: normalizePermission(permission),
      page: typeof info.page === 'string' ? info.page.slice(0, 120) : '',
      focused,
      activeSessionId: normalizeSessionId(info.activeSessionId),
      seenAt: Number.isFinite(info.seenAt) ? info.seenAt : now(),
    }
  }

  const snapshotClient = (client) => ({
    id: client.id,
    permission: client.permission,
    page: client.page,
    focused: client.focused,
    activeSessionId: client.activeSessionId,
    seenAt: client.seenAt,
  })

  return {
    addClient(res, permission = 'default', info = {}) {
      const client = createClient(res, permission, info)
      const existing = byId.get(client.id)
      if (existing !== undefined) {
        forget(existing)
        try {
          existing.res.end()
        } catch {
          /* already closed */
        }
      }
      const stored = pending.get(client.id)
      if (stored !== undefined) {
        pending.delete(client.id)
        applyState(client, stored)
      }
      while (clients.size >= MAX_CLIENTS) {
        const oldest = clients.values().next().value
        if (oldest === undefined) break
        forget(oldest)
        try {
          oldest.res.end()
        } catch {
          /* already closed */
        }
      }
      clients.add(client)
      byId.set(client.id, client)
      return () => forget(client)
    },
    /**
     * Merge one state report. A report for a page whose SSE stream has not
     * arrived yet is remembered and applied on registration (the page can POST
     * before its EventSource finishes connecting).
     * @returns {boolean} whether a connected page received the update
     */
    updateClientState(state) {
      const normalized = normalizeClientState(state)
      if (normalized === null) return false
      const client = byId.get(normalized.clientId)
      if (client === undefined) {
        pending.set(normalized.clientId, normalized)
        while (pending.size > MAX_PENDING_STATES) {
          const oldest = pending.keys().next().value
          if (oldest === undefined) break
          pending.delete(oldest)
        }
        return false
      }
      applyState(client, normalized)
      return true
    },
    /** Plain descriptors for delivery planning (never the underlying socket). */
    snapshotClients() {
      return Array.from(clients, snapshotClient)
    },
    /** Diagnostic snapshot for the loopback status route. */
    describe() {
      return this.snapshotClients()
    },
    size() {
      return clients.size
    },
    /**
     * @param {object} payload
     * @param {string[]} recipients explicit page ids
     * @returns how many pages accepted the payload
     */
    broadcast(payload, recipients) {
      const frame = `data: ${JSON.stringify(payload)}\n\n`
      const wanted = new Set(Array.isArray(recipients) ? recipients : [])
      let delivered = 0
      for (const client of Array.from(clients)) {
        if (!wanted.has(client.id)) continue
        try {
          client.res.write(frame)
          delivered += 1
        } catch {
          forget(client)
        }
      }
      return delivered
    },
    heartbeat() {
      for (const client of Array.from(clients)) {
        try {
          client.res.write(': ping\n\n')
        } catch {
          forget(client)
        }
      }
    },
    closeAll() {
      for (const client of Array.from(clients)) {
        forget(client)
        try {
          client.res.end()
        } catch {
          /* already closed */
        }
      }
      pending.clear()
    },
  }
}
