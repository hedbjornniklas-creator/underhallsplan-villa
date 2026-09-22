const OB_TEXT_DRAFT_PREFIX = 'ob:text-draft:v1:'

export const getObTextDraftStorageKey = (draftKey?: string) =>
  draftKey ? `${OB_TEXT_DRAFT_PREFIX}${draftKey}` : null

export const getObTextDraftInspectionPrefix = (inspectionId: string) =>
  `${OB_TEXT_DRAFT_PREFIX}ob:${inspectionId}:`

type ConfirmedNote = {
  id?: string
  note?: string | null
  risk_text?: string | null
  ftu_text?: string | null
}

// Moving/removing a note or room must not be blocked by another step's drafts.
// Scan every building scope so a draft made before a building move is protected too.
export function hasObTextDraftsForRoundTarget(
  inspectionId: string,
  target: { kind?: string; id?: string },
  notes: { id?: string; interior_room_id?: string | null }[],
  storage?: Storage,
) {
  if (target.kind === 'image') return false // Image deletion keeps the note and its text.
  if (!target.id || !['note', 'room'].includes(target.kind ?? '')) return true
  const noteIds = new Set(target.kind === 'note' ? [target.id] : notes
    .filter(note => note.interior_room_id === target.id && note.id)
    .map(note => note.id!))
  const prefix = getObTextDraftInspectionPrefix(inspectionId)
  try {
    storage ??= typeof window === 'undefined' ? undefined : window.localStorage
    if (!storage) return true
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)
      if (!key?.startsWith(prefix)) continue
      let path = key.slice(prefix.length).split(':')
      if (path[0] === 'building' && path[1]) path = path.slice(2)
      if (path[0] === 'mobile-round' && noteIds.has(path[1])) return true
      if (['runda', 'insida', 'utsida'].includes(path[0]) &&
        path[1] === 'control-item' && noteIds.has(path[2])) return true
      if (target.kind === 'room' && path[0] === 'runda' && path[1] === 'quick-note' &&
        path[2] === 'interior' && path[3] === target.id) return true
    }
    return false
  } catch {
    // If local storage cannot be read, do not assume a destructive action is safe.
    return true
  }
}

// Call only with a successful server read, never with optimistic editor state.
export function clearConfirmedObNoteDrafts(
  inspectionId: string,
  notes: ConfirmedNote[],
  scopeId = inspectionId,
  storage?: Storage,
) {
  try { storage ??= typeof window === 'undefined' ? undefined : window.localStorage } catch { return }
  if (!storage) return
  const fields = ['note', 'risk_text', 'ftu_text'] as const
  const clearMatching = (draftKey: string, matches: (draft: Record<string, unknown>) => boolean) => {
    try {
      const key = getObTextDraftStorageKey(draftKey)!
      const raw = storage.getItem(key)
      if (!raw) return
      const draft: unknown = JSON.parse(raw)
      if (draft && typeof draft === 'object' && !Array.isArray(draft) &&
        matches(draft as Record<string, unknown>) && storage.getItem(key) === raw) storage.removeItem(key)
    } catch { /* Retain unreadable or inaccessible drafts; never guess their contents. */ }
  }
  for (const note of notes) {
    if (!note.id) continue
    for (const scope of new Set([inspectionId, scopeId])) {
      clearMatching(`ob:${scope}:mobile-round:${note.id}`, draft =>
        fields.every(field => typeof draft[field] === 'string' && draft[field] === (note[field] ?? '')))
    }
    for (const step of ['runda', 'insida', 'utsida']) {
      for (const field of fields) {
        clearMatching(`ob:${inspectionId}:${step}:control-item:${note.id}:${field}`,
          draft => typeof draft.value === 'string' && draft.value === (note[field] ?? ''))
      }
    }
  }
}

export const hasObTextDraftsForInspection = (inspectionId?: string | null) => {
  if (!inspectionId || typeof window === 'undefined') return false

  const prefix = getObTextDraftInspectionPrefix(inspectionId)
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(prefix)) return true
  }

  return false
}
