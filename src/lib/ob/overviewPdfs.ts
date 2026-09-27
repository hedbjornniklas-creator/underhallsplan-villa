import type { SupabaseClient } from '@supabase/supabase-js'

type Report = { id: string; pdf_status: string | null; pdf_storage_bucket: string | null; pdf_storage_path: string | null }
type Row = { id: string; inspection_report_links: Report[] }

// Match the download endpoint's 25 newest non-revoked reports per inspection.
// Read only this page's metadata, never PDF bodies, snapshots or public tokens.
export async function loadOverviewPdfIds(client: SupabaseClient, orgId: string, inspectionIds: string[]) {
  const ready = new Set<string>()
  if (!inspectionIds.length) return ready
  if (inspectionIds.length > 50) throw new Error('För många besiktningar i PDF-kontrollen.')
  const { data, error } = await client.from('inspections')
    .select('id,inspection_report_links(id,pdf_status,pdf_storage_bucket,pdf_storage_path)')
    .in('id', inspectionIds)
    .eq('inspection_report_links.org_id', orgId)
    .is('inspection_report_links.revoked_at', null)
    .order('created_at', { ascending: false, referencedTable: 'inspection_report_links' })
    .limit(25, { referencedTable: 'inspection_report_links' })
  if (error) throw new Error('Kunde inte läsa PDF-status för uppdragslistan.')
  const legacyCandidates = new Map<string, string>()
  for (const row of (data ?? []) as Row[]) {
    if (!inspectionIds.includes(row.id)) continue
    const reports = row.inspection_report_links ?? []
    if (reports.some(report => report.pdf_status?.trim().toLowerCase() === 'ready' &&
      report.pdf_storage_bucket?.trim() && report.pdf_storage_path?.trim())) {
      ready.add(row.id)
    } else {
      reports.forEach(report => legacyCandidates.set(report.id, row.id))
    }
  }
  const ids = [...legacyCandidates.keys()]
  // Bounded ID batches keep PostgREST URLs small, including a 50-row page.
  for (let start = 0; start < ids.length; start += 80) {
    const { data: legacy, error: legacyError } = await client.from('inspection_report_links')
      .select('id').eq('org_id', orgId).is('revoked_at', null)
      .in('id', ids.slice(start, start + 80)).not('pdf_base64', 'is', null).neq('pdf_base64', '')
    if (legacyError) throw new Error('Kunde inte läsa PDF-status för äldre utlåtanden.')
    for (const report of legacy ?? []) {
      const inspectionId = legacyCandidates.get(report.id)
      if (inspectionId) ready.add(inspectionId)
    }
  }
  return ready
}
