import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTuAssignmentById, requireTuOrganizationProfileCard, sendTuAssignmentConfirmation } from '@/lib/tu/server'
import { createReissuedAssignmentDraft, sendAssignmentAcceptedNotice, sendAssignmentOrderReceipt, updateAssignmentById } from '@/lib/assignments/server'
import { getAssignmentTermsDocument } from '@/lib/assignments/terms'
import { canTuAssignmentAction, type TuAssignmentAction } from './assignmentProgress'
import { loadTuAssignmentProgress } from './assignmentProgressServer'
import { tuWorkflowRpc } from './assignmentWorkflowServer'

export async function runTuAssignmentAction(input: {
  orgId: string; userId: string; assignmentId: string; expectedUpdatedAt: string; action: TuAssignmentAction
}) {
  const assignment = await getTuAssignmentById(input.orgId, input.assignmentId)
  if (!assignment) throw new Error('TU_ASSIGNMENT_NOT_FOUND')
  if (assignment.updated_at !== input.expectedUpdatedAt) throw new Error('ASSIGNMENT_VERSION_CONFLICT')
  const progress = (await loadTuAssignmentProgress(input.orgId, [assignment])).get(assignment.id)
  if (!canTuAssignmentAction({ ...assignment, progress }, input.action)) throw new Error('TU_ACTION_NOT_ALLOWED')
  const shared = { orgId: input.orgId, assignmentId: input.assignmentId, updatedBy: input.userId, expectedUpdatedAt: input.expectedUpdatedAt }
  if (input.action === 'send') {
    if (!assignment.customer_email || !assignment.scope_description?.trim() || assignment.price_amount === null) throw new Error('TU_SEND_INCOMPLETE')
    await sendTuAssignmentConfirmation({ assignment, orgName: null, requestedByUserId: input.userId })
    return { message: 'Uppdragsbekräftelsen har skickats.' }
  }
  if (input.action === 'reissue') {
    if (assignment.inspection_id && progress?.earlyStarted) {
      const draftId = await tuWorkflowRpc<string>('tu_reissue_started_assignment', {
        p_assignment_id: assignment.id, p_org_id: input.orgId, p_actor: input.userId, p_expected_updated_at: input.expectedUpdatedAt,
      })
      return { message: 'Ett nytt utkast har skapats. Utredningen är kvar och pausas tills bekräftelsen har skickats.', draftId }
    }
    const { draft } = await createReissuedAssignmentDraft({
      orgId: input.orgId, sourceAssignmentId: assignment.id, createdBy: input.userId, expectedUpdatedAt: input.expectedUpdatedAt,
    })
    return { message: 'Ett nytt utkast har skapats. Inget mejl har skickats.', draftId: draft.id }
  }
  if (input.action === 'book' || input.action === 'receipt' || input.action === 'bookingReceipt') {
    const profile = await requireTuOrganizationProfileCard({ orgId: input.orgId, profileId: assignment.responsible_profile_id })
    const terms = getAssignmentTermsDocument('technical')
    const termsMatch = assignment.terms_version === terms.version && assignment.terms_document_hash === terms.documentHash
    if (input.action === 'bookingReceipt') {
      if (!termsMatch) throw new Error('TU_ACCEPTED_COPY_UNAVAILABLE')
      await sendAssignmentOrderReceipt({ assignment, orgName: profile.companyName, requestedByUserId: input.userId, responsibleEmail: profile.email })
      return { message: 'Bekräftelsen på accepterat uppdrag har skickats igen.' }
    }
    if (input.action === 'receipt') {
      if (!termsMatch) throw new Error('TU_ACCEPTED_COPY_UNAVAILABLE')
      const admin = createSupabaseAdminClient()
      const acceptance = await admin.from('assignment_acceptances').select('payload,assignment_link_id')
        .eq('org_id', input.orgId).eq('assignment_id', assignment.id).eq('accepted_at', assignment.accepted_at!).maybeSingle()
      if (acceptance.error || !acceptance.data?.assignment_link_id) throw new Error('TU_ACCEPTED_COPY_UNAVAILABLE')
      const link = await admin.from('assignment_links').select('issuer_identity_snapshot')
        .eq('org_id', input.orgId).eq('assignment_id', assignment.id).eq('id', acceptance.data.assignment_link_id).maybeSingle()
      if (link.error || !link.data?.issuer_identity_snapshot) throw new Error('TU_ACCEPTED_COPY_UNAVAILABLE')
      await sendAssignmentAcceptedNotice({ assignment, orgName: profile.companyName, requestedByUserId: input.userId,
        responsibleEmail: profile.email, acceptancePayload: acceptance.data.payload, issuerIdentitySnapshot: link.data.issuer_identity_snapshot })
      return { message: 'Bekräftelsen på kundens godkännande har skickats.' }
    }
    const booked = await updateAssignmentById({ ...shared, patch: { status: 'booked' } })
    try {
      if (!termsMatch) throw new Error('TU_ACCEPTED_COPY_UNAVAILABLE')
      await sendAssignmentOrderReceipt({ assignment: booked, orgName: profile.companyName, requestedByUserId: input.userId, responsibleEmail: profile.email })
      return { message: 'Uppdraget är accepterat och kunden har meddelats.' }
    } catch (error) {
      console.error('[tu.assignments] accepted, receipt failed', { assignmentId: assignment.id, error })
      return { message: 'Uppdraget är accepterat, men kundmeddelandet kunde inte skickas.', warning: true }
    }
  }
  const patch = input.action === 'restore' ? { archived_at: null, archived_by: null }
    : input.action === 'cancel' ? { status: 'cancelled' as const, archived_at: new Date().toISOString(), archived_by: input.userId }
      : { archived_at: new Date().toISOString(), archived_by: input.userId }
  await updateAssignmentById({ ...shared, patch })
  return { message: input.action === 'restore' ? 'Uppdraget har återförts från arkivet. Tidigare avbokning ändras inte.'
    : input.action === 'cancel' ? 'Uppdraget är avbokat och arkiverat. Inget kundmejl har skickats.' : 'Uppdraget är arkiverat.' }
}
