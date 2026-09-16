import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Clarification } from './clarifications'

// Callers must authorize the case before reading these internal board assessments.
export async function getCaseClarifications(caseId: string): Promise<Clarification[]> {
  const { data, error } = await createSupabaseAdminClient().from('renoapp_case_clarifications')
    .select('question_id,question_key,label,original_answer,answer_label,answer_note,state,requested,revision,review_note')
    .eq('case_id', caseId).order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as Clarification[]
}
