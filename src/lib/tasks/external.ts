import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  isAmbiguousTaskDeliveryError,
  sendTaskAccessLinkEmail,
  sendTaskWhatsAppAccessLink,
} from './automation'
import { buildTaskEmailHtml } from './emailTemplates'
import { formatTaskDateTime, normalizeTaskTimeZone } from './dateTime'
import { isTaskStatus } from './domain'
import type {
  TaskChannel,
  TaskCompletionEvidenceType,
  TaskEvidenceRequirement,
  TaskEventAuthorSide,
  TaskLatestMessageView,
  TaskRequirementStatus,
  TaskStatus,
} from './contracts'
import {
  TASK_COMPLETION_EVIDENCE_TYPES,
  evidenceTypesFromLegacyRequirement,
  legacyRequirementFromEvidenceTypes,
} from './contracts'
import type { TaskAttachmentActor } from './attachments'
import { ensureRecipientTaskEntryLink, issueDirectTaskAccessLink } from './recipientAuth'
import {
  loadTaskConversationSnapshots,
  markTaskConversationRead,
  notifyTaskComment,
  taskEventAuthorSide,
} from './conversation'

export type ExternalTaskWorkspace = {
  accessState: 'open' | 'expired' | 'revoked'
  timeZone: string
  recipientName: string
  canDelegate: boolean
  task: {
    id: string
    title: string
    description: string | null
    contextLabel: string | null
    status: TaskStatus
    dueAt: string
    dueTimeZone: string
    nextFollowupAt: string
    createdAt: string
    evidenceRequirement: TaskEvidenceRequirement
    evidenceRequirements: TaskCompletionEvidenceType[]
    issuerName: string
    assigneeName: string
    requirements: Array<{
      id: string
      key: string
      label: string
      status: TaskRequirementStatus
    }>
    events: Array<{
      id: string
      type: string
      actorName: string
      message: string | null
      fromStatus: TaskStatus | null
      toStatus: TaskStatus | null
      createdAt: string
      authorSide: TaskEventAuthorSide
    }>
    deadlineRequests: Array<{
      id: string
      requestedDueAt: string
      reason: string
      status: 'pending' | 'approved' | 'rejected' | 'cancelled'
    }>
    attachments: Array<{
      id: string
      type: 'photo' | 'document' | 'audio' | 'text'
      title: string | null
      fileName: string | null
      textContent: string | null
      transcriptText: string | null
      isCompletionEvidence: boolean
      createdAt: string
    }>
    unreadMessageCount: number
    latestMessage: TaskLatestMessageView | null
    latestIncomingMessageEventId: string | null
    version: number
  }
  children: Array<{
    id: string
    title: string
    status: TaskStatus
    dueAt: string
    dueTimeZone: string
    assigneeName: string
  }>
}

type AccessRow = {
  id: string
  org_id: string
  task_id: string
  root_task_id: string
  contact_id: string
  role: 'assignee' | 'delegator' | 'viewer'
  scope: 'task' | 'branch'
  expires_at: string
  revoked_at: string | null
}

type ExternalTaskRow = {
  id: string
  org_id: string
  parent_task_id: string | null
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
  created_at: string
  evidence_requirement: TaskEvidenceRequirement
  submitted_for_review_at: string | null
  version: number
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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

function taskDatabaseError(error: { message?: string | null } | null, fallback: string) {
  const code = error?.message?.match(/TASK_[A-Z0-9_]+/)?.[0]
  return new Error(code ?? fallback)
}

function isTaskChannel(value: unknown): value is TaskChannel {
  return value === 'email' || value === 'whatsapp'
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

function completionRequirement(evidence: readonly TaskCompletionEvidenceType[]) {
  if (evidence.length === 0) return []
  const labels: Record<TaskCompletionEvidenceType, string> = {
    text: 'textredovisning',
    photo: 'foto',
    document: 'dokument',
  }
  return [
    {
      requirement_key: 'completion_evidence',
      label: `Färdigbevis finns: ${evidence.map((type) => labels[type]).join(', ')}`,
      status: 'pending',
      is_required: true,
      sort_order: 100,
    },
  ]
}

async function enforceExternalActionRateLimit(access: AccessRow) {
  const admin = createSupabaseAdminClient()
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString()
  const { count, error } = await admin
    .from('task_events')
    .select('id', { count: 'exact', head: true })
    .eq('actor_access_link_id', access.id)
    .gte('created_at', since)
  if (error) throw new Error('TASK_RATE_LIMIT_CHECK_FAILED')
  if ((count ?? 0) >= 30) throw new Error('TASK_RATE_LIMITED')
}

async function resolveAccess(token: string) {
  if (!token || token.length < 32) return null
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('task_access_links')
    .select('id,org_id,task_id,root_task_id,contact_id,role,scope,expires_at,revoked_at')
    .eq('token_hash', hashAssignmentToken(token))
    .maybeSingle()
  if (error) throw new Error('TASK_ACCESS_READ_FAILED')
  const access = (data as AccessRow | null) ?? null
  if (!access) return null
  const { data: activeContact, error: contactError } = await admin
    .from('organization_contacts')
    .select('id')
    .eq('id', access.contact_id)
    .eq('org_id', access.org_id)
    .eq('is_active', true)
    .maybeSingle()
  if (contactError) throw new Error('TASK_CONTACT_READ_FAILED')
  return activeContact
    ? access
    : { ...access, revoked_at: access.revoked_at ?? new Date().toISOString() }
}

async function requireExternalTask(access: AccessRow) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,parent_task_id,root_task_id,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,status,due_at,due_timezone,next_followup_at,evidence_requirement,submitted_for_review_at,version,created_at'
    )
    .eq('id', access.task_id)
    .eq('org_id', access.org_id)
    .is('archived_at', null)
    .maybeSingle()
  if (error) throw new Error('TASK_READ_FAILED')
  if (!data) throw new Error('TASK_NOT_FOUND')
  const task = data as ExternalTaskRow
  if (access.role === 'assignee' && task.assignee_contact_id !== access.contact_id) {
    throw new Error('TASK_ACCESS_SCOPE_INVALID')
  }
  return task
}

export async function requireExternalTaskActor(token: string, options?: { allowLocked?: boolean }) {
  const access = await resolveAccess(token)
  if (!access) throw new Error('TASK_ACCESS_NOT_FOUND')
  if (accessState(access) !== 'open') throw new Error('TASK_ACCESS_CLOSED')
  if (access.role === 'viewer') throw new Error('TASK_EXTERNAL_ACTION_FORBIDDEN')
  await enforceExternalActionRateLimit(access)
  const task = await requireExternalTask(access)
  if (!options?.allowLocked && ['ready_for_review', 'approved', 'cancelled'].includes(task.status)) {
    throw new Error('TASK_ATTACHMENT_LOCKED')
  }
  const admin = createSupabaseAdminClient()
  const { data: contact, error } = await admin
    .from('organization_contacts')
    .select('name')
    .eq('id', access.contact_id)
    .eq('org_id', access.org_id)
    .eq('is_active', true)
    .maybeSingle()
  if (error || !contact) throw new Error('TASK_CONTACT_NOT_FOUND')
  const actor: TaskAttachmentActor = {
    type: 'contact',
    contactId: access.contact_id,
    accessLinkId: access.id,
    name: contact.name,
  }
  return { access, task, actor }
}

function accessState(access: AccessRow): ExternalTaskWorkspace['accessState'] {
  if (access.revoked_at) return 'revoked'
  if (new Date(access.expires_at).getTime() <= Date.now()) return 'expired'
  return 'open'
}

export async function getExternalTaskWorkspace(token: string): Promise<ExternalTaskWorkspace | null> {
  const access = await resolveAccess(token)
  if (!access) return null
  const state = accessState(access)
  if (state !== 'open') {
    const hiddenDate = new Date(0).toISOString()
    return {
      accessState: state,
      timeZone: normalizeTaskTimeZone(),
      recipientName: '',
      canDelegate: false,
      task: {
        id: '',
        title: '',
        description: null,
        contextLabel: null,
        status: 'cancelled',
        dueAt: hiddenDate,
        dueTimeZone: normalizeTaskTimeZone(),
        nextFollowupAt: hiddenDate,
        createdAt: hiddenDate,
        evidenceRequirement: 'optional',
        evidenceRequirements: [],
        issuerName: '',
        assigneeName: '',
        requirements: [],
        events: [],
        deadlineRequests: [],
        attachments: [],
        unreadMessageCount: 0,
        latestMessage: null,
        latestIncomingMessageEventId: null,
        version: 1,
      },
      children: [],
    }
  }
  const task = await requireExternalTask(access)
  const admin = createSupabaseAdminClient()

  const [contactResult, issuerResult, requirementsResult, completionEvidenceResult, eventsResult, deadlinesResult, attachmentsResult, childrenResult, settingsResult] =
    await Promise.all([
      admin
        .from('organization_contacts')
        .select('id,name')
        .eq('id', access.contact_id)
        .eq('org_id', access.org_id)
        .eq('is_active', true)
        .maybeSingle(),
      admin.from('profiles').select('id,full_name,email').eq('id', task.issuer_profile_id).maybeSingle(),
      admin
        .from('task_requirements')
        .select('id,requirement_key,label,status')
        .eq('task_id', task.id)
        .order('sort_order', { ascending: true }),
      admin
        .from('task_completion_evidence_requirements')
        .select('evidence_type')
        .eq('task_id', task.id),
      admin
        .from('task_events')
        .select('id,event_type,actor_type,actor_name,actor_profile_id,actor_contact_id,message,from_status,to_status,created_at')
        .eq('task_id', task.id)
        .neq('event_type', 'comment')
        .order('created_at', { ascending: false })
        .limit(30),
      admin
        .from('task_deadline_change_requests')
        .select('id,requested_due_at,reason,status')
        .eq('task_id', task.id)
        .order('created_at', { ascending: false }),
      admin
        .from('task_attachments')
        .select('id,attachment_type,title,file_name,text_content,transcript_text,is_completion_evidence,created_at')
        .eq('task_id', task.id)
        .or(
          `uploaded_by_contact_id.eq.${access.contact_id},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.${task.issuer_profile_id})`
        )
        .order('created_at', { ascending: false }),
      access.scope === 'branch'
        ? admin
            .from('operational_tasks')
            .select('id,title,status,due_at,due_timezone,assignee_profile_id,assignee_contact_id')
            .eq('parent_task_id', task.id)
            .is('archived_at', null)
            .order('due_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('task_organization_settings')
        .select('timezone')
        .eq('org_id', access.org_id)
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
    childrenResult.error,
    settingsResult.error,
  ].find(Boolean)
  if (firstError) throw new Error('TASK_EXTERNAL_WORKSPACE_FAILED')
  if (!contactResult.data) throw new Error('TASK_CONTACT_NOT_FOUND')

  await admin.from('task_access_links').update({ last_used_at: new Date().toISOString() }).eq('id', access.id)

  const childRows = childrenResult.data ?? []
  const childProfileIds = childRows.flatMap((child) => (child.assignee_profile_id ? [String(child.assignee_profile_id)] : []))
  const childContactIds = childRows.flatMap((child) => (child.assignee_contact_id ? [String(child.assignee_contact_id)] : []))
  const [childProfilesResult, childContactsResult] = await Promise.all([
    childProfileIds.length > 0
      ? admin.from('profiles').select('id,full_name,email').in('id', childProfileIds)
      : Promise.resolve({ data: [], error: null }),
    childContactIds.length > 0
      ? admin.from('organization_contacts').select('id,name').in('id', childContactIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const childProfiles = new Map(
    (childProfilesResult.data ?? []).map((profile) => [String(profile.id), profile.full_name || profile.email || 'Intern mottagare'])
  )
  const childContacts = new Map(
    (childContactsResult.data ?? []).map((contact) => [String(contact.id), contact.name || 'Extern mottagare'])
  )

  const issuerName = issuerResult.data?.full_name?.trim() || issuerResult.data?.email?.trim() || 'Uppdragsansvarig'
  const recipientName = String(contactResult.data.name)
  const conversation = (await loadTaskConversationSnapshots({
    taskIds: [task.id],
    viewer: { kind: 'contact', contactId: access.contact_id, accessLinkId: access.id },
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
          event.actor_contact_id === access.contact_id ||
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
      actorName: event.actor_name?.trim() || 'Signe',
      message: event.message ?? null,
      fromStatus: isTaskStatus(event.from_status) ? event.from_status : null,
      toStatus: isTaskStatus(event.to_status) ? event.to_status : null,
      createdAt: String(event.created_at),
      authorSide: taskEventAuthorSide(event, {
        kind: 'contact',
        contactId: access.contact_id,
        accessLinkId: access.id,
      }),
    }))
  const visibleEvents = [...conversation.comments, ...historyEvents].sort((left, right) => {
    const createdComparison = right.createdAt.localeCompare(left.createdAt)
    return createdComparison !== 0 ? createdComparison : right.id.localeCompare(left.id)
  })

  return {
    accessState: state,
    timeZone: normalizeTaskTimeZone(settingsResult.data?.timezone),
    recipientName,
    canDelegate: access.role === 'delegator' && access.scope === 'branch',
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
        (completionEvidenceResult.data ?? []).map(
          (requirement) => requirement.evidence_type as TaskCompletionEvidenceType
        ).length > 0
          ? (completionEvidenceResult.data ?? []).map(
              (requirement) => requirement.evidence_type as TaskCompletionEvidenceType
            )
          : evidenceTypesFromLegacyRequirement(task.evidence_requirement),
      issuerName,
      assigneeName: recipientName,
      requirements: (requirementsResult.data ?? []).map((requirement) => ({
        id: String(requirement.id),
        key: String(requirement.requirement_key),
        label: String(requirement.label),
        status: String(requirement.status) as TaskRequirementStatus,
      })),
      events: visibleEvents,
      deadlineRequests: (deadlinesResult.data ?? []).map((request) => ({
        id: String(request.id),
        requestedDueAt: String(request.requested_due_at),
        reason: String(request.reason),
        status: request.status as 'pending' | 'approved' | 'rejected' | 'cancelled',
      })),
      attachments: (attachmentsResult.data ?? []).map((attachment) => ({
        id: String(attachment.id),
        type: attachment.attachment_type as 'photo' | 'document' | 'audio' | 'text',
        title: attachment.title ?? null,
        fileName: attachment.file_name ?? null,
        textContent: attachment.text_content ?? null,
        transcriptText: attachment.transcript_text ?? null,
        isCompletionEvidence: Boolean(attachment.is_completion_evidence),
        createdAt: String(attachment.created_at),
      })),
      unreadMessageCount: conversation.unreadMessageCount,
      latestMessage: conversation.latestMessage,
      latestIncomingMessageEventId: conversation.latestIncomingMessageEventId,
      version: task.version,
    },
    children: childRows.map((child) => ({
      id: String(child.id),
      title: String(child.title),
      status: child.status as TaskStatus,
      dueAt: String(child.due_at),
      dueTimeZone: normalizeTaskTimeZone(child.due_timezone),
      assigneeName: child.assignee_profile_id
        ? childProfiles.get(String(child.assignee_profile_id)) ?? 'Intern mottagare'
        : childContacts.get(String(child.assignee_contact_id)) ?? 'Extern mottagare',
    })),
  }
}

async function externalEvent(input: {
  access: AccessRow
  type: string
  message?: string | null
  fromStatus?: TaskStatus | null
  toStatus?: TaskStatus | null
  metadata?: Record<string, unknown>
}) {
  const admin = createSupabaseAdminClient()
  const { data: contact } = await admin
    .from('organization_contacts')
    .select('name')
    .eq('id', input.access.contact_id)
    .maybeSingle()
  const actorName = contact?.name ?? 'Extern mottagare'
  const { data, error } = await admin
    .from('task_events')
    .insert({
      org_id: input.access.org_id,
      task_id: input.access.task_id,
      event_type: input.type,
      actor_type: 'contact',
      actor_contact_id: input.access.contact_id,
      actor_access_link_id: input.access.id,
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

async function createExternalSubtask(input: {
  access: AccessRow
  parent: ExternalTaskRow
  payload: Record<string, unknown>
  requestOrigin?: string | null
}) {
  if (input.access.role !== 'delegator' || input.access.scope !== 'branch') {
    throw new Error('TASK_EXTERNAL_DELEGATION_FORBIDDEN')
  }
  resolveTaskPublicBaseUrl(input.requestOrigin)
  if (asText(input.payload.parentTaskId) !== input.parent.id) throw new Error('TASK_PARENT_NOT_FOUND')
  const title = asText(input.payload.title)
  const description = asText(input.payload.description) || null
  if (!title) throw new Error('TASK_TITLE_REQUIRED')
  const dueAt = parseIso(input.payload.dueAt, 'TASK_DUE_REQUIRED')
  const nextFollowupAt = parseIso(input.payload.nextFollowupAt, 'TASK_FOLLOWUP_REQUIRED')
  if (new Date(dueAt).getTime() > new Date(input.parent.due_at).getTime()) {
    throw new Error('TASK_CHILD_AFTER_PARENT_DUE')
  }
  if (new Date(nextFollowupAt).getTime() > new Date(dueAt).getTime()) {
    throw new Error('TASK_FOLLOWUP_AFTER_DUE')
  }
  const expectedParentVersion = requireExpectedVersion(input.payload.version)
  const primaryChannel = isTaskChannel(input.payload.primaryChannel)
    ? input.payload.primaryChannel
    : 'email'
  const fallbackChannel = isTaskChannel(input.payload.fallbackChannel)
    ? input.payload.fallbackChannel
    : null
  if (fallbackChannel === primaryChannel) throw new Error('TASK_CHANNELS_MUST_DIFFER')
  const evidenceRequirements = Array.isArray(input.payload.evidenceRequirements)
    ? parseEvidenceRequirements(input.payload.evidenceRequirements)
    : isEvidenceRequirement(input.payload.evidenceRequirement)
      ? evidenceTypesFromLegacyRequirement(input.payload.evidenceRequirement)
      : []
  const evidenceRequirement = legacyRequirementFromEvidenceTypes(evidenceRequirements)
  const assignee =
    input.payload.assignee && typeof input.payload.assignee === 'object'
      ? (input.payload.assignee as Record<string, unknown>)
      : {}
  const name = asText(assignee.name)
  const email = asText(assignee.email).toLowerCase() || null
  const phone = asText(assignee.phone) || null
  if (!name) throw new Error('TASK_CONTACT_NAME_REQUIRED')
  if (!email) {
    throw new Error('TASK_CONTACT_EMAIL_REQUIRED')
  }
  if ((primaryChannel === 'whatsapp' || fallbackChannel === 'whatsapp') && !phone) {
    throw new Error('TASK_CONTACT_WHATSAPP_REQUIRED')
  }

  const admin = createSupabaseAdminClient()
  let contact: { id: string } | null = null
  if (email) {
    const { data, error } = await admin
      .from('organization_contacts')
      .select('id')
      .eq('org_id', input.access.org_id)
      .ilike('email', email)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle()
    if (error) throw new Error('TASK_CONTACT_READ_FAILED')
    contact = data ? { id: String(data.id) } : null
  }
  if (!contact) {
    const { data, error } = await admin
      .from('organization_contacts')
      .insert({
        org_id: input.access.org_id,
        name,
        email,
        phone,
        whatsapp_number: phone,
        preferred_channel: primaryChannel,
        is_active: true,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error('TASK_CONTACT_CREATE_FAILED')
    contact = { id: String(data.id) }
  }

  const { data: createdData, error } = await admin.rpc('create_operational_task_with_dispatch_control', {
    p_org_id: input.access.org_id,
    p_title: title,
    p_due_at: dueAt,
    p_next_followup_at: nextFollowupAt,
    p_primary_channel: primaryChannel,
    p_task_kind: 'simple',
    p_evidence_requirement: evidenceRequirement,
    p_evidence_requirements: evidenceRequirements,
    p_defer_initial_dispatch: false,
    p_assignee_profile_id: null,
    p_assignee_contact_id: contact.id,
    p_parent_task_id: input.parent.id,
    p_expected_parent_version: expectedParentVersion,
    p_description: description,
    p_context_label: input.parent.context_label,
    p_fallback_channel: fallbackChannel,
    p_requirements: completionRequirement(evidenceRequirements),
    p_actor_profile_id: null,
    p_actor_contact_id: input.access.contact_id,
    p_actor_access_link_id: input.access.id,
    p_source_ai_suggestion_id: null,
  })
  if (error) throw taskDatabaseError(error, 'TASK_CREATE_FAILED')
  const created = Array.isArray(createdData) ? createdData[0] : createdData
  if (!created || typeof created.id !== 'string') throw new Error('TASK_CREATE_FAILED')

  const issued = await issueTaskAccessLink({
    orgId: input.access.org_id,
    userId: input.parent.issuer_profile_id,
    taskId: created.id,
    requestOrigin: input.requestOrigin,
    sendEmail: true,
  })
  return {
    warning: issued.warning,
    notice: issued.warning
      ? 'Underuppgiften skapades, men mottagaren behöver meddelas.'
      : 'Underuppgiften skapades och mottagaren har fått sin uppdragslänk.',
  }
}

export async function performExternalTaskAction(input: {
  token: string
  action: string
  payload: Record<string, unknown>
  requestOrigin?: string | null
}) {
  const access = await resolveAccess(input.token)
  if (!access) throw new Error('TASK_ACCESS_NOT_FOUND')
  if (accessState(access) !== 'open') throw new Error('TASK_ACCESS_CLOSED')
  const task = await requireExternalTask(access)
  if (input.action === 'mark_messages_read') {
    const throughEventId = asText(input.payload.throughEventId)
    if (!throughEventId) throw new Error('TASK_CONVERSATION_CURSOR_REQUIRED')
    await markTaskConversationRead({
      taskId: task.id,
      throughEventId,
      reader: {
        kind: 'contact',
        contactId: access.contact_id,
        accessLinkId: access.id,
      },
    })
    const workspace = await getExternalTaskWorkspace(input.token)
    if (!workspace) throw new Error('TASK_ACCESS_NOT_FOUND')
    return { workspace, notice: 'Meddelandena markerades som lästa.', warning: null }
  }
  if (access.role === 'viewer') throw new Error('TASK_EXTERNAL_ACTION_FORBIDDEN')
  await enforceExternalActionRateLimit(access)
  const admin = createSupabaseAdminClient()

  let warning: string | null = null
  let notice = 'Uppgiften uppdaterades.'
  if (input.action === 'comment') {
    if (['approved', 'cancelled'].includes(task.status)) throw new Error('TASK_TERMINAL')
    const message = asText(input.payload.message)
    if (!message) throw new Error('TASK_COMMENT_REQUIRED')
    const event = await externalEvent({ access, type: 'comment', message })
    const notification = await notifyTaskComment({
      orgId: access.org_id,
      taskId: task.id,
      eventId: event.id,
      message,
      actor: {
        kind: 'contact',
        contactId: access.contact_id,
        accessLinkId: access.id,
        name: event.actorName,
      },
      requestOrigin: input.requestOrigin,
    })
    warning = notification.warning
    notice = notification.warning
      ? 'Meddelandet finns sparat.'
      : 'Meddelandet har skickats och mottagaren har notifierats via e-post.'
  } else if (input.action === 'create_subtask') {
    const created = await createExternalSubtask({
      access,
      parent: task,
      payload: input.payload,
      requestOrigin: input.requestOrigin,
    })
    warning = created.warning
    notice = created.notice
  } else if (input.action === 'request_deadline_change') {
    const reason = asText(input.payload.reason)
    const requestedDueAt = parseIso(input.payload.requestedDueAt, 'TASK_EXTENSION_DATE_REQUIRED')
    if (!reason) throw new Error('TASK_EXTENSION_REASON_REQUIRED')
    if (new Date(requestedDueAt).getTime() <= new Date(task.due_at).getTime()) {
      throw new Error('TASK_EXTENSION_DATE_INVALID')
    }
    const { error } = await admin.rpc('request_operational_task_deadline_change', {
      p_task_id: task.id,
      p_requested_due_at: requestedDueAt,
      p_reason: reason,
      p_actor_profile_id: null,
      p_actor_contact_id: access.contact_id,
      p_actor_access_link_id: access.id,
    })
    if (error) throw taskDatabaseError(error, 'TASK_EXTENSION_CREATE_FAILED')
  } else {
    const toStatus: TaskStatus | null =
      input.action === 'start'
        ? 'in_progress'
        : input.action === 'waiting'
          ? 'waiting'
          : input.action === 'ready_for_review'
            ? 'ready_for_review'
            : null
    if (!toStatus) throw new Error('TASK_TRANSITION_INVALID')
    const message = asText(input.payload.message) || null
    let nextFollowupAt: string | null = null
    if (toStatus === 'waiting') {
      if (!message) throw new Error('TASK_WAITING_REASON_REQUIRED')
      nextFollowupAt = parseIso(input.payload.nextFollowupAt, 'TASK_FOLLOWUP_REQUIRED')
      if (new Date(nextFollowupAt).getTime() > new Date(task.due_at).getTime()) {
        throw new Error('TASK_FOLLOWUP_AFTER_DUE')
      }
    }
    const expectedVersion = requireExpectedVersion(input.payload.version)
    const { error } = await admin.rpc('transition_operational_task', {
      p_task_id: task.id,
      p_to_status: toStatus,
      p_message: message,
      p_next_followup_at: nextFollowupAt,
      p_expected_version: expectedVersion,
      p_actor_profile_id: null,
      p_actor_contact_id: access.contact_id,
      p_actor_access_link_id: access.id,
    })
    if (error) throw taskDatabaseError(error, 'TASK_UPDATE_FAILED')
  }

  const workspace = await getExternalTaskWorkspace(input.token)
  if (!workspace) throw new Error('TASK_ACCESS_NOT_FOUND')
  return { workspace, notice, warning }
}

export function resolveTaskPublicBaseUrl(requestOrigin?: string | null) {
  const configured = process.env.APP_BASE_URL?.trim()
  if (process.env.NODE_ENV === 'production' && !configured) throw new Error('MISSING_ENV:APP_BASE_URL')
  const candidate = configured || requestOrigin?.trim()
  if (!candidate) throw new Error('MISSING_ENV:APP_BASE_URL')
  const url = new URL(candidate)
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('INVALID_ENV:APP_BASE_URL')
  }
  return url.origin
}

export async function issueTaskAccessLink(input: {
  orgId: string
  userId: string
  taskId: string
  requestOrigin?: string | null
  sendEmail?: boolean
}) {
  const publicBaseUrl = resolveTaskPublicBaseUrl(input.requestOrigin)
  const admin = createSupabaseAdminClient()
  const { data: task, error: taskError } = await admin
    .from('operational_tasks')
    .select('id,title,description,due_at,due_timezone,primary_channel,fallback_channel,assignee_contact_id,issuer_profile_id')
    .eq('id', input.taskId)
    .eq('org_id', input.orgId)
    .is('archived_at', null)
    .maybeSingle()
  if (taskError) throw new Error('TASK_READ_FAILED')
  if (!task) throw new Error('TASK_NOT_FOUND')
  if (!task.assignee_contact_id) throw new Error('TASK_EXTERNAL_ASSIGNEE_REQUIRED')
  const { data: contact, error: contactError } = await admin
    .from('organization_contacts')
    .select('id,name')
    .eq('id', task.assignee_contact_id)
    .eq('org_id', input.orgId)
    .maybeSingle()
  if (contactError || !contact) throw new Error('TASK_CONTACT_NOT_FOUND')
  if (input.sendEmail === false) {
    return {
      accessUrl: undefined,
      warning: 'Personliga uppdragslänkar skickas endast direkt till mottagaren.',
    }
  }

  let recipientIdentityId: string | null = null
  let entryMode: 'activation' | 'portal' | 'legacy' = 'legacy'
  let secondaryActionUrl: string | null = null
  let secondaryActionLabel: string | null = null

  const entry = await ensureRecipientTaskEntryLink({
    contactId: contact.id,
    taskId: task.id,
    baseUrl: publicBaseUrl,
  }).catch((error: unknown) => {
    if (
      error instanceof Error &&
      ['TASK_RECIPIENT_EMAIL_INVALID', 'TASK_RECIPIENT_IDENTITY_EMAIL_INVALID'].includes(error.message)
    ) return null
    throw error
  })
  if (entry) {
    entryMode = entry.mode
    recipientIdentityId = entry.recipientIdentityId
    secondaryActionUrl = entry.mode === 'activation'
      ? entry.url
      : `${publicBaseUrl}/mina-uppdrag`
    secondaryActionLabel = entry.mode === 'activation'
      ? 'Aktivera Mina uppdrag'
      : 'Gå till Mina uppdrag'
  }

  const directLink = await issueDirectTaskAccessLink({
    taskId: task.id,
    contactId: contact.id,
    createdByProfileId: input.userId,
    baseUrl: publicBaseUrl,
  })
  const accessUrl = directLink.url
  const deliveryKey = directLink.deliveryKey
  const deliveryEmail = directLink.recipientEmail
  const whatsappAddress = directLink.recipientWhatsappNumber

  if (
    entry &&
    (
      entry.recipientIdentityId !== directLink.recipientIdentityId ||
      entry.recipientEmail !== directLink.recipientEmail
    )
  ) {
    recipientIdentityId = null
    entryMode = 'legacy'
    secondaryActionUrl = null
    secondaryActionLabel = null
  }

  // Both the direct bearer URL and a possible activation URL are credentials.
  // They may only leave this process in the provider payload below, never in
  // an internal API response, audit text or provider metadata.
  const { data: issuer } = await admin
    .from('profiles')
    .select('full_name,email')
    .eq('id', task.issuer_profile_id)
    .maybeSingle()
  const issuerName = issuer?.full_name?.trim() || 'Uppdragsansvarig'
  const subject = `Nytt uppdrag: ${task.title}`
  const dueLabel = formatTaskDateTime(task.due_at, task.due_timezone, 'long')
  const bodyText = [
    `${contact.name},`,
    '',
    `${issuerName} har tilldelat dig uppgiften ”${task.title}”.`,
    `Slutdatum: ${dueLabel}.`,
    '',
    'Öppna uppdraget direkt via den personliga länken. Du behöver inte logga in.',
    `Öppna uppdraget: ${accessUrl}`,
    secondaryActionUrl && secondaryActionLabel
      ? `${secondaryActionLabel}: ${secondaryActionUrl}`
      : null,
    '',
    'Länken är personlig och ska inte vidarebefordras.',
    '',
    'Signe är HusHubs digitala uppföljningsassistent.',
  ].filter((line): line is string => line !== null).join('\n')
  const bodyHtml = buildTaskEmailHtml({
    previewText: `${issuerName} har tilldelat dig uppdraget ${task.title}.`,
    eyebrow: 'Nytt uppdrag',
    heading: 'Du har fått ett nytt uppdrag',
    recipientName: contact.name,
    lead: `${issuerName} har tilldelat dig följande uppdrag.`,
    taskTitle: task.title,
    dueLabel,
    instruction: 'Öppna uppdraget direkt utan att logga in för att läsa hela beskrivningen, uppdatera status och lämna underlag.',
    actionUrl: accessUrl,
    actionLabel: 'Öppna uppdraget',
    secondaryActionUrl,
    secondaryActionLabel: secondaryActionLabel ?? undefined,
    notice: 'Den direkta uppdragslänken är personlig. Vidarebefordra den inte till någon annan.',
  })
  const auditBodyText = `${contact.name} fick en personlig direktlänk till ”${task.title}”${entryMode === 'activation' ? ' samt möjlighet att aktivera Mina uppdrag' : entryMode === 'portal' ? ' samt en genväg till Mina uppdrag' : ''}. Själva länktoken sparas inte i meddelandeloggen.`
  const { data: message, error: messageError } = await admin
    .from('task_messages')
    .insert({
      org_id: input.orgId,
      task_id: task.id,
      direction: 'outbound',
      message_type: 'assignment',
      actor_type: 'profile',
      actor_profile_id: input.userId,
      actor_name: issuerName,
      body_text: auditBodyText,
      metadata: {
        accessLinkId: directLink.accessLinkId,
        ...(recipientIdentityId ? { recipientIdentityId } : {}),
        entryMode,
        target: 'assignee',
        tokenPersisted: false,
      },
    })
    .select('id')
    .single()
  if (messageError || !message) {
    return {
      accessUrl: undefined,
      warning: 'Uppdragslänken kunde inte skickas eftersom utskicksloggen inte kunde sparas.',
    }
  }

  const primaryChannel = isTaskChannel(task.primary_channel) ? task.primary_channel : null
  const fallbackChannel = isTaskChannel(task.fallback_channel)
    && task.fallback_channel !== primaryChannel
    ? task.fallback_channel
    : null
  const configuredChannels = [primaryChannel, fallbackChannel]
    .filter((channel): channel is TaskChannel => channel !== null)

  const sendActivationCompanionEmail = async () => {
    if (
      entry?.mode !== 'activation' ||
      !secondaryActionUrl ||
      !deliveryEmail
    ) return null

    const activationSubject = `Aktivera Mina uppdrag: ${task.title}`
    const activationText = [
      `${contact.name},`,
      '',
      'Din personliga WhatsApp-länk öppnar det aktuella uppdraget utan inloggning.',
      'Välj ett lösenord för att även kunna logga in och se alla dina uppdrag på ett ställe.',
      '',
      `Aktivera Mina uppdrag: ${secondaryActionUrl}`,
      `Öppna aktuellt uppdrag: ${accessUrl}`,
      '',
      'Aktiveringslänken är personlig och ska inte vidarebefordras.',
    ].join('\n')
    const activationHtml = buildTaskEmailHtml({
      previewText: 'Välj ett lösenord för Mina uppdrag i HusHub.',
      eyebrow: 'Mina uppdrag',
      heading: 'Samla dina uppdrag på ett ställe',
      recipientName: contact.name,
      lead: 'Välj ett lösenord för att kunna logga in och se alla uppdrag som har skickats till dig.',
      taskTitle: task.title,
      dueLabel,
      instruction: 'WhatsApp-länken fortsätter att öppna det aktuella uppdraget direkt. Kontot behövs först när du vill använda Mina uppdrag.',
      actionUrl: secondaryActionUrl,
      actionLabel: 'Aktivera Mina uppdrag',
      secondaryActionUrl: accessUrl,
      secondaryActionLabel: 'Öppna aktuellt uppdrag',
      notice: 'Aktiveringslänken är personlig. Vidarebefordra den inte till någon annan.',
    })
    const activationIdempotencyKey = `task-entry:${deliveryKey}:${entry.deliveryKey}:activation-email`
    const { data: activationDelivery, error: activationDeliveryError } = await admin
      .from('task_message_deliveries')
      .insert({
        org_id: input.orgId,
        task_id: task.id,
        message_id: message.id,
        channel: 'email',
        recipient_address: deliveryEmail,
        provider: 'resend',
        status: 'sending',
        is_fallback: false,
        attempt_count: 1,
        idempotency_key: activationIdempotencyKey,
        provider_payload: {
          accessLinkId: directLink.accessLinkId,
          recipientIdentityId: entry.recipientIdentityId,
          entryMode: 'activation',
          accountActivation: true,
          tokenPersisted: false,
        },
      })
      .select('id')
      .single()
    if (activationDeliveryError || !activationDelivery) {
      return 'Uppdraget skickades via WhatsApp, men aktiveringsmejlet för Mina uppdrag kunde inte skapas.'
    }

    try {
      const activationResult = await sendTaskAccessLinkEmail({
        to: deliveryEmail,
        replyTo: issuer?.email ?? null,
        subject: activationSubject,
        text: activationText,
        html: activationHtml,
        idempotencyKey: activationIdempotencyKey,
      })
      const sentAt = new Date().toISOString()
      const deliveryUpdate = await admin
        .from('task_message_deliveries')
        .update({
          status: 'sent',
          sent_at: sentAt,
          provider_message_id: activationResult.providerMessageId,
          error_message: null,
        })
        .eq('id', activationDelivery.id)
      const eventResult = await admin.from('task_events').insert({
        org_id: input.orgId,
        task_id: task.id,
        event_type: 'recipient_activation_delivery_sent',
        actor_type: 'profile',
        actor_profile_id: input.userId,
        actor_name: issuerName,
        message: `Aktiveringsmejlet för Mina uppdrag skickades till ${contact.name}.`,
        metadata: {
          taskMutationApplied: true,
          accessLinkId: directLink.accessLinkId,
          recipientIdentityId: entry.recipientIdentityId,
          messageId: message.id,
          deliveryId: activationDelivery.id,
          channel: 'email',
          accountActivation: true,
          tokenPersisted: false,
        },
      })
      if (deliveryUpdate.error || eventResult.error) {
        return 'Uppdraget skickades via WhatsApp. Aktiveringsmejlet skickades, men kunde inte loggas fullständigt.'
      }
      return null
    } catch (error) {
      const providerErrorCode = taskDeliveryErrorCode(error, 'email')
      const deliveryAmbiguous = isAmbiguousTaskDeliveryError(error)
      await admin
        .from('task_message_deliveries')
        .update({
          status: deliveryAmbiguous ? 'ambiguous' : 'failed',
          failed_at: deliveryAmbiguous ? null : new Date().toISOString(),
          next_attempt_at: null,
          error_message: deliveryAmbiguous
            ? 'TASK_DELIVERY_RECONCILIATION_REQUIRED'
            : providerErrorCode,
        })
        .eq('id', activationDelivery.id)
      if (deliveryAmbiguous) {
        return 'Uppdraget skickades via WhatsApp, men leveransstatusen för aktiveringsmejlet kunde inte bekräftas. Kontrollera leveransen manuellt innan ett nytt mejl skickas.'
      }
      return 'Uppdraget skickades via WhatsApp, men aktiveringsmejlet för Mina uppdrag kunde inte skickas.'
    }
  }

  for (const [channelIndex, channel] of configuredChannels.entries()) {
    const recipientAddress = channel === 'email' ? deliveryEmail : whatsappAddress
    const idempotencyKey = `task-entry:${deliveryKey}:${channel}`
    const errorCode = !recipientAddress
      ? channel === 'email'
        ? 'TASK_CONTACT_EMAIL_REQUIRED'
        : 'TASK_CONTACT_WHATSAPP_REQUIRED'
      : null
    const { data: delivery, error: deliveryError } = await admin
      .from('task_message_deliveries')
      .insert({
        org_id: input.orgId,
        task_id: task.id,
        message_id: message.id,
        channel,
        recipient_address: recipientAddress || `missing:contact:${contact.id}`,
        provider: channel === 'email' ? 'resend' : 'meta_whatsapp',
        status: errorCode ? 'failed' : 'sending',
        is_fallback: channelIndex > 0,
        attempt_count: errorCode ? 0 : 1,
        failed_at: errorCode ? new Date().toISOString() : null,
        error_message: errorCode,
        idempotency_key: idempotencyKey,
        provider_payload: {
          accessLinkId: directLink.accessLinkId,
          ...(recipientIdentityId ? { recipientIdentityId } : {}),
          entryMode,
          assignment: true,
          tokenPersisted: false,
        },
      })
      .select('id')
      .single()
    if (deliveryError || !delivery || errorCode || !recipientAddress) continue

    try {
      const result = channel === 'email'
        ? await sendTaskAccessLinkEmail({
            to: recipientAddress,
            replyTo: issuer?.email ?? null,
            subject,
            text: bodyText,
            html: bodyHtml,
            idempotencyKey,
          })
        : await sendTaskWhatsAppAccessLink({
            to: recipientAddress,
            recipientName: contact.name,
            taskTitle: task.title,
            dueAt: task.due_at,
            dueTimeZone: task.due_timezone,
            accessUrl,
            idempotencyKey,
          })
      const sentAt = new Date().toISOString()
      const deliveryUpdate = await admin
        .from('task_message_deliveries')
        .update({
          status: 'sent',
          sent_at: sentAt,
          provider_message_id: result.providerMessageId,
          error_message: null,
        })
        .eq('id', delivery.id)
      const linkUpdate = await admin
        .from('task_access_links')
        .update({ sent_at: sentAt })
        .eq('id', directLink.accessLinkId)
      const eventResult = await admin.from('task_events').insert({
            org_id: input.orgId,
            task_id: task.id,
            event_type: 'assignment_delivery_sent',
            actor_type: 'profile',
            actor_profile_id: input.userId,
            actor_name: issuerName,
            message: `Den personliga uppdragslänken skickades till ${contact.name} via ${channel === 'email' ? 'e-post' : 'WhatsApp'}.`,
            metadata: {
              taskMutationApplied: true,
              accessLinkId: directLink.accessLinkId,
              ...(recipientIdentityId ? { recipientIdentityId } : {}),
              entryMode,
              messageId: message.id,
              deliveryId: delivery.id,
              channel,
              isFallback: channelIndex > 0,
              tokenPersisted: false,
            },
          })
      const activationWarning = channel === 'whatsapp'
        ? await sendActivationCompanionEmail()
        : null
      if (deliveryUpdate.error || linkUpdate.error || eventResult.error) {
        return { accessUrl: undefined, warning: activationWarning }
      }
      return { accessUrl: undefined, warning: activationWarning }
    } catch (error) {
      const providerErrorCode = taskDeliveryErrorCode(error, channel)
      const deliveryAmbiguous = isAmbiguousTaskDeliveryError(error)
      await admin
        .from('task_message_deliveries')
        .update({
          status: deliveryAmbiguous ? 'ambiguous' : 'failed',
          failed_at: deliveryAmbiguous ? null : new Date().toISOString(),
          next_attempt_at: null,
          error_message: deliveryAmbiguous
            ? 'TASK_DELIVERY_RECONCILIATION_REQUIRED'
            : providerErrorCode,
        })
        .eq('id', delivery.id)
      if (deliveryAmbiguous) {
        return {
          accessUrl: undefined,
          warning: 'Leveransstatusen kunde inte bekräftas. Inget reservutskick gjordes, eftersom det kan skapa ett dubbelmeddelande. Kontrollera leveransen manuellt.',
        }
      }
    }
  }

  return {
    accessUrl: undefined,
    warning: 'Uppdragslänken kunde inte skickas i vald kanal eller reservkanal. Kontrollera kontaktuppgifterna och försök igen.',
  }
}

function taskDeliveryErrorCode(error: unknown, channel: TaskChannel) {
  const message = error instanceof Error ? error.message : ''
  return /^TASK_[A-Z0-9_]+$/.test(message)
    ? message
    : channel === 'email'
      ? 'TASK_EMAIL_PROVIDER_FAILED'
      : 'TASK_WHATSAPP_PROVIDER_FAILED'
}
