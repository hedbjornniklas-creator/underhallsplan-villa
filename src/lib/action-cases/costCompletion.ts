export function costCompletionPayload(input: Record<string, unknown>) {
  const id = (value: unknown) => {
    if (typeof value !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)) throw new Error('ACTION_CASE_COST_LINE_INVALID')
    return value.toLowerCase()
  }
  if (typeof input.complete !== 'boolean') throw new Error('ACTION_CASE_COST_LINE_INVALID')
  if (typeof input.expectedUpdatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(input.expectedUpdatedAt)
    || !Number.isFinite(Date.parse(input.expectedUpdatedAt))) throw new Error('ACTION_CASE_ITEM_STALE')
  return { caseId: id(input.caseId), itemId: id(input.itemId), costLineId: id(input.costLineId), complete: input.complete, expectedUpdatedAt: input.expectedUpdatedAt }
}
