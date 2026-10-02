import type { SupabaseClient } from '@supabase/supabase-js'
import type { ObInspectionProfileKey } from './inspectionProfile'

/** Only warn about saved text that the destination profile will hide. */
export async function getObProfileChangeConfirmation(
  client: SupabaseClient,
  inspectionId: string,
  nextProfile: ObInspectionProfileKey,
): Promise<string | null> {
  const fields = nextProfile === 'status'
    ? ['risk_text', 'ftu_text']
    : ['recommendation_text', 'comment_text']

  const hasHiddenText = await Promise.all(
    ['inspection_control_items', 'inspection_exterior_observations'].map(async table => {
      let offset = 0
      while (true) {
        // Include all buildings and legacy exterior notes. Paginate until empty
        // so a server-side row limit cannot hide text later in the inspection.
        const { data, error } = await client.from(table)
          .select(fields.join(','))
          .eq('inspection_id', inspectionId)
          .order('id', { ascending: true })
          .range(offset, offset + 199)
        if (error) throw error
        const rows = data as unknown as Array<Record<string, unknown>> | null
        if (!rows?.length) return false
        if (rows.some(row => fields.some(field =>
          typeof row[field] === 'string' && row[field].trim().length > 0))) return true
        offset += rows.length
      }
    }),
  )

  if (!hasHiddenText.some(Boolean)) return null
  return nextProfile === 'status'
    ? 'Byta till statusbesiktning? Befintliga risktexter och texter för fortsatt teknisk utredning sparas, men visas inte i statusbesiktningen. Noteringar och bilder behålls.'
    : 'Byta till överlåtelsebesiktning? Befintliga rekommendationer och övriga kommentarer sparas, men visas inte i överlåtelsebesiktningen. Noteringar och bilder behålls.'
}
