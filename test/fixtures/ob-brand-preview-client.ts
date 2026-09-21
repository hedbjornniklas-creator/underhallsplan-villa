// No Supabase client or credentials are loaded by the brand preview.
const point = {
  id: 'point-1', key: 'vatrum', title: 'Golv och ytskikt i våtrum',
  label: 'Golv och ytskikt i våtrum', description: null, scope: 'interior',
  exterior_item_key: null, trigger_room_types: ['hall'], applies_to: ['buyer'],
}
const templates = [
  ['Spricka i klinker', 'Spricka noterades i en klinkerplatta intill väggen.', 'Bakomliggande skada kan inte uteslutas.'],
  ['Otät rörgenomföring', 'Rörgenomföring i golvet noterades i våtzonen.', 'Förhöjd risk för fuktinträngning.'],
  ['Golvbrunnens anslutning', 'Tätskiktets anslutning till golvbrunnen kunde inte kontrolleras okulärt.', null],
]
export const supabase = {
  from(table: string) {
    if (!['settings_control_points', 'settings_control_point_outcomes'].includes(table)) throw Error(`Blocked preview table: ${table}`)
    const rows = table === 'settings_control_points' ? [point] : templates.map(([label, note, risk], index) => ({
      id: `outcome-${index + 1}`, control_point_id: point.id, label, severity: 1,
      note_template: note, risk_template: risk, ftu_template: null, sort_order: index, is_active: true,
    }))
    const builder = { select: () => builder, eq: () => builder, order: () => builder,
      range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1), error: null }) }
    return builder
  },
}
