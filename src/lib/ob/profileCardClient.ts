import { supabase } from '@/lib/supabaseClient'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import type { OrganizationProfileWorkspace } from '@/lib/organizations/profileCardTypes'

export async function loadObOrganizationInspectorProfile(orgId: string, signal?: AbortSignal) {
  const response = await fetch(`/api/ob/profile-card?${new URLSearchParams({ orgId })}`, { cache: 'no-store', signal })
  const body = await response.json()
  const workspace = body.workspace as OrganizationProfileWorkspace | undefined
  if (!response.ok || workspace?.organization.id !== orgId || !workspace.card || !workspace.profileId) {
    throw new Error(body.error || 'Profilen för arbetsorganisationen kunde inte hämtas.')
  }
  const card = workspace.card
  const { summary } = await resolveInspectorCertificationSummary(supabase, { profileId: workspace.profileId, orgId })
  signal?.throwIfAborted()
  return {
    full_name: card.displayName,
    phone: card.phone,
    email: card.email,
    company_name: card.companyName,
    company_orgno: card.companyOrgNo,
    company_address: card.companyAddress,
    company_postal_code: card.companyPostalCode,
    company_city: card.companyCity,
    avatar_path: card.avatarPath,
    sbr_group: summary.sbr_group,
    sbr_status: summary.sbr_status,
    membership_number: summary.membership_number,
    certification_number: summary.certification_number,
    certification_items: summary.all_selected_items,
  }
}
