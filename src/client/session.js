// dsh-tada — which conversation is open in the app's main view.
//
// The page is the source of truth for "am I interrupting you?": the Host keeps
// the reported state per page and routes alerts from it. The Sessions service
// is optional, so every read degrades to "not viewing this conversation"
// rather than to a missed alert.

import { service } from './host.js'

/**
 * The conversation open in the main view, read the same way the app itself
 * decides it: the row retained by `mainView`. Falls back to `null` when the
 * sessions service is absent or shaped differently, which degrades to "not
 * viewing this conversation" rather than to a missed alert.
 */
export function readActiveSession(ctx) {
  try {
    const sessions = service(ctx, 'sessions')
    const list = sessions && sessions.list
    const snapshot = list && typeof list.getSnapshot === 'function' ? list.getSnapshot() : undefined
    const byId = snapshot && snapshot.byId
    if (!byId || typeof byId !== 'object') return null
    for (const row of Object.values(byId)) {
      if (!row || typeof row.id !== 'string') continue
      const retainedBy = row.retainedBy
      if (retainedBy && typeof retainedBy.mainView === 'number' && retainedBy.mainView > 0) return row.id
    }
  } catch {
    /* the sessions service is optional */
  }
  return null
}

/** Observe active-Session changes; the caller polls for late service arrival. */
export function watchActiveSession(ctx, onChange) {
  let unsubscribe = () => {}
  try {
    const sessions = service(ctx, 'sessions')
    const list = sessions && sessions.list
    if (list && typeof list.subscribe === 'function') {
      let last
      const emit = () => {
        const next = readActiveSession(ctx)
        if (next === last) return
        last = next
        onChange(next)
      }
      emit()
      const dispose = list.subscribe(emit)
      if (typeof dispose === 'function') unsubscribe = dispose
      return () => {
        try {
          unsubscribe()
        } catch {
          /* already released */
        }
      }
    }
  } catch {
    /* the sessions service is optional */
  }
  onChange(readActiveSession(ctx))
  return () => {}
}
