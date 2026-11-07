import type { ActionCaseView } from '../action-cases/contracts'
import type {
  SupplierInvoice, SupplierInvoiceDraft, SupplierInvoiceAllocation,
} from './contracts'

export const MAX_INVOICE_AMOUNT_ORE = 99_999_999_999
export const INVOICE_COST_CATEGORIES = ['material', 'subcontractor', 'waste', 'transport', 'other'] as const
export const INVOICE_APPROVAL_STATUSES = ['registered', 'approved', 'disputed', 'void'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class SupplierInvoiceValidationError extends Error {
  readonly issues: string[]
  constructor(issues: string[]) {
    super('INVOICE_INVALID')
    this.name = 'SupplierInvoiceValidationError'
    this.issues = issues
  }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SupplierInvoiceValidationError(['invoice'])
  return value as Record<string, unknown>
}

export function isInvoiceDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '1900-01-01'
}

/** Validate at both HTTP and database boundaries. Unknown fields are never persisted. */
export function normalizeSupplierInvoiceDraft(value: unknown): SupplierInvoiceDraft {
  const input = record(value), issues: string[] = []
  const text = (key: string, max: number, required = false) => {
    const raw = input[key]
    if (raw !== undefined && typeof raw !== 'string') issues.push(key)
    const result = typeof raw === 'string' ? raw.trim() : ''
    if (result.length > max || (required && !result)) issues.push(key)
    return result
  }
  const amount = (raw: unknown, key: string, positive = false) => {
    if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < (positive ? 1 : 0) || raw > MAX_INVOICE_AMOUNT_ORE) {
      issues.push(key)
      return 0
    }
    return raw
  }
  const supplierName = text('supplierName', 200, true)
  const supplierOrgNumber = text('supplierOrgNumber', 40)
  const invoiceNumber = text('invoiceNumber', 100, true)
  const invoiceDate = text('invoiceDate', 10, true), dueDate = text('dueDate', 10)
  if (!isInvoiceDate(invoiceDate)) issues.push('invoiceDate')
  if (dueDate && !isInvoiceDate(dueDate)) issues.push('dueDate')
  // Historic invoices and contractual dates are accepted; no inferred payment terms.
  const documentKind = input.documentKind
  if (documentKind !== 'invoice' && documentKind !== 'credit') issues.push('documentKind')
  const creditReferenceInvoiceId = input.creditReferenceInvoiceId ?? null
  if (creditReferenceInvoiceId !== null && (typeof creditReferenceInvoiceId !== 'string' || !UUID.test(creditReferenceInvoiceId))) issues.push('creditReferenceInvoiceId')
  if (documentKind !== 'credit' && creditReferenceInvoiceId !== null) issues.push('creditReferenceInvoiceId')
  if (input.currency !== 'SEK') issues.push('currency')
  const netAmountOre = amount(input.netAmountOre, 'netAmountOre', true)
  const vatAmountOre = amount(input.vatAmountOre, 'vatAmountOre')
  const approvalStatus = input.approvalStatus
  if (!INVOICE_APPROVAL_STATUSES.includes(approvalStatus as typeof INVOICE_APPROVAL_STATUSES[number])) issues.push('approvalStatus')
  const paymentStatus = input.paymentStatus
  if (paymentStatus !== 'unpaid' && paymentStatus !== 'paid') issues.push('paymentStatus')
  const paidOn = input.paidOn ?? null
  if (paymentStatus === 'paid' && !isInvoiceDate(paidOn)) issues.push('paidOn')
  if (paymentStatus === 'unpaid' && paidOn !== null) issues.push('paidOn')
  const notes = text('notes', 5000), sourceText = text('sourceText', 50000)
  const allocations: SupplierInvoiceAllocation[] = []
  if (!Array.isArray(input.allocations) || input.allocations.length > 100) issues.push('allocations')
  else for (const [index, raw] of input.allocations.entries()) {
    const key = `allocations.${index}`
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { issues.push(key); continue }
    const row = raw as Record<string, unknown>
    const caseId = typeof row.caseId === 'string' ? row.caseId.toLowerCase() : ''
    if (!UUID.test(caseId)) issues.push(`${key}.caseId`)
    const itemId = typeof row.itemId === 'string' ? row.itemId.toLowerCase() : row.itemId ?? null
    if (itemId !== null && (typeof itemId !== 'string' || !UUID.test(itemId))) issues.push(`${key}.itemId`)
    if (!INVOICE_COST_CATEGORIES.includes(row.category as typeof INVOICE_COST_CATEGORIES[number])) issues.push(`${key}.category`)
    const description = typeof row.description === 'string' ? row.description.trim() : ''
    if (typeof row.description !== 'string' || description.length > 500) issues.push(`${key}.description`)
    const id = row.id, changeId = row.changeId
    if (id !== undefined && (typeof id !== 'string' || !UUID.test(id))) issues.push(`${key}.id`)
    if (changeId != null && (typeof changeId !== 'string' || !UUID.test(changeId) || itemId !== null || !id)) issues.push(`${key}.changeId`)
    allocations.push({ ...(typeof id === 'string' ? { id: id.toLowerCase() } : {}), ...(changeId !== undefined ? { changeId: typeof changeId === 'string' ? changeId.toLowerCase() : null } : {}), caseId, itemId: itemId as string | null, category: row.category as SupplierInvoiceAllocation['category'], description, amountOre: amount(row.amountOre, `${key}.amountOre`, true) })
  }
  const ids = allocations.flatMap(a => a.id ? [a.id] : [])
  if (new Set(ids).size !== ids.length) issues.push('allocationIds')
  if (allocations.reduce((sum, row) => sum + row.amountOre, 0) > netAmountOre) issues.push('allocationTotal')
  if (issues.length) throw new SupplierInvoiceValidationError([...new Set(issues)])
  return {
    supplierName, supplierOrgNumber, invoiceNumber, invoiceDate, dueDate,
    documentKind: documentKind as SupplierInvoiceDraft['documentKind'],
    creditReferenceInvoiceId: typeof creditReferenceInvoiceId === 'string' ? creditReferenceInvoiceId.toLowerCase() : null, currency: 'SEK',
    netAmountOre, vatAmountOre, approvalStatus: approvalStatus as SupplierInvoiceDraft['approvalStatus'],
    paymentStatus: paymentStatus as SupplierInvoiceDraft['paymentStatus'], paidOn: paidOn as string | null,
    notes, sourceText, allocations,
  }
}

/** Parse an explicitly entered magnitude without rounding or silently accepting extra decimals. */
export function parseInvoiceAmount(value: string): number | null {
  const input = value.trim().replace(/\s*(?:SEK|kr)\s*$/i, '').trim()
  let normalized: string
  if (/^\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(input)) normalized = input.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(?:,\d{3})+\.\d{1,2}$/.test(input)) normalized = input.replace(/,/g, '')
  else if (/^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:[.,]\d{1,2})?$/.test(input)) normalized = input.replace(/[ \u00a0\u202f]/g, '').replace(',', '.')
  else return null
  const [whole, decimals = ''] = normalized.split('.')
  const result = Number(whole) * 100 + Number(decimals.padEnd(2, '0'))
  return Number.isSafeInteger(result) && result <= MAX_INVOICE_AMOUNT_ORE ? result : null
}

export function formatInvoiceAmount(ore: number): string {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(ore / 100)
}

/** Conservative, labelled text extraction only. No inferred supplier, VAT rate or invoice total. */
export function extractInvoiceText(text: string): Partial<SupplierInvoiceDraft> {
  const source = text.slice(0, 50000).replace(/\r\n?/g, '\n'), result: Partial<SupplierInvoiceDraft> = { sourceText: source }
  const lines = source.split('\n').map((line) => line.trim()).filter(Boolean)
  const labelled = (labels: string) => {
    const pattern = new RegExp(`^(?:${labels})(?:\\s*[:：]\\s*|\\s+)(.+)$`, 'i')
    for (const line of lines) { const match = line.match(pattern); if (match) return match[1].trim() }
    return null
  }
  const supplier = labelled('leverantör(?:snamn)?|supplier(?: name)?')
  if (supplier) result.supplierName = supplier.slice(0, 200)
  const org = labelled('org(?:anisations)?\.?\\s*(?:nummer|nr)\\.?|org\\.?\\s*nr\\.?')
  if (org && /^[\d\s-]{10,18}$/.test(org)) result.supplierOrgNumber = org.replace(/\s/g, '')
  const number = labelled('faktura\\s*(?:nummer|nr)\\.?|invoice (?:number|no\\.?)')
  if (number && /^[\w\-/.]{1,100}$/.test(number)) result.invoiceNumber = number
  const date = (labels: string) => {
    const raw = labelled(labels)
    if (!raw) return null
    const iso = raw.match(/^(\d{4})[-/](\d{2})[-/](\d{2})$/)
    const swedish = raw.match(/^(\d{2})[/.](\d{2})[/.](\d{4})$/)
    const value = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : swedish ? `${swedish[3]}-${swedish[2]}-${swedish[1]}` : ''
    return isInvoiceDate(value) ? value : null
  }
  const issued = date('fakturadatum|invoice date'), due = date('förfallodatum|förfaller|due date')
  if (issued) result.invoiceDate = issued
  if (due) result.dueDate = due
  const net = labelled('netto(?:belopp)?|summa (?:exkl(?:usive)?\\.?\\s*moms)|belopp (?:exkl(?:usive)?\\.?\\s*moms)|exkl(?:usive)?\\.?\\s*moms')
  const vat = labelled('moms(?:belopp)?|vat(?: amount)?')
  if (net !== null) { const parsed = parseInvoiceAmount(net); if (parsed !== null) result.netAmountOre = parsed }
  if (vat !== null) { const parsed = parseInvoiceAmount(vat); if (parsed !== null) result.vatAmountOre = parsed }
  if (lines.some((line) => /^kreditfaktura\b|^credit (?:invoice|note)\b/i.test(line))) result.documentKind = 'credit'
  return result
}

export function invoiceSignedAmount(invoice: Pick<SupplierInvoiceDraft, 'documentKind'>, ore: number): number {
  return invoice.documentKind === 'credit' ? -ore : ore
}

export function invoiceAllocatedOre(invoice: Pick<SupplierInvoiceDraft, 'allocations'>, caseId?: string): number {
  return invoice.allocations.filter((row) => !caseId || row.caseId === caseId).reduce((sum, row) => sum + row.amountOre, 0)
}

export function invoiceUnallocatedOre(invoice: Pick<SupplierInvoiceDraft, 'netAmountOre' | 'allocations'>): number {
  return invoice.netAmountOre - invoiceAllocatedOre(invoice)
}

export function summarizeSupplierInvoices(invoices: readonly SupplierInvoice[], today: string) {
  const active = invoices.filter((invoice) => invoice.approvalStatus !== 'void')
  return active.reduce((total, invoice) => {
    const gross = invoice.netAmountOre + invoice.vatAmountOre
    total.registeredNetCostOre += invoiceSignedAmount(invoice, invoice.netAmountOre)
    if (invoice.approvalStatus === 'approved') total.approvedNetCostOre += invoiceSignedAmount(invoice, invoice.netAmountOre)
    if (invoice.paymentStatus === 'unpaid') {
      total.unpaidGrossOre += invoiceSignedAmount(invoice, gross)
      // Unsettled credits are not assumed to have paid an overdue debit invoice.
      if (invoice.documentKind === 'invoice' && invoice.dueDate && invoice.dueDate < today) total.overdueGrossOre += gross
    }
    total.unallocatedNetOre += invoiceUnallocatedOre(invoice)
    total.count += 1
    return total
  }, { registeredNetCostOre: 0, approvedNetCostOre: 0, unpaidGrossOre: 0, overdueGrossOre: 0, unallocatedNetOre: 0, count: 0 })
}

/** Invoice costs do not include time, commitments or unreceived invoices; this is not a forecast. */
export function getProjectInvoiceEconomy(actionCase: ActionCaseView, invoices: readonly SupplierInvoice[]) {
  const projectInvoices = invoices.filter((invoice) => invoice.approvalStatus !== 'void' && invoice.allocations.some((row) => row.caseId === actionCase.id))
  const actualFor = (itemId: string | null) => projectInvoices.reduce((sum, invoice) => sum + invoiceSignedAmount(invoice, invoice.allocations
    .filter((row) => row.caseId === actionCase.id && row.itemId === itemId).reduce((n, row) => n + row.amountOre, 0)), 0)
  const rows: Array<{ itemId: string | null; title: string; estimatedCostOre: number | null; actualCostOre: number; remainingEstimateOre: number | null }> = actionCase.items.map((item) => {
    const estimate = item.status === 'declined' || item.status === 'cancelled' ? 0
      : item.estimatedCost !== null && Number.isFinite(item.estimatedCost) ? Math.round(item.estimatedCost * 100) : null
    const actual = actualFor(item.id)
    return { itemId: item.id, title: item.title, estimatedCostOre: estimate, actualCostOre: actual, remainingEstimateOre: estimate === null ? null : estimate - actual }
  })
  const directCost = actualFor(null)
  if (projectInvoices.some((invoice) => invoice.allocations.some((row) => row.caseId === actionCase.id && row.itemId === null))) {
    rows.push({ itemId: null, title: 'Gemensamt för projektet', estimatedCostOre: null, actualCostOre: directCost, remainingEstimateOre: null })
  }
  const itemRows = rows.filter((row) => row.itemId !== null)
  const estimatedCostOre = itemRows.length && itemRows.every((row) => row.estimatedCostOre !== null)
    ? itemRows.reduce((sum, row) => sum + row.estimatedCostOre!, 0) : null
  const actualCostOre = projectInvoices.reduce((sum, invoice) => sum + invoiceSignedAmount(invoice, invoiceAllocatedOre(invoice, actionCase.id)), 0)
  return { estimatedCostOre, actualCostOre, remainingEstimateOre: estimatedCostOre === null ? null : estimatedCostOre - actualCostOre, rows, invoiceCount: projectInvoices.length }
}
