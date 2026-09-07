import 'server-only'
import { requireBrfAdminContext } from '@/lib/renoapp/brfAdminAccess'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export async function requireConsultantReviewAccess(caseId: string) {
  await requireBrfAdminContext()
  const { data, error } = await createSupabaseAdminClient().from('renoapp_consultant_reviews')
    .select('id,case_id,brf_id,requester_name,requester_email,message,price_ore,created_at')
    .eq('case_id', caseId).maybeSingle()
  if (error) throw new Error('REVIEW_LOOKUP_FAILED')
  if (!data) throw new Error('REVIEW_NOT_FOUND')
  return data as {
    id: string; case_id: string; brf_id: string; requester_name: string; requester_email: string
    message: string | null; price_ore: number; created_at: string
  }
}
