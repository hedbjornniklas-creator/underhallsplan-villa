import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { evaluateTaskRisk, isTaskStatus } from './domain'
import type { TaskAttachmentActor } from './attachments'
import type {
  TaskRecipientAnalytics,
  TaskCompletionEvidenceType,
  TaskEvidenceRequirement,
  TaskRequirementStatus,
  TaskRisk,
  TaskStatus,
} from './contracts'
import { evidenceTypesFromLegacyRequirement } from './contracts'
import {
  buildTaskAnalyticsScope,
  type TaskAnalyticsDeadlineRequestInput,
} from './analytics'
import { normalizeTaskTimeZone } from './dateTime'
import { taskActorDisplayName } from './branding'
import type { ExternalTaskWorkspace } from './external'
import {
  loadTaskConversationSnapshots,
  markTaskConversationRead,
  notifyTaskComment,
  taskEventAuthorSide,
  type TaskConversationSnapshot,
} from './conversation'

export type RecipientPortalSession = {
  authUserId: string
  email: string | null
  fallbackName: string
}

export type RecipientPortalTaskSummary = {
  id: string
  organizationName: string
  title: string
  contextLabel: string | null
  status: TaskStatus
  risk: TaskRisk
  dueAt: string
  dueTimeZone: string
  nextFollowupAt: string
  issuerName: string
  unreadMessageCount: number
}

export type RecipientPortalOverview = {
  recipientName: string
  email: string | null
  tasks: RecipientPortalTaskSummary[]
  summary: {
    active: number
    needsAction: number
    overdue: number
    completed: number
    unreadMessages: number
  }
  analytics: TaskRecipientAnalytics
}

type PortalScopeRow = {
  grant_id: string
  recipient_identity_id: string
  org_id: string
  contact_id: string
  task_id: string
  grant_role: string
  granted_at: string
}

type PortalActorRow = {
  recipient_identity_id: string
  org_id: string
  contact_id: string
  actor_access_link_id: string
}

type PortalTaskRow = {
  id: string
  org_id: string
  parent_task_id: string | null
  root_task_id: string
  issuer_profile_id: string
  assignee_contact_id: string | null
  title: string
  description: string | null
  context_label: string | null
  status: TaskStatus
  due_at: string
  due_timezone: string
  next_followup_at: string
  created_at: string
  evidence_requirement: TaskEvidenceRequirement
  submitted_for_review_at: string | null
  approved_at: string | null
  version: number
  archived_at?: string | null
}

type PortalDeadlineRequestRow = {
  task_id: string
  current_due_at: string
  status: 'pending' | 'approved'
  decided_at: string | null
}

type PortalFollowupRuleRow = {
  task_id: string
  initial_dispatch_pending: boolean
}

export type RecipientPortalActorContext = {
  session: RecipientPortalSession
  identityId: string
  orgId: string
  contactId: string
  accessLinkId: string
  contactName: string
  task: PortalTaskRow
  actor: TaskAttachmentActor
}

export type RecipientPortalTaskScopeContext = {
  session: RecipientPortalSession
  identityId: string
  orgId: string
  contactId: string
  contactName: string
  task: PortalTaskRow
}

const TASK_SELECT = [
  'id',
  'org_id',
  'parent_task_id',
  'root_task_id',
  'issuer_profile_id',
  'assignee_contact_id',
  'title',
  'description',
  'context_label',
  'status',
  'due_at',
  'due_timezone',
  'next_followup_at',
  'created_at',
  'evidence_requirement',
  'submitted_for_review_at',
  'approved_at',
  'version',
  'archived_at',
].join(',')

const TERMINAL_STATUSES = new Set<TaskStatus>(['approved', 'cancelled'])

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function parseRpcRows(value: unknown) {
  return Array.isArray(value) ? value : value ? [value] : []
}

function parseScope(value: unknown): PortalScopeRow | null {
  const row = asObject(value)
  if (
    typeof row.grant_id !== 'string' ||
    typeof row.recipient_identity_id !== 'string' ||
    typeof row.org_id !== 'string' ||
    typeof row.contact_id !== 'string' ||
    typeof row.task_id !== 'string'
  ) {
    return null
  }
  return {
    grant_id: row.grant_id,
    recipient_identity_id: row.recipient_identity_id,
    org_id: row.org_id,
    contact_id: row.contact_id,
    task_id: row.task_id,
    grant_role: typeof row.grant_role === 'string' ? row.grant_role : 'assignee',
    granted_at: typeof row.granted_at === 'string' ? row.granted_at : '',
  }
}

function parseActor(value: unknown): PortalActorRow | null {
  const row = asObject(value)
  if (
    typeof row.recipient_identity_id !== 'string' ||
    typeof row.org_id !== 'string' ||
    typeof row.contact_id !== 'string' ||
    typeof row.actor_access_link_id !== 'string'
  ) {
    return null
  }
  return {
    recipient_identity_id: row.recipient_identity_id,
    org_id: row.org_id,
    contact_id: row.contact_id,
    actor_access_link_id: row.actor_access_link_id,
  }
}

function databaseErrorCode(error: { message?: string | null } | null, fallback: string) {
  const code = error?.message?.match(/TASK_[A-Z0-9_]+/)?.[0]
  return new Error(code ?? fallback)
}

function isEvidenceRequirement(value: unknown): value is TaskEvidenceRequirement {
  return ['optional', 'text', 'photo', 'document', 'any'].includes(String(value))
}

function isRequirementStatus(value: unknown): value is TaskRequirementStatus {
  return ['pending', 'evidence_detected', 'verified', 'not_required', 'waived'].includes(String(value))
}

function parseTask(value: unknown): PortalTaskRow | null {
  const row = asObject(value)
  if (
    typeof row.id !== 'string' ||
    typeof row.org_id !== 'string' ||
    typeof row.root_task_id !== 'string' ||
    typeof row.issuer_profile_id !== 'string' ||
    typeof row.title !== 'string' ||
    typeof row.due_at !== 'string' ||
    typeof row.due_timezone !== 'string' ||
    typeof row.next_followup_at !== 'string' ||
    typeof row.created_at !== 'string' ||
    !isTaskStatus(row.status) ||
    !isEvidenceRequirement(row.evidence_requirement) ||
    !Number.isInteger(Number(row.version))
  ) {
    return null
  }
  return {
    id: row.id,
    org_id: row.org_id,
    parent_task_id: typeof row.parent_task_id === 'string' ? row.parent_task_id : null,
    root_task_id: row.root_task_id,
    issuer_profile_id: row.issuer_profile_id,
    assignee_contact_id: typeof row.assignee_contact_id === 'string' ? row.assignee_contact_id : null,
    title: row.title,
    description: typeof row.description === 'string' ? row.description : null,
    context_label: typeof row.context_label === 'string' ? row.context_label : null,
    status: row.status,
    due_at: row.due_at,
    due_timezone: row.due_timezone,
    next_followup_at: row.next_followup_at,
    created_at: row.created_at,
    evidence_requirement: row.evidence_requirement,
    submitted_for_review_at: typeof row.submitted_for_review_at === 'string'
      ? row.submitted_for_review_at
      : null,
    approved_at: typeof row.approved_at === 'string' ? row.approved_at : null,
    version: Number(row.version),
    archived_at: typeof row.archived_at === 'string' ? row.archived_at : null,
  }
}

export async function requireRecipientPortalSession(): Promise<RecipientPortalSession> {
  const userClient = createSupabaseServerClient()
  const {
    data: { user },
    error,
  } = await userClient.auth.getUser()
  if (error || !user) throw new Error('UNAUTHORIZED')

  const metadata = asObject(user.user_metadata)
  const metadataName = asText(metadata.full_name) || asText(metadata.name)
  const email = user.email?.trim().toLowerCase() || null
  return {
    authUserId: user.id,
    email,
    fallbackName: metadataName || email || 'Mottagare',
  }
}

async function resolvePortalScopes(authUserId: string, taskId?: string | null) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('resolve_task_recipient_portal_scope', {
    p_auth_user_id: authUserId,
    p_task_id: taskId ?? null,
  })
  if (error) throw databaseErrorCode(error, 'TASK_RECIPIENT_PORTAL_SCOPE_FAILED')
  return parseRpcRows(data).map(parseScope).filter((row): row is PortalScopeRow => Boolean(row))
}

async function resolvePortalActor(authUserId: string, taskId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('resolve_task_recipient_portal_actor', {
    p_auth_user_id: authUserId,
    p_task_id: taskId,
  })
  if (error) throw databaseErrorCode(error, 'TASK_RECIPIENT_PORTAL_ACTOR_FAILED')
  const actor = parseRpcRows(data).map(parseActor).find(Boolean) ?? null
  if (!actor) throw new Error('TASK_NOT_FOUND')
  return actor
}

async function loadPortalTask(scope: Pick<PortalScopeRow, 'task_id' | 'org_id' | 'contact_id'>) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('operational_tasks')
    .select(TASK_SELECT)
    .eq('id', scope.task_id)
    .eq('org_id', scope.org_id)
    .eq('assignee_contact_id', scope.contact_id)
    .is('archived_at', null)
    .maybeSingle()
  if (error) throw new Error('TASK_READ_FAILED')
  const task = parseTask(data)
  if (!task) throw new Error('TASK_NOT_FOUND')
  return task
}

export async function requireRecipientPortalTaskScope(input: {
  session: RecipientPortalSession
  taskId: string
}): Promise<RecipientPortalTaskScopeContext> {
  const scopes = await resolvePortalScopes(input.session.authUserId, input.taskId)
  const scope = scopes.find((row) => row.task_id === input.taskId) ?? null
  if (!scope) throw new Error('TASK_NOT_FOUND')
  const task = await loadPortalTask(scope)
  const admin = createSupabaseAdminClient()
  const { data: contact, error } = await admin
    .from('organization_contacts')
    .select('name')
    .eq('id', scope.contact_id)
    .eq('org_id', scope.org_id)
    .eq('is_active', true)
    .maybeSingle()
  if (error || !contact) throw new Error('TASK_NOT_FOUND')
  return {
    session: input.session,
    identityId: scope.recipient_identity_id,
    orgId: scope.org_id,
    contactId: scope.contact_id,
    contactName: asText(contact.name) || input.session.fallbackName,
    task,
  }
}

function profileName(value: unknown, fallback = 'Uppdragsansvarig') {
  const row = asObject(value)
  return asText(row.full_name) || asText(row.email) || fallback
}

export async function getRecipientPortalOverview(
  session: RecipientPortalSession
): Promise<RecipientPortalOverview> {
  const analyticsAsOf = new Date().toISOString()
  const scopes = await resolvePortalScopes(session.authUserId)
  if (scopes.length === 0) {
    return {
      recipientName: session.fallbackName,
      email: session.email,
      tasks: [],
      summary: { active: 0, needsAction: 0, overdue: 0, completed: 0, unreadMessages: 0 },
      analytics: {
        asOf: analyticsAsOf,
        defaultPeriod: '90d',
        self: buildTaskAnalyticsScope({
          tasks: [],
          deadlineRequests: [],
          asOf: analyticsAsOf,
        }),
      },
    }
  }

  const taskIds = [...new Set(scopes.map((scope) => scope.task_id))]
  const orgIds = [...new Set(scopes.map((scope) => scope.org_id))]
  const contactIds = [...new Set(scopes.map((scope) => scope.contact_id))]
  const admin = createSupabaseAdminClient()
  const [tasksResult, orgsResult, contactsResult, deadlinesResult, followupResult] = await Promise.all([
    admin
      .from('operational_tasks')
      .select(TASK_SELECT)
      .in('id', taskIds)
      .is('archived_at', null),
    admin.from('organizations').select('id,name').in('id', orgIds),
    admin
      .from('organization_contacts')
      .select('id,org_id,name,email')
      .in('id', contactIds)
      .eq('is_active', true),
    admin
      .from('task_deadline_change_requests')
      .select('task_id,current_due_at,status,decided_at')
      .in('task_id', taskIds)
      .in('org_id', orgIds)
      .in('status', ['approved', 'pending']),
    admin
      .from('task_followup_rules')
      .select('task_id,initial_dispatch_pending')
      .in('task_id', taskIds)
      .in('org_id', orgIds),
  ])
  if (
    tasksResult.error
    || orgsResult.error
    || contactsResult.error
    || deadlinesResult.error
    || followupResult.error
  ) {
    throw new Error('TASK_RECIPIENT_PORTAL_READ_FAILED')
  }

  const scopesByTask = new Map(scopes.map((scope) => [scope.task_id, scope]))
  const taskRows = (tasksResult.data ?? [])
    .map(parseTask)
    .filter((task): task is PortalTaskRow => {
      if (!task) return false
      const scope = scopesByTask.get(task.id)
      return Boolean(
        scope &&
        scope.org_id === task.org_id &&
        scope.contact_id === task.assignee_contact_id
      )
    })
  const issuerIds = [...new Set(taskRows.map((task) => task.issuer_profile_id))]
  const { data: issuers, error: issuerError } = issuerIds.length > 0
    ? await admin.from('profiles').select('id,full_name,email').in('id', issuerIds)
    : { data: [], error: null }
  if (issuerError) throw new Error('TASK_RECIPIENT_PORTAL_READ_FAILED')

  const organizations = new Map(
    (orgsResult.data ?? []).map((organization) => [String(organization.id), asText(organization.name) || 'Organisation'])
  )
  const issuerNames = new Map(
    (issuers ?? []).map((issuer) => [String(issuer.id), profileName(issuer)])
  )
  const contacts = contactsResult.data ?? []
  const primaryContact = contacts.find((contact) => asText(contact.name))
  const now = new Date()
  const conversationByTask = new Map<string, TaskConversationSnapshot>()
  const taskIdsByContact = new Map<string, string[]>()
  for (const task of taskRows) {
    const scope = scopesByTask.get(task.id)
    if (!scope) continue
    const ids = taskIdsByContact.get(scope.contact_id) ?? []
    ids.push(task.id)
    taskIdsByContact.set(scope.contact_id, ids)
  }
  await Promise.all(
    [...taskIdsByContact.entries()].map(async ([contactId, scopedTaskIds]) => {
      const snapshots = await loadTaskConversationSnapshots({
        taskIds: scopedTaskIds,
        viewer: { kind: 'contact', contactId },
      })
      for (const [taskId, snapshot] of snapshots) conversationByTask.set(taskId, snapshot)
    })
  )
  const tasks: RecipientPortalTaskSummary[] = taskRows.map((task) => ({
    id: task.id,
    organizationName: organizations.get(task.org_id) ?? 'Organisation',
    title: task.title,
    contextLabel: task.context_label,
    status: task.status,
    risk: evaluateTaskRisk({
      status: task.status,
      now,
      dueAt: task.due_at,
      nextFollowUpAt: task.next_followup_at,
      reviewDueAt: task.next_followup_at,
      calendar: {
        workingWeekdays: [1, 2, 3, 4, 5],
        excludedDateKeys: [],
        timeZone: task.due_timezone,
      },
    }).level,
    dueAt: task.due_at,
    dueTimeZone: task.due_timezone,
    nextFollowupAt: task.next_followup_at,
    issuerName: issuerNames.get(task.issuer_profile_id) ?? 'Uppdragsansvarig',
    unreadMessageCount: conversationByTask.get(task.id)?.unreadMessageCount ?? 0,
  }))
  tasks.sort((left, right) => {
    const terminalOrder = Number(TERMINAL_STATUSES.has(left.status)) - Number(TERMINAL_STATUSES.has(right.status))
    if (terminalOrder !== 0) return terminalOrder
    return Date.parse(left.dueAt) - Date.parse(right.dueAt)
  })

  const activeTasks = tasks.filter((task) => !TERMINAL_STATUSES.has(task.status))
  const scopedTaskIds = new Set(taskRows.map((task) => task.id))
  const initialDispatchByTask = new Map(
    ((followupResult.data ?? []) as PortalFollowupRuleRow[])
      .filter((rule) => scopedTaskIds.has(rule.task_id))
      .map((rule) => [rule.task_id, rule.initial_dispatch_pending])
  )
  const analyticsDeadlineRequests: TaskAnalyticsDeadlineRequestInput[] = (
    (deadlinesResult.data ?? []) as PortalDeadlineRequestRow[]
  ).flatMap((request) => {
    if (
      !scopedTaskIds.has(request.task_id)
      || (request.status !== 'approved' && request.status !== 'pending')
    ) return []
    return [{
      taskId: request.task_id,
      currentDueAt: request.current_due_at,
      status: request.status,
      decidedAt: request.decided_at,
    }]
  })
  return {
    recipientName: asText(primaryContact?.name) || session.fallbackName,
    email: session.email ?? (asText(primaryContact?.email) || null),
    tasks,
    summary: {
      active: activeTasks.length,
      needsAction: activeTasks.filter((task) => ['assigned', 'returned', 'waiting'].includes(task.status)).length,
      overdue: activeTasks.filter((task) => task.risk === 'red').length,
      completed: tasks.filter((task) => task.status === 'approved').length,
      unreadMessages: tasks.reduce((total, task) => total + task.unreadMessageCount, 0),
    },
    analytics: {
      asOf: analyticsAsOf,
      defaultPeriod: '90d',
      self: buildTaskAnalyticsScope({
        tasks: taskRows.map((task) => ({
          id: task.id,
          status: task.status,
          dueAt: task.due_at,
          submittedForReviewAt: task.submitted_for_review_at,
          approvedAt: task.approved_at,
          // Fail closed when a legacy row has no follow-up rule: the recipient
          // must not be blamed before initial dispatch is known to be complete.
          initialDispatchPending: initialDispatchByTask.get(task.id) ?? true,
        })),
        deadlineRequests: analyticsDeadlineRequests,
        asOf: analyticsAsOf,
      }),
    },
  }
}

export async function getRecipientPortalTaskWorkspace(
  session: RecipientPortalSession,
  taskId: string
): Promise<ExternalTaskWorkspace | null> {
  const scopes = await resolvePortalScopes(session.authUserId, taskId)
  const scope = scopes.find((row) => row.task_id === taskId) ?? null
  if (!scope) return null
  const task = await loadPortalTask(scope)
  const admin = createSupabaseAdminClient()

  const [contactResult, issuerResult, requirementsResult, completionEvidenceResult, eventsResult, deadlinesResult, attachmentsResult, settingsResult] =
    await Promise.all([
      admin
        .from('organization_contacts')
        .select('id,name')
        .eq('id', scope.contact_id)
        .eq('org_id', scope.org_id)
        .eq('is_active', true)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('id,full_name,email')
        .eq('id', task.issuer_profile_id)
        .maybeSingle(),
      admin
        .from('task_requirements')
        .select('id,requirement_key,label,status')
        .eq('task_id', task.id)
        .eq('org_id', task.org_id)
        .order('sort_order', { ascending: true }),
      admin
        .from('task_completion_evidence_requirements')
        .select('evidence_type')
        .eq('task_id', task.id)
        .eq('org_id', task.org_id),
      admin
        .from('task_events')
        .select('id,event_type,actor_type,actor_name,actor_profile_id,actor_contact_id,message,from_status,to_status,created_at')
        .eq('task_id', task.id)
        .eq('org_id', task.org_id)
        .neq('event_type', 'comment')
        .order('created_at', { ascending: false })
        .limit(30),
      admin
        .from('task_deadline_change_requests')
        .select('id,requested_due_at,reason,status')
        .eq('task_id', task.id)
        .eq('org_id', task.org_id)
        .order('created_at', { ascending: false }),
      admin
        .from('task_attachments')
        .select('id,attachment_type,title,file_name,text_content,transcript_text,uploaded_by_contact_id,is_completion_evidence,created_at')
        .eq('task_id', task.id)
        .eq('org_id', task.org_id)
        .or(
          `uploaded_by_contact_id.eq.${scope.contact_id},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.${task.issuer_profile_id})`
        )
        .order('created_at', { ascending: false }),
      admin
        .from('task_organization_settings')
        .select('timezone')
        .eq('org_id', task.org_id)
        .maybeSingle(),
    ])

  const firstError = [
    contactResult.error,
    issuerResult.error,
    requirementsResult.error,
    completionEvidenceResult.error,
    eventsResult.error,
    deadlinesResult.error,
    attachmentsResult.error,
    settingsResult.error,
  ].find(Boolean)
  if (firstError) throw new Error('TASK_RECIPIENT_PORTAL_READ_FAILED')
  if (!contactResult.data) return null

  const recipientName = asText(contactResult.data.name) || session.fallbackName
  const conversation = (await loadTaskConversationSnapshots({
    taskIds: [task.id],
    viewer: { kind: 'contact', contactId: scope.contact_id },
  })).get(task.id) ?? {
    comments: [],
    unreadMessageCount: 0,
    latestMessage: null,
    latestIncomingMessageEventId: null,
  }
  const historyEvents: ExternalTaskWorkspace['task']['events'] = (eventsResult.data ?? [])
    .filter(
      (event) =>
        event.event_type !== 'comment' &&
        (
          event.actor_contact_id === scope.contact_id ||
          [
            'task_created',
            'status_changed',
            'deadline_change_requested',
            'deadline_change_approved',
            'deadline_change_rejected',
            'requirement_updated',
          ].includes(String(event.event_type))
        )
    )
    .map((event) => ({
      id: String(event.id),
      type: String(event.event_type),
      actorName: taskActorDisplayName(asText(event.actor_name), undefined, asText(event.actor_type)),
      message: typeof event.message === 'string' ? event.message : null,
      fromStatus: isTaskStatus(event.from_status) ? event.from_status : null,
      toStatus: isTaskStatus(event.to_status) ? event.to_status : null,
      createdAt: String(event.created_at),
      authorSide: taskEventAuthorSide(event, {
        kind: 'contact',
        contactId: scope.contact_id,
      }),
    }))
  const events = [...conversation.comments, ...historyEvents].sort((left, right) => {
    const createdComparison = right.createdAt.localeCompare(left.createdAt)
    return createdComparison !== 0 ? createdComparison : right.id.localeCompare(left.id)
  })

  return {
    accessState: 'open',
    timeZone: normalizeTaskTimeZone(settingsResult.data?.timezone),
    recipientName,
    recipientAccount: { state: 'password_login', emailHint: '' },
    canDelegate: false,
    task: {
      id: task.id,
      title: task.title,
      description: task.description,
      contextLabel: task.context_label,
      status: task.status,
      dueAt: task.due_at,
      dueTimeZone: task.due_timezone,
      nextFollowupAt: task.next_followup_at,
      createdAt: task.created_at,
      evidenceRequirement: task.evidence_requirement,
      evidenceRequirements:
        completionEvidenceResult.data && completionEvidenceResult.data.length > 0
          ? completionEvidenceResult.data.map(
              (requirement) => requirement.evidence_type as TaskCompletionEvidenceType
            )
          : evidenceTypesFromLegacyRequirement(task.evidence_requirement),
      issuerName: profileName(issuerResult.data),
      assigneeName: recipientName,
      requirements: (requirementsResult.data ?? []).flatMap((requirement) => {
        if (!isRequirementStatus(requirement.status)) return []
        return [{
          id: String(requirement.id),
          key: String(requirement.requirement_key),
          label: String(requirement.label),
          status: requirement.status,
        }]
      }),
      events,
      deadlineRequests: (deadlinesResult.data ?? []).flatMap((request) => {
        const status = String(request.status)
        if (!['pending', 'approved', 'rejected', 'cancelled'].includes(status)) return []
        return [{
          id: String(request.id),
          requestedDueAt: String(request.requested_due_at),
          reason: String(request.reason),
          status: status as 'pending' | 'approved' | 'rejected' | 'cancelled',
        }]
      }),
      attachments: (attachmentsResult.data ?? []).flatMap((attachment) => {
        const type = String(attachment.attachment_type)
        if (!['photo', 'document', 'audio', 'text'].includes(type)) return []
        return [{
          id: String(attachment.id),
          type: type as 'photo' | 'document' | 'audio' | 'text',
          title: typeof attachment.title === 'string' ? attachment.title : null,
          fileName: typeof attachment.file_name === 'string' ? attachment.file_name : null,
          textContent: typeof attachment.text_content === 'string' ? attachment.text_content : null,
          transcriptText: typeof attachment.transcript_text === 'string' ? attachment.transcript_text : null,
          canEditTranscript:
            attachment.attachment_type === 'audio'
            && attachment.uploaded_by_contact_id === scope.contact_id,
          isCompletionEvidence: Boolean(attachment.is_completion_evidence),
          createdAt: String(attachment.created_at),
        }]
      }),
      unreadMessageCount: conversation.unreadMessageCount,
      latestMessage: conversation.latestMessage,
      latestIncomingMessageEventId: conversation.latestIncomingMessageEventId,
      version: task.version,
    },
    children: [],
  }
}

export async function requireRecipientPortalTaskActor(input: {
  session: RecipientPortalSession
  taskId: string
  allowLocked?: boolean
  enforceRateLimit?: boolean
}): Promise<RecipientPortalActorContext> {
  const resolved = await resolvePortalActor(input.session.authUserId, input.taskId)
  const task = await loadPortalTask({
    task_id: input.taskId,
    org_id: resolved.org_id,
    contact_id: resolved.contact_id,
  })
  if (!input.allowLocked && ['ready_for_review', 'approved', 'cancelled'].includes(task.status)) {
    throw new Error('TASK_ATTACHMENT_LOCKED')
  }
  const admin = createSupabaseAdminClient()
  const { data: contact, error: contactError } = await admin
    .from('organization_contacts')
    .select('name')
    .eq('id', resolved.contact_id)
    .eq('org_id', resolved.org_id)
    .eq('is_active', true)
    .maybeSingle()
  if (contactError || !contact) throw new Error('TASK_CONTACT_NOT_FOUND')

  if (input.enforceRateLimit !== false) {
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    const { count, error } = await admin
      .from('task_events')
      .select('id', { count: 'exact', head: true })
      .eq('actor_access_link_id', resolved.actor_access_link_id)
      .gte('created_at', since)
    if (error) throw new Error('TASK_RATE_LIMIT_CHECK_FAILED')
    if ((count ?? 0) >= 30) throw new Error('TASK_RATE_LIMITED')
  }

  const contactName = asText(contact.name) || input.session.fallbackName
  return {
    session: input.session,
    identityId: resolved.recipient_identity_id,
    orgId: resolved.org_id,
    contactId: resolved.contact_id,
    accessLinkId: resolved.actor_access_link_id,
    contactName,
    task,
    actor: {
      type: 'contact',
      contactId: resolved.contact_id,
      accessLinkId: resolved.actor_access_link_id,
      name: contactName,
    },
  }
}

function parseIso(value: unknown, code: string) {
  const text = asText(value)
  const date = new Date(text)
  if (!text || Number.isNaN(date.getTime())) throw new Error(code)
  return date.toISOString()
}

function requireExpectedVersion(value: unknown) {
  const version = Number(value)
  if (!Number.isInteger(version) || version < 1) throw new Error('TASK_VERSION_REQUIRED')
  return version
}

export async function performRecipientPortalTaskAction(input: {
  session: RecipientPortalSession
  taskId: string
  action: string
  payload: Record<string, unknown>
}) {
  const context = await requireRecipientPortalTaskActor({
    session: input.session,
    taskId: input.taskId,
    allowLocked: true,
  })
  const payloadTaskId = asText(input.payload.taskId)
  if (payloadTaskId && payloadTaskId !== input.taskId) throw new Error('TASK_NOT_FOUND')
  if (input.action === 'mark_messages_read') {
    const throughEventId = asText(input.payload.throughEventId)
    if (!throughEventId) throw new Error('TASK_CONVERSATION_CURSOR_REQUIRED')
    await markTaskConversationRead({
      taskId: context.task.id,
      throughEventId,
      reader: {
        kind: 'contact',
        contactId: context.contactId,
        accessLinkId: context.accessLinkId,
      },
    })
    const workspace = await getRecipientPortalTaskWorkspace(input.session, input.taskId)
    if (!workspace) throw new Error('TASK_NOT_FOUND')
    return {
      workspace,
      notice: 'Meddelandena markerades som lästa.',
      warning: null,
    }
  }
  if (TERMINAL_STATUSES.has(context.task.status)) throw new Error('TASK_TERMINAL')
  const admin = createSupabaseAdminClient()
  let notice = 'Uppgiften uppdaterades.'
  let warning: string | null = null

  if (input.action === 'comment') {
    const message = asText(input.payload.message)
    if (!message) throw new Error('TASK_COMMENT_REQUIRED')
    const { data: event, error } = await admin
      .from('task_events')
      .insert({
        org_id: context.orgId,
        task_id: context.task.id,
        event_type: 'comment',
        actor_type: 'contact',
        actor_contact_id: context.contactId,
        actor_access_link_id: context.accessLinkId,
        actor_name: context.contactName,
        message,
        metadata: { recipientIdentityId: context.identityId },
    })
      .select('id')
      .single()
    if (error || !event) throw new Error('TASK_EVENT_CREATE_FAILED')
    const notification = await notifyTaskComment({
      orgId: context.orgId,
      taskId: context.task.id,
      eventId: String(event.id),
      message,
      actor: {
        kind: 'contact',
        contactId: context.contactId,
        accessLinkId: context.accessLinkId,
        name: context.contactName,
      },
    })
    warning = notification.warning
    notice = notification.queued
      ? 'Meddelandet har sparats och notifieringen har köats.'
      : notification.warning
        ? 'Meddelandet finns sparat.'
        : notification.sent
          ? 'Meddelandet har sparats och e-posttjänsten har tagit emot utskicket.'
          : 'Meddelandet har sparats.'
  } else if (input.action === 'request_deadline_change') {
    const reason = asText(input.payload.reason)
    const requestedDueAt = parseIso(input.payload.requestedDueAt, 'TASK_EXTENSION_DATE_REQUIRED')
    if (!reason) throw new Error('TASK_EXTENSION_REASON_REQUIRED')
    if (Date.parse(requestedDueAt) <= Date.parse(context.task.due_at)) {
      throw new Error('TASK_EXTENSION_DATE_INVALID')
    }
    const { error } = await admin.rpc('request_operational_task_deadline_change', {
      p_task_id: context.task.id,
      p_requested_due_at: requestedDueAt,
      p_reason: reason,
      p_actor_profile_id: null,
      p_actor_contact_id: context.contactId,
      p_actor_access_link_id: context.accessLinkId,
    })
    if (error) throw databaseErrorCode(error, 'TASK_EXTENSION_CREATE_FAILED')
    notice = 'Din begäran har sparats. HusHub hanterar notifieringen till uppdragsansvarig.'
  } else {
    const toStatus: TaskStatus | null = input.action === 'start'
      ? 'in_progress'
      : input.action === 'waiting'
        ? 'waiting'
        : input.action === 'ready_for_review'
          ? 'ready_for_review'
          : null
    if (!toStatus) throw new Error('TASK_ACTION_INVALID')
    const message = asText(input.payload.message) || null
    let nextFollowupAt: string | null = null
    if (toStatus === 'waiting') {
      if (!message) throw new Error('TASK_WAITING_REASON_REQUIRED')
      nextFollowupAt = parseIso(input.payload.nextFollowupAt, 'TASK_FOLLOWUP_REQUIRED')
      if (Date.parse(nextFollowupAt) > Date.parse(context.task.due_at)) {
        throw new Error('TASK_FOLLOWUP_AFTER_DUE')
      }
    }
    const expectedVersion = requireExpectedVersion(input.payload.version)
    const { error } = await admin.rpc('transition_operational_task', {
      p_task_id: context.task.id,
      p_to_status: toStatus,
      p_message: message,
      p_next_followup_at: nextFollowupAt,
      p_expected_version: expectedVersion,
      p_actor_profile_id: null,
      p_actor_contact_id: context.contactId,
      p_actor_access_link_id: context.accessLinkId,
    })
    if (error) throw databaseErrorCode(error, 'TASK_UPDATE_FAILED')
    notice = toStatus === 'in_progress'
      ? 'Uppgiften är startad.'
      : toStatus === 'waiting'
        ? 'Uppgiften är markerad som väntande. HusHub hanterar notifieringen.'
        : 'Uppgiften har lämnats för kontroll. HusHub hanterar notifieringen.'
  }

  const workspace = await getRecipientPortalTaskWorkspace(input.session, input.taskId)
  if (!workspace) throw new Error('TASK_NOT_FOUND')
  return { workspace, notice, warning }
}
