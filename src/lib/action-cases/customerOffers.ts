import type { CustomerOfferCosting } from './customerOfferCosting'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { contractDetailsIssues, normalizeContractDetails, type CustomerContractDetails } from './customerContract.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { normalizePaymentPlan, paymentPlanIssues, type CustomerPaymentPlan } from './customerPaymentPlan.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { normalizeContractParties, contractPartiesIssues, publicContractParties, contractPartiesSummary, type ContractParties } from './customerContractParties.ts'

export type CustomerOfferItem = {
  id: string
  title: string
  scope: string
  scopeConditions?: string
  scopeExclusions?: string
  scopeAdvice?: string
  kind: 'included' | 'option' | 'excluded'
  amountOre: number | null
  optionGroup?: string | null
  sourceReview?: Partial<Record<'title' | 'scope' | 'scopeConditions' | 'scopeExclusions' | 'scopeAdvice' | 'amountOre', string>>
}
export type CustomerOfferDraft = {
  contractParties?: ContractParties
  paymentPlan?: CustomerPaymentPlan | null
  contractDetails?: CustomerContractDetails
  title: string
  introduction: string
  baseAmountOre: number | null
  pricingMode?: 'total' | 'itemized'
  validUntil: string
  contractForm: 'abs18' | 'custom'
  terms: string
  paymentTerms: string
  schedule: string
  attachmentIds: string[]
  termsAttachmentId: string | null
  items: CustomerOfferItem[]
}
export type CustomerOfferFile = {
  id: string
  fileName: string
  contentType: string
  fileSizeBytes: number
}
export type CustomerOfferSnapshot = CustomerOfferDraft & {
  projectTitle: string
  propertyAddress: string
  customerName: string
  customerEmail: string
  issuerName: string
  replyEmail: string
}
export type CustomerOffer = {
  id: string
  version: number
  status: 'published' | 'accepted' | 'withdrawn' | 'superseded'
  snapshot: CustomerOfferSnapshot
  files: CustomerOfferFile[]
  publishedAt: string
  sentAt: string | null
  acceptedAt: string | null
  acceptedBy: string | null
  acceptedOptionIds: string[]
  acceptedTotalOre: number | null
}
export type CustomerOfferWorkspace = {
  propertyLink?: import('../properties/identity').ProjectPropertyLink
  customerLink?: import('./customerRegistry').ContractCustomerLink
  recipient?: import('./contracts').ActionCaseParticipantView | null
  planning?: import('./customerPlanning').CustomerPlanning
  costing?: CustomerOfferCosting
  costingAvailable?: boolean
  draft: CustomerOfferDraft
  revision: number
  offers: CustomerOffer[]
}

export const CUSTOMER_OFFER_COLUMNS =
  'id,version,status,snapshot,files,published_at,sent_at,accepted_at,accepted_by,accepted_option_ids,accepted_total_ore'
export const CUSTOMER_OFFER_BUCKET = 'action-case-customer-offers'
const idPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function offerId(value: unknown): string {
  if (typeof value !== 'string' || !idPattern.test(value))
    throw new Error('CUSTOMER_OFFER_INVALID')
  return value
}
function text(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max)
    throw new Error('CUSTOMER_OFFER_INVALID')
  return value.trim()
}
function amount(value: unknown): number | null {
  if (value === null) return null
  if (
    !Number.isSafeInteger(value) ||
    Number(value) < 0 ||
    Number(value) > 100_000_000_000
  )
    throw new Error('CUSTOMER_OFFER_INVALID')
  return Number(value)
}
export function normalizeCustomerOffer(value: unknown): CustomerOfferDraft {
  if (!value || typeof value !== 'object')
    throw new Error('CUSTOMER_OFFER_INVALID')
  const d = value as Record<string, unknown>
  if (
    d.pricingMode !== undefined &&
    !['total', 'itemized'].includes(String(d.pricingMode))
  )
    throw new Error('CUSTOMER_OFFER_INVALID')
  if (
    !Array.isArray(d.items) ||
    d.items.length > 200 ||
    !Array.isArray(d.attachmentIds) ||
    d.attachmentIds.length > 30
  )
    throw new Error('CUSTOMER_OFFER_INVALID')
  const items = d.items.map((input): CustomerOfferItem => {
    if (!input || typeof input !== 'object')
      throw new Error('CUSTOMER_OFFER_INVALID')
    const i = input as Record<string, unknown>
    if (!['included', 'option', 'excluded'].includes(String(i.kind)))
      throw new Error('CUSTOMER_OFFER_INVALID')
    return {
      id: offerId(i.id),
      title: text(i.title, 250),
      scope: text(i.scope, 12000),
      ...(i.scopeConditions === undefined ? {} : { scopeConditions: text(i.scopeConditions, 6000) }),
      ...(i.scopeExclusions === undefined ? {} : { scopeExclusions: text(i.scopeExclusions, 6000) }),
      ...(i.scopeAdvice === undefined ? {} : { scopeAdvice: text(i.scopeAdvice, 6000) }),
      ...(i.sourceReview === undefined ? {} : { sourceReview: normalizeSourceReview(i.sourceReview) }),
      kind: i.kind as CustomerOfferItem['kind'],
      amountOre: i.kind === 'excluded' ? null : amount(i.amountOre),
      ...(i.optionGroup !== undefined
        ? {
            optionGroup:
              i.kind === 'option' && i.optionGroup !== null
                ? text(i.optionGroup, 100) || null
                : null
          }
        : {})
    }
  })
  const attachmentIds = d.attachmentIds.map(offerId)
  if (
    new Set(items.map((i) => i.id)).size !== items.length ||
    new Set(attachmentIds).size !== attachmentIds.length
  )
    throw new Error('CUSTOMER_OFFER_INVALID')
  if (!['abs18', 'custom'].includes(String(d.contractForm)))
    throw new Error('CUSTOMER_OFFER_INVALID')
  const validUntil = text(d.validUntil, 10)
  if (
    validUntil &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil) ||
      !Number.isFinite(Date.parse(validUntil)) ||
      new Date(validUntil).toISOString().slice(0, 10) !== validUntil)
  )
    throw new Error('CUSTOMER_OFFER_INVALID')
  const termsAttachmentId = d.termsAttachmentId
    ? offerId(d.termsAttachmentId)
    : null
  if (termsAttachmentId && !attachmentIds.includes(termsAttachmentId))
    throw new Error('CUSTOMER_OFFER_INVALID')
  const draft: CustomerOfferDraft = {
    ...(d.contractParties === undefined ? {} : { contractParties: normalizeContractParties(d.contractParties) }),
    ...(d.paymentPlan === undefined ? {} : { paymentPlan: normalizePaymentPlan(d.paymentPlan) }),
    ...(d.contractDetails === undefined ? {} : { contractDetails: normalizeContractDetails(d.contractDetails) }),
    title: text(d.title, 250),
    introduction: text(d.introduction, 12000),
    baseAmountOre: d.pricingMode === 'itemized' ? null : amount(d.baseAmountOre),
    ...(d.pricingMode !== undefined
      ? { pricingMode: d.pricingMode as CustomerOfferDraft['pricingMode'] }
      : {}),
    validUntil,
    contractForm: d.contractForm as CustomerOfferDraft['contractForm'],
    terms: text(d.terms, 20000),
    paymentTerms: text(d.paymentTerms, 6000),
    schedule: text(d.schedule, 6000),
    attachmentIds,
    termsAttachmentId,
    items
  }
  if (draft.contractParties && draft.contractDetails) draft.contractDetails.fields.parties = { status: 'specified', text: contractPartiesSummary(draft.contractParties) }
  if (draft.contractDetails?.assignment?.documents.some((doc) => !attachmentIds.includes(doc.fileId)))
    throw new Error('CUSTOMER_OFFER_INVALID')
  draft.baseAmountOre = customerOfferBaseAmount(draft)
  return draft
}

function normalizeSourceReview(value: unknown): NonNullable<CustomerOfferItem['sourceReview']> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  const result: NonNullable<CustomerOfferItem['sourceReview']> = {}
  for (const key of ['title', 'scope', 'scopeConditions', 'scopeExclusions', 'scopeAdvice', 'amountOre'] as const) {
    const hash = (value as Record<string, unknown>)[key]
    if (hash === undefined) continue
    if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('CUSTOMER_OFFER_INVALID')
    result[key] = hash
  }
  return result
}

export function customerOfferBaseAmount(d: CustomerOfferDraft): number | null {
  if (d.pricingMode !== 'itemized') return d.baseAmountOre
  const included = d.items.filter((i) => i.kind === 'included')
  if (!included.length || included.some((i) => i.amountOre === null)) return null
  return included.reduce((sum, i) => sum + (i.amountOre ?? 0), 0)
}

export function customerOfferOptionGroup(item: CustomerOfferItem): string {
  return item.kind === 'option' ? item.optionGroup?.trim() ?? '' : ''
}

export function selectCustomerOfferOption(
  d: CustomerOfferDraft,
  selected: string[],
  id: string
): string[] {
  const option = d.items.find((i) => i.id === id && i.kind === 'option')
  if (!option || option.amountOre === null) return selected
  const group = customerOfferOptionGroup(option)
  return [
    ...selected.filter((selectedId) => {
      const current = d.items.find((i) => i.id === selectedId)
      return (
        current?.kind === 'option' &&
        current.amountOre !== null &&
        selectedId !== id &&
        (!group || customerOfferOptionGroup(current) !== group)
      )
    }),
    id
  ]
}
export function offerPublishIssues(
  d: CustomerOfferDraft,
  today = new Date().toLocaleDateString('sv-SE', {
    timeZone: 'Europe/Stockholm'
  })
): string[] {
  const issues: string[] = contractDetailsIssues(d.contractDetails, Boolean(d.contractParties))
  if (d.contractDetails?.assignment && d.termsAttachmentId && !d.contractDetails.assignment.documents.some((doc) => doc.fileId === d.termsAttachmentId))
    issues.push('Lägg avtalshandlingen i uppdragets handlingsförteckning.')
  issues.push(...contractPartiesIssues(d.contractParties))
  if (d.items.some((i) => i.scopeAdvice?.trim()) && d.contractDetails?.advice.status !== 'given')
    issues.push('En arbetsdel innehåller avrådan. Kontrollera och dokumentera avrådan under Avtalsuppgifter före utskick.')
  issues.push(...paymentPlanIssues(d.paymentPlan, customerOfferBaseAmount(d)))
  if (d.items.some((i) => i.kind === 'option'))
    issues.push('Flytta valen till Val och tillval innan grundavtalet skickas.')
  if (!d.title.trim()) issues.push('Ange en offertrubrik.')
  if (d.pricingMode === 'itemized') {
    const missing = d.items.filter(
      (i) => i.kind === 'included' && i.amountOre === null
    )
    for (const i of missing)
      issues.push(`Ange delpris för ${i.title.trim() || 'namnlöst arbete'}.`)
  } else if (d.baseAmountOre === null) issues.push('Ange grundpriset inklusive moms.')
  if (!d.items.some((i) => i.kind === 'included'))
    issues.push('Lägg till minst ett arbete i grundåtagandet.')
  if (d.items.some((i) => !i.title.trim() || !i.scope.trim()))
    issues.push('Beskriv omfattningen för varje arbete.')
  if (d.items.some((i) => i.kind === 'option' && i.amountOre === null))
    issues.push('Ange pris för samtliga tillval.')
  const groups = new Set(d.items.map(customerOfferOptionGroup).filter(Boolean))
  for (const group of groups) {
    if (
      d.items.filter((i) => customerOfferOptionGroup(i) === group).length < 2
    )
      issues.push(`Lägg till minst två alternativ i ${group}, eller ta bort gruppen.`)
  }
  if (!d.validUntil || d.validUntil < today)
    issues.push('Ange en giltighetstid som inte har passerat.')
  if (!d.terms.trim())
    issues.push('Komplettera villkor och hänvisning till avtalshandling.')
  if (!d.paymentTerms.trim()) issues.push('Ange betalningsvillkor.')
  if (!d.schedule.trim()) issues.push('Ange tider och förutsättningar.')
  if (d.contractForm === 'abs18' && !d.termsAttachmentId)
    issues.push('Välj avtalshandlingen för ABS 18 bland bilagorna.')
  return issues
}
export function customerOfferTotal(
  d: CustomerOfferDraft,
  selectedIds: string[]
) {
  const baseAmount = customerOfferBaseAmount(d)
  if (
    baseAmount === null ||
    new Set(selectedIds).size !== selectedIds.length
  )
    throw new Error('CUSTOMER_OFFER_INVALID')
  let total = baseAmount
  const groups = new Set<string>()
  for (const id of selectedIds) {
    const option = d.items.find((i) => i.id === id && i.kind === 'option')
    if (!option || option.amountOre === null)
      throw new Error('CUSTOMER_OFFER_INVALID')
    const group = customerOfferOptionGroup(option)
    if (group && groups.has(group)) throw new Error('CUSTOMER_OFFER_INVALID')
    if (group) groups.add(group)
    total += option.amountOre
  }
  if (!Number.isSafeInteger(total)) throw new Error('CUSTOMER_OFFER_INVALID')
  return total
}
export function money(ore: number | null) {
  return ore === null
    ? 'Pris saknas'
    : new Intl.NumberFormat('sv-SE', {
        style: 'currency',
        currency: 'SEK',
        maximumFractionDigits: 2
      }).format(ore / 100)
}
export function parseKronor(value: string): number | null {
  if (!value.trim()) return null
  const normalized = value.replace(/[\s\u00a0]/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized))
    throw new Error('CUSTOMER_OFFER_INVALID')
  return amount(Math.round(Number(normalized) * 100))
}
export function emptyCustomerOffer(title = ''): CustomerOfferDraft {
  return {
    title,
    introduction: '',
    baseAmountOre: null,
    validUntil: '',
    contractForm: 'abs18',
    terms: '',
    paymentTerms: '',
    schedule: '',
    attachmentIds: [],
    termsAttachmentId: null,
    items: []
  }
}
// Explicit public projection: never spread database rows or email payloads into a portal.
export function mapCustomerOffer(row: Record<string, unknown>): CustomerOffer {
  const s = row.snapshot as Record<string, unknown>
  const d = normalizeCustomerOffer(s)
  return {
    id: String(row.id),
    version: Number(row.version),
    status: row.status as CustomerOffer['status'],
    snapshot: {
      ...d,
      ...(d.contractParties ? { contractParties: publicContractParties(d.contractParties) } : {}),
      items: d.items.map((item) => {
        const publicItem = { ...item }
        delete publicItem.sourceReview
        return publicItem
      }),
      projectTitle: String(s.projectTitle),
      propertyAddress: String(s.propertyAddress),
      customerName: String(s.customerName),
      customerEmail: String(s.customerEmail),
      issuerName: String(s.issuerName),
      replyEmail: String(s.replyEmail)
    },
    files: (row.files as CustomerOfferFile[]).map((f) => ({
      id: f.id,
      fileName: f.fileName,
      contentType: f.contentType,
      fileSizeBytes: f.fileSizeBytes
    })),
    publishedAt: String(row.published_at),
    sentAt: row.sent_at ? String(row.sent_at) : null,
    acceptedAt: row.accepted_at ? String(row.accepted_at) : null,
    acceptedBy: row.accepted_by ? String(row.accepted_by) : null,
    acceptedOptionIds: (row.accepted_option_ids as string[]) ?? [],
    acceptedTotalOre:
      row.accepted_total_ore == null ? null : Number(row.accepted_total_ore)
  }
}
