import type {
  TaskBallHolder,
  TaskChannel,
  TaskRequirementStatus,
  TaskRisk,
  TaskStatus,
} from './contracts'
import {
  DEFAULT_TASK_TIME_ZONE,
  addTaskDateInputDays,
  normalizeTaskTimeZone,
  taskDateTimeInputToIso,
  taskIsoToDateTimeInput,
} from './dateTime'

export type {
  TaskBallHolder,
  TaskChannel,
  TaskRequirementStatus,
  TaskRisk,
  TaskStatus,
} from './contracts'

/**
 * Pure domain rules for the Uppdrag module.
 *
 * This file intentionally has no React, browser, database, or provider dependencies.
 * Every time-dependent function requires `now` explicitly so the same input always
 * produces the same result on the server and in the browser.
 */

export const TASK_STATUSES = [
  'draft',
  'assigned',
  'in_progress',
  'waiting',
  'ready_for_review',
  'returned',
  'approved',
  'cancelled',
] as const satisfies readonly TaskStatus[]

export const ACTIVE_TASK_STATUSES = [
  'assigned',
  'in_progress',
  'waiting',
  'ready_for_review',
  'returned',
] as const satisfies readonly TaskStatus[]

export type ActiveTaskStatus = (typeof ACTIVE_TASK_STATUSES)[number]

export const TASK_CHECKPOINT_STATES = [
  'pending',
  'evidence_detected',
  'verified',
  'not_required',
  'waived',
] as const satisfies readonly TaskRequirementStatus[]

export type TaskCheckpointState = TaskRequirementStatus

export type TaskTransitionActor =
  | 'creator'
  | 'assignee'
  | 'signe'
  | 'system'
  | 'administrator'

export const TASK_STATUS_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  draft: ['assigned', 'cancelled'],
  assigned: ['in_progress', 'waiting', 'ready_for_review', 'cancelled'],
  in_progress: ['waiting', 'ready_for_review', 'cancelled'],
  waiting: ['in_progress', 'ready_for_review', 'cancelled'],
  ready_for_review: ['approved', 'returned'],
  returned: ['in_progress', 'waiting', 'ready_for_review', 'cancelled'],
  approved: [],
  cancelled: [],
}

export type TaskTransitionIssueCode =
  | 'same_status'
  | 'transition_not_allowed'
  | 'actor_not_allowed'
  | 'assignee_required'
  | 'due_at_required'
  | 'next_follow_up_at_required'
  | 'waiting_reason_required'
  | 'review_comment_required'
  | 'cancellation_reason_required'
  | 'incomplete_children'
  | 'blocking_checkpoints'
  | 'required_evidence_missing'
  | 'review_submission_stale'
  | 'invalid_aggregate_count'

export type TaskTransitionDecision = {
  allowed: boolean
  issues: TaskTransitionIssueCode[]
}

/**
 * Aggregated facts must be loaded by the caller inside the same consistency
 * boundary as the eventual write. The domain layer never assumes that missing
 * children, checkpoints, or evidence are complete.
 */
export type TaskTransitionInput = {
  from: TaskStatus
  to: TaskStatus
  actor: TaskTransitionActor
  assigneeId: string | null
  dueAt: string | null
  nextFollowUpAt: string | null
  waitingReason: string | null
  reviewComment: string | null
  cancellationReason: string | null
  incompleteChildCount: number
  blockingCheckpointCount: number
  missingRequiredEvidenceCount: number
  reviewSubmissionIsCurrent: boolean
}

const TERMINAL_TASK_STATUSES = new Set<TaskStatus>(['approved', 'cancelled'])
const ACTIVE_TASK_STATUS_SET = new Set<TaskStatus>(ACTIVE_TASK_STATUSES)

function hasText(value: string | null | undefined) {
  return Boolean(value?.trim())
}

function isNonNegativeInteger(value: number) {
  return Number.isInteger(value) && value >= 0
}

function actorsForTransition(from: TaskStatus, to: TaskStatus): readonly TaskTransitionActor[] {
  if (to === 'cancelled') return ['creator', 'administrator']
  if (from === 'draft' && to === 'assigned') return ['creator', 'administrator']
  if (from === 'ready_for_review' && to === 'approved') return ['creator', 'administrator']
  if (from === 'ready_for_review' && to === 'returned') return ['creator', 'administrator']
  if (to === 'in_progress') return ['assignee', 'signe', 'system']
  if (to === 'waiting') return ['assignee', 'signe']
  if (to === 'ready_for_review') return ['assignee', 'signe', 'system']
  return []
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export function isActiveTaskStatus(status: TaskStatus): status is ActiveTaskStatus {
  return ACTIVE_TASK_STATUS_SET.has(status)
}

export function isTerminalTaskStatus(status: TaskStatus) {
  return TERMINAL_TASK_STATUSES.has(status)
}

export function isBlockingTaskCheckpoint(state: TaskCheckpointState) {
  return state === 'pending' || state === 'evidence_detected'
}

export function isSatisfiedTaskCheckpoint(state: TaskCheckpointState) {
  return state === 'verified' || state === 'not_required' || state === 'waived'
}

export function getAllowedTaskTransitions(
  status: TaskStatus,
  actor?: TaskTransitionActor
): readonly TaskStatus[] {
  const allowed = TASK_STATUS_TRANSITIONS[status]
  if (!actor) return allowed
  return allowed.filter((next) => actorsForTransition(status, next).includes(actor))
}

export function evaluateTaskTransition(input: TaskTransitionInput): TaskTransitionDecision {
  const issues: TaskTransitionIssueCode[] = []

  if (input.from === input.to) {
    return { allowed: false, issues: ['same_status'] }
  }

  if (!TASK_STATUS_TRANSITIONS[input.from].includes(input.to)) {
    return { allowed: false, issues: ['transition_not_allowed'] }
  }

  if (!actorsForTransition(input.from, input.to).includes(input.actor)) {
    issues.push('actor_not_allowed')
  }

  if (
    !isNonNegativeInteger(input.incompleteChildCount)
    || !isNonNegativeInteger(input.blockingCheckpointCount)
    || !isNonNegativeInteger(input.missingRequiredEvidenceCount)
  ) {
    issues.push('invalid_aggregate_count')
  }

  if (isActiveTaskStatus(input.to)) {
    if (!hasText(input.assigneeId)) issues.push('assignee_required')
    if (taskTimeToEpoch(input.dueAt) === null) issues.push('due_at_required')
    if (taskTimeToEpoch(input.nextFollowUpAt) === null) {
      issues.push('next_follow_up_at_required')
    }
  }

  if (input.to === 'waiting') {
    if (!hasText(input.waitingReason)) issues.push('waiting_reason_required')
  }

  if (input.to === 'ready_for_review' || input.to === 'approved') {
    if (input.incompleteChildCount > 0) issues.push('incomplete_children')
    if (input.blockingCheckpointCount > 0) issues.push('blocking_checkpoints')
    if (input.missingRequiredEvidenceCount > 0) issues.push('required_evidence_missing')
  }

  if (input.from === 'ready_for_review' && input.to === 'approved') {
    if (!input.reviewSubmissionIsCurrent) issues.push('review_submission_stale')
  }

  if (input.from === 'ready_for_review' && input.to === 'returned') {
    if (!hasText(input.reviewComment)) issues.push('review_comment_required')
  }

  if (input.to === 'cancelled') {
    if (!hasText(input.cancellationReason)) issues.push('cancellation_reason_required')
    if (input.incompleteChildCount > 0) issues.push('incomplete_children')
  }

  return { allowed: issues.length === 0, issues }
}

export class TaskTransitionError extends Error {
  readonly issues: TaskTransitionIssueCode[]

  constructor(issues: readonly TaskTransitionIssueCode[]) {
    super(`TASK_TRANSITION_REJECTED:${issues.join(',')}`)
    this.name = 'TaskTransitionError'
    this.issues = [...issues]
  }
}

export function assertTaskTransition(input: TaskTransitionInput) {
  const decision = evaluateTaskTransition(input)
  if (!decision.allowed) throw new TaskTransitionError(decision.issues)
}

export type TaskBallHolderKind = TaskBallHolder

export type TaskBallHolderReason =
  | 'draft_owned_by_issuer'
  | 'execution_owned_by_assignee'
  | 'waiting_but_accountability_remains'
  | 'changes_requested_owned_by_assignee'
  | 'review_owned_by_issuer'
  | 'terminal_task'

export type TaskBallHolderDecision = {
  kind: TaskBallHolderKind
  participantId: string | null
  reason: TaskBallHolderReason
}

export function getTaskBallHolderKind(status: TaskStatus): TaskBallHolder {
  if (status === 'draft' || status === 'ready_for_review') return 'issuer'
  if (isTerminalTaskStatus(status)) return 'nobody'
  return 'assignee'
}

export function getTaskBallHolder(input: {
  status: TaskStatus
  creatorId: string | null
  assigneeId: string | null
}): TaskBallHolderDecision {
  switch (input.status) {
    case 'draft':
      return {
        kind: 'issuer',
        participantId: input.creatorId,
        reason: 'draft_owned_by_issuer',
      }
    case 'assigned':
    case 'in_progress':
      return {
        kind: 'assignee',
        participantId: input.assigneeId,
        reason: 'execution_owned_by_assignee',
      }
    case 'waiting':
      return {
        kind: 'assignee',
        participantId: input.assigneeId,
        reason: 'waiting_but_accountability_remains',
      }
    case 'returned':
      return {
        kind: 'assignee',
        participantId: input.assigneeId,
        reason: 'changes_requested_owned_by_assignee',
      }
    case 'ready_for_review':
      return {
        kind: 'issuer',
        participantId: input.creatorId,
        reason: 'review_owned_by_issuer',
      }
    case 'approved':
    case 'cancelled':
      return { kind: 'nobody', participantId: null, reason: 'terminal_task' }
  }
}

export type TaskTimeValue = string | number | Date

const TASK_ISO_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2}))?$/

function isValidTaskIsoTime(value: string) {
  const match = TASK_ISO_TIME_PATTERN.exec(value)
  if (!match) return false
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return false
  if (hourText === undefined) return true

  const hour = Number(hourText)
  const minute = Number(minuteText)
  const second = Number(secondText)
  if (hour > 23 || minute > 59 || second > 59) return false
  if (zone && zone !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3))
    const offsetMinute = Number(zone.slice(4, 6))
    if (offsetHour > 14 || offsetMinute > 59 || (offsetHour === 14 && offsetMinute > 0)) {
      return false
    }
  }
  return true
}

export function taskTimeToEpoch(value: TaskTimeValue | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && !isValidTaskIsoTime(value)) return null
  const epoch = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value)
  return Number.isFinite(epoch) && Number.isFinite(new Date(epoch).getTime()) ? epoch : null
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

export type TaskCalendarPolicy = {
  /** IANA zone used when deciding which local calendar date an instant belongs to. */
  timeZone?: string
  /** Local weekday numbers, where Sunday is 0 and Saturday is 6. */
  workingWeekdays: readonly number[]
  /** Local calendar dates in YYYY-MM-DD form. */
  excludedDateKeys: readonly string[]
}

export const DEFAULT_TASK_CALENDAR_POLICY: TaskCalendarPolicy = Object.freeze({
  timeZone: DEFAULT_TASK_TIME_ZONE,
  workingWeekdays: Object.freeze([1, 2, 3, 4, 5]),
  excludedDateKeys: Object.freeze([]),
})

function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: value.trim() }).format(0)
    return true
  } catch {
    return false
  }
}

export function isValidTaskTimeZone(value: unknown): value is string {
  return isValidIanaTimeZone(value)
}

function isValidLocalDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = Date.parse(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

function calendarTimeZone(policy: TaskCalendarPolicy) {
  return normalizeTaskTimeZone(policy.timeZone)
}

export function isValidTaskCalendarPolicy(policy: TaskCalendarPolicy) {
  const weekdays = [...new Set(policy.workingWeekdays)]
  return (
    (policy.timeZone === undefined || isValidIanaTimeZone(policy.timeZone))
    &&
    weekdays.length > 0
    && weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 0 && weekday <= 6)
    && policy.excludedDateKeys.every((dateKey) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false
      return isValidLocalDateKey(dateKey)
    })
  )
}

export function taskZonedDateKey(value: TaskTimeValue, timeZone = DEFAULT_TASK_TIME_ZONE) {
  const epoch = taskTimeToEpoch(value)
  if (epoch === null || !isValidIanaTimeZone(timeZone)) return null
  return taskIsoToDateTimeInput(epoch, timeZone)?.date ?? null
}

function localDateWeekday(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`).getUTCDay()
}

function isWorkingDateKey(dateKey: string, policy: TaskCalendarPolicy) {
  const weekday = localDateWeekday(dateKey)
  return (
    policy.workingWeekdays.includes(weekday)
    && !policy.excludedDateKeys.includes(dateKey)
  )
}

/**
 * Shifts an instant by whole local working days while preserving its wall-clock
 * time in the configured IANA zone. This keeps Friday-to-Monday calculations
 * correct across both UTC midnight and daylight-saving transitions.
 */
export function shiftTaskTimeByWorkingDays(
  value: TaskTimeValue,
  workingDays: number,
  policy: TaskCalendarPolicy = DEFAULT_TASK_CALENDAR_POLICY
): number | null {
  const epoch = taskTimeToEpoch(value)
  if (
    epoch === null
    || !Number.isInteger(workingDays)
    || Math.abs(workingDays) > 3660
    || !isValidTaskCalendarPolicy(policy)
  ) return null
  if (workingDays === 0) return epoch

  const direction = workingDays > 0 ? 1 : -1
  let remaining = Math.abs(workingDays)
  const timeZone = calendarTimeZone(policy)
  const local = taskIsoToDateTimeInput(epoch, timeZone)
  if (!local) return null
  let cursorDateKey = local.date
  while (remaining > 0) {
    cursorDateKey = addTaskDateInputDays(cursorDateKey, direction)
    if (!cursorDateKey) return null
    if (isWorkingDateKey(cursorDateKey, policy)) remaining -= 1
  }
  const seconds = new Date(epoch).getUTCSeconds()
  const shifted = taskDateTimeInputToIso(
    cursorDateKey,
    `${local.time}:${String(seconds).padStart(2, '0')}`,
    timeZone
  )
  return shifted ? Date.parse(shifted) : null
}

/** Counts working calendar dates after `start` up to and including `end`. */
export function countTaskWorkingDaysAfter(
  start: TaskTimeValue,
  end: TaskTimeValue,
  policy: TaskCalendarPolicy = DEFAULT_TASK_CALENDAR_POLICY
) {
  const startEpoch = taskTimeToEpoch(start)
  const endEpoch = taskTimeToEpoch(end)
  if (
    startEpoch === null
    || endEpoch === null
    || endEpoch <= startEpoch
    || !isValidTaskCalendarPolicy(policy)
  ) return 0

  const timeZone = calendarTimeZone(policy)
  const startDateKey = taskZonedDateKey(startEpoch, timeZone)
  const endDateKey = taskZonedDateKey(endEpoch, timeZone)
  if (!startDateKey || !endDateKey || startDateKey === endDateKey) return 0
  let count = 0
  let cursorDateKey = startDateKey
  for (let guard = 0; cursorDateKey < endDateKey && guard < 3661; guard += 1) {
    cursorDateKey = addTaskDateInputDays(cursorDateKey, 1)
    if (!cursorDateKey) return 0
    if (isWorkingDateKey(cursorDateKey, policy)) count += 1
  }
  return count
}

export const TASK_RISK_LEVELS = ['green', 'yellow', 'red'] as const satisfies readonly TaskRisk[]
export type TaskRiskLevel = TaskRisk

export type TaskRiskReason =
  | 'invalid_policy'
  | 'missing_schedule'
  | 'due_soon'
  | 'overdue'
  | 'follow_up_due'
  | 'follow_up_severely_overdue'
  | 'review_due_soon'
  | 'review_overdue'
  | 'changes_requested'
  | 'unanswered_limit_reached'
  | 'primary_delivery_failed'
  | 'child_deadline_after_parent'

export type TaskRiskPolicy = {
  dueSoonWorkingDays: number
  followUpRedAfterHours: number
  reviewDueSoonHours: number
  unansweredAttemptRedLimit: number
}

export const DEFAULT_TASK_RISK_POLICY: TaskRiskPolicy = Object.freeze({
  dueSoonWorkingDays: 3,
  followUpRedAfterHours: 24,
  reviewDueSoonHours: 24,
  unansweredAttemptRedLimit: 5,
})

export function isValidTaskRiskPolicy(policy: TaskRiskPolicy) {
  return (
    Number.isInteger(policy.dueSoonWorkingDays)
    && policy.dueSoonWorkingDays >= 0
    && policy.dueSoonWorkingDays <= 365
    && Number.isFinite(policy.followUpRedAfterHours)
    && policy.followUpRedAfterHours > 0
    && Number.isFinite(policy.reviewDueSoonHours)
    && policy.reviewDueSoonHours >= 0
    && Number.isInteger(policy.unansweredAttemptRedLimit)
    && policy.unansweredAttemptRedLimit > 0
  )
}

export type TaskRiskInput = {
  status: TaskStatus
  now: TaskTimeValue
  dueAt: TaskTimeValue | null
  nextFollowUpAt: TaskTimeValue | null
  reviewDueAt?: TaskTimeValue | null
  unansweredAttempts?: number
  primaryDeliveryFailed?: boolean
  childDeadlineAfterParent?: boolean
  policy?: TaskRiskPolicy
  calendar?: TaskCalendarPolicy
}

export type TaskRiskAssessment = {
  level: TaskRisk
  reasons: TaskRiskReason[]
}

function pushUnique<T>(values: T[], value: T) {
  if (!values.includes(value)) values.push(value)
}

export function evaluateTaskRisk(input: TaskRiskInput): TaskRiskAssessment {
  if (input.status === 'draft' || isTerminalTaskStatus(input.status)) {
    return { level: 'green', reasons: [] }
  }

  const now = taskTimeToEpoch(input.now)
  const policy = input.policy ?? DEFAULT_TASK_RISK_POLICY
  const calendar = input.calendar ?? DEFAULT_TASK_CALENDAR_POLICY
  const reasons: TaskRiskReason[] = []
  let hasYellow = false
  let hasRed = false

  if (now === null) return { level: 'red', reasons: ['missing_schedule'] }
  if (!isValidTaskRiskPolicy(policy) || !isValidTaskCalendarPolicy(calendar)) {
    return { level: 'red', reasons: ['invalid_policy'] }
  }

  if (input.status === 'ready_for_review') {
    const reviewDue = taskTimeToEpoch(input.reviewDueAt ?? input.nextFollowUpAt)
    if (reviewDue === null) {
      pushUnique(reasons, 'missing_schedule')
      hasRed = true
    } else if (now >= reviewDue) {
      pushUnique(reasons, 'review_overdue')
      hasRed = true
    } else if (now >= reviewDue - policy.reviewDueSoonHours * HOUR_MS) {
      pushUnique(reasons, 'review_due_soon')
      hasYellow = true
    }
    return { level: hasRed ? 'red' : hasYellow ? 'yellow' : 'green', reasons }
  }

  if (input.primaryDeliveryFailed) {
    pushUnique(reasons, 'primary_delivery_failed')
    hasYellow = true
  }
  if (input.childDeadlineAfterParent) {
    pushUnique(reasons, 'child_deadline_after_parent')
    hasYellow = true
  }
  if (input.status === 'returned') {
    pushUnique(reasons, 'changes_requested')
    hasYellow = true
  }
  if ((input.unansweredAttempts ?? 0) >= policy.unansweredAttemptRedLimit) {
    pushUnique(reasons, 'unanswered_limit_reached')
    hasRed = true
  }

  const dueAt = taskTimeToEpoch(input.dueAt)
  const nextFollowUpAt = taskTimeToEpoch(input.nextFollowUpAt)
  if (dueAt === null || nextFollowUpAt === null) {
    pushUnique(reasons, 'missing_schedule')
    hasRed = true
  }

  if (dueAt !== null) {
    if (now >= dueAt) {
      pushUnique(reasons, 'overdue')
      hasRed = true
    } else {
      const dueSoonAt = shiftTaskTimeByWorkingDays(
        dueAt,
        -policy.dueSoonWorkingDays,
        calendar
      )
      if (dueSoonAt !== null && now >= dueSoonAt) {
        pushUnique(reasons, 'due_soon')
        hasYellow = true
      }
    }
  }

  if (nextFollowUpAt !== null && now >= nextFollowUpAt) {
    const lateBy = now - nextFollowUpAt
    if (lateBy >= policy.followUpRedAfterHours * HOUR_MS) {
      pushUnique(reasons, 'follow_up_severely_overdue')
      hasRed = true
    } else {
      pushUnique(reasons, 'follow_up_due')
      hasYellow = true
    }
  }

  return { level: hasRed ? 'red' : hasYellow ? 'yellow' : 'green', reasons }
}

export const TASK_COMMUNICATION_CHANNELS = [
  'email',
  'whatsapp',
] as const satisfies readonly TaskChannel[]
export type TaskCommunicationChannel = TaskChannel

export type TaskDeliveryState = 'unknown' | 'pending' | 'delivered' | 'failed'

/**
 * Organization-wide window for automatic messages to the task recipient.
 * Weekdays use ISO numbering: Monday is 1 and Sunday is 7. The end minute is
 * exclusive, so 07:00-20:00 permits 19:59 but not 20:00.
 */
export type TaskSendWindowPolicy = {
  timeZone: string
  startMinute: number
  endMinute: number
  isoWeekdays: readonly number[]
}

export const DEFAULT_TASK_SEND_WINDOW_POLICY: TaskSendWindowPolicy = Object.freeze({
  timeZone: DEFAULT_TASK_TIME_ZONE,
  startMinute: 7 * 60,
  endMinute: 20 * 60,
  isoWeekdays: Object.freeze([1, 2, 3, 4, 5, 6, 7]),
})

export function isValidTaskSendWindowPolicy(policy: TaskSendWindowPolicy) {
  const weekdays = [...new Set(policy.isoWeekdays)]
  return (
    isValidIanaTimeZone(policy.timeZone)
    && Number.isInteger(policy.startMinute)
    && Number.isInteger(policy.endMinute)
    && policy.startMinute >= 0
    && policy.startMinute < 24 * 60
    && policy.endMinute > policy.startMinute
    && policy.endMinute <= 24 * 60
    && weekdays.length > 0
    && weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)
  )
}

function isoWeekdayForDateKey(dateKey: string) {
  const jsWeekday = localDateWeekday(dateKey)
  return jsWeekday === 0 ? 7 : jsWeekday
}

function zonedDateAndMinute(value: TaskTimeValue, timeZone: string) {
  const epoch = taskTimeToEpoch(value)
  if (epoch === null) return null
  const local = taskIsoToDateTimeInput(epoch, timeZone)
  if (!local) return null
  const [hourText, minuteText] = local.time.split(':')
  const minute = Number(hourText) * 60 + Number(minuteText)
  return Number.isInteger(minute)
    ? { epoch, dateKey: local.date, minute }
    : null
}

export function isTaskSendTimeAllowed(
  value: TaskTimeValue,
  policy: TaskSendWindowPolicy = DEFAULT_TASK_SEND_WINDOW_POLICY
) {
  if (!isValidTaskSendWindowPolicy(policy)) return false
  const local = zonedDateAndMinute(value, policy.timeZone)
  return Boolean(
    local
    && policy.isoWeekdays.includes(isoWeekdayForDateKey(local.dateKey))
    && local.minute >= policy.startMinute
    && local.minute < policy.endMinute
  )
}

/** Returns the candidate unchanged when allowed, otherwise the next window start. */
export function nextTaskSendWindowAt(
  value: TaskTimeValue,
  policy: TaskSendWindowPolicy = DEFAULT_TASK_SEND_WINDOW_POLICY
): number | null {
  if (!isValidTaskSendWindowPolicy(policy)) return null
  const local = zonedDateAndMinute(value, policy.timeZone)
  if (!local) return null
  if (isTaskSendTimeAllowed(local.epoch, policy)) return local.epoch

  let dateKey = local.dateKey
  for (let offset = 0; offset <= 14; offset += 1) {
    if (offset > 0) {
      dateKey = addTaskDateInputDays(dateKey, 1)
      if (!dateKey) return null
    }
    if (!policy.isoWeekdays.includes(isoWeekdayForDateKey(dateKey))) continue
    if (offset === 0 && local.minute >= policy.endMinute) continue

    const hour = Math.floor(policy.startMinute / 60)
    const minute = policy.startMinute % 60
    const candidateIso = taskDateTimeInputToIso(
      dateKey,
      `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      policy.timeZone
    )
    if (!candidateIso) continue
    const candidate = Date.parse(candidateIso)
    if (candidate >= local.epoch && isTaskSendTimeAllowed(candidate, policy)) return candidate
  }
  return null
}

export type TaskReminderPolicy = {
  noActivityAfterHours: number
  dueReminderWorkingDaysBefore: readonly number[]
  overdueCadenceHours: number
  escalateAfterOverdueWorkingDays: number
  escalateAfterUnansweredAttempts: number
  fallbackAfterUnansweredAttempts: number
  pauseAfterUnansweredAttempts: number
  maxOverdueRemindersBeforePause: number
  minimumExternalContactIntervalHours: number
  reviewReminderIntervalHours: number
}

export const DEFAULT_TASK_REMINDER_POLICY: TaskReminderPolicy = Object.freeze({
  noActivityAfterHours: 48,
  dueReminderWorkingDaysBefore: Object.freeze([3, 1, 0]),
  overdueCadenceHours: 24,
  escalateAfterOverdueWorkingDays: 2,
  escalateAfterUnansweredAttempts: 3,
  fallbackAfterUnansweredAttempts: 2,
  pauseAfterUnansweredAttempts: 5,
  maxOverdueRemindersBeforePause: 5,
  minimumExternalContactIntervalHours: 24,
  reviewReminderIntervalHours: 24,
})

export type TaskReminderPolicyIssueCode =
  | 'invalid_calendar_policy'
  | 'invalid_send_window_policy'
  | 'invalid_no_activity_interval'
  | 'invalid_due_reminder_offset'
  | 'invalid_overdue_interval'
  | 'invalid_escalation_limit'
  | 'invalid_fallback_limit'
  | 'invalid_pause_limit'
  | 'invalid_overdue_pause_limit'
  | 'invalid_contact_interval'
  | 'invalid_review_interval'

export function validateTaskReminderPolicy(
  policy: TaskReminderPolicy,
  calendar: TaskCalendarPolicy = DEFAULT_TASK_CALENDAR_POLICY,
  sendWindow: TaskSendWindowPolicy = DEFAULT_TASK_SEND_WINDOW_POLICY
): TaskReminderPolicyIssueCode[] {
  const issues: TaskReminderPolicyIssueCode[] = []
  if (!isValidTaskCalendarPolicy(calendar)) issues.push('invalid_calendar_policy')
  if (!isValidTaskSendWindowPolicy(sendWindow)) issues.push('invalid_send_window_policy')
  if (!Number.isFinite(policy.noActivityAfterHours) || policy.noActivityAfterHours <= 0) {
    issues.push('invalid_no_activity_interval')
  }
  if (
    policy.dueReminderWorkingDaysBefore.length === 0
    || policy.dueReminderWorkingDaysBefore.some(
      (offset) => !Number.isInteger(offset) || offset < 0 || offset > 365
    )
  ) {
    issues.push('invalid_due_reminder_offset')
  }
  if (!Number.isFinite(policy.overdueCadenceHours) || policy.overdueCadenceHours <= 0) {
    issues.push('invalid_overdue_interval')
  }
  if (
    !Number.isInteger(policy.escalateAfterOverdueWorkingDays)
    || policy.escalateAfterOverdueWorkingDays < 0
    || !Number.isInteger(policy.escalateAfterUnansweredAttempts)
    || policy.escalateAfterUnansweredAttempts < 1
  ) {
    issues.push('invalid_escalation_limit')
  }
  if (
    !Number.isInteger(policy.fallbackAfterUnansweredAttempts)
    || policy.fallbackAfterUnansweredAttempts < 1
  ) {
    issues.push('invalid_fallback_limit')
  }
  if (
    !Number.isInteger(policy.pauseAfterUnansweredAttempts)
    || policy.pauseAfterUnansweredAttempts < policy.escalateAfterUnansweredAttempts
    || policy.pauseAfterUnansweredAttempts < policy.fallbackAfterUnansweredAttempts
  ) {
    issues.push('invalid_pause_limit')
  }
  if (
    !Number.isInteger(policy.maxOverdueRemindersBeforePause)
    || policy.maxOverdueRemindersBeforePause < 1
  ) {
    issues.push('invalid_overdue_pause_limit')
  }
  if (
    !Number.isFinite(policy.minimumExternalContactIntervalHours)
    || policy.minimumExternalContactIntervalHours <= 0
  ) {
    issues.push('invalid_contact_interval')
  }
  if (
    !Number.isFinite(policy.reviewReminderIntervalHours)
    || policy.reviewReminderIntervalHours <= 0
  ) {
    issues.push('invalid_review_interval')
  }
  return issues
}

export type TaskReminderActionKind =
  | 'assignment'
  | 'delivery_fallback'
  | 'status_check'
  | 'due_soon'
  | 'due_today'
  | 'overdue'
  | 'review_follow_up'
  | 'review_overdue'
  | 'deadline_change_request'
  | 'escalation'

export type TaskReminderReason =
  | 'initial_assignment'
  | 'primary_delivery_failed'
  | 'no_activity'
  | 'next_follow_up_due'
  | 'deadline_approaching'
  | 'deadline_today'
  | 'deadline_overdue'
  | 'review_due'
  | 'review_overdue'
  | 'deadline_change_requested'
  | 'unanswered_attempts'
  | 'external_follow_up_paused'
  | 'delivery_failed_without_fallback'
  | 'assignee_unavailable'

export type TaskReminderAction = {
  kind: TaskReminderActionKind
  reason: TaskReminderReason
  target: 'assignee' | 'creator'
  /** Null means that the creator's own notification preference should be resolved later. */
  channel: TaskCommunicationChannel | null
  scheduledFor: string
  idempotencyKey: string
  workingDaysBeforeDue?: number
}

export type TaskReminderEvaluationInput = {
  taskId: string
  status: TaskStatus
  now: TaskTimeValue
  assignedAt: TaskTimeValue | null
  dueAt: TaskTimeValue | null
  nextFollowUpAt: TaskTimeValue | null
  reviewDueAt?: TaskTimeValue | null
  pendingDeadlineRequestId?: string | null
  lastActivityAt?: TaskTimeValue | null
  lastAssigneeReminderAt?: TaskTimeValue | null
  lastCreatorReminderAt?: TaskTimeValue | null
  unansweredAttempts?: number
  overdueReminderCount?: number
  primaryChannel: TaskCommunicationChannel
  fallbackChannel?: TaskCommunicationChannel | null
  primaryDeliveryState?: TaskDeliveryState
  primaryDeliveryAttemptId?: string | null
  emittedIdempotencyKeys?: readonly string[]
  policy?: TaskReminderPolicy
  calendar?: TaskCalendarPolicy
  sendWindow?: TaskSendWindowPolicy
}

export type TaskReminderEvaluation = {
  actions: TaskReminderAction[]
  selectedExternalChannel: TaskCommunicationChannel
  externalFollowUpPaused: boolean
  /** Set only when recipient communication is held until the next allowed local time. */
  externalFollowUpDeferredUntil: string | null
  policyIssues: TaskReminderPolicyIssueCode[]
}

function canonicalKeyPart(value: string | number) {
  const normalized = String(value).trim().toLowerCase().replace(/\s+/g, ' ')
  return `${normalized.length}:${normalized}`
}

export function buildTaskPolicyIdempotencyKey(
  taskId: string,
  action: string,
  discriminator: string | number
) {
  return ['task-policy-v1', taskId, action, discriminator].map(canonicalKeyPart).join('|')
}

export function selectTaskReminderChannel(input: {
  primaryChannel: TaskCommunicationChannel
  fallbackChannel?: TaskCommunicationChannel | null
  primaryDeliveryState?: TaskDeliveryState
  unansweredAttempts?: number
  policy?: TaskReminderPolicy
}) {
  const policy = input.policy ?? DEFAULT_TASK_REMINDER_POLICY
  const shouldUseFallback =
    input.primaryDeliveryState === 'failed'
    || (input.unansweredAttempts ?? 0) >= policy.fallbackAfterUnansweredAttempts
  return shouldUseFallback && input.fallbackChannel
    ? input.fallbackChannel
    : input.primaryChannel
}

function intervalHasElapsed(
  now: number,
  previous: TaskTimeValue | null | undefined,
  intervalHours: number
) {
  const previousEpoch = taskTimeToEpoch(previous)
  return previousEpoch === null || now - previousEpoch >= intervalHours * HOUR_MS
}

function makeReminderAction(input: {
  taskId: string
  now: number
  kind: TaskReminderActionKind
  reason: TaskReminderReason
  target: 'assignee' | 'creator'
  channel: TaskCommunicationChannel | null
  discriminator: string | number
  workingDaysBeforeDue?: number
}): TaskReminderAction {
  return {
    kind: input.kind,
    reason: input.reason,
    target: input.target,
    channel: input.channel,
    scheduledFor: new Date(input.now).toISOString(),
    idempotencyKey: buildTaskPolicyIdempotencyKey(
      input.taskId,
      input.kind,
      input.discriminator
    ),
    ...(input.workingDaysBeforeDue === undefined
      ? {}
      : { workingDaysBeforeDue: input.workingDaysBeforeDue }),
  }
}

function currentDueReminderOffset(input: {
  now: number
  dueAt: number
  offsets: readonly number[]
  calendar: TaskCalendarPolicy
}) {
  const timeZone = calendarTimeZone(input.calendar)
  if (taskZonedDateKey(input.now, timeZone) === taskZonedDateKey(input.dueAt, timeZone)) {
    return input.offsets.includes(0) ? 0 : null
  }
  const offsets = [...new Set(input.offsets)]
    .filter((offset) => Number.isInteger(offset) && offset > 0)
    .sort((left, right) => left - right)
  return offsets.find((offset) => {
    const threshold = shiftTaskTimeByWorkingDays(input.dueAt, -offset, input.calendar)
    return threshold !== null && input.now >= threshold
  }) ?? null
}

/**
 * Produces at most one external reminder and one creator escalation per run.
 * Persist `idempotencyKey` with a unique constraint and feed the already emitted
 * keys back on retries for end-to-end idempotency.
 */
export function evaluateTaskReminders(
  input: TaskReminderEvaluationInput
): TaskReminderEvaluation {
  const policy = input.policy ?? DEFAULT_TASK_REMINDER_POLICY
  const calendar = input.calendar ?? DEFAULT_TASK_CALENDAR_POLICY
  const sendWindow = input.sendWindow ?? DEFAULT_TASK_SEND_WINDOW_POLICY
  const policyIssues = validateTaskReminderPolicy(policy, calendar, sendWindow)
  const now = taskTimeToEpoch(input.now)
  const emitted = new Set(input.emittedIdempotencyKeys ?? [])
  const actions: TaskReminderAction[] = []
  const unansweredAttempts = Math.max(0, input.unansweredAttempts ?? 0)
  const overdueReminderCount = Math.max(0, input.overdueReminderCount ?? 0)
  const selectedExternalChannel = selectTaskReminderChannel({
    primaryChannel: input.primaryChannel,
    fallbackChannel: input.fallbackChannel,
    primaryDeliveryState: input.primaryDeliveryState,
    unansweredAttempts,
    policy,
  })
  const externalFollowUpPaused =
    unansweredAttempts >= policy.pauseAfterUnansweredAttempts
    || overdueReminderCount >= policy.maxOverdueRemindersBeforePause
  let externalFollowUpDeferredUntil: string | null = null

  if (policyIssues.length > 0) {
    return {
      actions,
      selectedExternalChannel,
      externalFollowUpPaused: true,
      externalFollowUpDeferredUntil,
      policyIssues,
    }
  }

  if (now === null || input.status === 'draft' || isTerminalTaskStatus(input.status)) {
    return {
      actions,
      selectedExternalChannel,
      externalFollowUpPaused: false,
      externalFollowUpDeferredUntil,
      policyIssues,
    }
  }

  const addIfNew = (action: TaskReminderAction) => {
    if (!emitted.has(action.idempotencyKey)) {
      emitted.add(action.idempotencyKey)
      actions.push(action)
      return true
    }
    return false
  }
  const idempotencyDateKey = taskZonedDateKey(now, calendarTimeZone(calendar))
    ?? new Date(now).toISOString().slice(0, 10)
  const dueAt = taskTimeToEpoch(input.dueAt)
  const assignedAt = taskTimeToEpoch(input.assignedAt)
  const nextFollowUpAt = taskTimeToEpoch(input.nextFollowUpAt)
  const lastActivityAt = taskTimeToEpoch(input.lastActivityAt) ?? assignedAt
  // Evaluate first, then defer only when a real automatic action is due. This
  // avoids both night delivery and needlessly funneling every idle task into
  // the first morning worker batch.
  const finishEvaluation = (paused = externalFollowUpPaused): TaskReminderEvaluation => {
    const hasAutomaticAction = actions.some((action) => action.kind !== 'assignment')
    if (hasAutomaticAction && !isTaskSendTimeAllowed(now, sendWindow)) {
      actions.length = 0
      const nextAllowed = nextTaskSendWindowAt(now, sendWindow)
      externalFollowUpDeferredUntil = nextAllowed === null
        ? null
        : new Date(nextAllowed).toISOString()
    }
    return {
      actions,
      selectedExternalChannel,
      externalFollowUpPaused: paused,
      externalFollowUpDeferredUntil,
      policyIssues,
    }
  }

  // Initial assignment is the direct result of the issuer pressing send and is
  // therefore not treated as an automatic reminder. Any later policy-generated
  // delivery_fallback action is automatic and passes through finishEvaluation.
  const assignmentKey = assignedAt === null
    ? null
    : buildTaskPolicyIdempotencyKey(input.taskId, 'assignment', assignedAt)
  if (
    !input.pendingDeadlineRequestId
    && input.status === 'assigned'
    && assignedAt !== null
    && now >= assignedAt
    && (dueAt === null || now < dueAt)
    && input.primaryDeliveryState !== 'failed'
    && input.primaryDeliveryState !== 'pending'
    && !emitted.has(assignmentKey as string)
  ) {
    addIfNew(makeReminderAction({
      taskId: input.taskId,
      now,
      kind: 'assignment',
      reason: 'initial_assignment',
      target: 'assignee',
      channel: selectedExternalChannel,
      discriminator: assignedAt,
    }))
    return finishEvaluation()
  }

  if (input.pendingDeadlineRequestId) {
    if (intervalHasElapsed(now, input.lastCreatorReminderAt, policy.reviewReminderIntervalHours)) {
      addIfNew(makeReminderAction({
        taskId: input.taskId,
        now,
        kind: 'deadline_change_request',
        reason: 'deadline_change_requested',
        target: 'creator',
        channel: null,
        discriminator: input.pendingDeadlineRequestId,
      }))
    }
    return finishEvaluation(false)
  }

  if (input.status === 'ready_for_review') {
    const reviewDueAt = taskTimeToEpoch(input.reviewDueAt)
    const reviewFollowUpAt = taskTimeToEpoch(input.nextFollowUpAt)
    const reviewIsOverdue = reviewDueAt !== null && now >= reviewDueAt
    const reviewFollowUpIsDue = reviewFollowUpAt !== null && now >= reviewFollowUpAt
    if (
      (reviewIsOverdue || reviewFollowUpIsDue)
      && intervalHasElapsed(now, input.lastCreatorReminderAt, policy.reviewReminderIntervalHours)
    ) {
      addIfNew(makeReminderAction({
        taskId: input.taskId,
        now,
        kind: reviewIsOverdue ? 'review_overdue' : 'review_follow_up',
        reason: reviewIsOverdue ? 'review_overdue' : 'review_due',
        target: 'creator',
        channel: null,
        discriminator: idempotencyDateKey,
      }))
    }
    return finishEvaluation(false)
  }

  const overdueWorkingDays = dueAt === null
    ? 0
    : countTaskWorkingDaysAfter(dueAt, now, calendar)

  let escalationReason: TaskReminderReason | null = null
  let escalationDiscriminator = ''
  if (externalFollowUpPaused) {
    escalationReason = 'external_follow_up_paused'
    escalationDiscriminator = `paused:${dueAt ?? assignedAt ?? 'unknown'}`
  } else if (
    input.primaryDeliveryState === 'failed'
    && !input.fallbackChannel
  ) {
    escalationReason = 'delivery_failed_without_fallback'
    escalationDiscriminator = input.primaryDeliveryAttemptId ?? idempotencyDateKey
  } else if (unansweredAttempts >= policy.escalateAfterUnansweredAttempts) {
    escalationReason = 'unanswered_attempts'
    escalationDiscriminator = `unanswered:${assignedAt ?? 'unknown'}`
  } else if (
    dueAt !== null
    && now >= dueAt
    && overdueWorkingDays >= policy.escalateAfterOverdueWorkingDays
  ) {
    escalationReason = 'deadline_overdue'
    escalationDiscriminator = `overdue:${dueAt ?? 'unknown'}`
  }

  if (
    escalationReason
    && intervalHasElapsed(now, input.lastCreatorReminderAt, policy.reviewReminderIntervalHours)
  ) {
    addIfNew(makeReminderAction({
      taskId: input.taskId,
      now,
      kind: 'escalation',
      reason: escalationReason,
      target: 'creator',
      channel: null,
      discriminator: escalationDiscriminator,
    }))
  }

  if (
    input.primaryDeliveryState === 'failed'
    && input.fallbackChannel
    && input.primaryDeliveryAttemptId
  ) {
    const fallbackAdded = addIfNew(makeReminderAction({
      taskId: input.taskId,
      now,
      kind: 'delivery_fallback',
      reason: 'primary_delivery_failed',
      target: 'assignee',
      channel: input.fallbackChannel,
      discriminator: input.primaryDeliveryAttemptId,
    }))
    if (fallbackAdded) {
      return finishEvaluation()
    }
    if (taskTimeToEpoch(input.lastAssigneeReminderAt) === null) {
      return finishEvaluation()
    }
  }

  const externalReminderInterval = dueAt !== null && now >= dueAt
    ? Math.max(policy.minimumExternalContactIntervalHours, policy.overdueCadenceHours)
    : policy.minimumExternalContactIntervalHours
  if (
    externalFollowUpPaused
    || !intervalHasElapsed(
      now,
      input.lastAssigneeReminderAt,
      externalReminderInterval
    )
  ) {
    return finishEvaluation()
  }

  if (dueAt !== null && now >= dueAt) {
    addIfNew(makeReminderAction({
      taskId: input.taskId,
      now,
      kind: 'overdue',
      reason: 'deadline_overdue',
      target: 'assignee',
      channel: selectedExternalChannel,
      discriminator: idempotencyDateKey,
    }))
    return finishEvaluation()
  }

  if (dueAt !== null) {
    const offset = currentDueReminderOffset({
      now,
      dueAt,
      offsets: policy.dueReminderWorkingDaysBefore,
      calendar,
    })
    if (offset !== null) {
      addIfNew(makeReminderAction({
        taskId: input.taskId,
        now,
        kind: offset === 0 ? 'due_today' : 'due_soon',
        reason: offset === 0 ? 'deadline_today' : 'deadline_approaching',
        target: 'assignee',
        channel: selectedExternalChannel,
        discriminator: `${offset}:${dueAt}`,
        workingDaysBeforeDue: offset,
      }))
      return finishEvaluation()
    }
  }

  const noActivityDue =
    nextFollowUpAt === null
    && lastActivityAt !== null
    && now - lastActivityAt >= policy.noActivityAfterHours * HOUR_MS
  const plannedFollowUpDue = nextFollowUpAt !== null && now >= nextFollowUpAt
  if (plannedFollowUpDue || noActivityDue) {
    addIfNew(makeReminderAction({
      taskId: input.taskId,
      now,
      kind: 'status_check',
      reason: plannedFollowUpDue ? 'next_follow_up_due' : 'no_activity',
      target: 'assignee',
      channel: selectedExternalChannel,
      discriminator: idempotencyDateKey,
    }))
  }

  return finishEvaluation()
}

export type TaskAutomationLimits = {
  maxAiDepth: number
  maxOpenChildrenPerTask: number
  maxActiveDescendantsPerRoot: number
  maxPendingProposalsPerRoot: number
  maxProposalBatchSize: number
  maxRepeatedQuestionAttempts: number
  maxReviewCyclesBeforeEscalation: number
  unchangedExpiredProposalSuppressionDays: number
  onlyNextTemplateStep: boolean
}

/** This ceiling cannot be raised through organization settings. */
export const TASK_AUTOMATION_HARD_MAX_DEPTH = 4

export const DEFAULT_TASK_AUTOMATION_LIMITS: TaskAutomationLimits = Object.freeze({
  maxAiDepth: 2,
  maxOpenChildrenPerTask: 5,
  maxActiveDescendantsPerRoot: 15,
  maxPendingProposalsPerRoot: 3,
  maxProposalBatchSize: 3,
  maxRepeatedQuestionAttempts: 3,
  maxReviewCyclesBeforeEscalation: 3,
  unchangedExpiredProposalSuppressionDays: 30,
  onlyNextTemplateStep: true,
})

export function isValidTaskAutomationLimits(limits: TaskAutomationLimits) {
  return (
    Number.isInteger(limits.maxAiDepth)
    && limits.maxAiDepth >= 0
    && limits.maxAiDepth <= TASK_AUTOMATION_HARD_MAX_DEPTH
    && Number.isInteger(limits.maxOpenChildrenPerTask)
    && limits.maxOpenChildrenPerTask >= 1
    && Number.isInteger(limits.maxActiveDescendantsPerRoot)
    && limits.maxActiveDescendantsPerRoot >= 1
    && Number.isInteger(limits.maxPendingProposalsPerRoot)
    && limits.maxPendingProposalsPerRoot >= 1
    && Number.isInteger(limits.maxProposalBatchSize)
    && limits.maxProposalBatchSize >= 1
    && Number.isInteger(limits.maxRepeatedQuestionAttempts)
    && limits.maxRepeatedQuestionAttempts >= 1
    && Number.isInteger(limits.maxReviewCyclesBeforeEscalation)
    && limits.maxReviewCyclesBeforeEscalation >= 1
    && Number.isInteger(limits.unchangedExpiredProposalSuppressionDays)
    && limits.unchangedExpiredProposalSuppressionDays >= 0
  )
}

export type TaskProposalState = 'none' | 'pending' | 'accepted' | 'rejected' | 'expired'
export type EquivalentTaskState = 'none' | 'active' | 'completed'
export type TaskProposalParentKind = 'task' | 'checkpoint' | 'proposal' | 'message'

export type TaskProposalBlockReason =
  | 'non_task_parent'
  | 'ai_expansion_disabled'
  | 'maximum_depth_reached'
  | 'maximum_open_children_reached'
  | 'maximum_active_descendants_reached'
  | 'maximum_pending_proposals_reached'
  | 'maximum_batch_size_reached'
  | 'template_step_not_next'
  | 'template_step_already_used'
  | 'equivalent_task_exists'
  | 'equivalent_task_already_completed'
  | 'equivalent_proposal_pending'
  | 'equivalent_proposal_accepted'
  | 'rejected_proposal_facts_unchanged'
  | 'expired_proposal_facts_unchanged'
  | 'invalid_limit'
  | 'invalid_counter'

export type TaskProposalEvaluationInput = {
  parentKind: TaskProposalParentKind
  parentDepth: number
  aiExpansionAllowed: boolean
  openChildCount: number
  activeDescendantCount: number
  pendingProposalCount: number
  currentProposalBatchSize: number
  isNextTemplateStep: boolean
  templateStepAlreadyUsed: boolean
  equivalentTaskState: EquivalentTaskState
  equivalentProposalState: TaskProposalState
  factsMateriallyChanged: boolean
  now?: TaskTimeValue
  equivalentProposalAt?: TaskTimeValue | null
  limits?: TaskAutomationLimits
}

export type TaskProposalDecision = {
  allowed: boolean
  proposedDepth: number
  reasons: TaskProposalBlockReason[]
}

export function evaluateTaskProposal(
  input: TaskProposalEvaluationInput
): TaskProposalDecision {
  const limits = input.limits ?? DEFAULT_TASK_AUTOMATION_LIMITS
  const reasons: TaskProposalBlockReason[] = []
  const proposedDepth = input.parentDepth + 1
  const counters = [
    input.parentDepth,
    input.openChildCount,
    input.activeDescendantCount,
    input.pendingProposalCount,
    input.currentProposalBatchSize,
  ]

  if (!isValidTaskAutomationLimits(limits)) reasons.push('invalid_limit')
  if (!counters.every(isNonNegativeInteger)) reasons.push('invalid_counter')
  if (input.parentKind !== 'task') reasons.push('non_task_parent')
  if (!input.aiExpansionAllowed) reasons.push('ai_expansion_disabled')
  if (proposedDepth > Math.min(limits.maxAiDepth, TASK_AUTOMATION_HARD_MAX_DEPTH)) {
    reasons.push('maximum_depth_reached')
  }
  if (input.openChildCount >= limits.maxOpenChildrenPerTask) {
    reasons.push('maximum_open_children_reached')
  }
  if (input.activeDescendantCount >= limits.maxActiveDescendantsPerRoot) {
    reasons.push('maximum_active_descendants_reached')
  }
  if (input.pendingProposalCount >= limits.maxPendingProposalsPerRoot) {
    reasons.push('maximum_pending_proposals_reached')
  }
  if (input.currentProposalBatchSize >= limits.maxProposalBatchSize) {
    reasons.push('maximum_batch_size_reached')
  }
  if (limits.onlyNextTemplateStep && !input.isNextTemplateStep) {
    reasons.push('template_step_not_next')
  }
  if (input.templateStepAlreadyUsed) reasons.push('template_step_already_used')
  if (input.equivalentTaskState === 'active') reasons.push('equivalent_task_exists')
  if (input.equivalentTaskState === 'completed') {
    reasons.push('equivalent_task_already_completed')
  }
  if (input.equivalentProposalState === 'pending') {
    reasons.push('equivalent_proposal_pending')
  }
  if (input.equivalentProposalState === 'accepted') {
    reasons.push('equivalent_proposal_accepted')
  }
  if (input.equivalentProposalState === 'rejected' && !input.factsMateriallyChanged) {
    reasons.push('rejected_proposal_facts_unchanged')
  }
  if (input.equivalentProposalState === 'expired' && !input.factsMateriallyChanged) {
    const now = taskTimeToEpoch(input.now)
    const proposalAt = taskTimeToEpoch(input.equivalentProposalAt)
    const suppressionMs = limits.unchangedExpiredProposalSuppressionDays * DAY_MS
    if (
      now === null
      || proposalAt === null
      || now - proposalAt < suppressionMs
    ) {
      reasons.push('expired_proposal_facts_unchanged')
    }
  }

  return { allowed: reasons.length === 0, proposedDepth, reasons }
}

export type TaskProposalFingerprintInput = {
  rootTaskId: string
  parentTaskId: string
  workflowTemplateVersion: string | number
  templateStepKey: string
  assigneeKey?: string | null
  scopeKey?: string | null
}

/**
 * A stable canonical value suitable for hashing or a unique database key.
 * It deliberately excludes changing prose so rewording cannot bypass deduplication.
 */
export function buildTaskProposalFingerprint(input: TaskProposalFingerprintInput) {
  return [
    'task-proposal-v1',
    input.rootTaskId,
    input.parentTaskId,
    input.workflowTemplateVersion,
    input.templateStepKey,
    input.assigneeKey ?? '',
    input.scopeKey ?? '',
  ].map(canonicalKeyPart).join('|')
}

export function buildSigneDecisionIdempotencyKey(input: {
  taskId: string
  triggerEventId: string
  policyVersion: string | number
}) {
  return [
    'signe-decision-v1',
    input.taskId,
    input.triggerEventId,
    input.policyVersion,
  ].map(canonicalKeyPart).join('|')
}

export function shouldEscalateRepeatedQuestion(
  attempts: number,
  limits: TaskAutomationLimits = DEFAULT_TASK_AUTOMATION_LIMITS
) {
  return Number.isInteger(attempts) && attempts >= limits.maxRepeatedQuestionAttempts
}

export function shouldEscalateReviewCycles(
  reviewCycles: number,
  limits: TaskAutomationLimits = DEFAULT_TASK_AUTOMATION_LIMITS
) {
  return Number.isInteger(reviewCycles) && reviewCycles >= limits.maxReviewCyclesBeforeEscalation
}
