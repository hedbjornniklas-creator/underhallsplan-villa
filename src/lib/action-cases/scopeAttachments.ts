import type { ActionCaseAttachmentView, ActionCaseItemView, ActionCaseView } from './contracts'

export const MAX_SCOPE_ATTACHMENTS = 50

export function parseScopeAttachmentIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_SCOPE_ATTACHMENTS || value.some((id) =>
    typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )) throw new Error('ACTION_CASE_SCOPE_ATTACHMENTS_INVALID')
  return [...new Set(value.map((id: string) => id.toLowerCase()))]
}

// Null is the legacy association; an explicit empty selection must stay empty.
export function scopeAttachmentIds(item: Pick<ActionCaseItemView, 'id' | 'scopeAttachmentIds'>, files: ActionCaseAttachmentView[]) {
  return item.scopeAttachmentIds ?? files.filter((file) => file.actionCaseItemId === item.id).map((file) => file.id)
}

export function quoteDocumentIds(actionCase: Pick<ActionCaseView, 'items' | 'quoteRequests'>) {
  return new Set([
    ...actionCase.items.flatMap((item) => item.costLines.flatMap((line) => (line.quotes ?? []).map((quote) => quote.documentId))),
    ...(actionCase.quoteRequests ?? []).map((request) => request.responseDocumentId),
  ].filter((id): id is string => Boolean(id)))
}

export function defaultRequestAttachments(items: ActionCaseItemView[], files: ActionCaseAttachmentView[], privateIds = new Set<string>()) {
  const eligible = new Set(files.filter((file) => !file.isQuoteDocument && !privateIds.has(file.id)).map((file) => file.id))
  return [...new Set(items.flatMap((item) => scopeAttachmentIds(item, files)))].filter((id) => eligible.has(id))
}

// Change only the automatic defaults. Manual additions and opt-outs survive work selection changes.
export function reconcileRequestAttachments(selected: string[], previousDefaults: string[], nextDefaults: string[], overrides: Record<string, boolean>) {
  const next = new Set(selected.filter((id) => !previousDefaults.includes(id) || nextDefaults.includes(id) || overrides[id] === true))
  for (const id of nextDefaults) if (overrides[id] !== false) next.add(id)
  return [...next]
}
