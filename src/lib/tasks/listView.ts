import type { TaskStatus, TaskView } from './contracts'
import { compareTaskEstimates } from './timeEstimate'

export type TaskSortField = 'title' | 'status' | 'assignee' | 'due' | 'updated' | 'estimate' | 'issuer' | 'ball' | 'context' | 'created'
export type TaskSortDirection = 'asc' | 'desc'
export const TASK_SORT_FIELDS: TaskSortField[] = ['title', 'status', 'assignee', 'due', 'updated', 'estimate', 'issuer', 'ball', 'context', 'created']
export const TASK_STATUS_ORDER: TaskStatus[] = ['ready_for_review', 'returned', 'waiting', 'in_progress', 'assigned', 'draft', 'approved', 'cancelled']
export const EMPTY_TASK_FACETS = { assignee: '', issuer: '', ball: '', status: '', context: '' }
export type TaskListFacets = typeof EMPTY_TASK_FACETS
export type TaskFacetKey = keyof TaskListFacets
export type TaskFacetOption = { value: string; label: string }
export type TaskFacetOptions = Record<TaskFacetKey, TaskFacetOption[]>

const collator = new Intl.Collator('sv', { sensitivity: 'base', numeric: true })
const personKey = (kind: string, id: string) => `${kind}:${id}`

export function taskBallPerson(task: TaskView) {
  if (task.ballHolder === 'issuer') return { value: personKey('profile', task.issuerId), label: task.issuerName }
  if (task.ballHolder === 'assignee') return { value: personKey(task.assignee.kind, task.assignee.id), label: task.assignee.name }
  return { value: 'nobody', label: 'Ingen / avslutad' }
}

export function taskContextKey(task: Pick<TaskView, 'contextLabel'>) {
  const context = task.contextLabel?.trim()
  return context ? `context:${context}` : 'none'
}

function uniqueOptions(options: TaskFacetOption[]) {
  return [...new Map(options.map(option => [option.value, option])).values()]
    .sort((a, b) => collator.compare(a.label, b.label) || a.value.localeCompare(b.value))
}

export function taskFacetOptions(tasks: TaskView[]): TaskFacetOptions {
  return {
    assignee: uniqueOptions(tasks.map(task => ({ value: personKey(task.assignee.kind, task.assignee.id), label: task.assignee.name }))),
    issuer: uniqueOptions(tasks.map(task => ({ value: task.issuerId, label: task.issuerName }))),
    ball: uniqueOptions(tasks.map(taskBallPerson)),
    context: uniqueOptions(tasks.map(task => ({ value: taskContextKey(task), label: task.contextLabel?.trim() || 'Utan projekt / sammanhang' }))),
    status: TASK_STATUS_ORDER.map(value => ({ value, label: value })),
  }
}

export function readTaskFacets(value: unknown, options?: TaskFacetOptions): TaskListFacets {
  const result = { ...EMPTY_TASK_FACETS }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result
  for (const key of Object.keys(result) as TaskFacetKey[]) {
    const candidate = (value as Record<string, unknown>)[key]
    if (typeof candidate !== 'string' || candidate.length > 1000) continue
    if (key === 'status' && candidate && !TASK_STATUS_ORDER.includes(candidate as TaskStatus)) continue
    if (options && candidate && !options[key].some(option => option.value === candidate)) continue
    result[key] = candidate
  }
  return result
}

export function taskMatchesFacets(task: TaskView, facets: TaskListFacets) {
  return (!facets.assignee || personKey(task.assignee.kind, task.assignee.id) === facets.assignee)
    && (!facets.issuer || task.issuerId === facets.issuer)
    && (!facets.ball || taskBallPerson(task).value === facets.ball)
    && (!facets.status || task.status === facets.status)
    && (!facets.context || taskContextKey(task) === facets.context)
}

export function compareTaskList(a: TaskView, b: TaskView, field: TaskSortField, direction: TaskSortDirection) {
  let comparison = 0
  if (field === 'estimate') {
    const result = compareTaskEstimates(a, b, direction)
    if (result) return result
  }
  if (field === 'due') {
    const left = a.dueAt ? Date.parse(a.dueAt) : NaN
    const right = b.dueAt ? Date.parse(b.dueAt) : NaN
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1
    comparison = Number.isFinite(left) ? left - right : 0
  }
  if (field === 'title') comparison = collator.compare(a.title, b.title)
  if (field === 'status') comparison = TASK_STATUS_ORDER.indexOf(a.status) - TASK_STATUS_ORDER.indexOf(b.status)
  if (field === 'assignee') comparison = collator.compare(a.assignee.name, b.assignee.name)
  if (field === 'issuer') comparison = collator.compare(a.issuerName, b.issuerName)
  if (field === 'ball') {
    if ((a.ballHolder === 'nobody') !== (b.ballHolder === 'nobody')) return a.ballHolder === 'nobody' ? 1 : -1
    comparison = collator.compare(taskBallPerson(a).label, taskBallPerson(b).label)
  }
  if (field === 'context') {
    const left = a.contextLabel?.trim() || '', right = b.contextLabel?.trim() || ''
    if (Boolean(left) !== Boolean(right)) return left ? -1 : 1
    comparison = collator.compare(left, right)
  }
  if (field === 'created' || field === 'updated') {
    const date = (task: TaskView) => field === 'created' ? task.createdAt : task.latestMessage?.createdAt ?? task.updatedAt
    const left = Date.parse(date(a)), right = Date.parse(date(b))
    if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1
    comparison = Number.isFinite(left) ? left - right : 0
  }
  if (!comparison) comparison = collator.compare(a.title, b.title)
  if (!comparison) comparison = a.id.localeCompare(b.id)
  return direction === 'asc' ? comparison : -comparison
}
