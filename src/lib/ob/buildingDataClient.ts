import type { supabase } from '@/lib/supabaseClient'

type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string; code?: string } | null }
type Filter = { key: string; value: unknown; op: 'eq' | 'is' | 'in' }
type Send = (operation: string, payload: Row) => Promise<unknown>
const tables = new Set(['inspection_interior_rooms','inspection_exterior_observations','inspection_control_items',
  'inspection_images','inspection_round_quick_notes','inspection_overview_selections','inspection_conditions'])

// Explicit repository adapter for the existing OB components. It supports only
// their small query contract; writes never go directly to PostgREST in scoped mode.
export function createBuildingDataClient(client: typeof supabase, inspectionId: string, partId: string, send: Send) {
  const records = new Map<string, Row>()
  const tableRecords = new Map<string, Set<string>>()
  const pending = new Map<string, Row>()
  const remember = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(remember); return }
    if (!value || typeof value !== 'object') return
    const row = value as Row
    if (typeof row.id === 'string' && typeof row.ob_revision === 'number') {
      records.set(row.id, row)
      const table = 'file_path' in row ? 'inspection_images' : 'room_type_key' in row ? 'inspection_interior_rooms'
        : 'overview_item_id' in row ? 'inspection_overview_selections' : 'control_point_id' in row ? 'inspection_control_items'
        : 'is_free_note' in row ? 'inspection_exterior_observations' : 'furnishing_level' in row ? 'ob_building_conditions'
        : 'source_area' in row ? 'inspection_round_quick_notes' : null
      if (table) { const ids = tableRecords.get(table) ?? new Set<string>(); ids.add(row.id); tableRecords.set(table, ids) }
    }
    else Object.values(row).forEach(remember)
  }
  class Query implements PromiseLike<Result> {
    private filters: Filter[] = []
    private orderings: { key: string; options?: { ascending?: boolean } }[] = []
    private max?: number
    private cardinality: 'many' | 'single' | 'maybe' = 'many'
    private operation: 'read' | 'insert' | 'update' | 'delete' = 'read'
    private rows: Row[] = []
    private promise?: Promise<Result>
    private excludeIgnored = false
    private table: string
    constructor(table: string) { this.table = table }
    select(_columns = '*') { return this }
    eq(key: string, value: unknown) { this.filters.push({ key, value, op: 'eq' }); return this }
    is(key: string, value: unknown) { this.filters.push({ key, value, op: 'is' }); return this }
    in(key: string, value: unknown[]) { this.filters.push({ key, value, op: 'in' }); return this }
    or(expression: string) {
      if (expression !== 'processing_status.is.null,processing_status.neq.ignored') throw Error('Filter stöds inte för byggnaden.')
      this.excludeIgnored = true
      return this
    }
    order(key: string, options?: { ascending?: boolean }) { this.orderings.push({ key, options }); return this }
    limit(value: number) { this.max = value; return this }
    single() { this.cardinality = 'single'; return this }
    maybeSingle() { this.cardinality = 'maybe'; return this }
    insert(row: Row | Row[]) { this.operation = 'insert'; this.rows = Array.isArray(row) ? row : [row]; return this }
    upsert(row: Row | Row[], _options?: unknown) { return this.insert(row) }
    update(row: Row) { this.operation = 'update'; this.rows = [row]; return this }
    delete() { this.operation = 'delete'; return this }
    private async execute(): Promise<Result> {
      try {
        if (this.filters.some(f => f.key === 'inspection_id' && f.value !== inspectionId)) throw Error('Fel besiktning.')
        let data: unknown
        if (this.operation === 'read') {
          let query = client.from(this.table as never).select('*').eq('inspection_id', inspectionId)
          query = this.table === 'inspection_images' ? query.or(`building_part_id.eq.${partId},building_part_id.is.null`) : query.eq('building_part_id', partId)
          for (const f of this.filters) {
            if (f.op === 'in') query = query.in(f.key, f.value as never[])
            else if (f.op === 'is') query = query.is(f.key, f.value as null)
            else query = query.eq(f.key, f.value as never)
          }
          for (const o of this.orderings) query = query.order(o.key, o.options)
          if (this.excludeIgnored) query = query.or('processing_status.is.null,processing_status.neq.ignored')
          if (this.max !== undefined) query = query.limit(this.max)
          const result = await query
          if (result.error) return result
          data = result.data
        } else {
          const targetRows = this.operation === 'insert' ? this.rows : [...records.values()].filter(row =>
            tableRecords.get(this.table)?.has(String(row.id)) && row.inspection_id === inspectionId
            && (row.building_part_id === partId || this.table === 'inspection_images' && row.building_part_id === null)
            && (!this.excludeIgnored || row.processing_status !== 'ignored') && this.filters.every(f =>
              f.op === 'in' ? (f.value as unknown[]).includes(row[f.key]) : row[f.key] === f.value))
          if (this.operation !== 'insert' && !this.filters.some(f => f.key === 'id')) throw Error('Välj en sparad post före ändringen.')
          if (!targetRows.length && this.operation !== 'insert') throw Error('Posten har ändrats. Uppdatera vyn innan du sparar igen.')
          const writes = targetRows.map(target => {
            const row = { ...(this.operation === 'insert' ? target : this.rows[0] || {}) }
            const id = this.operation === 'insert' ? String(row.id || crypto.randomUUID()) : String(target.id)
            delete row.id; delete row.inspection_id; delete row.building_part_id; delete row.ob_revision
            const key = JSON.stringify([this.table, this.operation, this.operation === 'insert' ? target : id, row])
            let payload = pending.get(key)
            if (!payload) {
              payload = { table: this.table, operation: this.operation, partId, id, row,
                requestId: this.operation === 'insert' && target.id ? target.id : crypto.randomUUID(),
                ...(this.operation === 'insert' ? {} : { revision: target.ob_revision }) }
              pending.set(key, payload)
            }
            return { key, payload }
          })
          if (writes.length === 1) data = [await send('row', writes[0].payload)]
          else if (writes.length) data = await send('rows', { partId, rows: writes.map(w => w.payload) })
          else data = []
          writes.forEach(w => pending.delete(w.key))
          if (this.operation === 'delete') targetRows.forEach(r => records.delete(String(r.id)))
        }
        if (this.operation !== 'delete') remember(data)
        const list = Array.isArray(data) ? data.filter(Boolean) : data ? [data] : []
        if (this.operation !== 'delete') {
          const ids = tableRecords.get(this.table) ?? new Set<string>()
          list.forEach(row => { if (row && typeof row === 'object' && 'id' in row) ids.add(String(row.id)) })
          tableRecords.set(this.table, ids)
        }
        if (this.cardinality === 'single' && list.length !== 1) throw Error('Posten har ändrats eller tagits bort. Uppdatera vyn.')
        if (this.cardinality === 'maybe' && list.length > 1) throw Error('Flera poster hittades där en förväntades.')
        return { data: this.cardinality === 'many' ? list : list[0] ?? null, error: null }
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : 'Kunde inte spara.' } }
      }
    }
    then<TResult1 = Result, TResult2 = never>(ok?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
      fail?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
      this.promise ??= this.execute()
      return this.promise.then(ok, fail)
    }
  }
  const scoped = {
    from(table: string) {
      if (tables.has(table)) return new Query(table === 'inspection_conditions' ? 'ob_building_conditions' : table)
      if (!table.startsWith('settings_')) throw Error(`Tabellen ${table} ingår inte i byggnadens datalager.`)
      return client.from(table as never)
    },
    storage: client.storage,
  } as unknown as typeof supabase
  return { client: scoped, remember }
}
