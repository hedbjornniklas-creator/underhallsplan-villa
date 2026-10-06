import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getObConfirmationSnapshot } from '@/lib/assignments/obConfirmationSnapshot'
import { parseAssignmentIssuerIdentitySnapshot } from '@/lib/assignments/issuerIdentity'
import { requireStatusIssueSource } from '@/lib/assignments/statusIssueSource'
import { resolveObReportIdentity } from '@/lib/ob/reportIdentity'

/** Identity for a NEW receipt/notification; this never renders or rewrites an original. */
export async function resolveObCorrespondenceIdentity(assignment: {
  id: string; org_id: string; assignment_type: string; responsible_profile_id: string; accepted_at: string | null
}) {
  if (!['OB', 'STATUS'].includes(assignment.assignment_type)) throw new Error('OB_CONFIRMATION_MODULE_MISMATCH')
  if (assignment.accepted_at) {
    const accepted = await getObConfirmationSnapshot(assignment.org_id, assignment.id)
    if (accepted) return { orgName: accepted.issuerName, replyTo: accepted.inspector?.email ?? null }
  }
  let query = createSupabaseAdminClient().from('assignment_links')
    .select('issuer_identity_snapshot,status_document_source,terms_version')
    .eq('org_id', assignment.org_id).eq('assignment_id', assignment.id)
  if (assignment.accepted_at) query = query.not('used_at', 'is', null)
  const { data: link, error } = await query.order(assignment.accepted_at ? 'used_at' : 'created_at', { ascending: false })
    .limit(1).maybeSingle()
  if (error) throw new Error('OB_CONFIRMATION_SNAPSHOT_READ_FAILED')
  if (assignment.assignment_type === 'STATUS' && link?.status_document_source != null) {
    const source = requireStatusIssueSource(link.status_document_source, link.terms_version)
    return { orgName: source.issuerName, replyTo: source.inspector.email }
  }
  if (link?.issuer_identity_snapshot != null) {
    const issued = parseAssignmentIssuerIdentitySnapshot(link.issuer_identity_snapshot, { orgId: assignment.org_id })
    if (!issued) throw new Error('ASSIGNMENT_ISSUER_IDENTITY_INVALID')
    return { orgName: issued.company.name, replyTo: issued.replyToEmail }
  }
  // Older links lack an issued identity. Only this new communication may use
  // today's configured card, and only in the assignment's exact organization.
  const current = await resolveObReportIdentity({
    orgId: assignment.org_id, profileId: assignment.responsible_profile_id,
    locked: false, frozenProfile: null, frozenCompany: null,
  })
  return { orgName: current.company_name, replyTo: current.email }
}
