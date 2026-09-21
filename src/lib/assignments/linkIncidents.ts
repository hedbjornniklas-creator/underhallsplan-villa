import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

export type LinkOperation = 'open' | 'accept'
export type AssignmentLinkIssue = {
  id: string
  assignment_id: string
  operation: LinkOperation
  last_failed_at: string
  last_reference: string
  occurrences: number
  notification_state: 'pending' | 'sent' | 'failed' | 'suppressed'
}
export type AssignmentLinkIssues = { available: boolean; items: AssignmentLinkIssue[] }

export function publicLinkErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null
  return typeof code === 'string' && /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'PUBLIC_LINK_FAILURE'
}

export async function recordPublicLinkFailure(input: {
  token: string; operation: LinkOperation; reference: string; code: string
}): Promise<void> {
  try {
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin.rpc('record_assignment_link_incident', {
      p_token_hash: hashAssignmentToken(input.token), p_operation: input.operation,
      p_reference: input.reference, p_error_code: input.code,
    })
    if (error) throw error
    const incident = data as { id: string; orgId: string; assignmentId: string; responsibleProfileId: string; assignmentType: string; notify: boolean } | null
    if (!incident) return
    console.error('[assignments.link] incident recorded', {
      reference: input.reference, incidentId: incident.id, operation: input.operation,
      assignmentId: incident.assignmentId, code: input.code,
    })
    if (!incident.notify) return
    try {
      // Notify only the responsible, currently active member of this organization.
      const member = await admin.from('org_members').select('profile_id')
        .eq('org_id', incident.orgId).eq('profile_id', incident.responsibleProfileId).eq('is_active', true).maybeSingle()
      if (member.error || !member.data) throw new Error('RECIPIENT_UNAVAILABLE')
      const profile = await admin.from('profiles').select('email').eq('id', incident.responsibleProfileId).maybeSingle()
      if (profile.error || !profile.data?.email) throw new Error('RECIPIENT_UNAVAILABLE')
      const from = process.env.ASSIGNMENTS_MAIL_FROM
      if (!from) throw new Error('SENDER_UNAVAILABLE')
      const path = `/${incident.assignmentType === 'TU' ? 'tu' : 'ob'}/assignments/${incident.assignmentId}`
      const url = new URL(path, process.env.APP_BASE_URL || 'https://hushub.se').toString()
      const text = `Ett tekniskt fel inträffade när en uppdragsbekräftelse skulle ${input.operation === 'open' ? 'öppnas' : 'godkännas'}.\n\nKontrollera uppdraget: ${url}\nFelreferens: ${incident.id}\n\nDetta är inte ett besked om mejlleverans eller ett registrerat godkännande.`
      await sendAssignmentEmail({ to: profile.data.email, from,
        subject: 'Tekniskt fel i en uppdragsbekräftelse', text,
        html: `<p>${text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>')}</p>`,
        idempotencyKey: `assignment-link-incident-${incident.id}`,
      })
      const saved = await admin.from('assignment_link_incidents').update({
        notification_state: 'sent', notification_sent_at: new Date().toISOString(),
      }).eq('id', incident.id).eq('org_id', incident.orgId)
      if (saved.error) throw saved.error
    } catch (error) {
      console.error('[assignments.link] notification failed', { incidentId: incident.id, code: publicLinkErrorCode(error) })
      await admin.from('assignment_link_incidents').update({ notification_state: 'failed' })
        .eq('id', incident.id).eq('org_id', incident.orgId)
    }
  } catch (error) {
    // The reference remains in server logs even when the database is unavailable.
    console.error('[assignments.link] incident storage unavailable', { reference: input.reference, code: publicLinkErrorCode(error) })
  }
}

export async function resolvePublicLinkFailures(token: string, operation: LinkOperation, startedAt: string) {
  try {
    const { error } = await createSupabaseAdminClient().rpc('resolve_assignment_link_incidents', {
      p_token_hash: hashAssignmentToken(token), p_operation: operation, p_started_at: startedAt,
    })
    if (error) throw error
  } catch (error) {
    console.error('[assignments.link] incident resolution unavailable', { operation, code: publicLinkErrorCode(error) })
  }
}

// Call only after the assignment IDs have been authorized by the server route.
export async function listAssignmentLinkIssues(orgId: string, assignmentIds: string[]): Promise<AssignmentLinkIssues> {
  if (assignmentIds.length === 0) return { available: true, items: [] }
  try {
    const { data, error } = await createSupabaseAdminClient().from('assignment_link_incidents')
      .select('id,assignment_id,operation,last_failed_at,last_reference,occurrences,notification_state')
      .eq('org_id', orgId).in('assignment_id', assignmentIds).is('resolved_at', null)
      .order('last_failed_at', { ascending: false })
    if (error) throw error
    return { available: true, items: (data ?? []) as AssignmentLinkIssue[] }
  } catch (error) {
    console.error('[assignments.link] incident list unavailable', { code: publicLinkErrorCode(error) })
    return { available: false, items: [] }
  }
}
