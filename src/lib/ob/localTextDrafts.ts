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
