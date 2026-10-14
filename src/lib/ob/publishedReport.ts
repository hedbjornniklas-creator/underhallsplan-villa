import type { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { isReportSnapshotPayloadV1 } from '@/lib/report/reportSnapshotPayload'
export { obPublishedReportHref } from './publishedReportLink'

type Admin = ReturnType<typeof createSupabaseAdminClient>
type Access = { orgId: string; userId: string }
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

export async function getObPublishedReportRecord(admin: Admin, inspectionId: string, linkId: string, access: Access) {
  if (!UUID.test(inspectionId) || !UUID.test(linkId)) return null
  const { data: inspection, error: inspectionError } = await admin.from('inspections')
    .select('id,property_id,inspection_family').eq('id', inspectionId).maybeSingle()
  if (inspectionError) throw Error('Kunde inte hämta besiktningen.')
  if (!inspection || (inspection.inspection_family && inspection.inspection_family !== 'OB')) return null
  const { data: assignment, error: assignmentError } = await admin.from('assignments')
    .select('id').eq('inspection_id', inspectionId).eq('org_id', access.orgId).maybeSingle()
  if (assignmentError) throw Error('Kunde inte verifiera behörigheten.')
  if (!assignment) {
    if (!inspection.property_id) return null
    const { data: property, error } = await admin.from('properties').select('id')
      .eq('id', inspection.property_id).eq('owner', access.userId).maybeSingle()
    if (error) throw Error('Kunde inte verifiera behörigheten.')
    if (!property) return null
  }
  const { data, error } = await admin.from('inspection_report_links')
    .select('snapshot_payload,token_hash,pdf_status,pdf_base64,pdf_storage_bucket,pdf_storage_path').eq('id', linkId).eq('inspection_id', inspectionId)
    .eq('org_id', access.orgId).is('revoked_at', null).maybeSingle()
  if (error) throw Error('Kunde inte hämta det publicerade utlåtandet.')
  if (!data) return null
  const snapshot = data?.snapshot_payload
  if (!isReportSnapshotPayloadV1(snapshot) || snapshot.inspectionId !== inspectionId || snapshot.propertyId !== inspection.property_id) return null
  return { snapshot, tokenHash: String(data.token_hash ?? ''), pdfStatus: String(data.pdf_status ?? 'pending'),
    pdfBase64: String(data.pdf_base64 ?? ''), pdfStorageBucket: String(data.pdf_storage_bucket ?? ''),
    pdfStoragePath: String(data.pdf_storage_path ?? '') }
}

export async function getObPublishedReport(admin: Admin, inspectionId: string, linkId: string, access: Access) {
  return (await getObPublishedReportRecord(admin, inspectionId, linkId, access))?.snapshot ?? null
}

export function obPublishedPdfStatus(report: NonNullable<Awaited<ReturnType<typeof getObPublishedReportRecord>>>): 'ready' | 'pending' | 'processing' | 'failed' {
  if (report.pdfBase64.trim() || (report.pdfStorageBucket.trim() && report.pdfStoragePath.trim())) return 'ready'
  return report.pdfStatus === 'ready' ? 'failed' : report.pdfStatus === 'failed' || report.pdfStatus === 'processing' ? report.pdfStatus : 'pending'
}
