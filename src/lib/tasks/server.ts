import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type {
  TaskActionResponse,
  TaskAiSuggestionView,
  TaskAttachmentView,
  TaskChannel,
  TaskDeadlineRequestView,
  TaskEventView,
  TaskEvidenceRequirement,
  TaskKind,
  TaskPerson,
  TaskRequirementStatus,
  TaskRequirementView,
  TaskStatus,
  TaskView,
  TaskWorkspace,
} from './contracts'
import {
  DEFAULT_TASK_AUTOMATION_LIMITS,
  evaluateTaskRisk,
  getTaskBallHolderKind,
  isTaskStatus,
  isTerminalTaskStatus,
} from './domain'
import { issueTaskAccessLink, resolveTaskPublicBaseUrl } from './external'
import { rejectSigneSuggestion, requestSigneSuggestions } from './signe'

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

type EventRow = {
  id: string
  task_id: string
  event_type: string
  actor_name: string | null
  actor_profile_id: string | null
  message: string | null
  from_status: TaskStatus | null
  to_status: TaskStatus | null
  created_at: string
}

type DeadlineRequestRow = {
  id: string
  task_id: string
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
  return value === 'simple' || value === 'paid_external' || value === 'warranty'
}

function isTaskChannel(value: unknown): value is TaskChannel {
  return value === 'email' || value === 'whatsapp'
}

function isEvidenceRequirement(value: unknown): value is TaskEvidenceRequirement {
  return value === 'optional' || value === 'text' || value === 'photo' || value === 'document' || value === 'any'
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

function requirementTemplates(kind: TaskKind, evidence: TaskEvidenceRequirement) {
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
  if (evidence !== 'optional') {
    const evidenceLabels: Record<Exclude<TaskEvidenceRequirement, 'optional'>, string> = {
      text: 'Textredovisning finns',
      photo: 'Fotobevis finns',
      document: 'Dokumentation finns',
      any: 'Överenskommet färdigbevis finns',
    }
    requirements.push({
      requirement_key: 'completion_evidence',
      label: evidenceLabels[evidence],
      is_required: true,
      status: 'pending',
    })
  }
  return requirements
}

async function loadRows(orgId: string) {
  const admin = createSupabaseAdminClient()
  const [taskResult, contactResult, memberResult] = await Promise.all([
    admin
      .from('operational_tasks')
      .select(
        'id,org_id,parent_task_id,root_task_id,depth,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,task_kind,status,due_at,next_followup_at,primary_channel,fallback_channel,evidence_requirement,review_round,version,created_source,submitted_for_review_at,approved_at,approved_by_profile_id,archived_at,created_at,updated_at'
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
  ])

  if (taskResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
  if (contactResult.error) throw new Error('TASK_CONTACTS_READ_FAILED')
  if (memberResult.error) throw new Error('TASK_MEMBERS_READ_FAILED')

  const tasks = (taskResult.data ?? []) as OperationalTaskRow[]
  const contacts = (contactResult.data ?? []) as ContactRow[]
  const memberProfileIds = (memberResult.data ?? []).map((row) => String(row.profile_id))
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

  const taskIds = tasks.map((task) => task.id)
  let requirements: RequirementRow[] = []
  let events: EventRow[] = []
  let deadlineRequests: DeadlineRequestRow[] = []
  let attachments: AttachmentRow[] = []
  let aiSuggestions: AiSuggestionRow[] = []
  let followupRules: FollowupRuleRow[] = []
  if (taskIds.length > 0) {
    const [requirementsResult, eventsResult, deadlineResult, attachmentsResult, suggestionsResult, followupResult] = await Promise.all([
      admin
        .from('task_requirements')
        .select('id,task_id,requirement_key,label,status,is_required,verified_by_profile_id,verified_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: true }),
      admin
        .from('task_events')
        .select('id,task_id,event_type,actor_name,actor_profile_id,message,from_status,to_status,created_at')
        .in('task_id', taskIds)
        .order('created_at', { ascending: false }),
      admin
        .from('task_deadline_change_requests')
        .select('id,task_id,requested_due_at,reason,status,decided_at,decision_note,created_at')
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
    ])
    if (requirementsResult.error) throw new Error('TASK_REQUIREMENTS_READ_FAILED')
    if (eventsResult.error) throw new Error('TASK_EVENTS_READ_FAILED')
    if (deadlineResult.error) throw new Error('TASK_DEADLINES_READ_FAILED')
    if (attachmentsResult.error) throw new Error('TASK_ATTACHMENTS_READ_FAILED')
    if (suggestionsResult.error) throw new Error('TASK_AI_SUGGESTIONS_READ_FAILED')
    if (followupResult.error) throw new Error('TASKS_SCHEMA_REQUIRED')
    requirements = (requirementsResult.data ?? []) as RequirementRow[]
    events = (eventsResult.data ?? []) as EventRow[]
    deadlineRequests = (deadlineResult.data ?? []) as DeadlineRequestRow[]
    attachments = (attachmentsResult.data ?? []) as AttachmentRow[]
    aiSuggestions = (suggestionsResult.data ?? []) as AiSuggestionRow[]
    followupRules = (followupResult.data ?? []) as FollowupRuleRow[]
  }

  return { tasks, contacts, profiles, requirements, events, deadlineRequests, attachments, aiSuggestions, followupRules }
}

export async function getTaskWorkspace(input: InternalTaskContext): Promise<TaskWorkspace> {
  const rows = await loadRows(input.orgId)
  const visibleIds = actorCanSeeTaskTree(rows.tasks, input.userId, input.isOrgAdmin)
  const visibleTasks = rows.tasks.filter((task) => visibleIds.has(task.id))
  const profilesById = new Map(rows.profiles.map((profile) => [profile.id, profile]))
  const contactsById = new Map(rows.contacts.map((contact) => [contact.id, contact]))
  const currentProfile = profilesById.get(input.userId)

  const people: TaskPerson[] = [
    ...rows.profiles.map((profile) => ({
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
    const eventViews: TaskEventView[] = (eventsByTask.get(task.id) ?? []).map((event) => ({
      id: event.id,
      type: event.event_type,
      actorName:
        event.actor_name?.trim() ||
        (event.actor_profile_id ? profilesById.get(event.actor_profile_id)?.full_name?.trim() : null) ||
        'Signe',
      message: event.message,
      fromStatus: event.from_status,
      toStatus: event.to_status,
      createdAt: event.created_at,
    }))
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
      }).level,
      ballHolder:
        initialDispatchPending || hasPendingDeadlineRequest
          ? 'issuer'
          : getTaskBallHolderKind(task.status),
      dueAt: task.due_at,
      nextFollowupAt: task.next_followup_at,
      primaryChannel: task.primary_channel,
      fallbackChannel: task.fallback_channel,
      evidenceRequirement: task.evidence_requirement,
      initialDispatchPending,
      issuerId: task.issuer_profile_id,
      issuerName: issuer?.full_name?.trim() || issuer?.email?.trim() || 'Uppdragsansvarig',
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

  return {
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
    },
    limits: TASK_LIMITS,
  }
}

async function requireTask(orgId: string, taskId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('operational_tasks')
    .select(
      'id,org_id,parent_task_id,root_task_id,depth,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,task_kind,status,due_at,next_followup_at,primary_channel,fallback_channel,evidence_requirement,review_round,version,created_source,submitted_for_review_at,approved_at,approved_by_profile_id,archived_at,created_at,updated_at'
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
  const { error } = await admin.from('task_events').insert({
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
  if (error) throw new Error('TASK_EVENT_CREATE_FAILED')
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
    if (!email && !phone) throw new Error('TASK_CONTACT_METHOD_REQUIRED')
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
  const evidenceRequirement: TaskEvidenceRequirement = isEvidenceRequirement(input.payload.evidenceRequirement)
    ? input.payload.evidenceRequirement
    : 'optional'
  const parentTaskId = optionalText(input.payload.parentTaskId)
  const sourceAiSuggestionId = optionalText(input.payload.sourceAiSuggestionId)
  let parent: OperationalTaskRow | null = null

  if (sourceAiSuggestionId && !parentTaskId) {
    throw new Error('TASK_AI_SUGGESTION_PARENT_REQUIRED')
  }

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
    if ((primaryChannel === 'email' || fallbackChannel === 'email') && !assignee.contactEmail) {
      throw new Error('TASK_CONTACT_EMAIL_REQUIRED')
    }
    if ((primaryChannel === 'whatsapp' || fallbackChannel === 'whatsapp') && !assignee.contactPhone) {
      throw new Error('TASK_CONTACT_WHATSAPP_REQUIRED')
    }
  }
  const templates = requirementTemplates(taskKind, evidenceRequirement)
  const admin = createSupabaseAdminClient()
  const expectedParentVersion = parent
    ? requireExpectedVersion(input.payload.parentVersion)
    : null
  const { data: createdData, error } = await admin.rpc('create_operational_task_with_dispatch_control', {
    p_org_id: input.orgId,
    p_title: title,
    p_due_at: dueAt,
    p_next_followup_at: nextFollowupAt,
    p_primary_channel: primaryChannel,
    p_task_kind: taskKind,
    p_evidence_requirement: evidenceRequirement,
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
  })
  if (error) throw taskDatabaseError(error, 'TASK_CREATE_FAILED')
  const created = Array.isArray(createdData) ? createdData[0] : createdData
  if (!created || typeof created.id !== 'string') throw new Error('TASK_CREATE_FAILED')

  return {
    taskId: created.id,
    hasExternalAssignee: Boolean(assignee.assignee_contact_id),
    notice: sourceAiSuggestionId
      ? 'Underuppgiften skapades och Signe-förslaget markerades som använt.'
      : parent
        ? 'Underuppgiften skapades.'
        : 'Uppgiften skapades.',
  }
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

  return 'Uppdraget och bilagorna är klara. Signe skickar uppdraget till mottagaren.'
}

async function transitionTask(input: TaskActionInput) {
  const taskId = asText(input.payload.taskId)
  const toStatus = input.payload.status
  if (!taskId || !isTaskStatus(toStatus)) throw new Error('TASK_STATUS_INVALID')
  const task = await requireTask(input.orgId, taskId)
  const message = optionalText(input.payload.message)
  const expectedVersion = requireExpectedVersion(input.payload.version)
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

  return toStatus === 'approved'
    ? 'Uppgiften är godkänd.'
    : toStatus === 'returned'
      ? 'Uppgiften skickades tillbaka.'
      : 'Statusen uppdaterades.'
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
  await recordEvent({ orgId: input.orgId, taskId, userId: input.userId, type: 'comment', message })
  return 'Kommentaren sparades.'
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
  if (task.assignee_profile_id !== input.userId && !input.isOrgAdmin) {
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
  return 'Förlängningen skickades till uppdragsansvarig.'
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
  return decision === 'approved' ? 'Förlängningen godkändes.' : 'Förlängningen avslogs.'
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
        ? `${notice} Den personliga länken skapades men behöver delas manuellt.`
        : `${notice} Mottagaren har fått sin personliga länk.`
    } else if (input.payload.sendAssignment === false) {
      notice = `${notice} Utskicket till mottagaren väntar tills underlagen har sparats.`
    }
  } else if (input.action === 'transition') {
    notice = await transitionTask(input)
  } else if (input.action === 'comment') {
    notice = await addComment(input)
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
    notice = issued.warning ? 'Länken skapades och kopierades.' : 'Länken skapades och skickades.'
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
