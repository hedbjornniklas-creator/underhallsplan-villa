import type { CustomerOfferDraft, CustomerOfferFile } from './customerOffers'

export type OfferDocumentMode = 'pdf' | 'reference'
export type OfferDocuments = { version: 1; modes: Record<string, OfferDocumentMode> }

export function normalizeOfferDocuments(value: unknown, attachmentIds: string[]): OfferDocuments | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  const input = value as Record<string, unknown>
  if (input.version !== 1 || !input.modes || typeof input.modes !== 'object' || Array.isArray(input.modes)) throw new Error('CUSTOMER_OFFER_INVALID')
  const modes: Record<string, OfferDocumentMode> = {}
  const entries = Object.entries(input.modes)
  if (entries.length > 30) throw new Error('CUSTOMER_OFFER_INVALID')
  for (const [id, mode] of entries) {
    if (!attachmentIds.includes(id) || !['pdf', 'reference'].includes(String(mode))) throw new Error('CUSTOMER_OFFER_INVALID')
    modes[id] = mode as OfferDocumentMode
  }
  return { version: 1, modes }
}

export function offerDocumentMode(draft: CustomerOfferDraft, fileId: string): OfferDocumentMode {
  return draft.offerDocuments?.modes[fileId] ?? 'reference'
}

export function selectedOfferDocuments(draft: CustomerOfferDraft, ids: string[], files: CustomerOfferFile[]): OfferDocuments {
  return { version: 1, modes: Object.fromEntries(ids.map(id => [id, draft.attachmentIds.includes(id)
    ? offerDocumentMode(draft, id) : files.find(file => file.id === id)?.contentType === 'application/pdf' ? 'pdf' : 'reference'])) }
}
