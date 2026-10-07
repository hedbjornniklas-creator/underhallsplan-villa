import type { CustomerOfferDraft, CustomerOfferFile } from './customerOffers'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { assignmentForEditing, assignmentPatch } from './contractAssignment.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { emptyContractDetails } from './customerContract.ts'

export const ABS18_TERMS = {
  version: 'abs18-2018-06',
  fileName: 'ABS18_Allmanna_bestammelser_2018-06.pdf',
  name: 'Allmänna bestämmelser för småhusentreprenader – ABS 18 (2018.06)',
  type: 'Allmänna bestämmelser, ABS 18',
  date: '2018-06-13',
  sourceUrl: 'https://byggforetagen.se/app/uploads/2020/01/180613-_Allmanna_bestammelser_ABS_18-1.pdf',
  assetPath: 'public/abs18-2018-06.pdf',
  sha256: '7959e2511754ad839b32c0a7548783804218a54271bac1a29d16ff8094b309c3',
  size: 54872,
  reference: 'För entreprenaden gäller bifogade Allmänna bestämmelser för småhusentreprenader, ABS 18 (2018.06).',
} as const

// Standard terms are a real project attachment and use the existing version-copy flow.
export function withStandardContractTerms(draft: CustomerOfferDraft, file: CustomerOfferFile, files: CustomerOfferFile[] = []): CustomerOfferDraft {
  const value = assignmentForEditing(draft, files)
  if (draft.contractForm !== 'abs18') {
    if (!draft.attachmentIds.includes(file.id) && !value.documents.some((doc) => doc.fileId === file.id)) return draft
    const next = { ...value, documents: value.documents.filter((doc) => doc.fileId !== file.id) }
    return { ...draft, ...assignmentPatch(draft, next, value),
      attachmentIds: draft.attachmentIds.filter((id) => id !== file.id),
      termsAttachmentId: draft.termsAttachmentId === file.id ? null : draft.termsAttachmentId,
      terms: draft.terms === ABS18_TERMS.reference ? '' : draft.terms }
  }
  if (!draft.attachmentIds.includes(file.id) && draft.attachmentIds.length >= 30)
    throw new Error('CUSTOMER_OFFER_TERMS_LIMIT')
  const editable = { ...draft, contractDetails: draft.contractDetails ?? emptyContractDetails() }
  const documents = [{ fileId: file.id, type: ABS18_TERMS.type, name: ABS18_TERMS.name, date: ABS18_TERMS.date },
    ...value.documents.filter((doc) => doc.fileId !== file.id)]
  return { ...editable, ...assignmentPatch(editable, { ...value, documents }, value),
    termsAttachmentId: file.id, terms: draft.terms.trim() ? draft.terms : ABS18_TERMS.reference }
}
