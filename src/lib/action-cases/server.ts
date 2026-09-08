import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { ActionCaseItemView, ActionCaseView, ActionCaseWorkspace } from './contracts'

type Context = { orgId: string; userId: string }

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  return text(value) || null
}

function mapItem(row: Record<string, unknown>): ActionCaseItemView {
  return {
    id: String(row.id),
    title: String(row.title),
    scope: row.scope ? String(row.scope) : null,
    status: row.status as ActionCaseItemView['status'],
    sortOrder: Number(row.sort_order),
    ownLaborReady: Boolean(row.own_labor_ready),
    materialPriceReady: Boolean(row.material_price_ready),
    subcontractorPriceReady: Boolean(row.subcontractor_price_ready),
    wasteSolutionReady: Boolean(row.waste_solution_ready),
    requiresSubcontractor: Boolean(row.requires_subcontractor),
    estimatedCost: row.estimated_cost === null ? null : Number(row.estimated_cost),
    customerPrice: row.customer_price === null ? null : Number(row.customer_price),
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

  const itemsByCase = new Map<string, ActionCaseItemView[]>()
  for (const row of items ?? []) {
    const list = itemsByCase.get(row.action_case_id) ?? []
    list.push(mapItem(row))
    itemsByCase.set(row.action_case_id, list)
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
  }))

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
  await admin.from('action_case_events').insert({
    org_id: context.orgId,
    action_case_id: created.id,
    event_type: 'case_created',
    message: `${itemTitles.length} åtgärder skapades.`,
    performed_by: context.userId,
  })
  return created.id
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
  patch.status = scopeReady ? (pricingReady ? 'ready_for_quote' : 'pricing_needed') : 'scope_needed'

  const { error } = await admin.from('action_case_items').update(patch).eq('id', itemId).eq('org_id', context.orgId)
  if (error) throw new Error('ACTION_CASE_ITEM_UPDATE_FAILED')

  const { data: siblings } = await admin
    .from('action_case_items')
    .select('status')
    .eq('action_case_id', existing.action_case_id)
    .eq('org_id', context.orgId)
  const allQuoteReady = Boolean(siblings?.length) && siblings!.every((item) => item.status === 'ready_for_quote')
  await admin.from('action_cases').update({ status: allQuoteReady ? 'quote_ready' : 'pricing', updated_by: context.userId })
    .eq('id', existing.action_case_id).eq('org_id', context.orgId)
  await admin.from('action_case_events').insert({
    org_id: context.orgId,
    action_case_id: existing.action_case_id,
    action_case_item_id: itemId,
    event_type: 'item_updated',
    message: `Åtgärden uppdaterades till ${String(patch.status)}.`,
    performed_by: context.userId,
  })
}
