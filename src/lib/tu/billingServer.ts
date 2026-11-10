import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  emptyTuInvestigationBilling, parseTuInvestigationBilling, parseTuInvestigationBillingPatch,
  type TuInvestigationBilling, type TuInvestigationBillingPatch, type TuInvestigationBillingStatus,
} from './billing'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type Scope = { orgId: string; inspectionId: string; admin?: AdminClient }
type DetailRow = {
  inspection_id: string; org_id: string;
  inspections: { id: string; inspection_family: string | null; type: string | null }
    | Array<{ id: string; inspection_family: string | null; type: string | null }> | null
}
type BillingRow = {
  is_invoiced: boolean; invoiced_at: string | null; invoice_number: string | null;
  updated_at: string; updated_by_name: string | null; revision: number
}
const columns = 'is_invoiced,invoiced_at,invoice_number,updated_at,updated_by_name,revision'
const bindingColumns = 'inspection_id,org_id,inspections!inner(id,inspection_family,type)'
const missingSchema = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])
const knownErrors = ['TU_INVESTIGATION_NOT_FOUND', 'TU_BILLING_ACTOR_FORBIDDEN', 'TU_BILLING_CONFLICT',
  'TU_BILLING_INPUT_INVALID', 'TU_BILLING_CONFIGURATION', 'TU_BILLING_UNAVAILABLE']

function databaseFailure(error: { code?: string; message?: string } | null) {
  if (!error) return
  for (const code of knownErrors) if (error.message?.includes(code)) throw new Error(code)
  throw new Error(missingSchema.has(error.code || '') ? 'TU_BILLING_CONFIGURATION' : 'TU_BILLING_UNAVAILABLE')
}

async function operation<T>(callback: () => Promise<T>): Promise<T> {
  try { return await callback() }
  catch (error) {
    if (error instanceof Error && knownErrors.includes(error.message)) throw error
    if (error && typeof error === 'object' && missingSchema.has(String((error as { code?: unknown }).code))) {
      throw new Error('TU_BILLING_CONFIGURATION')
    }
    throw new Error('TU_BILLING_UNAVAILABLE')
  }
}

function validBinding(row: DetailRow, orgId: string, id: string) {
  const inspection = Array.isArray(row.inspections)
    ? row.inspections.length === 1 ? row.inspections[0] : null : row.inspections
  return row.inspection_id === id && row.org_id === orgId && inspection?.id === id
    && (inspection.inspection_family === 'TU' || (inspection.inspection_family === null && inspection.type === 'TU'))
}

function mapRow(row: BillingRow): TuInvestigationBilling {
  const result = parseTuInvestigationBilling({
    status: row.is_invoiced ? 'invoiced' : 'not_invoiced', invoicedAt: row.invoiced_at,
    invoiceNumber: row.invoice_number, updatedAt: row.updated_at, updatedByName: row.updated_by_name,
    revision: row.revision,
  })
  if (typeof row.is_invoiced !== 'boolean' || !result) throw new Error('TU_BILLING_UNAVAILABLE')
  return result
}

/** Call only after requireTuRequestContext has authorized this explicitly selected organization. */
export async function getTuInvestigationBilling(input: Scope): Promise<TuInvestigationBilling> {
  return operation(async () => {
    const admin = input.admin ?? createSupabaseAdminClient()
    const binding = await admin.from('technical_investigation_details').select(bindingColumns)
      .eq('org_id', input.orgId).eq('inspection_id', input.inspectionId).maybeSingle()
    databaseFailure(binding.error)
    if (!binding.data || !validBinding(binding.data as DetailRow, input.orgId, input.inspectionId)) {
      throw new Error('TU_INVESTIGATION_NOT_FOUND')
    }
    const result = await admin.from('tu_investigation_billing').select(columns)
      .eq('org_id', input.orgId).eq('inspection_id', input.inspectionId).maybeSingle()
    databaseFailure(result.error)
    return result.data ? mapRow(result.data as BillingRow) : emptyTuInvestigationBilling()
  })
}

/** Atomic RPC independently repeats organization, TU module, membership and revision checks. */
export async function saveTuInvestigationBilling(
  input: Scope & TuInvestigationBillingPatch & { userId: string },
): Promise<TuInvestigationBilling> {
  return operation(async () => {
    const patch = parseTuInvestigationBillingPatch(input)
    const { data, error } = await (input.admin ?? createSupabaseAdminClient()).rpc('tu_set_investigation_billing', {
      p_org_id: input.orgId, p_inspection_id: input.inspectionId, p_actor: input.userId,
      p_is_invoiced: patch.isInvoiced, p_invoice_number: patch.invoiceNumber,
      p_expected_revision: patch.expectedRevision,
    })
    databaseFailure(error)
    const result = parseTuInvestigationBilling(data)
    if (!result) throw new Error('TU_BILLING_UNAVAILABLE')
    return result
  })
}

/** Internal list loader only: IDs originate from the already-authorized TU org list.
 * Read no invoice number/audit fields and never interpret a failed read as unbilled.
 */
export async function getTuInvestigationBillingStatuses(input: {
  orgId: string; inspectionIds: readonly string[]; admin?: AdminClient
}): Promise<Map<string, TuInvestigationBillingStatus>> {
  const ids = [...new Set(input.inspectionIds)]
  const unavailable = () => new Map(ids.map(id => [id, { status: 'unavailable' as const }]))
  if (ids.length === 0) return new Map()
  try {
    const admin = input.admin ?? createSupabaseAdminClient()
    const result = new Map<string, TuInvestigationBillingStatus>()
    for (let offset = 0; offset < ids.length; offset += 200) {
      const batch = ids.slice(offset, offset + 200)
      const details = await admin.from('technical_investigation_details').select(bindingColumns)
        .eq('org_id', input.orgId).in('inspection_id', batch)
      databaseFailure(details.error)
      if (!Array.isArray(details.data) || details.data.length !== batch.length) return unavailable()
      const seen = new Set<string>()
      for (const row of details.data as DetailRow[]) {
        if (!batch.includes(row.inspection_id) || seen.has(row.inspection_id) || !validBinding(row, input.orgId, row.inspection_id)) return unavailable()
        seen.add(row.inspection_id); result.set(row.inspection_id, { status: 'not_invoiced' })
      }
      const billing = await admin.from('tu_investigation_billing').select('inspection_id,org_id,is_invoiced')
        .eq('org_id', input.orgId).in('inspection_id', batch)
      databaseFailure(billing.error)
      if (!Array.isArray(billing.data)) return unavailable()
      const billingSeen = new Set<string>()
      for (const row of billing.data) {
        if (!batch.includes(row.inspection_id) || row.org_id !== input.orgId || billingSeen.has(row.inspection_id)
          || typeof row.is_invoiced !== 'boolean') return unavailable()
        billingSeen.add(row.inspection_id)
        result.set(row.inspection_id, { status: row.is_invoiced ? 'invoiced' : 'not_invoiced' })
      }
    }
    return result
  } catch { return unavailable() }
}
