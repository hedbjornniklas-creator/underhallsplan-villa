import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import { requireConfiguredOrganizationProfileCard } from '@/lib/organizations/profileCard'
import { resolveObReportIdentity } from '@/lib/ob/reportIdentity'

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** The caller must first authorize the inspection's organization binding. */
export async function loadObAppendixProfile(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string,
  orgId: string,
  userId: string
) {
  const { data: inspection, error } = await admin.from('inspections')
    .select('id,locked_at').eq('id', inspectionId).maybeSingle()
  if (error || !inspection || inspection.id !== inspectionId) throw new Error('OB_ORGANIZATION_READ_FAILED')
  const locked = Boolean(inspection.locked_at)
  let frozenProfile: Record<string, unknown> | null = null
  let frozenCompany: Record<string, unknown> | null = null
  if (locked) {
    const { data: links, error: linksError } = await admin.from('inspection_report_links')
      .select('snapshot_payload').eq('inspection_id', inspectionId).eq('org_id', orgId)
      .is('revoked_at', null).order('created_at', { ascending: false }).limit(10)
    if (linksError || !Array.isArray(links)) throw new Error('OB_ORGANIZATION_READ_FAILED')
    for (const link of links) {
      const mock = record(record(record(link.snapshot_payload)?.reportData)?.mock)
      const profile = record(mock?.profile)
      if (profile) {
        frozenProfile = profile
        frozenCompany = record(mock?.company)
        break
      }
    }
  }
  const identity = await resolveObReportIdentity({
    orgId, profileId: userId, locked, frozenProfile, frozenCompany,
  })
  if (locked) {
    const text = (key: string) => typeof frozenProfile?.[key] === 'string' ? frozenProfile[key] as string : null
    return {
      ...identity, avatar_path: text('avatar_path'), sbr_group: text('sbr_group'),
      membership_number: text('membership_number'), sbr_status: text('sbr_status'),
      certification_number: text('certification_number'),
      is_sbr_diplomerad_areamatning: frozenProfile?.is_sbr_diplomerad_areamatning === true,
      certification_items: Array.isArray(frozenProfile?.certification_items) ? frozenProfile.certification_items : [],
    }
  }
  const [{ summary }, card] = await Promise.all([
    resolveInspectorCertificationSummary(admin, { profileId: userId, orgId }),
    requireConfiguredOrganizationProfileCard({ orgId, profileId: userId }),
  ])
  return {
    ...identity, avatar_path: card.avatarPath, sbr_group: summary.sbr_group,
    membership_number: summary.membership_number, sbr_status: summary.sbr_status,
    certification_number: summary.certification_number,
    is_sbr_diplomerad_areamatning: summary.is_sbr_diplomerad_areamatning,
    certification_items: summary.all_selected_items,
  }
}
