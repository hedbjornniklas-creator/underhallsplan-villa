import type { TaskStatus } from './contracts'
import { taskTimeToEpoch } from './domain'

export function canEditPersonalDueDate(task: {
  issuer_profile_id: string
  assignee_profile_id: string | null
  assignee_contact_id: string | null
  parent_task_id: string | null
  task_kind: string
  created_source: string
  status: TaskStatus
}, userId: string) {
  return task.issuer_profile_id === userId && task.assignee_profile_id === userId
    && task.assignee_contact_id === null && task.parent_task_id === null
    && task.task_kind === 'simple' && task.created_source === 'manual'
    && !['approved', 'cancelled'].includes(task.status)
}

export function normalizePersonalDueDate(value: unknown): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || !value.includes('T')) throw new Error('TASK_DUE_REQUIRED')
  const epoch = taskTimeToEpoch(value)
  if (epoch === null) throw new Error('TASK_DUE_REQUIRED')
  return new Date(epoch).toISOString()
}
