import { createHash, randomUUID } from 'node:crypto'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  buildTaskPolicyIdempotencyKey,
  DEFAULT_TASK_CALENDAR_POLICY,
  DEFAULT_TASK_REMINDER_POLICY,
  evaluateTaskReminders,
  isValidTaskSendWindowPolicy,
  isValidTaskTimeZone,
  type TaskCalendarPolicy,
  type TaskCommunicationChannel,
  type TaskDeliveryState,
  type TaskReminderAction,
  type TaskReminderPolicy,
  type TaskSendWindowPolicy,
} from '@/lib/tasks/domain'
import type { TaskStatus } from '@/lib/tasks/contracts'
import { formatTaskDateTime } from '@/lib/tasks/dateTime'
import {
  buildTaskEmailHtml,
  buildTaskReminderDigestEmailHtml,
  type TaskReminderDigestEmailItem,
} from '@/lib/tasks/emailTemplates'
import { hasInternalTaskModuleAccess } from '@/lib/tasks/internalAccess'
import { taskActorDisplayName } from '@/lib/tasks/branding'
import { issueDirectTaskAccessLink } from '@/lib/tasks/recipientAuth'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>
type PersistedTaskCommunicationChannel = TaskCommunicationChannel | 'in_app'
type TaskNotificationProvider = 'resend' | 'meta_whatsapp' | 'hushub'
type TaskNotificationTarget = 'creator' | 'assignee'
type TaskNotificationRecipientKind = 'profile' | 'contact'
type TaskNotificationJobPhase = 'deliver' | 'reconcile'

type TaskReminderDigestBatchStatus =
  | 'queued'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'ambiguous'
  | 'cancelled'
  | 'dead_letter'

type TaskReminderDigestItemStatus =
  | 'pending'
  | 'processing'
  | 'sent'
  | 'cancelled'

type AutomationJob = {
  id: string
  org_id: string
  task_id: string
  message_id: string | null
  delivery_id: string | null
  job_type: string
  attempt_count: number
  max_attempts: number
  available_at: string
  payload: Record<string, unknown>
}

type TaskReminderDigestBatch = {
  id: string
  org_id: string
  recipient_kind: TaskNotificationRecipientKind
  recipient_id: string
  recipient_address: string
  channel: 'email'
  status: TaskReminderDigestBatchStatus
  scheduled_at: string
  attempt_count: number
  max_attempts: number
  idempotency_key: string
  provider_payload: Record<string, unknown>
}

type TaskReminderDigestItem = {
  id: string
  batch_id: string
  org_id: string
  task_id: string
  task_version: number
  target: TaskNotificationTarget
  action_kind: TaskReminderAction['kind']
  reason: TaskReminderAction['reason']
  policy_action_idempotency_key: string
  body_text: string
  status: TaskReminderDigestItemStatus
  created_at: string
}

type OperationalTask = {
  id: string
  org_id: string
  root_task_id: string
  issuer_profile_id: string
  assignee_profile_id: string | null
  assignee_contact_id: string | null
  title: string
  description: string | null
  context_label: string | null
  status: TaskStatus
  due_at: string
  due_timezone: string
  next_followup_at: string
  primary_channel: PersistedTaskCommunicationChannel
  fallback_channel: PersistedTaskCommunicationChannel | null
  last_activity_at: string
  submitted_for_review_at: string | null
  created_at: string
  version: number
  archived_at: string | null
}

type DigestOperationalTask = OperationalTask & {
  parent_task_id: string | null
  depth: number
}

type ExternallyRoutableOperationalTask = OperationalTask & {
  primary_channel: TaskCommunicationChannel
  fallback_channel: TaskCommunicationChannel | null
}

type TaskFollowupRule = {
  unacknowledged_after_hours: number
  reminder_offsets_hours: unknown
  overdue_interval_hours: number
  escalate_after_overdue_hours: number
  fallback_after_hours: number
  max_reminders: number
  is_active: boolean
}

type TaskOrganizationSchedule = {
  calendar: TaskCalendarPolicy
  sendWindow: TaskSendWindowPolicy
}

type Profile = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
}

type Contact = {
  id: string
  name: string
  email: string | null
  phone: string | null
  whatsapp_number: string | null
}

type StoredMessage = {
  id: string
  created_at: string
  message_type: string
  metadata: Record<string, unknown> | null
}

type StoredDelivery = {
  id: string
  message_id: string
  channel: 'email' | 'whatsapp' | 'in_app'
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'cancelled' | 'ambiguous'
  is_fallback: boolean
  attempt_count: number
  max_attempts: number
  idempotency_key: string
  sent_at: string | null
  created_at: string
}

type Recipient = {
  kind: 'profile' | 'contact'
  id: string
  name: string
  email: string | null
  whatsappNumber: string | null
}

type TaskHistory = {
  emittedKeys: string[]
  lastAssigneeReminderAt: string | null
  lastCreatorReminderAt: string | null
  unansweredAttempts: number
  overdueReminderCount: number
  primaryDeliveryState: TaskDeliveryState
  primaryDeliveryAttemptId: string | null
  totalAssigneeReminders: number
  unresolvedDeliveryIds: string[]
  exhaustedFallbackDeliveryId: string | null
}

type DeliveryResult = {
  delivered: boolean
  ambiguous: boolean
  deliveryId: string
  messageId: string
  errorCode: string | null
}

const TASK_NOTIFICATION_EVENT_TYPES = [
  'comment',
  'deadline_change_requested',
  'deadline_change_approved',
  'deadline_change_rejected',
  'status_changed',
] as const

const TASK_REMINDER_DIGEST_ACTION_KINDS: readonly TaskReminderAction['kind'][] = [
  'status_check',
  'due_soon',
  'due_today',
  'overdue',
  'review_follow_up',
  'review_overdue',
  'deadline_change_request',
  'escalation',
]

const TASK_REMINDER_REASONS: readonly TaskReminderAction['reason'][] = [
  'initial_assignment',
  'primary_delivery_failed',
  'no_activity',
  'next_follow_up_due',
  'deadline_approaching',
  'deadline_today',
  'deadline_overdue',
  'review_due',
  'review_overdue',
  'deadline_change_requested',
  'unanswered_attempts',
  'external_follow_up_paused',
  'delivery_failed_without_fallback',
  'assignee_unavailable',
]

type TaskNotificationEventType = (typeof TASK_NOTIFICATION_EVENT_TYPES)[number]

type TaskNotificationEvent = {
  id: string
  org_id: string
  task_id: string
  event_type: TaskNotificationEventType
  actor_type: string
  actor_profile_id: string | null
  actor_contact_id: string | null
  actor_name: string
  message: string | null
  from_status: TaskStatus | null
  to_status: TaskStatus | null
  metadata: Record<string, unknown>
  created_at: string
}

type TaskNotificationJobRecipient = {
  target: TaskNotificationTarget
  recipientKind: TaskNotificationRecipientKind
  recipientId: string
}

type ReconciledTaskNotificationDelivery = {
  id: string
  messageId: string
  sourceEventId: string
  channel: TaskCommunicationChannel
  provider: Exclude<TaskNotificationProvider, 'hushub'>
  status: StoredDelivery['status']
  isFallback: boolean
  accountActivation: boolean
  recipientKind: TaskNotificationRecipientKind
  recipientId: string
  attemptCount: number
  reconciliationRetryForAttempt: number | null
}

type PreparedTaskNotificationDelivery = {
  skipped: false
  target: 'creator' | 'assignee'
  deliveryId: string
  messageId: string
  recipientKind: 'profile' | 'contact'
  recipientId: string
  recipientName: string
  recipientAddress: string
  channel: PersistedTaskCommunicationChannel
  provider: TaskNotificationProvider
  status: StoredDelivery['status']
  idempotencyKey: string
}

type SkippedTaskNotificationDelivery = {
  skipped: true
  reason: string
  eventId: string
  taskId: string | null
}

type TaskNotificationDeliveryPreparation =
  | PreparedTaskNotificationDelivery
  | SkippedTaskNotificationDelivery

export type TaskAutomationBatchResult = {
  claimed: number
  completed: number
  stale: number
  failed: number
}

export type TaskReminderDigestBatchResult = {
  claimed: number
  sent: number
  cancelled: number
  ambiguous: number
  failed: number
  deadLetter: number
}

class TaskAutomationError extends Error {
  readonly code: string

  constructor(code: string) {
    super(code)
    this.name = 'TaskAutomationError'
    this.code = code
  }
}

const TERMINAL_STATUSES = new Set<TaskStatus>(['approved', 'cancelled'])
const BENIGN_TASK_NOTIFICATION_SKIP_REASONS = new Set([
  'self_recipient',
  'task_unavailable',
  'event_not_notifiable',
  'legacy_delivery_exists',
  'legacy_delivery_unresolved',
])
const SUCCESSFUL_DELIVERY_STATUSES = new Set<StoredDelivery['status']>([
  'sent',
  'delivered',
  'read',
  'replied',
])
const DEFAULT_BATCH_LIMIT = 4
const MAX_BATCH_LIMIT = 4
const DEFAULT_DIGEST_BATCH_LIMIT = 1
const MAX_DIGEST_BATCH_LIMIT = 4
const DEFAULT_RECHECK_MINUTES = 60
const MIN_RECHECK_MINUTES = 15
const MAX_RECHECK_MINUTES = 24 * 60
// Supabase dispatches the durable queue every five minutes. Ordinary periodic
// evaluations stay 15-60 minutes apart, while explicit due/follow-up instants
// and the next permitted send-window start are queued at their exact timestamp.

function automationError(code: string): TaskAutomationError {
  return new TaskAutomationError(code)
}

function safeErrorCode(error: unknown) {
  if (error instanceof TaskAutomationError) return error.code
  return 'TASK_AUTOMATION_INTERNAL_ERROR'
}

const AMBIGUOUS_TASK_DELIVERY_ERROR_CODES = new Set([
  'TASK_EMAIL_PROVIDER_TIMEOUT',
  'TASK_EMAIL_PROVIDER_UNAVAILABLE',
  'TASK_EMAIL_PROVIDER_SERVER_ERROR',
  'TASK_EMAIL_PROVIDER_INVALID_RESPONSE',
  'TASK_EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT',
  'TASK_WHATSAPP_PROVIDER_TIMEOUT',
  'TASK_WHATSAPP_PROVIDER_UNAVAILABLE',
  'TASK_WHATSAPP_PROVIDER_SERVER_ERROR',
  'TASK_WHATSAPP_PROVIDER_INVALID_RESPONSE',
])

export function isAmbiguousTaskDeliveryError(error: unknown) {
  const code = error instanceof TaskAutomationError
    ? error.code
    : error instanceof Error
      ? error.message
      : ''
  return AMBIGUOUS_TASK_DELIVERY_ERROR_CODES.has(code)
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

export function getTaskAutomationBatchLimit() {
  return normalizeInteger(
    process.env.TASK_AUTOMATION_BATCH_LIMIT,
    DEFAULT_BATCH_LIMIT,
    1,
    MAX_BATCH_LIMIT
  )
}

function isTaskStatus(value: unknown): value is TaskStatus {
  return [
    'draft',
    'assigned',
    'in_progress',
    'waiting',
    'ready_for_review',
    'returned',
    'approved',
    'cancelled',
  ].includes(String(value))
}

function isCommunicationChannel(value: unknown): value is TaskCommunicationChannel {
  return value === 'email' || value === 'whatsapp'
}

function isPersistedTaskCommunicationChannel(
  value: unknown
): value is PersistedTaskCommunicationChannel {
  return isCommunicationChannel(value) || value === 'in_app'
}

function isTaskReminderActionKind(value: unknown): value is TaskReminderAction['kind'] {
  return [
    'assignment',
    'delivery_fallback',
    ...TASK_REMINDER_DIGEST_ACTION_KINDS,
  ].includes(value as TaskReminderAction['kind'])
}

function isTaskReminderReason(value: unknown): value is TaskReminderAction['reason'] {
  return TASK_REMINDER_REASONS.includes(value as TaskReminderAction['reason'])
}

function isDigestibleEmailReminder(action: TaskReminderAction, channel: TaskCommunicationChannel) {
  return channel === 'email'
    && TASK_REMINDER_DIGEST_ACTION_KINDS.includes(action.kind)
    && action.reason !== 'delivery_failed_without_fallback'
    && action.reason !== 'assignee_unavailable'
    && action.reason !== 'external_follow_up_paused'
}

function hasExternalTaskChannels(
  task: OperationalTask
): task is ExternallyRoutableOperationalTask {
  return isCommunicationChannel(task.primary_channel)
    && (task.fallback_channel === null || isCommunicationChannel(task.fallback_channel))
}

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function isTaskNotificationEventType(value: unknown): value is TaskNotificationEventType {
  return TASK_NOTIFICATION_EVENT_TYPES.includes(value as TaskNotificationEventType)
}

function isTaskDeliveryStatus(value: unknown): value is StoredDelivery['status'] {
  return [
    'queued',
    'sending',
    'sent',
    'delivered',
    'read',
    'replied',
    'failed',
    'cancelled',
    'ambiguous',
  ].includes(String(value))
}

function isTaskNotificationProviderForChannel(
  provider: unknown,
  channel: unknown
): provider is TaskNotificationProvider {
  return (channel === 'email' && provider === 'resend')
    || (channel === 'whatsapp' && provider === 'meta_whatsapp')
    || (channel === 'in_app' && provider === 'hushub')
}

function parseTaskNotificationEvent(value: unknown): TaskNotificationEvent | null {
  const row = toObject(value)
  if (
    typeof row.id !== 'string'
    || typeof row.org_id !== 'string'
    || typeof row.task_id !== 'string'
    || !isTaskNotificationEventType(row.event_type)
    || typeof row.actor_type !== 'string'
    || typeof row.created_at !== 'string'
  ) {
    return null
  }
  return {
    id: row.id,
    org_id: row.org_id,
    task_id: row.task_id,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_profile_id: typeof row.actor_profile_id === 'string' ? row.actor_profile_id : null,
    actor_contact_id: typeof row.actor_contact_id === 'string' ? row.actor_contact_id : null,
    actor_name: taskActorDisplayName(optionalString(row.actor_name), 'HusHub', row.actor_type),
    message: optionalString(row.message),
    from_status: isTaskStatus(row.from_status) ? row.from_status : null,
    to_status: isTaskStatus(row.to_status) ? row.to_status : null,
    metadata: toObject(row.metadata),
    created_at: row.created_at,
  }
}

function parsePreparedTaskNotificationDelivery(
  value: unknown
): TaskNotificationDeliveryPreparation | null {
  const row = toObject(value)
  if (row.skipped === true) {
    if (typeof row.reason !== 'string' || typeof row.eventId !== 'string') return null
    return {
      skipped: true,
      reason: row.reason,
      eventId: row.eventId,
      taskId: typeof row.taskId === 'string' ? row.taskId : null,
    }
  }
  const channel = row.channel
  const provider = row.provider
  if (
    row.skipped !== false
    || (row.target !== 'creator' && row.target !== 'assignee')
    || typeof row.deliveryId !== 'string'
    || typeof row.messageId !== 'string'
    || (row.recipientKind !== 'profile' && row.recipientKind !== 'contact')
    || typeof row.recipientId !== 'string'
    || typeof row.recipientName !== 'string'
    || typeof row.recipientAddress !== 'string'
    || !isPersistedTaskCommunicationChannel(channel)
    || !isTaskNotificationProviderForChannel(provider, channel)
    || !isTaskDeliveryStatus(row.status)
    || typeof row.idempotencyKey !== 'string'
  ) {
    return null
  }
  return {
    skipped: false,
    target: row.target,
    deliveryId: row.deliveryId,
    messageId: row.messageId,
    recipientKind: row.recipientKind,
    recipientId: row.recipientId,
    recipientName: row.recipientName,
    recipientAddress: row.recipientAddress,
    channel,
    provider,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
  }
}

function parseAutomationJob(value: unknown): AutomationJob | null {
  const row = toObject(value)
  const payload = toObject(row.payload)
  if (
    typeof row.id !== 'string'
    || typeof row.org_id !== 'string'
    || typeof row.task_id !== 'string'
    || typeof row.job_type !== 'string'
    || typeof row.available_at !== 'string'
  ) {
    return null
  }
  return {
    id: row.id,
    org_id: row.org_id,
    task_id: row.task_id,
    message_id: typeof row.message_id === 'string' ? row.message_id : null,
    delivery_id: typeof row.delivery_id === 'string' ? row.delivery_id : null,
    job_type: row.job_type,
    attempt_count: normalizeInteger(row.attempt_count, 1, 0, 20),
    max_attempts: normalizeInteger(row.max_attempts, 5, 1, 20),
    available_at: row.available_at,
    payload,
  }
}

function parseTaskReminderDigestBatch(value: unknown): TaskReminderDigestBatch | null {
  const row = toObject(value)
  const status = optionalString(row.status)
  const recipientKind = optionalString(row.recipient_kind)
  const recipientId = recipientKind === 'profile'
    ? optionalString(row.recipient_profile_id)
    : recipientKind === 'contact'
      ? optionalString(row.recipient_contact_id)
      : null
  if (
    typeof row.id !== 'string'
    || typeof row.org_id !== 'string'
    || (recipientKind !== 'profile' && recipientKind !== 'contact')
    || !recipientId
    || typeof row.recipient_address !== 'string'
    || row.channel !== 'email'
    || !status
    || ![
      'queued',
      'processing',
      'sent',
      'failed',
      'ambiguous',
      'cancelled',
      'dead_letter',
    ].includes(status)
    || typeof row.scheduled_at !== 'string'
    || typeof row.idempotency_key !== 'string'
  ) return null
  return {
    id: row.id,
    org_id: row.org_id,
    recipient_kind: recipientKind,
    recipient_id: recipientId,
    recipient_address: row.recipient_address.trim().toLowerCase(),
    channel: 'email',
    status: status as TaskReminderDigestBatchStatus,
    scheduled_at: row.scheduled_at,
    attempt_count: normalizeInteger(row.attempt_count, 1, 0, 20),
    max_attempts: normalizeInteger(row.max_attempts, 5, 1, 20),
    idempotency_key: row.idempotency_key,
    provider_payload: toObject(row.provider_payload),
  }
}

function parseTaskReminderDigestItem(value: unknown): TaskReminderDigestItem | null {
  const row = toObject(value)
  const target = optionalString(row.target)
  const status = optionalString(row.status)
  if (
    typeof row.id !== 'string'
    || typeof row.batch_id !== 'string'
    || typeof row.org_id !== 'string'
    || typeof row.task_id !== 'string'
    || !Number.isInteger(Number(row.task_version))
    || (target !== 'creator' && target !== 'assignee')
    || !isTaskReminderActionKind(row.action_kind)
    || !isTaskReminderReason(row.reason)
    || typeof row.policy_action_idempotency_key !== 'string'
    || typeof row.body_text !== 'string'
    || !status
    || !['pending', 'processing', 'sent', 'cancelled'].includes(status)
    || typeof row.created_at !== 'string'
  ) return null
  return {
    id: row.id,
    batch_id: row.batch_id,
    org_id: row.org_id,
    task_id: row.task_id,
    task_version: Number(row.task_version),
    target,
    action_kind: row.action_kind,
    reason: row.reason,
    policy_action_idempotency_key: row.policy_action_idempotency_key,
    body_text: row.body_text,
    status: status as TaskReminderDigestItemStatus,
    created_at: row.created_at,
  }
}

function expectedTaskVersion(job: AutomationJob) {
  const version = Number(job.payload.taskVersion)
  return Number.isInteger(version) && version > 0 ? version : null
}

function notificationEventId(job: AutomationJob) {
  const eventId = optionalString(job.payload.notificationEventId)
  const phase = notificationJobPhase(job)
  return eventId && phase ? eventId : null
}

function notificationJobPhase(job: AutomationJob): TaskNotificationJobPhase | null {
  const phase = optionalString(job.payload.phase)
  return phase === 'deliver' || phase === 'reconcile' ? phase : null
}

function notificationJobRecipient(job: AutomationJob): TaskNotificationJobRecipient | null {
  const target = optionalString(job.payload.target)
  const recipientKind = optionalString(job.payload.recipientKind)
  const recipientId = optionalString(job.payload.recipientId)
  if (
    (target !== 'creator' && target !== 'assignee')
    || (recipientKind !== 'profile' && recipientKind !== 'contact')
    || !recipientId
  ) return null
  return { target, recipientKind, recipientId }
}

function parseOperationalTask(value: unknown): OperationalTask | null {
  const row = toObject(value)
  if (
    typeof row.id !== 'string'
    || typeof row.org_id !== 'string'
    || typeof row.root_task_id !== 'string'
    || typeof row.issuer_profile_id !== 'string'
    || typeof row.title !== 'string'
    || typeof row.due_at !== 'string'
    || typeof row.due_timezone !== 'string'
    || typeof row.next_followup_at !== 'string'
    || typeof row.last_activity_at !== 'string'
    || typeof row.created_at !== 'string'
    || !isTaskStatus(row.status)
    || !isPersistedTaskCommunicationChannel(row.primary_channel)
  ) {
    return null
  }
  const version = Number(row.version)
  if (!Number.isInteger(version) || version < 1) return null
  return {
    id: row.id,
    org_id: row.org_id,
    root_task_id: row.root_task_id,
    issuer_profile_id: row.issuer_profile_id,
    assignee_profile_id: typeof row.assignee_profile_id === 'string' ? row.assignee_profile_id : null,
    assignee_contact_id: typeof row.assignee_contact_id === 'string' ? row.assignee_contact_id : null,
    title: row.title,
    description: typeof row.description === 'string' ? row.description : null,
    context_label: typeof row.context_label === 'string' ? row.context_label : null,
    status: row.status,
    due_at: row.due_at,
    due_timezone: row.due_timezone,
    next_followup_at: row.next_followup_at,
    primary_channel: row.primary_channel,
    fallback_channel: isPersistedTaskCommunicationChannel(row.fallback_channel)
      ? row.fallback_channel
      : null,
    last_activity_at: row.last_activity_at,
    submitted_for_review_at: typeof row.submitted_for_review_at === 'string'
      ? row.submitted_for_review_at
      : null,
    created_at: row.created_at,
    version,
    archived_at: typeof row.archived_at === 'string' ? row.archived_at : null,
  }
}

function parseDigestOperationalTask(value: unknown): DigestOperationalTask | null {
  const task = parseOperationalTask(value)
  const row = toObject(value)
  const depth = Number(row.depth)
  if (!task || !Number.isInteger(depth) || depth < 0) return null
  return {
    ...task,
    parent_task_id: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
    depth,
  }
}

async function loadTask(admin: AdminClient, job: AutomationJob) {
  const { data, error } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,status,due_at,due_timezone,next_followup_at,primary_channel,fallback_channel,last_activity_at,submitted_for_review_at,created_at,version,archived_at'
    )
    .eq('id', job.task_id)
    .eq('org_id', job.org_id)
    .maybeSingle()
  if (error) throw automationError('TASK_AUTOMATION_TASK_READ_FAILED')
  if (!data) return null
  const task = parseOperationalTask(data)
  if (!task) throw automationError('TASK_AUTOMATION_TASK_INVALID')
  return task
}

async function loadPendingDeadlineRequestId(admin: AdminClient, task: OperationalTask) {
  const { data, error } = await admin
    .from('task_deadline_change_requests')
    .select('id')
    .eq('org_id', task.org_id)
    .eq('task_id', task.id)
    .eq('status', 'pending')
    .limit(1)
    .maybeSingle()
  if (error) throw automationError('TASK_DEADLINE_REQUEST_READ_FAILED')
  return data && typeof data.id === 'string' ? data.id : null
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

async function loadProfile(admin: AdminClient, orgId: string, id: string): Promise<Profile | null> {
  const { data: membership, error: membershipError } = await admin
    .from('org_members')
    .select('profile_id')
    .eq('org_id', orgId)
    .eq('profile_id', id)
    .eq('is_active', true)
    .maybeSingle()
  if (membershipError) throw automationError('TASK_AUTOMATION_MEMBERSHIP_READ_FAILED')
  if (!membership) return null
  let { data, error } = await admin
    .from('profiles')
    .select('id,full_name,email,phone')
    .eq('id', id)
    .maybeSingle()
  // Some older environments have not added the optional profile phone field.
  // Email reminders must continue to work there.
  if (error) {
    const fallback = await admin
      .from('profiles')
      .select('id,full_name,email')
      .eq('id', id)
      .maybeSingle()
    data = fallback.data ? { ...fallback.data, phone: null } : null
    error = fallback.error
  }
  if (error) throw automationError('TASK_AUTOMATION_PROFILE_READ_FAILED')
  if (!data || typeof data.id !== 'string') return null
  return {
    id: data.id,
    full_name: optionalString(data.full_name),
    email: optionalString(data.email),
    phone: optionalString(data.phone),
  }
}

async function loadContact(admin: AdminClient, orgId: string, id: string): Promise<Contact | null> {
  const { data, error } = await admin
    .from('organization_contacts')
    .select('id,name,email,phone,whatsapp_number')
    .eq('id', id)
    .eq('org_id', orgId)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw automationError('TASK_AUTOMATION_CONTACT_READ_FAILED')
  if (!data || typeof data.id !== 'string' || typeof data.name !== 'string') return null
  return {
    id: data.id,
    name: data.name,
    email: optionalString(data.email),
    phone: optionalString(data.phone),
    whatsapp_number: optionalString(data.whatsapp_number),
  }
}

async function loadActiveOrgAdmin(admin: AdminClient, orgId: string) {
  const { data, error } = await admin
    .from('org_members')
    .select('profile_id')
    .eq('org_id', orgId)
    .eq('role', 'admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()
  if (error) throw automationError('TASK_AUTOMATION_ADMIN_READ_FAILED')
  return data && typeof data.profile_id === 'string'
    ? loadProfile(admin, orgId, data.profile_id)
    : null
}

async function loadRecipients(admin: AdminClient, task: OperationalTask) {
  const [taskIssuer, assigneeProfile, assigneeContact] = await Promise.all([
    loadProfile(admin, task.org_id, task.issuer_profile_id),
    task.assignee_profile_id ? loadProfile(admin, task.org_id, task.assignee_profile_id) : Promise.resolve(null),
    task.assignee_contact_id
      ? loadContact(admin, task.org_id, task.assignee_contact_id)
      : Promise.resolve(null),
  ])
  const issuer = taskIssuer ?? await loadActiveOrgAdmin(admin, task.org_id)
  if (!issuer) throw automationError('TASK_AUTOMATION_ISSUER_NOT_FOUND')
  const creator: Recipient = {
    kind: 'profile',
    id: issuer.id,
    name: issuer.full_name || issuer.email || 'Uppdragsansvarig',
    email: issuer.email,
    whatsappNumber: issuer.phone,
  }
  const assignee: Recipient | null = assigneeContact
    ? {
        kind: 'contact',
        id: assigneeContact.id,
        name: assigneeContact.name,
        email: assigneeContact.email,
        whatsappNumber: assigneeContact.whatsapp_number || assigneeContact.phone,
      }
    : assigneeProfile
      ? {
          kind: 'profile',
          id: assigneeProfile.id,
          name: assigneeProfile.full_name || assigneeProfile.email || 'Mottagare',
          email: assigneeProfile.email,
          whatsappNumber: assigneeProfile.phone,
        }
      : null
  return {
    creator,
    assignee: assignee ?? creator,
    issuer,
    assigneeUnavailable: !assignee,
  }
}

function messageTarget(message: StoredMessage | undefined, task?: OperationalTask) {
  if (message?.metadata?.target === 'creator' || message?.metadata?.target === 'assignee') {
    return message.metadata.target
  }
  if (task) {
    const recipientKind = message?.metadata?.recipientKind
    const recipientId = message?.metadata?.recipientId
    if (
      (recipientKind === 'profile' && recipientId === task.assignee_profile_id)
      || (recipientKind === 'contact' && recipientId === task.assignee_contact_id)
    ) {
      return 'assignee'
    }
    if (recipientKind === 'profile' && recipientId === task.issuer_profile_id) {
      return 'creator'
    }
  }
  // Access-link delivery predates the worker metadata but is still an assignee
  // contact. Counting it prevents an immediate duplicate assignment reminder.
  return message?.message_type === 'assignment' ? 'assignee' : null
}

function isReminderOrAssignmentMessage(message: StoredMessage | undefined) {
  return Boolean(
    message
    && message.message_type !== 'comment'
    && message.metadata?.humanEvent !== true
    && message.metadata?.humanEventNotification !== true
  )
}

function effectiveDeliveryAt(delivery: StoredDelivery) {
  return delivery.sent_at && Number.isFinite(Date.parse(delivery.sent_at))
    ? delivery.sent_at
    : delivery.created_at
}

function latestIso(values: Array<string | null>) {
  let latest: string | null = null
  let latestMs = Number.NEGATIVE_INFINITY
  for (const value of values) {
    if (!value) continue
    const time = Date.parse(value)
    if (Number.isFinite(time) && time > latestMs) {
      latest = value
      latestMs = time
    }
  }
  return latest
}

function parseStoredDelivery(value: unknown): StoredDelivery | null {
  const row = toObject(value)
  const delivery = {
    id: String(row.id ?? ''),
    message_id: String(row.message_id ?? ''),
    channel: String(row.channel ?? '') as StoredDelivery['channel'],
    status: String(row.status ?? '') as StoredDelivery['status'],
    is_fallback: row.is_fallback === true,
    attempt_count: normalizeInteger(row.attempt_count, 0, 0, 20),
    max_attempts: normalizeInteger(row.max_attempts, 5, 1, 20),
    idempotency_key: String(row.idempotency_key ?? ''),
    sent_at: typeof row.sent_at === 'string' ? row.sent_at : null,
    created_at: String(row.created_at ?? ''),
  } satisfies StoredDelivery
  return delivery.id && delivery.message_id && delivery.idempotency_key && delivery.created_at
    ? delivery
    : null
}

async function loadLatestAssigneeFallbackDelivery(
  admin: AdminClient,
  task: OperationalTask,
  deliverySelection: string
) {
  const pageSize = 100
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from('task_message_deliveries')
      .select(deliverySelection)
      .eq('task_id', task.id)
      .eq('org_id', task.org_id)
      .eq('is_fallback', true)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + pageSize - 1)
    if (error) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')
    const deliveries = (data ?? [])
      .map(parseStoredDelivery)
      .filter((delivery): delivery is StoredDelivery => Boolean(delivery))
    const messageIds = [...new Set(deliveries.map((delivery) => delivery.message_id))]
    const { data: messageData, error: messageError } = messageIds.length > 0
      ? await admin
          .from('task_messages')
          .select('id,created_at,message_type,metadata')
          .eq('task_id', task.id)
          .eq('org_id', task.org_id)
          .in('id', messageIds)
      : { data: [], error: null }
    if (messageError) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')
    const messages = new Map((messageData ?? []).map((value) => {
      const row = toObject(value)
      const message = {
        id: String(row.id ?? ''),
        created_at: String(row.created_at ?? ''),
        message_type: String(row.message_type ?? ''),
        metadata: toObject(row.metadata),
      } satisfies StoredMessage
      return [message.id, message] as const
    }))
    const fallback = deliveries.find((delivery) => {
      const message = messages.get(delivery.message_id)
      return isReminderOrAssignmentMessage(message)
        && messageTarget(message, task) === 'assignee'
    })
    if (fallback) return fallback
    if ((data ?? []).length < pageSize) return null
  }
}

async function loadTaskDeliverySafetyState(
  admin: AdminClient,
  task: OperationalTask
) {
  const deliverySelection = 'id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at'
  const [unresolvedResult, fallback] = await Promise.all([
    admin
      .from('task_message_deliveries')
      .select('id')
      .eq('task_id', task.id)
      .eq('org_id', task.org_id)
      .in('status', ['sending', 'ambiguous']),
    loadLatestAssigneeFallbackDelivery(admin, task, deliverySelection),
  ])
  if (unresolvedResult.error) {
    throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')
  }

  const unresolvedDeliveryIds = [...new Set(
    (unresolvedResult.data ?? [])
      .map((row) => typeof row.id === 'string' ? row.id : '')
      .filter(Boolean)
  )]
  if (
    !fallback
    || fallback.status !== 'failed'
    || fallback.attempt_count < fallback.max_attempts
  ) {
    return {
      unresolvedDeliveryIds,
      exhaustedFallbackDeliveryId: null,
      emittedKeys: [] as string[],
    }
  }

  // Only an outcome newer than the failed fallback can supersede its safety
  // pause. Page directly over deliveries rather than depending on the bounded
  // conversation history used for cadence/statistics.
  const newerDeliveries: StoredDelivery[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await admin
      .from('task_message_deliveries')
      .select(deliverySelection)
      .eq('task_id', task.id)
      .eq('org_id', task.org_id)
      .or(`created_at.gt.${fallback.created_at},sent_at.gt.${fallback.created_at}`)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')
    const page = (data ?? [])
      .map(parseStoredDelivery)
      .filter((delivery): delivery is StoredDelivery => Boolean(delivery))
    newerDeliveries.push(...page)
    if ((data ?? []).length < pageSize) break
  }

  const messagesById = new Map<string, StoredMessage>()
  const messageIds = [...new Set(newerDeliveries.map((delivery) => delivery.message_id))]
  for (let offset = 0; offset < messageIds.length; offset += 100) {
    const { data, error } = await admin
      .from('task_messages')
      .select('id,created_at,message_type,metadata')
      .eq('task_id', task.id)
      .eq('org_id', task.org_id)
      .in('id', messageIds.slice(offset, offset + 100))
    if (error) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')
    for (const value of data ?? []) {
      const row = toObject(value)
      const message = {
        id: String(row.id ?? ''),
        created_at: String(row.created_at ?? ''),
        message_type: String(row.message_type ?? ''),
        metadata: toObject(row.metadata),
      } satisfies StoredMessage
      if (message.id) messagesById.set(message.id, message)
    }
  }

  const fallbackEpoch = Date.parse(fallback.created_at)
  const superseded = newerDeliveries.some((delivery) => {
    const message = messagesById.get(delivery.message_id)
    if (messageTarget(message, task) !== 'assignee') return false
    const newerPrimaryAttempt = !delivery.is_fallback
      && delivery.channel === task.primary_channel
      && isReminderOrAssignmentMessage(message)
      && Date.parse(delivery.created_at) > fallbackEpoch
    const newerSuccessfulContact = SUCCESSFUL_DELIVERY_STATUSES.has(delivery.status)
      && Date.parse(effectiveDeliveryAt(delivery)) > fallbackEpoch
    return newerPrimaryAttempt || newerSuccessfulContact
  })
  if (superseded) {
    return {
      unresolvedDeliveryIds,
      exhaustedFallbackDeliveryId: null,
      emittedKeys: [] as string[],
    }
  }

  const escalationKey = buildTaskPolicyIdempotencyKey(
    task.id,
    'fallback_exhausted',
    fallback.id
  )
  const { data: emittedEscalation, error: escalationError } = await admin
    .from('task_message_deliveries')
    .select('id')
    .eq('org_id', task.org_id)
    .eq('idempotency_key', escalationKey)
    .in('status', [...SUCCESSFUL_DELIVERY_STATUSES])
    .limit(1)
    .maybeSingle()
  if (escalationError) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')

  return {
    unresolvedDeliveryIds,
    exhaustedFallbackDeliveryId: fallback.id,
    emittedKeys: emittedEscalation ? [escalationKey] : [],
  }
}

async function loadTaskHistory(
  admin: AdminClient,
  task: OperationalTask
): Promise<TaskHistory> {
  const [messageResult, safetyState] = await Promise.all([
    admin
      .from('task_messages')
      .select('id,created_at,message_type,metadata')
      .eq('task_id', task.id)
      .eq('org_id', task.org_id)
      .order('created_at', { ascending: false })
      .limit(300),
    loadTaskDeliverySafetyState(admin, task),
  ])
  const { data: messageData, error: messageError } = messageResult
  if (messageError) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')

  const messages = (messageData ?? []).map((value) => {
    const row = toObject(value)
    return {
      id: String(row.id ?? ''),
      created_at: String(row.created_at ?? ''),
      message_type: String(row.message_type ?? ''),
      metadata: toObject(row.metadata),
    } satisfies StoredMessage
  }).filter((message) => message.id && message.created_at)
  if (messages.length === 0) {
    return {
      emittedKeys: safetyState.emittedKeys,
      lastAssigneeReminderAt: null,
      lastCreatorReminderAt: null,
      unansweredAttempts: 0,
      overdueReminderCount: 0,
      primaryDeliveryState: 'unknown',
      primaryDeliveryAttemptId: null,
      totalAssigneeReminders: 0,
      unresolvedDeliveryIds: safetyState.unresolvedDeliveryIds,
      exhaustedFallbackDeliveryId: safetyState.exhaustedFallbackDeliveryId,
    }
  }

  const { data: deliveryData, error: deliveryError } = await admin
    .from('task_message_deliveries')
    .select('id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at')
    .eq('task_id', task.id)
    .eq('org_id', task.org_id)
    .in('message_id', messages.map((message) => message.id))
    .order('created_at', { ascending: false })
    .limit(500)
  if (deliveryError) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')

  const deliveries = (deliveryData ?? [])
    .map(parseStoredDelivery)
    .filter((delivery): delivery is StoredDelivery => Boolean(delivery))
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const successful = deliveries.filter((delivery) => SUCCESSFUL_DELIVERY_STATUSES.has(delivery.status))
  const assigneeSuccessful = successful.filter(
    (delivery) => messageTarget(messagesById.get(delivery.message_id), task) === 'assignee'
  )
  const assigneeReminderSuccessful = assigneeSuccessful.filter(
    (delivery) => isReminderOrAssignmentMessage(messagesById.get(delivery.message_id))
  )
  const creatorSuccessful = successful.filter(
    (delivery) => messageTarget(messagesById.get(delivery.message_id), task) === 'creator'
  )
  const lastActivityMs = Date.parse(task.last_activity_at)
  const unansweredAttempts = assigneeReminderSuccessful.filter(
    (delivery) => Date.parse(effectiveDeliveryAt(delivery)) > lastActivityMs
  ).length
  const overdueReminderCount = assigneeReminderSuccessful.filter((delivery) => {
    const metadata = messagesById.get(delivery.message_id)?.metadata
    return metadata?.actionKind === 'overdue'
  }).length
  const latestPrimary = deliveries.find((delivery) => {
    const message = messagesById.get(delivery.message_id)
    return delivery.channel === task.primary_channel
      && isReminderOrAssignmentMessage(message)
      && messageTarget(message, task) === 'assignee'
  })
  const latestSuccessfulAssigneeAt = latestIso(
    assigneeSuccessful.map(effectiveDeliveryAt)
  )
  const primaryDeliveryState: TaskDeliveryState = !latestPrimary
    ? 'unknown'
    : latestPrimary.status === 'failed'
      ? 'failed'
      : SUCCESSFUL_DELIVERY_STATUSES.has(latestPrimary.status)
        ? 'delivered'
        : 'pending'
  const emittedKeys = new Set<string>(safetyState.emittedKeys)
  for (const delivery of successful) {
    emittedKeys.add(delivery.idempotency_key)
    const message = messagesById.get(delivery.message_id)
    const policyActionKey = message?.metadata?.policyActionIdempotencyKey
    if (typeof policyActionKey === 'string' && policyActionKey) emittedKeys.add(policyActionKey)
    const assignedAt = Date.parse(task.created_at)
    if (message?.message_type === 'assignment' && Number.isFinite(assignedAt)) {
      emittedKeys.add(buildTaskPolicyIdempotencyKey(task.id, 'assignment', assignedAt))
    }
  }

  return {
    emittedKeys: [...emittedKeys],
    lastAssigneeReminderAt: latestSuccessfulAssigneeAt,
    // A direct human event is meaningful contact. Counting it only for the
    // contact interval prevents an immediate automatic follow-up about the
    // same extension request or status change, without inflating reminder
    // attempts, overdue counts or pause thresholds.
    lastCreatorReminderAt: latestIso(creatorSuccessful.map(effectiveDeliveryAt)),
    unansweredAttempts,
    overdueReminderCount,
    primaryDeliveryState,
    primaryDeliveryAttemptId: latestPrimary?.id ?? null,
    totalAssigneeReminders: assigneeReminderSuccessful.length,
    unresolvedDeliveryIds: safetyState.unresolvedDeliveryIds,
    exhaustedFallbackDeliveryId: safetyState.exhaustedFallbackDeliveryId,
  }
}

function parseReminderOffsets(value: unknown) {
  if (!Array.isArray(value)) return DEFAULT_TASK_REMINDER_POLICY.dueReminderWorkingDaysBefore
  const offsets = value
    .map((item) => Number(item))
    .filter((hours) => Number.isFinite(hours) && hours >= 0 && hours % 24 === 0)
    .map((hours) => hours / 24)
  return offsets.length > 0
    ? [...new Set(offsets)]
    : DEFAULT_TASK_REMINDER_POLICY.dueReminderWorkingDaysBefore
}

async function loadFollowupPolicy(admin: AdminClient, task: OperationalTask) {
  const { data, error } = await admin
    .from('task_followup_rules')
    .select(
      'unacknowledged_after_hours,reminder_offsets_hours,overdue_interval_hours,escalate_after_overdue_hours,fallback_after_hours,max_reminders,is_active'
    )
    .eq('task_id', task.id)
    .eq('org_id', task.org_id)
    .maybeSingle()
  if (error) throw automationError('TASK_AUTOMATION_POLICY_READ_FAILED')
  if (!data) {
    return {
      active: true,
      maxReminders: 20,
      policy: DEFAULT_TASK_REMINDER_POLICY,
    }
  }
  const row = data as TaskFollowupRule
  const policy: TaskReminderPolicy = {
    ...DEFAULT_TASK_REMINDER_POLICY,
    noActivityAfterHours: normalizeInteger(
      row.unacknowledged_after_hours,
      DEFAULT_TASK_REMINDER_POLICY.noActivityAfterHours,
      1,
      8760
    ),
    dueReminderWorkingDaysBefore: parseReminderOffsets(row.reminder_offsets_hours),
    overdueCadenceHours: normalizeInteger(
      row.overdue_interval_hours,
      DEFAULT_TASK_REMINDER_POLICY.overdueCadenceHours,
      1,
      8760
    ),
    escalateAfterOverdueWorkingDays: Math.ceil(normalizeInteger(
      row.escalate_after_overdue_hours,
      DEFAULT_TASK_REMINDER_POLICY.escalateAfterOverdueWorkingDays * 24,
      1,
      8760
    ) / 24),
  }
  return {
    active: row.is_active !== false,
    maxReminders: normalizeInteger(row.max_reminders, 20, 1, 100),
    policy,
  }
}

function parseSendWindowMinute(value: unknown) {
  if (typeof value !== 'string') return null
  const match = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value.trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function parseSendWeekdays(value: unknown) {
  if (!Array.isArray(value)) return null
  const weekdays = [...new Set(value.map(Number))]
  return weekdays.length > 0
    && weekdays.every((weekday) => Number.isInteger(weekday) && weekday >= 1 && weekday <= 7)
    ? weekdays
    : null
}

async function loadOrganizationSchedule(
  admin: AdminClient,
  task: OperationalTask
): Promise<TaskOrganizationSchedule> {
  const { data, error } = await admin
    .from('task_organization_settings')
    .select(
      'timezone,reminder_send_window_start,reminder_send_window_end,reminder_send_weekdays'
    )
    .eq('org_id', task.org_id)
    .maybeSingle()
  if (error) throw automationError('TASK_AUTOMATION_SCHEDULE_READ_FAILED')

  const row = toObject(data)
  const timeZone = row.timezone
  const startMinute = parseSendWindowMinute(row.reminder_send_window_start)
  const endMinute = parseSendWindowMinute(row.reminder_send_window_end)
  const isoWeekdays = parseSendWeekdays(row.reminder_send_weekdays)
  if (
    !isValidTaskTimeZone(task.due_timezone)
    || !isValidTaskTimeZone(timeZone)
    || startMinute === null
    || endMinute === null
    || !isoWeekdays
  ) {
    throw automationError('TASK_AUTOMATION_SCHEDULE_INVALID')
  }

  const sendWindow: TaskSendWindowPolicy = {
    timeZone,
    startMinute,
    endMinute,
    isoWeekdays,
  }
  if (!isValidTaskSendWindowPolicy(sendWindow)) {
    throw automationError('TASK_AUTOMATION_SCHEDULE_INVALID')
  }
  return {
    calendar: {
      ...DEFAULT_TASK_CALENDAR_POLICY,
      timeZone: task.due_timezone,
    },
    sendWindow,
  }
}

async function authoritativeNextAllowedReminderAt(
  admin: AdminClient,
  orgId: string,
  candidate: Date
) {
  const { data, error } = await admin.rpc('task_next_allowed_reminder_at', {
    p_org_id: orgId,
    p_candidate_at: candidate.toISOString(),
  })
  if (error || typeof data !== 'string') {
    throw automationError('TASK_AUTOMATION_SCHEDULE_READ_FAILED')
  }
  const epoch = Date.parse(data)
  if (!Number.isFinite(epoch) || epoch < candidate.getTime()) {
    throw automationError('TASK_AUTOMATION_SCHEDULE_INVALID')
  }
  return new Date(epoch)
}

function appBaseUrl() {
  const configured = process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (!configured) throw automationError('TASK_AUTOMATION_APP_URL_MISSING')
  let url: URL
  try {
    url = new URL(configured)
  } catch {
    throw automationError('TASK_AUTOMATION_APP_URL_INVALID')
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local)) {
    throw automationError('TASK_AUTOMATION_APP_URL_INVALID')
  }
  return url.origin
}

function dueDateLabel(value: string, timeZone?: string | null) {
  return formatTaskDateTime(value, timeZone, 'long')
}

function actionHeading(action: TaskReminderAction) {
  switch (action.kind) {
    case 'assignment': return 'Nytt uppdrag'
    case 'due_soon': return 'Uppdraget närmar sig slutdatum'
    case 'due_today': return 'Uppdraget har slutdatum idag'
    case 'overdue': return 'Uppdraget är försenat'
    case 'status_check': return 'Gizmo behöver en statusuppdatering'
    case 'review_follow_up': return 'Uppdraget väntar på kontroll'
    case 'review_overdue': return 'Kontrollen av uppdraget är försenad'
    case 'deadline_change_request': return 'Nytt önskemål om förlängt slutdatum'
    case 'escalation': return 'Gizmo behöver din hjälp'
    case 'delivery_fallback': return 'Påminnelse om uppdrag'
  }
}

function actionInstruction(action: TaskReminderAction) {
  if (action.target === 'creator') {
    if (action.kind === 'deadline_change_request') {
      return 'Öppna uppdraget och godkänn eller avslå det föreslagna nya slutdatumet.'
    }
    return action.kind === 'escalation'
      ? 'Öppna uppdraget, kontrollera läget och besluta hur det ska drivas vidare.'
      : 'Öppna uppdraget och kontrollera eller återkoppla på det som har lämnats in.'
  }
  switch (action.kind) {
    case 'assignment':
      return 'Bekräfta att du har tagit emot uppdraget och påbörja det i tid.'
    case 'overdue':
      return 'Uppdatera statusen direkt. Om tiden inte räcker behöver du begära en förlängning.'
    default:
      return 'Uppdatera statusen och meddela direkt om något hindrar att uppdraget blir klart.'
  }
}

function buildReminderContent(input: {
  action: TaskReminderAction
  task: OperationalTask
  recipient: Recipient
  recipientActionUrl?: string | null
}) {
  const heading = actionHeading(input.action)
  const instruction = actionInstruction(input.action)
  const dueLabel = dueDateLabel(input.task.due_at, input.task.due_timezone)
  const internalUrl = input.recipient.kind === 'profile'
    ? `${appBaseUrl()}/uppdrag?task=${encodeURIComponent(input.task.id)}`
    : null
  const actionUrl = internalUrl ?? input.recipientActionUrl ?? null
  const myTasksUrl = input.recipient.kind === 'contact'
    ? `${appBaseUrl()}/mina-uppdrag`
    : null
  const externalLinkNote = input.recipient.kind === 'contact'
    ? actionUrl
      ? 'Den direkta länken är personlig och öppnar bara detta uppdrag. Vidarebefordra den inte.'
      : 'Öppna uppdraget via den personliga länken i det första utskicket.'
    : null
  const contextText = input.task.context_label ? `Projekt: ${input.task.context_label}` : null
  const text = [
    `${input.recipient.name},`,
    '',
    `${heading}: ${input.task.title}`,
    contextText,
    `Slutdatum: ${dueLabel}`,
    '',
    instruction,
    actionUrl ? `Öppna uppdraget: ${actionUrl}` : externalLinkNote,
    myTasksUrl ? `Mina uppdrag (inloggning krävs): ${myTasksUrl}` : null,
    '',
    'Hälsningar, Gizmo',
  ].filter((line): line is string => line !== null).join('\n')
  const html = buildTaskEmailHtml({
    previewText: `${heading}: ${input.task.title}`,
    eyebrow: 'Gizmo följer upp',
    heading,
    recipientName: input.recipient.name,
    lead: 'Gizmo följer upp uppdraget och ser till att nästa steg blir tydligt.',
    taskTitle: input.task.title,
    contextLabel: input.task.context_label,
    dueLabel,
    instruction,
    actionUrl,
    actionLabel: 'Öppna uppdraget',
    secondaryActionUrl: myTasksUrl,
    secondaryActionLabel: myTasksUrl ? 'Mina uppdrag' : undefined,
    notice: externalLinkNote,
  })
  const auditText = [
    `${input.recipient.name},`,
    '',
    `${heading}: ${input.task.title}`,
    contextText,
    `Slutdatum: ${dueLabel}`,
    '',
    instruction,
    actionUrl ? 'En direktlänk bifogades i leveransen men sparades inte i meddelandeloggen.' : externalLinkNote,
    '',
    'Hälsningar, Gizmo',
  ].filter((line): line is string => line !== null).join('\n')
  return { subject: `${heading}: ${input.task.title}`, text, html, auditText, actionUrl }
}

type TaskNotificationDescriptor = {
  heading: string
  lead: string
  instruction: string
  actionLabel: string
  includeEventMessage: boolean
}

function notificationMetadataDate(
  value: unknown,
  task: OperationalTask
) {
  const date = optionalString(value)
  return date && Number.isFinite(Date.parse(date))
    ? dueDateLabel(date, task.due_timezone)
    : null
}

function taskNotificationDescriptor(
  event: TaskNotificationEvent,
  task: OperationalTask
): TaskNotificationDescriptor | null {
  if (event.event_type === 'comment') {
    return {
      heading: 'Du har fått ett nytt meddelande',
      lead: `${event.actor_name} har skrivit i uppdraget.`,
      instruction: 'Öppna uppdraget för att läsa hela konversationen och svara.',
      actionLabel: 'Läs och svara',
      includeEventMessage: true,
    }
  }
  if (event.event_type === 'deadline_change_requested') {
    const requestedDue = notificationMetadataDate(event.metadata.requestedDueAt, task)
    return {
      heading: 'Förlängning har begärts',
      lead: `${event.actor_name} har begärt ett nytt slutdatum för uppdraget.`,
      instruction: requestedDue
        ? `Föreslaget nytt slutdatum är ${requestedDue}. Godkänn eller avslå begäran i HusHub.`
        : 'Öppna uppdraget och godkänn eller avslå begäran.',
      actionLabel: 'Ta ställning till begäran',
      includeEventMessage: true,
    }
  }
  if (event.event_type === 'deadline_change_approved') {
    const requestedDue = notificationMetadataDate(event.metadata.requestedDueAt, task)
    return {
      heading: 'Förlängningen har godkänts',
      lead: `${event.actor_name} har godkänt det nya slutdatumet.`,
      instruction: requestedDue
        ? `Det nya slutdatumet är ${requestedDue}.`
        : 'Öppna uppdraget för att se det nya slutdatumet.',
      actionLabel: 'Öppna uppdraget',
      includeEventMessage: true,
    }
  }
  if (event.event_type === 'deadline_change_rejected') {
    return {
      heading: 'Förlängningen har avslagits',
      lead: `${event.actor_name} har avslagit begäran om ett nytt slutdatum.`,
      instruction: 'Det nuvarande slutdatumet gäller fortfarande. Öppna uppdraget för att se beslutet.',
      actionLabel: 'Öppna uppdraget',
      includeEventMessage: true,
    }
  }
  if (event.event_type !== 'status_changed') return null
  switch (event.to_status) {
    case 'waiting':
      return {
        heading: 'Uppdraget är markerat som väntande',
        lead: `${event.actor_name} har meddelat att uppdraget väntar på något.`,
        instruction: 'Öppna uppdraget för att granska orsaken och hjälpa arbetet vidare.',
        actionLabel: 'Granska uppdraget',
        includeEventMessage: true,
      }
    case 'ready_for_review':
      return {
        heading: 'Uppdraget är klart för kontroll',
        lead: `${event.actor_name} har lämnat in uppdraget för kontroll.`,
        instruction: 'Öppna uppdraget, granska resultatet och godkänn eller begär komplettering.',
        actionLabel: 'Granska uppdraget',
        includeEventMessage: true,
      }
    case 'returned':
      return {
        heading: 'Uppdraget behöver kompletteras',
        lead: `${event.actor_name} har skickat tillbaka uppdraget för komplettering.`,
        instruction: 'Öppna uppdraget, läs återkopplingen och komplettera det som saknas.',
        actionLabel: 'Se återkopplingen',
        includeEventMessage: true,
      }
    case 'approved':
      return {
        heading: 'Uppdraget har godkänts',
        lead: `${event.actor_name} har godkänt uppdraget.`,
        instruction: 'Uppdraget är nu avslutat och finns kvar i din uppdragshistorik.',
        actionLabel: 'Visa uppdraget',
        includeEventMessage: true,
      }
    case 'cancelled':
      return {
        heading: 'Uppdraget har avbrutits',
        lead: `${event.actor_name} har avbrutit uppdraget.`,
        instruction: 'Öppna uppdraget för att se informationen om beslutet.',
        actionLabel: 'Visa uppdraget',
        includeEventMessage: true,
      }
    default:
      return null
  }
}

function buildTaskNotificationAuditText(input: {
  event: TaskNotificationEvent
  task: OperationalTask
  descriptor: TaskNotificationDescriptor
}) {
  const dueLabel = dueDateLabel(input.task.due_at, input.task.due_timezone)
  return [
    input.descriptor.heading,
    `Händelse från ${input.event.actor_name}`,
    `Uppdrag: ${input.task.title}`,
    input.task.context_label ? `Projekt: ${input.task.context_label}` : null,
    `Slutdatum: ${dueLabel}`,
    '',
    input.descriptor.instruction,
    input.descriptor.includeEventMessage && input.event.message
      ? `Meddelande: ${input.event.message}`
      : null,
    '',
    'En uppdragslänk bifogas först i leveransen och sparas inte i meddelandeloggen.',
  ].filter((line): line is string => line !== null).join('\n')
}

function buildTaskNotificationContent(input: {
  event: TaskNotificationEvent
  task: OperationalTask
  recipient: Recipient
  descriptor: TaskNotificationDescriptor
  actionUrl: string
  linkMode: 'internal' | 'bearer' | 'portal'
}) {
  const dueLabel = dueDateLabel(input.task.due_at, input.task.due_timezone)
  const eventMessage = input.descriptor.includeEventMessage
    ? input.event.message
    : null
  const myTasksUrl = input.recipient.kind === 'contact'
    ? `${appBaseUrl()}/mina-uppdrag`
    : null
  const notice = input.linkMode === 'bearer'
    ? 'Länken är personlig och öppnar bara detta uppdrag. Vidarebefordra den inte.'
    : null
  const text = [
    `Hej ${input.recipient.name},`,
    '',
    input.descriptor.lead,
    eventMessage ? `\n${eventMessage}\n` : null,
    input.descriptor.instruction,
    '',
    `Uppdrag: ${input.task.title}`,
    input.task.context_label ? `Projekt: ${input.task.context_label}` : null,
    `Slutdatum: ${dueLabel}`,
    '',
    `Öppna uppdraget: ${input.actionUrl}`,
    myTasksUrl ? `Mina uppdrag (inloggning krävs): ${myTasksUrl}` : null,
    '',
    `Meddelande från ${input.event.actor_name} – skickat via HusHub.`,
  ].filter((line): line is string => line !== null).join('\n')
  const html = buildTaskEmailHtml({
    previewText: `${input.descriptor.heading}: ${input.task.title}`,
    eyebrow: `Meddelande från ${input.event.actor_name}`,
    heading: input.descriptor.heading,
    recipientName: input.recipient.name,
    lead: input.descriptor.lead,
    taskTitle: input.task.title,
    contextLabel: input.task.context_label,
    dueLabel,
    instruction: input.descriptor.instruction,
    message: eventMessage
      ? { authorName: input.event.actor_name, text: eventMessage }
      : null,
    actionUrl: input.actionUrl,
    actionLabel: input.descriptor.actionLabel,
    secondaryActionUrl: myTasksUrl,
    secondaryActionLabel: myTasksUrl ? 'Mina uppdrag' : undefined,
    notice,
  })
  return {
    subject: `${input.descriptor.heading}: ${input.task.title}`,
    text,
    html,
  }
}

function normalizedWhatsAppNumber(value: string | null) {
  if (!value) return null
  const compact = value.replace(/[\s().-]/g, '')
  if (!/^\+?[1-9]\d{7,14}$/.test(compact)) return null
  return compact.replace(/^\+/, '')
}

function deliveryAddress(recipient: Recipient, channel: TaskCommunicationChannel) {
  if (channel === 'email') return recipient.email?.trim().toLowerCase() || null
  return normalizedWhatsAppNumber(recipient.whatsappNumber)
}

function resendProviderIdempotencyKey(idempotencyKey: string) {
  return `task-${createHash('sha256').update(idempotencyKey).digest('hex')}`
}

async function sendResendEmail(input: {
  to: string
  replyTo: string | null
  subject: string
  text: string
  html: string
  idempotencyKey: string
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!apiKey || !from) throw automationError('TASK_EMAIL_PROVIDER_NOT_CONFIGURED')
  const timeoutMs = normalizeInteger(process.env.RESEND_REQUEST_TIMEOUT_MS, 10000, 1000, 10000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
  let body: Record<string, unknown>
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': resendProviderIdempotencyKey(input.idempotencyKey),
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        reply_to: input.replyTo || undefined,
        subject: input.subject,
        text: input.text,
        html: input.html,
      }),
      signal: controller.signal,
    })
    body = toObject(await response.json().catch(() => ({})))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw automationError('TASK_EMAIL_PROVIDER_TIMEOUT')
    }
    throw automationError('TASK_EMAIL_PROVIDER_UNAVAILABLE')
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    console.error('[tasks.automation] Resend rejected reminder', {
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    })
    if (response.status === 409) {
      throw automationError('TASK_EMAIL_PROVIDER_IDEMPOTENCY_CONFLICT')
    }
    if (response.status === 408 || response.status >= 500) {
      throw automationError('TASK_EMAIL_PROVIDER_SERVER_ERROR')
    }
    throw automationError('TASK_EMAIL_PROVIDER_REJECTED')
  }
  if (typeof body.id !== 'string' || !body.id) {
    throw automationError('TASK_EMAIL_PROVIDER_INVALID_RESPONSE')
  }
  return body.id
}

/** Sends assignment/access-link mail with provider-level idempotency. */
export async function sendTaskAccessLinkEmail(input: {
  to: string
  replyTo: string | null
  subject: string
  text: string
  html: string
  idempotencyKey: string
}) {
  const providerMessageId = await sendResendEmail(input)
  return { provider: 'resend', providerMessageId }
}

function whatsappConfiguration(templateName: string | null) {
  // No free-form WhatsApp send is attempted unless every provider setting and
  // an explicitly selected, pre-approved template are present and valid.
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN?.trim()
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()
  const templateLanguage = process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim()
  const apiVersion = process.env.WHATSAPP_API_VERSION?.trim()
  if (!accessToken || !phoneNumberId || !templateName || !templateLanguage || !apiVersion) {
    return null
  }
  if (!/^v\d+\.\d+$/.test(apiVersion) || !/^\d+$/.test(phoneNumberId)) return null
  return { accessToken, phoneNumberId, templateName, templateLanguage, apiVersion }
}

async function sendWhatsAppTemplate(input: {
  to: string
  templateName: string | null
  parameters: string[]
  idempotencyKey: string
}) {
  const config = whatsappConfiguration(input.templateName)
  if (!config) throw automationError('TASK_WHATSAPP_PROVIDER_NOT_CONFIGURED')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  let response: Response
  let body: Record<string, unknown>
  try {
    response = await fetch(
      `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: input.to,
          type: 'template',
          biz_opaque_callback_data: resendProviderIdempotencyKey(input.idempotencyKey),
          template: {
            name: config.templateName,
            language: { code: config.templateLanguage },
            components: [{
              type: 'body',
              parameters: input.parameters.map((parameter) => ({
                type: 'text',
                text: parameter,
              })),
            }],
          },
        }),
        signal: controller.signal,
      }
    )
    body = toObject(await response.json().catch(() => ({})))
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw automationError('TASK_WHATSAPP_PROVIDER_TIMEOUT')
    }
    throw automationError('TASK_WHATSAPP_PROVIDER_UNAVAILABLE')
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    console.error('[tasks.automation] WhatsApp rejected reminder', {
      status: response.status,
      requestId: response.headers.get('x-fb-trace-id'),
    })
    if (response.status === 408 || response.status >= 500) {
      throw automationError('TASK_WHATSAPP_PROVIDER_SERVER_ERROR')
    }
    throw automationError('TASK_WHATSAPP_PROVIDER_REJECTED')
  }
  const messages = Array.isArray(body.messages) ? body.messages : []
  const first = toObject(messages[0])
  if (typeof first.id !== 'string') throw automationError('TASK_WHATSAPP_PROVIDER_INVALID_RESPONSE')
  return first.id
}

/**
 * Sends the freshly issued external URL without persisting it. The approved
 * assignment template must have four body parameters in this exact order:
 * recipient name, task title, due date and personal access URL.
 */
export async function sendTaskWhatsAppAccessLink(input: {
  to: string
  recipientName: string
  taskTitle: string
  dueAt: string
  dueTimeZone?: string | null
  accessUrl: string
  idempotencyKey: string
}) {
  const to = normalizedWhatsAppNumber(input.to)
  if (!to) throw automationError('TASK_DELIVERY_ADDRESS_MISSING')
  let accessUrl: URL
  try {
    accessUrl = new URL(input.accessUrl)
  } catch {
    throw automationError('TASK_AUTOMATION_APP_URL_INVALID')
  }
  const local = accessUrl.hostname === 'localhost' || accessUrl.hostname === '127.0.0.1'
  if (accessUrl.protocol !== 'https:' && !(process.env.NODE_ENV !== 'production' && local)) {
    throw automationError('TASK_AUTOMATION_APP_URL_INVALID')
  }
  const providerMessageId = await sendWhatsAppTemplate({
    to,
    templateName: process.env.WHATSAPP_ASSIGNMENT_TEMPLATE_NAME?.trim() || null,
    parameters: [
      input.recipientName.slice(0, 256),
      input.taskTitle.slice(0, 1024),
      dueDateLabel(input.dueAt, input.dueTimeZone),
      accessUrl.toString(),
    ],
    idempotencyKey: input.idempotencyKey,
  })
  return { provider: 'meta_whatsapp', providerMessageId }
}

function messageType(action: TaskReminderAction) {
  if (action.kind === 'assignment') return 'assignment'
  if (action.kind === 'escalation') return 'escalation'
  if (action.kind === 'status_check' || action.kind === 'deadline_change_request') return 'status_request'
  return 'reminder'
}

async function ensureDelivery(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  action: TaskReminderAction
  recipient: Recipient
  channel: TaskCommunicationChannel
  idempotencyKey: string
  isFallback: boolean
  recipientAddress: string | null
  accessLinkId?: string | null
  content: { subject: string; text: string; html: string; auditText: string; actionUrl: string | null }
}) {
  const { data: existingData, error: existingError } = await input.admin
    .from('task_message_deliveries')
    .select('id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at')
    .eq('org_id', input.task.org_id)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (existingError) throw automationError('TASK_DELIVERY_READ_FAILED')
  if (existingData) return existingData as StoredDelivery

  const { data: messageData, error: messageError } = await input.admin
    .from('task_messages')
    .insert({
      org_id: input.task.org_id,
      task_id: input.task.id,
      direction: 'outbound',
      message_type: messageType(input.action),
      actor_type: 'system',
      actor_name: 'Gizmo',
      body_text: input.content.auditText,
      generated_by_ai: false,
      metadata: {
        target: input.action.target,
        recipientKind: input.recipient.kind,
        recipientId: input.recipient.id,
        actionKind: input.action.kind,
        reason: input.action.reason,
        actionIdempotencyKey: input.idempotencyKey,
        policyActionIdempotencyKey: input.action.idempotencyKey,
        jobId: input.job.id,
        isFallback: input.isFallback,
        ...(input.accessLinkId ? { accessLinkId: input.accessLinkId } : {}),
        tokenPersisted: false,
      },
    })
    .select('id')
    .single()
  if (messageError || !messageData?.id) throw automationError('TASK_MESSAGE_CREATE_FAILED')

  const address = input.recipientAddress
    ?? `missing:${input.recipient.kind}:${input.recipient.id}`
  const { data: deliveryData, error: deliveryError } = await input.admin
    .from('task_message_deliveries')
    .insert({
      org_id: input.task.org_id,
      task_id: input.task.id,
      message_id: messageData.id,
      channel: input.channel,
      recipient_address: address,
      provider: input.channel === 'email' ? 'resend' : 'meta_whatsapp',
      status: 'queued',
      is_fallback: input.isFallback,
      idempotency_key: input.idempotencyKey,
      provider_payload: {
        subject: input.content.subject,
        actionKind: input.action.kind,
        reason: input.action.reason,
        ...(input.accessLinkId ? { accessLinkId: input.accessLinkId } : {}),
        tokenPersisted: false,
      },
    })
    .select('id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at')
    .single()
  if (deliveryError || !deliveryData) {
    const { data: racedDelivery } = await input.admin
      .from('task_message_deliveries')
      .select('id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at')
      .eq('org_id', input.task.org_id)
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle()
    if (racedDelivery) return racedDelivery as StoredDelivery
    throw automationError('TASK_DELIVERY_CREATE_FAILED')
  }
  return deliveryData as StoredDelivery
}

async function recordDeliveryEvent(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  action: TaskReminderAction
  recipient: Recipient
  channel: TaskCommunicationChannel
  deliveryId: string
  messageId: string
  isFallback: boolean
}) {
  const eventType = input.action.kind === 'escalation'
    ? 'automation_escalated'
    : 'automation_message_sent'
  const { data: existingEvent, error: existingEventError } = await input.admin
    .from('task_events')
    .select('id')
    .eq('task_id', input.task.id)
    .eq('org_id', input.task.org_id)
    .eq('event_type', eventType)
    .contains('metadata', { deliveryId: input.deliveryId })
    .limit(1)
    .maybeSingle()
  if (existingEventError) throw automationError('TASK_AUTOMATION_EVENT_READ_FAILED')
  if (existingEvent) return

  const { error } = await input.admin.from('task_events').insert({
    org_id: input.task.org_id,
    task_id: input.task.id,
    event_type: eventType,
    actor_type: 'system',
    actor_name: 'Gizmo',
    message: input.action.target === 'creator'
      ? `Gizmo uppmärksammade ${input.recipient.name} via ${input.channel === 'email' ? 'e-post' : 'WhatsApp'}.`
      : `Gizmo skickade en uppföljning till ${input.recipient.name} via ${input.channel === 'email' ? 'e-post' : 'WhatsApp'}.`,
    metadata: {
      taskMutationApplied: true,
      automationFollowup: true,
      jobId: input.job.id,
      messageId: input.messageId,
      deliveryId: input.deliveryId,
      actionKind: input.action.kind,
      reason: input.action.reason,
      target: input.action.target,
      channel: input.channel,
      isFallback: input.isFallback,
    },
  })
  if (error) throw automationError('TASK_AUTOMATION_EVENT_CREATE_FAILED')
}

async function updateDeliveryFailure(
  admin: AdminClient,
  deliveryId: string,
  errorCode: string,
  expected?: { status: StoredDelivery['status']; attemptCount: number }
) {
  let update = admin
    .from('task_message_deliveries')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      next_attempt_at: null,
      error_message: errorCode,
    })
    .eq('id', deliveryId)
  if (expected) {
    update = update
      .eq('status', expected.status)
      .eq('attempt_count', expected.attemptCount)
  }
  const { data, error } = await update.select('id').maybeSingle()
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (expected && !data) throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
  return Boolean(data)
}

async function updateDeliveryAmbiguous(
  admin: AdminClient,
  deliveryId: string,
  errorCode: string,
  expectedAttemptCount?: number
) {
  let update = admin
    .from('task_message_deliveries')
    .update({
      status: 'ambiguous',
      failed_at: null,
      next_attempt_at: null,
      error_message: errorCode,
    })
    .eq('id', deliveryId)
    .in('status', ['sending', 'ambiguous'])
  if (expectedAttemptCount !== undefined) {
    update = update.eq('attempt_count', expectedAttemptCount)
  }
  const { data, error } = await update.select('id').maybeSingle()
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (expectedAttemptCount !== undefined && !data) {
    throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
  }
}

async function markUnresolvedDeliveriesForReconciliation(
  admin: AdminClient,
  task: OperationalTask
) {
  const { error } = await admin
    .from('task_message_deliveries')
    .update({
      status: 'ambiguous',
      failed_at: null,
      next_attempt_at: null,
      error_message: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
    })
    .eq('task_id', task.id)
    .eq('org_id', task.org_id)
    .eq('status', 'sending')
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
}

async function assertAutomaticDeliveryFence(
  admin: AdminClient,
  task: OperationalTask
) {
  const { data, error } = await admin
    .from('operational_tasks')
    .select('status,version,archived_at')
    .eq('id', task.id)
    .eq('org_id', task.org_id)
    .maybeSingle()
  if (error) throw automationError('TASK_AUTOMATION_TASK_FENCE_FAILED')

  const status = data && isTaskStatus(data.status) ? data.status : null
  if (
    !data
    || Number(data.version) !== task.version
    || data.archived_at !== null
    || status === null
    || status === 'draft'
    || TERMINAL_STATUSES.has(status)
  ) {
    throw automationError('TASK_AUTOMATION_TASK_STALE')
  }
}

async function cancelPreparedStaleDelivery(input: {
  admin: AdminClient
  deliveryId: string
  accessLinkId: string | null
  expectedAttemptCount: number
}) {
  const cancelledAt = new Date().toISOString()
  const { error } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'cancelled',
      next_attempt_at: null,
      error_message: 'TASK_AUTOMATION_TASK_STALE',
    })
    .eq('id', input.deliveryId)
    .eq('status', 'sending')
    .eq('attempt_count', input.expectedAttemptCount)
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (input.accessLinkId) {
    const { error: linkError } = await input.admin
      .from('task_access_links')
      .update({ revoked_at: cancelledAt })
      .eq('id', input.accessLinkId)
      .is('revoked_at', null)
    if (linkError) throw automationError('TASK_ACCESS_LINK_REVOKE_FAILED')
  }
}

async function deliverViaChannel(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  action: TaskReminderAction
  recipient: Recipient
  issuer: Profile
  channel: TaskCommunicationChannel
  idempotencyKey: string
  isFallback: boolean
}): Promise<DeliveryResult> {
  const { data: knownDelivery, error: knownDeliveryError } = await input.admin
    .from('task_message_deliveries')
    .select('id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at')
    .eq('org_id', input.task.org_id)
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()
  if (knownDeliveryError) throw automationError('TASK_DELIVERY_READ_FAILED')
  if (knownDelivery && SUCCESSFUL_DELIVERY_STATUSES.has(knownDelivery.status)) {
    const delivery = knownDelivery as StoredDelivery
    await recordDeliveryEvent({
      admin: input.admin,
      job: input.job,
      task: input.task,
      action: input.action,
      recipient: input.recipient,
      channel: input.channel,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      isFallback: input.isFallback,
    })
    return {
      delivered: true,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: null,
    }
  }

  if (knownDelivery) {
    const delivery = knownDelivery as StoredDelivery
    if (delivery.channel !== input.channel) {
      throw automationError('TASK_DELIVERY_CHANNEL_CONFLICT')
    }
    if (delivery.status === 'sending' || delivery.status === 'ambiguous') {
      if (delivery.status === 'sending') {
        await updateDeliveryAmbiguous(
          input.admin,
          delivery.id,
          'TASK_DELIVERY_RECONCILIATION_REQUIRED',
          delivery.attempt_count
        )
      }
      return {
        delivered: false,
        ambiguous: true,
        deliveryId: delivery.id,
        messageId: delivery.message_id,
        errorCode: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
      }
    }
    if (delivery.status === 'cancelled' || delivery.attempt_count >= delivery.max_attempts) {
      return {
        delivered: false,
        ambiguous: false,
        deliveryId: delivery.id,
        messageId: delivery.message_id,
        errorCode: 'TASK_DELIVERY_ATTEMPTS_EXHAUSTED',
      }
    }
  }

  // Re-read the authoritative task immediately before issuing a bearer link or
  // reserving a provider delivery. A deadline/status change invalidates the
  // claimed job and must never leak into a stale automatic notification.
  await assertAutomaticDeliveryFence(input.admin, input.task)

  let recipientActionUrl: string | null = null
  let recipientAccessLinkId: string | null = null
  let recipientAccessDeliveryKey: string | null = null
  let canonicalRecipientEmail: string | null = null
  let canonicalRecipientWhatsappNumber: string | null = null
  if (input.recipient.kind === 'contact') {
    const directLink = await issueDirectTaskAccessLink({
      contactId: input.recipient.id,
      taskId: input.task.id,
      createdByProfileId: input.issuer.id,
      baseUrl: appBaseUrl(),
      issuedBySystem: true,
    })
    recipientActionUrl = directLink.url
    recipientAccessLinkId = directLink.accessLinkId
    recipientAccessDeliveryKey = directLink.deliveryKey
    canonicalRecipientEmail = directLink.recipientEmail
    canonicalRecipientWhatsappNumber = directLink.recipientWhatsappNumber
  }
  const recipientAddress = input.recipient.kind === 'contact'
    ? input.channel === 'email'
      ? canonicalRecipientEmail
      : normalizedWhatsAppNumber(canonicalRecipientWhatsappNumber)
    : deliveryAddress(input.recipient, input.channel)
  const content = buildReminderContent({
    action: input.action,
    task: input.task,
    recipient: input.recipient,
    recipientActionUrl,
  })
  const delivery = await ensureDelivery({
    ...input,
    content,
    recipientAddress,
    accessLinkId: recipientAccessLinkId,
  })
  if (delivery.channel !== input.channel) {
    throw automationError('TASK_DELIVERY_CHANNEL_CONFLICT')
  }
  if (SUCCESSFUL_DELIVERY_STATUSES.has(delivery.status)) {
    await recordDeliveryEvent({
      admin: input.admin,
      job: input.job,
      task: input.task,
      action: input.action,
      recipient: input.recipient,
      channel: input.channel,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      isFallback: input.isFallback,
    })
    return {
      delivered: true,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: null,
    }
  }
  if (delivery.status === 'sending' || delivery.status === 'ambiguous') {
    if (delivery.status === 'sending') {
      await updateDeliveryAmbiguous(
        input.admin,
        delivery.id,
        'TASK_DELIVERY_RECONCILIATION_REQUIRED',
        delivery.attempt_count
      )
    }
    return {
      delivered: false,
      ambiguous: true,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
    }
  }
  if (delivery.status === 'cancelled' || delivery.attempt_count >= delivery.max_attempts) {
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_ATTEMPTS_EXHAUSTED',
    }
  }

  const address = recipientAddress
  if (!address) {
    await updateDeliveryFailure(
      input.admin,
      delivery.id,
      'TASK_DELIVERY_ADDRESS_MISSING',
      { status: delivery.status, attemptCount: delivery.attempt_count }
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_ADDRESS_MISSING',
    }
  }
  const providerPayload = {
    subject: content.subject,
    actionKind: input.action.kind,
    reason: input.action.reason,
    ...(recipientAccessLinkId ? { accessLinkId: recipientAccessLinkId } : {}),
    providerCallStarted: false,
    tokenPersisted: false,
  }
  const { data: sendingData, error: sendingError } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'sending',
      recipient_address: address,
      attempt_count: delivery.attempt_count + 1,
      failed_at: null,
      next_attempt_at: null,
      error_message: null,
      provider_payload: providerPayload,
    })
    .eq('id', delivery.id)
    .eq('status', delivery.status)
    .eq('attempt_count', delivery.attempt_count)
    .select('id')
    .maybeSingle()
  if (sendingError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (!sendingData) throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
  const reservedAttemptCount = delivery.attempt_count + 1

  const { error: messageMetadataError } = await input.admin
    .from('task_messages')
    .update({
      metadata: {
        target: input.action.target,
        recipientKind: input.recipient.kind,
        recipientId: input.recipient.id,
        actionKind: input.action.kind,
        reason: input.action.reason,
        actionIdempotencyKey: input.idempotencyKey,
        policyActionIdempotencyKey: input.action.idempotencyKey,
        jobId: input.job.id,
        isFallback: input.isFallback,
        ...(recipientAccessLinkId ? { accessLinkId: recipientAccessLinkId } : {}),
        tokenPersisted: false,
      },
    })
    .eq('id', delivery.message_id)
    .eq('task_id', input.task.id)
  if (messageMetadataError) {
    await updateDeliveryFailure(
      input.admin,
      delivery.id,
      'TASK_MESSAGE_UPDATE_FAILED',
      { status: 'sending', attemptCount: reservedAttemptCount }
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_MESSAGE_UPDATE_FAILED',
    }
  }

  try {
    await assertAutomaticDeliveryFence(input.admin, input.task)
  } catch (error) {
    if (safeErrorCode(error) === 'TASK_AUTOMATION_TASK_STALE') {
      await cancelPreparedStaleDelivery({
        admin: input.admin,
        deliveryId: delivery.id,
        accessLinkId: recipientAccessLinkId,
        expectedAttemptCount: reservedAttemptCount,
      })
    }
    throw error
  }

  const { data: providerStarted, error: providerStartError } = await input.admin
    .from('task_message_deliveries')
    .update({
      provider_payload: { ...providerPayload, providerCallStarted: true },
    })
    .eq('id', delivery.id)
    .eq('status', 'sending')
    .eq('attempt_count', reservedAttemptCount)
    .select('id')
    .maybeSingle()
  if (providerStartError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (!providerStarted) {
    await revokeUnsentTaskAccessLink(input.admin, recipientAccessLinkId)
    throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
  }

  let providerMessageId: string
  try {
    // Each definitive retry rotates the hash-only bearer and is therefore a
    // new provider attempt with a different payload. Bind the provider key to
    // that link. A timeout/unknown outcome never reaches this code again:
    // sending/ambiguous state blocks replay until audited reconciliation.
    const providerAttemptKey = recipientAccessDeliveryKey
      ? `${input.idempotencyKey}:${recipientAccessDeliveryKey}`
      : input.idempotencyKey
    const providerIdempotencyKey = `${providerAttemptKey}:attempt:${reservedAttemptCount}`
    providerMessageId = input.channel === 'email'
      ? await sendResendEmail({
          to: address,
          replyTo: input.issuer.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
          idempotencyKey: providerIdempotencyKey,
        })
      : await sendWhatsAppTemplate({
          to: address,
          templateName: input.recipient.kind === 'contact' && content.actionUrl
            ? process.env.WHATSAPP_PORTAL_REMINDER_TEMPLATE_NAME?.trim() || null
            : process.env.WHATSAPP_TEMPLATE_NAME?.trim() || null,
          parameters: input.recipient.kind === 'contact' && content.actionUrl
            ? [
                input.recipient.name.slice(0, 256),
                input.task.title.slice(0, 1024),
                dueDateLabel(input.task.due_at, input.task.due_timezone),
                content.actionUrl,
              ]
            : [
                input.recipient.name.slice(0, 256),
                input.task.title.slice(0, 1024),
                dueDateLabel(input.task.due_at, input.task.due_timezone),
              ],
          idempotencyKey: providerIdempotencyKey,
        })
  } catch (error) {
    const errorCode = safeErrorCode(error)
    if (isAmbiguousTaskDeliveryError(error)) {
      await updateDeliveryAmbiguous(
        input.admin,
        delivery.id,
        errorCode,
        reservedAttemptCount
      )
      return {
        delivered: false,
        ambiguous: true,
        deliveryId: delivery.id,
        messageId: delivery.message_id,
        errorCode,
      }
    }
    await updateDeliveryFailure(
      input.admin,
      delivery.id,
      errorCode,
      { status: 'sending', attemptCount: reservedAttemptCount }
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode,
    }
  }

  const sentAt = new Date().toISOString()
  const { data: sentDelivery, error: sentError } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'sent',
      sent_at: sentAt,
      provider_message_id: providerMessageId,
      error_message: null,
    })
    .eq('id', delivery.id)
    .eq('status', 'sending')
    .eq('attempt_count', reservedAttemptCount)
    .select('id')
    .maybeSingle()
  if (sentError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (!sentDelivery) {
    return {
      delivered: false,
      ambiguous: true,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
    }
  }
  if (recipientAccessLinkId) {
    await input.admin
      .from('task_access_links')
      .update({ sent_at: sentAt })
      .eq('id', recipientAccessLinkId)
      .is('revoked_at', null)
  }
  await recordDeliveryEvent({
    admin: input.admin,
    job: input.job,
    task: input.task,
    action: input.action,
    recipient: input.recipient,
    channel: input.channel,
    deliveryId: delivery.id,
    messageId: delivery.message_id,
    isFallback: input.isFallback,
  })
  return {
    delivered: true,
    ambiguous: false,
    deliveryId: delivery.id,
    messageId: delivery.message_id,
    errorCode: null,
  }
}

async function enqueueTaskReminderDigestItem(input: {
  admin: AdminClient
  job: AutomationJob
  task: ExternallyRoutableOperationalTask
  action: TaskReminderAction
  recipient: Recipient
}) {
  const recipientAddress = deliveryAddress(input.recipient, 'email')
  if (!recipientAddress) return false
  const content = buildReminderContent({
    action: input.action,
    task: input.task,
    recipient: input.recipient,
  })
  const { data, error } = await input.admin.rpc('enqueue_task_reminder_digest_item', {
    p_org_id: input.task.org_id,
    p_task_id: input.task.id,
    p_task_version: input.task.version,
    p_recipient_kind: input.recipient.kind,
    p_recipient_id: input.recipient.id,
    p_recipient_address: recipientAddress,
    p_target: input.action.target,
    p_action_kind: input.action.kind,
    p_reason: input.action.reason,
    p_policy_action_idempotency_key: input.action.idempotencyKey,
    p_body_text: content.auditText,
    p_job_id: input.job.id,
  })
  if (error) {
    const code = error.message?.match(/TASK_[A-Z0-9_]+/)?.[0]
    throw automationError(code ?? 'TASK_REMINDER_DIGEST_ENQUEUE_FAILED')
  }
  const result = toObject(data)
  if (result.skipped === true && result.reason === 'digest_disabled') {
    return false
  }
  if (
    result.skipped === true
    || (
      result.skipped === false
      && typeof result.batchId === 'string'
      && typeof result.itemId === 'string'
    )
  ) {
    return true
  }
  throw automationError('TASK_REMINDER_DIGEST_ENQUEUE_INVALID')
}

function isCanonicalDigestRecipient(
  task: ExternallyRoutableOperationalTask,
  action: TaskReminderAction,
  recipient: Recipient
) {
  if (action.target === 'creator') {
    return recipient.kind === 'profile' && recipient.id === task.issuer_profile_id
  }
  return recipient.kind === 'profile'
    ? recipient.id === task.assignee_profile_id
    : recipient.id === task.assignee_contact_id
}

async function deliverAction(input: {
  admin: AdminClient
  job: AutomationJob
  task: ExternallyRoutableOperationalTask
  action: TaskReminderAction
  recipients: { creator: Recipient; assignee: Recipient; issuer: Profile }
}) {
  const recipient = input.action.target === 'creator'
    ? input.recipients.creator
    : input.recipients.assignee
  const selectedChannel: TaskCommunicationChannel = input.action.target === 'creator'
    ? 'email'
    : input.action.channel ?? input.task.primary_channel
  if (
    isDigestibleEmailReminder(input.action, selectedChannel)
    && isCanonicalDigestRecipient(input.task, input.action, recipient)
    && await enqueueTaskReminderDigestItem({
      admin: input.admin,
      job: input.job,
      task: input.task,
      action: input.action,
      recipient,
    })
  ) {
    return 'queued' as const
  }
  const primaryResult = await deliverViaChannel({
    ...input,
    recipient,
    issuer: input.recipients.issuer,
    channel: selectedChannel,
    idempotencyKey: input.action.idempotencyKey,
    isFallback: input.action.target === 'assignee'
      && (
        input.action.kind === 'delivery_fallback'
        || selectedChannel === input.task.fallback_channel
      ),
  })
  if (primaryResult.delivered) return 'delivered' as const
  if (primaryResult.ambiguous) return 'ambiguous' as const

  const configuredFallbackChannel = input.action.target === 'assignee'
    && input.action.kind !== 'delivery_fallback'
    && input.task.fallback_channel
    && input.task.fallback_channel !== selectedChannel
    ? input.task.fallback_channel
    : null
  const fallbackChannel: TaskCommunicationChannel | null = configuredFallbackChannel
  if (!fallbackChannel) {
    throw automationError(primaryResult.errorCode ?? 'TASK_DELIVERY_FAILED')
  }
  const fallbackKey = buildTaskPolicyIdempotencyKey(
    input.task.id,
    'delivery_fallback',
    primaryResult.deliveryId
  )
  const fallbackResult = await deliverViaChannel({
    ...input,
    recipient,
    issuer: input.recipients.issuer,
    channel: fallbackChannel,
    idempotencyKey: fallbackKey,
    isFallback: true,
  })
  if (fallbackResult.ambiguous) return 'ambiguous' as const
  if (!fallbackResult.delivered) {
    throw automationError(fallbackResult.errorCode ?? 'TASK_DELIVERY_FALLBACK_FAILED')
  }
  return 'delivered' as const
}

async function loadTaskNotificationEvent(
  admin: AdminClient,
  job: AutomationJob
) {
  const eventId = notificationEventId(job)
  if (!eventId) throw automationError('TASK_NOTIFICATION_JOB_PAYLOAD_INVALID')
  const { data, error } = await admin
    .from('task_events')
    .select(
      'id,org_id,task_id,event_type,actor_type,actor_profile_id,actor_contact_id,actor_name,message,from_status,to_status,metadata,created_at'
    )
    .eq('id', eventId)
    .eq('org_id', job.org_id)
    .eq('task_id', job.task_id)
    .maybeSingle()
  if (error) throw automationError('TASK_NOTIFICATION_EVENT_READ_FAILED')
  if (!data) return null
  const event = parseTaskNotificationEvent(data)
  if (!event) throw automationError('TASK_NOTIFICATION_EVENT_INVALID')
  const payloadEventType = optionalString(job.payload.eventType)
  if (payloadEventType && payloadEventType !== event.event_type) {
    throw automationError('TASK_NOTIFICATION_JOB_PAYLOAD_INVALID')
  }
  return event
}

async function prepareTaskNotificationDelivery(input: {
  admin: AdminClient
  event: TaskNotificationEvent
  channel: PersistedTaskCommunicationChannel | null
  auditText: string
  accountActivation?: boolean
}) {
  const { data, error } = await input.admin.rpc('prepare_task_event_notification_delivery', {
    p_event_id: input.event.id,
    p_channel: input.channel,
    p_body_text: input.auditText,
    p_metadata: {
      eventId: input.event.id,
      eventType: input.event.event_type,
      fromStatus: input.event.from_status,
      toStatus: input.event.to_status,
      actorName: taskActorDisplayName(input.event.actor_name, 'HusHub', input.event.actor_type),
      humanEvent: true,
      ...(input.accountActivation ? { accountActivation: true } : {}),
      tokenPersisted: false,
    },
    p_provider_payload: {
      eventId: input.event.id,
      eventType: input.event.event_type,
      toStatus: input.event.to_status,
      humanEvent: true,
      ...(input.accountActivation ? { accountActivation: true } : {}),
      tokenPersisted: false,
    },
  })
  if (error) {
    const code = error.message?.match(/TASK_[A-Z0-9_]+/)?.[0]
    throw automationError(code ?? 'TASK_NOTIFICATION_PREPARE_FAILED')
  }
  const prepared = parsePreparedTaskNotificationDelivery(data)
  if (!prepared) throw automationError('TASK_NOTIFICATION_PREPARE_INVALID')
  return prepared
}

function preparedRecipient(
  prepared: PreparedTaskNotificationDelivery,
  recipients: { creator: Recipient; assignee: Recipient }
) {
  const recipient = prepared.target === 'creator'
    ? recipients.creator
    : recipients.assignee
  if (recipient.kind === prepared.recipientKind && recipient.id === prepared.recipientId) {
    return recipient
  }
  throw automationError('TASK_NOTIFICATION_RECIPIENT_MISMATCH')
}

async function taskNotificationReplyTo(input: {
  admin: AdminClient
  event: TaskNotificationEvent
  recipients: { creator: Recipient; assignee: Recipient; issuer: Profile }
}) {
  if (
    input.event.actor_type === input.recipients.assignee.kind
    && (
      input.event.actor_profile_id === input.recipients.assignee.id
      || input.event.actor_contact_id === input.recipients.assignee.id
    )
  ) {
    return input.recipients.assignee.email
  }
  if (input.event.actor_type === 'profile' && input.event.actor_profile_id) {
    if (input.event.actor_profile_id === input.recipients.issuer.id) {
      return input.recipients.issuer.email
    }
    const actor = await loadProfile(
      input.admin,
      input.event.org_id,
      input.event.actor_profile_id
    )
    return actor?.email ?? null
  }
  if (input.event.actor_type === 'contact' && input.event.actor_contact_id) {
    const actor = await loadContact(
      input.admin,
      input.event.org_id,
      input.event.actor_contact_id
    )
    return actor?.email ?? null
  }
  return null
}

function taskNotificationErrorCode(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  return message.match(/TASK_[A-Z0-9_]+/)?.[0] ?? fallback
}

function taskNotificationSkipError(reason: string) {
  const codes: Record<string, string> = {
    recipient_missing: 'TASK_NOTIFICATION_RECIPIENT_MISSING',
    recipient_inactive: 'TASK_NOTIFICATION_RECIPIENT_INACTIVE',
    recipient_access_denied: 'TASK_NOTIFICATION_RECIPIENT_ACCESS_DENIED',
    actor_invalid: 'TASK_NOTIFICATION_ACTOR_INVALID',
  }
  return automationError(codes[reason] ?? 'TASK_NOTIFICATION_PREPARE_SKIPPED_INVALID')
}

async function revokeUnsentTaskAccessLink(
  admin: AdminClient,
  accessLinkId: string | null
) {
  if (!accessLinkId) return
  await admin
    .from('task_access_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', accessLinkId)
    .is('sent_at', null)
    .is('revoked_at', null)
}

async function contactCanReceiveTaskNotification(
  admin: AdminClient,
  contactId: string
) {
  const { data: contact, error: contactError } = await admin
    .from('organization_contacts')
    .select('recipient_identity_id')
    .eq('id', contactId)
    .eq('is_active', true)
    .maybeSingle()
  if (contactError) throw automationError('TASK_RECIPIENT_IDENTITY_READ_FAILED')
  if (!contact) return false
  const identityId = optionalString(contact.recipient_identity_id)
  // Legacy contacts without a recipient identity remain valid recipients. Once
  // an identity exists, its explicit disabled state is the global revocation
  // boundary for both task links and the notification content itself.
  if (!identityId) return true
  const { data: identity, error: identityError } = await admin
    .from('task_recipient_identities')
    .select('status')
    .eq('id', identityId)
    .maybeSingle()
  if (identityError) throw automationError('TASK_RECIPIENT_IDENTITY_READ_FAILED')
  if (!identity) return false
  return identity.status !== 'disabled'
}

async function taskNotificationIsSuperseded(
  admin: AdminClient,
  event: TaskNotificationEvent,
  prepared: PreparedTaskNotificationDelivery,
  expectedRecipientAddress?: string
) {
  const { data: task, error: taskError } = await admin
    .from('operational_tasks')
    .select('status,archived_at,issuer_profile_id,assignee_profile_id,assignee_contact_id')
    .eq('id', event.task_id)
    .eq('org_id', event.org_id)
    .maybeSingle()
  if (taskError) throw automationError('TASK_NOTIFICATION_FENCE_FAILED')
  if (!task || task.archived_at !== null) return true
  const recipientStillCurrent = prepared.target === 'creator'
    ? prepared.recipientKind === 'profile'
      && task.issuer_profile_id === prepared.recipientId
    : prepared.recipientKind === 'contact'
      ? task.assignee_contact_id === prepared.recipientId
      : task.assignee_profile_id === prepared.recipientId
  if (!recipientStillCurrent) return true
  if (prepared.recipientKind === 'profile') {
    if (!(await hasInternalTaskModuleAccess({
      orgId: event.org_id,
      profileId: prepared.recipientId,
    }))) return true
    const currentProfile = await loadProfile(admin, event.org_id, prepared.recipientId)
    if (!currentProfile) return true
    if (expectedRecipientAddress && isCommunicationChannel(prepared.channel)) {
      const currentAddress = deliveryAddress({
        kind: 'profile',
        id: currentProfile.id,
        name: currentProfile.full_name || currentProfile.email || 'Mottagare',
        email: currentProfile.email,
        whatsappNumber: currentProfile.phone,
      }, prepared.channel)
      if (currentAddress !== expectedRecipientAddress) return true
    }
  } else {
    const currentContact = await loadContact(admin, event.org_id, prepared.recipientId)
    if (!currentContact) return true
    if (!(await contactCanReceiveTaskNotification(admin, prepared.recipientId))) return true
    if (expectedRecipientAddress && isCommunicationChannel(prepared.channel)) {
      const currentAddress = deliveryAddress({
        kind: 'contact',
        id: currentContact.id,
        name: currentContact.name,
        email: currentContact.email,
        whatsappNumber: currentContact.whatsapp_number || currentContact.phone,
      }, prepared.channel)
      if (currentAddress !== expectedRecipientAddress) return true
    }
  }
  if (event.event_type === 'status_changed') {
    return !event.to_status || task.status !== event.to_status
  }
  if (event.event_type !== 'deadline_change_requested') return false
  const requestId = optionalString(event.metadata.requestId)
  if (!requestId) throw automationError('TASK_NOTIFICATION_EVENT_INVALID')
  const { data: request, error: requestError } = await admin
    .from('task_deadline_change_requests')
    .select('status')
    .eq('id', requestId)
    .eq('task_id', event.task_id)
    .eq('org_id', event.org_id)
    .maybeSingle()
  if (requestError) throw automationError('TASK_NOTIFICATION_FENCE_FAILED')
  return !request || request.status !== 'pending'
}

async function cancelSupersededTaskNotificationDelivery(
  admin: AdminClient,
  prepared: PreparedTaskNotificationDelivery,
  accessLinkId: string | null,
  expectedAttemptCount?: number
) {
  await revokeUnsentTaskAccessLink(admin, accessLinkId)
  let update = admin
    .from('task_message_deliveries')
    .update({
      status: 'cancelled',
      next_attempt_at: null,
      error_message: 'TASK_NOTIFICATION_SUPERSEDED',
    })
    .eq('id', prepared.deliveryId)
    .in('status', ['queued', 'failed', 'sending'])
  if (expectedAttemptCount !== undefined) {
    update = update.eq('attempt_count', expectedAttemptCount)
  }
  const { error } = await update
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')

  let siblings = admin
    .from('task_message_deliveries')
    .update({
      status: 'cancelled',
      next_attempt_at: null,
      error_message: 'TASK_NOTIFICATION_SUPERSEDED',
    })
    .eq('message_id', prepared.messageId)
    .eq('recipient_kind', prepared.recipientKind)
    .neq('id', prepared.deliveryId)
    .in('status', ['queued', 'failed'])
  siblings = prepared.recipientKind === 'profile'
    ? siblings.eq('recipient_profile_id', prepared.recipientId)
    : siblings.eq('recipient_contact_id', prepared.recipientId)
  const { error: siblingError } = await siblings
  if (siblingError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
}

async function recordTaskNotificationDeliveryEvent(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  event: TaskNotificationEvent
  prepared: PreparedTaskNotificationDelivery
  isFallback: boolean
}) {
  const { data: existing, error: readError } = await input.admin
    .from('task_events')
    .select('id')
    .eq('org_id', input.task.org_id)
    .eq('task_id', input.task.id)
    .eq('event_type', 'automation_message_sent')
    .contains('metadata', { deliveryId: input.prepared.deliveryId })
    .limit(1)
    .maybeSingle()
  if (readError) throw automationError('TASK_AUTOMATION_EVENT_READ_FAILED')
  if (existing) return
  const { error } = await input.admin.from('task_events').insert({
    org_id: input.task.org_id,
    task_id: input.task.id,
    event_type: 'automation_message_sent',
    actor_type: 'system',
    actor_name: 'HusHub',
    message: `HusHub skickade en notifiering via ${
      input.prepared.channel === 'email'
        ? 'e-post'
        : input.prepared.channel === 'whatsapp'
          ? 'WhatsApp'
          : 'HusHub'
    }.`,
    metadata: {
      taskMutationApplied: true,
      humanEventNotification: true,
      sourceEventId: input.event.id,
      sourceEventType: input.event.event_type,
      jobId: input.job.id,
      messageId: input.prepared.messageId,
      deliveryId: input.prepared.deliveryId,
      channel: input.prepared.channel,
      isFallback: input.isFallback,
    },
  })
  if (error) throw automationError('TASK_AUTOMATION_EVENT_CREATE_FAILED')
}

async function taskNotificationWasAlreadyDelivered(
  admin: AdminClient,
  event: TaskNotificationEvent
) {
  const { data, error } = await admin
    .from('task_message_deliveries')
    .select('id')
    .eq('org_id', event.org_id)
    .eq('task_id', event.task_id)
    .eq('source_event_id', event.id)
    .in('status', ['sent', 'delivered', 'read', 'replied'])
    .limit(1)
    .maybeSingle()
  if (error) throw automationError('TASK_NOTIFICATION_DELIVERY_READ_FAILED')
  return Boolean(data)
}

function taskNotificationRecipientIsCurrent(
  task: OperationalTask,
  recipient: TaskNotificationJobRecipient
) {
  if (recipient.target === 'creator') {
    return recipient.recipientKind === 'profile'
      && recipient.recipientId === task.issuer_profile_id
  }
  return recipient.recipientKind === 'contact'
    ? recipient.recipientId === task.assignee_contact_id
    : recipient.recipientId === task.assignee_profile_id
}

function preparedMatchesJobRecipient(
  prepared: PreparedTaskNotificationDelivery,
  expected: TaskNotificationJobRecipient
) {
  return prepared.target === expected.target
    && prepared.recipientKind === expected.recipientKind
    && prepared.recipientId === expected.recipientId
}

async function cancelQueuedTaskNotificationForChangedRecipient(input: {
  admin: AdminClient
  event: TaskNotificationEvent
  expectedRecipient: TaskNotificationJobRecipient
}) {
  let unresolved = input.admin
    .from('task_message_deliveries')
    .update({
      status: 'ambiguous',
      failed_at: null,
      next_attempt_at: null,
      error_message: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
    })
    .eq('org_id', input.event.org_id)
    .eq('task_id', input.event.task_id)
    .eq('source_event_id', input.event.id)
    .eq('recipient_kind', input.expectedRecipient.recipientKind)
  unresolved = input.expectedRecipient.recipientKind === 'profile'
    ? unresolved.eq('recipient_profile_id', input.expectedRecipient.recipientId)
    : unresolved.eq('recipient_contact_id', input.expectedRecipient.recipientId)
  const { error: unresolvedError } = await unresolved.eq('status', 'sending')
  if (unresolvedError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')

  let cancellation = input.admin
    .from('task_message_deliveries')
    .update({
      status: 'cancelled',
      next_attempt_at: null,
      error_message: 'TASK_NOTIFICATION_RECIPIENT_CHANGED',
    })
    .eq('org_id', input.event.org_id)
    .eq('task_id', input.event.task_id)
    .eq('source_event_id', input.event.id)
    .eq('recipient_kind', input.expectedRecipient.recipientKind)
  cancellation = input.expectedRecipient.recipientKind === 'profile'
    ? cancellation.eq('recipient_profile_id', input.expectedRecipient.recipientId)
    : cancellation.eq('recipient_contact_id', input.expectedRecipient.recipientId)
  const { error } = await cancellation.in('status', ['queued', 'failed'])
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
}

async function cancelMismatchedPreparedDelivery(
  admin: AdminClient,
  prepared: PreparedTaskNotificationDelivery
) {
  const { error } = await admin
    .from('task_message_deliveries')
    .update({
      status: 'cancelled',
      next_attempt_at: null,
      error_message: 'TASK_NOTIFICATION_RECIPIENT_CHANGED',
    })
    .eq('id', prepared.deliveryId)
    .in('status', ['queued', 'failed'])
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
}

function parseReconciledTaskNotificationDelivery(
  value: unknown
): ReconciledTaskNotificationDelivery | null {
  const row = toObject(value)
  const recipientKind = optionalString(row.recipient_kind)
  const recipientId = recipientKind === 'profile'
    ? optionalString(row.recipient_profile_id)
    : recipientKind === 'contact'
      ? optionalString(row.recipient_contact_id)
      : null
  const retryMarker = row.reconciliation_retry_for_attempt === null
    || row.reconciliation_retry_for_attempt === undefined
    ? null
    : Number(row.reconciliation_retry_for_attempt)
  if (
    typeof row.id !== 'string'
    || typeof row.message_id !== 'string'
    || typeof row.source_event_id !== 'string'
    || !isCommunicationChannel(row.channel)
    || !isTaskNotificationProviderForChannel(row.provider, row.channel)
    || row.provider === 'hushub'
    || !isTaskDeliveryStatus(row.status)
    || (recipientKind !== 'profile' && recipientKind !== 'contact')
    || !recipientId
    || (retryMarker !== null && (!Number.isInteger(retryMarker) || retryMarker < 1))
  ) return null
  return {
    id: row.id,
    messageId: row.message_id,
    sourceEventId: row.source_event_id,
    channel: row.channel,
    provider: row.provider,
    status: row.status,
    isFallback: row.is_fallback === true,
    accountActivation: toObject(row.provider_payload).accountActivation === true,
    recipientKind,
    recipientId,
    attemptCount: normalizeInteger(row.attempt_count, 0, 0, 20),
    reconciliationRetryForAttempt: retryMarker,
  }
}

async function loadReconciledTaskNotificationDelivery(input: {
  admin: AdminClient
  job: AutomationJob
  event: TaskNotificationEvent
  expectedRecipient: TaskNotificationJobRecipient
}) {
  const retryDeliveryId = optionalString(input.job.payload.retryDeliveryId)
  const retryAttemptCount = Number(input.job.payload.retryAttemptCount)
  if (
    !retryDeliveryId
    || !Number.isInteger(retryAttemptCount)
    || retryAttemptCount < 1
    || retryAttemptCount > 20
  ) throw automationError('TASK_NOTIFICATION_RECONCILIATION_PAYLOAD_INVALID')
  const { data, error } = await input.admin
    .from('task_message_deliveries')
    .select(
      'id,message_id,source_event_id,channel,provider,status,is_fallback,recipient_kind,recipient_profile_id,recipient_contact_id,attempt_count,reconciliation_retry_for_attempt,provider_payload'
    )
    .eq('id', retryDeliveryId)
    .eq('org_id', input.event.org_id)
    .eq('task_id', input.event.task_id)
    .eq('source_event_id', input.event.id)
    .maybeSingle()
  if (error) throw automationError('TASK_NOTIFICATION_DELIVERY_READ_FAILED')
  const delivery = parseReconciledTaskNotificationDelivery(data)
  if (!delivery) throw automationError('TASK_NOTIFICATION_RECONCILIATION_DELIVERY_INVALID')
  if (
    input.job.delivery_id !== retryDeliveryId
    || (input.job.message_id !== null && input.job.message_id !== delivery.messageId)
    || delivery.sourceEventId !== input.event.id
    || delivery.recipientKind !== input.expectedRecipient.recipientKind
    || delivery.recipientId !== input.expectedRecipient.recipientId
    || delivery.attemptCount !== retryAttemptCount
  ) return null
  return { delivery, retryAttemptCount }
}

async function authorizeOneReconciliationAttempt(input: {
  admin: AdminClient
  prepared: PreparedTaskNotificationDelivery
  event: TaskNotificationEvent
  retryDeliveryId: string
  retryAttemptCount: number
}) {
  const selection = 'id,status,attempt_count,max_attempts,reconciliation_retry_for_delivery_id,reconciliation_retry_for_attempt'
  const load = async () => {
    const { data, error } = await input.admin
      .from('task_message_deliveries')
      .select(selection)
      .eq('id', input.prepared.deliveryId)
      .eq('message_id', input.prepared.messageId)
      .eq('org_id', input.event.org_id)
      .eq('task_id', input.event.task_id)
      .eq('source_event_id', input.event.id)
      .maybeSingle()
    if (error || !data) throw automationError('TASK_NOTIFICATION_DELIVERY_READ_FAILED')
    const row = toObject(data)
    const attemptCount = Number(row.attempt_count)
    const maxAttempts = Number(row.max_attempts)
    const markerDeliveryId = optionalString(row.reconciliation_retry_for_delivery_id)
    const markerAttempt = row.reconciliation_retry_for_attempt === null
      || row.reconciliation_retry_for_attempt === undefined
      ? null
      : Number(row.reconciliation_retry_for_attempt)
    if (
      typeof row.id !== 'string'
      || !isTaskDeliveryStatus(row.status)
      || !Number.isInteger(attemptCount)
      || attemptCount < 0
      || !Number.isInteger(maxAttempts)
      || maxAttempts < 1
      || ((markerDeliveryId === null) !== (markerAttempt === null))
      || (markerAttempt !== null && (!Number.isInteger(markerAttempt) || markerAttempt < 1))
    ) throw automationError('TASK_NOTIFICATION_DELIVERY_INVALID')
    return {
      id: row.id,
      status: row.status,
      attemptCount,
      maxAttempts,
      markerDeliveryId,
      markerAttempt,
    }
  }

  let row = await load()
  if (SUCCESSFUL_DELIVERY_STATUSES.has(row.status)) return
  if (row.status === 'sending' || row.status === 'ambiguous') {
    throw automationError('TASK_DELIVERY_RECONCILIATION_REQUIRED')
  }
  if (row.status !== 'queued' && row.status !== 'failed') {
    throw automationError('TASK_NOTIFICATION_RECONCILIATION_DELIVERY_STALE')
  }
  if (
    row.markerDeliveryId === input.retryDeliveryId
    && row.markerAttempt === input.retryAttemptCount
  ) {
    if (row.attemptCount < row.maxAttempts) return
    throw automationError('TASK_DELIVERY_ATTEMPTS_EXHAUSTED')
  }
  if (row.attemptCount >= 20) throw automationError('TASK_DELIVERY_ATTEMPTS_EXHAUSTED')

  let update = input.admin
    .from('task_message_deliveries')
    .update({
      max_attempts: row.attemptCount + 1,
      reconciliation_retry_for_delivery_id: input.retryDeliveryId,
      reconciliation_retry_for_attempt: input.retryAttemptCount,
      next_attempt_at: new Date().toISOString(),
    })
    .eq('id', row.id)
    .eq('status', row.status)
    .eq('attempt_count', row.attemptCount)
  update = row.markerDeliveryId === null
    ? update
        .is('reconciliation_retry_for_delivery_id', null)
        .is('reconciliation_retry_for_attempt', null)
    : update
        .eq('reconciliation_retry_for_delivery_id', row.markerDeliveryId)
        .eq('reconciliation_retry_for_attempt', row.markerAttempt)
  const { data: updated, error: updateError } = await update
    .select('id')
    .maybeSingle()
  if (updateError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (updated) return

  row = await load()
  if (
    row.markerDeliveryId === input.retryDeliveryId
    && row.markerAttempt === input.retryAttemptCount
    && row.attemptCount < row.maxAttempts
  ) return
  throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
}

async function deliverPreparedTaskNotification(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  event: TaskNotificationEvent
  descriptor: TaskNotificationDescriptor
  recipients: { creator: Recipient; assignee: Recipient; issuer: Profile }
  prepared: PreparedTaskNotificationDelivery
  isFallback: boolean
}): Promise<DeliveryResult> {
  const { data: deliveryData, error: deliveryReadError } = await input.admin
    .from('task_message_deliveries')
    .select('id,message_id,channel,status,is_fallback,attempt_count,max_attempts,idempotency_key,sent_at,created_at')
    .eq('id', input.prepared.deliveryId)
    .eq('message_id', input.prepared.messageId)
    .eq('org_id', input.task.org_id)
    .eq('task_id', input.task.id)
    .maybeSingle()
  if (deliveryReadError || !deliveryData) {
    throw automationError('TASK_NOTIFICATION_DELIVERY_READ_FAILED')
  }
  const delivery = parseStoredDelivery(deliveryData)
  if (
    !delivery
    || delivery.channel !== input.prepared.channel
    || delivery.idempotency_key !== input.prepared.idempotencyKey
  ) {
    throw automationError('TASK_NOTIFICATION_DELIVERY_INVALID')
  }
  if (SUCCESSFUL_DELIVERY_STATUSES.has(delivery.status)) {
    await recordTaskNotificationDeliveryEvent({ ...input })
    return {
      delivered: true,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: null,
    }
  }
  // Legacy tasks can use the persisted in-app channel. Its preparation RPC
  // completes the delivery atomically; never reinterpret a non-successful
  // in-app row as an email or WhatsApp provider attempt.
  if (input.prepared.channel === 'in_app') {
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_NOTIFICATION_IN_APP_NOT_DELIVERED',
    }
  }
  if (delivery.status === 'sending' || delivery.status === 'ambiguous') {
    if (delivery.status === 'sending') {
      await updateDeliveryAmbiguous(
        input.admin,
        delivery.id,
        'TASK_DELIVERY_RECONCILIATION_REQUIRED',
        delivery.attempt_count
      )
    }
    return {
      delivered: false,
      ambiguous: true,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
    }
  }
  if (await taskNotificationIsSuperseded(input.admin, input.event, input.prepared)) {
    await cancelSupersededTaskNotificationDelivery(
      input.admin,
      input.prepared,
      null,
      delivery.attempt_count
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_NOTIFICATION_SUPERSEDED',
    }
  }
  if (delivery.status === 'cancelled' || delivery.attempt_count >= delivery.max_attempts) {
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_ATTEMPTS_EXHAUSTED',
    }
  }
  const recipient = preparedRecipient(input.prepared, input.recipients)
  let actionUrl = recipient.kind === 'profile'
    ? `${appBaseUrl()}/uppdrag?task=${encodeURIComponent(input.task.id)}`
    : `${appBaseUrl()}/mina-uppdrag/uppdrag/${encodeURIComponent(input.task.id)}`
  let linkMode: 'internal' | 'bearer' | 'portal' = recipient.kind === 'profile'
    ? 'internal'
    : 'portal'
  let accessLinkId: string | null = null
  let accessDeliveryKey: string | null = null
  // Re-resolve mutable profile/contact details for every attempt. The address
  // prepared with the outbox row is an audit snapshot, not a send authority.
  let recipientAddress = deliveryAddress(recipient, input.prepared.channel) ?? ''
  if (recipient.kind === 'contact') {
    try {
      const directLink = await issueDirectTaskAccessLink({
        contactId: recipient.id,
        taskId: input.task.id,
        createdByProfileId: input.recipients.issuer.id,
        baseUrl: appBaseUrl(),
        issuedBySystem: true,
        readOnly: TERMINAL_STATUSES.has(input.task.status),
      })
      actionUrl = directLink.url
      linkMode = 'bearer'
      accessLinkId = directLink.accessLinkId
      accessDeliveryKey = directLink.deliveryKey
      recipientAddress = input.prepared.channel === 'email'
        ? directLink.recipientEmail ?? ''
        : normalizedWhatsAppNumber(directLink.recipientWhatsappNumber) ?? ''
    } catch (error) {
      const errorCode = taskNotificationErrorCode(error, 'TASK_ACCESS_CREATE_FAILED')
      await updateDeliveryFailure(
        input.admin,
        delivery.id,
        errorCode,
        { status: delivery.status, attemptCount: delivery.attempt_count }
      )
      return {
        delivered: false,
        ambiguous: false,
        deliveryId: delivery.id,
        messageId: delivery.message_id,
        errorCode,
      }
    }
  }
  if (!recipientAddress) {
    await revokeUnsentTaskAccessLink(input.admin, accessLinkId)
    await updateDeliveryFailure(
      input.admin,
      delivery.id,
      'TASK_DELIVERY_ADDRESS_MISSING',
      { status: delivery.status, attemptCount: delivery.attempt_count }
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_ADDRESS_MISSING',
    }
  }
  const content = buildTaskNotificationContent({
    event: input.event,
    task: input.task,
    recipient,
    descriptor: input.descriptor,
    actionUrl,
    linkMode,
  })
  const providerPayload = {
    subject: content.subject,
    eventId: input.event.id,
    eventType: input.event.event_type,
    toStatus: input.event.to_status,
    target: input.prepared.target,
    recipientKind: input.prepared.recipientKind,
    recipientId: input.prepared.recipientId,
    humanEvent: true,
    ...(accessLinkId ? { accessLinkId } : {}),
    providerCallStarted: false,
    tokenPersisted: false,
  }
  const { data: reserved, error: reservationError } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'sending',
      recipient_address: recipientAddress,
      attempt_count: delivery.attempt_count + 1,
      failed_at: null,
      next_attempt_at: null,
      error_message: null,
      provider_payload: providerPayload,
    })
    .eq('id', delivery.id)
    .eq('status', delivery.status)
    .eq('attempt_count', delivery.attempt_count)
    .select('id')
    .maybeSingle()
  if (reservationError) {
    await revokeUnsentTaskAccessLink(input.admin, accessLinkId)
    throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  }
  if (!reserved) {
    await revokeUnsentTaskAccessLink(input.admin, accessLinkId)
    throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
  }
  const reservedAttemptCount = delivery.attempt_count + 1

  if (await taskNotificationIsSuperseded(
    input.admin,
    input.event,
    input.prepared,
    recipientAddress
  )) {
    await cancelSupersededTaskNotificationDelivery(
      input.admin,
      input.prepared,
      accessLinkId,
      reservedAttemptCount
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_NOTIFICATION_SUPERSEDED',
    }
  }

  const { data: providerStarted, error: providerStartError } = await input.admin
    .from('task_message_deliveries')
    .update({
      provider_payload: { ...providerPayload, providerCallStarted: true },
    })
    .eq('id', delivery.id)
    .eq('status', 'sending')
    .eq('attempt_count', reservedAttemptCount)
    .select('id')
    .maybeSingle()
  if (providerStartError) {
    await revokeUnsentTaskAccessLink(input.admin, accessLinkId)
    throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  }
  if (!providerStarted) {
    await revokeUnsentTaskAccessLink(input.admin, accessLinkId)
    throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')
  }

  let providerMessageId: string
  try {
    const providerAttemptKey = accessDeliveryKey
      ? `${delivery.idempotency_key}:${accessDeliveryKey}`
      : delivery.idempotency_key
    const providerIdempotencyKey = `${providerAttemptKey}:attempt:${reservedAttemptCount}`
    providerMessageId = input.prepared.channel === 'email'
      ? await sendResendEmail({
          to: recipientAddress,
          replyTo: await taskNotificationReplyTo(input),
          subject: content.subject,
          text: content.text,
          html: content.html,
          idempotencyKey: providerIdempotencyKey,
        })
      : await sendWhatsAppTemplate({
          to: recipientAddress,
          templateName: process.env.WHATSAPP_TASK_EVENT_TEMPLATE_NAME?.trim() || null,
          // The approved template contains only routing context. Free-form
          // comments/reasons stay inside HusHub and are never WhatsApp params.
          parameters: [
            recipient.name.slice(0, 256),
            input.event.actor_name.slice(0, 256),
            input.descriptor.heading.slice(0, 512),
            input.task.title.slice(0, 1024),
            actionUrl,
          ],
          idempotencyKey: providerIdempotencyKey,
        })
  } catch (error) {
    const errorCode = taskNotificationErrorCode(error, 'TASK_NOTIFICATION_PROVIDER_FAILED')
    if (isAmbiguousTaskDeliveryError(error)) {
      await updateDeliveryAmbiguous(
        input.admin,
        delivery.id,
        errorCode,
        reservedAttemptCount
      )
      return {
        delivered: false,
        ambiguous: true,
        deliveryId: delivery.id,
        messageId: delivery.message_id,
        errorCode,
      }
    }
    await revokeUnsentTaskAccessLink(input.admin, accessLinkId)
    await updateDeliveryFailure(
      input.admin,
      delivery.id,
      errorCode,
      { status: 'sending', attemptCount: reservedAttemptCount }
    )
    return {
      delivered: false,
      ambiguous: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode,
    }
  }

  const sentAt = new Date().toISOString()
  const { data: updatedDelivery, error: deliveryError } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'sent',
      sent_at: sentAt,
      provider_message_id: providerMessageId,
      error_message: null,
    })
    .eq('id', delivery.id)
    .eq('status', 'sending')
    .eq('attempt_count', reservedAttemptCount)
    .select('id')
    .maybeSingle()
  if (deliveryError || !updatedDelivery) {
    await updateDeliveryAmbiguous(
      input.admin,
      delivery.id,
      'TASK_DELIVERY_RECONCILIATION_REQUIRED',
      reservedAttemptCount
    )
    return {
      delivered: false,
      ambiguous: true,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_RECONCILIATION_REQUIRED',
    }
  }
  const { error: messageError } = await input.admin
    .from('task_messages')
    .update({ provider_message_id: providerMessageId })
    .eq('id', delivery.message_id)
    .eq('task_id', input.task.id)
  if (messageError) {
    // The exact delivery row is already the durable provider audit. A failure
    // to copy the same provider id onto the parent message must never replay a
    // provider call that has been accepted.
    console.error('[tasks.automation] message provider audit update failed', {
      taskId: input.task.id,
      messageId: delivery.message_id,
      deliveryId: delivery.id,
      code: 'TASK_MESSAGE_UPDATE_FAILED',
    })
  }
  if (accessLinkId) {
    await input.admin
      .from('task_access_links')
      .update({ sent_at: sentAt })
      .eq('id', accessLinkId)
      .is('revoked_at', null)
  }
  await recordTaskNotificationDeliveryEvent({ ...input })
  return {
    delivered: true,
    ambiguous: false,
    deliveryId: delivery.id,
    messageId: delivery.message_id,
    errorCode: null,
  }
}

async function deliverReconciledTaskNotification(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  event: TaskNotificationEvent
  descriptor: TaskNotificationDescriptor
  auditText: string
  expectedRecipient: TaskNotificationJobRecipient
  recipients: { creator: Recipient; assignee: Recipient; issuer: Profile }
}) {
  const resolution = await loadReconciledTaskNotificationDelivery({
      admin: input.admin,
      job: input.job,
      event: input.event,
      expectedRecipient: input.expectedRecipient,
    })
  if (!resolution) return 'completed' as const
  const { delivery: resolvedDelivery, retryAttemptCount } = resolution
  if (resolvedDelivery.status === 'sending') {
    await updateDeliveryAmbiguous(
      input.admin,
      resolvedDelivery.id,
      'TASK_DELIVERY_RECONCILIATION_REQUIRED',
      resolvedDelivery.attemptCount
    )
    return 'completed' as const
  }
  if (resolvedDelivery.status === 'ambiguous') return 'completed' as const
  if (resolvedDelivery.status !== 'failed') return 'completed' as const

  let channel = resolvedDelivery.channel
  const accountActivation = false
  if (input.expectedRecipient.target === 'assignee' && !resolvedDelivery.isFallback) {
    const configuredFallback = isCommunicationChannel(input.task.fallback_channel)
      && input.task.fallback_channel !== resolvedDelivery.channel
      ? input.task.fallback_channel
      : null
    if (configuredFallback) channel = configuredFallback
  }
  if (resolvedDelivery.channel === 'whatsapp' && channel === 'whatsapp') {
    // Meta does not provide the provider idempotency guarantee we rely on for
    // a same-channel replay. Once an operator confirms a WhatsApp attempt as
    // not sent, only a distinct configured/safe email fallback may continue.
    return 'completed' as const
  }

  const prepared = await prepareTaskNotificationDelivery({
    admin: input.admin,
    event: input.event,
    channel,
    auditText: input.auditText,
    accountActivation,
  })
  if (prepared.skipped) {
    if (!BENIGN_TASK_NOTIFICATION_SKIP_REASONS.has(prepared.reason)) {
      throw taskNotificationSkipError(prepared.reason)
    }
    return 'completed' as const
  }
  if (!preparedMatchesJobRecipient(prepared, input.expectedRecipient)) {
    await cancelMismatchedPreparedDelivery(input.admin, prepared)
    await cancelQueuedTaskNotificationForChangedRecipient({
      admin: input.admin,
      event: input.event,
      expectedRecipient: input.expectedRecipient,
    })
    return 'completed' as const
  }
  if (prepared.channel !== channel) {
    throw automationError('TASK_NOTIFICATION_RECONCILIATION_CHANNEL_MISMATCH')
  }

  await authorizeOneReconciliationAttempt({
    admin: input.admin,
    prepared,
    event: input.event,
    retryDeliveryId: resolvedDelivery.id,
    retryAttemptCount,
  })
  const result = await deliverPreparedTaskNotification({
    admin: input.admin,
    job: input.job,
    task: input.task,
    event: input.event,
    descriptor: input.descriptor,
    recipients: input.recipients,
    prepared,
    isFallback: channel !== input.task.primary_channel,
  })
  if (
    result.delivered
    || result.ambiguous
    || result.errorCode === 'TASK_NOTIFICATION_SUPERSEDED'
  ) return 'completed' as const
  throw automationError(result.errorCode ?? 'TASK_NOTIFICATION_RECONCILIATION_FAILED')
}

async function deliverTaskNotificationJob(admin: AdminClient, job: AutomationJob) {
  const phase = notificationJobPhase(job)
  const expectedRecipient = notificationJobRecipient(job)
  if (!phase || !expectedRecipient) {
    throw automationError('TASK_NOTIFICATION_JOB_PAYLOAD_INVALID')
  }
  const event = await loadTaskNotificationEvent(admin, job)
  if (!event) return 'stale' as const
  const task = await loadTask(admin, job)
  if (!task || task.archived_at) return 'stale' as const
  if (!taskNotificationRecipientIsCurrent(task, expectedRecipient)) {
    await cancelQueuedTaskNotificationForChangedRecipient({
      admin,
      event,
      expectedRecipient,
    })
    return 'completed' as const
  }
  // A provider success is the durable completion fence for the whole business
  // event. If the worker crashed after a fallback succeeded but before the job
  // was finished, never replay the failed primary channel on the next claim.
  if (await taskNotificationWasAlreadyDelivered(admin, event)) {
    return 'completed' as const
  }
  const descriptor = taskNotificationDescriptor(event, task)
  if (!descriptor) return 'completed' as const
  const auditText = buildTaskNotificationAuditText({ event, task, descriptor })
  const recipients = await loadRecipients(admin, task)
  if (phase === 'reconcile') {
    return deliverReconciledTaskNotification({
      admin,
      job,
      task,
      event,
      descriptor,
      auditText,
      expectedRecipient,
      recipients,
    })
  }
  const prepared = await prepareTaskNotificationDelivery({
    admin,
    event,
    channel: null,
    auditText,
  })
  if (prepared.skipped) {
    if (!BENIGN_TASK_NOTIFICATION_SKIP_REASONS.has(prepared.reason)) {
      throw taskNotificationSkipError(prepared.reason)
    }
    return 'completed' as const
  }
  if (!preparedMatchesJobRecipient(prepared, expectedRecipient)) {
    await cancelMismatchedPreparedDelivery(admin, prepared)
    await cancelQueuedTaskNotificationForChangedRecipient({
      admin,
      event,
      expectedRecipient,
    })
    return 'completed' as const
  }
  const primary = await deliverPreparedTaskNotification({
    admin,
    job,
    task,
    event,
    descriptor,
    recipients,
    prepared,
    isFallback: false,
  })
  if (
    primary.delivered
    || primary.ambiguous
    || primary.errorCode === 'TASK_NOTIFICATION_SUPERSEDED'
  ) return 'completed' as const
  const targetsAssignee = prepared.target === 'assignee'
  const fallbackChannel = targetsAssignee ? task.fallback_channel : null
  if (!fallbackChannel || fallbackChannel === prepared.channel) {
    throw automationError(primary.errorCode ?? 'TASK_NOTIFICATION_DELIVERY_FAILED')
  }
  const fallbackPrepared = await prepareTaskNotificationDelivery({
    admin,
    event,
    channel: fallbackChannel,
    auditText,
    accountActivation: false,
  })
  if (fallbackPrepared.skipped) {
    if (!BENIGN_TASK_NOTIFICATION_SKIP_REASONS.has(fallbackPrepared.reason)) {
      throw taskNotificationSkipError(fallbackPrepared.reason)
    }
    return 'completed' as const
  }
  const fallback = await deliverPreparedTaskNotification({
    admin,
    job,
    task,
    event,
    descriptor,
    recipients,
    prepared: fallbackPrepared,
    isFallback: true,
  })
  if (
    fallback.delivered
    || fallback.ambiguous
    || fallback.errorCode === 'TASK_NOTIFICATION_SUPERSEDED'
  ) return 'completed' as const
  throw automationError(fallback.errorCode ?? 'TASK_NOTIFICATION_FALLBACK_FAILED')
}

function taskMatchesDigestRecipient(
  task: DigestOperationalTask,
  item: TaskReminderDigestItem,
  batch: TaskReminderDigestBatch
) {
  if (
    task.org_id !== batch.org_id
    || task.id !== item.task_id
    || task.version !== item.task_version
    || task.archived_at
    || task.status === 'draft'
    || TERMINAL_STATUSES.has(task.status)
  ) return false
  if (item.target === 'creator') {
    return batch.recipient_kind === 'profile'
      && task.issuer_profile_id === batch.recipient_id
  }
  return batch.recipient_kind === 'profile'
    ? task.assignee_profile_id === batch.recipient_id
    : task.assignee_contact_id === batch.recipient_id
}

function digestItemStatusLabel(item: TaskReminderDigestItem, task: DigestOperationalTask) {
  switch (item.action_kind) {
    case 'overdue': return 'Försenat'
    case 'due_today':
      return Date.parse(task.due_at) <= Date.now()
        ? 'Försenat'
        : 'Ska vara klart idag'
    case 'due_soon':
    case 'status_check':
      return Date.parse(task.due_at) <= Date.now()
        ? 'Försenat'
        : item.action_kind === 'due_soon'
          ? 'Närmar sig sluttid'
          : 'Status behöver uppdateras'
    case 'review_follow_up': return 'Väntar på kontroll'
    case 'review_overdue': return 'Kontrollen är försenad'
    case 'deadline_change_request': return 'Beslut om förlängning'
    case 'escalation': return 'Behöver din hjälp'
    default: return 'Behöver uppmärksamhet'
  }
}

async function loadTaskReminderDigestItems(
  admin: AdminClient,
  batch: TaskReminderDigestBatch
) {
  const { data: itemData, error: itemError } = await admin
    .from('task_reminder_digest_items')
    .select(
      'id,batch_id,org_id,task_id,task_version,target,action_kind,reason,policy_action_idempotency_key,body_text,status,created_at'
    )
    .eq('batch_id', batch.id)
    .eq('org_id', batch.org_id)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
  if (itemError) throw automationError('TASK_REMINDER_DIGEST_ITEMS_READ_FAILED')
  const items = (itemData ?? [])
    .map(parseTaskReminderDigestItem)
    .filter((item): item is TaskReminderDigestItem => Boolean(item))
  if (items.length === 0) return []

  const { data: taskData, error: taskError } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,parent_task_id,root_task_id,depth,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,status,due_at,due_timezone,next_followup_at,primary_channel,fallback_channel,last_activity_at,submitted_for_review_at,created_at,version,archived_at'
    )
    .eq('org_id', batch.org_id)
    .in('id', items.map((item) => item.task_id))
  if (taskError) throw automationError('TASK_REMINDER_DIGEST_TASKS_READ_FAILED')
  const tasks = (taskData ?? [])
    .map(parseDigestOperationalTask)
    .filter((task): task is DigestOperationalTask => Boolean(task))
  const tasksById = new Map(tasks.map((task) => [task.id, task]))
  return items.flatMap((item) => {
    const task = tasksById.get(item.task_id)
    return task && taskMatchesDigestRecipient(task, item, batch)
      ? [{ item, task }]
      : []
  })
}

async function loadTaskReminderDigestRecipient(
  admin: AdminClient,
  batch: TaskReminderDigestBatch
): Promise<Recipient | null> {
  if (batch.recipient_kind === 'profile') {
    const profile = await loadProfile(admin, batch.org_id, batch.recipient_id)
    return profile
      ? {
          kind: 'profile',
          id: profile.id,
          name: profile.full_name || profile.email || 'Mottagare',
          email: profile.email,
          whatsappNumber: profile.phone,
        }
      : null
  }
  const contact = await loadContact(admin, batch.org_id, batch.recipient_id)
  return contact
    ? {
        kind: 'contact',
        id: contact.id,
        name: contact.name,
        email: contact.email,
        whatsappNumber: contact.whatsapp_number || contact.phone,
      }
    : null
}

async function loadTaskReminderDigestVisibleLimit(admin: AdminClient, orgId: string) {
  const { data, error } = await admin
    .from('task_organization_settings')
    .select('reminder_digest_max_visible_items')
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw automationError('TASK_REMINDER_DIGEST_SETTINGS_READ_FAILED')
  return normalizeInteger(
    toObject(data).reminder_digest_max_visible_items,
    10,
    1,
    100
  )
}

function sortTaskReminderDigestPairs(
  pairs: Array<{ item: TaskReminderDigestItem; task: DigestOperationalTask }>
) {
  return [...pairs].sort((left, right) => {
    const leftDue = Date.parse(left.task.due_at)
    const rightDue = Date.parse(right.task.due_at)
    if (leftDue !== rightDue) return leftDue - rightDue
    if (left.task.root_task_id !== right.task.root_task_id) {
      return left.task.root_task_id.localeCompare(right.task.root_task_id)
    }
    if (left.task.depth !== right.task.depth) return left.task.depth - right.task.depth
    return left.task.title.localeCompare(right.task.title, 'sv')
  })
}

async function buildTaskReminderDigestContent(input: {
  admin: AdminClient
  batch: TaskReminderDigestBatch
  recipient: Recipient
  pairs: Array<{ item: TaskReminderDigestItem; task: DigestOperationalTask }>
  visibleLimit: number
}) {
  const sortedPairs = sortTaskReminderDigestPairs(input.pairs)
  const visiblePairs = sortedPairs.slice(0, input.visibleLimit)
  const accessLinks: Array<{ id: string; deliveryKey: string }> = []
  const emailItems: TaskReminderDigestEmailItem[] = []
  try {
    for (const { item, task } of visiblePairs) {
      let actionUrl: string
      if (input.recipient.kind === 'profile') {
        actionUrl = `${appBaseUrl()}/uppdrag?task=${encodeURIComponent(task.id)}`
      } else {
        const directLink = await issueDirectTaskAccessLink({
          contactId: input.recipient.id,
          taskId: task.id,
          createdByProfileId: task.issuer_profile_id,
          baseUrl: appBaseUrl(),
          issuedBySystem: true,
        })
        actionUrl = directLink.url
        accessLinks.push({
          id: directLink.accessLinkId,
          deliveryKey: directLink.deliveryKey,
        })
      }
      emailItems.push({
        title: task.title,
        contextLabel: task.context_label,
        dueLabel: dueDateLabel(task.due_at, task.due_timezone),
        statusLabel: digestItemStatusLabel(item, task),
        actionUrl,
      })
    }
  } catch (error) {
    await Promise.all(
      accessLinks.map((link) => revokeUnsentTaskAccessLink(input.admin, link.id))
    )
    throw error
  }
  const count = sortedPairs.length
  const heading = count === 1
    ? 'Ett uppdrag behöver din uppmärksamhet'
    : `${count} uppdrag behöver din uppmärksamhet`
  const subject = count === 1
    ? 'HusHub: 1 uppdrag behöver din uppmärksamhet'
    : `HusHub: ${count} uppdrag behöver din uppmärksamhet`
  const overviewUrl = input.recipient.kind === 'profile'
    ? `${appBaseUrl()}/uppdrag`
    : `${appBaseUrl()}/mina-uppdrag`
  const overviewLabel = input.recipient.kind === 'profile'
    ? 'Visa alla uppdrag'
    : 'Mina uppdrag (inloggning krävs)'
  const lead = count === 1
    ? 'Gizmo har samlat den automatiska uppföljningen här.'
    : 'Gizmo har samlat de automatiska uppföljningarna i ett mejl för att minska antalet utskick.'
  const text = [
    `Hej ${input.recipient.name},`,
    '',
    lead,
    '',
    ...emailItems.flatMap((item) => [
      `${item.statusLabel}: ${item.title}`,
      item.contextLabel ? `Projekt: ${item.contextLabel}` : null,
      `Slutdatum: ${item.dueLabel}`,
      `Öppna uppdraget: ${item.actionUrl}`,
      '',
    ]).filter((line): line is string => line !== null),
    count > emailItems.length
      ? `Ytterligare ${count - emailItems.length} uppdrag finns i HusHub.`
      : null,
    `${overviewLabel}: ${overviewUrl}`,
    '',
    'Hälsningar, Gizmo',
  ].filter((line): line is string => line !== null).join('\n')
  const html = buildTaskReminderDigestEmailHtml({
    recipientName: input.recipient.name,
    previewText: heading,
    heading,
    lead,
    items: emailItems,
    visibleItemLimit: input.visibleLimit,
    remainingCount: Math.max(0, count - emailItems.length),
    overviewUrl,
    overviewLabel,
  })
  return {
    subject,
    text,
    html,
    itemIds: sortedPairs.map(({ item }) => item.id),
    accessLinks,
  }
}

function digestRetryAt(batch: TaskReminderDigestBatch) {
  const exponent = Math.max(0, Math.min(6, batch.attempt_count - 1))
  const baseMinutes = Math.min(360, 5 * (2 ** exponent))
  const jitterSeconds = createHash('sha256')
    .update(`digest:${batch.id}:${batch.attempt_count}`)
    .digest()[0] % 60
  return new Date(Date.now() + baseMinutes * 60_000 + jitterSeconds * 1000).toISOString()
}

async function callDigestOutcomeRpc(input: {
  admin: AdminClient
  name:
    | 'fail_task_reminder_digest_batch'
    | 'mark_task_reminder_digest_batch_ambiguous'
  args: Record<string, unknown>
  errorCode: string
}) {
  const { data, error } = await input.admin.rpc(input.name, input.args)
  if (error) throw automationError(input.errorCode)
  return toObject(data)
}

async function processTaskReminderDigestBatch(
  admin: AdminClient,
  batch: TaskReminderDigestBatch,
  workerId: string
) {
  let providerCallStarted = false
  let providerMessageId: string | null = null
  let accessLinks: Array<{ id: string; deliveryKey: string }> = []
  try {
    const [pairs, recipient, visibleLimit] = await Promise.all([
      loadTaskReminderDigestItems(admin, batch),
      loadTaskReminderDigestRecipient(admin, batch),
      loadTaskReminderDigestVisibleLimit(admin, batch.org_id),
    ])
    if (!recipient || !deliveryAddress(recipient, 'email') || pairs.length === 0) {
      const { error } = await admin.rpc('cancel_task_reminder_digest_batch', {
        p_batch_id: batch.id,
        p_worker_id: workerId,
        p_reason: !recipient || !deliveryAddress(recipient, 'email')
          ? 'TASK_REMINDER_DIGEST_RECIPIENT_UNAVAILABLE'
          : 'TASK_REMINDER_DIGEST_NO_CURRENT_ITEMS',
      })
      if (error) throw automationError('TASK_REMINDER_DIGEST_CANCEL_FAILED')
      return 'cancelled' as const
    }

    const content = await buildTaskReminderDigestContent({
      admin,
      batch,
      recipient,
      pairs,
      visibleLimit,
    })
    accessLinks = content.accessLinks
    const providerPayload = {
      digest: true,
      digestBatchId: batch.id,
      itemIds: content.itemIds,
      visibleItemCount: Math.min(content.itemIds.length, visibleLimit),
      accessLinkIds: accessLinks.map((link) => link.id),
      subject: content.subject,
      tokenPersisted: false,
    }
    const { data: reservationData, error: reservationError } = await admin.rpc(
      'start_task_reminder_digest_provider_call',
      {
        p_batch_id: batch.id,
        p_worker_id: workerId,
        p_provider_payload: providerPayload,
      }
    )
    if (reservationError) throw automationError('TASK_REMINDER_DIGEST_START_FAILED')
    const reservation = toObject(reservationData)
    if (reservation.started !== true) {
      await Promise.all(accessLinks.map((link) => revokeUnsentTaskAccessLink(admin, link.id)))
      if (reservation.status === 'cancelled') return 'cancelled' as const
      if (reservation.status === 'dead_letter') return 'dead_letter' as const
      return 'failed' as const
    }
    providerCallStarted = true
    const canonicalAddress = optionalString(reservation.recipientAddress)
      || optionalString(reservation.recipient_address)
      || deliveryAddress(recipient, 'email')
    if (!canonicalAddress) throw automationError('TASK_REMINDER_DIGEST_RECIPIENT_UNAVAILABLE')
    const providerKeyParts = accessLinks.map((link) => link.deliveryKey).sort().join('|')
    providerMessageId = await sendResendEmail({
      to: canonicalAddress,
      replyTo: null,
      subject: content.subject,
      text: content.text,
      html: content.html,
      idempotencyKey: `task-reminder-digest:${batch.id}:attempt:${batch.attempt_count}:${providerKeyParts}`,
    })
    const sentAt = new Date().toISOString()
    if (accessLinks.length > 0) {
      const { error: linkError } = await admin
        .from('task_access_links')
        .update({ sent_at: sentAt })
        .in('id', accessLinks.map((link) => link.id))
        .is('revoked_at', null)
      if (linkError) throw automationError('TASK_REMINDER_DIGEST_ACCESS_LINK_UPDATE_FAILED')
    }
    const { error: finishError } = await admin.rpc('finish_task_reminder_digest_batch', {
      p_batch_id: batch.id,
      p_worker_id: workerId,
      p_provider_message_id: providerMessageId,
      p_subject: content.subject,
      p_provider_payload: providerPayload,
    })
    if (finishError) throw automationError('TASK_REMINDER_DIGEST_FINISH_FAILED')
    return 'sent' as const
  } catch (error) {
    const code = safeErrorCode(error)
    if (providerMessageId || (providerCallStarted && isAmbiguousTaskDeliveryError(error))) {
      try {
        await callDigestOutcomeRpc({
          admin,
          name: 'mark_task_reminder_digest_batch_ambiguous',
          args: {
            p_batch_id: batch.id,
            p_worker_id: workerId,
            p_error_message: providerMessageId
              ? 'TASK_REMINDER_DIGEST_FINALIZATION_AMBIGUOUS'
              : code,
          },
          errorCode: 'TASK_REMINDER_DIGEST_AMBIGUOUS_UPDATE_FAILED',
        })
      } catch {
        console.error('[tasks.automation] digest ambiguity could not be recorded', {
          batchId: batch.id,
          code,
        })
      }
      return 'ambiguous' as const
    }
    await Promise.all(accessLinks.map((link) => revokeUnsentTaskAccessLink(admin, link.id)))
    try {
      const failed = await callDigestOutcomeRpc({
        admin,
        name: 'fail_task_reminder_digest_batch',
        args: {
          p_batch_id: batch.id,
          p_worker_id: workerId,
          p_error_message: code,
          p_retry_at: digestRetryAt(batch),
        },
        errorCode: 'TASK_REMINDER_DIGEST_FAILURE_UPDATE_FAILED',
      })
      return failed.status === 'dead_letter' ? 'dead_letter' as const : 'failed' as const
    } catch {
      console.error('[tasks.automation] digest failure could not be recorded', {
        batchId: batch.id,
        code,
      })
      return 'failed' as const
    }
  }
}

export async function runTaskReminderDigestBatch(input?: {
  limit?: number
  workerId?: string
}): Promise<TaskReminderDigestBatchResult> {
  const admin = createSupabaseAdminClient()
  const workerId = input?.workerId?.trim() || `task-reminder-digest-${randomUUID()}`
  const limit = normalizeInteger(
    input?.limit,
    DEFAULT_DIGEST_BATCH_LIMIT,
    1,
    MAX_DIGEST_BATCH_LIMIT
  )
  const { data, error } = await admin.rpc('claim_task_reminder_digest_batches', {
    p_worker_id: workerId,
    p_limit: limit,
    p_stale_after: '15 minutes',
  })
  if (error) throw automationError('TASK_REMINDER_DIGEST_CLAIM_FAILED')
  const batches = (Array.isArray(data) ? data : [])
    .map(parseTaskReminderDigestBatch)
    .filter((batch): batch is TaskReminderDigestBatch => Boolean(batch))
  const outcomes = await Promise.all(
    batches.map((batch) => processTaskReminderDigestBatch(admin, batch, workerId))
  )
  return {
    claimed: batches.length,
    sent: outcomes.filter((outcome) => outcome === 'sent').length,
    cancelled: outcomes.filter((outcome) => outcome === 'cancelled').length,
    ambiguous: outcomes.filter((outcome) => outcome === 'ambiguous').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
    deadLetter: outcomes.filter((outcome) => outcome === 'dead_letter').length,
  }
}

function nextEvaluationAt(
  task: OperationalTask,
  policy: TaskReminderPolicy,
  now: Date,
  deferredUntil?: string | null
) {
  const deferredTimestamp = deferredUntil ? Date.parse(deferredUntil) : Number.NaN
  if (Number.isFinite(deferredTimestamp) && deferredTimestamp > now.getTime()) {
    return new Date(Math.ceil(deferredTimestamp / 60_000) * 60_000)
  }
  const configuredMinutes = normalizeInteger(
    process.env.TASK_AUTOMATION_RECHECK_MINUTES,
    DEFAULT_RECHECK_MINUTES,
    MIN_RECHECK_MINUTES,
    MAX_RECHECK_MINUTES
  )
  const cadenceMinutes = task.status === 'ready_for_review'
    ? policy.reviewReminderIntervalHours * 60
    : Math.min(policy.minimumExternalContactIntervalHours, policy.overdueCadenceHours) * 60
  const baseDelayMinutes = Math.max(
    MIN_RECHECK_MINUTES,
    Math.min(configuredMinutes, cadenceMinutes)
  )
  const candidates = [now.getTime() + baseDelayMinutes * 60_000]
  for (const dateValue of [task.next_followup_at, task.due_at]) {
    const timestamp = Date.parse(dateValue)
    if (Number.isFinite(timestamp) && timestamp > now.getTime()) candidates.push(timestamp)
  }
  const selected = Math.min(...candidates)
  return new Date(Math.ceil(selected / 60_000) * 60_000)
}

async function enqueueNextEvaluation(input: {
  admin: AdminClient
  task: OperationalTask
  policy: TaskReminderPolicy
  now: Date
  deferredUntil?: string | null
}) {
  const availableAt = nextEvaluationAt(
    input.task,
    input.policy,
    input.now,
    input.deferredUntil
  )
  const idempotencyKey = `task-followup-periodic:${input.task.id}:v${input.task.version}:at:${availableAt.toISOString()}`
  const { error } = await input.admin
    .from('task_automation_jobs')
    .upsert({
      org_id: input.task.org_id,
      task_id: input.task.id,
      job_type: 'evaluate_followup',
      status: 'queued',
      available_at: availableAt.toISOString(),
      idempotency_key: idempotencyKey,
      payload: {
        taskVersion: input.task.version,
        scheduledFrom: 'automation-worker',
      },
    }, {
      onConflict: 'org_id,idempotency_key',
      ignoreDuplicates: true,
    })
  if (error) throw automationError('TASK_AUTOMATION_REQUEUE_FAILED')
}

async function evaluateFollowupJob(admin: AdminClient, job: AutomationJob) {
  if (job.job_type !== 'evaluate_followup') {
    throw automationError('TASK_AUTOMATION_JOB_TYPE_UNSUPPORTED')
  }
  const expectedVersion = expectedTaskVersion(job)
  if (expectedVersion === null) throw automationError('TASK_AUTOMATION_JOB_PAYLOAD_INVALID')
  const task = await loadTask(admin, job)
  if (!task) return 'stale' as const
  if (task.version !== expectedVersion) return 'stale' as const
  if (task.archived_at || task.status === 'draft' || TERMINAL_STATUSES.has(task.status)) {
    return 'completed' as const
  }
  // Historical tasks may still use the database's in-app-only channel. Human
  // event jobs support it through their atomic outbox row, but the periodic
  // email/WhatsApp reminder policy must never reinterpret it as an external
  // provider channel.
  if (!hasExternalTaskChannels(task)) return 'completed' as const

  const [
    { active, maxReminders, policy },
    schedule,
    recipients,
    history,
    pendingDeadlineRequestId,
  ] = await Promise.all([
    loadFollowupPolicy(admin, task),
    loadOrganizationSchedule(admin, task),
    loadRecipients(admin, task),
    loadTaskHistory(admin, task),
    loadPendingDeadlineRequestId(admin, task),
  ])
  if (!active) return 'completed' as const
  const evaluationNow = new Date()
  if (history.unresolvedDeliveryIds.length > 0) {
    await markUnresolvedDeliveriesForReconciliation(
      admin,
      task
    )
    // Resolution is deliberately operator-driven. The service-only resolution
    // RPC writes the audit event and requeues the current task version.
    return 'completed' as const
  }
  const exhaustedFallbackDeliveryId = history.exhaustedFallbackDeliveryId
  if (exhaustedFallbackDeliveryId) {
    const escalationKey = buildTaskPolicyIdempotencyKey(
      task.id,
      'fallback_exhausted',
      exhaustedFallbackDeliveryId
    )
    if (!history.emittedKeys.includes(escalationKey)) {
      const allowedAt = await authoritativeNextAllowedReminderAt(
        admin,
        task.org_id,
        evaluationNow
      )
      if (allowedAt.getTime() > evaluationNow.getTime()) {
        await enqueueNextEvaluation({
          admin,
          task,
          policy,
          now: evaluationNow,
          deferredUntil: allowedAt.toISOString(),
        })
        return 'completed' as const
      }
      const action: TaskReminderAction = {
        kind: 'escalation',
        reason: 'delivery_failed_without_fallback',
        target: 'creator',
        channel: null,
        scheduledFor: evaluationNow.toISOString(),
        idempotencyKey: escalationKey,
      }
      await deliverAction({ admin, job, task, action, recipients })
      // Successful escalation deliberately pauses this exhausted path until a
      // human changes the task. Ambiguous delivery is resumed only by the
      // reconciliation RPC.
      return 'completed' as const
    }
    return 'completed' as const
  }
  if (recipients.assigneeUnavailable) {
    const allowedAt = await authoritativeNextAllowedReminderAt(
      admin,
      task.org_id,
      evaluationNow
    )
    if (allowedAt.getTime() > evaluationNow.getTime()) {
      await enqueueNextEvaluation({
        admin,
        task,
        policy,
        now: evaluationNow,
        deferredUntil: allowedAt.toISOString(),
      })
      return 'completed' as const
    }
    const action: TaskReminderAction = {
      kind: 'escalation',
      reason: 'assignee_unavailable',
      target: 'creator',
      channel: null,
      scheduledFor: evaluationNow.toISOString(),
      idempotencyKey: buildTaskPolicyIdempotencyKey(
        task.id,
        'assignee_unavailable',
        task.version
      ),
    }
    const deliveryOutcome = await deliverAction({ admin, job, task, action, recipients })
    if (deliveryOutcome !== 'ambiguous') {
      await enqueueNextEvaluation({ admin, task, policy, now: evaluationNow })
    }
    return 'completed' as const
  }
  const cappedUnansweredAttempts = history.totalAssigneeReminders >= maxReminders
    ? Math.max(history.unansweredAttempts, policy.pauseAfterUnansweredAttempts)
    : history.unansweredAttempts
  const evaluation = evaluateTaskReminders({
    taskId: task.id,
    status: task.status,
    now: evaluationNow,
    assignedAt: task.created_at,
    dueAt: task.due_at,
    nextFollowUpAt: task.next_followup_at,
    reviewDueAt: task.next_followup_at,
    pendingDeadlineRequestId,
    lastActivityAt: task.last_activity_at,
    lastAssigneeReminderAt: history.lastAssigneeReminderAt,
    lastCreatorReminderAt: history.lastCreatorReminderAt,
    unansweredAttempts: cappedUnansweredAttempts,
    overdueReminderCount: history.overdueReminderCount,
    primaryChannel: task.primary_channel,
    fallbackChannel: exhaustedFallbackDeliveryId ? null : task.fallback_channel,
    primaryDeliveryState: history.primaryDeliveryState,
    primaryDeliveryAttemptId: history.primaryDeliveryAttemptId,
    emittedIdempotencyKeys: history.emittedKeys,
    policy,
    calendar: schedule.calendar,
    sendWindow: schedule.sendWindow,
  })
  if (evaluation.policyIssues.length > 0) {
    throw automationError('TASK_AUTOMATION_POLICY_INVALID')
  }
  let runtimeDeferredUntil = evaluation.externalFollowUpDeferredUntil
  let deliveryBecameAmbiguous = false
  for (const action of evaluation.actions) {
    if (action.kind !== 'assignment') {
      const deliveryCandidate = new Date()
      const allowedAt = await authoritativeNextAllowedReminderAt(
        admin,
        task.org_id,
        deliveryCandidate
      )
      if (allowedAt.getTime() > deliveryCandidate.getTime()) {
        runtimeDeferredUntil = allowedAt.toISOString()
        break
      }
    }
    const deliveryOutcome = await deliverAction({ admin, job, task, action, recipients })
    if (deliveryOutcome === 'ambiguous') {
      deliveryBecameAmbiguous = true
      break
    }
  }
  if (
    !deliveryBecameAmbiguous
    && (
      runtimeDeferredUntil
      || !evaluation.externalFollowUpPaused
      || task.status === 'ready_for_review'
    )
  ) {
    await enqueueNextEvaluation({
      admin,
      task,
      policy,
      now: evaluationNow,
      deferredUntil: runtimeDeferredUntil,
    })
  }
  return 'completed' as const
}

function retryAt(job: AutomationJob) {
  const exponent = Math.max(0, Math.min(6, job.attempt_count - 1))
  const baseMinutes = Math.min(360, 5 * (2 ** exponent))
  const jitterSeconds = createHash('sha256').update(`${job.id}:${job.attempt_count}`).digest()[0] % 60
  return new Date(Date.now() + baseMinutes * 60_000 + jitterSeconds * 1000).toISOString()
}

async function finishJob(input: {
  admin: AdminClient
  job: AutomationJob
  workerId: string
  succeeded: boolean
  errorCode?: string
}) {
  const { error } = await input.admin.rpc('finish_task_automation_job', {
    p_job_id: input.job.id,
    p_worker_id: input.workerId,
    p_succeeded: input.succeeded,
    p_error_message: input.succeeded ? null : input.errorCode ?? 'TASK_AUTOMATION_JOB_FAILED',
    p_retry_at: input.succeeded ? null : retryAt(input.job),
  })
  if (error) throw automationError('TASK_AUTOMATION_JOB_FINISH_FAILED')
}

async function processJob(admin: AdminClient, job: AutomationJob, workerId: string) {
  try {
    const outcome = job.job_type === 'evaluate_followup'
      ? await evaluateFollowupJob(admin, job)
      : job.job_type === 'send_message'
        ? await deliverTaskNotificationJob(admin, job)
        : (() => {
            throw automationError('TASK_AUTOMATION_JOB_TYPE_UNSUPPORTED')
          })()
    await finishJob({ admin, job, workerId, succeeded: true })
    return outcome
  } catch (error) {
    const code = safeErrorCode(error)
    if (code === 'TASK_AUTOMATION_TASK_STALE') {
      await finishJob({ admin, job, workerId, succeeded: true })
      return 'stale' as const
    }
    console.error('[tasks.automation] job failed', {
      jobId: job.id,
      taskId: job.task_id,
      attempt: job.attempt_count,
      code,
    })
    try {
      await finishJob({ admin, job, workerId, succeeded: false, errorCode: code })
    } catch {
      console.error('[tasks.automation] could not finish claimed job', {
        jobId: job.id,
        code: 'TASK_AUTOMATION_JOB_FINISH_FAILED',
      })
    }
    return 'failed' as const
  }
}

export async function runTaskFollowupBatch(input?: {
  limit?: number
  workerId?: string
}): Promise<TaskAutomationBatchResult> {
  const admin = createSupabaseAdminClient()
  const workerId = input?.workerId?.trim() || `task-followup-${randomUUID()}`
  const limit = normalizeInteger(
    input?.limit,
    getTaskAutomationBatchLimit(),
    1,
    getTaskAutomationBatchLimit()
  )
  const { data, error } = await admin.rpc('claim_task_automation_jobs', {
    p_worker_id: workerId,
    p_limit: limit,
    p_stale_after: '15 minutes',
  })
  if (error) throw automationError('TASK_AUTOMATION_JOB_CLAIM_FAILED')
  const jobs = (Array.isArray(data) ? data : [])
    .map(parseAutomationJob)
    .filter((job): job is AutomationJob => Boolean(job))
  const outcomes: Array<'completed' | 'stale' | 'failed'> = []
  const concurrency = normalizeInteger(
    process.env.TASK_AUTOMATION_CONCURRENCY,
    4,
    1,
    MAX_BATCH_LIMIT
  )
  for (let index = 0; index < jobs.length; index += concurrency) {
    const batch = jobs.slice(index, index + concurrency)
    outcomes.push(...await Promise.all(
      batch.map((job) => processJob(admin, job, workerId))
    ))
  }
  return {
    claimed: jobs.length,
    completed: outcomes.filter((outcome) => outcome === 'completed').length,
    stale: outcomes.filter((outcome) => outcome === 'stale').length,
    failed: outcomes.filter((outcome) => outcome === 'failed').length,
  }
}
