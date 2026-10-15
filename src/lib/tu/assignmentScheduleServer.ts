import 'server-only'
import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTuAssignmentById, requireTuOrganizationProfileCard } from '@/lib/tu/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import {
  canEditTuSchedule, formatTuSchedule, tuScheduleValues, validTuSchedule,
  type TuAssignmentSchedule, type TuScheduleValues,
} from '@/lib/tu/assignmentSchedule'

type Context = { orgId: string; assignmentId: string; userId: string; expectedUpdatedAt: string }
const SCHEDULE_SELECT = 'id,org_id,status,accepted_at,archived_at,updated_at,preferred_date,preferred_time,customer_email'

async function currentAssignment(input: Context) {
  const assignment = await getTuAssignmentById(input.orgId, input.assignmentId)
  if (!assignment) throw new Error('TU_SCHEDULE_NOT_FOUND')
  if (!canEditTuSchedule(assignment)) throw new Error('TU_SCHEDULE_LOCKED')
  if (assignment.updated_at !== input.expectedUpdatedAt) throw new Error('TU_SCHEDULE_CONFLICT')
  return assignment
}

export async function updateTuAssignmentSchedule(input: Context & TuScheduleValues): Promise<TuAssignmentSchedule> {
  if (!validTuSchedule(input)) throw new Error('TU_SCHEDULE_INVALID')
  const assignment = await currentAssignment(input)
  if (assignment.preferred_date === input.preferredDate &&
    (assignment.preferred_time?.slice(0, 5) ?? '') === input.preferredTime) return assignment
  const admin = createSupabaseAdminClient()
  // Approval or another editor can race the initial read. Guard the write itself.
  const { data, error } = await admin.from('assignments').update({
    preferred_date: input.preferredDate,
    preferred_time: input.preferredTime || null,
    updated_by: input.userId,
  }).eq('id', input.assignmentId).eq('org_id', input.orgId).eq('assignment_type', 'TU')
    .eq('updated_at', input.expectedUpdatedAt).in('status', ['draft', 'sent'])
    .is('accepted_at', null).is('archived_at', null).select(SCHEDULE_SELECT).maybeSingle()
  if (error) throw new Error('TU_SCHEDULE_SAVE_FAILED', { cause: error })
  if (!data) throw new Error('TU_SCHEDULE_CONFLICT')
  return data as TuAssignmentSchedule
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]!)

export function buildTuScheduleNotice(input: { customerName: string | null; address: string | null; companyName: string; values: TuScheduleValues }) {
  const when = formatTuSchedule(input.values)
  const subject = `Ändrad tid för teknisk utredning${input.address ? ` – ${input.address}` : ''}`
  const paragraphs = [
    `Hej ${input.customerName?.trim() || 'kund'},`,
    `Datum och tid för din tekniska utredning${input.address ? ` på ${input.address}` : ''} har uppdaterats.`,
    `Ny tid: ${when}.`,
    'Övriga uppgifter i uppdragsbekräftelsen är oförändrade. Detta mejl är en tidsändring, inte en ny uppdragsbekräftelse.',
    'Kontakta oss om tiden inte stämmer med vad vi har kommit överens om.',
    input.companyName,
  ]
  return { subject, text: paragraphs.join('\n\n'), html: `<html lang="sv"><body style="font-family:Arial,sans-serif;color:#17202a;line-height:1.6"><h1 style="font-size:22px">Ändrad tid</h1>${paragraphs.map(text => `<p>${escapeHtml(text)}</p>`).join('')}</body></html>` }
}

export async function notifyTuAssignmentSchedule(input: Context) {
  const assignment = await currentAssignment(input)
  if (assignment.status !== 'sent') throw new Error('TU_SCHEDULE_NOT_SENT')
  const values = tuScheduleValues(assignment)
  if (!validTuSchedule(values)) throw new Error('TU_SCHEDULE_INVALID')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(assignment.customer_email)) throw new Error('TU_SCHEDULE_EMAIL_REQUIRED')
  const profile = await requireTuOrganizationProfileCard({ orgId: input.orgId, profileId: assignment.responsible_profile_id })
  const from = process.env.ASSIGNMENTS_MAIL_FROM
  if (!from) throw new Error('TU_SCHEDULE_MAIL_CONFIG')
  const message = buildTuScheduleNotice({
    customerName: assignment.customer_name, address: assignment.property_address ?? assignment.preliminary_address,
    companyName: profile.companyName, values,
  })
  const admin = createSupabaseAdminClient()
  const { data: log, error } = await admin.from('outbound_messages').insert({
    org_id: input.orgId, assignment_id: input.assignmentId, channel: 'email',
    recipient_email: assignment.customer_email, subject: message.subject,
    template_key: 'tu_assignment_schedule_notice', status: 'pending', created_by: input.userId,
    reply_to_email: profile.email,
  }).select('id').single()
  if (error || !log) throw new Error('TU_SCHEDULE_MAIL_LOG_FAILED', { cause: error })
  try {
    const version = createHash('sha256').update(`${input.expectedUpdatedAt}:${assignment.customer_email}`).digest('hex')
    const result = await sendAssignmentEmail({
      ...message, to: assignment.customer_email, from, replyTo: profile.email,
      idempotencyKey: `tu-schedule-${input.assignmentId}-${version}`,
    })
    const { error: logError } = await admin.from('outbound_messages').update({
      status: 'sent', provider: result.provider, provider_message_id: result.providerMessageId, sent_at: new Date().toISOString(),
    }).eq('id', log.id).eq('org_id', input.orgId)
    // A delivered email must not be reported as failed just because receipt logging failed.
    if (logError) console.error('[tu.schedule] receipt logging failed', { assignmentId: input.assignmentId, logError })
    return { recipient: assignment.customer_email, updatedAt: assignment.updated_at }
  } catch (sendError) {
    await admin.from('outbound_messages').update({ status: 'failed', error_message: sendError instanceof Error ? sendError.message : 'Unknown mail error' })
      .eq('id', log.id).eq('org_id', input.orgId)
    throw sendError
  }
}
