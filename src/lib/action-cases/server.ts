import 'server-only'

import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import type { ActionCaseAttachmentView, ActionCaseCostLineView, ActionCaseItemView, ActionCaseParticipantView, ActionCasePortal, ActionCaseView, ActionCaseWorkspace } from './contracts'
import { parseScopeAttachmentIds } from './scopeAttachments'
import { filterActionCasePortalItems } from './domain'
import { normalizeCostLine } from './costing'
import { mapQuote, QUOTE_VIEW_COLUMNS, quoteIsStale } from './quotes'
import { mapQuoteRequest, REQUEST_VIEW_COLUMNS } from './quoteRequests'
import { mapQuotePackage, PACKAGE_VIEW_COLUMNS } from './quotePackages'
import { calculateActionCaseCostTotals } from './domain'
import { createQuoteWorkLine } from './quotesServer'

type Context = { orgId: string; userId: string }

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  return text(value) || null
}

const ACTION_CASE_BUCKET = 'action-case-files'
const MAX_FILE_BYTES = 25 * 1024 * 1024
const ALLOWED_FILES: Record<string, { type: 'image' | 'document'; extension: string }> = {
  'image/jpeg': { type: 'image', extension: 'jpg' },
  'image/png': { type: 'image', extension: 'png' },
  'image/webp': { type: 'image', extension: 'webp' },
  'image/heic': { type: 'image', extension: 'heic' },
  'image/heif': { type: 'image', extension: 'heif' },
  'application/pdf': { type: 'document', extension: 'pdf' },
  'application/msword': { type: 'document', extension: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { type: 'document', extension: 'docx' },
  'application/vnd.ms-excel': { type: 'document', extension: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { type: 'document', extension: 'xlsx' },
  'text/plain': { type: 'document', extension: 'txt' },
}

const FILES_BY_EXTENSION: Record<string, { contentType: string; type: 'image' | 'document'; extension: string }> = Object.fromEntries(
  Object.entries(ALLOWED_FILES).map(([contentType, allowed]) => [allowed.extension, { contentType, ...allowed }])
) as Record<string, { contentType: string; type: 'image' | 'document'; extension: string }>
FILES_BY_EXTENSION.jpeg = { contentType: 'image/jpeg', type: 'image', extension: 'jpg' }

function resolveAllowedFile(fileName: string, declaredContentType: string) {
  const normalizedType = declaredContentType.split(';')[0]!.trim().toLowerCase()
  const direct = ALLOWED_FILES[normalizedType]
  if (direct) return { contentType: normalizedType, ...direct }
  if (normalizedType && normalizedType !== 'application/octet-stream') return null
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return FILES_BY_EXTENSION[extension] ?? null
}

function safeName(value: string) {
  return value.replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim().slice(0, 180) || 'bilaga'
}

async function requireCase(context: Context, caseId: string) {
  const { data, error } = await createSupabaseAdminClient().from('action_cases').select('id').eq('id', caseId).eq('org_id', context.orgId).maybeSingle()
  if (error || !data) throw new Error('ACTION_CASE_NOT_FOUND')
}

function mapItem(row: Record<string, unknown>, costLines: ActionCaseCostLineView[] = []): ActionCaseItemView {
  return {
    id: String(row.id),
    title: String(row.title),
    scope: row.scope ? String(row.scope) : null,
    scopeAttachmentIds: Array.isArray(row.scope_attachment_ids) ? row.scope_attachment_ids as string[] : null,
    status: row.status as ActionCaseItemView['status'],
    sortOrder: Number(row.sort_order),
    ownLaborReady: Boolean(row.own_labor_ready),
    materialPriceReady: Boolean(row.material_price_ready),
    subcontractorPriceReady: Boolean(row.subcontractor_price_ready),
    wasteSolutionReady: Boolean(row.waste_solution_ready),
    requiresSubcontractor: Boolean(row.requires_subcontractor),
    estimatedCost: row.estimated_cost === null ? null : Number(row.estimated_cost),
    customerPrice: row.customer_price === null ? null : Number(row.customer_price),
    costLines,
    updatedAt: String(row.updated_at),
    costSuggestion: null,
  }
}

function mapCostLine(row: Record<string, unknown>): ActionCaseCostLineView {
  return {
    workPartId: row.work_part_id ? String(row.work_part_id) : null,
    id: String(row.id),
    category: row.category as ActionCaseCostLineView['category'],
    description: String(row.description),
    quantity: row.quantity == null ? null : Number(row.quantity),
    unit: String(row.unit),
    unitCost: row.unit_cost == null ? null : Number(row.unit_cost),
    markupPercent: Number(row.markup_percent),
    vatRate: Number(row.vat_rate),
    priceSource: row.price_source as ActionCaseCostLineView['priceSource'],
    sourceUrl: row.source_url ? String(row.source_url) : null,
    sourceCheckedAt: row.source_checked_at ? String(row.source_checked_at) : null,
    verified: Boolean(row.is_verified),
    sortOrder: Number(row.sort_order),
    quantityBasis: (row.quantity_basis ?? 'provided') as ActionCaseCostLineView['quantityBasis'],
    notes: row.notes ? String(row.notes) : null,
    pricingMethod: row.pricing_method === 'quotes' ? 'quotes' : 'direct',
    selectedQuoteId: row.selected_quote_id ? String(row.selected_quote_id) : null,
    coveredByQuoteId: row.covered_by_quote_id ? String(row.covered_by_quote_id) : null,
    updatedAt: String(row.updated_at),
  }
}

export async function getActionCaseWorkspace(context: Context): Promise<ActionCaseWorkspace> {
  const admin = createSupabaseAdminClient()
  const { data: cases, error: casesError } = await admin
    .from('action_cases')
    .select('*')
    .eq('org_id', context.orgId)
    .order('updated_at', { ascending: false })

  if (casesError) {
    if (casesError.message.includes('action_cases')) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    throw new Error('ACTION_CASES_READ_FAILED')
  }

  const caseIds = (cases ?? []).map((row) => row.id)
  const { data: items, error: itemsError } = caseIds.length
    ? await admin.from('action_case_items').select('*').in('action_case_id', caseIds).order('sort_order')
    : { data: [], error: null }
  if (itemsError) throw new Error('ACTION_CASES_READ_FAILED')

  const { data: workParts, error: workPartsError } = caseIds.length
    ? await admin.from('action_case_work_parts').select('*').eq('org_id', context.orgId).in('action_case_id', caseIds).order('sort_order')
    : { data: [], error: null }
  if (workPartsError && !['42P01', 'PGRST205'].includes(workPartsError.code)) throw new Error('ACTION_CASES_READ_FAILED')

  const [{ data: participants, error: participantError }, { data: attachments, error: attachmentError }, { data: costLines, error: costLineError }] = caseIds.length
    ? await Promise.all([
        admin.from('action_case_participants').select('*').in('action_case_id', caseIds).order('created_at'),
        admin.from('action_case_attachments').select('*').in('action_case_id', caseIds).order('created_at', { ascending: false }),
        admin.from('action_case_cost_lines').select('*').in('action_case_id', caseIds).order('sort_order'),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }]
  if (participantError || attachmentError || costLineError) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
  const { data: suggestions, error: suggestionError } = caseIds.length
    ? await admin.from('action_case_cost_suggestions').select('id,action_case_item_id,source_updated_at,created_at,lines,warnings,applied_at')
      .eq('org_id', context.orgId).in('action_case_id', caseIds).order('created_at', { ascending: false })
    : { data: [], error: null }
  // Keep pre-migration workspaces readable during a rolling deployment.
  if (suggestionError && !['42P01', 'PGRST205'].includes(suggestionError.code)) throw new Error('ACTION_CASES_READ_FAILED')
  let { data: requestRows, error: requestError } = caseIds.length
    ? await admin.from('action_case_quote_requests').select(REQUEST_VIEW_COLUMNS).eq('org_id', context.orgId).in('action_case_id', caseIds).order('created_at', { ascending: false })
    : { data: [], error: null }
  if (requestError && ['42703', 'PGRST204'].includes(requestError.code)) {
    const legacyColumns = 'id,action_case_id,supplier_name,supplier_email,subject,message,requirements,other_requirements,lines,attachment_ids,body,supplements_id,response_mode,package_amount,response_notes,response_document_id,delivery_status,sent_at,first_attempt_at,updated_at'
    const legacy = await admin.from('action_case_quote_requests').select(legacyColumns).eq('org_id', context.orgId).in('action_case_id', caseIds).order('created_at', { ascending: false })
    requestRows = legacy.data?.map((row) => ({ ...row, price_presentation: 'itemized' })) ?? null; requestError = legacy.error
  }
  if (requestError && !['42P01', 'PGRST205'].includes(requestError.code)) throw new Error('ACTION_CASES_READ_FAILED')
  const { data: packageRows, error: packageError } = caseIds.length
    ? await admin.from('action_case_quote_packages').select(`${PACKAGE_VIEW_COLUMNS},action_case_id`).eq('org_id', context.orgId).in('action_case_id', caseIds)
    : { data: [], error: null }
  if (packageError && !['42P01', 'PGRST205'].includes(packageError.code)) throw new Error('ACTION_CASES_READ_FAILED')
  const packages = (packageRows ?? []) as unknown as Record<string, unknown>[]
  const { data: quotes, error: quoteError } = caseIds.length
    ? await admin.from('action_case_work_quotes').select(QUOTE_VIEW_COLUMNS + (requestError ? '' : ',request_id') + (packageError ? '' : ',package_request_id')).eq('org_id', context.orgId).in('action_case_id', caseIds).order('created_at')
    : { data: [], error: null }
  if (quoteError && !['42P01', 'PGRST205'].includes(quoteError.code)) throw new Error('ACTION_CASES_READ_FAILED')

  const attachmentIds = (attachments ?? []).map((row) => row.id)
  const { data: grants, error: grantsError } = attachmentIds.length
    ? await admin.from('action_case_attachment_grants').select('attachment_id,participant_id').in('attachment_id', attachmentIds)
    : { data: [], error: null }
  if (grantsError) throw new Error('ACTION_CASES_READ_FAILED')

  const costLinesByItem = new Map<string, ActionCaseCostLineView[]>()
  for (const row of costLines ?? []) {
    const list = costLinesByItem.get(row.action_case_item_id) ?? []
    const line = mapCostLine(row)
    line.quotes = (quotes as unknown as Record<string, unknown>[] | null)?.filter((q) => q.cost_line_id === row.id &&
      (!q.package_request_id || packages.some((price) => price.quote_id === q.id && price.state === 'active'))).map(mapQuote) ?? []
    for (const q of line.quotes) {
      const packagePrice = packages.find((price) => price.quote_id === q.id && price.state === 'active')
      if (packagePrice) {
        q.packageGroupKey = String(packagePrice.group_key)
        q.requestId = String(packagePrice.request_id)
        q.separatePricesConfirmed = true
      } else if (q.requestId) {
        const request = requestRows?.find((r) => r.id === q.requestId)
        const source = (request?.lines as Array<Record<string, unknown>> | undefined)?.find((source) => source.costLineId === row.id)
        const item = items?.find((item) => item.id === row.action_case_item_id)
        const matchingSource = source && item && source.itemId === item.id && source.itemTitle === item.title &&
          source.scope === (item.scope ?? '') && source.description === row.description
        const part = (workParts as Record<string, unknown>[] | null)?.find((part) => part.id === line.workPartId)
        const matchingPart = source && (source.workPartId ?? null) === (line.workPartId ?? null) &&
          (source.workPartTitle ?? '') === (part?.title ?? '') && (source.workPartScope ?? '') === (part?.scope ?? '')
        q.separatePricesConfirmed = Boolean(request?.response_mode === 'itemized' && request.sent_at && matchingSource && matchingPart)
      } else q.separatePricesConfirmed = true
    }
    list.push(line)
    costLinesByItem.set(row.action_case_item_id, list)
  }
  const itemsByCase = new Map<string, ActionCaseItemView[]>()
  for (const row of items ?? []) {
    const list = itemsByCase.get(row.action_case_id) ?? []
    const view = mapItem(row, costLinesByItem.get(row.id) ?? [])
    view.workParts = ((workParts ?? []) as Record<string, unknown>[]).filter((part) => part.action_case_item_id === row.id).map((part) => ({
      id: String(part.id), title: String(part.title), scope: part.scope ? String(part.scope) : null,
      sortOrder: Number(part.sort_order), updatedAt: String(part.updated_at),
    }))
    for (const line of view.costLines) {
      if (line.pricingMethod !== 'quotes') continue
      const selected = line.quotes?.find((q) => q.id === line.selectedQuoteId)
      if (!selected || selected.separatePricesConfirmed === false || quoteIsStale(selected, view.scope, line.description)) {
        line.unitCost = null; line.verified = false; view.subcontractorPriceReady = false
        if (['ready_for_quote', 'pricing_needed', 'waiting_subcontractor'].includes(view.status)) view.status = 'waiting_subcontractor'
      }
    }
    if (view.costLines.some((line) => line.pricingMethod === 'quotes')) {
      const totals = calculateActionCaseCostTotals(view.costLines)
      view.estimatedCost = totals.internalCost; view.customerPrice = totals.customerPrice
    }
    const proposal = suggestions?.find((candidate) => candidate.action_case_item_id === row.id)
    view.costSuggestion = proposal && !proposal.applied_at ? { id: proposal.id, sourceUpdatedAt: proposal.source_updated_at, createdAt: proposal.created_at, lines: proposal.lines, warnings: proposal.warnings } : null
    list.push(view)
    itemsByCase.set(row.action_case_id, list)
  }
  const participantsByCase = new Map<string, ActionCaseParticipantView[]>()
  for (const row of participants ?? []) {
    const list = participantsByCase.get(row.action_case_id) ?? []
    list.push({ id: row.id, role: row.role, name: row.name, companyName: row.company_name, email: row.email, phone: row.phone })
    participantsByCase.set(row.action_case_id, list)
  }
  const grantIdsByAttachment = new Map<string, string[]>()
  for (const row of grants ?? []) {
    const list = grantIdsByAttachment.get(row.attachment_id) ?? []
    list.push(row.participant_id)
    grantIdsByAttachment.set(row.attachment_id, list)
  }
  const attachmentsByCase = new Map<string, ActionCaseAttachmentView[]>()
  const privateDocumentIds = new Set([
    ...((quotes ?? []) as unknown as Record<string, unknown>[]).map((quote) => quote.document_id),
    ...(requestRows ?? []).map((request) => request.response_document_id),
  ].filter(Boolean))
  for (const row of attachments ?? []) {
    const list = attachmentsByCase.get(row.action_case_id) ?? []
    list.push({
      id: row.id,
      actionCaseItemId: row.action_case_item_id,
      isQuoteDocument: privateDocumentIds.has(row.id),
      type: row.attachment_type,
      title: row.title,
      fileName: row.file_name,
      contentType: row.content_type,
      fileSizeBytes: Number(row.file_size_bytes),
      grantedParticipantIds: grantIdsByAttachment.get(row.id) ?? [],
      createdAt: row.created_at,
    })
    attachmentsByCase.set(row.action_case_id, list)
  }

  const views: ActionCaseView[] = (cases ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    propertyAddress: row.property_address,
    sourceKind: row.source_kind,
    sourceReference: row.source_reference,
    description: row.description,
    status: row.status,
    siteVisitAt: row.site_visit_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: itemsByCase.get(row.id) ?? [],
    participants: participantsByCase.get(row.id) ?? [],
    attachments: attachmentsByCase.get(row.id) ?? [],
    quoteRequests: (requestRows as unknown as Record<string, unknown>[] | null)?.filter((r) => r.action_case_id === row.id).map(mapQuoteRequest) ?? [],
    quotePackages: packages.filter((price) => price.action_case_id === row.id).map(mapQuotePackage),
  }))

  for (const view of views) {
    if (view.status === 'quote_ready' && view.items.some((item) => item.status === 'waiting_subcontractor')) view.status = 'pricing'
  }
  const allItems = views.flatMap((item) => item.items)
  return {
    cases: views,
    summary: {
      active: views.filter((item) => !['completed', 'cancelled'].includes(item.status)).length,
      pricingNeeded: allItems.filter((item) => ['scope_needed', 'pricing_needed'].includes(item.status)).length,
      waitingSubcontractor: allItems.filter((item) => item.status === 'waiting_subcontractor').length,
      awaitingCustomer: views.filter((item) => item.status === 'awaiting_customer').length,
      readyToSchedule: allItems.filter((item) => item.status === 'approved').length,
      readyToInvoice: allItems.filter((item) => item.status === 'completed').length,
    },
  }
}

async function writeCosts(context: Context, payload: Record<string, unknown>, operation: string, lines: unknown[]) {
  const { error } = await createSupabaseAdminClient().rpc('write_action_case_costs', {
    p_org_id: context.orgId, p_case_id: text(payload.caseId), p_item_id: text(payload.itemId),
    p_user_id: context.userId, p_operation: operation, p_lines: lines,
    p_suggestion_id: nullableText(payload.suggestionId),
  })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    const known = ['ACTION_CASE_NOT_FOUND', 'ACTION_CASE_AI_NOT_FOUND', 'ACTION_CASE_AI_STALE', 'ACTION_CASE_COST_LINE_INVALID', 'ACTION_CASE_COST_LINE_NOT_FOUND', 'ACTION_CASE_QUOTE_SENT_IMMUTABLE', 'ACTION_CASE_QUOTE_COVERAGE']
    throw new Error(known.find((code) => error.message.includes(code)) ?? 'ACTION_CASE_COST_LINE_WRITE_FAILED')
  }
}

export async function createActionCaseCostLine(context: Context, payload: Record<string, unknown>) {
  if (payload.pricingMethod === 'quotes') return createQuoteWorkLine(context, payload)
  await writeCosts(context, payload, 'add', [normalizeCostLine(payload)])
}

export async function updateActionCaseCostLine(context: Context, payload: Record<string, unknown>) {
  await writeCosts(context, payload, 'update', [{ ...normalizeCostLine(payload), id: text(payload.costLineId) }])
}

export async function deleteActionCaseCostLine(context: Context, payload: Record<string, unknown>) {
  await writeCosts(context, payload, 'delete', [{ id: text(payload.costLineId) }])
}

export async function applyActionCaseCostSuggestions(context: Context, payload: Record<string, unknown>) {
  if (!Array.isArray(payload.lineIds) || payload.lineIds.length < 1 || payload.lineIds.length > 30) throw new Error('ACTION_CASE_COST_LINE_INVALID')
  await writeCosts(context, payload, 'apply', [...new Set(payload.lineIds.map(text))].map((id) => ({ id })))
}

export async function createActionCase(context: Context, payload: Record<string, unknown>) {
  const title = text(payload.title)
  const customerName = text(payload.customerName)
  const propertyAddress = text(payload.propertyAddress)
  const itemTitles = Array.isArray(payload.items)
    ? payload.items.map(text).filter(Boolean).slice(0, 25)
    : []
  if (!title || !customerName || !propertyAddress) throw new Error('ACTION_CASE_REQUIRED_FIELDS')
  if (itemTitles.length === 0) throw new Error('ACTION_CASE_ITEM_REQUIRED')

  const admin = createSupabaseAdminClient()
  const { data: created, error } = await admin.from('action_cases').insert({
    org_id: context.orgId,
    title,
    customer_name: customerName,
    customer_email: nullableText(payload.customerEmail),
    customer_phone: nullableText(payload.customerPhone),
    property_address: propertyAddress,
    source_kind: 'manual',
    source_reference: nullableText(payload.sourceReference),
    description: nullableText(payload.description),
    site_visit_at: nullableText(payload.siteVisitAt),
    created_by: context.userId,
    updated_by: context.userId,
  }).select('id').single()
  if (error || !created) throw new Error('ACTION_CASE_CREATE_FAILED')

  const { error: itemsError } = await admin.from('action_case_items').insert(
    itemTitles.map((itemTitle, index) => ({
      org_id: context.orgId,
      action_case_id: created.id,
      title: itemTitle,
      sort_order: (index + 1) * 100,
      created_by: context.userId,
      updated_by: context.userId,
    }))
  )
  if (itemsError) {
    await admin.from('action_cases').delete().eq('id', created.id).eq('org_id', context.orgId)
    throw new Error('ACTION_CASE_CREATE_FAILED')
  }
  if (nullableText(payload.customerEmail) || nullableText(payload.customerPhone)) {
    const { error: participantError } = await admin.from('action_case_participants').insert({
      org_id: context.orgId,
      action_case_id: created.id,
      role: 'customer',
      name: customerName,
      email: nullableText(payload.customerEmail),
      phone: nullableText(payload.customerPhone),
      created_by: context.userId,
    })
    if (participantError) {
      await admin.from('action_cases').delete().eq('id', created.id).eq('org_id', context.orgId)
      throw new Error('ACTION_CASE_CREATE_FAILED')
    }
  }
  await admin.from('action_case_events').insert({
    org_id: context.orgId,
    action_case_id: created.id,
    event_type: 'case_created',
    message: `${itemTitles.length} åtgärder skapades.`,
    performed_by: context.userId,
  })
  return created.id
}

export async function addActionCaseItem(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const title = text(payload.title)
  if (!caseId || !title) throw new Error('ACTION_CASE_ITEM_REQUIRED')
  await requireCase(context, caseId)
  const admin = createSupabaseAdminClient()
  // Retry ordering conflicts when two colleagues append to the same case.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data: last, error: readError } = await admin.from('action_case_items').select('sort_order')
      .eq('action_case_id', caseId).eq('org_id', context.orgId).order('sort_order', { ascending: false }).limit(1).maybeSingle()
    if (readError) throw new Error('ACTION_CASE_ITEM_UPDATE_FAILED')
    const { data, error } = await admin.from('action_case_items').insert({
      org_id: context.orgId, action_case_id: caseId, title,
      sort_order: Number(last?.sort_order ?? 0) + 100,
      created_by: context.userId, updated_by: context.userId,
    }).select('id').single()
    if (error?.code === '23505') continue
    if (error || !data) throw new Error('ACTION_CASE_ITEM_UPDATE_FAILED')
    await admin.from('action_cases').update({ status: 'pricing', updated_by: context.userId })
      .eq('id', caseId).eq('org_id', context.orgId).in('status', ['preparing', 'pricing', 'quote_ready'])
    await admin.from('action_case_events').insert({ org_id: context.orgId, action_case_id: caseId,
      action_case_item_id: data.id, event_type: 'item_added', message: `Åtgärd tillagd: ${title}.`, performed_by: context.userId })
    return data.id
  }
  throw new Error('ACTION_CASE_ITEM_UPDATE_FAILED')
}

export async function addActionCaseParticipant(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const name = text(payload.name)
  const email = nullableText(payload.email)?.toLowerCase() ?? null
  const phone = nullableText(payload.phone)
  if (!caseId || !name || (!email && !phone)) throw new Error('ACTION_CASE_PARTICIPANT_INVALID')
  await requireCase(context, caseId)
  const { error } = await createSupabaseAdminClient().from('action_case_participants').insert({
    org_id: context.orgId, action_case_id: caseId, role: 'subcontractor', name,
    company_name: nullableText(payload.companyName), email, phone, created_by: context.userId,
  })
  if (error) throw new Error('ACTION_CASE_PARTICIPANT_CREATE_FAILED')
}

export async function createActionCaseSignedUpload(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const fileName = text(payload.fileName)
  const declaredContentType = text(payload.contentType)
  const fileSize = Number(payload.fileSize)
  const allowed = resolveAllowedFile(fileName, declaredContentType)
  if (!caseId || !fileName || !allowed || !Number.isFinite(fileSize) || fileSize <= 0 || fileSize > MAX_FILE_BYTES) {
    throw new Error(fileSize > MAX_FILE_BYTES ? 'ACTION_CASE_FILE_TOO_LARGE' : 'ACTION_CASE_FILE_INVALID')
  }
  await requireCase(context, caseId)
  const filePath = `${context.orgId}/${caseId}/${Date.now()}-${randomUUID()}.${allowed.extension}`
  const { data, error } = await createSupabaseAdminClient().storage.from(ACTION_CASE_BUCKET).createSignedUploadUrl(filePath, { upsert: false })
  if (error || !data?.token) throw new Error('ACTION_CASE_FILE_UPLOAD_URL_FAILED')
  return { bucket: ACTION_CASE_BUCKET, filePath, token: data.token, contentType: allowed.contentType }
}

export async function abortActionCaseUpload(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const filePath = text(payload.filePath)
  if (!caseId || !filePath.startsWith(`${context.orgId}/${caseId}/`) || filePath.includes('..')) {
    throw new Error('ACTION_CASE_FILE_INVALID')
  }
  await requireCase(context, caseId)
  const { error } = await createSupabaseAdminClient().storage.from(ACTION_CASE_BUCKET).remove([filePath])
  if (error) throw new Error('ACTION_CASE_FILE_DELETE_FAILED')
}

export async function completeActionCaseUpload(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const filePath = text(payload.filePath)
  const fileName = text(payload.fileName)
  const declaredContentType = text(payload.contentType)
  const fileSize = Number(payload.fileSize)
  const allowed = resolveAllowedFile(fileName, declaredContentType)
  const expectedPrefix = `${context.orgId}/${caseId}/`
  if (!caseId || !filePath.startsWith(expectedPrefix) || filePath.includes('..') || !allowed || !fileName || fileSize <= 0 || fileSize > MAX_FILE_BYTES) {
    throw new Error('ACTION_CASE_FILE_INVALID')
  }
  await requireCase(context, caseId)
  const itemId = nullableText(payload.itemId)
  if (itemId) {
    const { data } = await createSupabaseAdminClient().from('action_case_items').select('id').eq('id', itemId).eq('action_case_id', caseId).eq('org_id', context.orgId).maybeSingle()
    if (!data) throw new Error('ACTION_CASE_ITEM_REQUIRED')
  }
  const requestedGrants = Array.isArray(payload.participantIds)
    ? [...new Set(payload.participantIds.map(text).filter(Boolean))]
    : []
  const admin = createSupabaseAdminClient()
  const { data: storedObject, error: storedObjectError } = await admin.storage
    .from(ACTION_CASE_BUCKET)
    .info(filePath)
  const storedSize = Number(storedObject?.size ?? storedObject?.metadata?.size ?? 0)
  const storedContentType = String(storedObject?.contentType ?? storedObject?.metadata?.mimetype ?? '').toLowerCase()
  if (
    storedObjectError
    || !storedObject
    || (storedSize > 0 && storedSize !== fileSize)
    || (storedContentType && storedContentType !== allowed.contentType)
  ) {
    await admin.storage.from(ACTION_CASE_BUCKET).remove([filePath])
    throw new Error('ACTION_CASE_FILE_UPLOAD_INCOMPLETE')
  }
  const { data: validParticipants } = requestedGrants.length
    ? await admin.from('action_case_participants').select('id').eq('action_case_id', caseId).eq('org_id', context.orgId).in('id', requestedGrants)
    : { data: [] }
  if ((validParticipants ?? []).length !== new Set(requestedGrants).size) throw new Error('ACTION_CASE_FILE_GRANT_INVALID')

  const { data: attachment, error } = await admin.from('action_case_attachments').insert({
    org_id: context.orgId,
    action_case_id: caseId,
    action_case_item_id: itemId,
    attachment_type: allowed.type,
    title: nullableText(payload.title),
    file_name: safeName(fileName),
    storage_bucket: ACTION_CASE_BUCKET,
    file_path: filePath,
    content_type: allowed.contentType,
    file_size_bytes: fileSize,
    uploaded_by: context.userId,
  }).select('id').single()
  if (error || !attachment) {
    await admin.storage.from(ACTION_CASE_BUCKET).remove([filePath])
    throw new Error('ACTION_CASE_FILE_SAVE_FAILED')
  }
  if (requestedGrants.length) {
    const { error: grantError } = await admin.from('action_case_attachment_grants').insert(requestedGrants.map((participantId) => ({ attachment_id: attachment.id, participant_id: participantId, granted_by: context.userId })))
    if (grantError) {
      await admin.from('action_case_attachments').delete().eq('id', attachment.id)
      await admin.storage.from(ACTION_CASE_BUCKET).remove([filePath])
      throw new Error('ACTION_CASE_FILE_GRANT_FAILED')
    }
  }
  await admin.from('action_case_events').insert({ org_id: context.orgId, action_case_id: caseId, action_case_item_id: itemId, event_type: 'attachment_added', message: `${allowed.type === 'image' ? 'Bild' : 'Dokument'} lades till: ${safeName(fileName)}.`, performed_by: context.userId })
}

export async function updateActionCaseAttachmentGrants(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const attachmentId = text(payload.attachmentId)
  const participantIds = Array.isArray(payload.participantIds) ? [...new Set(payload.participantIds.map(text).filter(Boolean))] : []
  await requireCase(context, caseId)
  const admin = createSupabaseAdminClient()
  const { data: attachment } = await admin.from('action_case_attachments').select('id').eq('id', attachmentId).eq('action_case_id', caseId).eq('org_id', context.orgId).maybeSingle()
  if (!attachment) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  const { data: participants } = participantIds.length ? await admin.from('action_case_participants').select('id').eq('action_case_id', caseId).eq('org_id', context.orgId).in('id', participantIds) : { data: [] }
  if ((participants ?? []).length !== participantIds.length) throw new Error('ACTION_CASE_FILE_GRANT_INVALID')
  await admin.from('action_case_attachment_grants').delete().eq('attachment_id', attachmentId)
  if (participantIds.length) {
    const { error } = await admin.from('action_case_attachment_grants').insert(participantIds.map((participantId) => ({ attachment_id: attachmentId, participant_id: participantId, granted_by: context.userId })))
    if (error) throw new Error('ACTION_CASE_FILE_GRANT_FAILED')
  }
}

export async function deleteActionCaseAttachment(context: Context, payload: Record<string, unknown>) {
  const caseId = text(payload.caseId)
  const attachmentId = text(payload.attachmentId)
  await requireCase(context, caseId)
  const admin = createSupabaseAdminClient()
  const { data: attachment } = await admin.from('action_case_attachments').select('storage_bucket,file_path,file_name').eq('id', attachmentId).eq('action_case_id', caseId).eq('org_id', context.orgId).maybeSingle()
  if (!attachment) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  // Let database references protect historical quote documents before touching storage.
  const { data: deleted, error } = await admin.from('action_case_attachments').delete().eq('id', attachmentId).eq('action_case_id', caseId).eq('org_id', context.orgId).select('id').maybeSingle()
  if (error) {
    if (error.code === '23503' || error.message?.includes('ACTION_CASE_PACKAGE_USE_RPC') || error.message?.includes('ACTION_CASE_PACKAGE_REMOVE_FIRST')) throw new Error('ACTION_CASE_FILE_IN_USE')
    throw new Error('ACTION_CASE_FILE_DELETE_FAILED')
  }
  if (!deleted) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  const { error: storageError } = await admin.storage.from(attachment.storage_bucket).remove([attachment.file_path])
  if (storageError) {
    console.error('ACTION_CASE_FILE_STORAGE_CLEANUP_FAILED', { orgId: context.orgId, caseId, attachmentId, bucket: attachment.storage_bucket, path: attachment.file_path, error: storageError.message })
    throw new Error('ACTION_CASE_FILE_DELETE_FAILED')
  }
  await admin.from('action_case_events').insert({ org_id: context.orgId, action_case_id: caseId, event_type: 'attachment_deleted', message: `Filen togs bort: ${attachment.file_name}.`, performed_by: context.userId })
}

export async function createActionCaseAttachmentUrl(context: Context, caseId: string, attachmentId: string) {
  await requireCase(context, caseId)
  const admin = createSupabaseAdminClient()
  const { data } = await admin.from('action_case_attachments').select('storage_bucket,file_path,file_name,content_type').eq('id', attachmentId).eq('action_case_id', caseId).eq('org_id', context.orgId).maybeSingle()
  if (!data) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  const inline = data.content_type.startsWith('image/') || data.content_type === 'application/pdf'
  const { data: signed, error } = await admin.storage.from(data.storage_bucket).createSignedUrl(data.file_path, 60, inline ? undefined : { download: data.file_name })
  if (error || !signed) throw new Error('ACTION_CASE_FILE_SIGN_FAILED')
  return signed.signedUrl
}

export async function issueActionCaseParticipantLink(context: Context, payload: Record<string, unknown>, origin: string) {
  const caseId = text(payload.caseId)
  const participantId = text(payload.participantId)
  await requireCase(context, caseId)
  const admin = createSupabaseAdminClient()
  const { data: participant } = await admin.from('action_case_participants').select('id').eq('id', participantId).eq('action_case_id', caseId).eq('org_id', context.orgId).maybeSingle()
  if (!participant) throw new Error('ACTION_CASE_PARTICIPANT_NOT_FOUND')
  await admin.from('action_case_access_links').update({ revoked_at: new Date().toISOString() }).eq('participant_id', participantId).is('revoked_at', null)
  const token = generateAssignmentToken()
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await admin.from('action_case_access_links').insert({ org_id: context.orgId, action_case_id: caseId, participant_id: participantId, token_hash: hashAssignmentToken(token), expires_at: expiresAt, created_by: context.userId })
  if (error) throw new Error('ACTION_CASE_ACCESS_LINK_FAILED')
  return `${origin.replace(/\/$/, '')}/atgardsarende/${token}`
}

async function resolveActionCaseAccess(token: string) {
  if (!token || token.length < 32) return null
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('action_case_access_links')
    .select('id,org_id,action_case_id,participant_id,expires_at,revoked_at')
    .eq('token_hash', hashAssignmentToken(token)).maybeSingle()
  if (error) throw new Error('ACTION_CASE_ACCESS_READ_FAILED')
  return data
}

export async function getActionCasePortal(token: string): Promise<ActionCasePortal | null> {
  const access = await resolveActionCaseAccess(token)
  if (!access) return null
  const now = Date.now()
  const accessState: ActionCasePortal['accessState'] = access.revoked_at
    ? 'revoked'
    : new Date(access.expires_at).getTime() <= now ? 'expired' : 'open'
  const admin = createSupabaseAdminClient()
  const [{ data: participant }, { data: actionCase }, { data: items }] = await Promise.all([
    admin.from('action_case_participants').select('id,role,name,company_name,email,phone').eq('id', access.participant_id).eq('action_case_id', access.action_case_id).eq('org_id', access.org_id).maybeSingle(),
    admin.from('action_cases').select('id,title,property_address,description,status').eq('id', access.action_case_id).eq('org_id', access.org_id).maybeSingle(),
    admin.from('action_case_items').select('id,title,scope,status,sort_order').eq('action_case_id', access.action_case_id).eq('org_id', access.org_id).order('sort_order'),
  ])
  if (!participant || !actionCase) return null
  const { data: grants } = await admin.from('action_case_attachment_grants').select('attachment_id').eq('participant_id', access.participant_id)
  const attachmentIds = (grants ?? []).map((grant) => grant.attachment_id)
  const { data: attachments } = attachmentIds.length
    ? await admin.from('action_case_attachments').select('id,action_case_item_id,attachment_type,title,file_name,content_type,file_size_bytes,created_at').eq('action_case_id', access.action_case_id).eq('org_id', access.org_id).in('id', attachmentIds).order('created_at', { ascending: false })
    : { data: [] }
  if (accessState === 'open') await admin.from('action_case_access_links').update({ last_opened_at: new Date().toISOString() }).eq('id', access.id)
  const mappedAttachments: ActionCaseAttachmentView[] = (attachments ?? []).map((attachment) => ({
    id: attachment.id,
    actionCaseItemId: attachment.action_case_item_id,
    type: attachment.attachment_type,
    title: attachment.title,
    fileName: attachment.file_name,
    contentType: attachment.content_type,
    fileSizeBytes: Number(attachment.file_size_bytes),
    grantedParticipantIds: [participant.id],
    createdAt: attachment.created_at,
  }))
  const visibleItems = filterActionCasePortalItems(
    participant.role,
    items ?? [],
    mappedAttachments.map((attachment) => attachment.actionCaseItemId)
  )
  return {
    accessState,
    participant: { id: participant.id, role: participant.role, name: participant.name, companyName: participant.company_name, email: participant.email, phone: participant.phone },
    actionCase: {
      id: actionCase.id,
      title: actionCase.title,
      propertyAddress: actionCase.property_address,
      description: actionCase.description,
      status: actionCase.status,
      items: visibleItems.map((item) => ({ id: item.id, title: item.title, scope: item.scope, status: item.status, sortOrder: item.sort_order })),
      attachments: mappedAttachments,
    },
  }
}

export async function createActionCasePortalAttachmentUrl(token: string, attachmentId: string) {
  const access = await resolveActionCaseAccess(token)
  if (!access || access.revoked_at || new Date(access.expires_at).getTime() <= Date.now()) throw new Error('ACTION_CASE_ACCESS_CLOSED')
  const admin = createSupabaseAdminClient()
  const { data: grant } = await admin.from('action_case_attachment_grants').select('attachment_id').eq('attachment_id', attachmentId).eq('participant_id', access.participant_id).maybeSingle()
  if (!grant) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  const { data: attachment } = await admin.from('action_case_attachments').select('storage_bucket,file_path,file_name,content_type').eq('id', attachmentId).eq('action_case_id', access.action_case_id).eq('org_id', access.org_id).maybeSingle()
  if (!attachment) throw new Error('ACTION_CASE_FILE_NOT_FOUND')
  const inline = attachment.content_type.startsWith('image/') || attachment.content_type === 'application/pdf'
  const { data: signed, error } = await admin.storage.from(attachment.storage_bucket).createSignedUrl(attachment.file_path, 60, inline ? undefined : { download: attachment.file_name })
  if (error || !signed) throw new Error('ACTION_CASE_FILE_SIGN_FAILED')
  return signed.signedUrl
}

export async function updateActionCaseItem(context: Context, payload: Record<string, unknown>) {
  const itemId = text(payload.itemId)
  if (!itemId) throw new Error('ACTION_CASE_ITEM_REQUIRED')
  const admin = createSupabaseAdminClient()
  const { data: existing, error: readError } = await admin
    .from('action_case_items')
    .select('*')
    .eq('id', itemId)
    .eq('org_id', context.orgId)
    .single()
  if (readError || !existing) throw new Error('ACTION_CASE_ITEM_UPDATE_FAILED')

  const patch: Record<string, unknown> = { updated_by: context.userId }
  if ('title' in payload) patch.title = text(payload.title)
  if ('scope' in payload) patch.scope = nullableText(payload.scope)
  if ('scopeAttachmentIds' in payload) {
    if (!('scope_attachment_ids' in existing)) throw new Error('ACTION_CASES_SCHEMA_REQUIRED')
    if (!payload.expectedUpdatedAt) throw new Error('ACTION_CASE_ITEM_STALE')
    const ids = parseScopeAttachmentIds(payload.scopeAttachmentIds)
    if (ids.length) {
      const { data: files, error: fileError } = await admin.from('action_case_attachments').select('id')
        .eq('org_id', context.orgId).eq('action_case_id', existing.action_case_id).in('id', ids)
      if (fileError || files?.length !== ids.length) throw new Error('ACTION_CASE_SCOPE_ATTACHMENTS_INVALID')
    }
    patch.scope_attachment_ids = ids
  }
  if ('status' in payload) patch.status = text(payload.status)
  for (const [input, column] of [
    ['ownLaborReady', 'own_labor_ready'],
    ['materialPriceReady', 'material_price_ready'],
    ['subcontractorPriceReady', 'subcontractor_price_ready'],
    ['wasteSolutionReady', 'waste_solution_ready'],
    ['requiresSubcontractor', 'requires_subcontractor'],
  ] as const) if (input in payload) patch[column] = Boolean(payload[input])

  const merged = { ...existing, ...patch }
  const scopeReady = Boolean(String(merged.scope ?? '').trim())
  const pricingReady = Boolean(
    merged.own_labor_ready
    && merged.material_price_ready
    && merged.waste_solution_ready
    && (!merged.requires_subcontractor || merged.subcontractor_price_ready)
  )
  if (['scope_needed', 'pricing_needed', 'waiting_subcontractor', 'ready_for_quote'].includes(existing.status)) {
    patch.status = scopeReady ? (pricingReady ? 'ready_for_quote' : 'pricing_needed') : 'scope_needed'
  } else {
    delete patch.status
  }

  let update = admin.from('action_case_items').update(patch).eq('id', itemId).eq('org_id', context.orgId)
  if (payload.expectedUpdatedAt) update = update.eq('updated_at', text(payload.expectedUpdatedAt))
  const { data: updated, error } = await update.select('id').maybeSingle()
  if (error?.message?.includes('ACTION_CASE_SCOPE_ATTACHMENTS_INVALID')) throw new Error('ACTION_CASE_SCOPE_ATTACHMENTS_INVALID')
  if (!error && !updated && payload.expectedUpdatedAt) throw new Error('ACTION_CASE_ITEM_STALE')
  if (error || !updated) throw new Error('ACTION_CASE_ITEM_UPDATE_FAILED')

  const { data: siblings } = await admin
    .from('action_case_items')
    .select('status')
    .eq('action_case_id', existing.action_case_id)
    .eq('org_id', context.orgId)
  const allQuoteReady = Boolean(siblings?.length) && siblings!.every((item) => item.status === 'ready_for_quote')
  await admin.from('action_cases').update({ status: allQuoteReady ? 'quote_ready' : 'pricing', updated_by: context.userId })
    .eq('id', existing.action_case_id).eq('org_id', context.orgId).in('status', ['preparing', 'pricing', 'quote_ready'])
  await admin.from('action_case_events').insert({
    org_id: context.orgId,
    action_case_id: existing.action_case_id,
    action_case_item_id: itemId,
    event_type: 'item_updated',
    message: `Åtgärden uppdaterades till ${String(patch.status)}.`,
    performed_by: context.userId,
  })
}
