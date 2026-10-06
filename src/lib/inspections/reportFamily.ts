import 'server-only'
import type { createSupabaseAdminClient } from '@/lib/supabase/admin'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type ReportFamily = 'EB' | 'TU'

const LEGACY_EB_TYPES = new Set(['EB', 'SLB', 'FB', 'GB', 'KSB', 'SAB'])

/** A module detail row is not proof that its parent belongs to that module. */
export async function requireInspectionReportFamily(
  admin: AdminClient,
  inspectionId: string,
  expectedFamily: ReportFamily
) {
  const { data, error } = await admin
    .from('inspections')
    .select('id,inspection_family,type')
    .eq('id', inspectionId)
    .maybeSingle()

  if (error) throw new Error('INSPECTION_FAMILY_READ_FAILED')
  if (!data) throw new Error(`${expectedFamily}_INSPECTION_NOT_FOUND`)

  // Canonical family takes precedence, including legacy EB records whose type
  // is still OB/SB. Without it, ambiguous SB must never authorize a mutation.
  const family = data.inspection_family ?? (
    LEGACY_EB_TYPES.has(data.type) ? 'EB' : data.type === 'TU' ? 'TU' : null
  )
  if (family !== expectedFamily) throw new Error(`${expectedFamily}_INSPECTION_NOT_FOUND`)

  const { data: binding, error: bindingError } = await admin
    .from('ob_organization_bindings')
    .select('inspection_id')
    .eq('inspection_id', inspectionId)
    .maybeSingle()
  if (bindingError) throw new Error('INSPECTION_FAMILY_READ_FAILED')
  if (binding) throw new Error(`${expectedFamily}_INSPECTION_NOT_FOUND`)
}
