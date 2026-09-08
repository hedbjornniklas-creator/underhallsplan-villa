import type { ActionCaseQuote } from './contracts'

const invalid = (): never => { throw new Error('ACTION_CASE_QUOTE_INVALID') }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function quoteId(value: unknown) { if (typeof value !== 'string' || !uuid.test(value)) return invalid(); return value }
function text(value: unknown, max = 4000) {
  if (value == null) return ''
  if (typeof value !== 'string' || value.trim().length > max) return invalid()
  return value.trim()
}
function ids(value: unknown) {
  if (value == null) return []
  if (!Array.isArray(value) || value.length > 30) return invalid()
  return [...new Set(value.map(quoteId))].sort()
}
function date(value: unknown) {
  if (!value) return null
  const result = text(value, 10)
  const parsed = new Date(`${result}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== result) return invalid()
  return result
}
const inclusion = (value: unknown): ActionCaseQuote['materials'] => {
  if (value == null) return 'unspecified'
  if (!['included', 'excluded', 'unspecified'].includes(String(value))) return invalid()
  return value as ActionCaseQuote['materials']
}
export function normalizeQuote(input: Record<string, unknown>) {
  const supplierName = text(input.supplierName, 200)
  const supplierEmail = text(input.supplierEmail, 254).toLowerCase() || null
  if (!supplierName || (supplierEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(supplierEmail))) return invalid()
  const rawAmount = input.amount
  const amount = rawAmount == null || (typeof rawAmount === 'string' && !rawAmount.trim()) ? null : Number(rawAmount)
  if (amount !== null && (!['number', 'string'].includes(typeof rawAmount) || !Number.isFinite(amount) || amount < 0 || amount > 999999999999.99)) return invalid()
  const checked = input.checked === true
  const offeredScope = text(input.offeredScope)
  if (checked && (amount === null || !offeredScope)) return invalid()
  return {
    id: quoteId(input.quoteId), supplierName, supplierEmail, amount, checked, offeredScope,
    exclusions: text(input.exclusions), validUntil: date(input.validUntil), availableFrom: date(input.availableFrom),
    materials: inclusion(input.materials), travel: inclusion(input.travel), waste: inclusion(input.waste),
    coveredLineIds: ids(input.coveredLineIds), documentId: input.documentId ? quoteId(input.documentId) : null,
    requestSubject: text(input.requestSubject, 200).replace(/[\r\n]/g, ' '),
    requestBody: text(input.requestBody, 12000), requestAttachmentIds: ids(input.requestAttachmentIds),
    expectedUpdatedAt: input.expectedUpdatedAt ? text(input.expectedUpdatedAt, 50) : null,
  }
}
export function quoteIsStale(quote: ActionCaseQuote, scope: string | null, description: string, today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })) {
  return quote.scopeSnapshot !== (scope ?? '') || quote.descriptionSnapshot !== description || Boolean(quote.validUntil && quote.validUntil < today)
}
export function quoteRequestText(description: string) {
  return `Hej!\n\nVi önskar offert på följande arbete:\n${description}\n\nAnge pris exklusive moms, arbetets omfattning, vad som ingår av material, resor och avfall, eventuella undantag, offertens giltighet och möjlig utförandetid.\n\nDetta är en offertförfrågan, inte en beställning.`
}
export function quoteRequestHtml(subject: string, body: string) {
  const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
  return `<h2>${escape(subject)}</h2><div style="white-space:pre-wrap;font:16px/1.5 Arial,sans-serif">${escape(body)}</div>`
}

export const QUOTE_VIEW_COLUMNS = 'id,cost_line_id,supplier_name,supplier_email,amount,offered_scope,exclusions,valid_until,available_from,materials,travel,waste,covered_line_ids,document_id,checked,scope_snapshot,description_snapshot,request_subject,request_body,request_attachment_ids,delivery_status,sent_at,updated_at'
export function mapQuote(row: Record<string, unknown>): ActionCaseQuote {
  return {
    id: String(row.id), supplierName: String(row.supplier_name), supplierEmail: row.supplier_email ? String(row.supplier_email) : null,
    amount: row.amount == null ? null : Number(row.amount), offeredScope: String(row.offered_scope ?? ''), exclusions: String(row.exclusions ?? ''),
    validUntil: row.valid_until ? String(row.valid_until) : null, availableFrom: row.available_from ? String(row.available_from) : null,
    materials: row.materials as ActionCaseQuote['materials'], travel: row.travel as ActionCaseQuote['travel'], waste: row.waste as ActionCaseQuote['waste'],
    coveredLineIds: (row.covered_line_ids ?? []) as string[], documentId: row.document_id ? String(row.document_id) : null,
    checked: Boolean(row.checked), scopeSnapshot: String(row.scope_snapshot ?? ''), descriptionSnapshot: String(row.description_snapshot ?? ''),
    requestSubject: String(row.request_subject ?? ''), requestBody: String(row.request_body ?? ''), requestAttachmentIds: (row.request_attachment_ids ?? []) as string[],
    deliveryStatus: row.delivery_status as ActionCaseQuote['deliveryStatus'], sentAt: row.sent_at ? String(row.sent_at) : null, updatedAt: String(row.updated_at),
  }
}
