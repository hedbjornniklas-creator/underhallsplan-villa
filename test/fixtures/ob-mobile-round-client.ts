// Synthetic catalog only. Unexpected tables fail instead of reaching Supabase.
const point = {
  id: 'point-1',
  key: 'fasad',
  title: 'Fasad',
  label: 'Fasad',
  description: null,
  scope: 'exterior',
  exterior_item_key: 'fasad',
  trigger_room_types: ['hall'],
  applies_to: ['buyer'],
}
const outcome = {
  id: 'outcome-1',
  control_point_id: point.id,
  label: 'Skadad metallfasad',
  severity: 1,
  note_template: 'Skada noterades i fasad av stål.',
  risk_template: null,
  ftu_template: null,
  sort_order: 10,
  is_active: true,
}

export const supabase = {
  from(table: string) {
    if (
      !['settings_control_points', 'settings_control_point_outcomes'].includes(
        table,
      )
    )
      throw Error(`Unexpected table: ${table}`)
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: async (from: number, to: number) => {
        const rows =
          table === 'settings_control_points'
            ? [point]
            : [
                outcome,
                ...Array.from({ length: 505 }, (_, i) => ({
                  ...outcome,
                  id: `extra-${i}`,
                  label: `Exempel ${i}`,
                  note_template: 'Syntetiskt underlag',
                  sort_order: 20 + i,
                })),
                {
                  ...outcome,
                  id: 'last-outcome',
                  label: 'Sidindelad kontroll',
                  note_template: 'Ett förslag efter första databassidan.',
                  sort_order: 1000,
                },
              ]
        return { data: rows.slice(from, to + 1), error: null }
      },
    }
    return builder
  },
}
