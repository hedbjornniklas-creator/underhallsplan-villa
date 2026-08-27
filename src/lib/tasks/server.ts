import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type {
  TaskActionResponse,
  TaskAiSuggestionView,
  TaskAttachmentView,
  TaskChannel,
  TaskCompletionEvidenceType,
  TaskDeadlineRequestView,
  TaskEventView,
  TaskEvidenceRequirement,
  TaskKind,
  TaskNotificationDeliveryStatus,
  TaskNotificationDeliveryView,
  TaskPerson,
  TaskRequirementStatus,
  TaskRequirementView,
  TaskRecurrenceInterval,
  TaskStatus,
  TaskView,
  TaskWorkspace,
} from './contracts'
import {
  TASK_COMPLETION_EVIDENCE_TYPES,
  TASK_RECURRENCE_INTERVALS,
  evidenceTypesFromLegacyRequirement,
  legacyRequirementFromEvidenceTypes,
} from './contracts'
import {
  buildTaskAnalyticsScope,
  buildTaskAssigneeAnalytics,
  type TaskAnalyticsAssigneeInput,
  type TaskAnalyticsDeadlineRequestInput,
  type TaskAnalyticsTaskInput,
} from './analytics'
import {
  DEFAULT_TASK_AUTOMATION_LIMITS,
  evaluateTaskRisk,
  getTaskBallHolderKind,
  isTaskStatus,
  isTerminalTaskStatus,
} from './domain'
import { normalizeTaskTimeZone } from './dateTime'
import { taskActorDisplayName } from './branding'
import { issueTaskAccessLink, resolveTaskPublicBaseUrl } from './external'
import { rejectSigneSuggestion, requestSigneSuggestions } from './signe'
import {
  getInternalTaskModuleAccessProfileIds,
  hasInternalTaskModuleAccess,
} from './internalAccess'
import {
  loadTaskConversationSnapshots,
  markTaskConversationRead,
  notifyTaskComment,
  taskEventAuthorSide,
} from './conversation'

export const TASK_LIMITS = {
  maxDepth: DEFAULT_TASK_AUTOMATION_LIMITS.maxAiDepth,
  maxOpenChildren: DEFAULT_TASK_AUTOMATION_LIMITS.maxOpenChildrenPerTask,
  maxActiveDescendants: DEFAULT_TASK_AUTOMATION_LIMITS.maxActiveDescendantsPerRoot,
} as const

type OperationalTaskRow = {
  id: string
  org_id: string
  parent_task_id: string | null
  root_task_id: string | null
  depth: number
  issuer_profile_id: string
  assignee_profile_id: string | null
  assignee_contact_id: string | null
  title: string
  description: string | null
  context_label: string | null
  task_kind: TaskKind
  status: TaskStatus
  due_at: string
  due_timezone: string
  next_followup_at: string
  primary_channel: TaskChannel
  fallback_channel: TaskChannel | null
  evidence_requirement: TaskEvidenceRequirement
  review_round: number
  version: number
  created_source: string
  submitted_for_review_at: string | null
  approved_at: string | null
  approved_by_profile_id: string | null
  created_by_profile_id: string | null
  archived_at: string | null
  created_at: string
  updated_at: string
}

type ContactRow = {
  id: string
  profile_id: string | null
  name: string
  company_name: string | null
  email: string | null
  phone: string | null
  whatsapp_number: string | null
  is_active: boolean
}

type ProfileRow = {
  id: string
  full_name: string | null
  email: string | null
}

type RequirementRow = {
  id: string
  task_id: string
  requirement_key: string
  label: string
  status: TaskRequirementStatus
  is_required: boolean
  verified_by_profile_id: string | null
  verified_at: string | null
}

type CompletionEvidenceRequirementRow = {
  task_id: string
  evidence_type: TaskCompletionEvidenceType
}

type EventRow = {
  id: string
  task_id: string
  event_type: string
  actor_type: string
  actor_name: string | null
  actor_profile_id: string | null
  actor_contact_id: string | null
  message: string | null
  from_status: TaskStatus | null
  to_status: TaskStatus | null
  created_at: string
}

type DeadlineRequestRow = {
  id: string
  task_id: string
  current_due_at: string
  requested_due_at: string
  reason: string
  status: 'pending' | 'approved' | 'rejected' | 'cancelled'
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

type AttachmentRow = {
  id: string
  task_id: string
  attachment_type: 'photo' | 'document' | 'audio' | 'text'
  title: string | null
  file_name: string | null
  content_type: string | null
  text_content: string | null
  transcript_text: string | null
  is_completion_evidence: boolean
  created_at: string
}

type AiSuggestionRow = {
  id: string
  task_id: string
  suggestion_type: 'create_subtask'
  title: string
  description: string | null
  proposed_payload: Record<string, unknown>
  status: 'pending'
  created_at: string
}

type FollowupRuleRow = {
  task_id: string
  initial_dispatch_pending: boolean
}

type RecurrenceRuleRow = {
  task_id: string
  recurrence_interval: TaskRecurrenceInterval
  sequence: number
  is_active: boolean
}

type NotificationMessageRow = {
  message_type: string
  metadata: Record<string, unknown> | null
}

type NotificationDeliveryRow = {
  id: string
  task_id: string
  message_id: string
  channel: TaskChannel | 'in_app'
  status: TaskNotificationDeliveryStatus
  is_fallback: boolean
  scheduled_at: string
  sent_at: string | null
  delivered_at: string | null
  read_at: string | null
  replied_at: string | null
  failed_at: string | null
  created_at: string
  updated_at: string
  message: NotificationMessageRow | NotificationMessageRow[] | null
}

type NotificationJobRow = {
  id: string
  task_id: string
  status: 'queued' | 'processing' | 'failed' | 'dead_letter'
  payload: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

type InternalTaskContext = {
  orgId: string
  userId: string
  isOrgAdmin: boolean
}

type TaskActionInput = InternalTaskContext & {
  action: string
  payload: Record<string, unknown>
  requestOrigin?: string | null
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  const normalized = asText(value)
  return normalized || null
}

function parseIsoTimestamp(value: unknown, errorCode: string) {
  const text = asText(value)
  const date = new Date(text)
  if (!text || Number.isNaN(date.getTime())) throw new Error(errorCode)
  return date.toISOString()
}

function requireExpectedVersion(value: unknown) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) throw new Error('TASK_VERSION_REQUIRED')
  return version
}

function taskDatabaseError(error: { message?: string | null } | null, fallback: string) {
  const code = error?.message?.match(/TASK_[A-Z0-9_]+/)?.[0]
  return new Error(code ?? fallback)
}

function isTaskKind(value: unknown): value is TaskKind {
  return value === 'simple' || value === 'paid_external' || value === 'warranty' || value === 'general'
}

function isTaskChannel(value: unknown): value is TaskChannel {
  return value === 'email' || value === 'whatsapp'
}

function notificationMessage(row: NotificationDeliveryRow) {
  return Array.isArray(row.message) ? row.message[0] ?? null : row.message
}

function notificationMetadataText(metadata: Record<string, unknown> | null, key: string) {
  const value = metadata?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

function notificationDeliveryEventId(row: NotificationDeliveryRow) {
  const metadata = notificationMessage(row)?.metadata ?? null
  return (
    notificationMetadataText(metadata, 'sourceEventId') ||
    notificationMetadataText(metadata, 'eventId') ||
    null
  )
}

function isRelevantNotificationDelivery(row: NotificationDeliveryRow) {
  const message = notificationMessage(row)
  if (!message) return false
  const metadata = message.metadata
  return Boolean(
    message.message_type === 'assignment' ||
      metadata?.notification === true ||
      notificationMetadataText(metadata, 'sourceEventId') ||
      notificationMetadataText(metadata, 'eventId') ||
      notificationMetadataText(metadata, 'eventType') ||
      notificationMetadataText(metadata, 'actionKind')
  )
}

function notificationLabel(eventKind: string, toStatus?: string | null) {
  const normalizedEventKind = eventKind.toLowerCase()
  const kind = normalizedEventKind === 'status_changed'
    ? toStatus?.toLowerCase() ?? ''
    : normalizedEventKind
  switch (kind) {
    case 'assignment':
      return 'Nytt uppdrag'
    case 'comment':
      return 'Nytt meddelande'
    case 'deadline_change_request':
    case 'deadline_change_requested':
      return 'Begärd förlängning'
    case 'deadline_change_approved':
      return 'Förlängning godkänd'
    case 'deadline_change_rejected':
      return 'Förlängning avslagen'
    case 'waiting':
    case 'task_waiting':
      return 'Uppdraget väntar'
    case 'ready_for_review':
    case 'task_ready_for_review':
      return 'Klart för kontroll'
    case 'returned':
    case 'task_returned':
      return 'Komplettering begärd'
    case 'approved':
    case 'task_approved':
      return 'Uppdrag godkänt'
    case 'cancelled':
    case 'task_cancelled':
      return 'Uppdrag avbrutet'
    case 'status_request':
    case 'status_check':
      return 'Statusförfrågan'
    case 'reminder':
      return 'Påminnelse'
    case 'escalation':
      return 'Uppföljning'
    case 'decision':
      return 'Beslut om uppdraget'
    default:
      return 'Uppdragsnotis'
  }
}

function notificationDeliveryLabel(row: NotificationDeliveryRow) {
  const message = notificationMessage(row)
  const metadata = message?.metadata ?? null
  return notificationLabel(
    notificationMetadataText(metadata, 'eventType') ||
      notificationMetadataText(metadata, 'actionKind') ||
      message?.message_type ||
      '',
    notificationMetadataText(metadata, 'toStatus')
  )
}

function notificationDeliveryStatusAt(row: NotificationDeliveryRow) {
  if (row.status === 'replied') return row.replied_at ?? row.updated_at
  if (row.status === 'read') return row.read_at ?? row.updated_at
  if (row.status === 'delivered') return row.delivered_at ?? row.updated_at
  if (row.status === 'sent') return row.sent_at ?? row.updated_at
  if (row.status === 'failed') return row.failed_at ?? row.updated_at
  return row.updated_at || row.scheduled_at || row.created_at
}

function isEvidenceRequirement(value: unknown): value is TaskEvidenceRequirement {
  return value === 'optional' || value === 'text' || value === 'photo' || value === 'document' || value === 'any'
}

function parseEvidenceRequirements(value: unknown): TaskCompletionEvidenceType[] {
  if (!Array.isArray(value)) return []
  const allowed = new Set<string>(TASK_COMPLETION_EVIDENCE_TYPES)
  if (value.some((item) => typeof item !== 'string' || !allowed.has(item))) {
    throw new Error('TASK_EVIDENCE_CHECKLIST_INVALID')
  }
  return Array.from(new Set(value as TaskCompletionEvidenceType[]))
}

function actorCanSeeTaskTree(rows: OperationalTaskRow[], userId: string, isOrgAdmin: boolean) {
  if (isOrgAdmin) return new Set(rows.map((row) => row.id))

  const byId = new Map(rows.map((row) => [row.id, row]))
  const children = new Map<string, OperationalTaskRow[]>()
  for (const row of rows) {
    if (!row.parent_task_id) continue
    const existing = children.get(row.parent_task_id) ?? []
    existing.push(row)
    children.set(row.parent_task_id, existing)
  }

  const visible = new Set<string>()
  const addDescendants = (taskId: string) => {
    for (const child of children.get(taskId) ?? []) {
      if (visible.has(child.id)) continue
      visible.add(child.id)
      addDescendants(child.id)
    }
  }
  const addAncestors = (row: OperationalTaskRow) => {
    let current = row
    while (current.parent_task_id) {
      const parent = byId.get(current.parent_task_id)
      if (!parent) break
      visible.add(parent.id)
      current = parent
    }
  }

  for (const row of rows) {
    if (row.issuer_profile_id !== userId && row.assignee_profile_id !== userId) continue
    visible.add(row.id)
    addAncestors(row)
    addDescendants(row.id)
  }

  return visible
}

function requirementTemplates(kind: TaskKind, evidence: readonly TaskCompletionEvidenceType[]) {
  const requirements: Array<{ requirement_key: string; label: string; is_required: boolean; status: TaskRequirementStatus }> = []
  if (kind === 'paid_external') {
    requirements.push(
      { requirement_key: 'written_quote', label: 'Skriftlig offert finns', is_required: true, status: 'pending' },
      {
        requirement_key: 'written_client_approval',
        label: 'Skriftligt godkännande från beställaren finns',
        is_required: true,
        status: 'pending',
      }
    )
  }
  if (kind === 'warranty') {
    requirements.push({
      requirement_key: 'warranty_basis',
      label: 'Garantiunderlag är dokumenterat',
      is_required: true,
      status: 'pending',
    })
  }
  if (evidence.length > 0) {
    const labels: Record<TaskCompletionEvidenceType, string> = {
      text: 'textredovisning',
      photo: 'foto',
      document: 'dokument',
    }
    const evidenceLabel = evidence.map((type) => labels[type]).join(', ')
    requirements.push({
      requirement_key: 'completion_evidence',
      label: `Färdigbevis finns: ${evidenceLabel}`,
      is_required: true,
      status: 'pending',
    })
  }
  return requirements
}

async function loadRows(orgId: string) {
  const admin = createSupabaseAdminClient()
  const [taskResult, contactResult, memberResult, settingsResult] = await Promise.all([
    admin
      .from('operational_tasks')
      .select(
        'id,org_id,parent_task_id,root_task_id,depth,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,task_kind,status,due_at,due_timezone,next_followup_at,primary_channel,fallback_channel,evidence_requirement,review_round,version,created_source,submitted_for_review_at,approved_at,approved_by_profile_id,created_by_profile_id,archived_at,created_at,updated_at'
      )
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('created_at', { ascending: false }),
    admin
      .from('organization_contacts')
      .select('id,profile_id,name,company_name,email,phone,whatsapp_number,is_active')
      .eq('org_id', orgId)
      .order('name', { ascending: true }),
    admin.from('org_members').select('profile_id').eq('org_id', orgId).eq('is_active', true),
    admin
      .from('task_organization_settings')
      .select('timezone')
      .eq('org_id', orgId)
      .maybeSingle(),
  ])

  if (taskResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
  if (contactResult.error) throw new Error('TASK_CONTACTS_READ_FAILED')
  if (memberResult.error) throw new Error('TASK_MEMBERS_READ_FAILED')
  if (settingsResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')

  const tasks = (taskResult.data ?? []) as OperationalTaskRow[]
  const contacts = (contactResult.data ?? []) as ContactRow[]
  const memberProfileIds = (memberResult.data ?? []).map((row) => String(row.profile_id))
  const taskModuleProfileIdsPromise = getInternalTaskModuleAccessProfileIds({
    orgId,
    profileIds: memberProfileIds,
  })
  const profileIds = Array.from(
    new Set([
      ...memberProfileIds,
      ...tasks.map((task) => task.issuer_profile_id),
      ...tasks.flatMap((task) => (task.assignee_profile_id ? [task.assignee_profile_id] : [])),
    ])
  )

  let profiles: ProfileRow[] = []
  if (profileIds.length > 0) {
    const profileResult = await admin.from('profiles').select('id,full_name,email').in('id', profileIds)
    if (profileResult.error) throw new Error('TASK_PROFILES_READ_FAILED')
    profiles = (profileResult.data ?? []) as ProfileRow[]
  }
  const taskModuleProfileIds = await taskModuleProfileIdsPromise

  const taskIds = tasks.map((task) => task.id)
  let requirements: RequirementRow[] = []
  let events: EventRow[] = []
  let deadlineRequests: DeadlineRequestRow[] = []
  let attachments: AttachmentRow[] = []
  let aiSuggestions: AiSuggestionRow[] = []
  let followupRules: FollowupRuleRow[] = []
  let recurrenceRules: RecurrenceRuleRow[] = []
  let completionEvidenceRequirements: CompletionEvidenceRequirementRow[] = []
  let notificationDeliveries: NotificationDeliveryRow[] = []
  let notificationJobs: NotificationJobRow[] = []
  if (taskIds.length > 0) {
    const [requirementsResult, eventsResult, deadlineResult, attachmentsResult, suggestionsResult, followupResult, recurrenceResult, completionEvidenceResult, notificationDeliveriesResult, notificationJobsResult] = await Promise.all([
      admin
        .from('task_requirements')
        .select('id,task_id,requirement_key,label,status,is_required,verified_by_profile_id,verified_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: true }),
      admin
        .from('task_events')
        .select('id,task_id,event_type,actor_type,actor_name,actor_profile_id,actor_contact_id,message,from_status,to_status,created_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
      admin
        .from('task_deadline_change_requests')
        .select('id,task_id,current_due_at,requested_due_at,reason,status,decided_at,decision_note,created_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
      admin
        .from('task_attachments')
        .select('id,task_id,attachment_type,title,file_name,content_type,text_content,transcript_text,is_completion_evidence,created_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
      admin
        .from('task_ai_suggestions')
        .select('id,task_id,suggestion_type,title,description,proposed_payload,status,created_at')
        .in('task_id', taskIds)
        .eq('status', 'pending')
        .eq('suggestion_type', 'create_subtask')
        .order('created_at', { ascending: false }),
      admin
        .from('task_followup_rules')
        .select('task_id,initial_dispatch_pending')
        .in('task_id', taskIds),
      admin
        .from('task_recurrence_rules')
        .select('task_id,recurrence_interval,sequence,is_active')
        .in('task_id', taskIds),
      admin
        .from('task_completion_evidence_requirements')
        .select('task_id,evidence_type')
        .in('task_id', taskIds),
      admin
        .from('task_message_deliveries')
        .select(
          'id,task_id,message_id,channel,status,is_fallback,scheduled_at,sent_at,delivered_at,read_at,replied_at,failed_at,created_at,updated_at,message:task_messages!task_message_deliveries_message_id_fkey!inner(message_type,metadata)'
        )
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
      admin
        .from('task_automation_jobs')
        .select('id,task_id,status,payload,created_at,updated_at')
        .in('task_id', taskIds)
        .eq('job_type', 'send_message')
        .in('status', ['queued', 'processing', 'failed', 'dead_letter'])
        .order('created_at', { ascending: false }),
    ])
    if (requirementsResult.error) throw new Error('TASK_REQUIREMENTS_READ_FAILED')
    if (eventsResult.error) throw new Error('TASK_EVENTS_READ_FAILED')
    if (deadlineResult.error) throw new Error('TASK_DEADLINES_READ_FAILED')
    if (attachmentsResult.error) throw new Error('TASK_ATTACHMENTS_READ_FAILED')
    if (suggestionsResult.error) throw new Error('TASK_AI_SUGGESTIONS_READ_FAILED')
    if (followupResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
    if (recurrenceResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
    if (completionEvidenceResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
    if (notificationDeliveriesResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
    if (notificationJobsResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
    requirements = (requirementsResult.data ?? []) as RequirementRow[]
    events = (eventsResult.data ?? []) as EventRow[]
    deadlineRequests = (deadlineResult.data ?? []) as DeadlineRequestRow[]
    attachments = (attachmentsResult.data ?? []) as AttachmentRow[]
    aiSuggestions = (suggestionsResult.data ?? []) as AiSuggestionRow[]
    followupRules = (followupResult.data ?? []) as FollowupRuleRow[]
    recurrenceRules = (recurrenceResult.data ?? []) as RecurrenceRuleRow[]
    completionEvidenceRequirements = (completionEvidenceResult.data ?? []) as CompletionEvidenceRequirementRow[]
    notificationDeliveries = (notificationDeliveriesResult.data ?? []) as unknown as NotificationDeliveryRow[]
    notificationJobs = (notificationJobsResult.data ?? []) as NotificationJobRow[]
  }

  return {
    timeZone: normalizeTaskTimeZone(settingsResult.data?.timezone),
    tasks,
    contacts,
    profiles,
    taskModuleProfileIds,
    requirements,
    events,
    deadlineRequests,
    attachments,
    aiSuggestions,
    followupRules,
    recurrenceRules,
    completionEvidenceRequirements,
    notificationDeliveries,
    notificationJobs,
  }
}

export async function getTaskWorkspace(input: InternalTaskContext): Promise<TaskWorkspace> {
  const rows = await loadRows(input.orgId)
  const analyticsAsOf = new Date().toISOString()
  const visibleIds = actorCanSeeTaskTree(rows.tasks, input.userId, input.isOrgAdmin)
  const visibleTasks = rows.tasks.filter((task) => visibleIds.has(task.id))
  const profilesById = new Map(rows.profiles.map((profile) => [profile.id, profile]))
  const contactsById = new Map(rows.contacts.map((contact) => [contact.id, contact]))
  const currentProfile = profilesById.get(input.userId)
  const unreadTaskIds = new Set(
    visibleTasks
      .filter(
        (task) =>
          task.issuer_profile_id === input.userId || task.assignee_profile_id === input.userId
      )
      .map((task) => task.id)
  )
  const conversationByTask = await loadTaskConversationSnapshots({
    taskIds: visibleTasks.map((task) => task.id),
    viewer: { kind: 'profile', profileId: input.userId },
    unreadTaskIds,
  })

  const people: TaskPerson[] = [
    ...rows.profiles.filter((profile) => rows.taskModuleProfileIds.has(profile.id)).map((profile) => ({
      id: profile.id,
      kind: 'profile' as const,
      name: profile.full_name?.trim() || profile.email?.trim() || 'Intern användare',
      companyName: null,
      email: profile.email ?? null,
      phone: null,
      whatsappNumber: null,
      isActive: true,
    })),
    ...rows.contacts.map((contact) => ({
      id: contact.id,
      kind: 'contact' as const,
      name: contact.name,
      companyName: contact.company_name ?? null,
      email: contact.email ?? null,
      phone: contact.phone ?? null,
      whatsappNumber: contact.whatsapp_number ?? null,
      isActive: contact.is_active,
    })),
  ]

  const requirementsByTask = new Map<string, RequirementRow[]>()
  for (const requirement of rows.requirements) {
    const list = requirementsByTask.get(requirement.task_id) ?? []
    list.push(requirement)
    requirementsByTask.set(requirement.task_id, list)
  }
  const eventsByTask = new Map<string, EventRow[]>()
  for (const event of rows.events) {
    if (event.event_type === 'comment') continue
    const list = eventsByTask.get(event.task_id) ?? []
    if (list.length < 20) list.push(event)
    eventsByTask.set(event.task_id, list)
  }
  const deadlinesByTask = new Map<string, DeadlineRequestRow[]>()
  for (const request of rows.deadlineRequests) {
    const list = deadlinesByTask.get(request.task_id) ?? []
    list.push(request)
    deadlinesByTask.set(request.task_id, list)
  }
  const attachmentsByTask = new Map<string, AttachmentRow[]>()
  for (const attachment of rows.attachments) {
    const list = attachmentsByTask.get(attachment.task_id) ?? []
    list.push(attachment)
    attachmentsByTask.set(attachment.task_id, list)
  }
  const aiSuggestionsByTask = new Map<string, AiSuggestionRow[]>()
  for (const suggestion of rows.aiSuggestions) {
    const list = aiSuggestionsByTask.get(suggestion.task_id) ?? []
    list.push(suggestion)
    aiSuggestionsByTask.set(suggestion.task_id, list)
  }
  const initialDispatchByTask = new Map(
    rows.followupRules.map((rule) => [rule.task_id, rule.initial_dispatch_pending])
  )
  const recurrenceByTask = new Map(
    rows.recurrenceRules
      .filter((rule) => rule.is_active)
      .map((rule) => [rule.task_id, rule] as const)
  )
  const evidenceRequirementsByTask = new Map<string, TaskCompletionEvidenceType[]>()
  for (const requirement of rows.completionEvidenceRequirements) {
    const list = evidenceRequirementsByTask.get(requirement.task_id) ?? []
    list.push(requirement.evidence_type)
    evidenceRequirementsByTask.set(requirement.task_id, list)
  }

  const relevantNotificationDeliveries = rows.notificationDeliveries.filter(
    isRelevantNotificationDelivery
  )
  const notificationDeliveryEventIds = new Set(
    relevantNotificationDeliveries
      .map(notificationDeliveryEventId)
      .filter((eventId): eventId is string => Boolean(eventId))
  )
  const notificationDeliveryStatusesByEvent = new Map<
    string,
    Set<TaskNotificationDeliveryStatus>
  >()
  for (const delivery of relevantNotificationDeliveries) {
    const eventId = notificationDeliveryEventId(delivery)
    if (!eventId) continue
    const statuses = notificationDeliveryStatusesByEvent.get(eventId) ?? new Set()
    statuses.add(delivery.status)
    notificationDeliveryStatusesByEvent.set(eventId, statuses)
  }
  const notificationEventsById = new Map(rows.events.map((event) => [event.id, event]))
  const syntheticNotificationViewsByTask = new Map<string, TaskNotificationDeliveryView[]>()
  const syntheticNotificationProblemEventIdsByTask = new Map<string, Set<string>>()
  for (const job of rows.notificationJobs) {
    const eventId = notificationMetadataText(job.payload, 'notificationEventId')
    const failed = job.status === 'failed' || job.status === 'dead_letter'
    if (!eventId) continue
    const deliveryStatuses = notificationDeliveryStatusesByEvent.get(eventId)
    const statuses = deliveryStatuses ? Array.from(deliveryStatuses) : []
    const deliveryHasSuccess = statuses.some((status) =>
      ['sent', 'delivered', 'read', 'replied'].includes(status)
    )
    const deliveryIsAmbiguous = statuses.includes('ambiguous')
    const deliveryHasFailed = statuses.includes('failed')
    const deliveryHasContinued = statuses.some((status) =>
      ['queued', 'sending', 'sent', 'delivered', 'read', 'replied'].includes(status)
    )
    const deliveryAlreadyShowsOutcome = deliveryHasSuccess
      || deliveryIsAmbiguous
      || (deliveryHasFailed && !deliveryHasContinued)
    if (
      notificationDeliveryEventIds.has(eventId)
      && (!failed || deliveryAlreadyShowsOutcome)
    ) continue
    const event = notificationEventsById.get(eventId)
    const eventType = event?.event_type || notificationMetadataText(job.payload, 'eventType')
    const view: TaskNotificationDeliveryView = {
      id: `outbox:${job.id}`,
      label: notificationLabel(eventType, event?.to_status),
      channel: null,
      status: job.status === 'processing' ? 'processing' : failed ? 'failed' : 'queued',
      stage: 'outbox',
      isFallback: false,
      statusAt: job.updated_at || job.created_at,
      requiresAttention: failed,
    }
    const list = syntheticNotificationViewsByTask.get(job.task_id) ?? []
    list.push(view)
    syntheticNotificationViewsByTask.set(job.task_id, list)
    if (failed) {
      const problemEventIds = syntheticNotificationProblemEventIdsByTask.get(job.task_id) ?? new Set<string>()
      problemEventIds.add(eventId)
      syntheticNotificationProblemEventIdsByTask.set(job.task_id, problemEventIds)
    }
  }
  const notificationDeliveriesByMessage = new Map<string, NotificationDeliveryRow[]>()
  for (const delivery of relevantNotificationDeliveries) {
    const list = notificationDeliveriesByMessage.get(delivery.message_id) ?? []
    list.push(delivery)
    notificationDeliveriesByMessage.set(delivery.message_id, list)
  }
  const notificationProblemMessageIds = new Set<string>()
  for (const [messageId, deliveries] of notificationDeliveriesByMessage) {
    if (deliveries.some((delivery) => delivery.status === 'ambiguous')) {
      notificationProblemMessageIds.add(messageId)
      continue
    }
    const hasFailed = deliveries.some((delivery) => delivery.status === 'failed')
    const hasContinuedDelivery = deliveries.some((delivery) =>
      ['queued', 'sending', 'sent', 'delivered', 'read', 'replied'].includes(delivery.status)
    )
    if (hasFailed && !hasContinuedDelivery) notificationProblemMessageIds.add(messageId)
  }
  const notificationRowsByTask = new Map<string, NotificationDeliveryRow[]>()
  for (const delivery of relevantNotificationDeliveries) {
    const list = notificationRowsByTask.get(delivery.task_id) ?? []
    list.push(delivery)
    notificationRowsByTask.set(delivery.task_id, list)
  }

  const childCounts = new Map<string, { total: number; open: number }>()
  for (const task of visibleTasks) {
    if (!task.parent_task_id) continue
    const count = childCounts.get(task.parent_task_id) ?? { total: 0, open: 0 }
    count.total += 1
    if (!isTerminalTaskStatus(task.status)) count.open += 1
    childCounts.set(task.parent_task_id, count)
  }

  const taskViews: TaskView[] = visibleTasks.map((task) => {
    const assigneeProfile = task.assignee_profile_id ? profilesById.get(task.assignee_profile_id) : null
    const assigneeContact = task.assignee_contact_id ? contactsById.get(task.assignee_contact_id) : null
    const issuer = profilesById.get(task.issuer_profile_id)
    const requirementViews: TaskRequirementView[] = (requirementsByTask.get(task.id) ?? []).map((requirement) => ({
      id: requirement.id,
      key: requirement.requirement_key,
      label: requirement.label,
      status: requirement.status,
      required: requirement.is_required,
      verifiedAt: requirement.verified_at,
      verifiedByName: requirement.verified_by_profile_id
        ? profilesById.get(requirement.verified_by_profile_id)?.full_name ?? null
        : null,
    }))
    const conversation = conversationByTask.get(task.id) ?? {
      comments: [],
      unreadMessageCount: 0,
      latestMessage: null,
      latestIncomingMessageEventId: null,
    }
    const eventViews: TaskEventView[] = [
      ...conversation.comments,
      ...(eventsByTask.get(task.id) ?? [])
        .filter((event) => event.event_type !== 'comment')
        .map((event) => ({
          id: event.id,
          type: event.event_type,
          actorName: taskActorDisplayName(
            event.actor_name,
            (event.actor_profile_id ? profilesById.get(event.actor_profile_id)?.full_name?.trim() : null)
              || 'Gizmo',
            event.actor_type
          ),
          message: event.message,
          fromStatus: event.from_status,
          toStatus: event.to_status,
          createdAt: event.created_at,
          authorSide: taskEventAuthorSide(event, { kind: 'profile', profileId: input.userId }),
        })),
    ].sort((left, right) => {
      const createdComparison = right.createdAt.localeCompare(left.createdAt)
      return createdComparison !== 0 ? createdComparison : right.id.localeCompare(left.id)
    })
    const deadlineViews: TaskDeadlineRequestView[] = (deadlinesByTask.get(task.id) ?? []).map((request) => ({
      id: request.id,
      requestedDueAt: request.requested_due_at,
      reason: request.reason,
      status: request.status,
      decidedAt: request.decided_at,
      decisionNote: request.decision_note,
      createdAt: request.created_at,
    }))
    const hasPendingDeadlineRequest = deadlineViews.some((request) => request.status === 'pending')
    const initialDispatchPending = initialDispatchByTask.get(task.id) ?? false
    const attachmentViews: TaskAttachmentView[] = (attachmentsByTask.get(task.id) ?? []).map((attachment) => ({
      id: attachment.id,
      type: attachment.attachment_type,
      title: attachment.title,
      fileName: attachment.file_name,
      contentType: attachment.content_type,
      textContent: attachment.text_content,
      transcriptText: attachment.transcript_text,
      isCompletionEvidence: attachment.is_completion_evidence,
      createdAt: attachment.created_at,
    }))
    const aiSuggestionViews: TaskAiSuggestionView[] = (aiSuggestionsByTask.get(task.id) ?? []).map((suggestion) => ({
      id: suggestion.id,
      type: suggestion.suggestion_type,
      title: suggestion.title,
      description: suggestion.description,
      rationale:
        typeof suggestion.proposed_payload?.rationale === 'string'
          ? suggestion.proposed_payload.rationale
          : null,
      status: suggestion.status,
      createdAt: suggestion.created_at,
    }))
    const allNotificationRows = notificationRowsByTask.get(task.id) ?? []
    const attentionRows = allNotificationRows.filter(
      (delivery) =>
        delivery.status === 'ambiguous' ||
        (delivery.status === 'failed' && notificationProblemMessageIds.has(delivery.message_id))
    )
    const selectedNotificationRows = Array.from(
      new Map(
        [...attentionRows, ...allNotificationRows].map((delivery) => [delivery.id, delivery])
      ).values()
    )
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, Math.max(8, attentionRows.length))
    const notificationDeliveryViews: TaskNotificationDeliveryView[] = selectedNotificationRows.map(
      (delivery) => ({
        id: delivery.id,
        label: notificationDeliveryLabel(delivery),
        channel: delivery.channel,
        status: delivery.status,
        stage: 'channel',
        isFallback: delivery.is_fallback,
        statusAt: notificationDeliveryStatusAt(delivery),
        requiresAttention:
          delivery.status === 'ambiguous' ||
          (delivery.status === 'failed' && notificationProblemMessageIds.has(delivery.message_id)),
      })
    )
    const deliveryProblemCount = new Set(
      allNotificationRows
        .filter((delivery) => notificationProblemMessageIds.has(delivery.message_id))
        .map((delivery) => delivery.message_id)
    ).size
    const syntheticNotificationViews = syntheticNotificationViewsByTask.get(task.id) ?? []
    const combinedNotificationViews = [...notificationDeliveryViews, ...syntheticNotificationViews]
    const attentionNotificationViews = combinedNotificationViews.filter(
      (delivery) => delivery.requiresAttention
    )
    const selectedNotificationViews = Array.from(
      new Map(
        [...attentionNotificationViews, ...combinedNotificationViews].map((delivery) => [
          delivery.id,
          delivery,
        ])
      ).values()
    )
      .sort((left, right) => right.statusAt.localeCompare(left.statusAt))
      .slice(0, Math.max(8, attentionNotificationViews.length))
    const notificationDeliveryProblemCount =
      deliveryProblemCount +
      (syntheticNotificationProblemEventIdsByTask.get(task.id)?.size ?? 0)
    const count = childCounts.get(task.id) ?? { total: 0, open: 0 }
    const assignee: TaskPerson = assigneeProfile
      ? {
          id: assigneeProfile.id,
          kind: 'profile',
          name: assigneeProfile.full_name?.trim() || assigneeProfile.email?.trim() || 'Intern användare',
          companyName: null,
          email: assigneeProfile.email ?? null,
          phone: null,
          whatsappNumber: null,
          isActive: true,
        }
      : assigneeContact
        ? {
            id: assigneeContact.id,
            kind: 'contact',
            name: assigneeContact.name,
            companyName: assigneeContact.company_name,
            email: assigneeContact.email,
            phone: assigneeContact.phone,
            whatsappNumber: assigneeContact.whatsapp_number,
            isActive: assigneeContact.is_active,
          }
        : {
            id: 'missing',
            kind: 'contact',
            name: 'Okänd mottagare',
            companyName: null,
            email: null,
            phone: null,
            whatsappNumber: null,
            isActive: false,
          }

    return {
      id: task.id,
      parentTaskId: task.parent_task_id,
      rootTaskId: task.root_task_id ?? task.id,
      depth: task.depth,
      title: task.title,
      description: task.description,
      contextLabel: task.context_label,
      taskKind: task.task_kind,
      status: task.status,
      risk: evaluateTaskRisk({
        status: task.status,
        now: Date.now(),
        dueAt: task.due_at,
        nextFollowUpAt: task.next_followup_at,
        calendar: {
          workingWeekdays: [1, 2, 3, 4, 5],
          excludedDateKeys: [],
          timeZone: task.due_timezone,
        },
      }).level,
      ballHolder:
        initialDispatchPending || hasPendingDeadlineRequest
          ? 'issuer'
          : getTaskBallHolderKind(task.status),
      dueAt: task.due_at,
      dueTimeZone: task.due_timezone,
      nextFollowupAt: task.next_followup_at,
      recurrenceInterval: recurrenceByTask.get(task.id)?.recurrence_interval ?? null,
      recurrenceSequence: recurrenceByTask.get(task.id)?.sequence ?? null,
      primaryChannel: task.primary_channel,
      fallbackChannel: task.fallback_channel,
      evidenceRequirement: task.evidence_requirement,
      evidenceRequirements:
        evidenceRequirementsByTask.get(task.id) ??
        evidenceTypesFromLegacyRequirement(task.evidence_requirement),
      initialDispatchPending,
      issuerId: task.issuer_profile_id,
      issuerName: issuer?.full_name?.trim() || issuer?.email?.trim() || 'Uppdragsansvarig',
      canDelete: task.created_by_profile_id === input.userId,
      assignee,
      reviewRound: task.review_round,
      version: task.version,
      childCount: count.total,
      openChildCount: count.open,
      requirements: requirementViews,
      events: eventViews,
      deadlineRequests: deadlineViews,
      attachments: attachmentViews,
      aiSuggestions: aiSuggestionViews,
      unreadMessageCount: conversation.unreadMessageCount,
      latestMessage: conversation.latestMessage,
      latestIncomingMessageEventId: conversation.latestIncomingMessageEventId,
      notificationDeliveries:
        input.isOrgAdmin || task.issuer_profile_id === input.userId
          ? selectedNotificationViews
          : [],
      notificationDeliveryProblemCount:
        input.isOrgAdmin || task.issuer_profile_id === input.userId
          ? notificationDeliveryProblemCount
          : 0,
      createdAt: task.created_at,
      updatedAt: task.updated_at,
    }
  })

  const activeTasks = taskViews.filter((task) => !isTerminalTaskStatus(task.status))
  const userHasBall = activeTasks.filter((task) => {
    if (task.ballHolder === 'issuer') return task.issuerId === input.userId
    if (task.ballHolder === 'assignee') return task.assignee.kind === 'profile' && task.assignee.id === input.userId
    return false
  }).length

  const taskViewsById = new Map(taskViews.map((task) => [task.id, task]))
  const analyticsTask = (task: OperationalTaskRow): TaskAnalyticsTaskInput => ({
    id: task.id,
    status: task.status,
    dueAt: task.due_at,
    submittedForReviewAt: task.submitted_for_review_at,
    approvedAt: task.approved_at,
    // A missing follow-up rule must never make an undispatched task look late.
    initialDispatchPending: initialDispatchByTask.get(task.id) ?? true,
  })
  const analyticsDeadlineRequests: TaskAnalyticsDeadlineRequestInput[] = rows.deadlineRequests.map(
    (request) => ({
      taskId: request.task_id,
      currentDueAt: request.current_due_at,
      status: request.status,
      decidedAt: request.decided_at,
    })
  )
  const selfAnalyticsTasks = visibleTasks
    .filter((task) => task.assignee_profile_id === input.userId)
    .map(analyticsTask)
  const issuedAnalyticsTasks: TaskAnalyticsAssigneeInput[] = visibleTasks
    .filter((task) => task.created_by_profile_id === input.userId)
    .flatMap((task) => {
      const taskView = taskViewsById.get(task.id)
      return taskView
        ? [{ ...analyticsTask(task), assignee: taskView.assignee }]
        : []
    })
  const selfAnalytics = buildTaskAnalyticsScope({
    tasks: selfAnalyticsTasks,
    deadlineRequests: analyticsDeadlineRequests,
    asOf: analyticsAsOf,
  })
  const issuedByMeAnalytics = buildTaskAnalyticsScope({
    tasks: issuedAnalyticsTasks,
    deadlineRequests: analyticsDeadlineRequests,
    asOf: analyticsAsOf,
  })

  return {
    timeZone: rows.timeZone,
    currentUser: {
      id: input.userId,
      name: currentProfile?.full_name?.trim() || currentProfile?.email?.trim() || 'Användare',
      isOrgAdmin: input.isOrgAdmin,
    },
    tasks: taskViews,
    people: people.sort((a, b) => a.name.localeCompare(b.name, 'sv')),
    summary: {
      totalActive: activeTasks.length,
      userHasBall,
      awaitingReview: activeTasks.filter(
        (task) =>
          task.issuerId === input.userId &&
          (task.status === 'ready_for_review' ||
            task.deadlineRequests.some((request) => request.status === 'pending'))
      ).length,
      overdue: activeTasks.filter((task) => task.risk === 'red').length,
      green: activeTasks.filter((task) => task.risk === 'green').length,
      yellow: activeTasks.filter((task) => task.risk === 'yellow').length,
      red: activeTasks.filter((task) => task.risk === 'red').length,
      unreadMessages: taskViews.reduce((total, task) => total + task.unreadMessageCount, 0),
    },
    analytics: {
      asOf: analyticsAsOf,
      defaultPeriod: '90d',
      self: selfAnalytics,
      issuedByMe: {
        ...issuedByMeAnalytics,
        assignees: buildTaskAssigneeAnalytics({
          tasks: issuedAnalyticsTasks,
          deadlineRequests: analyticsDeadlineRequests,
          asOf: analyticsAsOf,
        }),
      },
    },
    limits: TASK_LIMITS,
  }
}

async function requireTask(orgId: string, taskId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,parent_task_id,root_task_id,depth,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,task_kind,status,due_at,due_timezone,next_followup_at,primary_channel,fallback_channel,evidence_requirement,review_round,version,created_source,submitted_for_review_at,approved_at,approved_by_profile_id,created_by_profile_id,archived_at,created_at,updated_at'
    )
    .eq('id', taskId)
    .eq('org_id', orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (error) throw new Error('TASK_READ_FAILED')
  if (!data) throw new Error('TASK_NOT_FOUND')
  return data as OperationalTaskRow
}

async function currentActorName(userId: string) {
  const admin = createSupabaseAdminClient()
  const { data } = await admin.from('profiles').select('full_name,email').eq('id', userId).maybeSingle()
  return data?.full_name?.trim() || data?.email?.trim() || 'Intern användare'
}

async function recordEvent(input: {
  orgId: string
  taskId: string
  userId: string
  type: string
  message?: string | null
  fromStatus?: TaskStatus | null
  toStatus?: TaskStatus | null
  metadata?: Record<string, unknown>
}) {
  const admin = createSupabaseAdminClient()
  const actorName = await currentActorName(input.userId)
  const { data, error } = await admin
    .from('task_events')
    .insert({
      org_id: input.orgId,
      task_id: input.taskId,
      event_type: input.type,
      actor_type: 'profile',
      actor_profile_id: input.userId,
      actor_name: actorName,
      message: input.message ?? null,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus ?? null,
      metadata: input.metadata ?? {},
    })
    .select('id')
    .single()
  if (error || !data) throw new Error('TASK_EVENT_CREATE_FAILED')
  return { id: String(data.id), actorName }
}

async function resolveAssignee(input: {
  orgId: string
  assigneeRef: string
  newContact?: Record<string, unknown> | null
}) {
  const admin = createSupabaseAdminClient()
  if (input.assigneeRef.startsWith('profile:')) {
    const profileId = input.assigneeRef.slice('profile:'.length)
    const { data, error } = await admin
      .from('org_members')
      .select('profile_id')
      .eq('org_id', input.orgId)
      .eq('profile_id', profileId)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data) throw new Error('TASK_ASSIGNEE_NOT_IN_ORG')
    if (!(await hasInternalTaskModuleAccess({ orgId: input.orgId, profileId }))) {
      throw new Error('TASK_ASSIGNEE_TASK_ACCESS_REQUIRED')
    }
    return {
      assignee_profile_id: profileId,
      assignee_contact_id: null,
      contactEmail: null,
      contactPhone: null,
    }
  }
  if (input.assigneeRef.startsWith('contact:')) {
    const contactId = input.assigneeRef.slice('contact:'.length)
    const { data, error } = await admin
      .from('organization_contacts')
      .select('id,email,phone,whatsapp_number')
      .eq('org_id', input.orgId)
      .eq('id', contactId)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data) throw new Error('TASK_CONTACT_NOT_FOUND')
    return {
      assignee_profile_id: null,
      assignee_contact_id: contactId,
      contactEmail: data.email?.trim() || null,
      contactPhone: data.whatsapp_number?.trim() || data.phone?.trim() || null,
    }
  }
  if (input.assigneeRef === 'new_contact') {
    const source = input.newContact ?? {}
    const name = asText(source.name)
    const email = optionalText(source.email)?.toLowerCase() ?? null
    const phone = optionalText(source.phone)
    const companyName = optionalText(source.companyName)
    if (!name) throw new Error('TASK_CONTACT_NAME_REQUIRED')
    if (!email) throw new Error('TASK_CONTACT_EMAIL_REQUIRED')
    const { data, error } = await admin
      .from('organization_contacts')
      .insert({
        org_id: input.orgId,
        name,
        company_name: companyName,
        email,
        phone,
        whatsapp_number: phone,
        preferred_channel: email ? 'email' : 'whatsapp',
        is_active: true,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error('TASK_CONTACT_CREATE_FAILED')
    return {
      assignee_profile_id: null,
      assignee_contact_id: String(data.id),
      contactEmail: email,
      contactPhone: phone,
    }
  }
  throw new Error('TASK_ASSIGNEE_REQUIRED')
}

async function createTask(input: TaskActionInput) {
  const title = asText(input.payload.title)
  if (!title) throw new Error('TASK_TITLE_REQUIRED')
  const dueAt = parseIsoTimestamp(input.payload.dueAt, 'TASK_DUE_REQUIRED')
  const nextFollowupAt = parseIsoTimestamp(input.payload.nextFollowupAt, 'TASK_FOLLOWUP_REQUIRED')
  if (new Date(nextFollowupAt).getTime() > new Date(dueAt).getTime()) {
    throw new Error('TASK_FOLLOWUP_AFTER_DUE')
  }
  const taskKind: TaskKind = isTaskKind(input.payload.taskKind) ? input.payload.taskKind : 'simple'
  const primaryChannel: TaskChannel = isTaskChannel(input.payload.primaryChannel)
    ? input.payload.primaryChannel
    : 'email'
  const fallbackChannel = isTaskChannel(input.payload.fallbackChannel)
    ? input.payload.fallbackChannel === primaryChannel
      ? null
      : input.payload.fallbackChannel
    : null
  const evidenceRequirements = Array.isArray(input.payload.evidenceRequirements)
    ? parseEvidenceRequirements(input.payload.evidenceRequirements)
    : isEvidenceRequirement(input.payload.evidenceRequirement)
      ? evidenceTypesFromLegacyRequirement(input.payload.evidenceRequirement)
      : []
  const evidenceRequirement = legacyRequirementFromEvidenceTypes(evidenceRequirements)
  const parentTaskId = optionalText(input.payload.parentTaskId)
  const sourceAiSuggestionId = optionalText(input.payload.sourceAiSuggestionId)
  const recurrenceInterval = TASK_RECURRENCE_INTERVALS.includes(
    input.payload.recurrenceInterval as TaskRecurrenceInterval
  )
    ? (input.payload.recurrenceInterval as TaskRecurrenceInterval)
    : null
  let parent: OperationalTaskRow | null = null

  if (sourceAiSuggestionId && !parentTaskId) {
    throw new Error('TASK_AI_SUGGESTION_PARENT_REQUIRED')
  }
  if (input.payload.recurrenceInterval && !recurrenceInterval) {
    throw new Error('TASK_RECURRENCE_INTERVAL_INVALID')
  }
  if (parentTaskId && recurrenceInterval) throw new Error('TASK_RECURRENCE_ROOT_ONLY')

  if (parentTaskId) {
    parent = await requireTask(input.orgId, parentTaskId)
    if (
      !input.isOrgAdmin &&
      parent.assignee_profile_id !== input.userId &&
      parent.issuer_profile_id !== input.userId
    ) {
      throw new Error('TASK_SUBTASK_FORBIDDEN')
    }
    if (new Date(dueAt).getTime() > new Date(parent.due_at).getTime()) {
      throw new Error('TASK_CHILD_AFTER_PARENT_DUE')
    }
    if (sourceAiSuggestionId && !input.isOrgAdmin && parent.issuer_profile_id !== input.userId) {
      throw new Error('TASK_AI_SUGGESTION_ACCEPT_FORBIDDEN')
    }
  }

  const assigneeRef = asText(input.payload.assigneeRef)
  if (!assigneeRef.startsWith('profile:')) resolveTaskPublicBaseUrl(input.requestOrigin)
  const newContact =
    input.payload.newContact && typeof input.payload.newContact === 'object'
      ? (input.payload.newContact as Record<string, unknown>)
      : null
  const assignee = await resolveAssignee({ orgId: input.orgId, assigneeRef, newContact })
  if (assignee.assignee_contact_id) {
    if (!assignee.contactEmail) {
      throw new Error('TASK_CONTACT_EMAIL_REQUIRED')
    }
    if ((primaryChannel === 'whatsapp' || fallbackChannel === 'whatsapp') && !assignee.contactPhone) {
      throw new Error('TASK_CONTACT_WHATSAPP_REQUIRED')
    }
  }
  const templates = requirementTemplates(taskKind, evidenceRequirements)
  const admin = createSupabaseAdminClient()
  const expectedParentVersion = parent
    ? requireExpectedVersion(input.payload.parentVersion)
    : null
  const { data: createdData, error } = await admin.rpc('create_operational_task_with_recurrence', {
    p_org_id: input.orgId,
    p_title: title,
    p_due_at: dueAt,
    p_next_followup_at: nextFollowupAt,
    p_primary_channel: primaryChannel,
    p_task_kind: taskKind,
    p_evidence_requirement: evidenceRequirement,
    p_evidence_requirements: evidenceRequirements,
    p_assignee_profile_id: assignee.assignee_profile_id,
    p_assignee_contact_id: assignee.assignee_contact_id,
    p_parent_task_id: parent?.id ?? null,
    p_expected_parent_version: expectedParentVersion,
    p_description: optionalText(input.payload.description),
    p_context_label: optionalText(input.payload.contextLabel),
    p_fallback_channel: fallbackChannel,
    p_requirements: templates,
    p_actor_profile_id: input.userId,
    p_actor_contact_id: null,
    p_actor_access_link_id: null,
    p_source_ai_suggestion_id: sourceAiSuggestionId,
    p_defer_initial_dispatch: input.payload.sendAssignment === false,
    p_recurrence_interval: recurrenceInterval,
  })
  if (error) throw taskDatabaseError(error, 'TASK_CREATE_FAILED')
  const created = Array.isArray(createdData) ? createdData[0] : createdData
  if (!created || typeof created.id !== 'string') throw new Error('TASK_CREATE_FAILED')

  return {
    taskId: created.id,
    hasExternalAssignee: Boolean(assignee.assignee_contact_id),
    notice: sourceAiSuggestionId
      ? 'Underuppgiften skapades och Gizmo-förslaget markerades som använt.'
      : parent
        ? 'Underuppgiften skapades.'
        : 'Uppgiften skapades.',
  }
}

async function setTaskRecurrence(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  const task = await requireTask(input.orgId, taskId)
  if (!input.isOrgAdmin && task.issuer_profile_id !== input.userId) {
    throw new Error('TASK_RECURRENCE_UPDATE_FORBIDDEN')
  }
  if (task.parent_task_id) throw new Error('TASK_RECURRENCE_ROOT_ONLY')
  if (isTerminalTaskStatus(task.status)) throw new Error('TASK_RECURRENCE_TERMINAL')
  const rawInterval = input.payload.interval
  const interval = rawInterval === null || rawInterval === '' || rawInterval === undefined
    ? null
    : TASK_RECURRENCE_INTERVALS.includes(rawInterval as TaskRecurrenceInterval)
      ? (rawInterval as TaskRecurrenceInterval)
      : undefined
  if (interval === undefined) throw new Error('TASK_RECURRENCE_INTERVAL_INVALID')
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('set_task_recurrence_rule', {
    p_org_id: input.orgId,
    p_task_id: taskId,
    p_expected_version: requireExpectedVersion(input.payload.version),
    p_interval: interval,
    p_actor_profile_id: input.userId,
  })
  if (error) throw taskDatabaseError(error, 'TASK_RECURRENCE_UPDATE_FAILED')
  return interval
    ? 'Den återkommande uppgiften har uppdaterats.'
    : 'Återkommande uppgift har stängts av.'
}

async function dispatchTaskAssignment(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  const task = await requireTask(input.orgId, taskId)
  if (!input.isOrgAdmin && task.issuer_profile_id !== input.userId) {
    throw new Error('TASK_DISPATCH_FORBIDDEN')
  }
  if (isTerminalTaskStatus(task.status)) throw new Error('TASK_TERMINAL')

  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('finalize_operational_task_initial_dispatch', {
    p_org_id: input.orgId,
    p_task_id: task.id,
    p_actor_profile_id: input.userId,
  })
  if (error) throw taskDatabaseError(error, 'TASK_ASSIGNMENT_QUEUE_FAILED')

  return 'Uppdraget och bilagorna är klara. Gizmo skickar uppdraget till mottagaren.'
}

async function archiveTask(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  const expectedVersion = requireExpectedVersion(input.payload.version)
  const task = await requireTask(input.orgId, taskId)
  if (task.created_by_profile_id !== input.userId) {
    throw new Error('TASK_ARCHIVE_FORBIDDEN')
  }

  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('archive_operational_task', {
    p_org_id: input.orgId,
    p_task_id: task.id,
    p_expected_version: expectedVersion,
    p_actor_profile_id: input.userId,
  })
  if (error) throw taskDatabaseError(error, 'TASK_ARCHIVE_FAILED')

  return 'Uppdraget har raderats från översikten.'
}

async function transitionTask(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const toStatus = input.payload.status
  if (!taskId || !isTaskStatus(toStatus)) throw new Error('TASK_STATUS_INVALID')
  const task = await requireTask(input.orgId, taskId)
  const message = optionalText(input.payload.message)
  const expectedVersion = requireExpectedVersion(input.payload.version)
  if (
    ['in_progress', 'waiting', 'ready_for_review'].includes(toStatus) &&
    task.assignee_profile_id !== input.userId
  ) {
    throw new Error('TASK_ASSIGNEE_ACTION_FORBIDDEN')
  }
  const nextFollowupAt =
    toStatus === 'waiting'
      ? parseIsoTimestamp(input.payload.nextFollowupAt, 'TASK_FOLLOWUP_REQUIRED')
      : null
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('transition_operational_task', {
    p_task_id: task.id,
    p_to_status: toStatus,
    p_message: message,
    p_next_followup_at: nextFollowupAt,
    p_expected_version: expectedVersion,
    p_actor_profile_id: input.userId,
    p_actor_contact_id: null,
    p_actor_access_link_id: null,
  })
  if (error) throw taskDatabaseError(error, 'TASK_UPDATE_FAILED')

  if (toStatus === 'waiting') {
    return 'Uppgiften har pausats. Notifieringsstatus visas i uppdraget.'
  }
  if (toStatus === 'ready_for_review') {
    return 'Uppgiften skickades för kontroll. Notifieringsstatus visas i uppdraget.'
  }
  if (toStatus === 'returned') {
    return 'Uppgiften skickades tillbaka. Notifieringsstatus visas i uppdraget.'
  }
  if (toStatus === 'approved') {
    const { data: recurrenceEvent } = await admin
      .from('task_events')
      .select('metadata')
      .eq('task_id', task.id)
      .eq('event_type', 'recurrence_generated')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const metadata = recurrenceEvent?.metadata && typeof recurrenceEvent.metadata === 'object'
      ? recurrenceEvent.metadata as Record<string, unknown>
      : null
    const nextTaskId = typeof metadata?.nextTaskId === 'string' ? metadata.nextTaskId : null
    if (nextTaskId) {
      const { data: nextTask } = await admin
        .from('operational_tasks')
        .select('assignee_contact_id')
        .eq('id', nextTaskId)
        .eq('org_id', input.orgId)
        .maybeSingle()
      if (nextTask?.assignee_contact_id) {
        try {
          const issued = await issueTaskAccessLink({
            orgId: input.orgId,
            userId: input.userId,
            taskId: nextTaskId,
            requestOrigin: input.requestOrigin,
            sendEmail: true,
          })
          const { error: finalizeError } = await admin.rpc('finalize_operational_task_initial_dispatch', {
            p_org_id: input.orgId,
            p_task_id: nextTaskId,
            p_actor_profile_id: input.userId,
          })
          if (finalizeError) throw taskDatabaseError(finalizeError, 'TASK_ASSIGNMENT_QUEUE_FAILED')
          if (issued.warning) {
            return `Uppgiften är godkänd och nästa tillfälle skapades. ${issued.warning}`
          }
        } catch {
          return 'Uppgiften är godkänd och nästa tillfälle skapades, men mottagarlänken kunde inte skickas. Öppna nästa uppgift och försök igen.'
        }
      }
      return 'Uppgiften är godkänd och nästa återkommande tillfälle skapades.'
    }
    return 'Uppgiften är godkänd. Notifieringsstatus visas i uppdraget.'
  }
  if (toStatus === 'cancelled') {
    return 'Uppgiften avbröts. Notifieringsstatus visas i uppdraget.'
  }
  return 'Statusen uppdaterades.'
}

async function addComment(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const message = asText(input.payload.message)
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  if (!message) throw new Error('TASK_COMMENT_REQUIRED')
  const task = await requireTask(input.orgId, taskId)
  if (
    !input.isOrgAdmin &&
    task.issuer_profile_id !== input.userId &&
    task.assignee_profile_id !== input.userId
  ) {
    throw new Error('TASK_COMMENT_FORBIDDEN')
  }
  const event = await recordEvent({
    orgId: input.orgId,
    taskId,
    userId: input.userId,
    type: 'comment',
    message,
  })
  const notification = await notifyTaskComment({
    orgId: input.orgId,
    taskId,
    eventId: event.id,
    message,
    actor: {
      kind: 'profile',
      profileId: input.userId,
      name: event.actorName,
    },
    requestOrigin: input.requestOrigin,
  })
  return {
    notice: notification.queued
      ? 'Meddelandet har sparats och notifieringen har köats.'
      : notification.warning
        ? 'Meddelandet finns sparat.'
        : notification.sent
          ? 'Meddelandet har sparats och e-posttjänsten har tagit emot utskicket.'
          : 'Meddelandet har sparats.',
    warning: notification.warning,
  }
}

async function markMessagesRead(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const throughEventId = asText(input.payload.throughEventId)
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  if (!throughEventId) throw new Error('TASK_CONVERSATION_CURSOR_REQUIRED')
  const task = await requireTask(input.orgId, taskId)
  if (
    task.issuer_profile_id !== input.userId &&
    task.assignee_profile_id !== input.userId
  ) {
    throw new Error('TASK_COMMENT_FORBIDDEN')
  }
  await markTaskConversationRead({
    taskId,
    throughEventId,
    reader: { kind: 'profile', profileId: input.userId },
  })
  return 'Meddelandena markerades som lästa.'
}

async function verifyRequirement(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const requirementId = asText(input.payload.requirementId)
  const target = asText(input.payload.status)
  if (!taskId || !requirementId || !['verified', 'waived', 'not_required', 'pending'].includes(target)) {
    throw new Error('TASK_REQUIREMENT_STATUS_INVALID')
  }
  const task = await requireTask(input.orgId, taskId)
  if (task.issuer_profile_id !== input.userId && !input.isOrgAdmin) {
    throw new Error('TASK_REQUIREMENT_VERIFY_FORBIDDEN')
  }
  const expectedVersion = requireExpectedVersion(input.payload.version)
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('decide_operational_task_requirement', {
    p_requirement_id: requirementId,
    p_status: target,
    p_evidence_attachment_id: optionalText(input.payload.evidenceAttachmentId),
    p_reason: optionalText(input.payload.reason),
    p_expected_task_version: expectedVersion,
    p_actor_profile_id: input.userId,
  })
  if (error) throw taskDatabaseError(error, 'TASK_REQUIREMENT_UPDATE_FAILED')
  return 'Kontrollpunkten uppdaterades.'
}

async function requestDeadlineChange(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const reason = asText(input.payload.reason)
  const requestedDueAt = parseIsoTimestamp(input.payload.requestedDueAt, 'TASK_EXTENSION_DATE_REQUIRED')
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  if (!reason) throw new Error('TASK_EXTENSION_REASON_REQUIRED')
  const task = await requireTask(input.orgId, taskId)
  if (task.assignee_profile_id !== input.userId) {
    throw new Error('TASK_EXTENSION_REQUEST_FORBIDDEN')
  }
  if (new Date(requestedDueAt).getTime() <= new Date(task.due_at).getTime()) {
    throw new Error('TASK_EXTENSION_DATE_INVALID')
  }
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('request_operational_task_deadline_change', {
    p_task_id: task.id,
    p_requested_due_at: requestedDueAt,
    p_reason: reason,
    p_actor_profile_id: input.userId,
    p_actor_contact_id: null,
    p_actor_access_link_id: null,
  })
  if (error) throw taskDatabaseError(error, 'TASK_EXTENSION_CREATE_FAILED')
  return 'Begäran har sparats. Notifieringsstatus visas i uppdraget.'
}

async function decideDeadlineChange(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const requestId = asText(input.payload.requestId)
  const decision = asText(input.payload.decision)
  const decisionNote = optionalText(input.payload.decisionNote)
  if (!taskId || !requestId || !['approved', 'rejected'].includes(decision)) {
    throw new Error('TASK_EXTENSION_DECISION_INVALID')
  }
  const task = await requireTask(input.orgId, taskId)
  if (task.issuer_profile_id !== input.userId && !input.isOrgAdmin) {
    throw new Error('TASK_EXTENSION_DECIDE_FORBIDDEN')
  }
  const expectedVersion = requireExpectedVersion(input.payload.version)
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('decide_operational_task_deadline_change', {
    p_request_id: requestId,
    p_decision: decision,
    p_decision_note: decisionNote,
    p_expected_task_version: expectedVersion,
    p_actor_profile_id: input.userId,
  })
  if (error) throw taskDatabaseError(error, 'TASK_EXTENSION_UPDATE_FAILED')
  return decision === 'approved'
    ? 'Förlängningen godkändes. Notifieringsstatus visas i uppdraget.'
    : 'Förlängningen avslogs. Notifieringsstatus visas i uppdraget.'
}

async function issueAccessLink(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  if (!taskId) throw new Error('TASK_NOT_FOUND')
  const task = await requireTask(input.orgId, taskId)
  if (task.issuer_profile_id !== input.userId && !input.isOrgAdmin) {
    throw new Error('TASK_ACCESS_ISSUE_FORBIDDEN')
  }
  if (!task.assignee_contact_id) throw new Error('TASK_EXTERNAL_ASSIGNEE_REQUIRED')
  return issueTaskAccessLink({
    orgId: input.orgId,
    userId: input.userId,
    taskId,
    requestOrigin: input.requestOrigin,
    sendEmail: input.payload.sendEmail !== false,
  })
}

export async function performTaskInternalAction(input: TaskActionInput): Promise<TaskActionResponse> {
  let notice: string
  let accessUrl: string | undefined
  let warning: string | undefined
  let createdTaskId: string | undefined
  if (input.action === 'create_task' || input.action === 'create_subtask') {
    const created = await createTask(input)
    createdTaskId = created.taskId
    notice = created.notice
    if (created.hasExternalAssignee && input.payload.sendAssignment !== false) {
      const issued = await issueTaskAccessLink({
        orgId: input.orgId,
        userId: input.userId,
        taskId: created.taskId,
        requestOrigin: input.requestOrigin,
        sendEmail: true,
      })
      accessUrl = issued.accessUrl
      warning = issued.warning ?? undefined
      notice = issued.warning
        ? `${notice} ${issued.warning}`
        : `${notice} Mottagaren har fått sin uppdragslänk.`
    } else if (input.payload.sendAssignment === false) {
      notice = `${notice} Utskicket till mottagaren väntar tills underlagen har sparats.`
    }
  } else if (input.action === 'archive_task') {
    notice = await archiveTask(input)
  } else if (input.action === 'set_recurrence') {
    notice = await setTaskRecurrence(input)
  } else if (input.action === 'transition') {
    notice = await transitionTask(input)
  } else if (input.action === 'comment') {
    const commented = await addComment(input)
    notice = commented.notice
    warning = commented.warning ?? undefined
  } else if (input.action === 'mark_messages_read') {
    notice = await markMessagesRead(input)
  } else if (input.action === 'verify_requirement') {
    notice = await verifyRequirement(input)
  } else if (input.action === 'request_deadline_change') {
    notice = await requestDeadlineChange(input)
  } else if (input.action === 'decide_deadline_change') {
    notice = await decideDeadlineChange(input)
  } else if (input.action === 'issue_access_link') {
    const issued = await issueAccessLink(input)
    await dispatchTaskAssignment(input)
    accessUrl = issued.accessUrl
    warning = issued.warning ?? undefined
    notice = issued.warning ?? 'Uppdragslänken skapades och skickades.'
  } else if (input.action === 'dispatch_assignment') {
    notice = await dispatchTaskAssignment(input)
  } else if (input.action === 'request_signe_suggestions') {
    const taskId = asText(input.payload.taskId)
    if (!taskId) throw new Error('TASK_NOT_FOUND')
    notice = await requestSigneSuggestions({ ...input, taskId })
  } else if (input.action === 'reject_signe_suggestion') {
    const taskId = asText(input.payload.taskId)
    const suggestionId = asText(input.payload.suggestionId)
    if (!taskId || !suggestionId) throw new Error('SIGNE_SUGGESTION_NOT_FOUND')
    notice = await rejectSigneSuggestion({
      ...input,
      taskId,
      suggestionId,
      reason: asText(input.payload.reason),
    })
  } else {
    throw new Error('TASK_ACTION_INVALID')
  }

  const workspace = await getTaskWorkspace(input)
  return { workspace, notice, warning, accessUrl, createdTaskId }
}
