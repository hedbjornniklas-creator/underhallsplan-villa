import type { ContractDocumentReference } from './contractAssignment'
import type { CustomerOfferDraft } from './customerOffers'

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>
export type ContractDocumentDraft = {
  version: 1
  updatedAt: number
  base: ContractDocumentReference[]
  documents: ContractDocumentReference[]
}
const key = (caseId: string) => `gizmo:contract-documents:${caseId}:v1`
const maxAge = 24 * 60 * 60 * 1000
const comparable = (documents: ContractDocumentReference[]) => documents.map((doc) => ({
  fileId: doc.fileId, type: doc.type.trim(), name: doc.name.trim(), date: doc.date.trim(),
}))
export const sameContractDocuments = (a: ContractDocumentReference[], b: ContractDocumentReference[]) =>
  JSON.stringify(comparable(a)) === JSON.stringify(comparable(b))

export function contractDocumentsAcknowledged(submitted: CustomerOfferDraft, saved: CustomerOfferDraft, automaticId?: string) {
  const expected = submitted.contractDetails?.assignment
  const actual = saved.contractDetails?.assignment
  return !expected || Boolean(actual && sameContractDocuments(
    expected.documents.filter((doc) => doc.fileId !== automaticId),
    actual.documents.filter((doc) => doc.fileId !== automaticId)))
}

// Like OB's local text drafts, keep edits before debounce and clear only after acknowledgement.
// Tab-scoped storage avoids mixing parallel editors; only document metadata is retained.
export function writeContractDocumentDraft(storage: Storage, caseId: string,
  base: ContractDocumentReference[], documents: ContractDocumentReference[], now = Date.now()) {
  try {
    if (sameContractDocuments(base, documents)) storage.removeItem(key(caseId))
    else storage.setItem(key(caseId), JSON.stringify({ version: 1, updatedAt: now, base, documents }))
  } catch { /* Server autosave remains the source of truth if browser storage is unavailable. */ }
}

export function readContractDocumentDraft(storage: Storage, caseId: string, now = Date.now()): ContractDocumentDraft | null {
  try {
    const raw = storage.getItem(key(caseId))
    if (!raw) return null
    const value = JSON.parse(raw)
    const validDocuments = (documents: unknown): documents is ContractDocumentReference[] => {
      if (!Array.isArray(documents) || documents.length > 30) return false
      const ids = new Set<string>()
      return documents.every((doc) => {
        if (!doc || typeof doc !== 'object' ||
          typeof doc.fileId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(doc.fileId) || ids.has(doc.fileId) ||
          typeof doc.type !== 'string' || doc.type.length > 100 ||
          typeof doc.name !== 'string' || doc.name.length > 250 ||
          typeof doc.date !== 'string' || doc.date.length > 12) return false
        ids.add(doc.fileId)
        return true
      })
    }
    if (value.version !== 1 || !Number.isFinite(value.updatedAt) || value.updatedAt > now ||
      now - value.updatedAt > maxAge || !validDocuments(value.base) || !validDocuments(value.documents)) return null
    return { version: 1, updatedAt: value.updatedAt, base: value.base, documents: value.documents }
  } catch { return null }
}

export function contractDocumentDraftState(backup: ContractDocumentDraft, saved: ContractDocumentReference[], fileIds: string[]) {
  if (sameContractDocuments(backup.documents, saved)) return 'saved'
  if (!sameContractDocuments(backup.base, saved) || backup.documents.some((doc) => !fileIds.includes(doc.fileId))) return 'conflict'
  return 'restore'
}
