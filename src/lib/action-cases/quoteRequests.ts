import type { ActionCaseCostLineView, ActionCaseQuoteRequest, ActionCaseRequestLine, ActionCaseView } from './contracts'
import { quoteId } from './quotes'

export type PricePresentation = 'grouped' | 'itemized' | 'action_total' | 'line_items'
export const REQUEST_CATEGORIES = ['own_labor', 'subcontractor', 'material', 'waste', 'transport', 'other'] as const
export const requestCategoryLabel = (category?: string) => category === 'material' ? 'Material' : ['waste', 'transport', 'other'].includes(category ?? '') ? 'Övrigt' : 'Arbete'
export const isFullRequest = (presentation?: PricePresentation) => presentation === 'action_total' || presentation === 'line_items'
export type PackageRequestLine = ActionCaseRequestLine & {
  workPartId?: string | null
  workPartTitle?: string
  workPartScope?: string
  category?: ActionCaseCostLineView['category']
  quantity?: number | null
  unit?: string
  quantityBasis?: ActionCaseCostLineView['quantityBasis']
}
export type PackageQuoteRequest = Omit<ActionCaseQuoteRequest, 'lines'> & {
  lines: PackageRequestLine[]
  pricePresentation: PricePresentation
}
export type QuoteRequestGroup = {
  key: string; itemId: string; itemTitle: string; scope: string
  workPartId: string | null; workPartTitle: string; workPartScope: string
  lines: PackageRequestLine[]
}

export function groupRequestLines(lines: readonly PackageRequestLine[], presentation: PricePresentation = 'grouped'): QuoteRequestGroup[] {
  const groups = new Map<string, QuoteRequestGroup>()
  for (const line of lines) {
    const key = `${line.itemId}:${presentation === 'action_total' ? '' : presentation === 'line_items' ? line.costLineId : line.workPartId ?? ''}`
    const group = groups.get(key) ?? { key, itemId: line.itemId, itemTitle: line.itemTitle, scope: line.scope,
      workPartId: presentation === 'action_total' ? null : line.workPartId ?? null,
      workPartTitle: presentation === 'action_total' ? '' : presentation === 'line_items' ? line.description : line.workPartTitle ?? '', workPartScope: line.workPartScope ?? '', lines: [] }
    group.lines.push(line)
    groups.set(key, group)
  }
  return [...groups.values()]
}

export const REQUEST_REQUIREMENTS: ActionCaseQuoteRequest['requirements'] = [
  { key: 'travel', label: 'Resor och restid', text: 'Resor, restid och servicebil för de offererade arbetena.', kind: 'included' },
  { key: 'materials', label: 'Material', text: 'Material som behövs för de offererade arbetena.', kind: 'included' },
  { key: 'own_waste', label: 'Hantering av eget avfall', text: 'Sortering, bortforsling och mottagningsavgifter för avfall från det egna arbetet.', kind: 'included' },
  { key: 'protection', label: 'Skyddsmaterial och täckning', text: 'Skyddsmaterial och täckning av berörda ytor.', kind: 'included' },
  { key: 'establishment', label: 'Etablering och avetablering', text: 'Etablering och avetablering för de offererade arbetena.', kind: 'included' },
  { key: 'equipment', label: 'Verktyg och maskiner', text: 'Nödvändiga verktyg, maskiner och förbrukningsmaterial.', kind: 'included' },
  { key: 'access_equipment', label: 'Ställning eller lift', text: 'Nödvändig ställning eller lift, inklusive transport och montage.', kind: 'included' },
  { key: 'freight', label: 'Frakt och materialleveranser', text: 'Frakt, materialleveranser och inbärning.', kind: 'included' },
  { key: 'cleaning', label: 'Städning efter eget arbete', text: 'Städning av arbetsområdet efter det egna arbetet.', kind: 'included' },
  { key: 'documentation', label: 'Egenkontroll och dokumentation', text: 'Egenkontroll och relevant dokumentation av utfört arbete.', kind: 'included' },
  { key: 'extra_rates', label: 'ÄTA-priser', text: 'Redovisa separat timpriser, materialpåslag och eventuella minimiavgifter för ändrings- och tilläggsarbeten. Detta är inte en beställning av sådana arbeten.', kind: 'separate' },
]

const invalid = (): never => { throw new Error('ACTION_CASE_REQUEST_INVALID') }
function text(value: unknown, max: number) {
  if (value == null) return ''
  if (typeof value !== 'string' || value.trim().length > max) return invalid()
  return value.trim()
}
function snapshotText(value: unknown, max: number) {
  if (typeof value !== 'string' || value.length > max) return invalid()
  return value
}
export function requestSources(actionCase: ActionCaseView): PackageRequestLine[] {
  return actionCase.items.filter((item) => !['cancelled', 'declined', 'completed'].includes(item.status)).flatMap((item) => item.costLines
    .filter((line) => REQUEST_CATEGORIES.includes(line.category))
    .map((line) => {
      const part = item.workParts?.find((part) => part.id === line.workPartId)
      return { costLineId: line.id, itemId: item.id, itemTitle: item.title, scope: item.scope ?? '', description: line.description,
        workPartId: line.workPartId ?? null, workPartTitle: part?.title ?? '', workPartScope: part?.scope ?? '',
        category: line.category, quantity: line.quantity, unit: line.unit, quantityBasis: line.quantityBasis }
    }))
}

export function normalizeQuoteRequest(input: Record<string, unknown>) {
  const supplierName = text(input.supplierName, 200), supplierEmail = text(input.supplierEmail, 254).toLowerCase()
  const subject = text(input.subject, 200).replace(/[\r\n]/g, ' ')
  if (!supplierName || !subject || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(supplierEmail)) return invalid()
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 30) return invalid()
  const pricePresentation = input.pricePresentation ?? 'action_total'
  if (!['grouped', 'itemized', 'action_total', 'line_items'].includes(String(pricePresentation))) return invalid()
  const lines: PackageRequestLine[] = input.lines.map((value) => {
    if (!value || typeof value !== 'object') return invalid()
    const line = value as Record<string, unknown>
    const workPartId = line.workPartId == null ? null : quoteId(line.workPartId)
    const workPartTitle = snapshotText(line.workPartTitle ?? '', 500), workPartScope = snapshotText(line.workPartScope ?? '', 20000)
    if ((!workPartId && (workPartTitle || workPartScope)) || (workPartId && !workPartTitle)) return invalid()
    let detail = {}
    if (isFullRequest(pricePresentation as PricePresentation)) {
      if (!REQUEST_CATEGORIES.includes(line.category as typeof REQUEST_CATEGORIES[number]) ||
        (line.quantity !== null && (typeof line.quantity !== 'number' || !Number.isFinite(line.quantity) || line.quantity < 0 || line.quantity > 99999999999.999)) ||
        typeof line.unit !== 'string' || !line.unit.trim() || line.unit.length > 40 ||
        !['provided', 'calculated', 'estimated', 'unknown'].includes(String(line.quantityBasis))) return invalid()
      detail = { category: line.category, quantity: line.quantity, unit: line.unit, quantityBasis: line.quantityBasis }
    }
    return { costLineId: quoteId(line.costLineId), itemId: quoteId(line.itemId), itemTitle: snapshotText(line.itemTitle, 300), scope: snapshotText(line.scope, 12000), description: snapshotText(line.description, 1000), workPartId, workPartTitle, workPartScope, ...detail }
  })
  if (new Set(lines.map((line) => line.costLineId)).size !== lines.length || lines.some((line) => !line.description || !line.itemTitle)) return invalid()
  for (const line of lines) {
    if (lines.some((other) => other.itemId === line.itemId && (other.itemTitle !== line.itemTitle || other.scope !== line.scope))) return invalid()
    if (line.workPartId && lines.some((other) => other.workPartId === line.workPartId &&
      (other.itemId !== line.itemId || other.workPartTitle !== line.workPartTitle || other.workPartScope !== line.workPartScope))) return invalid()
  }
  if (!Array.isArray(input.requirementKeys) || input.requirementKeys.some((key) => !REQUEST_REQUIREMENTS.some((r) => r.key === key))) return invalid()
  const requirements = REQUEST_REQUIREMENTS.filter((r) => (input.requirementKeys as unknown[]).includes(r.key))
  if (!Array.isArray(input.attachmentIds) || input.attachmentIds.length > 30) return invalid()
  const result = {
    id: quoteId(input.requestId), supplierName, supplierEmail, subject, lines, requirements, pricePresentation: pricePresentation as PricePresentation,
    message: text(input.message, 6000), otherRequirements: text(input.otherRequirements, 3000),
    attachmentIds: [...new Set(input.attachmentIds.map(quoteId))].sort(),
    supplementsId: input.supplementsId ? quoteId(input.supplementsId) : null,
    expectedUpdatedAt: input.expectedUpdatedAt ? text(input.expectedUpdatedAt, 50) : null,
  }
  const body = buildQuoteRequestBody(result)
  if (body.length > 100000) return invalid()
  return { ...result, body }
}

export function buildQuoteRequestBody(request: Pick<ActionCaseQuoteRequest, 'message' | 'requirements' | 'otherRequirements' | 'supplementsId'> & {
  lines: PackageRequestLine[]; pricePresentation?: PricePresentation
}) {
  const blocks = ['Hej!', request.supplementsId ? `Komplettering till offertförfrågan ${request.supplementsId}. Nedanstående arbeten omfattas av denna komplettering.` : 'Vi önskar offert på nedanstående arbeten.', request.message]
  if (isFullRequest(request.pricePresentation)) return buildFullRequestBody(request, blocks)
  const grouped = request.pricePresentation === 'grouped'
  const items = new Map<string, QuoteRequestGroup[]>()
  for (const group of groupRequestLines(request.lines)) items.set(group.itemId, [...(items.get(group.itemId) ?? []), group])
  let groupNumber = 0, lineNumber = 0
  for (const groups of items.values()) {
    blocks.push(`Åtgärd: ${groups[0].itemTitle}`, groups[0].scope)
    for (const group of groups) {
      groupNumber++
      if (grouped) blocks.push(`Prisgrupp ${groupNumber}: ${group.workPartTitle || group.itemTitle}`)
      else if (group.workPartId) blocks.push(`Arbetsdel: ${group.workPartTitle}`)
      if (group.workPartId && group.workPartScope !== group.scope) blocks.push(group.workPartScope)
      blocks.push(...group.lines.map((line) => grouped ? `- ${line.description}` : `${++lineNumber}. ${line.description}`))
    }
  }
  const included = request.requirements.filter((r) => r.kind === 'included'), separate = request.requirements.filter((r) => r.kind === 'separate')
  if (included.length) blocks.push('Vi önskar att följande ingår i offererat pris. Ange uttryckligen eventuella undantag:', ...included.map((r) => `- ${r.text}`))
  if (separate.length) blocks.push('Redovisa även följande prisuppgifter separat:', ...separate.map((r) => `- ${r.text}`))
  if (request.otherRequirements) blocks.push(`Övriga önskemål:\n${request.otherRequirements}`)
  blocks.push(grouped
    ? 'Ange ett sammanhållet totalpris exklusive moms per prisgrupp för de uttryckligen listade arbetsmomenten i gruppen, inte ett pris per arbetsmoment. Åtgärdens och arbetsdelens omfattning är bakgrund; förfrågan omfattar endast listade arbetsmoment och angivna krav. Redovisa gemensamma kostnader endast en gång och ange vilken prisgrupp de ingår i. Bekräfta om gruppens pris gäller vid separat beställning. Om ett paket omfattar flera prisgrupper krävs en uttrycklig prisfördelning mellan grupperna som summerar till paketets totalpris.'
    : 'Ange pris exklusive moms per numrerat arbetsmoment. Redovisa gemensamma kostnader endast en gång, separat, och ange hur de påverkas om bara vissa arbeten beställs. Bekräfta om delpriserna gäller vid separat beställning eller om priset förutsätter hela paketet.',
  'Ange offertens giltighet, möjlig utförandetid och eventuella reservationer.', 'Detta är en offertförfrågan, inte en beställning.')
  return blocks.filter(Boolean).join('\n\n')
}

export function requestLineText(line: PackageRequestLine) {
  const quantity = line.quantity == null ? '' : ` · ${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 3 }).format(line.quantity)} ${line.unit}${line.quantityBasis === 'estimated' ? ' (uppskattat)' : line.quantityBasis === 'calculated' ? ' (beräknat)' : ''}`
  return `${line.description}${quantity}`
}

function buildFullRequestBody(request: Parameters<typeof buildQuoteRequestBody>[0], blocks: string[]) {
  let number = 0
  for (const action of groupRequestLines(request.lines, 'action_total')) {
    blocks.push(`Åtgärd: ${action.itemTitle}`)
    if (action.scope) blocks.push(`Bakgrund: ${action.scope}`)
    for (const part of groupRequestLines(action.lines)) {
      if (part.workPartTitle) blocks.push(`Arbetsdel: ${part.workPartTitle}`)
      if (part.workPartScope && part.workPartScope !== action.scope) blocks.push(`Bakgrund: ${part.workPartScope}`)
      for (const category of ['Arbete', 'Material', 'Övrigt']) {
        const rows = part.lines.filter((line) => requestCategoryLabel(line.category) === category)
        if (rows.length) blocks.push(`${category}:`, ...rows.map((line) => `${request.pricePresentation === 'action_total' ? '-' : `${++number}.`} ${requestLineText(line)}`))
      }
    }
    if (request.pricePresentation === 'action_total') blocks.push('Ange ett totalpris exklusive moms för åtgärdens samtliga valda delar ovan. Arbete, material och övrigt behöver inte prissättas var för sig.')
  }
  const included = request.requirements.filter((r) => r.kind === 'included'), separate = request.requirements.filter((r) => r.kind === 'separate')
  blocks.push('Förfrågan omfattar de listade delarna och kraven nedan. Övriga delar i bakgrundsbeskrivningen ingår inte automatiskt. Ange eventuella undantag. Angivna mängder är underlag för prissättning; ange om din offert utgår från andra mängder.')
  if (included.length) blocks.push('Utöver de listade delarna önskas även följande ingå, utan dubbeldebitering:', ...included.map((r) => `- ${r.text}`))
  if (separate.length) blocks.push('Redovisa även dessa prisuppgifter separat:', ...separate.map((r) => `- ${r.text}`))
  if (request.otherRequirements) blocks.push(`Övriga önskemål:\n${request.otherRequirements}`)
  if (request.pricePresentation === 'line_items') blocks.push('Ange pris exklusive moms per numrerad del. Bekräfta om delpriserna gäller vid separat beställning.')
  if (groupRequestLines(request.lines, 'action_total').length > 1) blocks.push('Ange ett totalpris per åtgärd och bekräfta om priserna gäller vid separat beställning. Gemensamma kostnader ska redovisas endast en gång med uppgift om var de ingår.')
  blocks.push('Ange offertens giltighet, möjlig utförandetid och eventuella reservationer.', 'Detta är en offertförfrågan, inte en beställning.')
  return blocks.filter(Boolean).join('\n\n')
}

export const REQUEST_VIEW_COLUMNS = 'id,action_case_id,supplier_name,supplier_email,subject,message,requirements,other_requirements,lines,attachment_ids,body,supplements_id,response_mode,package_amount,response_notes,response_document_id,delivery_status,sent_at,first_attempt_at,updated_at,price_presentation'
export function mapQuoteRequest(row: Record<string, unknown>): PackageQuoteRequest {
  return { id: String(row.id), supplierName: String(row.supplier_name), supplierEmail: String(row.supplier_email),
    subject: String(row.subject), message: String(row.message), requirements: row.requirements as ActionCaseQuoteRequest['requirements'],
    otherRequirements: String(row.other_requirements), lines: row.lines as PackageRequestLine[], attachmentIds: row.attachment_ids as string[], body: String(row.body),
    pricePresentation: ['grouped', 'action_total', 'line_items'].includes(String(row.price_presentation)) ? row.price_presentation as PricePresentation : 'itemized',
    supplementsId: row.supplements_id ? String(row.supplements_id) : null, responseMode: row.response_mode as ActionCaseQuoteRequest['responseMode'],
    packageAmount: row.package_amount == null ? null : Number(row.package_amount), responseNotes: String(row.response_notes ?? ''), responseDocumentId: row.response_document_id ? String(row.response_document_id) : null,
    deliveryStatus: row.delivery_status as ActionCaseQuoteRequest['deliveryStatus'], sentAt: row.sent_at ? String(row.sent_at) : null,
    firstAttemptAt: row.first_attempt_at ? String(row.first_attempt_at) : null, updatedAt: String(row.updated_at) }
}
