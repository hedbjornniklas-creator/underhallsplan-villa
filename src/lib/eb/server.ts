import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type EbInspectionVariant = 'SB' | 'FB' | 'EB' | 'GB' | 'KSB' | 'SAB'

export type EbInspectionSummary = {
  inspectionId: string
  projectId: string
  variant: EbInspectionVariant
  variantLabel: string
  sequenceNo: number
  parentInspectionId: string | null
  status: string | null
  date: string | null
  inspectionTime: string | null
  clientName: string | null
  assignmentNumber: string | null
  invitationSentAt: string | null
  reportLockedAt: string | null
  createdAt: string | null
}

export type EbProjectListItem = {
  id: string
  orgId: string
  propertyId: string | null
  title: string
  contractName: string | null
  propertyDesignation: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  municipality: string | null
  clientName: string | null
  contractorName: string | null
  status: string
  createdAt: string | null
  updatedAt: string | null
  inspections: EbInspectionSummary[]
}

type EbProjectRow = {
  id: string
  org_id: string
  property_id: string | null
  title: string
  contract_name: string | null
  property_designation: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  client_name: string | null
  contractor_name: string | null
  status: string | null
  created_at: string | null
  updated_at: string | null
}

type EbInspectionDetailRow = {
  inspection_id: string
  org_id: string
  eb_project_id: string
  parent_inspection_id: string | null
  inspection_variant: string | null
  sequence_no: number | null
  invitation_sent_at: string | null
  report_locked_at: string | null
  created_at: string | null
}

type InspectionRow = {
  id: string
  property_id: string
  status: string | null
  date: string | null
  inspection_time: string | null
  client_name: string | null
  assignment_number: string | null
  created_at: string | null
}

type EbDisciplineSettingRow = {
  key: string
  label: string
  littera_prefix: string | null
  sort_order: number | null
}

export type CreateEbProjectInput = {
  orgId: string
  requestedByUserId: string
  title: string
  contractName?: string | null
  propertyDesignation?: string | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  municipality?: string | null
  clientName?: string | null
  contractorName?: string | null
  inspectionDate?: string | null
  inspectionTime?: string | null
  meetingPlace?: string | null
  startMeetingTime?: string | null
  finalMeetingTime?: string | null
}

export type CreateEbInspectionInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  variant: EbInspectionVariant
  parentInspectionId?: string | null
  inspectionDate?: string | null
  inspectionTime?: string | null
  meetingPlace?: string | null
  startMeetingTime?: string | null
  finalMeetingTime?: string | null
}

const VARIANT_LABELS: Record<EbInspectionVariant, string> = {
  SB: 'Slutbesiktning',
  FB: 'Förbesiktning',
  EB: 'Efterbesiktning',
  GB: 'Garantibesiktning',
  KSB: 'Kompletterande slutbesiktning',
  SAB: 'Särskild besiktning',
}

const EB_VARIANTS = Object.keys(VARIANT_LABELS) as EbInspectionVariant[]

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeDate(value: string | null | undefined) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null
}

function normalizeTime(value: string | null | undefined) {
  const trimmed = normalizeText(value)
  if (!trimmed) return null
  return /^\d{2}:\d{2}(:\d{2})?$/.test(trimmed) ? trimmed : null
}

export function isEbInspectionVariant(value: string): value is EbInspectionVariant {
  return EB_VARIANTS.includes(value as EbInspectionVariant)
}

export function getEbInspectionVariantLabel(variant: EbInspectionVariant) {
  return VARIANT_LABELS[variant]
}

function toVariant(value: string | null | undefined): EbInspectionVariant {
  const normalized = String(value ?? '').trim().toUpperCase()
  return isEbInspectionVariant(normalized) ? normalized : 'SB'
}

function toProjectTitle(input: CreateEbProjectInput) {
  return (
    normalizeText(input.title) ??
    normalizeText(input.contractName) ??
    normalizeText(input.address) ??
    `Entreprenad ${new Date().toISOString().slice(0, 10)}`
  )
}

function toPropertyName(input: CreateEbProjectInput, title: string) {
  return normalizeText(input.address) ?? normalizeText(input.propertyDesignation) ?? title
}

function mapInspectionSummary(
  detail: EbInspectionDetailRow,
  inspection: InspectionRow | undefined
): EbInspectionSummary {
  const variant = toVariant(detail.inspection_variant)

  return {
    inspectionId: detail.inspection_id,
    projectId: detail.eb_project_id,
    variant,
    variantLabel: getEbInspectionVariantLabel(variant),
    sequenceNo: detail.sequence_no ?? 1,
    parentInspectionId: detail.parent_inspection_id ?? null,
    status: inspection?.status ?? null,
    date: inspection?.date ?? null,
    inspectionTime: inspection?.inspection_time ?? null,
    clientName: inspection?.client_name ?? null,
    assignmentNumber: inspection?.assignment_number ?? null,
    invitationSentAt: detail.invitation_sent_at ?? null,
    reportLockedAt: detail.report_locked_at ?? null,
    createdAt: inspection?.created_at ?? detail.created_at ?? null,
  }
}

function mapProject(
  project: EbProjectRow,
  detailsByProjectId: Map<string, EbInspectionDetailRow[]>,
  inspectionsById: Map<string, InspectionRow>
): EbProjectListItem {
  const inspections = (detailsByProjectId.get(project.id) ?? [])
    .map((detail) => mapInspectionSummary(detail, inspectionsById.get(detail.inspection_id)))
    .sort((left, right) => {
      if (left.sequenceNo !== right.sequenceNo) return left.sequenceNo - right.sequenceNo
      return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
    })

  return {
    id: project.id,
    orgId: project.org_id,
    propertyId: project.property_id ?? null,
    title: project.title,
    contractName: project.contract_name ?? null,
    propertyDesignation: project.property_designation ?? null,
    address: project.address ?? null,
    postalCode: project.postal_code ?? null,
    city: project.city ?? null,
    municipality: project.municipality ?? null,
    clientName: project.client_name ?? null,
    contractorName: project.contractor_name ?? null,
    status: project.status ?? 'draft',
    createdAt: project.created_at ?? null,
    updatedAt: project.updated_at ?? null,
    inspections,
  }
}

async function fetchProjectsByOrg(orgId: string, projectId?: string) {
  const admin = createSupabaseAdminClient()
  let query = admin
    .from('eb_projects')
    .select(
      'id,org_id,property_id,title,contract_name,property_designation,address,postal_code,city,municipality,client_name,contractor_name,status,created_at,updated_at'
    )
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })

  if (projectId) {
    query = query.eq('id', projectId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta EB-projekt.')
  }

  return (data ?? []) as EbProjectRow[]
}

async function fetchDetailsForProjects(orgId: string, projectIds: string[]) {
  if (projectIds.length === 0) return []

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_inspection_details')
    .select(
      'inspection_id,org_id,eb_project_id,parent_inspection_id,inspection_variant,sequence_no,invitation_sent_at,report_locked_at,created_at'
    )
    .eq('org_id', orgId)
    .in('eb_project_id', projectIds)
    .order('sequence_no', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta EB-besiktningar.')
  }

  return (data ?? []) as EbInspectionDetailRow[]
}

async function fetchInspectionsByIds(inspectionIds: string[]) {
  if (inspectionIds.length === 0) return new Map<string, InspectionRow>()

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspections')
    .select('id,property_id,status,date,inspection_time,client_name,assignment_number,created_at')
    .in('id', inspectionIds)

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta inspections.')
  }

  return new Map(((data ?? []) as InspectionRow[]).map((inspection) => [inspection.id, inspection]))
}

async function buildProjectItems(projectRows: EbProjectRow[]) {
  const projectIds = projectRows.map((project) => project.id)
  const details = await fetchDetailsForProjects(projectRows[0]?.org_id ?? '', projectIds)
  const inspectionsById = await fetchInspectionsByIds(details.map((detail) => detail.inspection_id))
  const detailsByProjectId = new Map<string, EbInspectionDetailRow[]>()

  for (const detail of details) {
    const rows = detailsByProjectId.get(detail.eb_project_id) ?? []
    rows.push(detail)
    detailsByProjectId.set(detail.eb_project_id, rows)
  }

  return projectRows.map((project) => mapProject(project, detailsByProjectId, inspectionsById))
}

export async function listEbProjects(orgId: string): Promise<EbProjectListItem[]> {
  const projects = await fetchProjectsByOrg(orgId)
  if (projects.length === 0) return []
  return buildProjectItems(projects)
}

export async function getEbProjectById(input: {
  orgId: string
  projectId: string
}): Promise<EbProjectListItem | null> {
  const projects = await fetchProjectsByOrg(input.orgId, input.projectId)
  if (projects.length === 0) return null
  const [project] = await buildProjectItems(projects)
  return project ?? null
}

async function seedDisciplinesForInspection(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('settings_eb_disciplines')
    .select('key,label,littera_prefix,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta EB-discipliner.')
  }

  const settings = (data ?? []) as EbDisciplineSettingRow[]
  if (settings.length === 0) return

  const { error: insertError } = await admin.from('eb_disciplines').insert(
    settings.map((setting) => ({
      org_id: input.orgId,
      eb_project_id: input.projectId,
      inspection_id: input.inspectionId,
      discipline_key: setting.key,
      label: setting.label,
      littera: setting.littera_prefix,
      sort_order: setting.sort_order ?? 100,
      is_active: true,
    }))
  )

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte skapa EB-discipliner.')
  }
}

async function cleanupCreatedRows(input: {
  projectId?: string | null
  inspectionId?: string | null
  propertyId?: string | null
}) {
  const admin = createSupabaseAdminClient()
  if (input.projectId) {
    await admin.from('eb_projects').delete().eq('id', input.projectId)
  }
  if (input.inspectionId) {
    await admin.from('inspections').delete().eq('id', input.inspectionId)
  }
  if (input.propertyId) {
    await admin.from('properties').delete().eq('id', input.propertyId)
  }
}

export async function createEbProjectWithInitialSb(
  input: CreateEbProjectInput
): Promise<EbProjectListItem> {
  const admin = createSupabaseAdminClient()
  const title = toProjectTitle(input)
  const normalizedAddress = normalizeText(input.address)
  const normalizedClientName = normalizeText(input.clientName)
  let propertyId: string | null = null
  let inspectionId: string | null = null
  let projectId: string | null = null

  try {
    const { data: property, error: propertyError } = await admin
      .from('properties')
      .insert({
        owner: input.requestedByUserId,
        name: toPropertyName(input, title),
        status: 'Utkast',
        address: normalizedAddress,
        postal_code: normalizeText(input.postalCode),
        city: normalizeText(input.city),
        municipality: normalizeText(input.municipality),
        cadastral_id: normalizeText(input.propertyDesignation),
        client_name: normalizedClientName,
        owner_name: normalizedClientName,
      })
      .select('id')
      .single()

    if (propertyError || !property) {
      throw new Error(propertyError?.message ?? 'Kunde inte skapa fastighet för EB.')
    }

    propertyId = String(property.id)

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .insert({
        property_id: propertyId,
        type: 'EB',
        status: 'draft',
        date: normalizeDate(input.inspectionDate),
        inspection_time: normalizeTime(input.inspectionTime),
        client_name: normalizedClientName,
        scope: getEbInspectionVariantLabel('SB'),
      })
      .select('id')
      .single()

    if (inspectionError || !inspection) {
      throw new Error(inspectionError?.message ?? 'Kunde inte skapa SB.')
    }

    inspectionId = String(inspection.id)

    const { data: project, error: projectError } = await admin
      .from('eb_projects')
      .insert({
        org_id: input.orgId,
        property_id: propertyId,
        owner_profile_id: input.requestedByUserId,
        created_by: input.requestedByUserId,
        title,
        contract_name: normalizeText(input.contractName),
        property_designation: normalizeText(input.propertyDesignation),
        address: normalizedAddress,
        postal_code: normalizeText(input.postalCode),
        city: normalizeText(input.city),
        municipality: normalizeText(input.municipality),
        client_name: normalizedClientName,
        contractor_name: normalizeText(input.contractorName),
        status: 'active',
      })
      .select('id')
      .single()

    if (projectError || !project) {
      throw new Error(projectError?.message ?? 'Kunde inte skapa EB-projekt.')
    }

    projectId = String(project.id)

    const { error: detailError } = await admin.from('eb_inspection_details').insert({
      inspection_id: inspectionId,
      org_id: input.orgId,
      eb_project_id: projectId,
      inspection_variant: 'SB',
      sequence_no: 1,
      meeting_place: normalizeText(input.meetingPlace),
      start_meeting_time: normalizeTime(input.startMeetingTime),
      final_meeting_time: normalizeTime(input.finalMeetingTime),
      report_title: `Utlåtande ${getEbInspectionVariantLabel('SB')}`,
    })

    if (detailError) {
      throw new Error(detailError.message ?? 'Kunde inte koppla SB till EB-projektet.')
    }

    await seedDisciplinesForInspection({
      orgId: input.orgId,
      projectId,
      inspectionId,
    })

    const created = await getEbProjectById({ orgId: input.orgId, projectId })
    if (!created) {
      throw new Error('EB-projektet skapades men kunde inte läsas tillbaka.')
    }

    return created
  } catch (error) {
    await cleanupCreatedRows({ projectId, inspectionId, propertyId })
    throw error
  }
}

async function resolveProjectPropertyId(project: EbProjectListItem) {
  if (project.propertyId) return project.propertyId

  const firstInspectionId = project.inspections[0]?.inspectionId
  if (!firstInspectionId) return null

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspections')
    .select('property_id')
    .eq('id', firstInspectionId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta fastighetskoppling.')
  }

  return typeof data?.property_id === 'string' ? data.property_id : null
}

export async function createEbInspectionForProject(
  input: CreateEbInspectionInput
): Promise<EbProjectListItem> {
  const admin = createSupabaseAdminClient()
  const project = await getEbProjectById({
    orgId: input.orgId,
    projectId: input.projectId,
  })

  if (!project) {
    throw new Error('EB_PROJECT_NOT_FOUND')
  }

  const propertyId = await resolveProjectPropertyId(project)
  if (!propertyId) {
    throw new Error('EB_PROJECT_PROPERTY_MISSING')
  }

  let inspectionId: string | null = null
  const sequenceNo =
    project.inspections.reduce((max, inspection) => Math.max(max, inspection.sequenceNo), 0) + 1
  const parentInspectionId =
    normalizeText(input.parentInspectionId) ?? project.inspections.at(-1)?.inspectionId ?? null
  const variantLabel = getEbInspectionVariantLabel(input.variant)

  try {
    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .insert({
        property_id: propertyId,
        type: 'EB',
        status: 'draft',
        date: normalizeDate(input.inspectionDate),
        inspection_time: normalizeTime(input.inspectionTime),
        client_name: project.clientName,
        scope: variantLabel,
      })
      .select('id')
      .single()

    if (inspectionError || !inspection) {
      throw new Error(inspectionError?.message ?? `Kunde inte skapa ${variantLabel}.`)
    }

    inspectionId = String(inspection.id)

    const { error: detailError } = await admin.from('eb_inspection_details').insert({
      inspection_id: inspectionId,
      org_id: input.orgId,
      eb_project_id: project.id,
      parent_inspection_id: parentInspectionId,
      inspection_variant: input.variant,
      sequence_no: sequenceNo,
      meeting_place: normalizeText(input.meetingPlace),
      start_meeting_time: normalizeTime(input.startMeetingTime),
      final_meeting_time: normalizeTime(input.finalMeetingTime),
      report_title: `Utlåtande ${variantLabel}`,
    })

    if (detailError) {
      throw new Error(detailError.message ?? 'Kunde inte koppla besiktningen till EB-projektet.')
    }

    await seedDisciplinesForInspection({
      orgId: input.orgId,
      projectId: project.id,
      inspectionId,
    })

    const updated = await getEbProjectById({ orgId: input.orgId, projectId: project.id })
    if (!updated) {
      throw new Error('Besiktningen skapades men projektet kunde inte läsas tillbaka.')
    }

    return updated
  } catch (error) {
    if (inspectionId) {
      await admin.from('inspections').delete().eq('id', inspectionId)
    }
    throw error
  }
}
