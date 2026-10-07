import type { CustomerOfferDraft, CustomerOfferFile } from './customerOffers'

export type ContractDocumentReference = {
  fileId: string
  type: string
  name: string
  date: string
}
export type ContractAssignment = {
  documents: ContractDocumentReference[]
  additionalScope: string
  exclusions: string
  documentNotes: string
}
export const assignmentDocumentsText = 'Avtalshandlingar anges i uppdragets handlingsförteckning.'

export function assignmentIssues(value: ContractAssignment): string[] {
  return value.documents.flatMap((doc, index) => {
    const missing = [!doc.type.trim() && 'typ', !doc.name.trim() && 'namn', !doc.date && 'datum'].filter(Boolean)
    return missing.length ? [`Komplettera handling ${index + 1}: ${missing.join(', ')}.`] : []
  })
}

export function normalizeAssignment(input: unknown): ContractAssignment {
  const invalid = (): never => { throw new Error('CUSTOMER_OFFER_INVALID') }
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) invalid()
    return v as Record<string, unknown>
  }
  const text = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max) invalid()
    return (v as string).trim()
  }
  const value = record(input)
  if (!Array.isArray(value.documents) || value.documents.length > 30) invalid()
  const seen = new Set<string>()
  const documents = (value.documents as unknown[]).map((v) => {
    const doc = record(v), fileId = text(doc.fileId, 36).toLowerCase(), date = text(doc.date, 10)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fileId) || seen.has(fileId)) invalid()
    seen.add(fileId)
    if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) invalid()
    return { fileId, type: text(doc.type, 100), name: text(doc.name, 250), date }
  })
  return { documents, additionalScope: text(value.additionalScope, 12000), exclusions: text(value.exclusions, 6000), documentNotes: text(value.documentNotes, 6000) }
}

export function assignmentForEditing(draft: CustomerOfferDraft, files: CustomerOfferFile[]): ContractAssignment {
  if (draft.contractDetails?.assignment) return draft.contractDetails.assignment
  return {
    documents: files.filter((f) => draft.attachmentIds.includes(f.id) && !f.contentType.startsWith('image/'))
      .map((f) => ({ fileId: f.id, type: '', name: f.fileName, date: '' })),
    additionalScope: '', exclusions: '', documentNotes: draft.contractDetails?.fields.documents.text ?? ''
  }
}

// Keep file selection and document references in one autosave operation.
export function assignmentPatch(draft: CustomerOfferDraft, assignment: ContractAssignment, previous = draft.contractDetails?.assignment): Partial<CustomerOfferDraft> {
  const previousIds = new Set(previous?.documents.map((d) => d.fileId) ?? [])
  const nextIds = new Set(assignment.documents.map((d) => d.fileId))
  return {
    contractDetails: draft.contractDetails ? { ...draft.contractDetails, assignment,
      fields: { ...draft.contractDetails.fields, documents: { status: assignmentIssues(assignment).length ? 'unreviewed' : 'specified', text: assignmentDocumentsText } }
    } : undefined,
    attachmentIds: [...new Set([...draft.attachmentIds.filter((id) => !previousIds.has(id) || nextIds.has(id)), ...nextIds])],
    termsAttachmentId: draft.termsAttachmentId && previousIds.has(draft.termsAttachmentId) && !nextIds.has(draft.termsAttachmentId) ? null : draft.termsAttachmentId
  }
}
