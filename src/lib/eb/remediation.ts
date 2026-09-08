import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { getEbProjectById, type EbProjectListItem } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ebRemediationAllowedStatuses, ebRemediationCanComment, ebRemediationCanManage } from '@/lib/eb/remediationPolicy'
import { getEbInspectionReportFromSnapshot } from '@/lib/eb/reportSnapshot'
import { ebReportNoteDisplayIndex } from '@/lib/eb/reportNoteDisplay'
import { queueEbFollowUpEmail } from '@/lib/eb/followUpDelivery'
import { requestEbFollowUpOwnerRenewal, withdrawEbFollowUpOrder } from '@/lib/eb/followUpServer'
import { assertEbRemediationOwnerSession } from '@/lib/eb/ownerAuth'
import {
  ebRemediationAssignmentDueDate,
  ebRemediationContractorSuggestions,
  ebRemediationReportDeadline,
  type EbRemediationContractorSuggestion,
} from '@/lib/eb/remediationDefaults'

export type { EbRemediationContractorSuggestion } from '@/lib/eb/remediationDefaults'

export const EB_REMEDIATION_IMAGE_BUCKET = 'eb-remediation-images'
export const EB_REMEDIATION_MAX_IMAGE_BYTES = 15 * 1024 * 1024

export type EbRemediationStatus =
  | 'unassigned'
  | 'assigned'
  | 'in_progress'
  | 'ready_for_review'
  | 'returned'
  | 'reported_remedied'
  | 'cannot_remedy'

export type EbRemediationAccessRole = 'contractor_admin' | 'contractor_viewer' | 'assignee' | 'customer_owner'

export type EbRemediationAssignee = {
  id: string
  name: string
  companyName: string | null
  contactName: string | null
  email: string | null
  phone: string | null
  isActive: boolean
  createdAt: string | null
  updatedAt: string | null
}

export type EbRemediationTaskSnapshot = {
  noteNumber: number | null
  noteText: string
  location: string | null
  room: string | null
  placeDetail: string | null
  markerKey: string | null
  statusKey: string | null
  disciplineLabel: string | null
  disciplineLittera: string | null
  inspectionVariant: string
  inspectionVariantLabel: string
  inspectionSequenceNo: number
  inspectionDate: string | null
}

export type EbRemediationTask = {
  id: string
  inspectionId: string
  noteId: string | null
  followUpOrderId: string | null
  assigneeId: string | null
  assignmentManagedBy: 'inspection' | 'contractor'
  status: EbRemediationStatus
  dueDate: string | null
  included: boolean
  snapshot: EbRemediationTaskSnapshot
  reportedRemediedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type EbRemediationEvent = {
  id: string
  taskId: string
  eventType: string
  actorName: string | null
  actorEmail: string | null
  message: string | null
  fromStatus: EbRemediationStatus | null
  toStatus: EbRemediationStatus | null
  createdAt: string
}

export type EbRemediationImage = {
  id: string
  taskId: string
  fileName: string | null
  contentType: string | null
  fileSizeBytes: number | null
  imageUrl: string | null
  thumbnailUrl: string | null
  createdAt: string
}

export type EbRemediationAccessLink = {
  id: string
  followUpOrderId: string | null
  inspectionId: string | null
  assigneeId: string | null
  role: EbRemediationAccessRole
  displayName: string | null
  email: string
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  sentAt: string | null
  createdAt: string
}

export type EbRemediationWorkspace = {
  state: 'open' | 'expired' | 'revoked'
  project: {
    id: string
    title: string
    objectLabel: string
    address: string | null
    contractorName: string | null
    contractorEmail: string | null
  }
  inspection: {
    id: string
    variant: string
    variantLabel: string
    sequenceNo: number
    date: string | null
    defaultRemedyDeadline?: string | null
  } | null
  access: {
    id: string | null
    role: EbRemediationAccessRole | 'internal'
    displayName: string | null
    email: string | null
    assigneeId: string | null
    expiresAt: string | null
    followUpOrderId: string | null
  }
  followUp: {
    id: string
    acceptedAt: string | null
    withdrawalRequestedAt: string | null
    status: string
    buyerName?: string | null
    receiptEmail?: string | null
    customerType?: 'consumer' | 'business' | null
    withdrawalDeadline?: string | null
  } | null
  assignees: EbRemediationAssignee[]
  contractorSuggestions?: EbRemediationContractorSuggestion[]
  tasks: EbRemediationTask[]
  events: EbRemediationEvent[]
  images: EbRemediationImage[]
  originalImages: EbRemediationImage[]
  accessLinks: EbRemediationAccessLink[]
}

type Actor = {
  accessLinkId?: string | null
  profileId?: string | null
  name?: string | null
  email?: string | null
}

type RemediationAccessRow = {
  id: string
  follow_up_order_id: string | null
  org_id: string
  eb_project_id: string
  inspection_id: string | null
  remediation_assignee_id: string | null
  role: EbRemediationAccessRole
  display_name: string | null
  email: string
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
  sent_at: string | null
  created_at: string
}

type RemediationTaskRow = {
  id: string
  original_note_id?: string | null
  follow_up_order_id: string | null
  original_images: Array<Record<string, unknown>> | null
  inspection_id: string
  eb_note_id: string | null
  remediation_assignee_id: string | null
  assignment_managed_by: 'inspection' | 'contractor'
  status: EbRemediationStatus
  due_date: string | null
  included: boolean
  note_snapshot: Record<string, unknown> | null
  reported_remedied_at: string | null
  created_at: string | null
  updated_at: string | null
}

type NoteSourceRow = {
  id: string
  inspection_id: string
  discipline_id: string | null
  note_number: number | null
  location: string | null
  room: string | null
  place_detail: string | null
  marker_key: string | null
  status_key: string | null
  note_text: string | null
  remediation_assignee_id: string | null
  due_date: string | null
  updated_at: string | null
}

const STATUS_VALUES = new Set<EbRemediationStatus>([
  'unassigned',
  'assigned',
  'in_progress',
  'ready_for_review',
  'returned',
  'reported_remedied',
  'cannot_remedy',
])

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized || null
}

function normalizeEmail(value: string | null | undefined) {
  const email = normalizeText(value)?.toLowerCase() ?? null
  return email && EMAIL_PATTERN.test(email) ? email : null
}

export function normalizeEbRemediationAssigneeName(value: string) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('sv-SE')
}

function projectObjectLabel(project: EbProjectListItem) {
  return (
    normalizeText(project.brfApartmentNumber) ??
    normalizeText(project.propertyDesignation) ??
    normalizeText(project.objectDescription) ??
    project.title
  )
}

function projectAddress(project: EbProjectListItem) {
  const locality = [project.postalCode, project.city].filter(Boolean).join(' ')
  return [project.address, locality].filter(Boolean).join(', ') || null
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function nullableString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : null
}

function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function snapshotFromJson(value: Record<string, unknown> | null): EbRemediationTaskSnapshot {
  const snapshot = value ?? {}
  return {
    noteNumber: numberValue(snapshot.noteNumber),
    noteText: stringValue(snapshot.noteText),
    location: nullableString(snapshot.location),
    room: nullableString(snapshot.room),
    placeDetail: nullableString(snapshot.placeDetail),
    markerKey: nullableString(snapshot.markerKey),
    statusKey: nullableString(snapshot.statusKey),
    disciplineLabel: nullableString(snapshot.disciplineLabel),
    disciplineLittera: nullableString(snapshot.disciplineLittera),
    inspectionVariant: stringValue(snapshot.inspectionVariant),
    inspectionVariantLabel: stringValue(snapshot.inspectionVariantLabel),
    inspectionSequenceNo: numberValue(snapshot.inspectionSequenceNo) ?? 1,
    inspectionDate: nullableString(snapshot.inspectionDate),
  }
}

function mapTask(row: RemediationTaskRow): EbRemediationTask {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    noteId: row.eb_note_id,
    followUpOrderId: row.follow_up_order_id ?? null,
    assigneeId: row.remediation_assignee_id ?? null,
    assignmentManagedBy: row.assignment_managed_by,
    status: row.status,
    dueDate: row.due_date ?? null,
    included: row.included,
    snapshot: snapshotFromJson(row.note_snapshot),
    reportedRemediedAt: row.reported_remedied_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}

function mapAccessLink(row: RemediationAccessRow): EbRemediationAccessLink {
  return {
    id: row.id,
    followUpOrderId: row.follow_up_order_id ?? null,
    inspectionId: row.inspection_id ?? null,
    assigneeId: row.remediation_assignee_id ?? null,
    role: row.role,
    displayName: row.display_name ?? null,
    email: row.email,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at ?? null,
    lastUsedAt: row.last_used_at ?? null,
    sentAt: row.sent_at ?? null,
    createdAt: row.created_at,
  }
}

async function requireProject(orgId: string, projectId: string) {
  const project = await getEbProjectById({ orgId, projectId })
  if (!project) throw new Error('EB_PROJECT_NOT_FOUND')
  return project
}

async function loadActorForProfile(profileId: string): Promise<Actor> {
  const admin = createSupabaseAdminClient()
  const { data } = await admin
    .from('profiles')
    .select('full_name,email')
    .eq('id', profileId)
    .maybeSingle()

  return {
    profileId,
    name: normalizeText(data?.full_name as string | null | undefined),
    email: normalizeEmail(data?.email as string | null | undefined),
  }
}

async function syncRemediationTasks(project: EbProjectListItem) {
  const admin = createSupabaseAdminClient()
  const [notesResult, disciplinesResult, tasksResult, ordersResult] = await Promise.all([
    admin
      .from('eb_notes')
      .select(
        'id,inspection_id,discipline_id,note_number,location,room,place_detail,marker_key,status_key,note_text,remediation_assignee_id,due_date,updated_at'
      )
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id)
      .order('sort_order', { ascending: true }),
    admin
      .from('eb_disciplines')
      .select('id,label,littera')
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id),
    admin
      .from('eb_remediation_tasks')
      .select(
        'id,inspection_id,eb_note_id,remediation_assignee_id,assignment_managed_by,status,due_date,included,note_snapshot,reported_remedied_at,created_at,updated_at'
      )
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id)
      .is('follow_up_order_id', null),
    admin.from('eb_follow_up_orders').select('inspection_id')
      .eq('org_id', project.orgId).eq('eb_project_id', project.id),
  ])

  if (notesResult.error) throw new Error(notesResult.error.message ?? 'Kunde inte läsa EB-noteringar.')
  if (disciplinesResult.error) {
    throw new Error(disciplinesResult.error.message ?? 'Kunde inte läsa besiktningsfack.')
  }
  if (tasksResult.error) throw new Error(tasksResult.error.message ?? 'Kunde inte läsa åtgärdsuppgifter.')
  if (ordersResult.error) throw new Error(ordersResult.error.message ?? 'Kunde inte läsa digital uppföljning.')
  const purchasedInspections = new Set((ordersResult.data ?? []).map((order) => order.inspection_id))

  const notes = (notesResult.data ?? []) as NoteSourceRow[]
  const existingTasks = (tasksResult.data ?? []) as RemediationTaskRow[]
  const existingByNoteId = new Map(existingTasks.map((task) => [task.eb_note_id, task]))
  const inspectionById = new Map(project.inspections.map((inspection) => [inspection.inspectionId, inspection]))
  const disciplineById = new Map(
    ((disciplinesResult.data ?? []) as Array<{ id: string; label: string; littera: string | null }>).map(
      (discipline) => [discipline.id, discipline]
    )
  )

  const inserts: Array<Record<string, unknown>> = []
  const updates: Array<{ id: string; values: Record<string, unknown> }> = []

  for (const note of notes) {
    // An order freezes the entire inspection, including the set of notes. Never import later notes.
    if (purchasedInspections.has(note.inspection_id)) continue
    const inspection = inspectionById.get(note.inspection_id)
    if (!inspection) continue
    const discipline = note.discipline_id ? disciplineById.get(note.discipline_id) : null
    const snapshot: EbRemediationTaskSnapshot = {
      noteNumber: note.note_number ?? null,
      noteText: note.note_text ?? '',
      location: note.location ?? null,
      room: note.room ?? null,
      placeDetail: note.place_detail ?? null,
      markerKey: note.marker_key ?? null,
      statusKey: note.status_key ?? null,
      disciplineLabel: discipline?.label ?? null,
      disciplineLittera: discipline?.littera ?? null,
      inspectionVariant: inspection.variant,
      inspectionVariantLabel: inspection.variantLabel,
      inspectionSequenceNo: inspection.sequenceNo,
      inspectionDate: inspection.date,
    }
    const existing = existingByNoteId.get(note.id)
    if (!existing) {
      inserts.push({
        org_id: project.orgId,
        eb_project_id: project.id,
        inspection_id: note.inspection_id,
        eb_note_id: note.id,
        remediation_assignee_id: note.remediation_assignee_id,
        assignment_managed_by: 'inspection',
        status: note.remediation_assignee_id ? 'assigned' : 'unassigned',
        due_date: note.due_date,
        note_snapshot: snapshot,
      })
      continue
    }

    if (inspection.reportLockedAt) continue
    const values: Record<string, unknown> = {}
    if (JSON.stringify(existing.note_snapshot ?? {}) !== JSON.stringify(snapshot)) {
      values.note_snapshot = snapshot
    }
    if (existing.assignment_managed_by === 'inspection') {
      if (existing.remediation_assignee_id !== note.remediation_assignee_id) {
        values.remediation_assignee_id = note.remediation_assignee_id
      }
      if (existing.due_date !== note.due_date) values.due_date = note.due_date
      if (existing.status === 'unassigned' || existing.status === 'assigned') {
        const nextStatus = note.remediation_assignee_id ? 'assigned' : 'unassigned'
        if (existing.status !== nextStatus) values.status = nextStatus
      }
    }
    if (Object.keys(values).length > 0) updates.push({ id: existing.id, values })
  }

  if (inserts.length > 0) {
    for (const values of inserts) {
      const { data: task, error } = await admin.from('eb_remediation_tasks')
        .insert(values).select('id').single()
      if (error?.code === '23505') continue
      if (error || !task) throw new Error(error?.message ?? 'Kunde inte skapa åtgärdsuppgifter.')
      const { error: eventError } = await admin.from('eb_remediation_events').insert({
        org_id: project.orgId,
        eb_project_id: project.id,
        task_id: task.id,
        event_type: 'task_created',
      })
      if (eventError && eventError.code !== '23505') {
        throw new Error(eventError.message ?? 'Kunde inte spara åtgärdshistorik.')
      }
    }
  }

  if (updates.length > 0) {
    const results = await Promise.all(
      updates.map((update) =>
        admin
          .from('eb_remediation_tasks')
          .update(update.values)
          .eq('id', update.id)
          .eq('org_id', project.orgId)
          .eq('eb_project_id', project.id)
      )
    )
    const failed = results.find((result) => result.error)
    if (failed?.error) throw new Error(failed.error.message ?? 'Kunde inte synkronisera åtgärdsuppgifter.')
  }
}

function followUpWithdrawalDetails(snapshot: unknown) {
  const buyer = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
    ? snapshot as Record<string, unknown> : {}
  const acceptance = buyer.acceptanceSnapshot && typeof buyer.acceptanceSnapshot === 'object' && !Array.isArray(buyer.acceptanceSnapshot)
    ? buyer.acceptanceSnapshot as Record<string, unknown> : {}
  const customerType: 'consumer' | 'business' | null = buyer.customerType === 'consumer' || buyer.customerType === 'business' ? buyer.customerType : null
  return {
    buyerName: typeof buyer.name === 'string' ? buyer.name : null,
    receiptEmail: typeof buyer.email === 'string' ? buyer.email : null,
    customerType,
    withdrawalDeadline: customerType === 'consumer' && typeof acceptance.withdrawalDeadline === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(acceptance.withdrawalDeadline) ? acceptance.withdrawalDeadline : null,
  }
}

async function requireFollowUpOrder(input: { orgId: string; projectId: string; orderId: string }) {
  const { data, error } = await createSupabaseAdminClient().from('eb_follow_up_orders')
    .select('id,inspection_id,report_snapshot,buyer_snapshot,status,accepted_at,withdrawal_requested_at')
    .eq('id', input.orderId).eq('org_id', input.orgId).eq('eb_project_id', input.projectId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.status !== 'active') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
  return data
}

async function loadWorkspace(input: {
  project: EbProjectListItem
  inspectionId?: string | null
  access?: RemediationAccessRow | null
  state?: 'open' | 'expired' | 'revoked'
}): Promise<EbRemediationWorkspace> {
  const { project } = input
  const access = input.access ?? null
  const orderId = access?.follow_up_order_id ?? null
  const admin = createSupabaseAdminClient()
  const order = orderId ? await requireFollowUpOrder({ orgId: project.orgId, projectId: project.id, orderId }) : null
  if (order && access?.inspection_id !== order.inspection_id) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
  const frozenReport = order ? getEbInspectionReportFromSnapshot(order.report_snapshot) : null
  if (order && !frozenReport) throw new Error('EB_REMEDIATION_ORDER_INVALID')
  const displayedProject = frozenReport?.project ?? project
  const followUp = order ? {
    id: order.id, acceptedAt: order.accepted_at,
    withdrawalRequestedAt: order.withdrawal_requested_at, status: order.status,
    // The receipt identity belongs only in the buyer's private workspace.
    ...(access?.role === 'customer_owner' ? followUpWithdrawalDetails(order.buyer_snapshot) : {}),
  } : null
  const state = input.state ?? 'open'
  const inspectionId = access?.inspection_id ?? normalizeText(input.inspectionId)
  const inspection = inspectionId
    ? project.inspections.find((item) => item.inspectionId === inspectionId) ?? null
    : null
  if (inspectionId && !inspection) throw new Error('EB_INSPECTION_NOT_FOUND')
  const inspectionSummary = frozenReport ? {
    id: frozenReport.inspection.inspectionId,
    variant: frozenReport.inspection.variant,
    variantLabel: frozenReport.inspection.variantLabel,
    sequenceNo: frozenReport.inspection.sequenceNo,
    date: frozenReport.inspection.date,
    ...(state === 'open' ? {
      defaultRemedyDeadline: ebRemediationReportDeadline(frozenReport.inspection.defaultRemedyDeadline),
    } : {}),
  } : inspection
    ? {
        id: inspection.inspectionId,
        variant: inspection.variant,
        variantLabel: inspection.variantLabel,
        sequenceNo: inspection.sequenceNo,
        date: inspection.date,
      }
    : null
  if (access && state !== 'open') {
    return {
      state,
      project: {
        id: project.id,
        title: displayedProject.title,
        objectLabel: projectObjectLabel(displayedProject),
        address: projectAddress(displayedProject),
        contractorName: orderId ? null : project.contractorName,
        contractorEmail: orderId ? null : project.contractorEmail,
      },
      inspection: inspectionSummary,
      access: {
        id: access.id,
        role: access.role,
        displayName: access.display_name ?? null,
        email: access.email,
        assigneeId: access.remediation_assignee_id ?? null,
        expiresAt: access.expires_at,
        followUpOrderId: orderId,
      },
      followUp,
      assignees: [],
      tasks: [],
      events: [],
      images: [],
      originalImages: [],
      accessLinks: [],
    }
  }
  if (!orderId && (!access || state === 'open')) await syncRemediationTasks(project)

  let tasksQuery = admin
    .from('eb_remediation_tasks')
    .select(
      'id,follow_up_order_id,original_note_id,original_images,inspection_id,eb_note_id,remediation_assignee_id,assignment_managed_by,status,due_date,included,note_snapshot,reported_remedied_at,created_at,updated_at'
    )
    .eq('org_id', project.orgId)
    .eq('eb_project_id', project.id)
    .eq('included', true)
    .order('created_at', { ascending: true })
  let linksQuery = admin
    .from('eb_remediation_access_links')
    .select(
      'id,follow_up_order_id,org_id,eb_project_id,inspection_id,remediation_assignee_id,role,display_name,email,expires_at,revoked_at,last_used_at,sent_at,created_at'
    )
    .eq('org_id', project.orgId)
    .eq('eb_project_id', project.id)
    .order('created_at', { ascending: false })
  if (inspectionId) {
    tasksQuery = tasksQuery.eq('inspection_id', inspectionId)
    linksQuery = linksQuery.eq('inspection_id', inspectionId)
  }
  let assigneesQuery = admin.from('eb_remediation_assignees')
    .select('id,name,company_name,contact_name,email,phone,is_active,created_at,updated_at')
    .eq('org_id', project.orgId).eq('eb_project_id', project.id)
    .order('is_active', { ascending: false }).order('name', { ascending: true })
  // Legacy project-wide links must never inherit the purchased service's private workspace.
  tasksQuery = orderId ? tasksQuery.eq('follow_up_order_id', orderId) : tasksQuery.is('follow_up_order_id', null)
  linksQuery = orderId ? linksQuery.eq('follow_up_order_id', orderId) : linksQuery.is('follow_up_order_id', null)
  assigneesQuery = orderId ? assigneesQuery.eq('follow_up_order_id', orderId) : assigneesQuery.is('follow_up_order_id', null)
  if (access && (access.role === 'assignee' || (orderId && access.role !== 'customer_owner'))) {
    if (!access?.remediation_assignee_id) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    tasksQuery = tasksQuery.eq('remediation_assignee_id', access.remediation_assignee_id)
    assigneesQuery = assigneesQuery.eq('id', access.remediation_assignee_id)
  }
  const [assigneesResult, tasksResult, linksResult] = await Promise.all([
    assigneesQuery,
    tasksQuery,
    linksQuery,
  ])

  if (assigneesResult.error) {
    throw new Error(assigneesResult.error.message ?? 'Kunde inte läsa listan Åtgärdas av.')
  }
  if (tasksResult.error) throw new Error(tasksResult.error.message ?? 'Kunde inte läsa åtgärdsuppgifter.')
  if (linksResult.error) throw new Error(linksResult.error.message ?? 'Kunde inte läsa åtkomstlänkar.')

  const taskRows = [...((tasksResult.data ?? []) as RemediationTaskRow[])]
  const displayNumbers = frozenReport ? ebReportNoteDisplayIndex(frozenReport) : null
  const originalNoteId = (task: RemediationTaskRow) => String(task.note_snapshot?.originalNoteId ?? task.original_note_id ?? task.eb_note_id)
  if (frozenReport) {
    const position = (task: RemediationTaskRow) => displayNumbers?.get(originalNoteId(task)) ?? Number.MAX_SAFE_INTEGER
    taskRows.sort((a, b) => position(a) - position(b))
  }
  // Existing orders retain their immutable task snapshots. Only the DTO's
  // displayed reference is reconciled against the order's own frozen report.
  let tasks = taskRows.map((row) => {
    const task = mapTask(row)
    const number = displayNumbers?.get(originalNoteId(row))
    return number === undefined ? task : { ...task, snapshot: { ...task.snapshot, noteNumber: number } }
  })
  let assignees = (
    (assigneesResult.data ?? []) as Array<{
      id: string
      name: string
      company_name: string | null
      contact_name: string | null
      email: string | null
      phone: string | null
      is_active: boolean
      created_at: string | null
      updated_at: string | null
    }>
  ).map((row) => ({
    id: row.id,
    name: row.name,
    companyName: row.company_name ?? null,
    contactName: row.contact_name ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    isActive: row.is_active,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }))

  if (access && (access.role === 'assignee' || (orderId && access.role !== 'customer_owner'))) {
    tasks = tasks.filter((task) => task.assigneeId === access.remediation_assignee_id)
    assignees = assignees.filter((assignee) => assignee.id === access.remediation_assignee_id)
  }

  const taskIds = tasks.map((task) => task.id)
  const [eventsResult, imagesResult] = taskIds.length
    ? await Promise.all([
        admin
          .from('eb_remediation_events')
          .select('id,task_id,event_type,actor_name,actor_email,message,from_status,to_status,created_at')
          .in('task_id', taskIds)
          .order('created_at', { ascending: true }),
        admin
          .from('eb_remediation_images')
          .select(
            'id,task_id,storage_bucket,file_path,thumbnail_file_path,file_name,content_type,file_size_bytes,created_at'
          )
          .in('task_id', taskIds)
          .order('created_at', { ascending: true }),
      ])
    : [{ data: [], error: null }, { data: [], error: null }]

  if (eventsResult.error) throw new Error(eventsResult.error.message ?? 'Kunde inte läsa åtgärdshistorik.')
  if (imagesResult.error) throw new Error(imagesResult.error.message ?? 'Kunde inte läsa åtgärdsbilder.')

  const imageRows = (imagesResult.data ?? []) as Array<{
    id: string
    task_id: string
    storage_bucket: string
    file_path: string
    thumbnail_file_path: string | null
    file_name: string | null
    content_type: string | null
    file_size_bytes: number | null
    created_at: string
  }>
  const originalRows = ((tasksResult.data ?? []) as RemediationTaskRow[])
    .filter((task) => taskIds.includes(task.id))
    .flatMap((task) => (task.original_images ?? []).flatMap((image) => {
      if (typeof image.filePath !== 'string' || typeof image.storageBucket !== 'string') return []
      return [{
        id: String(image.id), task_id: task.id, storage_bucket: image.storageBucket,
        file_path: image.filePath,
        thumbnail_file_path: typeof image.thumbnailFilePath === 'string' ? image.thumbnailFilePath : null,
        file_name: typeof image.fileName === 'string' ? image.fileName : null,
        content_type: null, file_size_bytes: null, created_at: task.created_at ?? '',
      }]
    }))
  const pathsByBucket = new Map<string, Set<string>>()
  for (const row of [...imageRows, ...originalRows]) {
    const bucket = row.storage_bucket || EB_REMEDIATION_IMAGE_BUCKET
    const paths = pathsByBucket.get(bucket) ?? new Set<string>()
    paths.add(row.file_path)
    if (row.thumbnail_file_path) paths.add(row.thumbnail_file_path)
    pathsByBucket.set(bucket, paths)
  }
  const signedUrls = new Map<string, string>()
  await Promise.all(
    Array.from(pathsByBucket.entries()).map(async ([bucket, pathSet]) => {
      const paths = Array.from(pathSet)
      const { data } = await admin.storage.from(bucket).createSignedUrls(paths, 60 * 60)
      data?.forEach((item, index) => {
        if (item.signedUrl) signedUrls.set(`${bucket}:${paths[index]}`, item.signedUrl)
      })
    })
  )
  const mapImage = (row: typeof imageRows[number]): EbRemediationImage => {
    const bucket = row.storage_bucket || EB_REMEDIATION_IMAGE_BUCKET
    const imageUrl = signedUrls.get(`${bucket}:${row.file_path}`) ?? null
    return {
      id: row.id,
      taskId: row.task_id,
      fileName: row.file_name ?? null,
      contentType: row.content_type ?? null,
      fileSizeBytes: row.file_size_bytes ?? null,
      imageUrl,
      thumbnailUrl:
        (row.thumbnail_file_path
          ? signedUrls.get(`${bucket}:${row.thumbnail_file_path}`)
          : null) ?? imageUrl,
      createdAt: row.created_at,
    }
  }
  const images = imageRows.map(mapImage)
  const originalImages = originalRows.map(mapImage)

  const canManageLinks = ebRemediationCanManage(access?.role ?? 'internal', Boolean(orderId))
  const links = canManageLinks
    ? ((linksResult.data ?? []) as RemediationAccessRow[]).filter((link) => !orderId || link.role !== 'customer_owner').map(mapAccessLink)
    : []

  return {
    state,
    project: {
      id: project.id,
      title: displayedProject.title,
      objectLabel: projectObjectLabel(displayedProject),
      address: projectAddress(displayedProject),
      contractorName: orderId ? null : project.contractorName,
      contractorEmail: orderId ? null : project.contractorEmail,
    },
    inspection: inspectionSummary,
    access: {
      id: access?.id ?? null,
      role: access?.role ?? 'internal',
      displayName: access?.display_name ?? null,
      email: access?.email ?? null,
      assigneeId: access?.remediation_assignee_id ?? null,
      expiresAt: access?.expires_at ?? null,
      followUpOrderId: orderId,
    },
    followUp,
    assignees,
    ...(orderId && access?.role === 'customer_owner' ? {
      contractorSuggestions: ebRemediationContractorSuggestions({
        state, role: access.role, paid: true,
        reportProject: frozenReport?.project ?? null,
        participants: frozenReport?.participants,
        project,
      }),
    } : {}),
    tasks,
    events: (
      (eventsResult.data ?? []) as Array<{
        id: string
        task_id: string
        event_type: string
        actor_name: string | null
        actor_email: string | null
        message: string | null
        from_status: EbRemediationStatus | null
        to_status: EbRemediationStatus | null
        created_at: string
      }>
    ).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      eventType: row.event_type,
      actorName: row.actor_name ?? null,
      actorEmail: orderId && access?.role !== 'customer_owner' ? null : row.actor_email ?? null,
      message: row.message ?? null,
      fromStatus: row.from_status ?? null,
      toStatus: row.to_status ?? null,
      createdAt: row.created_at,
    })),
    images,
    originalImages,
    accessLinks: links,
  }
}

export async function getEbRemediationWorkspace(input: {
  orgId: string
  projectId: string
  inspectionId?: string | null
}): Promise<EbRemediationWorkspace> {
  const project = await requireProject(input.orgId, input.projectId)
  return loadWorkspace({ project, inspectionId: input.inspectionId })
}

async function resolveAccessToken(token: string) {
  if (!token || token.length < 32) return null
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_remediation_access_links')
    .select(
      'id,follow_up_order_id,org_id,eb_project_id,inspection_id,remediation_assignee_id,role,display_name,email,expires_at,revoked_at,last_used_at,sent_at,created_at'
    )
    .eq('token_hash', hashAssignmentToken(token))
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte läsa åtkomstlänken.')
  return (data as RemediationAccessRow | null) ?? null
}

export async function getEbRemediationWorkspaceByToken(
  token: string
): Promise<EbRemediationWorkspace | null> {
  const access = await resolveAccessToken(token)
  if (!access) return null
  await assertEbRemediationOwnerSession(access)
  const now = Date.now()
  const state: 'open' | 'expired' | 'revoked' = access.revoked_at
    ? 'revoked'
    : new Date(access.expires_at).getTime() < now
      ? 'expired'
      : 'open'
  const project = await requireProject(access.org_id, access.eb_project_id)

  if (state === 'open') {
    const admin = createSupabaseAdminClient()
    const usedAt = new Date().toISOString()
    await admin.from('eb_remediation_access_links').update({ last_used_at: usedAt }).eq('id', access.id)
    access.last_used_at = usedAt
  }
  return loadWorkspace({ project, access, state, inspectionId: access.inspection_id })
}

export async function createEbRemediationAssignee(input: {
  orgId: string
  projectId: string
  followUpOrderId?: string | null
  profileId?: string | null
  name: string
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
}): Promise<EbRemediationAssignee> {
  await requireProject(input.orgId, input.projectId)
  const name = normalizeText(input.name)
  if (!name) throw new Error('EB_REMEDIATION_ASSIGNEE_NAME_REQUIRED')
  const normalizedName = normalizeEbRemediationAssigneeName(name)
  const email = input.email ? normalizeEmail(input.email) : null
  if (input.email && !email) throw new Error('EB_REMEDIATION_EMAIL_INVALID')
  const admin = createSupabaseAdminClient()

  const { data: existing, error: existingError } = await admin
    .from('eb_remediation_assignees')
    .select('id,name,company_name,contact_name,email,phone,is_active,created_at,updated_at')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('normalized_name', normalizedName)
    .filter('follow_up_order_id', input.followUpOrderId ? 'eq' : 'is', input.followUpOrderId ?? null)
    .maybeSingle()
  if (existingError) throw new Error(existingError.message ?? 'Kunde inte kontrollera Åtgärdas av.')
  if (existing) {
    return {
      id: existing.id,
      name: existing.name,
      companyName: existing.company_name ?? null,
      contactName: existing.contact_name ?? null,
      email: existing.email ?? null,
      phone: existing.phone ?? null,
      isActive: existing.is_active,
      createdAt: existing.created_at ?? null,
      updatedAt: existing.updated_at ?? null,
    }
  }

  const values = {
    org_id: input.orgId,
    eb_project_id: input.projectId,
    follow_up_order_id: input.followUpOrderId ?? null,
    name,
    normalized_name: normalizedName,
    company_name: normalizeText(input.companyName),
    contact_name: normalizeText(input.contactName),
    email,
    phone: normalizeText(input.phone),
    is_active: true,
    created_by: input.profileId ?? null,
    updated_by: input.profileId ?? null,
  }
  const { data, error } = await admin
    .from('eb_remediation_assignees')
    .insert(values)
    .select('id,name,company_name,contact_name,email,phone,is_active,created_at,updated_at')
    .single()
  if (error?.code === '23505') {
    const { data: concurrent } = await admin
      .from('eb_remediation_assignees')
      .select('id,name,company_name,contact_name,email,phone,is_active,created_at,updated_at')
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .eq('normalized_name', normalizedName)
      .filter('follow_up_order_id', input.followUpOrderId ? 'eq' : 'is', input.followUpOrderId ?? null)
      .maybeSingle()
    if (concurrent) {
      return {
        id: concurrent.id,
        name: concurrent.name,
        companyName: concurrent.company_name ?? null,
        contactName: concurrent.contact_name ?? null,
        email: concurrent.email ?? null,
        phone: concurrent.phone ?? null,
        isActive: concurrent.is_active,
        createdAt: concurrent.created_at ?? null,
        updatedAt: concurrent.updated_at ?? null,
      }
    }
  }
  if (error || !data) throw new Error(error?.message ?? 'Kunde inte spara Åtgärdas av.')
  return {
    id: data.id,
    name: data.name,
    companyName: data.company_name ?? null,
    contactName: data.contact_name ?? null,
    email: data.email ?? null,
    phone: data.phone ?? null,
    isActive: data.is_active,
    createdAt: data.created_at ?? null,
    updatedAt: data.updated_at ?? null,
  }
}

export async function updateEbRemediationAssignee(input: {
  orgId: string
  projectId: string
  followUpOrderId?: string | null
  profileId?: string | null
  assigneeId: string
  name: string
  companyName?: string | null
  contactName?: string | null
  email?: string | null
  phone?: string | null
  isActive?: boolean
}) {
  const name = normalizeText(input.name)
  if (!name) throw new Error('EB_REMEDIATION_ASSIGNEE_NAME_REQUIRED')
  const email = input.email ? normalizeEmail(input.email) : null
  if (input.email && !email) throw new Error('EB_REMEDIATION_EMAIL_INVALID')
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_remediation_assignees')
    .update({
      name,
      normalized_name: normalizeEbRemediationAssigneeName(name),
      company_name: normalizeText(input.companyName),
      contact_name: normalizeText(input.contactName),
      email,
      phone: normalizeText(input.phone),
      is_active: input.isActive ?? true,
      updated_by: input.profileId ?? null,
    })
    .eq('id', input.assigneeId)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .filter('follow_up_order_id', input.followUpOrderId ? 'eq' : 'is', input.followUpOrderId ?? null)
    .select('id').maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte uppdatera Åtgärdas av.')
  if (!data) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
}

async function requireTask(input: { orgId: string; projectId: string; taskId: string }) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_remediation_tasks')
    .select(
      'id,follow_up_order_id,original_images,inspection_id,eb_note_id,remediation_assignee_id,assignment_managed_by,status,due_date,included,note_snapshot,reported_remedied_at,created_at,updated_at'
    )
    .eq('id', input.taskId)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte läsa åtgärdsuppgiften.')
  if (!data) throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  return data as RemediationTaskRow
}

async function applyTaskAction(input: {
  orgId: string; projectId: string; taskId: string; action: string
  expectedUpdatedAt?: string | null; payload: Record<string, unknown>; actor: Actor
}) {
  const task = await requireTask(input)
  const { data, error } = await createSupabaseAdminClient().rpc('eb_apply_remediation_action', {
    p_org_id: input.orgId, p_project_id: input.projectId, p_task_id: input.taskId,
    p_expected_updated_at: input.expectedUpdatedAt === undefined ? task.updated_at : input.expectedUpdatedAt,
    p_action: input.action, p_payload: input.payload, p_actor: input.actor,
  })
  if (error) throw new Error(error.message)
  if (!data) throw new Error('EB_REMEDIATION_CONFLICT')
  return data
}

export async function assignEbRemediationTasks(input: {
  orgId: string
  projectId: string
  inspectionId?: string | null
  followUpOrderId?: string | null
  expectedVersions?: Record<string, string | null>
  taskIds: string[]
  assigneeId: string | null
  dueDate?: string | null
  actor: Actor
}) {
  const taskIds = [...new Set(input.taskIds.filter(Boolean))]
  if (taskIds.length === 0) throw new Error('EB_REMEDIATION_TASK_REQUIRED')
  const admin = createSupabaseAdminClient()

  if (input.assigneeId) {
    const { data: assignee, error } = await admin
      .from('eb_remediation_assignees')
      .select('id')
      .eq('id', input.assigneeId)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .eq('is_active', true)
      .filter('follow_up_order_id', input.followUpOrderId ? 'eq' : 'is', input.followUpOrderId ?? null)
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
  }

  let currentRowsQuery = admin
    .from('eb_remediation_tasks')
    .select('id,inspection_id,status,remediation_assignee_id,assignment_managed_by,due_date,updated_at')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .in('id', taskIds)
    .filter('follow_up_order_id', input.followUpOrderId ? 'eq' : 'is', input.followUpOrderId ?? null)
  if (input.inspectionId) currentRowsQuery = currentRowsQuery.eq('inspection_id', input.inspectionId)
  const { data: currentRows, error: currentError } = await currentRowsQuery
  if (currentError) throw new Error(currentError.message ?? 'Kunde inte läsa valda åtgärdsuppgifter.')
  if ((currentRows ?? []).length !== taskIds.length) throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  const normalizedDueDate = input.dueDate === undefined ? undefined : normalizeText(input.dueDate)

  for (const current of currentRows ?? []) {
    if (input.expectedVersions && Object.hasOwn(input.expectedVersions, current.id) &&
        input.expectedVersions[current.id] !== current.updated_at) throw new Error('EB_REMEDIATION_CONFLICT')
    const currentStatus = current.status as EbRemediationStatus
    const nextStatus: EbRemediationStatus = input.assigneeId
      ? currentStatus === 'unassigned'
        ? 'assigned'
        : currentStatus
      : 'unassigned'
    const assignmentUnchanged =
      current.remediation_assignee_id === input.assigneeId &&
      current.assignment_managed_by === 'contractor' &&
      currentStatus === nextStatus &&
      (normalizedDueDate === undefined || normalizeText(current.due_date) === normalizedDueDate)
    if (assignmentUnchanged) continue

    await applyTaskAction({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId: current.id,
      action: 'assign',
      expectedUpdatedAt: input.expectedVersions?.[current.id] ?? current.updated_at,
      actor: input.actor,
      payload: { assigneeId: input.assigneeId, ...(normalizedDueDate !== undefined ? { dueDate: normalizedDueDate } : {}) },
    })
  }
}

export async function changeEbRemediationTaskStatus(input: {
  orgId: string
  projectId: string
  taskId: string
  status: EbRemediationStatus
  message?: string | null
  expectedUpdatedAt?: string | null
  actor: Actor
}) {
  if (!STATUS_VALUES.has(input.status)) throw new Error('EB_REMEDIATION_STATUS_INVALID')
  await applyTaskAction({
    ...input, action: 'status', payload: { status: input.status, message: normalizeText(input.message) },
  })
}

export async function addEbRemediationComment(input: {
  orgId: string
  projectId: string
  taskId: string
  message: string
  expectedUpdatedAt?: string | null
  actor: Actor
}) {
  const message = normalizeText(input.message)
  if (!message) throw new Error('EB_REMEDIATION_COMMENT_REQUIRED')
  await applyTaskAction({
    ...input, action: 'comment', payload: { message },
  })
}

function appBaseUrl(requestOrigin?: string | null) {
  const configured = process.env.APP_BASE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim()
  const value = configured || requestOrigin
  if (!value) throw new Error('MISSING_ENV:APP_BASE_URL')
  return value.replace(/\/+$/, '')
}

function mailFromAddress() {
  const value = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!value) throw new Error('MISSING_ENV:ASSIGNMENTS_MAIL_FROM')
  return value
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function paidRemediationInvitation(input: {
  report: NonNullable<ReturnType<typeof getEbInspectionReportFromSnapshot>>
  buyerSnapshot: unknown
  recipient: string | null
  accessUrl: string
  taskCount: number
}) {
  const { report } = input
  const buyer = input.buyerSnapshot && typeof input.buyerSnapshot === 'object' && !Array.isArray(input.buyerSnapshot)
    ? input.buyerSnapshot as Record<string, unknown> : {}
  // Report facts identify the job. Billing/contact data and buyer-only links do
  // not belong in the contractor's invitation, including for older snapshots.
  const projectTitle = normalizeText(report.project.title) ?? 'Entreprenadbesiktning'
  const customerName = normalizeText(report.inspection.clientName) ?? normalizeText(report.project.clientName) ??
    normalizeText(nullableString(buyer.name))
  const inspectionLabel = [normalizeText(report.inspection.variantLabel), report.inspection.sequenceNo || null]
    .filter(Boolean).join(' ') || 'Besiktning'
  const deadline = ebRemediationReportDeadline(report.inspection.defaultRemedyDeadline)
  const facts: Array<[string, string | null]> = [
    ['Projekt', projectTitle],
    ['Objekt', projectObjectLabel(report.project)],
    ['Adress', projectAddress(report.project)],
    ['Beställare', customerName],
    ['Besiktning', inspectionLabel],
    ['Besiktningsdatum', ebRemediationReportDeadline(report.inspection.date)],
    ['Utlåtandenummer', normalizeText(report.inspection.assignmentNumber)],
    ['Tilldelade anmärkningar', String(input.taskCount)],
    ['Åtgärdsfrist enligt utlåtandet', deadline],
  ]
  const visibleFacts = facts.filter((entry): entry is [string, string] => Boolean(entry[1]))
  const greeting = input.recipient ? `Hej ${input.recipient},` : 'Hej,'
  const introduction = 'Du har fått tillgång till dina tilldelade anmärkningar efter besiktningen. I åtgärdslistan ser du vad som ska åtgärdas och kan markera punkter som klara, skriva kommentarer och lägga till bilder.'
  const deadlineNote = deadline ? 'Se sista åtgärdsdatum för varje punkt i listan; enskilda punkter kan ha ett annat överenskommet datum.' : null
  const caution = 'En klarmarkering är entreprenörens återrapportering, inte ett godkännande från besiktningsmannen.'
  const privacy = 'Länken är personlig och ger tillgång till dina tilldelade punkter. Vidarebefordra den inte.'
  const text = [greeting, '', introduction, '', ...visibleFacts.map(([label, value]) => `${label}: ${value}`),
    ...(deadlineNote ? ['', deadlineNote] : []), '', `Öppna åtgärdslistan: ${input.accessUrl}`, '', caution, '', privacy].join('\n')
  const factRows = visibleFacts.map(([label, value]) => `<tr><th scope="row" align="left" style="width:40%;padding:9px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:13px;font-weight:600;color:#475569;">${escapeHtml(label)}</th><td style="padding:9px 12px;border-bottom:1px solid #e2e8f0;vertical-align:top;font-size:14px;color:#0f172a;word-break:break-word;">${escapeHtml(value)}</td></tr>`).join('')
  const html = `<!doctype html>
<html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Åtgärdslista</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#1e293b;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
<tr><td style="padding:22px 24px;border-top:4px solid #397c5a;border-bottom:1px solid #e2e8f0;"><p style="margin:0 0 8px;color:#397c5a;font-size:12px;font-weight:700;letter-spacing:1px;">HUSHUB · ÅTGÄRDSUPPFÖLJNING</p><h1 style="margin:0;font-size:26px;line-height:1.25;color:#0f172a;">Din åtgärdslista</h1><p style="margin:8px 0 0;font-size:16px;line-height:1.5;">${escapeHtml(projectTitle)}</p></td></tr>
<tr><td style="padding:24px;"><p style="margin:0 0 12px;font-size:15px;line-height:1.6;">${escapeHtml(greeting)}</p><p style="margin:0 0 20px;font-size:15px;line-height:1.6;">${escapeHtml(introduction)}</p>
<table width="100%" cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;background:#f8fafc;border:1px solid #e2e8f0;">${factRows}</table>
${deadlineNote ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#475569;">${escapeHtml(deadlineNote)}</p>` : ''}
<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0;"><tr><td align="center" bgcolor="#397c5a" style="border-radius:6px;padding:14px 22px;"><a href="${escapeHtml(input.accessUrl)}" style="display:inline-block;font-size:16px;line-height:1.4;font-weight:600;text-decoration:none;color:#ffffff;">Öppna åtgärdslistan</a></td></tr></table>
<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:#475569;">${escapeHtml(caution)}</p><p style="margin:0;font-size:13px;line-height:1.6;color:#475569;">${escapeHtml(privacy)}</p></td></tr>
</table></td></tr></table></body></html>`
  return { subject: `Åtgärdslista – ${projectTitle.replace(/[\r\n]+/g, ' ')} – ${inspectionLabel.replace(/[\r\n]+/g, ' ')}`, text, html }
}

export async function issueEbRemediationAccessLink(input: {
  orgId: string
  projectId: string
  inspectionId?: string | null
  followUpOrderId?: string | null
  profileId?: string | null
  role: EbRemediationAccessRole
  displayName?: string | null
  email: string
  assigneeId?: string | null
  requestOrigin?: string | null
  sendEmail?: boolean
}) {
  const project = await requireProject(input.orgId, input.projectId)
  const orderId = input.followUpOrderId ?? null
  const order = orderId ? await requireFollowUpOrder({ orgId: input.orgId, projectId: input.projectId, orderId }) : null
  if (order?.withdrawal_requested_at) throw new Error('EB_FOLLOW_UP_ORDER_INACTIVE')
  const inspectionId = normalizeText(input.inspectionId)
  if (order && order.inspection_id !== inspectionId) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
  const frozenReport = order ? getEbInspectionReportFromSnapshot(order.report_snapshot) : null
  if (order && (!frozenReport || frozenReport.project.id !== input.projectId || frozenReport.inspection.inspectionId !== inspectionId)) {
    throw new Error('EB_REMEDIATION_ORDER_INVALID')
  }
  // Owner links are created/recovered only by the verified purchase flow.
  if (input.role === 'customer_owner') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
  const inspection = inspectionId
    ? project.inspections.find((item) => item.inspectionId === inspectionId) ?? null
    : null
  if (inspectionId && !inspection) throw new Error('EB_INSPECTION_NOT_FOUND')
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('EB_REMEDIATION_EMAIL_INVALID')
  const assigneeId = input.role === 'assignee' || orderId ? normalizeText(input.assigneeId) : null
  if ((input.role === 'assignee' || orderId) && !assigneeId) throw new Error('EB_REMEDIATION_ASSIGNEE_REQUIRED')
  const baseUrl = appBaseUrl(input.requestOrigin)
  const fromAddress = input.sendEmail === false || orderId ? null : mailFromAddress()

  const admin = createSupabaseAdminClient()
  let assignedTaskCount = 0
  if (assigneeId) {
    const { data: assignee, error } = await admin
      .from('eb_remediation_assignees')
      .select('id,name')
      .eq('id', assigneeId)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .filter('follow_up_order_id', orderId ? 'eq' : 'is', orderId)
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
    if (orderId) {
      const { count, error: assignedError } = await admin.from('eb_remediation_tasks')
        .select('id', { count: 'exact', head: true }).eq('follow_up_order_id', orderId).eq('remediation_assignee_id', assigneeId)
        .eq('org_id', input.orgId).eq('eb_project_id', input.projectId).eq('inspection_id', inspectionId).eq('included', true)
      if (assignedError) throw new Error(assignedError.message)
      assignedTaskCount = count ?? 0
      if (assignedTaskCount === 0) throw new Error('EB_REMEDIATION_TASK_REQUIRED')
    }
  }

  let activeQuery = admin
    .from('eb_remediation_access_links')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('role', input.role)
    .filter('follow_up_order_id', orderId ? 'eq' : 'is', orderId)
    .is('revoked_at', null)
  activeQuery = inspectionId
    ? activeQuery.eq('inspection_id', inspectionId)
    : activeQuery.is('inspection_id', null)
  activeQuery = assigneeId
    ? activeQuery.eq('remediation_assignee_id', assigneeId)
    : activeQuery.eq('email', email)
  const { data: activeLinks, error: activeLinksError } = await activeQuery
  if (activeLinksError) {
    throw new Error(activeLinksError.message ?? 'Kunde inte kontrollera tidigare åtkomstlänk.')
  }
  const previousLinkIds = (activeLinks ?? []).map((activeLink) => String(activeLink.id))

  const token = generateAssignmentToken()
  const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString()
  const displayName = normalizeText(input.displayName)
  const { data: link, error: insertError } = await admin
    .from('eb_remediation_access_links')
    .insert({
      org_id: input.orgId,
      eb_project_id: input.projectId,
      follow_up_order_id: orderId,
      inspection_id: inspectionId,
      remediation_assignee_id: assigneeId,
      role: input.role,
      display_name: displayName,
      email,
      token_hash: hashAssignmentToken(token),
      expires_at: expiresAt,
      created_by: input.profileId ?? null,
    })
    .select(
      'id,follow_up_order_id,org_id,eb_project_id,inspection_id,remediation_assignee_id,role,display_name,email,expires_at,revoked_at,last_used_at,sent_at,created_at'
    )
    .single()
  if (insertError || !link) throw new Error(insertError?.message ?? 'Kunde inte skapa åtkomstlänk.')

  const accessUrl = `${baseUrl}/atgarder/${token}`
  if (input.sendEmail !== false) {
    const recipient = displayName ?? 'Hej'
    const roleText = input.role === 'assignee' ? 'dina tilldelade anmärkningar' : 'projektets anmärkningar'
    const scopeLabel = inspection
      ? `${inspection.variantLabel} ${inspection.sequenceNo}`
      : project.title
    const subject = inspection
      ? `Åtgärdslista – ${project.title} – ${scopeLabel}`
      : `Åtgärdslista – ${project.title}`
    const text = `${recipient},\n\nDu har fått tillgång till ${roleText} för ${scopeLabel}.\n\nÖppna åtgärdslistan: ${accessUrl}\n\nLänken är personlig och ska inte vidarebefordras.`
    const html = `<p>${escapeHtml(recipient)},</p><p>Du har fått tillgång till ${escapeHtml(roleText)} för <strong>${escapeHtml(scopeLabel)}</strong>.</p><p><a href="${escapeHtml(accessUrl)}">Öppna åtgärdslistan</a></p><p>Länken är personlig och ska inte vidarebefordras.</p>`

    if (orderId) {
      try {
        const invitation = paidRemediationInvitation({ report: frozenReport!, buyerSnapshot: order!.buyer_snapshot,
          recipient: displayName, accessUrl, taskCount: assignedTaskCount })
        await queueEbFollowUpEmail({ orderId, dedupeKey: `access:${link.id}`, to: email, ...invitation })
      } catch (error) {
        await admin.from('eb_remediation_access_links').update({ revoked_at: new Date().toISOString() }).eq('id', link.id)
        throw error
      }
    } else {
    const { data: messageRow, error: messageError } = await admin
      .from('outbound_messages')
      .insert({
        org_id: input.orgId,
        eb_project_id: input.projectId,
        inspection_id: inspectionId,
        channel: 'email',
        recipient_email: email,
        subject,
        template_key: 'eb_remediation_access',
        status: 'pending',
        created_by: input.profileId ?? null,
      })
      .select('id')
      .single()
    if (messageError || !messageRow) {
      await admin
        .from('eb_remediation_access_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', link.id)
      throw new Error(messageError?.message ?? 'Länken skapades men mejlloggen kunde inte skapas.')
    }

    try {
      const result = await sendAssignmentEmail({
        to: email,
        from: fromAddress!,
        subject,
        html,
        text,
      })
      const sentAt = new Date().toISOString()
      await Promise.all([
        admin
          .from('outbound_messages')
          .update({
            status: 'sent',
            provider: result.provider,
            provider_message_id: result.providerMessageId,
            sent_at: sentAt,
          })
          .eq('id', messageRow.id),
        admin.from('eb_remediation_access_links').update({ sent_at: sentAt }).eq('id', link.id),
      ])
      link.sent_at = sentAt
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Mejlutskicket misslyckades.'
      await admin
        .from('outbound_messages')
        .update({ status: 'failed', error_message: message })
        .eq('id', messageRow.id)
      await admin
        .from('eb_remediation_access_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', link.id)
      throw new Error(`Länken skapades men kunde inte skickas: ${message}`)
    }
    }
  }

  if (previousLinkIds.length > 0) {
    const { error: revokeError } = await admin
      .from('eb_remediation_access_links')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', previousLinkIds)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
    if (revokeError) {
      throw new Error(
        `Den nya länken skapades men tidigare länkar kunde inte återkallas: ${revokeError.message}`
      )
    }
  }

  return { accessUrl, link: mapAccessLink(link as RemediationAccessRow) }
}

export async function revokeEbRemediationAccessLink(input: {
  orgId: string
  projectId: string
  inspectionId?: string | null
  followUpOrderId?: string | null
  linkId: string
}) {
  const admin = createSupabaseAdminClient()
  let revokeQuery = admin
    .from('eb_remediation_access_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', input.linkId)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .filter('follow_up_order_id', input.followUpOrderId ? 'eq' : 'is', input.followUpOrderId ?? null)
    .neq('role', 'customer_owner')
  if (input.inspectionId) revokeQuery = revokeQuery.eq('inspection_id', input.inspectionId)
  const { data, error } = await revokeQuery.select('id')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte återkalla länken.')
  if (!data) throw new Error('EB_REMEDIATION_ACCESS_NOT_FOUND')
}

function actorFromAccess(access: RemediationAccessRow): Actor {
  return {
    accessLinkId: access.id,
    name: access.display_name,
    email: access.email,
  }
}

function assertOpenAccess(access: RemediationAccessRow) {
  if (access.revoked_at) throw new Error('EB_REMEDIATION_ACCESS_REVOKED')
  if (new Date(access.expires_at).getTime() < Date.now()) throw new Error('EB_REMEDIATION_ACCESS_EXPIRED')
}

function assertTaskVisibleToAccess(task: RemediationTaskRow, access: RemediationAccessRow) {
  if (!task.included || (task.follow_up_order_id ?? null) !== (access.follow_up_order_id ?? null)) {
    throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  }
  if (access.inspection_id && task.inspection_id !== access.inspection_id) {
    throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  }
  if ((access.role === 'assignee' || (access.follow_up_order_id && access.role !== 'customer_owner')) &&
      (!access.remediation_assignee_id || task.remediation_assignee_id !== access.remediation_assignee_id)) {
    throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  }
}

function versionPayload(value: unknown): Record<string, string | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | null] =>
    typeof entry[1] === 'string' || entry[1] === null))
}

async function savedContractorCompletionExplanation(task: RemediationTaskRow, access: RemediationAccessRow): Promise<string | null> {
  if (!task.follow_up_order_id || !task.remediation_assignee_id ||
    !['assignee', 'contractor_admin'].includes(access.role)) return null
  const admin = createSupabaseAdminClient()
  // Only the most recent task activity can supply the explanation. A later
  // reassignment, request for more work or other activity requires fresh evidence.
  const { data: event, error: eventError } = await admin.from('eb_remediation_events')
    .select('event_type,message,actor_access_link_id')
    .eq('org_id', access.org_id).eq('eb_project_id', access.eb_project_id).eq('task_id', task.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (eventError) throw new Error(eventError.message ?? 'Kunde inte kontrollera den sparade kommentaren.')
  if (event?.event_type !== 'comment' || !event.actor_access_link_id || !normalizeText(event.message)) return null
  // A buyer's comment is not completion evidence. Historical links can have
  // expired or been renewed, but must identify this task's current contractor.
  const { data: author, error: authorError } = await admin.from('eb_remediation_access_links')
    .select('id').eq('id', event.actor_access_link_id)
    .eq('org_id', access.org_id).eq('eb_project_id', access.eb_project_id)
    .eq('inspection_id', task.inspection_id).eq('follow_up_order_id', task.follow_up_order_id)
    .eq('remediation_assignee_id', task.remediation_assignee_id).in('role', ['assignee', 'contractor_admin'])
    .maybeSingle()
  if (authorError) throw new Error(authorError.message ?? 'Kunde inte kontrollera kommentarens avsändare.')
  return author ? normalizeText(event.message) : null
}

export async function performEbRemediationTokenAction(input: {
  token: string
  action: string
  payload: Record<string, unknown>
  requestOrigin?: string | null
}) {
  const access = await resolveAccessToken(input.token)
  if (!access) throw new Error('EB_REMEDIATION_ACCESS_NOT_FOUND')
  if (input.action === 'renew_owner_link') {
    if (access.role !== 'customer_owner' || !access.follow_up_order_id || access.revoked_at) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await requestEbFollowUpOwnerRenewal({ accessToken: input.token, baseUrl: appBaseUrl(input.requestOrigin) })
    // Renewal can only email the existing buyer; it must not return a workspace.
    return null
  }
  await assertEbRemediationOwnerSession(access)
  assertOpenAccess(access)
  const paid = Boolean(access.follow_up_order_id)
  if (access.follow_up_order_id) {
    const order = await requireFollowUpOrder({ orgId: access.org_id, projectId: access.eb_project_id, orderId: access.follow_up_order_id })
    if (access.inspection_id !== order.inspection_id) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    if (order.withdrawal_requested_at && input.action !== 'withdraw_order') throw new Error('EB_FOLLOW_UP_ORDER_INACTIVE')
  }
  const canManage = ebRemediationCanManage(access.role, paid)
  const actor = actorFromAccess(access)

  if (input.action === 'withdraw_order') {
    if (access.role !== 'customer_owner' || !access.follow_up_order_id) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    if (input.payload.confirmed !== true) throw new Error('EB_FOLLOW_UP_WITHDRAWAL_CONFIRMATION_REQUIRED')
    await withdrawEbFollowUpOrder({ orderId: access.follow_up_order_id, actorEmail: access.email, baseUrl: appBaseUrl(input.requestOrigin) })
  } else if (input.action === 'comment') {
    if (!ebRemediationCanComment(access.role)) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    const taskId = stringValue(input.payload.taskId).trim()
    const task = await requireTask({ orgId: access.org_id, projectId: access.eb_project_id, taskId })
    assertTaskVisibleToAccess(task, access)
    await addEbRemediationComment({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskId,
      message: stringValue(input.payload.message),
      expectedUpdatedAt: nullableString(input.payload.expectedUpdatedAt) ?? task.updated_at,
      actor,
    })
  } else if (input.action === 'status') {
    const taskId = stringValue(input.payload.taskId).trim()
    const status = stringValue(input.payload.status) as EbRemediationStatus
    const task = await requireTask({ orgId: access.org_id, projectId: access.eb_project_id, taskId })
    assertTaskVisibleToAccess(task, access)
    const allowed = new Set(ebRemediationAllowedStatuses(access.role, paid))
    if (!allowed.has(status)) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    let message = nullableString(input.payload.message)
    if (paid && (access.role === 'customer_owner' || status === 'cannot_remedy') && !message) {
      throw new Error('EB_REMEDIATION_COMMENT_REQUIRED')
    }
    if ((!paid && access.role === 'assignee' && status === 'ready_for_review') ||
        (paid && status === 'reported_remedied' && !message)) {
      const admin = createSupabaseAdminClient()
      const { count, error } = await admin
        .from('eb_remediation_images')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', access.org_id)
        .eq('eb_project_id', access.eb_project_id)
        .eq('task_id', taskId)
      if (error) throw new Error(error.message ?? 'Kunde inte kontrollera åtgärdsbilder.')
      if (!count && paid) message = await savedContractorCompletionExplanation(task, access)
      if (!count && (!paid || !message)) throw new Error(paid ? 'EB_REMEDIATION_COMPLETION_EVIDENCE_REQUIRED' : 'EB_REMEDIATION_COMPLETION_IMAGE_REQUIRED')
    }
    await changeEbRemediationTaskStatus({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskId,
      status,
      message,
      expectedUpdatedAt: nullableString(input.payload.expectedUpdatedAt) ?? task.updated_at,
      actor,
    })
  } else if (input.action === 'assign') {
    if (!canManage) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    const taskIds = Array.isArray(input.payload.taskIds)
      ? input.payload.taskIds.map((value) => stringValue(value).trim()).filter(Boolean)
      : []
    await assignEbRemediationTasks({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      inspectionId: access.inspection_id,
      followUpOrderId: access.follow_up_order_id,
      expectedVersions: versionPayload(input.payload.expectedVersions),
      taskIds,
      assigneeId: nullableString(input.payload.assigneeId),
      dueDate: ebRemediationAssignmentDueDate(input.payload),
      actor,
    })
  } else if (input.action === 'create_assignee') {
    if (!canManage) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await createEbRemediationAssignee({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      followUpOrderId: access.follow_up_order_id,
      name: stringValue(input.payload.name),
      companyName: nullableString(input.payload.companyName),
      contactName: nullableString(input.payload.contactName),
      email: nullableString(input.payload.email),
      phone: nullableString(input.payload.phone),
    })
  } else if (input.action === 'update_assignee') {
    if (!canManage) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await updateEbRemediationAssignee({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      followUpOrderId: access.follow_up_order_id,
      assigneeId: stringValue(input.payload.assigneeId),
      name: stringValue(input.payload.name),
      companyName: nullableString(input.payload.companyName),
      contactName: nullableString(input.payload.contactName),
      email: nullableString(input.payload.email),
      phone: nullableString(input.payload.phone),
      isActive: typeof input.payload.isActive === 'boolean' ? input.payload.isActive : true,
    })
  } else if (input.action === 'send_assignee_link') {
    if (!canManage) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    const assigneeId = stringValue(input.payload.assigneeId)
    const admin = createSupabaseAdminClient()
    const { data: assignee, error } = await admin
      .from('eb_remediation_assignees')
      .select('id,name,contact_name,email')
      .eq('id', assigneeId)
      .eq('org_id', access.org_id)
      .eq('eb_project_id', access.eb_project_id)
      .filter('follow_up_order_id', access.follow_up_order_id ? 'eq' : 'is', access.follow_up_order_id ?? null)
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
    await issueEbRemediationAccessLink({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      inspectionId: access.inspection_id,
      followUpOrderId: access.follow_up_order_id,
      role: 'assignee',
      assigneeId,
      displayName: assignee.contact_name ?? assignee.name,
      email: assignee.email ?? '',
      requestOrigin: input.requestOrigin,
      sendEmail: true,
    })
  } else if (input.action === 'revoke_link') {
    if (!canManage) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await revokeEbRemediationAccessLink({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      inspectionId: access.inspection_id,
      followUpOrderId: access.follow_up_order_id,
      linkId: stringValue(input.payload.linkId),
    })
  } else {
    throw new Error('EB_REMEDIATION_ACTION_UNKNOWN')
  }

  return getEbRemediationWorkspaceByToken(input.token)
}

export async function performEbRemediationInternalAction(input: {
  orgId: string
  projectId: string
  inspectionId?: string | null
  profileId: string
  action: string
  payload: Record<string, unknown>
  requestOrigin?: string | null
}) {
  const actor = await loadActorForProfile(input.profileId)
  if (input.action === 'create_assignee') {
    await createEbRemediationAssignee({
      orgId: input.orgId,
      projectId: input.projectId,
      profileId: input.profileId,
      name: stringValue(input.payload.name),
      companyName: nullableString(input.payload.companyName),
      contactName: nullableString(input.payload.contactName),
      email: nullableString(input.payload.email),
      phone: nullableString(input.payload.phone),
    })
  } else if (input.action === 'update_assignee') {
    await updateEbRemediationAssignee({
      orgId: input.orgId,
      projectId: input.projectId,
      profileId: input.profileId,
      assigneeId: stringValue(input.payload.assigneeId),
      name: stringValue(input.payload.name),
      companyName: nullableString(input.payload.companyName),
      contactName: nullableString(input.payload.contactName),
      email: nullableString(input.payload.email),
      phone: nullableString(input.payload.phone),
      isActive: typeof input.payload.isActive === 'boolean' ? input.payload.isActive : true,
    })
  } else if (input.action === 'assign') {
    const taskIds = Array.isArray(input.payload.taskIds)
      ? input.payload.taskIds.map((value) => stringValue(value).trim()).filter(Boolean)
      : []
    await assignEbRemediationTasks({
      orgId: input.orgId,
      projectId: input.projectId,
      inspectionId: input.inspectionId,
      expectedVersions: versionPayload(input.payload.expectedVersions),
      taskIds,
      assigneeId: nullableString(input.payload.assigneeId),
      dueDate: ebRemediationAssignmentDueDate(input.payload),
      actor,
    })
  } else if (input.action === 'status') {
    const taskId = stringValue(input.payload.taskId)
    const task = await requireTask({ orgId: input.orgId, projectId: input.projectId, taskId })
    if (input.inspectionId && task.inspection_id !== input.inspectionId) {
      throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
    }
    await changeEbRemediationTaskStatus({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId,
      status: stringValue(input.payload.status) as EbRemediationStatus,
      expectedUpdatedAt: nullableString(input.payload.expectedUpdatedAt) ?? task.updated_at,
      message: nullableString(input.payload.message),
      actor,
    })
  } else if (input.action === 'comment') {
    const taskId = stringValue(input.payload.taskId)
    const task = await requireTask({ orgId: input.orgId, projectId: input.projectId, taskId })
    if (input.inspectionId && task.inspection_id !== input.inspectionId) {
      throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
    }
    await addEbRemediationComment({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId,
      message: stringValue(input.payload.message),
      expectedUpdatedAt: nullableString(input.payload.expectedUpdatedAt) ?? task.updated_at,
      actor,
    })
  } else if (input.action === 'send_admin_link' || input.action === 'send_viewer_link') {
    await issueEbRemediationAccessLink({
      orgId: input.orgId,
      projectId: input.projectId,
      inspectionId: input.inspectionId,
      profileId: input.profileId,
      role: input.action === 'send_admin_link' ? 'contractor_admin' : 'contractor_viewer',
      displayName: nullableString(input.payload.displayName),
      email: stringValue(input.payload.email),
      requestOrigin: input.requestOrigin,
      sendEmail: true,
    })
  } else if (input.action === 'send_assignee_link') {
    const assigneeId = stringValue(input.payload.assigneeId)
    const admin = createSupabaseAdminClient()
    const { data: assignee, error } = await admin
      .from('eb_remediation_assignees')
      .select('id,name,contact_name,email')
      .eq('id', assigneeId)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
    await issueEbRemediationAccessLink({
      orgId: input.orgId,
      projectId: input.projectId,
      inspectionId: input.inspectionId,
      profileId: input.profileId,
      role: 'assignee',
      assigneeId,
      displayName: assignee.contact_name ?? assignee.name,
      email: assignee.email ?? '',
      requestOrigin: input.requestOrigin,
      sendEmail: true,
    })
  } else if (input.action === 'revoke_link') {
    await revokeEbRemediationAccessLink({
      orgId: input.orgId,
      projectId: input.projectId,
      inspectionId: input.inspectionId,
      linkId: stringValue(input.payload.linkId),
    })
  } else {
    throw new Error('EB_REMEDIATION_ACTION_UNKNOWN')
  }
  return getEbRemediationWorkspace({
    orgId: input.orgId,
    projectId: input.projectId,
    inspectionId: input.inspectionId,
  })
}

function imageExtension(file: File) {
  const fromName = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (fromName) return fromName
  if (file.type === 'image/png') return 'png'
  if (file.type === 'image/webp') return 'webp'
  if (file.type === 'image/heic') return 'heic'
  if (file.type === 'image/heif') return 'heif'
  return 'jpg'
}

export async function uploadEbRemediationImageByToken(input: {
  token: string
  taskId: string
  file: File
}) {
  const access = await resolveAccessToken(input.token)
  if (!access) throw new Error('EB_REMEDIATION_ACCESS_NOT_FOUND')
  await assertEbRemediationOwnerSession(access)
  assertOpenAccess(access)
  if (access.role === 'contractor_viewer') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
  const task = await requireTask({
    orgId: access.org_id,
    projectId: access.eb_project_id,
    taskId: input.taskId,
  })
  assertTaskVisibleToAccess(task, access)
  if (!input.file.type.toLowerCase().startsWith('image/')) throw new Error('EB_REMEDIATION_IMAGE_TYPE_INVALID')
  if (input.file.size <= 0) throw new Error('EB_REMEDIATION_IMAGE_EMPTY')
  if (input.file.size > EB_REMEDIATION_MAX_IMAGE_BYTES) throw new Error('EB_REMEDIATION_IMAGE_TOO_LARGE')

  const admin = createSupabaseAdminClient()
  const source = Buffer.from(await input.file.arrayBuffer())
  const id = randomUUID()
  const extension = imageExtension(input.file)
  const originalPath = `${access.eb_project_id}/${input.taskId}/${id}.${extension}`
  const thumbnailPath = `${access.eb_project_id}/${input.taskId}/${id}-thumb.jpg`
  const storage = admin.storage.from(EB_REMEDIATION_IMAGE_BUCKET)
  const { error: uploadError } = await storage.upload(originalPath, source, {
    contentType: input.file.type || 'application/octet-stream',
    upsert: false,
  })
  if (uploadError) throw new Error(uploadError.message ?? 'Kunde inte ladda upp bilden.')

  let storedThumbnailPath: string | null = null
  try {
    const thumbnail = await sharp(source, { failOn: 'none' })
      .rotate()
      .resize({ width: 520, height: 520, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 68, mozjpeg: true })
      .toBuffer()
    const { error } = await storage.upload(thumbnailPath, thumbnail, {
      contentType: 'image/jpeg',
      upsert: false,
    })
    if (!error) storedThumbnailPath = thumbnailPath
  } catch {
    // The original remains available when a source format cannot be thumbnailed.
  }

  try {
    await applyTaskAction({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskId: input.taskId,
      action: 'image',
      expectedUpdatedAt: task.updated_at,
      actor: actorFromAccess(access),
      payload: { id, storageBucket: EB_REMEDIATION_IMAGE_BUCKET, filePath: originalPath,
        thumbnailFilePath: storedThumbnailPath, fileName: input.file.name,
        contentType: input.file.type || null, fileSizeBytes: input.file.size },
    })
    return id
  } catch (error) {
    // A lost RPC response can follow a successful commit. Never remove an image
    // that history already references, nor delete when commit state is unknown.
    const committed = await admin.from('eb_remediation_images').select('id')
      .eq('id', id).eq('task_id', input.taskId).maybeSingle()
    if (committed.data) return id
    if (!committed.error) await storage.remove([originalPath, ...(storedThumbnailPath ? [storedThumbnailPath] : [])])
    throw error
  }
}
