import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import type { AssignmentDetails } from '@/lib/assignments/server'
import type { AssignmentTermsDocument } from '@/lib/assignments/terms'
import type { AcceptedAssignmentConfirmationPdfInput } from '@/lib/assignments/acceptedConfirmationPdf'

export type ObConfirmationSnapshot = Omit<AcceptedAssignmentConfirmationPdfInput, 'assignment' | 'terms'> & {
  assignment: AssignmentDetails
  terms: AssignmentTermsDocument
}

// Called before consuming the token. The database captures assignment/addons
// after its own updates, atomically with the acceptance and this source text.
export async function prepareObConfirmationSource(
  assignment: { assignment_type: string; org_id: string; responsible_profile_id: string | null },
  terms: AssignmentTermsDocument
) {
  if (assignment.assignment_type !== 'OB' || !['buyer', 'seller', 'apartment'].includes(terms.role)) {
    throw new Error('OB_CONFIRMATION_MODULE_MISMATCH')
  }
  if (!assignment.responsible_profile_id) throw new Error('OB_CONFIRMATION_ISSUER_MISSING')
  const admin = createSupabaseAdminClient()
  const { error: setupError } = await admin.from('assignment_confirmation_snapshots').select('assignment_id').limit(0)
  if (setupError) throw new Error('OB_CONFIRMATION_ARCHIVE_NOT_CONFIGURED')
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('full_name,email,phone,company_name,company_orgno,company_address,company_postal_code,company_city')
    .eq('id', assignment.responsible_profile_id).maybeSingle()
  const { data: organization, error: orgError } = await admin.from('organizations')
    .select('name').eq('id', assignment.org_id).maybeSingle()
  if (profileError || orgError || !profile || !organization) throw new Error('OB_CONFIRMATION_ISSUER_MISSING')
  const { summary } = await resolveInspectorCertificationSummary(admin, {
    profileId: assignment.responsible_profile_id, orgId: assignment.org_id,
  })
  return {
    schemaVersion: 'ob-confirmation-v1',
    terms,
    issuerName: organization.name ?? profile.company_name,
    inspector: {
      fullName: profile.full_name, email: profile.email, phone: profile.phone,
      companyName: profile.company_name, companyOrgNo: profile.company_orgno,
      companyAddress: profile.company_address, companyPostalCode: profile.company_postal_code,
      companyCity: profile.company_city, sbrGroup: summary.sbr_group, sbrStatus: summary.sbr_status,
      membershipNumber: summary.membership_number, certificationNumber: summary.certification_number,
      certifications: summary.all_selected_items.map(item => ({
        name: item.name, number: item.number_value, validTo: item.valid_to,
      })),
    },
  }
}

export async function getObConfirmationSnapshot(orgId: string, assignmentId: string): Promise<ObConfirmationSnapshot | null> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('assignment_confirmation_snapshots')
    .select('schema_version,snapshot_payload,accepted_at').eq('org_id', orgId).eq('assignment_id', assignmentId).maybeSingle()
  // Old installations and old acceptances do not have this new archive.
  if (error && (error.code === '42P01' || error.code === 'PGRST205')) return null
  if (error) throw new Error('OB_CONFIRMATION_SNAPSHOT_READ_FAILED')
  if (!data) return null
  const snapshot = data.snapshot_payload as ObConfirmationSnapshot | null
  if (data.schema_version !== 'ob-confirmation-v1' || !snapshot ||
    snapshot.assignment?.id !== assignmentId || snapshot.assignment?.org_id !== orgId ||
    snapshot.assignment?.assignment_type !== 'OB' || !Number.isFinite(Date.parse(data.accepted_at)) ||
    Date.parse(snapshot.assignment.accepted_at ?? '') !== Date.parse(data.accepted_at) ||
    !snapshot.terms || typeof snapshot.terms.text !== 'string' ||
    !['buyer', 'seller', 'apartment'].includes(snapshot.terms.role) ||
    snapshot.terms.version !== snapshot.assignment.terms_version ||
    snapshot.terms.documentHash !== snapshot.assignment.terms_document_hash ||
    createHash('sha256').update(snapshot.terms.text).digest('hex') !== snapshot.terms.documentHash ||
    !snapshot.inspector || !Array.isArray(snapshot.addonOrders) || !snapshot.acceptancePayload) {
    throw new Error('OB_CONFIRMATION_SNAPSHOT_INVALID')
  }
  return snapshot
}
