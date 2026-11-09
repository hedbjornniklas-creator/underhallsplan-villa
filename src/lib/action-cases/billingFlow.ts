// @ts-expect-error Shared with Node strip-types tests.
import { administrationUuid, invoiceBasisDate } from './projectCompletion.ts'

export type BillingRate = 0 | 6 | 12 | 25
export type BillingCandidate = {
  key: string; title: string; group: 'base' | 'change'; mode: 'fixed' | 'running' | 'budget'
  fixedGrossOre: number | null; hourlyGrossOre: number | null; markupPercent: number | null
  budgetGrossOre: number | null; reference: string; conditions: string; fingerprint: string
}
export type BillingAgreement = BillingCandidate & {
  id: string; version: number; vatRate: BillingRate; evidence: string; approvedBy: string; approvedOn: string
}
export type BillingSupplierSource = {
  key: string; invoiceId: string; allocationId: string; revision: number; targetKey: string
  title: string; date: string; netOre: number; reviewed: boolean; original: boolean; legacy: boolean; fingerprint?: string
}
export type BillingCost = {
  id: string; agreementId: string; description: string; date: string; kind: 'purchase' | 'hours'
  internalNetOre: number | null; hoursUnits: number | null; evidence: string; missingEvidenceReason: string
  supplier: BillingSupplierSource | null; reviewed: boolean; waived: boolean
}
export type BillingEntry = {
  id: string; agreementId: string; costId: string | null; description: string; date: string
  netOre: number; vatRate: BillingRate; waivedOre: number; adjustedOre?: number; dependsOn: string | null
  creditsEntryId: string | null; creditKind: 'reduction' | 'rebill' | null; superseded: boolean
}
export type BillingBasisLine = { id: string; entryId: string; description: string; netOre: number; vatRate: BillingRate }
export type BillingBasis = {
  id: string; version: 1; title: string; date: string; issuer: string; recipient: string; note: string; projectTitle: string
  status: 'reserved' | 'exported' | 'cancelled'; lines: BillingBasisLine[]; exportedAt: string | null; cancellationReason: string; historical: boolean
}
export type BillingInvoice = {
  id: string; number: string; date: string; issuer: string; kind: 'invoice' | 'credit'; externalNetOre: number; note: string
  lines: { basisId: string; lineId: string; netOre: number }[]
}
export type BillingReview = { agreementKey: string; date: string; participants: string; decision: string; evidence: string; reviewedForecastOre: number; remainingOre: number }
export type BillingFlow = {
  version: 1; legacyConfirmed: boolean; legacyNote: string; economyClosed: boolean
  agreements: BillingAgreement[]; costs: BillingCost[]; entries: BillingEntry[]; bases: BillingBasis[]; invoices: BillingInvoice[]; reviews: BillingReview[]
  releases: { id: string; basisId: string; lineId: string; netOre: number; reason: string; date: string }[]
}
export type BillingContext = {
  candidates: BillingCandidate[]; suppliers: BillingSupplierSource[]; canManage: boolean; cancelled: boolean
  legacyCount: number; openQuestions: number; baseFixedGrossOre: number | null; issuer: string; recipient: string; projectTitle?: string
}
export type BillingWorkspace = BillingContext & {
  available: boolean; revision: number; contextHash: string; userId: string; title: string; flow: BillingFlow
  history: { id: string; operation: string; actor: string; at: string }[]
}
export const emptyBillingFlow = (): BillingFlow => ({ version: 1, legacyConfirmed: false, legacyNote: '', economyClosed: false, agreements: [], costs: [], entries: [], bases: [], invoices: [], reviews: [], releases: [] })
export const billingMoney = (ore: number) => `${((ore || 0) / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
export function billingFail(code = 'INVALID'): never { throw new Error(`BILLING_${code}`) }
const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : billingFail()
const text = (v: unknown, max = 1500, required = false) => typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v) && (!required || v.trim()) ? v.trim() : billingFail()
const id = (v: unknown) => administrationUuid(v) ? v : billingFail()
const amount = (v: unknown, negative = false): number => Number.isSafeInteger(v) && Math.abs(Number(v)) <= 100_000_000_000 && (negative || Number(v) >= 0) ? Number(v) : billingFail()
const date = (v: unknown) => typeof v === 'string' && invoiceBasisDate(v) ? v : billingFail()
const rate = (v: unknown): BillingRate => [0, 6, 12, 25].includes(Number(v)) && typeof v === 'number' ? v as BillingRate : billingFail()
const sameSign = (a: number, b: number) => Math.sign(a) === Math.sign(b)

// Integer arithmetic: never round the markup, quantity and VAT repeatedly.
export function billingRound(numerator: bigint, denominator: bigint): number {
  if (denominator <= BigInt(0)) return billingFail()
  const sign = numerator < BigInt(0) ? BigInt(-1) : BigInt(1), n = numerator * sign
  const result = Number(sign * ((n + denominator / BigInt(2)) / denominator))
  return amount(result, true)
}
export const billingNet = (gross: number, vat: BillingRate) => billingRound(BigInt(amount(gross, true)) * BigInt(100), BigInt(100 + vat))
export function billingTotals(lines: { netOre: number; vatRate: BillingRate }[]) {
  const buckets = new Map<BillingRate, number>()
  for (const l of lines) buckets.set(l.vatRate, amount((buckets.get(l.vatRate) ?? 0) + amount(l.netOre, true), true))
  const netOre = amount(lines.reduce((s, l) => s + l.netOre, 0), true)
  const vatOre = amount([...buckets].reduce((s, [r, n]) => s + billingRound(BigInt(n) * BigInt(r), BigInt(100)), 0), true)
  return { netOre, vatOre, grossOre: amount(netOre + vatOre, true) }
}
export function billingParseAmount(value: string): number | null {
  const s = value.trim().replace(',', '.')
  if (!s) return null
  if (!/^-?\d{1,10}(?:\.\d{1,2})?$/.test(s)) return billingFail()
  const [whole, fraction = ''] = s.replace('-', '').split('.')
  return amount((s.startsWith('-') ? -1 : 1) * (Number(whole) * 100 + Number(fraction.padEnd(2, '0'))), true)
}
function agreement(flow: BillingFlow, agreementId: unknown) {
  return flow.agreements.find(a => a.id === id(agreementId)) ?? billingFail('AGREEMENT_REQUIRED')
}
function entry(flow: BillingFlow, entryId: unknown) { return flow.entries.find(e => e.id === id(entryId)) ?? billingFail('NOT_FOUND') }
function cost(flow: BillingFlow, costId: unknown) { return flow.costs.find(c => c.id === id(costId)) ?? billingFail('NOT_FOUND') }
export function billingFixedRemaining(flow: BillingFlow, a: BillingAgreement) {
  const latest = [...flow.agreements].reverse().find(v => v.key === a.key) ?? a
  if (latest.mode !== 'fixed' || latest.fixedGrossOre === null) return 0
  const rows = flow.entries.filter(e => !e.superseded && agreement(flow, e.agreementId).key === a.key)
  const reductions = rows.filter(e => e.agreementId === latest.id && e.creditKind === 'reduction').reduce((s, e) => s + e.netOre, 0)
  return billingNet(latest.fixedGrossOre, latest.vatRate) + reductions - rows.reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0)
}
export function billingPosted(flow: BillingFlow, basisId: string, lineId: string) {
  return flow.invoices.flatMap(i => i.lines).filter(l => l.basisId === basisId && l.lineId === lineId).reduce((s, l) => s + l.netOre, 0)
}
export function billingBasisRemaining(flow: BillingFlow, basisId: string, lineId: string) {
  const line = flow.bases.find(b => b.id === basisId && b.status !== 'cancelled')?.lines.find(l => l.id === lineId)
  return line ? line.netOre - billingPosted(flow, basisId, lineId) - flow.releases.filter(r => r.basisId === basisId && r.lineId === lineId).reduce((s, r) => s + r.netOre, 0) : 0
}
export function billingSameSource(a: BillingSupplierSource | undefined, b: BillingSupplierSource) {
  return !!a && a.key === b.key && (a.fingerprint && b.fingerprint ? a.fingerprint === b.fingerprint : a.revision === b.revision) && a.netOre === b.netOre && a.targetKey === b.targetKey
}
export function billingEntryBalance(flow: BillingFlow, e: BillingEntry): { reservedOre: number; invoicedOre: number; availableOre: number; blocked: boolean } {
  const lines = flow.bases.filter(b => b.status !== 'cancelled').flatMap(b => b.lines.filter(l => l.entryId === e.id).map(l => ({ b, l })))
  const reservedOre = lines.reduce((s, { b, l }) => s + billingBasisRemaining(flow, b.id, l.id), 0)
  const invoicedOre = lines.reduce((s, { b, l }) => s + billingPosted(flow, b.id, l.id), 0)
  const dependency = e.dependsOn ? entry(flow, e.dependsOn) : null
  const blocked = dependency ? billingEntryBalance(flow, dependency).invoicedOre !== dependency.netOre : false
  return { reservedOre, invoicedOre, availableOre: blocked || e.superseded ? 0 : e.netOre - e.waivedOre - (e.adjustedOre ?? 0) - reservedOre - invoicedOre, blocked }
}
export function billingCostCharge(c: BillingCost, a: BillingAgreement): number {
  if (a.mode === 'fixed') return billingFail('FIXED_COST')
  if (c.kind === 'hours') {
    if (a.hourlyGrossOre === null || c.hoursUnits === null) return billingFail('TERMS_REQUIRED')
    return billingRound(BigInt(c.hoursUnits) * BigInt(a.hourlyGrossOre) * BigInt(100), BigInt(10000) * BigInt(100 + a.vatRate))
  }
  if (c.internalNetOre === null || a.markupPercent === null) return billingFail('TERMS_REQUIRED')
  return billingRound(BigInt(c.internalNetOre) * BigInt(10000 + Math.round(a.markupPercent * 100)), BigInt(10000))
}
export function billingBudget(flow: BillingFlow, key: string, remainingOre?: number) {
  const a = [...flow.agreements].reverse().find(v => v.key === key)
  if (!a || a.mode !== 'budget' || a.budgetGrossOre === null) return null
  const budgetOre = billingNet(a.budgetGrossOre, a.vatRate)
  const accruedOre = flow.entries.filter(e => !e.superseded && agreement(flow, e.agreementId).key === key).reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0)
  const review = [...flow.reviews].reverse().find(r => r.agreementKey === key)
  const remaining = remainingOre ?? review?.remainingOre ?? 0, forecastOre = accruedOre + remaining
  return { budgetOre, accruedOre, forecastOre, remainingOre: remaining, remainingKnown: remainingOre !== undefined || !!review, needsReview: accruedOre >= Math.ceil(budgetOre * .8) || forecastOre > budgetOre, review,
    covered: Boolean(review && review.reviewedForecastOre >= forecastOre) }
}
function requireOpen(flow: BillingFlow) { if (flow.economyClosed) billingFail('ECONOMY_CLOSED') }
export function billingMatchesTarget(s: BillingSupplierSource, a: BillingAgreement) {
  return s.targetKey === a.key || a.key.startsWith(s.targetKey + ':') || s.targetKey === 'base:common' && a.group === 'base' || a.group === 'base' && (a.key === 'base:running' || a.mode === 'fixed' && (a.key === 'base:total' || a.key.startsWith('base:payment:'))) && s.targetKey.startsWith('base:')
}
function costOrigin(flow: BillingFlow, e: BillingEntry): string | null {
  if (e.costId) return e.costId
  const credit = e.creditsEntryId ? entry(flow, e.creditsEntryId) : e.dependsOn ? entry(flow, e.dependsOn) : null
  return credit ? costOrigin(flow, credit) : null
}
function creditRoom(flow: BillingFlow, costId: string) {
  const entries = flow.entries.filter(e => !e.superseded && costOrigin(flow, e) === costId)
  return entries.reduce((s, e) => s + (e.netOre > 0 ? billingEntryBalance(flow, e).invoicedOre : e.netOre - e.waivedOre), 0)
}
function unique(flow: BillingFlow, value: unknown) {
  const uuid = id(value)
  if ([...flow.agreements, ...flow.costs, ...flow.entries, ...flow.bases, ...flow.invoices].some(v => v.id === uuid)) billingFail('DUPLICATE')
  return uuid
}
function proof(v: unknown) { return text(v, 2000, true) }

export function applyBillingCommand(previous: BillingFlow, input: unknown, ctx: BillingContext, now: string): BillingFlow {
  if (!ctx.canManage || ctx.cancelled) billingFail('FORBIDDEN')
  const flow = structuredClone(previous), cmd = object(input), op = text(cmd.operation, 40, true)
  if (op === 'confirm_legacy') {
    flow.legacyNote = proof(cmd.note); flow.legacyConfirmed = true
    return flow
  }
  if (op !== 'reopen_economy' && op !== 'save_cost' && op !== 'match_supplier') requireOpen(flow)
  if (ctx.legacyCount && !flow.legacyConfirmed && !['save_cost', 'register_agreement', 'record_opening_invoice'].includes(op)) billingFail('LEGACY_REVIEW')
  if (op === 'register_agreement') {
    const candidate = ctx.candidates.find(v => v.key === cmd.key) ?? billingFail('AGREEMENT_REQUIRED')
    if (candidate.fingerprint !== cmd.fingerprint) billingFail('SOURCE_CHANGED')
    const existing = flow.agreements.filter(a => a.key === candidate.key)
    const version = existing.length + 1
    if (existing.at(-1)?.fingerprint === candidate.fingerprint) billingFail('DUPLICATE')
    const a: BillingAgreement = { ...candidate, id: unique(flow, cmd.id), version, vatRate: rate(cmd.vatRate), evidence: proof(cmd.evidence), approvedBy: text(cmd.approvedBy, 250, true), approvedOn: date(cmd.approvedOn) }
    if (a.mode === 'fixed' && a.fixedGrossOre === null) billingFail('TERMS_REQUIRED')
    flow.agreements.push(a)
    // Payment-plan rows and fixed work rows share the base-contract ceiling.
    if (ctx.baseFixedGrossOre !== null) {
      const latest = new Map(flow.agreements.map(v => [v.key, v]))
      const fixed = [...latest.values()].filter(v => v.group === 'base' && v.mode === 'fixed').reduce((s, v) => s + (v.fixedGrossOre ?? 0), 0)
      if (fixed > ctx.baseFixedGrossOre) billingFail('BASE_LIMIT')
    }
  } else if (op === 'save_cost') {
    const old = flow.costs.find(c => c.id === cmd.id)
    if (old && (old.reviewed || flow.entries.some(e => e.costId === old.id && !e.superseded))) billingFail('SOURCE_IN_USE')
    if (old?.supplier && cmd.supplierKey !== old.supplier.key) billingFail('SOURCE_IN_USE')
    const a = agreement(flow, cmd.agreementId), kind = cmd.kind
    if (kind !== 'purchase' && kind !== 'hours') billingFail()
    const supplier = cmd.supplierKey ? ctx.suppliers.find(s => s.key === cmd.supplierKey) ?? billingFail('SOURCE_CHANGED') : null
    if (supplier && (supplier.legacy || !billingMatchesTarget(supplier, a) || flow.costs.some(c => c.id !== cmd.id && c.supplier?.key === supplier.key))) billingFail('SOURCE_IN_USE')
    const c: BillingCost = { id: old?.id ?? unique(flow, cmd.id), agreementId: a.id, kind, description: text(cmd.description, 1500, true), date: date(cmd.date), internalNetOre: supplier ? supplier.netOre : cmd.internalNetOre === null ? null : amount(cmd.internalNetOre),
      hoursUnits: kind === 'hours' ? amount(cmd.hoursUnits) : null, evidence: text(cmd.evidence, 2000), missingEvidenceReason: text(cmd.missingEvidenceReason, 2000), supplier: supplier ? structuredClone(supplier) : null, reviewed: false, waived: false }
    if (kind === 'purchase' && c.internalNetOre === null || kind === 'hours' && (!c.hoursUnits || supplier)) billingFail()
    flow.costs = [...flow.costs.filter(v => v.id !== c.id), c]
    if (flow.economyClosed) flow.economyClosed = false
  } else if (op === 'unreview_cost') {
    const c = cost(flow, cmd.id)
    proof(cmd.reason)
    for (const e of flow.entries.filter(e => e.costId === c.id && !e.superseded)) {
      const b = billingEntryBalance(flow, e)
      if (b.reservedOre || b.invoicedOre) billingFail('SOURCE_IN_USE')
      e.superseded = true
    }
    c.reviewed = false; c.waived = false
  } else if (op === 'waive_cost') {
    const c = cost(flow, cmd.id)
    proof(cmd.reason)
    if (flow.entries.filter(e => e.costId === c.id).some(e => billingEntryBalance(flow, e).availableOre || billingEntryBalance(flow, e).reservedOre)) billingFail('BALANCE')
    c.waived = true
  } else if (op === 'review_cost') {
    const c = cost(flow, cmd.id)
    if (c.supplier) {
      const live = ctx.suppliers.find(s => s.key === c.supplier!.key)
      if (!billingSameSource(live, c.supplier) || !live!.reviewed || live!.legacy) billingFail('SOURCE_CHANGED')
      c.supplier = structuredClone(live!)
    }
    if (!c.evidence && !c.supplier?.original && !c.missingEvidenceReason) billingFail('EVIDENCE_REQUIRED')
    if (cmd.confirmed !== true) billingFail('CONFIRM_REQUIRED')
    c.reviewed = true
  } else if (op === 'match_supplier') {
    const c = cost(flow, cmd.id), s = ctx.suppliers.find(v => v.key === cmd.supplierKey) ?? billingFail('SOURCE_CHANGED')
    if (c.kind !== 'purchase' || !billingMatchesTarget(s, agreement(flow, c.agreementId)) || s.legacy || flow.costs.some(v => v.id !== c.id && v.supplier?.key === s.key)) billingFail('SOURCE_IN_USE')
    if (c.supplier && c.supplier.key !== s.key) billingFail('SOURCE_IN_USE')
    proof(cmd.reason)
    for (const e of flow.entries.filter(e => e.costId === c.id && !e.superseded)) {
      const b = billingEntryBalance(flow, e)
      if (b.reservedOre) billingFail('SOURCE_IN_USE')
      if (!b.invoicedOre) e.superseded = true
      else if (b.availableOre) e.adjustedOre = (e.adjustedOre ?? 0) + b.availableOre
    }
    c.supplier = structuredClone(s); c.internalNetOre = s.netOre; c.reviewed = false
    if (flow.economyClosed) flow.economyClosed = false
  } else if (op === 'create_entry') {
    const a = agreement(flow, cmd.agreementId), eid = unique(flow, cmd.id)
    let netOre: number, description: string, costId: string | null = null
    if (a.mode === 'fixed') {
      if (cmd.costId) billingFail('FIXED_COST')
      netOre = amount(cmd.netOre); description = text(cmd.description, 1500, true)
      proof(cmd.fulfilled)
      if (netOre > billingFixedRemaining(flow, a)) billingFail('PRICE_LIMIT')
    } else {
      const c = cost(flow, cmd.costId); costId = c.id; description = c.description
      if (c.agreementId !== a.id || !c.reviewed || c.waived) billingFail('NOT_REVIEWED')
      if (c.supplier) {
        const live = ctx.suppliers.find(s => s.key === c.supplier!.key)
        if (!billingSameSource(live, c.supplier) || !live!.reviewed) billingFail('SOURCE_CHANGED')
      }
      netOre = billingCostCharge(c, a) - flow.entries.filter(e => e.costId === c.id && !e.superseded).reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0)
      if (!netOre && flow.entries.some(e => e.costId === c.id)) billingFail('DUPLICATE')
      if (netOre < 0) { proof(cmd.reason); if (flow.entries.some(e => e.costId === c.id && !e.superseded) && -netOre > creditRoom(flow, c.id)) billingFail('CREDIT_LIMIT') }
    }
    flow.entries.push({ id: eid, agreementId: a.id, costId, description, date: date(cmd.date), netOre, vatRate: a.vatRate, waivedOre: 0, dependsOn: null, creditsEntryId: null, creditKind: null, superseded: false })
  } else if (op === 'credit_entry') {
    const original = entry(flow, cmd.entryId), balance = billingEntryBalance(flow, original)
    const n = amount(cmd.netOre)
    if (original.netOre <= 0 || n <= 0 || n > balance.invoicedOre) billingFail('CREDIT_LIMIT')
    proof(cmd.reason)
    const credited = flow.entries.filter(e => e.creditsEntryId === original.id).reduce((s, e) => s + Math.abs(e.netOre), 0)
    if (credited + n > balance.invoicedOre) billingFail('CREDIT_LIMIT')
    const sourceCostId = costOrigin(flow, original)
    if (sourceCostId && n > creditRoom(flow, sourceCostId)) billingFail('CREDIT_LIMIT')
    const creditId = unique(flow, cmd.id)
    flow.entries.push({ ...original, id: creditId, costId: null, date: date(cmd.date), description: `Kredit: ${proof(cmd.reason)}`, netOre: -n, waivedOre: 0, adjustedOre: 0, dependsOn: null, creditsEntryId: original.id, creditKind: cmd.rebill === true ? 'rebill' : 'reduction' })
    // A replacement is blocked until the actual credit invoice has been registered.
    if (cmd.rebill === true) flow.entries.push({ ...original, id: unique(flow, cmd.replacementId), costId: null, date: date(cmd.date), description: `Omfakturering: ${original.description}`, netOre: n, waivedOre: 0, adjustedOre: 0, dependsOn: creditId, creditsEntryId: null, creditKind: null })
  } else if (op === 'waive_entry') {
    const e = entry(flow, cmd.id), balance = billingEntryBalance(flow, e)
    proof(cmd.reason)
    const n = amount(cmd.netOre, true)
    if (!sameSign(n, balance.availableOre) || Math.abs(n) > Math.abs(balance.availableOre)) billingFail('BALANCE')
    e.waivedOre += n
  } else if (op === 'reserve_basis') {
    if (!Array.isArray(cmd.lines) || !cmd.lines.length || cmd.lines.length > 100) billingFail()
    const seen = new Set<string>()
    const lines: BillingBasisLine[] = cmd.lines.map(v => {
      const l = object(v), e = entry(flow, l.entryId), balance = billingEntryBalance(flow, e), n = amount(l.netOre, true)
      if (seen.has(e.id) || balance.blocked || !sameSign(n, balance.availableOre) || Math.abs(n) > Math.abs(balance.availableOre)) billingFail('BALANCE')
      seen.add(e.id)
      const a = agreement(flow, e.agreementId), budget = billingBudget(flow, a.key)
      if (budget?.needsReview && !budget.covered) billingFail('BUDGET_REVIEW')
      const c = flow.costs.find(c => c.id === e.costId)
      if (c && !c.reviewed) billingFail('NOT_REVIEWED')
      if (c?.supplier) {
        const live = ctx.suppliers.find(s => s.key === c.supplier!.key)
        if (!billingSameSource(live, c.supplier) || !live!.reviewed) billingFail('SOURCE_CHANGED')
      }
      return { id: id(l.id), entryId: e.id, description: e.description, netOre: n, vatRate: e.vatRate }
    })
    if (new Set(lines.map(l => l.id)).size !== lines.length) billingFail()
    if (lines.some(l => l.netOre < 0) && lines.some(l => l.netOre > 0)) billingFail('CREDIT_SEPARATE')
    flow.bases.push({ id: unique(flow, cmd.id), version: 1, title: text(cmd.title, 200, true), date: date(cmd.date), issuer: ctx.issuer || billingFail('PARTIES_REQUIRED'), recipient: ctx.recipient || billingFail('PARTIES_REQUIRED'), note: text(cmd.note, 6000), projectTitle: text(ctx.projectTitle || cmd.title, 1500, true), status: 'reserved', lines, exportedAt: null, cancellationReason: '', historical: false })
  } else if (op === 'release_basis') {
    const b = flow.bases.find(b => b.id === id(cmd.id) && b.status !== 'cancelled' && !b.historical) ?? billingFail('NOT_FOUND')
    if (cmd.confirmed !== true) billingFail('CONFIRM_REQUIRED')
    const reason = proof(cmd.reason)
    const remaining = b.lines.map(l => ({ l, n: billingBasisRemaining(flow, b.id, l.id) })).filter(v => v.n !== 0)
    if (!remaining.length) billingFail('BALANCE')
    if (!Array.isArray(cmd.releaseIds) || cmd.releaseIds.length !== remaining.length) billingFail()
    remaining.forEach(({ l, n }, i) => flow.releases.push({ id: id((cmd.releaseIds as unknown[])[i]), basisId: b.id, lineId: l.id, netOre: n, reason, date: date(cmd.date) }))
  } else if (op === 'record_opening_invoice') {
    if (!Array.isArray(cmd.lines) || !cmd.lines.length || cmd.lines.length > 100 || cmd.confirmed !== true) billingFail('CONFIRM_REQUIRED')
    const number = text(cmd.number, 100, true), invoiceId = unique(flow, cmd.id), basisId = unique(flow, cmd.basisId), invoiceDate = date(cmd.date), seen = new Set<string>()
    proof(cmd.note)
    if (!ctx.issuer || !ctx.recipient) billingFail('PARTIES_REQUIRED')
    if (flow.invoices.some(i => i.issuer === ctx.issuer && i.number.toLocaleLowerCase('sv') === number.toLocaleLowerCase('sv'))) billingFail('INVOICE_DUPLICATE')
    const lines: BillingBasisLine[] = cmd.lines.map(input => {
      const l = object(input), a = agreement(flow, l.agreementId), n = amount(l.netOre)
      if (a.mode !== 'fixed') billingFail('HISTORY_COST_REQUIRED')
      if (!n || seen.has(a.key)) billingFail(); seen.add(a.key)
      if (a.mode === 'fixed' && n > billingFixedRemaining(flow, a)) billingFail('PRICE_LIMIT')
      const eid = unique(flow, l.entryId)
      flow.entries.push({ id: eid, agreementId: a.id, costId: null, description: `Tidigare fakturerat: ${a.title}`, date: invoiceDate, netOre: n, vatRate: a.vatRate, waivedOre: 0, dependsOn: null, creditsEntryId: null, creditKind: null, superseded: false })
      return { id: id(l.id), entryId: eid, description: flow.entries.at(-1)!.description, netOre: n, vatRate: a.vatRate }
    })
    flow.bases.push({ id: basisId, version: 1, title: `Historisk faktura ${number}`, date: invoiceDate, issuer: ctx.issuer, recipient: ctx.recipient, note: proof(cmd.note), projectTitle: text(ctx.projectTitle || `Historisk faktura ${number}`, 1500, true), status: 'exported', lines, exportedAt: now, cancellationReason: '', historical: true })
    flow.invoices.push({ id: invoiceId, number, date: invoiceDate, issuer: ctx.issuer, kind: 'invoice', externalNetOre: amount(cmd.externalNetOre ?? 0), note: proof(cmd.note), lines: lines.map(l => ({ basisId, lineId: l.id, netOre: l.netOre })) })
  } else if (op === 'cancel_basis' || op === 'export_basis') {
    const b = flow.bases.find(b => b.id === id(cmd.id)) ?? billingFail('NOT_FOUND')
    if (b.status === 'cancelled') billingFail('CANCELLED')
    if (op === 'export_basis') { b.status = 'exported'; b.exportedAt ??= now }
    else {
      if (flow.invoices.some(i => i.lines.some(l => l.basisId === b.id))) billingFail('ALREADY_INVOICED')
      if (cmd.confirmed !== true) billingFail('CONFIRM_REQUIRED')
      b.cancellationReason = proof(cmd.reason); b.status = 'cancelled'
    }
  } else if (op === 'register_invoice') {
    if (!Array.isArray(cmd.lines) || !cmd.lines.length || cmd.lines.length > 500) billingFail()
    const number = text(cmd.number, 100, true), issuer = text(cmd.issuer, 1500, true), seen = new Set<string>()
    if (flow.invoices.some(i => i.issuer === issuer && i.number.toLocaleLowerCase('sv') === number.toLocaleLowerCase('sv'))) billingFail('INVOICE_DUPLICATE')
    const lines = cmd.lines.map(v => {
      const l = object(v), b = flow.bases.find(b => b.id === id(l.basisId) && b.status !== 'cancelled') ?? billingFail('NOT_FOUND')
      const row = b.lines.find(r => r.id === id(l.lineId)) ?? billingFail('NOT_FOUND'), n = amount(l.netOre, true), remaining = billingBasisRemaining(flow, b.id, row.id), key = `${b.id}:${row.id}`
      if (seen.has(key) || b.issuer !== issuer || !sameSign(n, remaining) || Math.abs(n) > Math.abs(remaining)) billingFail('BALANCE')
      seen.add(key)
      return { basisId: b.id, lineId: row.id, netOre: n }
    })
    const kind = cmd.kind
    if (kind !== 'invoice' && kind !== 'credit' || lines.some(l => kind === 'credit' ? l.netOre >= 0 : l.netOre < 0)) billingFail('CREDIT_SEPARATE')
    const externalNetOre = amount(cmd.externalNetOre, true)
    if (externalNetOre && (kind === 'credit' ? externalNetOre > 0 : externalNetOre < 0)) billingFail()
    if (externalNetOre) proof(cmd.note)
    if (cmd.confirmed !== true) billingFail('CONFIRM_REQUIRED')
    flow.invoices.push({ id: unique(flow, cmd.id), number, issuer, date: date(cmd.date), kind, externalNetOre, note: text(cmd.note, 2000), lines })
  } else if (op === 'budget_review') {
    const a = agreement(flow, cmd.agreementId), remainingOre = amount(cmd.remainingOre), budget = billingBudget(flow, a.key, remainingOre)
    if (!budget) billingFail('TERMS_REQUIRED')
    flow.reviews.push({ agreementKey: a.key, date: date(cmd.date), participants: text(cmd.participants, 500, true), decision: proof(cmd.decision), evidence: proof(cmd.evidence), reviewedForecastOre: budget.forecastOre, remainingOre })
  } else if (op === 'close_economy') {
    if (ctx.openQuestions || flow.costs.some(c => !c.reviewed && !c.waived) || flow.entries.filter(e => !e.superseded).some(e => {
      const b = billingEntryBalance(flow, e); return b.availableOre !== 0 || b.reservedOre !== 0 || b.blocked
    })) billingFail('INCOMPLETE')
    for (const c of flow.costs.filter(c => !c.waived)) {
      if (c.supplier && !billingSameSource(ctx.suppliers.find(s => s.key === c.supplier!.key), c.supplier)) billingFail('SOURCE_CHANGED')
      const a = agreement(flow, c.agreementId)
      if (a.mode !== 'fixed' && billingCostCharge(c, a) !== flow.entries.filter(e => e.costId === c.id && !e.superseded).reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0)) billingFail('INCOMPLETE')
    }
    for (const a of new Map(flow.agreements.map(a => [a.key, a])).values()) {
      if (a.mode !== 'fixed') continue
      const rows = flow.entries.filter(e => !e.superseded && agreement(flow, e.agreementId).key === a.key)
      const reductions = rows.filter(e => e.agreementId === a.id && e.creditKind === 'reduction').reduce((s, e) => s + e.netOre, 0)
      if (rows.reduce((s, e) => s + e.netOre - (e.adjustedOre ?? 0), 0) !== billingNet(a.fixedGrossOre!, a.vatRate) + reductions) billingFail('INCOMPLETE')
    }
    if (cmd.confirmed !== true) billingFail('CONFIRM_REQUIRED')
    flow.economyClosed = true
  } else if (op === 'reopen_economy') { proof(cmd.reason); flow.economyClosed = false }
  else billingFail()
  billingValidateFlow(flow)
  return flow
}

export function billingValidateFlow(input: unknown): asserts input is BillingFlow {
  const f = object(input)
  if (f.version !== 1 || typeof f.legacyConfirmed !== 'boolean' || typeof f.economyClosed !== 'boolean') billingFail()
  text(f.legacyNote, 2000)
  const arrays = ['agreements', 'costs', 'entries', 'bases', 'invoices', 'reviews', 'releases'] as const
  for (const key of arrays) if (!Array.isArray(f[key]) || f[key].length > (key === 'costs' || key === 'entries' ? 2000 : 500)) billingFail('LIMIT')
  if (JSON.stringify(f).length > 2_000_000) billingFail('LIMIT')
  const flow = input as BillingFlow, ids = new Set<string>()
  for (const v of [...flow.agreements, ...flow.costs, ...flow.entries, ...flow.bases, ...flow.invoices]) {
    if (ids.has(id(v.id))) billingFail('DUPLICATE'); ids.add(v.id)
  }
  for (const a of flow.agreements) {
    text(a.key, 250, true); text(a.title, 1500, true); proof(a.evidence); proof(a.approvedBy); date(a.approvedOn); rate(a.vatRate)
    if (!['fixed', 'running', 'budget'].includes(a.mode) || !['base', 'change'].includes(a.group) || !Number.isInteger(a.version) || a.version < 1) billingFail()
    for (const v of [a.fixedGrossOre, a.hourlyGrossOre, a.budgetGrossOre]) if (v !== null) amount(v)
    if (a.markupPercent !== null && (!Number.isFinite(a.markupPercent) || a.markupPercent < 0 || a.markupPercent > 1000 || Math.abs(a.markupPercent * 100 - Math.round(a.markupPercent * 100)) > .00001)) billingFail()
  }
  const sourceKeys = new Set<string>()
  for (const c of flow.costs) {
    agreement(flow, c.agreementId); text(c.description, 1500, true); date(c.date); text(c.evidence, 2000); text(c.missingEvidenceReason, 2000)
    if (c.internalNetOre !== null) amount(c.internalNetOre, true)
    if (c.hoursUnits !== null) amount(c.hoursUnits)
    if (!['purchase', 'hours'].includes(c.kind) || typeof c.reviewed !== 'boolean' || typeof c.waived !== 'boolean') billingFail()
    if (c.supplier) {
      if (sourceKeys.has(c.supplier.key)) billingFail('SOURCE_IN_USE'); sourceKeys.add(c.supplier.key)
      id(c.supplier.invoiceId); id(c.supplier.allocationId); amount(c.supplier.revision)
      if (c.supplier.netOre !== c.internalNetOre) billingFail()
    }
  }
  for (const e of flow.entries) {
    agreement(flow, e.agreementId); text(e.description, 1500, true); date(e.date); amount(e.netOre, true); amount(e.waivedOre, true); amount(e.adjustedOre ?? 0, true); rate(e.vatRate)
    if (typeof e.superseded !== 'boolean' || ![null, 'reduction', 'rebill'].includes(e.creditKind)) billingFail()
    if (e.creditsEntryId && (entry(flow, e.creditsEntryId).netOre <= 0 || e.netOre >= 0)) billingFail()
    if (e.costId) cost(flow, e.costId)
    if (e.dependsOn && (entry(flow, e.dependsOn).dependsOn || entry(flow, e.dependsOn).netOre >= 0)) billingFail()
  }
  for (const b of flow.bases) {
    date(b.date); text(b.title, 200, true); proof(b.issuer); proof(b.recipient); text(b.note, 6000); text(b.projectTitle, 1500, true)
    if (b.version !== 1 || typeof b.historical !== 'boolean' || !['reserved', 'exported', 'cancelled'].includes(b.status) || !b.lines.length || b.lines.length > 100) billingFail()
    if (new Set(b.lines.map(l => l.id)).size !== b.lines.length) billingFail()
    for (const l of b.lines) {
      id(l.id); const e = entry(flow, l.entryId)
      if (l.description !== e.description || l.vatRate !== e.vatRate || !sameSign(l.netOre, e.netOre) || Math.abs(amount(l.netOre, true)) > Math.abs(e.netOre)) billingFail()
    }
    billingTotals(b.lines)
  }
  for (const e of flow.entries) {
    const b = billingEntryBalance(flow, e)
    if (Math.abs(e.waivedOre + (e.adjustedOre ?? 0) + b.reservedOre + b.invoicedOre) > Math.abs(e.netOre)) billingFail('BALANCE')
  }
  const releases = new Set<string>()
  for (const r of flow.releases) {
    if (releases.has(id(r.id))) billingFail('DUPLICATE'); releases.add(r.id)
    date(r.date); proof(r.reason)
    const b = flow.bases.find(b => b.id === r.basisId) ?? billingFail(), l = b.lines.find(l => l.id === r.lineId) ?? billingFail()
    if (b.historical || !sameSign(amount(r.netOre, true), l.netOre) || Math.abs(billingBasisRemaining(flow, b.id, l.id)) > Math.abs(l.netOre)) billingFail('BALANCE')
    if (b.status !== 'cancelled' && billingBasisRemaining(flow, b.id, l.id) !== 0 && !sameSign(billingBasisRemaining(flow, b.id, l.id), l.netOre)) billingFail('BALANCE')
  }
  for (const i of flow.invoices) {
    proof(i.number); proof(i.issuer); date(i.date); amount(i.externalNetOre, true); text(i.note, 2000)
    if (!['invoice', 'credit'].includes(i.kind) || !i.lines.length || i.lines.length > 500) billingFail()
    for (const l of i.lines) {
      const b = flow.bases.find(b => b.id === l.basisId && b.status !== 'cancelled') ?? billingFail()
      const row = b.lines.find(r => r.id === l.lineId) ?? billingFail()
      if (i.issuer !== b.issuer || !sameSign(row.netOre, l.netOre) || Math.abs(billingPosted(flow, b.id, row.id)) > Math.abs(row.netOre)) billingFail('BALANCE')
    }
  }
}

export const billingErrors: Record<string, string> = {
  BILLING_INVALID: 'Kontrollera datum, belopp och obligatoriska uppgifter.', BILLING_FORBIDDEN: 'Endast projektansvarig kan hantera faktureringen.',
  BILLING_TERMS_REQUIRED: 'Prisgrunden saknas eller är ofullständig. Kontrollera den dokumenterade överenskommelsen.', BILLING_AGREEMENT_REQUIRED: 'Välj en dokumenterad överenskommelse först.',
  BILLING_EVIDENCE_REQUIRED: 'Ange underlag eller en förklaring till varför underlag saknas.', BILLING_NOT_REVIEWED: 'Kostnaden måste granskas av projektansvarig.',
  BILLING_SOURCE_CHANGED: 'Källuppgifterna har ändrats. Hämta aktuella uppgifter och granska igen.', BILLING_SOURCE_IN_USE: 'Källposten är redan kopplad. Använd den befintliga posten eller registrera en separat rättning.',
  BILLING_BALANCE: 'Beloppet är redan reserverat/fakturerat eller överstiger återstående belopp.', BILLING_PRICE_LIMIT: 'Beloppet överstiger det avtalade fasta priset.',
  BILLING_BASE_LIMIT: 'Grundavtalets fasta delar får inte räknas dubbelt via betalplan och moment.', BILLING_LEGACY_REVIEW: 'Stäm av tidigare fakturaunderlag innan nya debiteringar skapas.',
  BILLING_BUDGET_REVIEW: 'Dokumentera budgetavstämningen före fakturaunderlaget.', BILLING_INCOMPLETE: 'Öppna frågor, ej granskade kostnader eller återstående faktureringsposter behöver hanteras.',
  BILLING_ECONOMY_CLOSED: 'Öppna faktureringsavstämningen igen först.', BILLING_ALREADY_INVOICED: 'Underlaget är kopplat till en faktura. Rätta genom separat kredit.',
  BILLING_CREDIT_LIMIT: 'Krediten överstiger det tidigare fakturerade beloppet.', BILLING_CREDIT_SEPARATE: 'Kreditposter och debetposter behöver separata underlag och fakturareferenser.',
  BILLING_INVOICE_DUPLICATE: 'Fakturanumret finns redan för detta avsändarbolag.', BILLING_DUPLICATE: 'Posten är redan registrerad.', BILLING_LIMIT: 'Projektets faktureringsregister är för stort.',
  BILLING_CANCELLED: 'Underlaget är makulerat.', BILLING_CONFIRM_REQUIRED: 'Bekräfta granskningen.', BILLING_PARTIES_REQUIRED: 'Projektets avsändare och fakturakund behöver vara angivna.', BILLING_NOT_FOUND: 'Posten kunde inte hittas.',
  BILLING_HISTORY_COST_REQUIRED: 'Tidigare löpande debitering behöver kopplas till sina faktiska kostnader via Kostnader och Att fakturera. Registrera därefter det tidigare fakturanumret.',
}
