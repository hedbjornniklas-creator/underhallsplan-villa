import type { ActionCaseStatus } from './contracts'

export type InvoiceBasisLine = { id: string; description: string; quantity: number | null; unit: string; unitPriceOre: number | null; vatRate: number }
export type InvoiceBasis = { version: 1; title: string; date: string; period: string; issuer: string; recipient: string; note: string; lines: InvoiceBasisLine[] }
export type InvoiceBasisRecord = { id: string; revision: number; body: InvoiceBasis; updatedAt: string; sourceLineIds?: string[] }
export type ProjectCompletionWorkspace = {
  available: boolean; userId: string; canManage: boolean; status: ActionCaseStatus; revision: number
  workComplete: boolean; invoiced: boolean; completedAt: string | null; openQuestions: number | null
  bases: InvoiceBasisRecord[]; events: Array<{ id: string; operation: string; actor: string; at: string }>
  defaults: { issuer: string; recipient: string }
}
export const administrationUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
function invalid(): never { throw new Error('PROJECT_ADMIN_INVALID') }
function text(value: unknown, max: number) { if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) invalid(); return value.trim() }
export function invoiceBasisDate(value: string) { return /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
export function normalizeInvoiceBasis(input: unknown): InvoiceBasis {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid()
  const b = input as Record<string, unknown>
  if (b.version !== 1 || !Array.isArray(b.lines) || b.lines.length > 100 || typeof b.date !== 'string' || !invoiceBasisDate(b.date)) invalid()
  const lines = b.lines.map((line): InvoiceBasisLine => {
    if (!line || typeof line !== 'object' || !administrationUuid(line.id) || ![0, 6, 12, 25].includes(line.vatRate)) invalid()
    if (line.quantity !== null && (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity < 0 || line.quantity > 1e6 || Math.abs(line.quantity * 10000 - Math.round(line.quantity * 10000)) > 0.0001)) invalid()
    if (line.unitPriceOre !== null && (!Number.isSafeInteger(line.unitPriceOre) || Math.abs(line.unitPriceOre) > 1e12)) invalid()
    const row = { id: line.id, description: text(line.description, 1500), quantity: line.quantity, unit: text(line.unit, 30), unitPriceOre: line.unitPriceOre, vatRate: line.vatRate }
    if (row.quantity !== null && row.unitPriceOre !== null && Math.abs(Math.round(row.quantity * row.unitPriceOre)) > 1e12) invalid()
    return row
  })
  if (new Set(lines.map(l => l.id)).size !== lines.length) invalid()
  const body: InvoiceBasis = { version: 1, title: text(b.title, 200), date: b.date, period: text(b.period, 200), issuer: text(b.issuer, 1500), recipient: text(b.recipient, 1500), note: text(b.note, 10000), lines }
  const totals = invoiceBasisTotals(body)
  if (Math.max(Math.abs(totals.netOre), Math.abs(totals.vatOre), Math.abs(totals.grossOre)) > 1e12) invalid()
  return body
}
export function invoiceBasisTotals(body: InvoiceBasis) {
  const roundOre = (value: number) => Math.sign(value) * Math.round(Math.abs(value))
  let netOre = 0, vatOre = 0
  let complete = Boolean(body.title.trim() && body.issuer.trim() && body.recipient.trim() && body.lines.length)
  const lines = body.lines.map(line => {
    const net = line.quantity === null || line.unitPriceOre === null ? null : roundOre(line.quantity * line.unitPriceOre)
    if (net === null || !line.description.trim()) complete = false
    const vat = net === null ? null : roundOre(net * line.vatRate / 100)
    netOre += net ?? 0; vatOre += vat ?? 0
    return { ...line, netOre: net, vatOre: vat }
  })
  return { complete, netOre, vatOre, grossOre: netOre + vatOre, lines }
}
export function emptyInvoiceBasis(defaults: ProjectCompletionWorkspace['defaults']): InvoiceBasis {
  return { version: 1, title: 'Fakturaunderlag', date: new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' }), period: '', issuer: defaults.issuer, recipient: defaults.recipient, note: '', lines: [] }
}
export function projectCompletionBlockers(data: ProjectCompletionWorkspace) {
  return [!data.workComplete && 'Arbetet är inte klarmarkerat.', !data.invoiced && 'Slutfaktureringen är inte bekräftad.', data.openQuestions === null ? 'Frågestatus är inte tillgänglig.' : data.openQuestions > 0 && `${data.openQuestions} frågor är inte avslutade.`].filter(Boolean) as string[]
}
export const administrationLabels: Record<string, string> = { flags: 'Slutmarkeringar ändrade', complete: 'Projekt avslutat', reopen: 'Projekt återöppnat', save_basis: 'Fakturaunderlag sparat' }
