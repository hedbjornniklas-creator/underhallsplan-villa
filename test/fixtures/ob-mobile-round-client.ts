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

const searchPoints = [
  { ...point, id: 'search-local', title: 'Platsens konstruktion' },
  { ...point, id: 'search-remote', title: 'Annan konstruktion', exterior_item_key: 'tak', trigger_room_types: ['vind'] },
  { ...point, id: 'search-other', title: 'Ytterligare konstruktion', exterior_item_key: 'grund', trigger_room_types: ['kallare'] },
]
const searchOutcomes = searchPoints.flatMap((row, index) =>
  Array.from({ length: index === 0 ? 12 : 2 }, (_, i) => ({
    ...outcome,
    id: `${row.id}-${i}`,
    control_point_id: row.id,
    label: `Fukt i trä, ${row.title.toLowerCase()} ${i + 1}`,
    note_template: 'Fukt noterades i träkonstruktionen.',
    // Off-place outcomes sort first once they wrongly become "relevant" after an add.
    sort_order: index === 0 ? 100 + i : i,
  })),
)

export const supabase = {
  storage: { from: () => ({
    getPublicUrl: () => ({ data: { publicUrl: '/photo.png' } }),
    download: async () => ({ data: await (await fetch('/photo.png')).blob(), error: null }),
    upload: async () => ({ data: {}, error: null }),
    remove: () => { throw Error('The building cover must not delete any files') },
  }) },
  from(table: string) {
    if (table === 'inspection_images') {
      let inspection = false
      let building = false
      const builder = {
        select: () => builder,
        eq: (key: string) => { inspection = key === 'inspection_id'; return builder },
        or: (value: string) => { building = value.includes('building_part_id.eq.') && value.includes('building_part_id.is.null'); return builder },
        order: () => builder,
        range: async () => {
          if (!inspection || !building) throw Error('Cover bank is missing its inspection/building scope')
          const params = new URLSearchParams(location.search)
          return { data: params.has('empty-bank') ? [] : [{ id: 'bank-1', file_path: 'synthetic-mobile-inspection/round/test.png', label: 'Fasad' }],
            error: params.has('failed-bank') ? Error('Synthetic load failure') : null }
        },
      }
      return builder
    }
    if (['inspections', 'properties', 'ob_property_snapshot', 'assignments'].includes(table)) {
      const data = table === 'inspections'
        ? { id: 'synthetic-mobile-inspection', property_id: 'synthetic-property', inspection_side: new URLSearchParams(location.search).has('apartment') ? 'apartment' : 'buyer' }
        : table === 'properties' ? { id: 'synthetic-property', name: 'Testobjekt', address: 'Testgatan 1' } : null
      const builder = {
        select: () => builder, eq: () => builder,
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
      }
      return builder
    }
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
        if (new URLSearchParams(location.search).has('search-order')) {
          const rows = table === 'settings_control_points' ? searchPoints : searchOutcomes
          return { data: rows.slice(from, to + 1), error: null }
        }
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
