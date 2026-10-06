import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import { resolveObReportIdentity } from '@/lib/ob/reportIdentity'
import { parseAssignmentIssuerIdentitySnapshot } from '@/lib/assignments/issuerIdentity'
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
  assignment: { assignment_type: string; org_id: string; responsible_profile_id: string | null; scope_description?: string | null; price_amount?: number | null; assignment_details?: Record<string, unknown> | null },
  terms: AssignmentTermsDocument,
  issuedIdentity?: unknown
) {
  if (!((assignment.assignment_type === 'OB' && ['buyer', 'seller', 'apartment'].includes(terms.role)) ||
    (assignment.assignment_type === 'STATUS' && terms.role === 'status'))) {
    throw new Error('OB_CONFIRMATION_MODULE_MISMATCH')
  }
  const issued = issuedIdentity == null ? null : parseAssignmentIssuerIdentitySnapshot(issuedIdentity, { orgId: assignment.org_id })
  if (issuedIdentity != null && !issued) throw new Error('ASSIGNMENT_ISSUER_IDENTITY_INVALID')
  if (!assignment.responsible_profile_id && !issued) throw new Error('OB_CONFIRMATION_ISSUER_MISSING')
  const objectType = Object.hasOwn(assignment.assignment_details ?? {}, 'objectType')
    ? assignment.assignment_details?.objectType : 'property'
  if (assignment.assignment_type === 'STATUS' && objectType !== 'property' && objectType !== 'apartment') {
    throw new Error('STATUS_OBJECT_TYPE_INVALID')
  }
  const admin = createSupabaseAdminClient()
  if (assignment.assignment_type === 'STATUS') {
    const { error } = await admin.from('assignment_links').select('status_document_source').limit(0)
    if (error) throw new Error('STATUS_ASSIGNMENT_SOURCE_NOT_CONFIGURED')
    const { error: objectError } = await admin.from('ob_property_snapshot').select('object_type').limit(0)
    if (objectError) throw new Error('STATUS_OBJECT_TYPE_NOT_CONFIGURED')
  }
  const { error: setupError } = await admin.from('assignment_confirmation_snapshots').select('assignment_id').limit(0)
  if (setupError) throw new Error('OB_CONFIRMATION_ARCHIVE_NOT_CONFIGURED')
  // New OB links carry the issued identity. Never replace it with today's card
  // during acceptance, even if the responsible inspector has since changed.
  const profile = issued ? {
    full_name: issued.inspector.displayName, email: issued.inspector.email, phone: issued.inspector.phone,
    company_name: issued.company.name, company_orgno: issued.company.organizationNumber,
    company_address: issued.company.address, company_postal_code: issued.company.postalCode,
    company_city: issued.company.city,
  } : await resolveObReportIdentity({
    orgId: assignment.org_id, profileId: assignment.responsible_profile_id!,
    locked: false, frozenProfile: null, frozenCompany: null,
  })
  const summary = issued ? {
    sbr_group: issued.certifications.sbrGroup, sbr_status: issued.certifications.sbrStatus,
    membership_number: issued.certifications.membershipNumber, certification_number: issued.certifications.certificationNumber,
    all_selected_items: issued.certifications.items.map(item => ({
      name: item.name, number_value: item.numberValue, valid_to: item.validTo,
    })),
  } : (await resolveInspectorCertificationSummary(admin, {
    profileId: assignment.responsible_profile_id!, orgId: assignment.org_id,
  })).summary
  return {
    schemaVersion: 'ob-confirmation-v1',
    ...(assignment.assignment_type === 'STATUS' ? {
      statusScopeDescription: assignment.scope_description,
      statusPriceAmount: assignment.price_amount,
      statusObjectType: objectType,
    } : {}),
    terms,
    issuerName: profile.company_name,
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
    !['OB', 'STATUS'].includes(snapshot.assignment?.assignment_type) || !Number.isFinite(Date.parse(data.accepted_at)) ||
    Date.parse(snapshot.assignment.accepted_at ?? '') !== Date.parse(data.accepted_at) ||
    !snapshot.terms || typeof snapshot.terms.text !== 'string' ||
    !(snapshot.assignment.assignment_type === 'STATUS' ? snapshot.terms.role === 'status' && snapshot.terms.verbatim === true :
      ['buyer', 'seller', 'apartment'].includes(snapshot.terms.role)) ||
    snapshot.terms.version !== snapshot.assignment.terms_version ||
    snapshot.terms.documentHash !== snapshot.assignment.terms_document_hash ||
    createHash('sha256').update(snapshot.terms.text).digest('hex') !== snapshot.terms.documentHash ||
    !snapshot.inspector || !Array.isArray(snapshot.addonOrders) || !snapshot.acceptancePayload) {
    throw new Error('OB_CONFIRMATION_SNAPSHOT_INVALID')
  }
  return snapshot
}
