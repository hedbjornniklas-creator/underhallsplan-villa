import type { CustomerContractDetails } from './customerContract'
import type { CustomerOfferDraft, CustomerOfferFile } from './customerOffers'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { assignmentForEditing, assignmentPatch, type ContractDocumentReference } from './contractAssignment.ts'

export const changeMarkupFields = [
  { key: 'materials', title: 'Material och varor' },
  { key: 'subcontractors', title: 'Underentreprenörer' },
  { key: 'equipment', title: 'Maskiner och hjälpmedel' },
  { key: 'other', title: 'Övriga kostnader' }
] as const
export type ChangeRate = { id: string; kind: 'ordinary' | 'management' | 'other'; title: string; hourlyOre: number | null }
export type ContractChanges = {
  version: 1
  mode: 'fields' | 'attachment'
  rates: ChangeRate[]
  markups: Record<(typeof changeMarkupFields)[number]['key'], number | null>
  annex: ContractDocumentReference | null
  annexRevision: string
  standardText: string
  notes: string
}
// A project-specific summary; the original ABS 18 document is not modified.
export const defaultChangeConditions = 'Om parterna inte avtalar ett särskilt fast pris för ett ändrings- eller tilläggsarbete används nedanstående prisgrunder. Timpriserna inkluderar entreprenörarvode och moms. Kostnader för material, varor, överenskomna underentreprenader, hjälpmedel och övrigt utgår från självkostnad exklusive moms, med avtalat påslag. Moms tillkommer på kostnad och arvode. Arbetsledning debiteras enligt ordinarie timpris om inget särskilt timpris anges.\n\nÄndrings- och tilläggsarbeten ska dokumenteras i en separat skriftlig överenskommelse med omfattning, pris eller prisgrund och påverkan på tiden. Prisgrunderna innebär inte i sig en beställning av ytterligare arbete. Parterna behöver också beakta om arbetena påverkar försäkringarnas eller säkerheternas omfattning.'
export const changeEntryText = 'Prisgrunder för ÄTA anges i avtalets ÄTA-sektion.'

export function changesForEditing(details: CustomerContractDetails): ContractChanges {
  return details.changesPricing ?? {
    version: 1, mode: 'fields', rates: [{ id: '00000000-0000-4000-8000-00000000000c', kind: 'ordinary', title: 'Ordinarie arbete', hourlyOre: null }],
    markups: { materials: null, subcontractors: null, equipment: null, other: null },
    annex: null, annexRevision: '', standardText: defaultChangeConditions,
    notes: details.fields.changes.text ? `${details.fields.changes.status === 'document' ? 'Avtalshandling: ' : details.fields.changes.status === 'not_applicable' ? 'Ej aktuellt: ' : ''}${details.fields.changes.text}` : ''
  }
}
export function changesIssues(value: ContractChanges): string[] {
  const issues: string[] = []
  if (!value.standardText.trim()) issues.push('Ange avtalsvillkoren för ÄTA.')
  if (value.mode === 'attachment') {
    if (!value.annex) issues.push('Välj en prisbilaga för ÄTA.')
    else if (!value.annex.name.trim() || !value.annex.type.trim() || !value.annex.date) issues.push('Komplettera ÄTA-prisbilagans namn, typ och datum.')
    if (!value.annexRevision.trim()) issues.push('Ange ÄTA-prisbilagans version.')
  } else {
    if (!value.rates.some((row) => row.kind === 'ordinary')) issues.push('Ange ett ordinarie timpris för ÄTA.')
    for (const row of value.rates) {
      if (!row.title.trim() || row.hourlyOre === null || row.hourlyOre <= 0) issues.push(`Komplettera ÄTA-timpriset för ${row.title.trim() || 'namnlös roll'}.`)
    }
    for (const { key, title } of changeMarkupFields) if (value.markups[key] === null) issues.push(`Ange ÄTA-påslag för ${title.toLocaleLowerCase('sv-SE')}, även om det är 0 %.`)
  }
  return issues
}
export function changesEntry(value: ContractChanges) {
  return { status: changesIssues(value).length ? 'unreviewed' as const : 'specified' as const, text: changeEntryText }
}
export function changesSummary(value?: ContractChanges): string {
  if (!value) return 'Prisgrunder inte angivna'
  return `${value.mode === 'attachment' ? 'Prisbilaga' : `${value.rates.length} ${value.rates.length === 1 ? 'timpris' : 'timpriser'}`} · ${changesIssues(value).length ? 'Behöver kompletteras' : 'Prisgrunder angivna'}`
}
export function changesDetails(details: CustomerContractDetails, value: ContractChanges): CustomerContractDetails {
  return { ...details, changesPricing: value, fields: { ...details.fields, changes: changesEntry(value) } }
}
export function normalizeContractChanges(input: unknown): ContractChanges {
  const invalid = (): never => { throw new Error('CUSTOMER_OFFER_INVALID') }
  const record = (v: unknown): Record<string, unknown> => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) invalid()
    return v as Record<string, unknown>
  }
  const text = (v: unknown, max: number) => {
    if (typeof v !== 'string' || v.length > max) invalid()
    return (v as string).trim()
  }
  const value = record(input), markups = record(value.markups)
  if (value.version !== 1 || !['fields', 'attachment'].includes(String(value.mode)) || !Array.isArray(value.rates) || value.rates.length > 50) invalid()
  const seen = new Set<string>(), kinds = new Set<string>()
  const rates = (value.rates as unknown[]).map((input): ChangeRate => {
    const row = record(input), id = text(row.id, 36).toLowerCase(), kind = row.kind
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) || seen.has(id) ||
      !['ordinary', 'management', 'other'].includes(String(kind)) || (kind !== 'other' && kinds.has(String(kind)))) invalid()
    seen.add(id); kinds.add(String(kind))
    const hourly = row.hourlyOre
    if (hourly !== null && (!Number.isSafeInteger(hourly) || Number(hourly) < 0 || Number(hourly) > 100_000_000_000)) invalid()
    return { id, kind: kind as ChangeRate['kind'], title: text(row.title, 250), hourlyOre: hourly as number | null }
  })
  const result: ContractChanges = { version: 1, mode: value.mode as ContractChanges['mode'], rates,
    markups: { materials: null, subcontractors: null, equipment: null, other: null }, annex: null,
    annexRevision: text(value.annexRevision, 100), standardText: text(value.standardText, 6000), notes: text(value.notes, 6200) }
  for (const { key } of changeMarkupFields) {
    const percent = markups[key]
    if (percent !== null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 1000 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001)) invalid()
    result.markups[key] = percent as number | null
  }
  if (value.annex !== null) {
    const annex = record(value.annex), fileId = text(annex.fileId, 36).toLowerCase(), date = text(annex.date, 10)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fileId) ||
      (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date))) invalid()
    result.annex = { fileId, type: text(annex.type, 100), name: text(annex.name, 250), date }
  }
  return result
}

// Price annex selection, document metadata and attachment grants save atomically.
export function changePricingPatch(draft: CustomerOfferDraft, value: ContractChanges, files: CustomerOfferFile[]): Partial<CustomerOfferDraft> {
  if (!draft.contractDetails) throw new Error('CUSTOMER_OFFER_INVALID')
  const previous = assignmentForEditing(draft, files), oldAnnex = draft.contractDetails.changesPricing?.annex
  let documents = previous.documents
  if (oldAnnex && (value.mode !== 'attachment' || oldAnnex.fileId !== value.annex?.fileId)) documents = documents.filter((doc) => doc.fileId !== oldAnnex.fileId)
  if (value.mode === 'attachment' && value.annex) {
    const file = files.find((file) => file.id === value.annex!.fileId)
    if (!file || file.contentType !== 'application/pdf' || file.id === draft.termsAttachmentId) throw new Error('CUSTOMER_OFFER_FILES')
    const existing = documents.some((doc) => doc.fileId === value.annex!.fileId)
    documents = existing ? documents.map((doc) => doc.fileId === value.annex!.fileId ? { ...value.annex! } : doc) : [...documents, { ...value.annex }]
  }
  if (documents.length > 30) throw new Error('CUSTOMER_OFFER_FILES')
  const patch = assignmentPatch(draft, { ...previous, documents }, previous)
  if (patch.attachmentIds!.length > 30) throw new Error('CUSTOMER_OFFER_FILES')
  return { ...patch, contractDetails: changesDetails(patch.contractDetails!, value) }
}

export function publicChanges(value: ContractChanges): ContractChanges {
  return value.mode === 'attachment'
    ? { ...value, rates: [], markups: { materials: null, subcontractors: null, equipment: null, other: null } }
    : { ...value, annex: null, annexRevision: '' }
}
