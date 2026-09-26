import type { SupabaseClient } from '@supabase/supabase-js'

// Historical references are resolved by identity, not catalogue availability or parent.
export async function fetchSelectedOutcomes<T extends { id: string }>(
  client: Pick<SupabaseClient, 'from'>,
  selectedIds: string[],
): Promise<Record<string, T>> {
  const ids = Array.from(new Set(selectedIds.filter(Boolean)))
  if (!ids.length) return {}
  const { data, error } = await client
    .from('settings_control_point_outcomes')
    .select('id, control_point_id, outcome_key, label, severity, note_template, risk_template, ftu_template, tags, sort_order, is_active')
    .in('id', ids)
  if (error) throw error
  return Object.fromEntries(((data ?? []) as unknown as T[]).map(row => [row.id, row]))
}
