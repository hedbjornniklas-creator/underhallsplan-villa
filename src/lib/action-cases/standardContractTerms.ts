import type { CustomerOfferDraft, CustomerOfferFile } from './customerOffers'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { assignmentForEditing, assignmentPatch } from './contractAssignment.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { editedContractEntry, emptyContractDetails } from './customerContract.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { abs18PaymentText } from './customerPaymentPlan.ts'

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

export const HF17_TERMS = {
  version: 'hf17-2017',
  fileName: 'Hantverkarformularet_17_2017.pdf',
  name: 'Hantverkarformuläret 17 med allmänna bestämmelser (2017)',
  type: 'Avtalsformulär och allmänna bestämmelser, HF17',
  date: '',
  sourceUrl: 'https://publikationer.konsumentverket.se/downloads/bo-2017-03-hantverkarformularet-17/230/view',
  assetPath: 'public/hf17-2017.pdf',
  sha256: 'bd580d75e19e19ada7e2144d271e35a055cd119dbf3eb05f904e10203349e4ff',
  size: 3316217,
  reference: 'För entreprenaden används Hantverkarformuläret 17 med tillhörande allmänna bestämmelser. Originalhandlingen bifogas.',
} as const

export type StandardContractForm = 'abs18' | 'hf17'
export const standardContractForms = ['abs18', 'hf17'] as const
export function standardTermsFor(form: CustomerOfferDraft['contractForm']) {
  return form === 'abs18' ? ABS18_TERMS : form === 'hf17' ? HF17_TERMS : null
}
export function contractFormName(form: CustomerOfferDraft['contractForm']) {
  return form === 'abs18' ? 'ABS 18' : form === 'hf17' ? 'Hantverkarformuläret 17' : form === 'ab04' ? 'AB 04' : form === 'abt06' ? 'ABT 06' : 'Egen avtalshandling'
}
export const commercialContractReferences = {
  ab04: 'För entreprenaden gäller AB 04. Eventuella avvikelser och kompletteringar anges särskilt i avtalshandlingarna.',
  abt06: 'För entreprenaden gäller ABT 06. Eventuella avvikelser och kompletteringar anges särskilt i avtalshandlingarna.',
} as const
export function standardTermsForFile(file: CustomerOfferFile) {
  return [ABS18_TERMS, HF17_TERMS].find(terms => terms.fileName === file.fileName && terms.size === file.fileSizeBytes) ?? null
}
export function selectManualContractTerms(draft: CustomerOfferDraft, file: CustomerOfferFile | undefined, files: CustomerOfferFile[]): Partial<CustomerOfferDraft> {
  const editable = { ...draft, contractDetails: draft.contractDetails ?? emptyContractDetails() }
  const previous = assignmentForEditing(editable, files)
  const documents = previous.documents.filter(doc => doc.fileId !== draft.termsAttachmentId || doc.fileId === file?.id)
  if (file && !documents.some(doc => doc.fileId === file.id)) documents.push({ fileId: file.id, type: 'Allmänna bestämmelser', name: file.fileName, date: '' })
  return { ...assignmentPatch(editable, { ...previous, documents }, previous), termsAttachmentId: file?.id ?? null }
}

// Only called on an explicit form change, never when reading frozen documents.
export function changeContractForm(draft: CustomerOfferDraft, form: CustomerOfferDraft['contractForm'], files: CustomerOfferFile[] = []): CustomerOfferDraft {
  if (form === draft.contractForm) return draft
  let next = { ...draft, contractForm: form }
  if (form === 'ab04' || form === 'abt06') next.termsAttachmentId = null
  if ((draft.contractForm === 'ab04' || draft.contractForm === 'abt06') && draft.termsAttachmentId) {
    const previous = assignmentForEditing(draft, files)
    next = { ...next, ...assignmentPatch(next, { ...previous, documents: previous.documents.filter(doc => doc.fileId !== draft.termsAttachmentId) }, previous),
      attachmentIds: next.attachmentIds.filter(id => id !== draft.termsAttachmentId), termsAttachmentId: null }
  }
  for (const file of files) if (standardTermsForFile(file) && standardTermsForFile(file) !== standardTermsFor(form)) next = withStandardContractTerms(next, file, files)
  if (!next.terms.trim() || [ABS18_TERMS.reference, HF17_TERMS.reference, ...Object.values(commercialContractReferences)].some(reference => reference === next.terms))
    next.terms = standardTermsFor(form)?.reference ?? (form === 'ab04' || form === 'abt06' ? commercialContractReferences[form] : '')
  const editedConditions = next.contractDetails?.assignment?.standardConditions?.text
  if (form !== 'abs18' && editedConditions?.trim() && editedConditions !== ABS18_ASSIGNMENT_CONDITIONS.text && !next.terms.includes(editedConditions)) {
    const terms = [next.terms.trim(), editedConditions].filter(Boolean).join('\n\n')
    if (terms.length > 20000) throw new Error('CUSTOMER_OFFER_FORM_TEXT_LIMIT')
    next.terms = terms
  }
  next = withAbs18AssignmentConditions(next)
  if (form !== 'abs18') {
    if (next.contractDetails?.workEnvironmentDefaultVersion && next.contractDetails.fields.workEnvironment.text === ABS18_WORK_ENVIRONMENT.text) {
      const details = { ...next.contractDetails, fields: { ...next.contractDetails.fields, workEnvironment: editedContractEntry('') } }
      delete details.workEnvironmentDefaultVersion
      next = { ...next, contractDetails: details }
    }
    if (next.paymentConditions?.standardText === abs18PaymentText) next = { ...next, paymentConditions: { ...next.paymentConditions, standardText: '' } }
    if (next.paymentTerms === abs18PaymentText) next.paymentTerms = ''
  }
  return next
}

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
  const terms = standardTermsForFile(file)
  if (!terms) throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  if (standardTermsFor(draft.contractForm)?.version !== terms.version) {
    if (!draft.attachmentIds.includes(file.id) && !value.documents.some((doc) => doc.fileId === file.id)) return draft
    const next = { ...value, documents: value.documents.filter((doc) => doc.fileId !== file.id) }
    return { ...draft, ...assignmentPatch(draft, next, value),
      attachmentIds: draft.attachmentIds.filter((id) => id !== file.id),
      termsAttachmentId: draft.termsAttachmentId === file.id ? null : draft.termsAttachmentId,
      terms: draft.terms === terms.reference ? '' : draft.terms }
  }
  if (!draft.attachmentIds.includes(file.id) && draft.attachmentIds.length >= 30)
    throw new Error('CUSTOMER_OFFER_TERMS_LIMIT')
  const editable = { ...draft, contractDetails: draft.contractDetails ?? emptyContractDetails() }
  const documents = [{ fileId: file.id, type: terms.type, name: terms.name, date: terms.date },
    ...value.documents.filter((doc) => doc.fileId !== file.id)]
  return { ...editable, ...assignmentPatch(editable, { ...value, documents }, value),
    termsAttachmentId: file.id, terms: draft.terms.trim() ? draft.terms : terms.reference }
}
