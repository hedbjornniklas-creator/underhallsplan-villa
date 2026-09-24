import { NextResponse } from 'next/server'
import { getAssignmentById, requireOrgContext } from '@/lib/assignments/server'
import { getAcceptedObTerms } from '@/lib/assignments/acceptedObTerms'
import { getObConfirmationSnapshot } from '@/lib/assignments/obConfirmationSnapshot'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    const assignment = await getAssignmentById(org.orgId, id)
    if (!assignment || assignment.assignment_type !== 'OB') {
      return json({ error: 'Uppdraget hittades inte.' }, 404)
    }
    const snapshot = await getObConfirmationSnapshot(org.orgId, id)
    if (snapshot) {
      const { data: messages, error } = await createSupabaseAdminClient().from('outbound_messages')
        .select('status,error_message,created_at').eq('org_id', org.orgId).eq('assignment_id', id)
        .eq('template_key', 'assignment_accept_notice').order('created_at', { ascending: false }).limit(1)
      const latest = messages?.[0]
      const pendingExpired = latest?.status === 'pending' && Date.now() - Date.parse(latest.created_at) > 5 * 60_000
      return json({
        available: true, acceptedAt: snapshot.assignment.accepted_at, document: snapshot.terms,
        confirmationDelivery: error || latest?.error_message === 'OB_CONFIRMATION_SENT_LOG_FAILED' ? 'unknown' : latest?.status ?? 'not_sent',
        canRetryDelivery: process.env.OB_ASSIGNMENT_PDF_ARCHIVE_ENABLED === 'true' && (latest?.status !== 'pending' || pendingExpired),
      })
    }
    return json(getAcceptedObTerms(assignment))
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') return json({ error: 'Logga in för att läsa villkoren.' }, 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') {
      return json({ error: 'Ingen organisationskoppling hittades.' }, 403)
    }
    return json({ error: 'Villkoren kunde inte hämtas. Försök igen.' }, 500)
  }
}
