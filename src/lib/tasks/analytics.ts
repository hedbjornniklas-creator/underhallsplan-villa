import 'server-only'

import type {
  TaskAnalyticsPeriod,
  TaskAnalyticsScope,
  TaskAssigneeAnalytics,
  TaskDeliveryStats,
  TaskPerson,
  TaskStatus,
} from './contracts'
import { TASK_ANALYTICS_PERIODS } from './contracts'

const DAY_MS = 24 * 60 * 60 * 1000
const EXECUTION_STATUSES = new Set<TaskStatus>([
  'assigned',
  'in_progress',
  'waiting',
  'returned',
])

export type TaskAnalyticsTaskInput = {
  id: string
  status: TaskStatus
  dueAt: string
  submittedForReviewAt: string | null
  approvedAt: string | null
  initialDispatchPending: boolean
}

export type TaskAnalyticsDeadlineRequestInput = {
  taskId: string
  currentDueAt: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decidedAt: string | null
}

export type TaskAnalyticsAssigneeInput = TaskAnalyticsTaskInput & {
  assignee: TaskPerson
}

function timestampEpoch(value: string | null | undefined) {
  if (!value) return null
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? epoch : null
}

function subtractUtcMonths(epoch: number, months: number) {
  const source = new Date(epoch)
  const target = new Date(epoch)
  const sourceDay = source.getUTCDate()
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() - months)
  const lastTargetDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0
  )).getUTCDate()
  target.setUTCDate(Math.min(sourceDay, lastTargetDay))
  return target.getTime()
}

function periodStartEpoch(period: TaskAnalyticsPeriod, asOfEpoch: number) {
  if (period === '30d') return asOfEpoch - 30 * DAY_MS
  if (period === '90d') return asOfEpoch - 90 * DAY_MS
  if (period === '12m') return subtractUtcMonths(asOfEpoch, 12)
  return null
}

function emptyDeliveryStats(): TaskDeliveryStats {
  return {
    approvedCount: 0,
    measuredCount: 0,
    unknownCount: 0,
    onTimeCount: 0,
    lateCount: 0,
    onTimePercent: null,
    limitedSample: true,
    taskIds: {
      approved: [],
      onTime: [],
      late: [],
      unknown: [],
    },
  }
}

function deadlineRequestsByTask(requests: readonly TaskAnalyticsDeadlineRequestInput[]) {
  const result = new Map<string, TaskAnalyticsDeadlineRequestInput[]>()
  for (const request of requests) {
    const taskRequests = result.get(request.taskId) ?? []
    taskRequests.push(request)
    result.set(request.taskId, taskRequests)
  }
  return result
}

/**
 * Returns the deadline used for historic delivery accountability.
 *
 * An approved extension remains operationally valid, but when it was approved
 * after the deadline that it replaced, that old deadline is retained for the
 * delivery KPI. This prevents a late approval from erasing an already incurred
 * delay. Malformed approved request history is deliberately unmeasurable.
 */
function accountabilityDueEpoch(
  task: TaskAnalyticsTaskInput,
  requests: readonly TaskAnalyticsDeadlineRequestInput[]
) {
  const currentTaskDue = timestampEpoch(task.dueAt)
  if (currentTaskDue === null) return null

  let firstLateExtensionDue: number | null = null
  for (const request of requests) {
    if (request.status !== 'approved') continue
    const previousDue = timestampEpoch(request.currentDueAt)
    const decidedAt = timestampEpoch(request.decidedAt)
    if (previousDue === null || decidedAt === null) return null
    if (decidedAt > previousDue) {
      firstLateExtensionDue = firstLateExtensionDue === null
        ? previousDue
        : Math.min(firstLateExtensionDue, previousDue)
    }
  }

  return firstLateExtensionDue ?? currentTaskDue
}

function buildScopeWithRequestIndex(input: {
  tasks: readonly TaskAnalyticsTaskInput[]
  requestsByTask: ReadonlyMap<string, readonly TaskAnalyticsDeadlineRequestInput[]>
  asOfEpoch: number
}): TaskAnalyticsScope {
  const deliveryByPeriod = Object.fromEntries(
    TASK_ANALYTICS_PERIODS.map((period) => [period, emptyDeliveryStats()])
  ) as Record<TaskAnalyticsPeriod, TaskDeliveryStats>

  const active: string[] = []
  const overdue: string[] = []
  const dueWithin7Days: string[] = []
  const awaitingReview: string[] = []
  const dueSoonLimit = input.asOfEpoch + 7 * DAY_MS

  for (const task of input.tasks) {
    const taskRequests = input.requestsByTask.get(task.id) ?? []
    const hasPendingDeadlineRequest = taskRequests.some((request) => request.status === 'pending')

    if (task.status !== 'approved' && task.status !== 'cancelled') {
      active.push(task.id)
      if (task.status === 'ready_for_review' || hasPendingDeadlineRequest) {
        awaitingReview.push(task.id)
      }

      if (
        EXECUTION_STATUSES.has(task.status)
        && !task.initialDispatchPending
      ) {
        const dueAt = timestampEpoch(task.dueAt)
        if (dueAt !== null && dueAt < input.asOfEpoch) overdue.push(task.id)
        if (dueAt !== null && dueAt >= input.asOfEpoch && dueAt <= dueSoonLimit) {
          dueWithin7Days.push(task.id)
        }
      }
    }

    if (task.status !== 'approved') continue

    const submittedAt = timestampEpoch(task.submittedForReviewAt)
    const approvedAt = timestampEpoch(task.approvedAt)
    const periodAnchor = submittedAt ?? approvedAt
    const accountableDue = accountabilityDueEpoch(task, taskRequests)
    const classification =
      submittedAt === null
      || submittedAt > input.asOfEpoch
      || accountableDue === null
        ? 'unknown'
        : submittedAt <= accountableDue
          ? 'onTime'
          : 'late'

    for (const period of TASK_ANALYTICS_PERIODS) {
      const startAt = periodStartEpoch(period, input.asOfEpoch)
      const isInPeriod = period === 'all'
        ? true
        : periodAnchor !== null
          && periodAnchor >= (startAt as number)
          && periodAnchor <= input.asOfEpoch
      if (!isInPeriod) continue

      const stats = deliveryByPeriod[period]
      stats.taskIds.approved.push(task.id)
      if (classification === 'onTime') {
        stats.taskIds.onTime.push(task.id)
      } else if (classification === 'late') {
        stats.taskIds.late.push(task.id)
      } else {
        stats.taskIds.unknown.push(task.id)
      }
    }
  }

  for (const period of TASK_ANALYTICS_PERIODS) {
    const stats = deliveryByPeriod[period]
    stats.approvedCount = stats.taskIds.approved.length
    stats.onTimeCount = stats.taskIds.onTime.length
    stats.lateCount = stats.taskIds.late.length
    stats.unknownCount = stats.taskIds.unknown.length
    stats.measuredCount = stats.onTimeCount + stats.lateCount
    stats.onTimePercent = stats.measuredCount === 0
      ? null
      : Math.round((stats.onTimeCount * 100) / stats.measuredCount)
    stats.limitedSample = stats.measuredCount < 5
  }

  return {
    current: {
      activeCount: active.length,
      overdueCount: overdue.length,
      dueWithin7DaysCount: dueWithin7Days.length,
      awaitingReviewCount: awaitingReview.length,
      taskIds: { active, overdue, dueWithin7Days, awaitingReview },
    },
    deliveryByPeriod,
  }
}

export function buildTaskAnalyticsScope(input: {
  tasks: readonly TaskAnalyticsTaskInput[]
  deadlineRequests: readonly TaskAnalyticsDeadlineRequestInput[]
  asOf: string
}) {
  const asOfEpoch = timestampEpoch(input.asOf)
  if (asOfEpoch === null) throw new Error('TASK_ANALYTICS_AS_OF_INVALID')
  return buildScopeWithRequestIndex({
    tasks: input.tasks,
    requestsByTask: deadlineRequestsByTask(input.deadlineRequests),
    asOfEpoch,
  })
}

export function buildTaskAssigneeAnalytics(input: {
  tasks: readonly TaskAnalyticsAssigneeInput[]
  deadlineRequests: readonly TaskAnalyticsDeadlineRequestInput[]
  asOf: string
}): TaskAssigneeAnalytics[] {
  const asOfEpoch = timestampEpoch(input.asOf)
  if (asOfEpoch === null) throw new Error('TASK_ANALYTICS_AS_OF_INVALID')
  const requestsByTask = deadlineRequestsByTask(input.deadlineRequests)
  const groups = new Map<string, { assignee: TaskPerson; tasks: TaskAnalyticsTaskInput[] }>()

  for (const task of input.tasks) {
    if (task.status === 'cancelled') continue
    const key = `${task.assignee.kind}:${task.assignee.id}`
    const group = groups.get(key) ?? { assignee: task.assignee, tasks: [] }
    group.tasks.push(task)
    groups.set(key, group)
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      value: {
        assignee: group.assignee,
        ...buildScopeWithRequestIndex({
          tasks: group.tasks,
          requestsByTask,
          asOfEpoch,
        }),
      },
    }))
    .sort((left, right) => {
      const nameComparison = left.value.assignee.name.localeCompare(
        right.value.assignee.name,
        'sv',
        { sensitivity: 'base', numeric: true }
      )
      return nameComparison !== 0 ? nameComparison : left.key.localeCompare(right.key)
    })
    .map(({ value }) => value)
}
