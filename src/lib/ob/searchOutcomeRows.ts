import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'

type OutcomeSearchRow = {
  id: string
  control_point_id: string | null
  label: string | null
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
}

export async function searchOutcomeRows(
  client: Pick<SupabaseClient, 'from'>,
  query: string,
): Promise<{ data: OutcomeSearchRow[] | null; error: PostgrestError | null }> {
  const term = query.trim()
  // Quote the PostgREST value so commas and quotes remain part of the search text.
  const like = JSON.stringify(`%${term}%`)
  const activeOutcomes = () => client
    .from('settings_control_point_outcomes')
    .select('id, control_point_id, label, note_template, risk_template, ftu_template')
    .eq('is_active', true)
  const [textResult, tagResult] = await Promise.all([
    activeOutcomes().or(
      `label.ilike.${like},note_template.ilike.${like},risk_template.ilike.${like},ftu_template.ilike.${like}`,
    ),
    // tags is jsonb; an array argument would be encoded as a PostgreSQL array.
    activeOutcomes().contains('tags', JSON.stringify([term.toLowerCase()])),
  ])
  const error = textResult.error ?? tagResult.error
  if (error) return { data: null, error }
  const rows = [...(textResult.data ?? []), ...(tagResult.data ?? [])] as OutcomeSearchRow[]
  return { data: Array.from(new Map(rows.map(row => [row.id, row])).values()), error: null }
}
