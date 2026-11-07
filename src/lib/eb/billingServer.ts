import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  emptyEbInspectionBilling, unavailableEbInspectionBilling,
  parseEbInspectionBilling, parseEbInspectionBillingPatch,
  type EbInspectionBilling, type EbInspectionBillingPatch,
} from './billing'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type Scope = { orgId: string; projectId: string; inspectionId: string; admin?: AdminClient }
type BillingRow = {
  inspection_id: string; eb_project_id: string; is_invoiced: boolean
  invoiced_at: string | null; invoice_number: string | null; updated_at: string
  updated_by_name: string | null; revision: number
}
const columns = 'inspection_id,eb_project_id,is_invoiced,invoiced_at,invoice_number,updated_at,updated_by_name,revision'
const missingSchema = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])
const knownErrors = ['EB_INSPECTION_NOT_FOUND', 'EB_BILLING_ACTOR_FORBIDDEN', 'EB_BILLING_CONFLICT',
  'EB_BILLING_INPUT_INVALID', 'EB_BILLING_CONFIGURATION', 'EB_BILLING_UNAVAILABLE']

function databaseFailure(error: { code?: string; message?: string } | null) {
  if (!error) return
  for (const code of knownErrors) if (error.message?.includes(code)) throw new Error(code)
  throw new Error(missingSchema.has(error.code || '') ? 'EB_BILLING_CONFIGURATION' : 'EB_BILLING_UNAVAILABLE')
}

async function operation<T>(callback: () => Promise<T>): Promise<T> {
  try { return await callback() }
  catch (error) {
    if (error instanceof Error && knownErrors.includes(error.message)) throw error
    if (error && typeof error === 'object' && missingSchema.has(String((error as { code?: unknown }).code))) {
      throw new Error('EB_BILLING_CONFIGURATION')
    }
    throw new Error('EB_BILLING_UNAVAILABLE')
  }
}

function mapRow(row: BillingRow): EbInspectionBilling {
  const result = parseEbInspectionBilling({
    status: row.is_invoiced ? 'invoiced' : 'not_invoiced', invoicedAt: row.invoiced_at,
    invoiceNumber: row.invoice_number, updatedAt: row.updated_at, updatedByName: row.updated_by_name,
    revision: row.revision,
  })
  if (typeof row.is_invoiced !== 'boolean' || !result) throw new Error('EB_BILLING_UNAVAILABLE')
  return result
}

export async function getEbInspectionBilling(input: Scope): Promise<EbInspectionBilling> {
  return operation(async () => {
    const admin = input.admin ?? createSupabaseAdminClient()
    const [detail, project] = await Promise.all([
      admin.from('eb_inspection_details').select('inspection_id').eq('org_id', input.orgId)
        .eq('eb_project_id', input.projectId).eq('inspection_id', input.inspectionId).maybeSingle(),
      admin.from('eb_projects').select('id').eq('org_id', input.orgId).eq('id', input.projectId).maybeSingle(),
    ])
    databaseFailure(detail.error); databaseFailure(project.error)
    if (!detail.data || !project.data) throw new Error('EB_INSPECTION_NOT_FOUND')
    const result = await admin.from('eb_inspection_billing').select(columns).eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId).eq('inspection_id', input.inspectionId).maybeSingle()
    databaseFailure(result.error)
    return result.data ? mapRow(result.data as BillingRow) : emptyEbInspectionBilling()
  })
}

export async function saveEbInspectionBilling(
  input: Scope & EbInspectionBillingPatch & { userId: string },
): Promise<EbInspectionBilling> {
  return operation(async () => {
    const patch = parseEbInspectionBillingPatch(input)
    const { data, error } = await (input.admin ?? createSupabaseAdminClient()).rpc('eb_set_inspection_billing', {
      p_org_id: input.orgId, p_project_id: input.projectId, p_inspection_id: input.inspectionId,
      p_actor: input.userId, p_is_invoiced: patch.isInvoiced,
      p_invoice_number: patch.invoiceNumber, p_expected_revision: patch.expectedRevision,
    })
    databaseFailure(error)
    const result = parseEbInspectionBilling(data)
    if (!result) throw new Error('EB_BILLING_UNAVAILABLE')
    return result
  })
}

/** Optional internal metadata never prevents the ordinary EB list/report from opening. */
export async function loadEbInspectionBillingForProjects(input: {
  orgId: string
  projects: ReadonlyArray<{ id: string; inspections: ReadonlyArray<{ inspectionId: string }> }>
  admin?: AdminClient
}): Promise<Map<string, EbInspectionBilling>> {
  const expected = new Map(input.projects.flatMap(project =>
    project.inspections.map(inspection => [inspection.inspectionId, project.id] as const)))
  const result = new Map([...expected.keys()].map(id => [id, emptyEbInspectionBilling()]))
  if (!expected.size) return result
  try {
    const admin = input.admin ?? createSupabaseAdminClient()
    const ids = [...expected.keys()]
    // Bounded batches avoid PostgREST URL/row limits; never a query per inspection.
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batchIds = ids.slice(offset, offset + 200)
      const projectIds = [...new Set(batchIds.map(id => expected.get(id)!))]
      const query = await admin.from('eb_inspection_billing').select(columns).eq('org_id', input.orgId)
        .in('eb_project_id', projectIds).in('inspection_id', batchIds)
      databaseFailure(query.error)
      for (const row of (query.data ?? []) as BillingRow[]) {
        if (expected.get(row.inspection_id) !== row.eb_project_id) throw new Error('EB_BILLING_UNAVAILABLE')
        result.set(row.inspection_id, mapRow(row))
      }
    }
    return result
  } catch {
    return new Map([...expected.keys()].map(id => [id, unavailableEbInspectionBilling()]))
  }
}
