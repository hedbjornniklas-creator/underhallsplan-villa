const OB_TEXT_DRAFT_PREFIX = 'ob:text-draft:v1:'

export const getObTextDraftStorageKey = (draftKey?: string) =>
  draftKey ? `${OB_TEXT_DRAFT_PREFIX}${draftKey}` : null

export const getObTextDraftInspectionPrefix = (inspectionId: string) =>
  `${OB_TEXT_DRAFT_PREFIX}ob:${inspectionId}:`

export const hasObTextDraftsForInspection = (inspectionId?: string | null) => {
  if (!inspectionId || typeof window === 'undefined') return false

  const prefix = getObTextDraftInspectionPrefix(inspectionId)
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index)
    if (key?.startsWith(prefix)) return true
  }

  return false
}
