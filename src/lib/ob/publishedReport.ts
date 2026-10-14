import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { isReportSnapshotPayloadV1 } from '@/lib/report/reportSnapshotPayload'
import type { ObReadContext } from '@/lib/ob/organizationBindings'
export { obPublishedReportHref } from './publishedReportLink'

type Admin = ReturnType<typeof createSupabaseAdminClient>
type Access = Pick<ObReadContext, 'orgId' | 'userId' | 'canEdit'>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// Called after the delivery endpoint has checked inspection access.
export async function getLatestObPublishedReportId(admin: Admin, inspectionId: string, orgId: string) {
  const { data, error } = await admin.from('inspection_report_links')
    .select('id').eq('inspection_id', inspectionId).eq('org_id', orgId)
    .is('revoked_at', null).order('created_at', { ascending: false }).order('id', { ascending: false })
    .limit(1).maybeSingle()
  if (error) throw Error('Kunde inte hämta det publicerade utlåtandet.')
  return (data?.id as string | undefined) ?? null
}

/** Called only after requireObInspectionReadContext has authorized this entity. */
export async function getObPublishedReport(admin: Admin, inspectionId: string, linkId: string, access: Access) {
  if (!UUID.test(inspectionId) || !UUID.test(linkId) || typeof access.canEdit !== 'boolean') return null
  const { data: inspection, error: inspectionError } = await admin.from('inspections')
    .select('id,property_id,inspection_family,type').eq('id', inspectionId).maybeSingle()
  if (inspectionError) throw Error('Kunde inte hämta besiktningen.')
  if (!inspection || (inspection.inspection_family != null ? inspection.inspection_family !== 'OB' :
    !['OB', 'STATUS'].includes(inspection.type ?? ''))) return null
  // The immutable organization binding applies to linked and standalone
  // inspections alike; assignment presence cannot expand a reader's scope.
  const { data: binding, error: bindingError } = await admin.from('ob_organization_bindings')
    .select('inspection_id,org_id').eq('inspection_id', inspectionId).eq('org_id', access.orgId).maybeSingle()
  if (bindingError) throw Error('Kunde inte verifiera behörigheten.')
  if (!binding || binding.inspection_id !== inspectionId || binding.org_id !== access.orgId) return null
  const { data, error } = await admin.from('inspection_report_links')
    .select('snapshot_payload').eq('id', linkId).eq('inspection_id', inspectionId)
    .eq('org_id', access.orgId).is('revoked_at', null).maybeSingle()
  if (error) throw Error('Kunde inte hämta det publicerade utlåtandet.')
  const snapshot = data?.snapshot_payload
  if (!isReportSnapshotPayloadV1(snapshot) || snapshot.inspectionId !== inspectionId || snapshot.propertyId !== inspection.property_id) return null
  return snapshot
}
