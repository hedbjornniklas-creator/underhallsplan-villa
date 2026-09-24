import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getObConfirmationSnapshot } from '@/lib/assignments/obConfirmationSnapshot'
import { getArchivedAssignmentPdf, archiveAcceptedAssignmentPdf } from '@/lib/assignments/acceptedPdfArchive'
import { renderAcceptedAssignmentConfirmationPdf, buildAcceptedAssignmentConfirmationFilename } from '@/lib/assignments/acceptedConfirmationPdf'
import { buildAssignmentAcceptedNoticeEmail } from '@/lib/assignments/emailTemplates'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

export async function sendFrozenObConfirmation(input: {
  orgId: string; assignmentId: string; requestedByUserId: string | null; fromAddress: string
}) {
  const snapshot = await getObConfirmationSnapshot(input.orgId, input.assignmentId)
  // Never create a historical original from today's assignment or terms.
  if (!snapshot) throw new Error('OB_CONFIRMATION_SNAPSHOT_MISSING')
  const acceptedAt = snapshot.assignment.accepted_at!
  const admin = createSupabaseAdminClient()
  const mail = buildAssignmentAcceptedNoticeEmail({
    assignment: snapshot.assignment, orgName: snapshot.issuerName, acceptedAt,
  })
  const replyTo = snapshot.inspector?.email ?? null
  const { data: message, error } = await admin.from('outbound_messages').insert({
    org_id: input.orgId, assignment_id: input.assignmentId, channel: 'email',
    recipient_email: snapshot.assignment.customer_email, subject: mail.subject,
    template_key: 'assignment_accept_notice', status: 'pending',
    created_by: input.requestedByUserId, reply_to_email: replyTo,
  }).select('id').single()
  if (error || !message) throw new Error('OB_CONFIRMATION_MAIL_LOG_FAILED')
  try {
    let original = await getArchivedAssignmentPdf(input.orgId, input.assignmentId)
    if (original && Date.parse(original.acceptedAt) !== Date.parse(acceptedAt)) {
      throw new Error('ASSIGNMENT_PDF_ACCEPTANCE_MISMATCH')
    }
    if (!original) {
      const pdf = await renderAcceptedAssignmentConfirmationPdf(snapshot)
      original = await archiveAcceptedAssignmentPdf({
        orgId: input.orgId, assignmentId: input.assignmentId, acceptedAt, pdf,
        filename: buildAcceptedAssignmentConfirmationFilename({
          assignmentType: 'OB', assignmentId: input.assignmentId, acceptedAt,
        }),
      })
    }
    const sent = await sendAssignmentEmail({
      ...mail, to: snapshot.assignment.customer_email, from: input.fromAddress, replyTo,
      attachments: [{ filename: original.filename, contentBase64: original.pdf.toString('base64'), contentType: 'application/pdf' }],
    })
    const { error: logError } = await admin.from('outbound_messages').update({
      status: 'sent', provider: sent.provider, provider_message_id: sent.providerMessageId,
      sent_at: new Date().toISOString(),
    }).eq('id', message.id)
    if (logError) throw new Error('OB_CONFIRMATION_SENT_LOG_FAILED')
  } catch (failure) {
    await admin.from('outbound_messages').update({
      status: 'failed', error_message: failure instanceof Error ? failure.message : 'OB_CONFIRMATION_DELIVERY_FAILED',
    }).eq('id', message.id)
    throw failure
  }
}
