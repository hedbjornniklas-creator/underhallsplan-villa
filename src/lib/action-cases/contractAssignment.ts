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
  standardConditions?: { version: 'abs18-2018-06'; text: string }
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
  const result: ContractAssignment = { documents, additionalScope: text(value.additionalScope, 12000), exclusions: text(value.exclusions, 6000), documentNotes: text(value.documentNotes, 6000) }
  if (value.standardConditions !== undefined) {
    const conditions = record(value.standardConditions)
    if (conditions.version !== 'abs18-2018-06') invalid()
    result.standardConditions = { version: 'abs18-2018-06', text: text(conditions.text, 6000) }
  }
  return result
}

export function assignmentForEditing(draft: CustomerOfferDraft, files: CustomerOfferFile[]): ContractAssignment {
  const value = draft.contractDetails?.assignment ?? {
    documents: [],
    additionalScope: '', exclusions: '', documentNotes: draft.contractDetails?.fields.documents.text ?? ''
  }
  const referenced = new Set(value.documents.map((doc) => doc.fileId))
  const additional = draft.attachmentIds.filter((id) => !referenced.has(id)).map((fileId) => ({
    fileId, type: '', name: files.find((file) => file.id === fileId)?.fileName ?? '', date: ''
  }))
  return additional.length ? { ...value, documents: [...value.documents, ...additional] } : value
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
