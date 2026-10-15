import { NextResponse } from 'next/server'
import { getTuAssignmentById, listTuReportTemplateOptions, requireTuContext } from '@/lib/tu/server'
import { updateAssignmentById } from '@/lib/assignments/server'
import { resolveAssignmentCustomerType } from '@/lib/assignments/consumer'
import { getAssignmentTermsDocument } from '@/lib/assignments/terms'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { loadTuAssignmentMessages, loadTuAssignmentProgress } from '@/lib/tu/assignmentProgressServer'
import { listAssignmentLinkIssues } from '@/lib/assignments/linkIncidents'
import { assertAssignmentCustomerSameOrigin } from '@/lib/assignment-customers/http'
import { canEditTuAssignmentDetails } from '@/lib/tu/assignmentProgress'
import { parseTuAssignmentEdit } from '@/lib/tu/assignmentEditing'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function mapAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_SELECTION_INVALID') return jsonError('Den valda organisationen är ogiltig.', 400)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_ASSIGNMENT_NOT_FOUND') return jsonError('TU-uppdraget hittades inte.', 404)
  return null
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const searchParams = new URL(request.url).searchParams
    if (
      [...searchParams.keys()].some((key) => key !== 'orgId') ||
      searchParams.getAll('orgId').length !== 1
    ) {
      return jsonError('Välj arbetsorganisation innan uppdraget hämtas.', 400)
    }
    const orgContext = await requireTuContext(searchParams.get('orgId'))
    const assignment = await getTuAssignmentById(orgContext.orgId, id)
    if (!assignment) return jsonError('TU-uppdraget hittades inte.', 404)
    const currentTerms = getAssignmentTermsDocument('technical')
    const admin = createSupabaseAdminClient()
    const { data: withdrawalData, error: withdrawalError } = await admin
      .from('assignment_withdrawal_requests')
      .select('requested_at,receipt_email,receipt_sent_at,status,resolved_at,resolution_note')
      .eq('org_id', orgContext.orgId)
      .eq('assignment_id', assignment.id)
      .maybeSingle()

    if (withdrawalError && withdrawalError.code !== '42P01') {
      console.error('[tu.assignments.detail] failed to load withdrawal request', {
        assignmentId: assignment.id,
        error: withdrawalError.message,
      })
    }

    const progress = (await loadTuAssignmentProgress(orgContext.orgId, [assignment])).get(assignment.id)
    const messages = await loadTuAssignmentMessages(orgContext.orgId, assignment.id)
    const linkIssues = await listAssignmentLinkIssues(orgContext.orgId, [assignment.id])
    const reportTemplates = await listTuReportTemplateOptions()
    return NextResponse.json({
      assignment: { ...assignment, progress },
      messages,
      linkIssues,
      reportTemplates,
      customerType: resolveAssignmentCustomerType('TU', assignment.assignment_details),
      currentTerms: {
        version: currentTerms.version,
        documentHash: currentTerms.documentHash,
        text: currentTerms.text,
        matchesAcceptedVersion:
          !assignment.accepted_at
            ? true
            : Boolean(
                assignment.terms_version &&
                  assignment.terms_version === currentTerms.version &&
                  assignment.terms_document_hash === currentTerms.documentHash
              ),
      },
      withdrawal: withdrawalData
        ? {
            requestedAt: withdrawalData.requested_at,
            receiptEmail: withdrawalData.receipt_email,
            receiptSentAt: withdrawalData.receipt_sent_at,
            status: withdrawalData.status,
            resolvedAt: withdrawalData.resolved_at,
            resolutionNote: withdrawalData.resolution_note,
          }
        : null,
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte hämta TU-uppdrag.', 500)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertAssignmentCustomerSameOrigin(request)
    const search = new URL(request.url).searchParams
    if (search.getAll('orgId').length !== 1 || [...search.keys()].some(key => key !== 'orgId')) return jsonError('Välj arbetsorganisation.', 400)
    const org = await requireTuContext(search.get('orgId'))
    const existing = await getTuAssignmentById(org.orgId, (await context.params).id)
    if (!existing) return jsonError('TU-uppdraget hittades inte.', 404)
    if (!canEditTuAssignmentDetails(existing)) return jsonError('Skapa en ny version för att ändra ett skickat eller godkänt uppdrag. Datum och tid ändras separat före godkännande.', 409)
    let edit: ReturnType<typeof parseTuAssignmentEdit>
    try { edit = parseTuAssignmentEdit(await request.json().catch(() => null)) }
    catch (error) { return jsonError(error instanceof Error ? error.message : 'Kontrollera uppgifterna.', 400) }
    const assignment = await updateAssignmentById({
      orgId: org.orgId, assignmentId: existing.id, updatedBy: org.userId,
      expectedUpdatedAt: edit.expectedUpdatedAt, requireUnissuedDraft: true,
      patch: edit.patch as Parameters<typeof updateAssignmentById>[0]['patch'],
    })
    return NextResponse.json({ assignment }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    const access = mapAccessError(error)
    if (access) return access
    const code = error instanceof Error ? error.message : ''
    if (code === 'ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN') return jsonError('Otillåten begäran.', 403)
    if (code === 'ASSIGNMENT_VERSION_CONFLICT' || code === 'OB_ASSIGNMENT_CONTENT_LOCKED') return jsonError('Uppdraget har ändrats. Hämta aktuell version innan du sparar igen.', 409)
    console.error('[tu.assignments.edit] failed', error)
    return jsonError('Kunde inte spara uppgifterna. Dina ändringar finns kvar här.', 500)
  }
}
