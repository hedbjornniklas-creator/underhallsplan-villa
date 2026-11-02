import type { TaskView } from './contracts'

export const TASK_ESTIMATE_PRESETS = [5, 10, 15, 30, 60] as const
export const MAX_TASK_ESTIMATE_MINUTES = 10080

export function normalizeTaskEstimate(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > MAX_TASK_ESTIMATE_MINUTES)
    throw new Error('TASK_ESTIMATE_INVALID')
  return value
}

export function parseTaskEstimate(value: string): number | null {
  if (!value.trim()) return null
  if (!/^\d+$/.test(value.trim())) throw new Error('TASK_ESTIMATE_INVALID')
  return normalizeTaskEstimate(Number(value))
}

export function taskEstimateLabel(minutes: number | null | undefined): string {
  if (minutes == null) return 'Tid ej angiven'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60), rest = minutes % 60
  return `${hours} tim${rest ? ` ${rest} min` : ''}`
}

export function taskHasMyBall(task: Pick<TaskView, 'ballHolder' | 'issuerId' | 'assignee'>, userId: string) {
  return task.ballHolder === 'issuer' ? task.issuerId === userId
    : task.ballHolder === 'assignee' && task.assignee.kind === 'profile' && task.assignee.id === userId
}

export function taskIsTimeCandidate(task: TaskView, userId: string): boolean {
  return !['approved', 'cancelled', 'waiting'].includes(task.status) && taskHasMyBall(task, userId)
}

export function compareTaskEstimates(a: Pick<TaskView, 'estimatedMinutes'>, b: Pick<TaskView, 'estimatedMinutes'>, direction: 'asc' | 'desc'): number {
  if (a.estimatedMinutes == null) return b.estimatedMinutes == null ? 0 : 1
  if (b.estimatedMinutes == null) return -1
  return (a.estimatedMinutes - b.estimatedMinutes) * (direction === 'asc' ? 1 : -1)
}
