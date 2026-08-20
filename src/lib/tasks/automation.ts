import { createHash, randomUUID } from 'node:crypto'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  buildTaskPolicyIdempotencyKey,
  DEFAULT_TASK_REMINDER_POLICY,
  evaluateTaskReminders,
  type TaskCommunicationChannel,
  type TaskDeliveryState,
  type TaskReminderAction,
  type TaskReminderPolicy,
} from '@/lib/tasks/domain'
import type { TaskStatus } from '@/lib/tasks/contracts'
import { buildTaskEmailHtml } from '@/lib/tasks/emailTemplates'

type AdminClient = ReturnType<typeof createSupabaseAdminClient>

type AutomationJob = {
  id: string
  org_id: string
  task_id: string
  job_type: string
  attempt_count: number
  max_attempts: number
  available_at: string
  payload: Record<string, unknown>
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
  next_followup_at: string
  primary_channel: TaskCommunicationChannel
  fallback_channel: TaskCommunicationChannel | null
  last_activity_at: string
  submitted_for_review_at: string | null
  created_at: string
  version: number
  archived_at: string | null
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
  status: 'queued' | 'sending' | 'sent' | 'delivered' | 'read' | 'replied' | 'failed' | 'cancelled'
  attempt_count: number
  max_attempts: number
  idempotency_key: string
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
}

type DeliveryResult = {
  delivered: boolean
  deliveryId: string
  messageId: string
  errorCode: string | null
}

export type TaskAutomationBatchResult = {
  claimed: number
  completed: number
  stale: number
  failed: number
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
const SUCCESSFUL_DELIVERY_STATUSES = new Set<StoredDelivery['status']>([
  'sent',
  'delivered',
  'read',
  'replied',
])
const DEFAULT_BATCH_LIMIT = 20
const MAX_BATCH_LIMIT = 50
const DEFAULT_RECHECK_MINUTES = 60
const MIN_RECHECK_MINUTES = 15
const MAX_RECHECK_MINUTES = 24 * 60
// vercel.json deliberately invokes v1 once per day so Hobby deployments remain
// valid. A Vercel Pro deployment can change the expression to `*/15 * * * *`;
// the database queue and this minimum recheck guard are already safe for it.

function automationError(code: string): TaskAutomationError {
  return new TaskAutomationError(code)
}

function safeErrorCode(error: unknown) {
  if (error instanceof TaskAutomationError) return error.code
  return 'TASK_AUTOMATION_INTERNAL_ERROR'
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

function toObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
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
    job_type: row.job_type,
    attempt_count: normalizeInteger(row.attempt_count, 1, 0, 20),
    max_attempts: normalizeInteger(row.max_attempts, 5, 1, 20),
    available_at: row.available_at,
    payload,
  }
}

function expectedTaskVersion(job: AutomationJob) {
  const version = Number(job.payload.taskVersion)
  return Number.isInteger(version) && version > 0 ? version : null
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
    || typeof row.next_followup_at !== 'string'
    || typeof row.last_activity_at !== 'string'
    || typeof row.created_at !== 'string'
    || !isTaskStatus(row.status)
    || !isCommunicationChannel(row.primary_channel)
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
    next_followup_at: row.next_followup_at,
    primary_channel: row.primary_channel,
    fallback_channel: isCommunicationChannel(row.fallback_channel) ? row.fallback_channel : null,
    last_activity_at: row.last_activity_at,
    submitted_for_review_at: typeof row.submitted_for_review_at === 'string'
      ? row.submitted_for_review_at
      : null,
    created_at: row.created_at,
    version,
    archived_at: typeof row.archived_at === 'string' ? row.archived_at : null,
  }
}

async function loadTask(admin: AdminClient, job: AutomationJob) {
  const { data, error } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,status,due_at,next_followup_at,primary_channel,fallback_channel,last_activity_at,submitted_for_review_at,created_at,version,archived_at'
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

function messageTarget(message: StoredMessage | undefined) {
  if (message?.metadata?.target === 'creator' || message?.metadata?.target === 'assignee') {
    return message.metadata.target
  }
  // Access-link delivery predates the worker metadata but is still an assignee
  // contact. Counting it prevents an immediate duplicate assignment reminder.
  return message?.message_type === 'assignment' ? 'assignee' : null
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

async function loadTaskHistory(
  admin: AdminClient,
  task: OperationalTask
): Promise<TaskHistory> {
  const { data: messageData, error: messageError } = await admin
    .from('task_messages')
    .select('id,created_at,message_type,metadata')
    .eq('task_id', task.id)
    .eq('org_id', task.org_id)
    .order('created_at', { ascending: false })
    .limit(300)
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
      emittedKeys: [],
      lastAssigneeReminderAt: null,
      lastCreatorReminderAt: null,
      unansweredAttempts: 0,
      overdueReminderCount: 0,
      primaryDeliveryState: 'unknown',
      primaryDeliveryAttemptId: null,
      totalAssigneeReminders: 0,
    }
  }

  const { data: deliveryData, error: deliveryError } = await admin
    .from('task_message_deliveries')
    .select('id,message_id,channel,status,attempt_count,max_attempts,idempotency_key,created_at')
    .eq('task_id', task.id)
    .eq('org_id', task.org_id)
    .in('message_id', messages.map((message) => message.id))
    .order('created_at', { ascending: false })
    .limit(500)
  if (deliveryError) throw automationError('TASK_AUTOMATION_HISTORY_READ_FAILED')

  const deliveries = (deliveryData ?? []).map((value) => {
    const row = toObject(value)
    return {
      id: String(row.id ?? ''),
      message_id: String(row.message_id ?? ''),
      channel: String(row.channel ?? '') as StoredDelivery['channel'],
      status: String(row.status ?? '') as StoredDelivery['status'],
      attempt_count: normalizeInteger(row.attempt_count, 0, 0, 20),
      max_attempts: normalizeInteger(row.max_attempts, 5, 1, 20),
      idempotency_key: String(row.idempotency_key ?? ''),
      created_at: String(row.created_at ?? ''),
    } satisfies StoredDelivery
  }).filter((delivery) => delivery.id && delivery.message_id && delivery.idempotency_key)
  const messagesById = new Map(messages.map((message) => [message.id, message]))
  const successful = deliveries.filter((delivery) => SUCCESSFUL_DELIVERY_STATUSES.has(delivery.status))
  const assigneeSuccessful = successful.filter(
    (delivery) => messageTarget(messagesById.get(delivery.message_id)) === 'assignee'
  )
  const creatorSuccessful = successful.filter(
    (delivery) => messageTarget(messagesById.get(delivery.message_id)) === 'creator'
  )
  const lastActivityMs = Date.parse(task.last_activity_at)
  const unansweredAttempts = assigneeSuccessful.filter(
    (delivery) => Date.parse(delivery.created_at) > lastActivityMs
  ).length
  const overdueReminderCount = assigneeSuccessful.filter((delivery) => {
    const metadata = messagesById.get(delivery.message_id)?.metadata
    return metadata?.actionKind === 'overdue'
  }).length
  const latestPrimary = deliveries.find((delivery) => {
    const message = messagesById.get(delivery.message_id)
    return delivery.channel === task.primary_channel && messageTarget(message) === 'assignee'
  })
  const primaryDeliveryState: TaskDeliveryState = !latestPrimary
    ? 'unknown'
    : latestPrimary.status === 'failed'
      ? 'failed'
      : SUCCESSFUL_DELIVERY_STATUSES.has(latestPrimary.status)
        ? 'delivered'
        : 'pending'
  const emittedKeys = new Set<string>()
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
    lastAssigneeReminderAt: latestIso(assigneeSuccessful.map((delivery) => delivery.created_at)),
    lastCreatorReminderAt: latestIso(creatorSuccessful.map((delivery) => delivery.created_at)),
    unansweredAttempts,
    overdueReminderCount,
    primaryDeliveryState,
    primaryDeliveryAttemptId: latestPrimary?.id ?? null,
    totalAssigneeReminders: assigneeSuccessful.length,
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

function dueDateLabel(value: string) {
  return new Intl.DateTimeFormat('sv-SE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'Europe/Stockholm',
  }).format(new Date(value))
}

function actionHeading(action: TaskReminderAction) {
  switch (action.kind) {
    case 'assignment': return 'Nytt uppdrag'
    case 'due_soon': return 'Uppdraget närmar sig slutdatum'
    case 'due_today': return 'Uppdraget har slutdatum idag'
    case 'overdue': return 'Uppdraget är försenat'
    case 'status_check': return 'Signe behöver en statusuppdatering'
    case 'review_follow_up': return 'Uppdraget väntar på kontroll'
    case 'review_overdue': return 'Kontrollen av uppdraget är försenad'
    case 'deadline_change_request': return 'Nytt önskemål om förlängt slutdatum'
    case 'escalation': return 'Signe behöver din hjälp'
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
}) {
  const heading = actionHeading(input.action)
  const instruction = actionInstruction(input.action)
  const dueLabel = dueDateLabel(input.task.due_at)
  const internalUrl = input.recipient.kind === 'profile'
    ? `${appBaseUrl()}/uppdrag?task=${encodeURIComponent(input.task.id)}`
    : null
  const externalLinkNote = input.recipient.kind === 'contact'
    ? 'Öppna uppdraget via den personliga länken i det första utskicket.'
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
    internalUrl ? `Öppna uppdraget: ${internalUrl}` : externalLinkNote,
    '',
    'Hälsningar, Signe',
  ].filter((line): line is string => line !== null).join('\n')
  const html = buildTaskEmailHtml({
    previewText: `${heading}: ${input.task.title}`,
    eyebrow: 'Signe följer upp',
    heading,
    recipientName: input.recipient.name,
    lead: 'Signe följer upp uppdraget och ser till att nästa steg blir tydligt.',
    taskTitle: input.task.title,
    contextLabel: input.task.context_label,
    dueLabel,
    instruction,
    actionUrl: internalUrl,
    actionLabel: 'Öppna uppdraget',
    notice: externalLinkNote,
  })
  return { subject: `${heading}: ${input.task.title}`, text, html }
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
  const timeoutMs = normalizeInteger(process.env.RESEND_REQUEST_TIMEOUT_MS, 15000, 1000, 30000)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  let response: Response
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
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw automationError('TASK_EMAIL_PROVIDER_TIMEOUT')
    }
    throw automationError('TASK_EMAIL_PROVIDER_UNAVAILABLE')
  } finally {
    clearTimeout(timeout)
  }
  const body = toObject(await response.json().catch(() => ({})))
  if (!response.ok) {
    console.error('[tasks.automation] Resend rejected reminder', {
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    })
    throw automationError('TASK_EMAIL_PROVIDER_REJECTED')
  }
  return typeof body.id === 'string' ? body.id : null
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
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw automationError('TASK_WHATSAPP_PROVIDER_TIMEOUT')
    }
    throw automationError('TASK_WHATSAPP_PROVIDER_UNAVAILABLE')
  } finally {
    clearTimeout(timeout)
  }
  const body = toObject(await response.json().catch(() => ({})))
  if (!response.ok) {
    console.error('[tasks.automation] WhatsApp rejected reminder', {
      status: response.status,
      requestId: response.headers.get('x-fb-trace-id'),
    })
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
      dueDateLabel(input.dueAt),
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
  content: { subject: string; text: string; html: string }
}) {
  const { data: existingData, error: existingError } = await input.admin
    .from('task_message_deliveries')
    .select('id,message_id,channel,status,attempt_count,max_attempts,idempotency_key,created_at')
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
      actor_name: 'Signe',
      body_text: input.content.text,
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
      },
    })
    .select('id')
    .single()
  if (messageError || !messageData?.id) throw automationError('TASK_MESSAGE_CREATE_FAILED')

  const address = deliveryAddress(input.recipient, input.channel)
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
      },
    })
    .select('id,message_id,channel,status,attempt_count,max_attempts,idempotency_key,created_at')
    .single()
  if (deliveryError || !deliveryData) {
    const { data: racedDelivery } = await input.admin
      .from('task_message_deliveries')
      .select('id,message_id,channel,status,attempt_count,max_attempts,idempotency_key,created_at')
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
    actor_name: 'Signe',
    message: input.action.target === 'creator'
      ? `Signe uppmärksammade ${input.recipient.name} via ${input.channel === 'email' ? 'e-post' : 'WhatsApp'}.`
      : `Signe skickade en uppföljning till ${input.recipient.name} via ${input.channel === 'email' ? 'e-post' : 'WhatsApp'}.`,
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
  errorCode: string
) {
  const { error } = await admin
    .from('task_message_deliveries')
    .update({
      status: 'failed',
      failed_at: new Date().toISOString(),
      next_attempt_at: null,
      error_message: errorCode,
    })
    .eq('id', deliveryId)
  if (error) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
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
  const content = buildReminderContent({
    action: input.action,
    task: input.task,
    recipient: input.recipient,
  })
  const delivery = await ensureDelivery({ ...input, content })
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
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: null,
    }
  }
  if (delivery.status === 'cancelled' || delivery.attempt_count >= delivery.max_attempts) {
    return {
      delivered: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_ATTEMPTS_EXHAUSTED',
    }
  }
  if (delivery.status === 'sending' && input.channel === 'whatsapp') {
    await updateDeliveryFailure(input.admin, delivery.id, 'TASK_WHATSAPP_DELIVERY_AMBIGUOUS')
    return {
      delivered: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_WHATSAPP_DELIVERY_AMBIGUOUS',
    }
  }

  const address = deliveryAddress(input.recipient, input.channel)
  if (!address) {
    await updateDeliveryFailure(input.admin, delivery.id, 'TASK_DELIVERY_ADDRESS_MISSING')
    return {
      delivered: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode: 'TASK_DELIVERY_ADDRESS_MISSING',
    }
  }
  const { data: sendingData, error: sendingError } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'sending',
      attempt_count: delivery.attempt_count + 1,
      failed_at: null,
      next_attempt_at: null,
      error_message: null,
    })
    .eq('id', delivery.id)
    .eq('status', delivery.status)
    .eq('attempt_count', delivery.attempt_count)
    .select('id')
    .maybeSingle()
  if (sendingError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
  if (!sendingData) throw automationError('TASK_DELIVERY_CONCURRENT_ATTEMPT')

  let providerMessageId: string | null
  try {
    providerMessageId = input.channel === 'email'
      ? await sendResendEmail({
          to: address,
          replyTo: input.issuer.email,
          subject: content.subject,
          text: content.text,
          html: content.html,
          idempotencyKey: input.idempotencyKey,
        })
      : await sendWhatsAppTemplate({
          to: address,
          templateName: process.env.WHATSAPP_TEMPLATE_NAME?.trim() || null,
          parameters: [
            input.recipient.name.slice(0, 256),
            input.task.title.slice(0, 1024),
            dueDateLabel(input.task.due_at),
          ],
          idempotencyKey: input.idempotencyKey,
        })
  } catch (error) {
    const errorCode = safeErrorCode(error)
    await updateDeliveryFailure(input.admin, delivery.id, errorCode)
    return {
      delivered: false,
      deliveryId: delivery.id,
      messageId: delivery.message_id,
      errorCode,
    }
  }

  const sentAt = new Date().toISOString()
  const { error: sentError } = await input.admin
    .from('task_message_deliveries')
    .update({
      status: 'sent',
      sent_at: sentAt,
      provider_message_id: providerMessageId,
      error_message: null,
    })
    .eq('id', delivery.id)
  if (sentError) throw automationError('TASK_DELIVERY_UPDATE_FAILED')
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
    deliveryId: delivery.id,
    messageId: delivery.message_id,
    errorCode: null,
  }
}

async function deliverAction(input: {
  admin: AdminClient
  job: AutomationJob
  task: OperationalTask
  action: TaskReminderAction
  recipients: { creator: Recipient; assignee: Recipient; issuer: Profile }
}) {
  const recipient = input.action.target === 'creator'
    ? input.recipients.creator
    : input.recipients.assignee
  const selectedChannel: TaskCommunicationChannel = input.action.target === 'creator'
    ? 'email'
    : input.action.channel ?? input.task.primary_channel
  const primaryResult = await deliverViaChannel({
    ...input,
    recipient,
    issuer: input.recipients.issuer,
    channel: selectedChannel,
    idempotencyKey: input.action.idempotencyKey,
    isFallback: input.action.kind === 'delivery_fallback'
      || selectedChannel === input.task.fallback_channel,
  })
  if (primaryResult.delivered) return

  const fallbackChannel = input.action.target === 'assignee'
    && input.action.kind !== 'delivery_fallback'
    && input.task.fallback_channel
    && input.task.fallback_channel !== selectedChannel
    ? input.task.fallback_channel
    : null
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
  if (!fallbackResult.delivered) {
    throw automationError(fallbackResult.errorCode ?? 'TASK_DELIVERY_FALLBACK_FAILED')
  }
}

function nextEvaluationAt(task: OperationalTask, policy: TaskReminderPolicy, now: Date) {
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
  const earliest = now.getTime() + MIN_RECHECK_MINUTES * 60_000
  const candidates = [now.getTime() + baseDelayMinutes * 60_000]
  for (const dateValue of [task.next_followup_at, task.due_at]) {
    const timestamp = Date.parse(dateValue)
    if (Number.isFinite(timestamp) && timestamp >= earliest) candidates.push(timestamp)
  }
  const selected = Math.max(earliest, Math.min(...candidates))
  return new Date(Math.ceil(selected / 60_000) * 60_000)
}

async function enqueueNextEvaluation(input: {
  admin: AdminClient
  task: OperationalTask
  policy: TaskReminderPolicy
  now: Date
}) {
  const availableAt = nextEvaluationAt(input.task, input.policy, input.now)
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

  const [{ active, maxReminders, policy }, recipients, history, pendingDeadlineRequestId] = await Promise.all([
    loadFollowupPolicy(admin, task),
    loadRecipients(admin, task),
    loadTaskHistory(admin, task),
    loadPendingDeadlineRequestId(admin, task),
  ])
  if (!active) return 'completed' as const
  if (recipients.assigneeUnavailable) {
    const action: TaskReminderAction = {
      kind: 'escalation',
      reason: 'assignee_unavailable',
      target: 'creator',
      channel: null,
      scheduledFor: new Date().toISOString(),
      idempotencyKey: buildTaskPolicyIdempotencyKey(
        task.id,
        'assignee_unavailable',
        task.version
      ),
    }
    await deliverAction({ admin, job, task, action, recipients })
    await enqueueNextEvaluation({ admin, task, policy, now: new Date() })
    return 'completed' as const
  }
  const cappedUnansweredAttempts = history.totalAssigneeReminders >= maxReminders
    ? Math.max(history.unansweredAttempts, policy.pauseAfterUnansweredAttempts)
    : history.unansweredAttempts
  const evaluation = evaluateTaskReminders({
    taskId: task.id,
    status: task.status,
    now: new Date(),
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
    fallbackChannel: task.fallback_channel,
    primaryDeliveryState: history.primaryDeliveryState,
    primaryDeliveryAttemptId: history.primaryDeliveryAttemptId,
    emittedIdempotencyKeys: history.emittedKeys,
    policy,
  })
  if (evaluation.policyIssues.length > 0) {
    throw automationError('TASK_AUTOMATION_POLICY_INVALID')
  }
  for (const action of evaluation.actions) {
    await deliverAction({ admin, job, task, action, recipients })
  }
  if (!evaluation.externalFollowUpPaused || task.status === 'ready_for_review') {
    await enqueueNextEvaluation({ admin, task, policy, now: new Date() })
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
    const outcome = await evaluateFollowupJob(admin, job)
    await finishJob({ admin, job, workerId, succeeded: true })
    return outcome
  } catch (error) {
    const code = safeErrorCode(error)
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
    8
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
