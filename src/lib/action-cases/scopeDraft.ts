import type { ActionCaseItemView, ActionCaseWorkspace } from './contracts'

export type ActionScopeDraft = {
  title: string
  scope: string
  scopeAttachmentIds: string[]
  scopeConditions?: string
  scopeExclusions?: string
  scopeAdvice?: string
}

export type ActionScopeSaveResult = {
  item: Pick<ActionCaseItemView, 'id' | 'title' | 'scope' | 'scopeAttachmentIds' | 'scopeConditions' | 'scopeExclusions' | 'scopeAdvice' | 'updatedAt' | 'status' | 'lumpSum' | 'ownLaborReady' | 'materialPriceReady' | 'subcontractorPriceReady' | 'wasteSolutionReady' | 'requiresSubcontractor'>
  caseStatus: 'quote_ready' | 'pricing'
}

export function actionScopeDraft(item: ActionCaseItemView, attachmentIds: string[] = item.scopeAttachmentIds ?? []): ActionScopeDraft {
  return {
    title: item.title, scope: item.scope ?? '', scopeAttachmentIds: attachmentIds,
    ...(item.scopeConditionsAvailable ? { scopeConditions: item.scopeConditions ?? '' } : {}),
    ...(item.scopeNotesAvailable ? { scopeExclusions: item.scopeExclusions ?? '', scopeAdvice: item.scopeAdvice ?? '' } : {}),
  }
}

export function scopeDraftFingerprint(draft: ActionScopeDraft) {
  return JSON.stringify({
    title: draft.title.trim(), scope: draft.scope.trim(),
    scopeAttachmentIds: [...new Set(draft.scopeAttachmentIds)].sort(),
    scopeConditions: draft.scopeConditions?.trim(),
    scopeExclusions: draft.scopeExclusions?.trim(), scopeAdvice: draft.scopeAdvice?.trim(),
  })
}

export function scopeSavePayload(input: Record<string, unknown>) {
  if (typeof input.itemId !== 'string' || !input.itemId || typeof input.expectedUpdatedAt !== 'string' || !input.expectedUpdatedAt) throw new Error('ACTION_CASE_ITEM_STALE')
  if (typeof input.title !== 'string' || !input.title.trim() || typeof input.scope !== 'string') throw new Error('ACTION_CASE_ITEM_REQUIRED')
  return {
    itemId: input.itemId, expectedUpdatedAt: input.expectedUpdatedAt,
    title: input.title, scope: input.scope, scopeAttachmentIds: input.scopeAttachmentIds,
    ...('scopeConditions' in input ? { scopeConditions: input.scopeConditions } : {}),
    ...('scopeExclusions' in input ? { scopeExclusions: input.scopeExclusions } : {}),
    ...('scopeAdvice' in input ? { scopeAdvice: input.scopeAdvice } : {}),
  }
}

export function mergeScopeSave(workspace: ActionCaseWorkspace, result: ActionScopeSaveResult): ActionCaseWorkspace {
  return { ...workspace, cases: workspace.cases.map((project) => project.items.some((item) => item.id === result.item.id) ? {
    ...project,
    status: ['preparing', 'pricing', 'quote_ready'].includes(project.status) ? result.caseStatus : project.status,
    items: project.items.map((item) => item.id === result.item.id ? { ...item, ...result.item } : item),
  } : project) }
}
