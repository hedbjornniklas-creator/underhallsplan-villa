import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

type Mail = Parameters<typeof sendAssignmentEmail>[0]
export type StoredDecision = {
  id: string; case_id: string; decision: string; reason: string | null; conditions: string | null
  decided_at: string; delivery_status: string; email_payload: Mail | null
}

// Only called after the caller has checked the viewer's access to this case.
export async function deliverDecisionEmail(caseId: string, decisionId: string, prepare: (decision: StoredDecision) => Promise<Mail>) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('renovation_case_decisions').select('*')
    .eq('case_id', caseId).eq('id', decisionId).maybeSingle()
  if (error) throw new Error('Beslutet kunde inte läsas. Ladda om ärendet.')
  if (!data) throw new Error('DECISION_NOT_FOUND')
  const decision = data as StoredDecision
  if (decision.delivery_status === 'sent') return
  let providerMessageId: string | null = null
  let deliveryError: string | null = null
  try {
    let payload = decision.email_payload
    if (!payload) {
      const prepared = await prepare(decision)
      // A concurrent retry must use exactly the first saved payload and link.
      const saved = await admin.from('renovation_case_decisions').update({ email_payload: prepared })
        .eq('id', decisionId).is('email_payload', null)
      if (saved.error) throw saved.error
      const stored = await admin.from('renovation_case_decisions').select('email_payload,delivery_status')
        .eq('id', decisionId).single()
      if (stored.error || !stored.data?.email_payload) throw new Error('DECISION_EMAIL_PAYLOAD_MISSING')
      if (stored.data.delivery_status === 'sent') return
      payload = stored.data.email_payload as Mail
    }
    const result = await sendAssignmentEmail({ ...payload, idempotencyKey: `renoapp-decision-${decisionId}` })
    providerMessageId = result.providerMessageId
  } catch {
    // Never expose the stored mail, recipient or access token in diagnostics/UI.
    console.error('[renoapp.decision] delivery failed', { decisionId })
    deliveryError = 'Beslutet är sparat och låst, men mejlet kunde inte skickas. Försök skicka beslutsmejlet igen.'
  }
  const saved = await admin.from('renovation_case_decisions').update({
    delivery_status: deliveryError ? 'failed' : 'sent', delivery_error: deliveryError,
    provider_message_id: providerMessageId,
  }).eq('id', decisionId).neq('delivery_status', 'sent')
  if (saved.error) throw new Error('Beslutet är sparat och låst, men mejlets leveransstatus kunde inte sparas. Ladda om ärendet.')
}
