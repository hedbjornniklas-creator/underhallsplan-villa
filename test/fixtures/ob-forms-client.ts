// In-memory adapter only. No environment, credentials or network fallback.
type Row = Record<string, any>
export const inspectionId = '10000000-0000-4000-8000-000000000001'
export const parts = ['Huvudbyggnad', 'Gästhus med förråd och övernattningsrum'].map((name, index) => ({
  id: `10000000-0000-4000-8000-00000000001${index}`, inspection_id: inspectionId,
  building_id: `10000000-0000-4000-8000-00000000002${index}`, name,
  category_key: index ? 'guesthouse' : 'main', cover_path: 'synthetic-cover.png', scope_note: null,
  sort_order: index, revision: 1, floor_model: { revision: 1, levels: [{ level: 0, name: 'Entréplan' }, { level: 1, name: 'Övre plan' }] },
}))
export const overview = { available: true,
  structure: { inspection_id: inspectionId, primary_part_id: parts[0].id, revision: 1 }, parts,
  buildings: parts.map(part => ({ id: part.building_id, name: part.name })),
  categories: [{ key: 'main', label: 'Huvudbyggnad' }, { key: 'guesthouse', label: 'Gästhus' }],
}
export const inspection: Row = { id: inspectionId, property_id: 'synthetic-property', status: 'ongoing',
  inspection_side: 'seller', locked_at: new URLSearchParams(location.search).has('locked') ? '2026-09-21T10:00:00Z' : null,
  assignment_number: '2026-0921-01', date: '2026-09-21', inspection_time: '09:00', scope: '',
  cover_path: `${location.origin}/photo.png`, client_name: 'Alex Testsson', attendees: 'Fastighetsägare', attendees_other: '',
}
export const property: Row = { id: 'synthetic-property', address: 'Testgatan 1', postal_code: '123 45', city: 'Teststad',
  municipality: 'Testkommun', cadastral_id: 'Exemplet 1:2', owner_name: 'Alex Testsson', customer_name: 'Alex Testsson',
  customer_address: 'Testgatan 1', customer_postal_code: '123 45', customer_city: 'Teststad',
  customer_phone: '0701234567', customer_email: 'test@example.invalid',
}
const items = [
  ['weather', 'Väder', 'single'], ['building_type', 'Byggnadstyp', 'single'],
  ['building_year', 'Byggnadsår och tillbyggnader', 'multi_set'], ['joist', 'Bjälklag', 'per_floor'],
  ['heating', 'Värme och varmvatten', 'multi_set'],
].map(([key, label, mode], index) => ({ id: key, key, label, selection_mode: mode, note_enabled: true, is_active: true, sort_order: index }))
const groups: Row[] = [
  { id: 'weather-kind', overview_item_id: 'weather', key: 'weather', label: 'Väderlek' },
  { id: 'building-kind', overview_item_id: 'building_type', key: 'kind', label: 'Byggnadstyp' },
  { id: 'year-part', overview_item_id: 'building_year', key: 'part', label: 'Byggnadsdel' },
  { id: 'year-built', overview_item_id: 'building_year', key: 'install_year', label: 'Byggnadsår', field_type: 'year' },
  { id: 'joist-kind', overview_item_id: 'joist', key: 'kind', label: 'Material' },
  { id: 'heating-kind', overview_item_id: 'heating', key: 'kind', label: 'Värmekälla' },
  { id: 'heating-year', overview_item_id: 'heating', key: 'install_year', label: 'Installationsår', field_type: 'year' },
  { id: 'heating-maintenance', overview_item_id: 'heating', key: 'maintenance_year', label: 'Senast underhållen', field_type: 'year', condition_on: { key: 'kind', value: 'pump' } },
].map((row, index) => ({ field_type: 'select', is_active: true, sort_order: index, ...row }))
const choices: Record<string, string[][]> = {
  'weather-kind': [['clear', 'Klart väder'], ['rain', 'Regn']],
  'building-kind': [['villa', 'Friliggande enbostadshus']],
  'year-part': [['huvudbyggnad', 'Huvudbyggnad'], ['tillbyggnad', 'Tillbyggnad']],
  'joist-kind': [['wood', 'Trä'], ['concrete', 'Betong']],
  'heating-kind': [['pump', 'Värmepump'], ['electric', 'Direktverkande el']],
}
export const db: Record<string, Row[]> = {
  inspections: [inspection], ob_property_snapshot: [], org_members: [],
  profiles: [{ id: 'synthetic-inspector', full_name: 'Kim Besiktningsman', email: 'inspector@example.invalid',
    phone: '0700000000', company_name: 'BesiktApp testbolag', company_address: 'Provvägen 2', company_city: 'Teststad' }],
  settings_overview_items: items, settings_overview_groups: groups,
  settings_overview_options: Object.entries(choices).flatMap(([group_id, rows]) => rows.map(([value, label], index) => ({
    id: `${group_id}-${index}`, group_id, value, label, is_active: true, sort_order: index, system_value: null,
  }))),
  inspection_conditions: [{ id: 'legacy-condition', inspection_id: inspectionId, furnishing_level: 'fullt_moblerad' }],
  ob_building_conditions: parts.map(part => ({ id: `conditions-${part.id}`, inspection_id: inspectionId,
    building_part_id: part.id, ob_revision: 1, furnishing_level: 'fullt_moblerad' })),
  inspection_overview_selections: parts.flatMap(part => items.flatMap(item => (item.key === 'joist' ? ['plan0', 'plan1'] : [null]).map(floor_key => ({
    id: `${part.id}-${item.id}-${floor_key}`, inspection_id: inspectionId, building_part_id: part.id, ob_revision: 1,
    overview_item_id: item.id, set_index: 0, floor_key, note: null,
    values: item.key === 'weather' ? { weather: 'clear' } : item.key === 'building_type' ? { kind: 'villa' }
      : item.key === 'building_year' ? { part: 'huvudbyggnad', install_year: '1986' }
        : item.key === 'heating' ? { kind: 'pump', install_year: '2018' } : { kind: 'wood' },
  })))),
}
if (new URLSearchParams(location.search).has('legacy')) db.inspection_overview_selections = db.inspection_overview_selections.filter(row => row.building_part_id === parts[0].id)
export const qa = { failSaves: false, saveDelay: 30, writes: [] as Row[] }
Object.assign(window, { __obFormTest: qa, __obMobileTest: qa })
function write(table: string, operation: string, values: Row, filters: ((row: Row) => boolean)[]) {
  qa.writes.push({ table, operation, values: structuredClone(values), failed: qa.failSaves })
  if (qa.failSaves) throw Error('Simulerat sparfel')
  if (!db[table]) throw Error(`Unexpected fixture write: ${table}`)
  if (operation === 'insert' || operation === 'upsert') {
    const row = { id: crypto.randomUUID(), ...values, ob_revision: 1 }
    db[table].push(row); return [row]
  }
  const matches = db[table].filter(row => filters.every(filter => filter(row)))
  if (operation === 'delete') db[table] = db[table].filter(row => !matches.includes(row))
  else matches.forEach(row => Object.assign(row, values, { ob_revision: Number(row.ob_revision || 0) + 1 }))
  return matches
}
class Query implements PromiseLike<any> {
  filters: ((row: Row) => boolean)[] = []
  operation = 'read'; values: Row = {}; singleRow = false; max = Infinity
  constructor(public table: string) { if (!db[table]) throw Error(`Unexpected fixture query: ${table}`) }
  select() { return this }
  eq(key: string, value: unknown) { this.filters.push(row => row[key] === value); return this }
  is(key: string, value: unknown) { return this.eq(key, value) }
  in(key: string, values: unknown[]) { this.filters.push(row => values.includes(row[key])); return this }
  order() { return this }
  limit(max: number) { this.max = max; return this }
  single() { this.singleRow = true; return this }
  maybeSingle() { return this.single() }
  update(values: Row) { this.operation = 'update'; this.values = values; return this }
  insert(values: Row) { this.operation = 'insert'; this.values = values; return this }
  upsert(values: Row) { this.operation = 'upsert'; this.values = values; return this }
  delete() { this.operation = 'delete'; return this }
  then<TResult1 = any, TResult2 = never>(ok?: ((result: any) => TResult1 | PromiseLike<TResult1>) | null,
    fail?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    const result = new Promise(resolve => setTimeout(() => {
      try {
        const rows = this.operation === 'read' ? db[this.table].filter(row => this.filters.every(filter => filter(row))).slice(0, this.max)
          : write(this.table, this.operation, this.values, this.filters)
        resolve({ data: structuredClone(this.singleRow ? rows[0] ?? null : rows), error: null })
      } catch (error) { resolve({ data: null, error: { message: String(error) } }) }
    }, this.operation === 'read' ? 30 : qa.saveDelay))
    return result.then(ok, fail)
  }
}
export const supabase: any = {
  from: (table: string) => new Query(table),
  auth: { getUser: async () => ({ data: { user: { id: 'synthetic-inspector' } }, error: null }) },
  storage: { from: () => ({ getPublicUrl: () => ({ data: { publicUrl: '/photo.png' } }), upload: async () => ({ error: null }) }) },
}
window.fetch = async (input, init) => {
  const url = String(input)
  if (url === `/api/ob/inspections/${inspectionId}/frozen-inspector`) return Response.json({ locked: true, hasSnapshot: true, profile: db.profiles[0] })
  if (url === `/api/ob/inspections/${inspectionId}/addon-orders` && !init?.method) return Response.json({ addonOrders: [] })
  if (url !== `/api/ob/inspections/${inspectionId}/buildings` || init?.method !== 'POST') throw Error(`Blocked fixture request: ${url}`)
  const { operation, payload } = JSON.parse(String(init.body))
  try {
    if (operation === 'row') {
      const data = write(payload.table, payload.operation, { ...payload.row,
        ...(payload.operation === 'insert' ? { id: payload.id, inspection_id: inspectionId, building_part_id: payload.partId } : {}),
      }, [row => row.id === payload.id && row.building_part_id === payload.partId])
      return Response.json({ data: data[0] })
    }
    if (operation === 'edit') {
      qa.writes.push({ operation, payload }); if (qa.failSaves) throw Error('Simulerat sparfel')
      const part = parts.find(part => part.id === payload.partId)!
      Object.assign(part, { name: payload.name ?? part.name, cover_path: payload.coverPath ?? part.cover_path, revision: part.revision + 1 })
      return Response.json({ data: overview })
    }
    throw Error(`Unsupported fixture operation: ${operation}`)
  } catch (error) { return Response.json({ error: String(error) }, { status: 409 }) }
}
