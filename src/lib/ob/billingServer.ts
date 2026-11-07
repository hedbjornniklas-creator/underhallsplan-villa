import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  emptyObInspectionBilling, parseObInspectionBilling, parseObInspectionBillingPatch,
  type ObInspectionBilling, type ObInspectionBillingPatch,
} from './billing'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type Scope = { orgId: string; inspectionId: string; admin?: AdminClient }
type BillingRow = {
  is_invoiced: boolean; invoiced_at: string | null; invoice_number: string | null
  updated_at: string; updated_by_name: string | null; revision: number
}
const columns = 'is_invoiced,invoiced_at,invoice_number,updated_at,updated_by_name,revision'
const missingSchema = new Set(['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'])
const knownErrors = ['OB_INSPECTION_NOT_FOUND', 'OB_BILLING_ACTOR_FORBIDDEN', 'OB_BILLING_CONFLICT',
  'OB_BILLING_INPUT_INVALID', 'OB_BILLING_CONFIGURATION', 'OB_BILLING_UNAVAILABLE']

function databaseFailure(error: { code?: string; message?: string } | null) {
  if (!error) return
  for (const code of knownErrors) if (error.message?.includes(code)) throw new Error(code)
  throw new Error(missingSchema.has(error.code || '') ? 'OB_BILLING_CONFIGURATION' : 'OB_BILLING_UNAVAILABLE')
}

async function operation<T>(callback: () => Promise<T>): Promise<T> {
  try { return await callback() }
  catch (error) {
    if (error instanceof Error && knownErrors.includes(error.message)) throw error
    if (error && typeof error === 'object' && missingSchema.has(String((error as { code?: unknown }).code))) {
      throw new Error('OB_BILLING_CONFIGURATION')
    }
    throw new Error('OB_BILLING_UNAVAILABLE')
  }
}

function mapRow(row: BillingRow): ObInspectionBilling {
  const result = parseObInspectionBilling({
    status: row.is_invoiced ? 'invoiced' : 'not_invoiced', invoicedAt: row.invoiced_at,
    invoiceNumber: row.invoice_number, updatedAt: row.updated_at, updatedByName: row.updated_by_name,
    revision: row.revision,
  })
  if (typeof row.is_invoiced !== 'boolean' || !result) throw new Error('OB_BILLING_UNAVAILABLE')
  return result
}

/** Call only after requireObInspectionReadContext has authorized this exact entity. */
export async function getObInspectionBilling(input: Scope): Promise<ObInspectionBilling> {
  return operation(async () => {
    const admin = input.admin ?? createSupabaseAdminClient()
    const binding = await admin.from('ob_organization_bindings').select('inspection_id')
      .eq('org_id', input.orgId).eq('inspection_id', input.inspectionId).maybeSingle()
    databaseFailure(binding.error)
    if (!binding.data) throw new Error('OB_INSPECTION_NOT_FOUND')
    const result = await admin.from('ob_inspection_billing').select(columns)
      .eq('org_id', input.orgId).eq('inspection_id', input.inspectionId).maybeSingle()
    databaseFailure(result.error)
    return result.data ? mapRow(result.data as BillingRow) : emptyObInspectionBilling()
  })
}

/** Atomic RPC independently repeats the owner, module, organization and revision guards. */
export async function saveObInspectionBilling(
  input: Scope & ObInspectionBillingPatch & { userId: string },
): Promise<ObInspectionBilling> {
  return operation(async () => {
    const patch = parseObInspectionBillingPatch(input)
    const { data, error } = await (input.admin ?? createSupabaseAdminClient()).rpc('ob_set_inspection_billing', {
      p_org_id: input.orgId, p_inspection_id: input.inspectionId, p_actor: input.userId,
      p_is_invoiced: patch.isInvoiced, p_invoice_number: patch.invoiceNumber,
      p_expected_revision: patch.expectedRevision,
    })
    databaseFailure(error)
    const result = parseObInspectionBilling(data)
    if (!result) throw new Error('OB_BILLING_UNAVAILABLE')
    return result
  })
}
