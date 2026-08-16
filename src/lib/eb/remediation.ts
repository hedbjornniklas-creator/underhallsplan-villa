import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { getEbProjectById, type EbProjectListItem } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

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

export type EbRemediationAccessRole = 'contractor_admin' | 'contractor_viewer' | 'assignee'

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
  noteId: string
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
  access: {
    id: string | null
    role: EbRemediationAccessRole | 'internal'
    displayName: string | null
    email: string | null
    assigneeId: string | null
    expiresAt: string | null
  }
  assignees: EbRemediationAssignee[]
  tasks: EbRemediationTask[]
  events: EbRemediationEvent[]
  images: EbRemediationImage[]
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
  org_id: string
  eb_project_id: string
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
  inspection_id: string
  eb_note_id: string
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

async function insertEvent(input: {
  orgId: string
  projectId: string
  taskId: string
  eventType: string
  actor?: Actor | null
  message?: string | null
  fromStatus?: EbRemediationStatus | null
  toStatus?: EbRemediationStatus | null
  metadata?: Record<string, unknown>
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('eb_remediation_events').insert({
    org_id: input.orgId,
    eb_project_id: input.projectId,
    task_id: input.taskId,
    event_type: input.eventType,
    actor_access_link_id: input.actor?.accessLinkId ?? null,
    actor_profile_id: input.actor?.profileId ?? null,
    actor_name: normalizeText(input.actor?.name),
    actor_email: normalizeEmail(input.actor?.email),
    message: normalizeText(input.message),
    from_status: input.fromStatus ?? null,
    to_status: input.toStatus ?? null,
    metadata: input.metadata ?? {},
  })
  if (error) throw new Error(error.message ?? 'Kunde inte spara åtgärdshistorik.')
}

async function syncRemediationTasks(project: EbProjectListItem) {
  const admin = createSupabaseAdminClient()
  const [notesResult, disciplinesResult, tasksResult] = await Promise.all([
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
      .eq('eb_project_id', project.id),
  ])

  if (notesResult.error) throw new Error(notesResult.error.message ?? 'Kunde inte läsa EB-noteringar.')
  if (disciplinesResult.error) {
    throw new Error(disciplinesResult.error.message ?? 'Kunde inte läsa besiktningsfack.')
  }
  if (tasksResult.error) throw new Error(tasksResult.error.message ?? 'Kunde inte läsa åtgärdsuppgifter.')

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
    const { error } = await admin
      .from('eb_remediation_tasks')
      .upsert(inserts, { onConflict: 'eb_note_id', ignoreDuplicates: true })
    if (error) throw new Error(error.message ?? 'Kunde inte skapa åtgärdsuppgifter.')

    const insertedNoteIds = inserts.map((row) => String(row.eb_note_id))
    const { data: createdTasks, error: createdTasksError } = await admin
      .from('eb_remediation_tasks')
      .select('id')
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id)
      .in('eb_note_id', insertedNoteIds)
    if (createdTasksError) {
      throw new Error(createdTasksError.message ?? 'Kunde inte läsa skapade åtgärdsuppgifter.')
    }
    for (const task of createdTasks ?? []) {
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

async function loadWorkspace(input: {
  project: EbProjectListItem
  access?: RemediationAccessRow | null
  state?: 'open' | 'expired' | 'revoked'
}): Promise<EbRemediationWorkspace> {
  const { project } = input
  const access = input.access ?? null
  const state = input.state ?? 'open'
  if (access && state !== 'open') {
    return {
      state,
      project: {
        id: project.id,
        title: project.title,
        objectLabel: projectObjectLabel(project),
        address: projectAddress(project),
        contractorName: project.contractorName,
        contractorEmail: project.contractorEmail,
      },
      access: {
        id: access.id,
        role: access.role,
        displayName: access.display_name ?? null,
        email: access.email,
        assigneeId: access.remediation_assignee_id ?? null,
        expiresAt: access.expires_at,
      },
      assignees: [],
      tasks: [],
      events: [],
      images: [],
      accessLinks: [],
    }
  }
  if (!access || state === 'open') await syncRemediationTasks(project)

  const admin = createSupabaseAdminClient()
  const [assigneesResult, tasksResult, linksResult] = await Promise.all([
    admin
      .from('eb_remediation_assignees')
      .select('id,name,company_name,contact_name,email,phone,is_active,created_at,updated_at')
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id)
      .order('is_active', { ascending: false })
      .order('name', { ascending: true }),
    admin
      .from('eb_remediation_tasks')
      .select(
        'id,inspection_id,eb_note_id,remediation_assignee_id,assignment_managed_by,status,due_date,included,note_snapshot,reported_remedied_at,created_at,updated_at'
      )
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id)
      .eq('included', true)
      .order('created_at', { ascending: true }),
    admin
      .from('eb_remediation_access_links')
      .select(
        'id,org_id,eb_project_id,remediation_assignee_id,role,display_name,email,expires_at,revoked_at,last_used_at,sent_at,created_at'
      )
      .eq('org_id', project.orgId)
      .eq('eb_project_id', project.id)
      .order('created_at', { ascending: false }),
  ])

  if (assigneesResult.error) {
    throw new Error(assigneesResult.error.message ?? 'Kunde inte läsa listan Åtgärdas av.')
  }
  if (tasksResult.error) throw new Error(tasksResult.error.message ?? 'Kunde inte läsa åtgärdsuppgifter.')
  if (linksResult.error) throw new Error(linksResult.error.message ?? 'Kunde inte läsa åtkomstlänkar.')

  let tasks = ((tasksResult.data ?? []) as RemediationTaskRow[]).map(mapTask)
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

  if (access?.role === 'assignee') {
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
  const pathsByBucket = new Map<string, Set<string>>()
  for (const row of imageRows) {
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
  const images: EbRemediationImage[] = imageRows.map((row) => {
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
  })

  const canManageLinks = !access || access.role === 'contractor_admin'
  const links = canManageLinks
    ? ((linksResult.data ?? []) as RemediationAccessRow[]).map(mapAccessLink)
    : []

  return {
    state,
    project: {
      id: project.id,
      title: project.title,
      objectLabel: projectObjectLabel(project),
      address: projectAddress(project),
      contractorName: project.contractorName,
      contractorEmail: project.contractorEmail,
    },
    access: {
      id: access?.id ?? null,
      role: access?.role ?? 'internal',
      displayName: access?.display_name ?? null,
      email: access?.email ?? null,
      assigneeId: access?.remediation_assignee_id ?? null,
      expiresAt: access?.expires_at ?? null,
    },
    assignees,
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
      actorEmail: row.actor_email ?? null,
      message: row.message ?? null,
      fromStatus: row.from_status ?? null,
      toStatus: row.to_status ?? null,
      createdAt: row.created_at,
    })),
    images,
    accessLinks: links,
  }
}

export async function getEbRemediationWorkspace(input: {
  orgId: string
  projectId: string
}): Promise<EbRemediationWorkspace> {
  const project = await requireProject(input.orgId, input.projectId)
  return loadWorkspace({ project })
}

async function resolveAccessToken(token: string) {
  if (!token || token.length < 32) return null
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_remediation_access_links')
    .select(
      'id,org_id,eb_project_id,remediation_assignee_id,role,display_name,email,expires_at,revoked_at,last_used_at,sent_at,created_at'
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
  return loadWorkspace({ project, access, state })
}

export async function createEbRemediationAssignee(input: {
  orgId: string
  projectId: string
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
  const { error } = await admin
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
  if (error) throw new Error(error.message ?? 'Kunde inte uppdatera Åtgärdas av.')
}

async function requireTask(input: { orgId: string; projectId: string; taskId: string }) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_remediation_tasks')
    .select(
      'id,inspection_id,eb_note_id,remediation_assignee_id,assignment_managed_by,status,due_date,included,note_snapshot,reported_remedied_at,created_at,updated_at'
    )
    .eq('id', input.taskId)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte läsa åtgärdsuppgiften.')
  if (!data) throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  return data as RemediationTaskRow
}

export async function assignEbRemediationTasks(input: {
  orgId: string
  projectId: string
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
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
  }

  const { data: currentRows, error: currentError } = await admin
    .from('eb_remediation_tasks')
    .select('id,status,remediation_assignee_id,assignment_managed_by,due_date,updated_at')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .in('id', taskIds)
  if (currentError) throw new Error(currentError.message ?? 'Kunde inte läsa valda åtgärdsuppgifter.')
  if ((currentRows ?? []).length !== taskIds.length) throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  const normalizedDueDate = input.dueDate === undefined ? undefined : normalizeText(input.dueDate)

  for (const current of currentRows ?? []) {
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

    const values: Record<string, unknown> = {
      remediation_assignee_id: input.assigneeId,
      assignment_managed_by: 'contractor',
      status: nextStatus,
    }
    if (normalizedDueDate !== undefined) values.due_date = normalizedDueDate
    const { data: updatedTask, error } = await admin
      .from('eb_remediation_tasks')
      .update(values)
      .eq('id', current.id)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .eq('updated_at', current.updated_at)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message ?? 'Kunde inte tilldela åtgärdsuppgiften.')
    if (!updatedTask) continue
    await insertEvent({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId: current.id,
      eventType: 'assigned',
      actor: input.actor,
      fromStatus: currentStatus,
      toStatus: nextStatus,
      metadata: {
        fromAssigneeId: current.remediation_assignee_id ?? null,
        toAssigneeId: input.assigneeId,
      },
    })
  }
}

export async function changeEbRemediationTaskStatus(input: {
  orgId: string
  projectId: string
  taskId: string
  status: EbRemediationStatus
  actor: Actor
}) {
  if (!STATUS_VALUES.has(input.status)) throw new Error('EB_REMEDIATION_STATUS_INVALID')
  const task = await requireTask(input)
  if (task.status === input.status) return
  const admin = createSupabaseAdminClient()
  const reported = input.status === 'reported_remedied'
  const { data: updatedTask, error } = await admin
    .from('eb_remediation_tasks')
    .update({
      status: input.status,
      reported_remedied_at: reported ? new Date().toISOString() : null,
      reported_remedied_by_access_id: reported ? input.actor.accessLinkId ?? null : null,
    })
    .eq('id', input.taskId)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('updated_at', task.updated_at)
    .select('id')
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte uppdatera status.')
  if (!updatedTask) return
  await insertEvent({
    orgId: input.orgId,
    projectId: input.projectId,
    taskId: input.taskId,
    eventType: 'status_changed',
    actor: input.actor,
    fromStatus: task.status,
    toStatus: input.status,
  })
}

export async function addEbRemediationComment(input: {
  orgId: string
  projectId: string
  taskId: string
  message: string
  actor: Actor
}) {
  await requireTask(input)
  const message = normalizeText(input.message)
  if (!message) throw new Error('EB_REMEDIATION_COMMENT_REQUIRED')
  await insertEvent({
    orgId: input.orgId,
    projectId: input.projectId,
    taskId: input.taskId,
    eventType: 'comment',
    actor: input.actor,
    message,
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

export async function issueEbRemediationAccessLink(input: {
  orgId: string
  projectId: string
  profileId?: string | null
  role: EbRemediationAccessRole
  displayName?: string | null
  email: string
  assigneeId?: string | null
  requestOrigin?: string | null
  sendEmail?: boolean
}) {
  const project = await requireProject(input.orgId, input.projectId)
  const email = normalizeEmail(input.email)
  if (!email) throw new Error('EB_REMEDIATION_EMAIL_INVALID')
  const assigneeId = input.role === 'assignee' ? normalizeText(input.assigneeId) : null
  if (input.role === 'assignee' && !assigneeId) throw new Error('EB_REMEDIATION_ASSIGNEE_REQUIRED')
  const baseUrl = appBaseUrl(input.requestOrigin)
  const fromAddress = input.sendEmail === false ? null : mailFromAddress()

  const admin = createSupabaseAdminClient()
  if (assigneeId) {
    const { data: assignee, error } = await admin
      .from('eb_remediation_assignees')
      .select('id,name')
      .eq('id', assigneeId)
      .eq('org_id', input.orgId)
      .eq('eb_project_id', input.projectId)
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
  }

  let activeQuery = admin
    .from('eb_remediation_access_links')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('role', input.role)
    .is('revoked_at', null)
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
      remediation_assignee_id: assigneeId,
      role: input.role,
      display_name: displayName,
      email,
      token_hash: hashAssignmentToken(token),
      expires_at: expiresAt,
      created_by: input.profileId ?? null,
    })
    .select(
      'id,org_id,eb_project_id,remediation_assignee_id,role,display_name,email,expires_at,revoked_at,last_used_at,sent_at,created_at'
    )
    .single()
  if (insertError || !link) throw new Error(insertError?.message ?? 'Kunde inte skapa åtkomstlänk.')

  const accessUrl = `${baseUrl}/atgarder/${token}`
  if (input.sendEmail !== false) {
    const recipient = displayName ?? 'Hej'
    const roleText = input.role === 'assignee' ? 'dina tilldelade anmärkningar' : 'projektets anmärkningar'
    const subject = `Åtgärdslista – ${project.title}`
    const text = `${recipient},\n\nDu har fått tillgång till ${roleText} för ${project.title}.\n\nÖppna åtgärdslistan: ${accessUrl}\n\nLänken är personlig och ska inte vidarebefordras.`
    const html = `<p>${escapeHtml(recipient)},</p><p>Du har fått tillgång till ${escapeHtml(roleText)} för <strong>${escapeHtml(project.title)}</strong>.</p><p><a href="${escapeHtml(accessUrl)}">Öppna åtgärdslistan</a></p><p>Länken är personlig och ska inte vidarebefordras.</p>`

    const { data: messageRow, error: messageError } = await admin
      .from('outbound_messages')
      .insert({
        org_id: input.orgId,
        eb_project_id: input.projectId,
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
  linkId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_remediation_access_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', input.linkId)
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .select('id')
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
  if (access.role === 'assignee' && task.remediation_assignee_id !== access.remediation_assignee_id) {
    throw new Error('EB_REMEDIATION_TASK_NOT_FOUND')
  }
}

export async function performEbRemediationTokenAction(input: {
  token: string
  action: string
  payload: Record<string, unknown>
  requestOrigin?: string | null
}) {
  const access = await resolveAccessToken(input.token)
  if (!access) throw new Error('EB_REMEDIATION_ACCESS_NOT_FOUND')
  assertOpenAccess(access)
  const actor = actorFromAccess(access)

  if (input.action === 'comment') {
    const taskId = stringValue(input.payload.taskId).trim()
    const task = await requireTask({ orgId: access.org_id, projectId: access.eb_project_id, taskId })
    assertTaskVisibleToAccess(task, access)
    await addEbRemediationComment({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskId,
      message: stringValue(input.payload.message),
      actor,
    })
  } else if (input.action === 'status') {
    const taskId = stringValue(input.payload.taskId).trim()
    const status = stringValue(input.payload.status) as EbRemediationStatus
    const task = await requireTask({ orgId: access.org_id, projectId: access.eb_project_id, taskId })
    assertTaskVisibleToAccess(task, access)
    const allowed =
      access.role === 'assignee'
        ? new Set<EbRemediationStatus>(['in_progress', 'ready_for_review', 'cannot_remedy'])
        : access.role === 'contractor_admin'
          ? new Set<EbRemediationStatus>([
              'assigned',
              'in_progress',
              'ready_for_review',
              'returned',
              'reported_remedied',
              'cannot_remedy',
            ])
          : new Set<EbRemediationStatus>()
    if (!allowed.has(status)) throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    if (access.role === 'assignee' && status === 'ready_for_review') {
      const admin = createSupabaseAdminClient()
      const { count, error } = await admin
        .from('eb_remediation_images')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', access.org_id)
        .eq('eb_project_id', access.eb_project_id)
        .eq('task_id', taskId)
      if (error) throw new Error(error.message ?? 'Kunde inte kontrollera åtgärdsbilder.')
      if (!count) throw new Error('EB_REMEDIATION_COMPLETION_IMAGE_REQUIRED')
    }
    await changeEbRemediationTaskStatus({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskId,
      status,
      actor,
    })
  } else if (input.action === 'assign') {
    if (access.role !== 'contractor_admin') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    const taskIds = Array.isArray(input.payload.taskIds)
      ? input.payload.taskIds.map((value) => stringValue(value).trim()).filter(Boolean)
      : []
    await assignEbRemediationTasks({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskIds,
      assigneeId: nullableString(input.payload.assigneeId),
      dueDate: nullableString(input.payload.dueDate),
      actor,
    })
  } else if (input.action === 'create_assignee') {
    if (access.role !== 'contractor_admin') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await createEbRemediationAssignee({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      name: stringValue(input.payload.name),
      companyName: nullableString(input.payload.companyName),
      contactName: nullableString(input.payload.contactName),
      email: nullableString(input.payload.email),
      phone: nullableString(input.payload.phone),
    })
  } else if (input.action === 'update_assignee') {
    if (access.role !== 'contractor_admin') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await updateEbRemediationAssignee({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      assigneeId: stringValue(input.payload.assigneeId),
      name: stringValue(input.payload.name),
      companyName: nullableString(input.payload.companyName),
      contactName: nullableString(input.payload.contactName),
      email: nullableString(input.payload.email),
      phone: nullableString(input.payload.phone),
      isActive: typeof input.payload.isActive === 'boolean' ? input.payload.isActive : true,
    })
  } else if (input.action === 'send_assignee_link') {
    if (access.role !== 'contractor_admin') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    const assigneeId = stringValue(input.payload.assigneeId)
    const admin = createSupabaseAdminClient()
    const { data: assignee, error } = await admin
      .from('eb_remediation_assignees')
      .select('id,name,contact_name,email')
      .eq('id', assigneeId)
      .eq('org_id', access.org_id)
      .eq('eb_project_id', access.eb_project_id)
      .maybeSingle()
    if (error || !assignee) throw new Error('EB_REMEDIATION_ASSIGNEE_NOT_FOUND')
    await issueEbRemediationAccessLink({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      role: 'assignee',
      assigneeId,
      displayName: assignee.contact_name ?? assignee.name,
      email: assignee.email ?? '',
      requestOrigin: input.requestOrigin,
      sendEmail: true,
    })
  } else if (input.action === 'revoke_link') {
    if (access.role !== 'contractor_admin') throw new Error('EB_REMEDIATION_ACTION_FORBIDDEN')
    await revokeEbRemediationAccessLink({
      orgId: access.org_id,
      projectId: access.eb_project_id,
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
      taskIds,
      assigneeId: nullableString(input.payload.assigneeId),
      dueDate: nullableString(input.payload.dueDate),
      actor,
    })
  } else if (input.action === 'status') {
    await changeEbRemediationTaskStatus({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId: stringValue(input.payload.taskId),
      status: stringValue(input.payload.status) as EbRemediationStatus,
      actor,
    })
  } else if (input.action === 'comment') {
    await addEbRemediationComment({
      orgId: input.orgId,
      projectId: input.projectId,
      taskId: stringValue(input.payload.taskId),
      message: stringValue(input.payload.message),
      actor,
    })
  } else if (input.action === 'send_admin_link' || input.action === 'send_viewer_link') {
    await issueEbRemediationAccessLink({
      orgId: input.orgId,
      projectId: input.projectId,
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
      linkId: stringValue(input.payload.linkId),
    })
  } else {
    throw new Error('EB_REMEDIATION_ACTION_UNKNOWN')
  }
  return getEbRemediationWorkspace({ orgId: input.orgId, projectId: input.projectId })
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
    const { data: imageRow, error: imageError } = await admin
      .from('eb_remediation_images')
      .insert({
        org_id: access.org_id,
        eb_project_id: access.eb_project_id,
        task_id: input.taskId,
        storage_bucket: EB_REMEDIATION_IMAGE_BUCKET,
        file_path: originalPath,
        thumbnail_file_path: storedThumbnailPath,
        file_name: input.file.name,
        content_type: input.file.type || null,
        file_size_bytes: input.file.size,
        uploaded_by_access_link_id: access.id,
      })
      .select('id')
      .single()
    if (imageError || !imageRow) throw new Error(imageError?.message ?? 'Kunde inte registrera bilden.')
    await insertEvent({
      orgId: access.org_id,
      projectId: access.eb_project_id,
      taskId: input.taskId,
      eventType: 'photo_added',
      actor: actorFromAccess(access),
      metadata: { imageId: imageRow.id, fileName: input.file.name },
    })
    return imageRow.id as string
  } catch (error) {
    await storage.remove([originalPath, ...(storedThumbnailPath ? [storedThumbnailPath] : [])])
    throw error
  }
}
