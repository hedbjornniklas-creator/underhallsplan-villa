import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export async function claimTaskEmailPdfAnalysisAttempt(input: {
  orgId: string
  userId: string
  fileSizeBytes: number
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('claim_task_email_pdf_analysis_attempt', {
    p_org_id: input.orgId,
    p_profile_id: input.userId,
    p_file_size_bytes: input.fileSizeBytes,
  })

  if (error) {
    const publicCode = error.message.match(/TASK_EMAIL_PDF_[A-Z0-9_]+/)?.[0]
    if (publicCode === 'TASK_EMAIL_PDF_RATE_LIMITED') {
      throw new Error(publicCode)
    }
    console.error('[tasks.email-pdf-analysis] Rate-limit claim failed', {
      providerCode: error.code ?? null,
    })
    throw new Error('TASK_EMAIL_PDF_RATE_LIMIT_CHECK_FAILED')
  }
  if (typeof data !== 'string' || !data) {
    throw new Error('TASK_EMAIL_PDF_RATE_LIMIT_CHECK_FAILED')
  }
}

