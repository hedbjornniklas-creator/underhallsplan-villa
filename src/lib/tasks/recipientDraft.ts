export type TaskRecipientDraft = { comment: string; evidenceText: string }
export const EMPTY_RECIPIENT_DRAFT: TaskRecipientDraft = { comment: '', evidenceText: '' }
export const RECIPIENT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000
const PREFIX = 'hushub:task-recipient-draft:v1:'
type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function recipientDraftKey(scope: string) {
  return /^[a-f0-9]{64}$/.test(scope) ? `${PREFIX}${scope}` : null
}

export function readRecipientDraft(storage: DraftStorage, key: string, now = Date.now()): TaskRecipientDraft {
  const raw = storage.getItem(key)
  if (!raw) return { ...EMPTY_RECIPIENT_DRAFT }
  try {
    const value = JSON.parse(raw)
    if (value.schema !== 1 || !Number.isFinite(value.updatedAt) || now - value.updatedAt > RECIPIENT_DRAFT_TTL_MS
      || value.updatedAt > now || typeof value.comment !== 'string' || typeof value.evidenceText !== 'string'
      || value.comment.length > 100_000 || value.evidenceText.length > 100_000) throw Error('INVALID_DRAFT')
    return { comment: value.comment, evidenceText: value.evidenceText }
  } catch {
    storage.removeItem(key)
    return { ...EMPTY_RECIPIENT_DRAFT }
  }
}

export function writeRecipientDraft(storage: DraftStorage, key: string, draft: TaskRecipientDraft, now = Date.now()) {
  if (!draft.comment && !draft.evidenceText) storage.removeItem(key)
  else storage.setItem(key, JSON.stringify({ schema: 1, updatedAt: now, ...draft }))
}
