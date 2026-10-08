import type { CustomerOfferDraft, CustomerOfferFile } from './customerOffers'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { assignmentForEditing, assignmentPatch } from './contractAssignment.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { editedContractEntry, emptyContractDetails } from './customerContract.ts'

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

// Entreprenadkontrakt ABS 18, 2018.06, page 2. Separate from the general-terms PDF.
export const ABS18_ASSIGNMENT_CONDITIONS = {
  version: 'abs18-2018-06',
  sourceUrl: 'https://byggtjanstcms.byggtjanst.se/globalassets/pdf/entreprenadkontrakt-abs-18.pdf',
  text: 'I entreprenörens åtagande ingår inte heller – om inte annat framgår av ovanstående handlingar – att ombesörja och betala sådant som ankommer på beställaren som byggherre, exempelvis anskaffning av tomt, fastighetsbildning, grundundersökning, utsättningar, lagfart och inskrivningar, bygganmälan, lov och tillstånd, lån och bankavgifter eller andra kostnader för finansieringen samt besiktningar som sker med stöd av författning.\n\nBeställaren betalar statliga och kommunala avgifter inklusive anslutningsavgifter.',
} as const

// Editable summary of the contract form's page-3 clause, not a replacement for the original terms.
export const ABS18_WORK_ENVIRONMENT = {
  version: 'abs18-2018-06',
  sourceUrl: ABS18_ASSIGNMENT_CONDITIONS.sourceUrl,
  text: 'Arbetsmiljöansvaret ligger normalt på entreprenören under genomförandet. I det ingår att hålla arbetsmiljöplanen aktuell och att utse en lämplig BAS-U samt, när det behövs, BAS-P för planerings- och projekteringsskedet.\n\nHar beställaren avtal med flera entreprenörer för arbeten på den berörda fastigheten ligger detta ansvar i stället på beställaren. Namn och kontaktuppgifter för utsedda byggarbetsmiljösamordnare anges av beställaren under Övrigt.',
} as const

// Only use when editing an unsigned contract, never to render a historical snapshot.
export function withAbs18ContractDefaults(draft: CustomerOfferDraft): CustomerOfferDraft {
  const next = withAbs18AssignmentConditions(draft)
  const details = next.contractDetails
  if (next.contractForm !== 'abs18' || !details || details.workEnvironmentDefaultVersion) return next
  const entry = details.fields.workEnvironment
  // Mark initialization even when preserving existing text, so clearing a field stays intentional.
  return { ...next, contractDetails: { ...details,
    workEnvironmentDefaultVersion: ABS18_WORK_ENVIRONMENT.version,
    fields: entry.status === 'unreviewed' && !entry.text.trim()
      ? { ...details.fields, workEnvironment: editedContractEntry(ABS18_WORK_ENVIRONMENT.text) }
      : details.fields } }
}

// Only use when editing an unsigned contract, never to render a historical snapshot.
export function withAbs18AssignmentConditions(draft: CustomerOfferDraft): CustomerOfferDraft {
  if (!draft.contractDetails) return draft
  const value = draft.contractDetails.assignment ?? {
    documents: [], additionalScope: '', exclusions: '', documentNotes: draft.contractDetails.fields.documents.text
  }
  if (draft.contractForm === 'abs18') {
    if (value.standardConditions) return draft
    return { ...draft, ...assignmentPatch(draft, { ...value, standardConditions: {
      version: ABS18_ASSIGNMENT_CONDITIONS.version, text: ABS18_ASSIGNMENT_CONDITIONS.text
    } }, value) }
  }
  if (!value.standardConditions) return draft
  const next = { ...value }
  delete next.standardConditions
  return { ...draft, ...assignmentPatch(draft, next, value) }
}

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
