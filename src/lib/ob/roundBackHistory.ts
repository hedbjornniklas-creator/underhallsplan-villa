const HISTORY_KEY = '__obRoundBack'
const managed = new Map<symbol, string>()

export function isObRoundBackManaged(inspectionId: string) {
  return Array.from(managed.values()).includes(inspectionId)
}

function marker(state: unknown): { inspectionId: string; owner: string } | undefined {
  if (!state || typeof state !== 'object') return
  const value = (state as Record<string, unknown>)[HISTORY_KEY]
  if (!value || typeof value !== 'object') return
  const row = value as Record<string, unknown>
  if (typeof row.inspectionId === 'string' && typeof row.owner === 'string') {
    return { inspectionId: row.inspectionId, owner: row.owner }
  }
}

// One same-URL boundary for the whole round, not one entry per room or swipe.
export function createRoundBackHistory(inspectionId: string, onBack: () => void) {
  const url = window.location.href
  const registration = Symbol(inspectionId)
  const previous = marker(window.history.state)
  let owner = previous?.inspectionId === inspectionId ? previous.owner : crypto.randomUUID()
  let owned = previous?.inspectionId === inspectionId
  let enabled = false
  let removing = false
  let disposed = false

  function detach() {
    managed.delete(registration)
    window.removeEventListener('popstate', pop, true)
  }

  function push() {
    if (disposed || removing || window.location.href !== url) return
    managed.set(registration, inspectionId)
    if (owned) return
    window.history.pushState({
      ...window.history.state,
      [HISTORY_KEY]: { inspectionId, owner },
    }, '', url)
    owned = true
  }

  function remove() {
    if (removing) return
    if (owned && window.location.href === url && marker(window.history.state)?.owner === owner) {
      removing = true
      window.history.back()
    } else {
      owned = false
      managed.delete(registration)
      if (disposed) detach()
    }
  }

  function pop(event: PopStateEvent) {
    if (window.location.href !== url) {
      owned = false
      managed.delete(registration)
      if (disposed) detach()
      return
    }
    const destination = marker(event.state)
    if (destination?.inspectionId === inspectionId) {
      // A reload can reuse its boundary; forward into a retired boundary is skipped.
      event.stopImmediatePropagation()
      owner = destination.owner
      owned = true
      if (!enabled || disposed) remove()
      return
    }
    if (!owned) return
    event.stopImmediatePropagation()
    owned = false
    managed.delete(registration)
    if (removing || disposed) {
      removing = false
      if (disposed) detach()
      else if (enabled) push()
      return
    }
    if (enabled) {
      // Restore before closing: a pending/failed save must keep the next Back local too.
      push()
      onBack()
    }
  }

  window.addEventListener('popstate', pop, true)
  return {
    sync(canGoBack: boolean) {
      enabled = canGoBack
      if (enabled) push()
      else remove()
    },
    dispose() {
      disposed = true
      enabled = false
      remove()
    },
  }
}
