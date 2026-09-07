import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { CompletionRequest } from './completion'

export async function getLatestCompletion(caseId: string): Promise<CompletionRequest | null> {
  const { data, error } = await createSupabaseAdminClient().from('renoapp_completion_requests')
    .select('*').eq('case_id', caseId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(error.message)
  return data as CompletionRequest | null
}

export async function saveCompletion(input: {
  caseId: string; requestId: string; tokenHash: string; revision: number
  participantEntries: unknown[]; replyMessage: string | null; submit: boolean
}) {
  const { data, error } = await createSupabaseAdminClient().rpc('renoapp_save_completion', {
    p_case_id: input.caseId, p_request_id: input.requestId, p_token_hash: input.tokenHash,
    p_revision: input.revision, p_participants: input.participantEntries,
    p_reply: input.replyMessage, p_submit: input.submit,
  })
  if (error) throw new Error(error.message)
  return data as { revision: number; submitted: boolean }
}
