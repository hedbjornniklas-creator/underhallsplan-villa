export const schedulePhases = ['Mark', 'Grund', 'Stomme', 'Tak', 'Fasad', 'Fönster', 'Invändigt', 'VVS', 'Ventilation', 'El', 'Målning', 'Slutkontroll']
export const scheduleStatuses = { planned: 'Planerat', in_progress: 'Pågår', completed: 'Klart' } as const
export type ProjectScheduleRow = {
  id: string
  title: string
  phase: string
  startDate: string
  endDate: string
  status: keyof typeof scheduleStatuses
  sourceItemId: string | null
}
export type ProjectSchedule = { available: boolean; revision: number; rows: ProjectScheduleRow[]; sharedRows: ProjectScheduleRow[] }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function date(value: unknown) {
  if (value === '') return ''
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('PROJECT_SCHEDULE_INVALID')
  return value
}
export function normalizeScheduleRows(input: unknown, complete = false): ProjectScheduleRow[] {
  if (!Array.isArray(input) || input.length > 200) throw new Error('PROJECT_SCHEDULE_INVALID')
  const ids = new Set<string>()
  const sources = new Set<string>()
  return input.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('PROJECT_SCHEDULE_INVALID')
    const r = raw as Record<string, unknown>
    if (typeof r.id !== 'string' || !uuid.test(r.id) || ids.has(r.id) || typeof r.title !== 'string' || r.title.length > 250 || typeof r.phase !== 'string' || r.phase.length > 100 || typeof r.status !== 'string' || !Object.hasOwn(scheduleStatuses, r.status)) throw new Error('PROJECT_SCHEDULE_INVALID')
    ids.add(r.id)
    if (r.sourceItemId !== null && (typeof r.sourceItemId !== 'string' || !uuid.test(r.sourceItemId) || sources.has(r.sourceItemId))) throw new Error('PROJECT_SCHEDULE_INVALID')
    if (r.sourceItemId) sources.add(r.sourceItemId as string)
    const startDate = date(r.startDate), endDate = date(r.endDate)
    if ((startDate && endDate && endDate < startDate) || (complete && !r.title.trim())) throw new Error('PROJECT_SCHEDULE_INVALID')
    return { id: r.id, title: r.title.trim(), phase: r.phase.trim(), startDate, endDate, status: r.status as ProjectScheduleRow['status'], sourceItemId: r.sourceItemId as string | null }
  })
}
export function importScheduleRows(rows: ProjectScheduleRow[], items: { id: string; title: string }[], id: () => string): ProjectScheduleRow[] {
  const sources = new Set(rows.map((r) => r.sourceItemId))
  return [...rows, ...items.filter((item) => !sources.has(item.id)).map((item) => ({
    id: id(), title: item.title, phase: '', startDate: '', endDate: '', status: 'planned' as const, sourceItemId: item.id
  }))].slice(0, 200)
}
