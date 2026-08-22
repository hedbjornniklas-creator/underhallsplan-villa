import 'server-only'

import {
  AssignmentEmailSendError,
  buildBaseUrl,
  createAssignment,
  getAssignmentById,
  getProfileContact,
  sendAssignmentConfirmation,
  updateAssignmentById,
  type AssignmentDetails,
  type AssignmentStatus,
} from '@/lib/assignments/server'
import {
  type EbAssignmentConfirmationForm,
  type EbAssignmentConfirmationSummary,
  type EbAssignmentCustomerType,
  type EbAssignmentDetails,
  type EbAssignmentPricingModel,
} from '@/lib/eb/assignmentConfirmationTypes'
import {
  getEbProjectById,
  type EbInspectionSummary,
  type EbProjectListItem,
} from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type ConfirmationLinkRow = {
  id: string
  org_id: string
  inspection_id: string
  assignment_id: string
  version_no: number
  is_current: boolean
  replaced_at: string | null
}

type AssignmentSummaryRow = {
  id: string
  status: AssignmentStatus
  accepted_at: string | null
  last_sent_at: string | null
  customer_email: string
  price_amount: number | null
  currency: string | null
  assignment_details: Record<string, unknown> | null
}

export type SaveEbAssignmentConfirmationInput = {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
  customerName: string | null
  customerEmail: string
  customerPhone: string | null
  customerAddress: string | null
  customerPostalCode: string | null
  customerCity: string | null
  propertyAddress: string | null
  propertyPostalCode: string | null
  propertyCity: string | null
  propertyMunicipality: string | null
  propertyDesignation: string | null
  propertyOwnerName: string | null
  scopeDescription: string | null
  preferredDate: string | null
  preferredTime: string | null
  priceAmount: number | null
  currency: string | null
  invoiceName: string | null
  invoiceOrgNo: string | null
  invoiceEmail: string | null
  invoiceAddress: string | null
  details: Partial<EbAssignmentDetails>
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null
}

function pricingModel(value: unknown): EbAssignmentPricingModel {
  return value === 'hourly' ? 'hourly' : 'fixed'
}

function customerType(value: unknown): EbAssignmentCustomerType {
  return value === 'consumer' ? 'consumer' : 'business'
}

function normalizeDetails(
  value: Partial<EbAssignmentDetails> | Record<string, unknown> | null | undefined,
  defaults?: EbAssignmentDetails
): EbAssignmentDetails {
  const source = value ?? {}
  const fallback = defaults ?? {
    schema: 'eb-v1' as const,
    customerType: 'business' as const,
    pricingModel: 'fixed' as const,
    vatIncluded: false,
    contractTerms: 'ABK 09',
    underlyingContract: '',
    paymentTerms: '10 dagar från fakturadatum',
    travelIncluded: true,
    travelTerms: '',
    assistantHourlyRate: null,
    budgetAmount: null,
    expenseMarkupPercent: null,
    cancellationTerms: 'Vid avbokning senare än två arbetsdagar före besiktningen debiteras upparbetad tid och bokad tid som inte kan nyttjas för annat uppdrag.',
    basisDocuments: '',
    executionNotes: '',
    scheduleNotes: '',
    insuranceTerms: 'Konsultansvarsförsäkring enligt ABK 09',
    specialTerms: '',
    invoiceReference: '',
    invoicePostalCode: '',
    invoiceCity: '',
  }

  const resolvedCustomerType = customerType(source.customerType ?? fallback.customerType)

  return {
    schema: 'eb-v1',
    customerType: resolvedCustomerType,
    pricingModel: pricingModel(source.pricingModel ?? fallback.pricingModel),
    vatIncluded: resolvedCustomerType === 'consumer',
    contractTerms:
      resolvedCustomerType === 'consumer' ? 'ABK 09 med konsumentanpassningar' : 'ABK 09',
    underlyingContract: text(source.underlyingContract) || fallback.underlyingContract,
    paymentTerms: text(source.paymentTerms) || fallback.paymentTerms,
    travelIncluded:
      typeof source.travelIncluded === 'boolean'
        ? source.travelIncluded
        : fallback.travelIncluded,
    travelTerms: text(source.travelTerms) || fallback.travelTerms,
    assistantHourlyRate: numberOrNull(source.assistantHourlyRate),
    budgetAmount: numberOrNull(source.budgetAmount),
    expenseMarkupPercent: numberOrNull(source.expenseMarkupPercent),
    cancellationTerms: text(source.cancellationTerms) || fallback.cancellationTerms,
    basisDocuments: text(source.basisDocuments) || fallback.basisDocuments,
    executionNotes: text(source.executionNotes) || fallback.executionNotes,
    scheduleNotes: text(source.scheduleNotes) || fallback.scheduleNotes,
    insuranceTerms: text(source.insuranceTerms) || fallback.insuranceTerms,
    specialTerms: text(source.specialTerms) || fallback.specialTerms,
    invoiceReference: text(source.invoiceReference) || fallback.invoiceReference,
    invoicePostalCode: text(source.invoicePostalCode) || fallback.invoicePostalCode,
    invoiceCity: text(source.invoiceCity) || fallback.invoiceCity,
  }
}

function defaultBasis(project: EbProjectListItem) {
  return [
    project.standardAgreement ? `Standardavtal: ${project.standardAgreement}` : null,
    project.contractForm ? `Entreprenadform: ${project.contractForm}` : null,
    project.procurementForm ? `Upphandlingsform: ${project.procurementForm}` : null,
    project.contractDate ? `Kontraktsdatum: ${project.contractDate}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

function defaultUnderlyingContract(project: EbProjectListItem, type: EbAssignmentCustomerType) {
  const value = text(project.standardAgreement)
  const normalized = value.toLowerCase().replace(/\s+/g, '')
  if (type === 'consumer') {
    return normalized.includes('abs18') || normalized.includes('hantverkar') || normalized.includes('hf17')
      ? value
      : ''
  }
  return normalized.includes('ab04') || normalized.includes('abt06') ? value : ''
}

function defaultScope(project: EbProjectListItem, inspection: EbInspectionSummary) {
  const object = project.contractName || project.title
  return `${inspection.variantLabel} av ${object}. Besiktningen omfattar de entreprenaddelar som framgår av kontraktshandlingarna och överenskommet underlag.`
}

function joinAddress(address: string | null, postalCode: string | null, city: string | null) {
  return [address, [postalCode, city].filter(Boolean).join(' ')].filter(Boolean).join(', ')
}

async function getProjectAndInspection(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const project = await getEbProjectById({ orgId: input.orgId, projectId: input.projectId })
  if (!project) throw new Error('EB_PROJECT_NOT_FOUND')
  const inspection = project.inspections.find((item) => item.inspectionId === input.inspectionId)
  if (!inspection) throw new Error('EB_INSPECTION_NOT_FOUND')
  return { project, inspection }
}

async function getCurrentLink(orgId: string, inspectionId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('eb_assignment_confirmations')
    .select('id,org_id,inspection_id,assignment_id,version_no,is_current,replaced_at')
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .eq('is_current', true)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte hämta uppdragsbekräftelsen.')
  return (data ?? null) as ConfirmationLinkRow | null
}

function buildDefaultForm(
  project: EbProjectListItem,
  inspection: EbInspectionSummary
): EbAssignmentConfirmationForm {
  const invoiceAddress = joinAddress(
    project.invoiceAddress,
    project.invoicePostalCode,
    project.invoiceCity
  )
  const details = normalizeDetails({
    customerType: project.clientOrgNo ? 'business' : 'consumer',
    vatIncluded: !project.clientOrgNo,
    underlyingContract: defaultUnderlyingContract(
      project,
      project.clientOrgNo ? 'business' : 'consumer'
    ),
    basisDocuments: defaultBasis(project),
    invoiceReference: project.invoiceReference ?? '',
    invoicePostalCode: project.invoicePostalCode ?? '',
    invoiceCity: project.invoiceCity ?? '',
  })

  return {
    assignmentId: null,
    versionNo: 1,
    status: 'not_created',
    acceptedAt: null,
    lastSentAt: null,
    customerName: project.clientName ?? '',
    customerEmail: project.clientEmail ?? '',
    customerPhone: project.clientPhone ?? '',
    customerAddress: project.clientAddress ?? project.address ?? '',
    customerPostalCode: project.clientPostalCode ?? project.postalCode ?? '',
    customerCity: project.clientCity ?? project.city ?? '',
    propertyAddress: project.address ?? '',
    propertyPostalCode: project.postalCode ?? '',
    propertyCity: project.city ?? '',
    propertyMunicipality: project.municipality ?? '',
    propertyDesignation: project.propertyDesignation ?? '',
    propertyOwnerName: project.propertyOwnerName ?? '',
    scopeDescription: defaultScope(project, inspection),
    preferredDate: inspection.date ?? '',
    preferredTime: inspection.inspectionTime?.slice(0, 5) ?? '',
    priceAmount: null,
    currency: 'SEK',
    invoiceName: project.invoiceName ?? project.clientName ?? '',
    invoiceOrgNo: project.invoiceOrgNo ?? project.clientOrgNo ?? '',
    invoiceEmail: project.invoiceEmail ?? project.clientEmail ?? '',
    invoiceAddress,
    details,
  }
}

function formFromAssignment(
  link: ConfirmationLinkRow,
  assignment: AssignmentDetails,
  defaults: EbAssignmentConfirmationForm
): EbAssignmentConfirmationForm {
  return {
    assignmentId: assignment.id,
    versionNo: link.version_no,
    status: assignment.status,
    acceptedAt: assignment.accepted_at,
    lastSentAt: assignment.last_sent_at,
    customerName: assignment.customer_name ?? '',
    customerEmail: assignment.customer_email ?? '',
    customerPhone: assignment.customer_phone ?? '',
    customerAddress: assignment.customer_address ?? '',
    customerPostalCode: assignment.customer_postal_code ?? '',
    customerCity: assignment.customer_city ?? '',
    propertyAddress: assignment.property_address ?? '',
    propertyPostalCode: assignment.property_postal_code ?? '',
    propertyCity: assignment.property_city ?? '',
    propertyMunicipality: assignment.property_municipality ?? '',
    propertyDesignation: assignment.cadastral_id ?? '',
    propertyOwnerName: assignment.property_owner_name ?? '',
    scopeDescription: assignment.scope_description ?? '',
    preferredDate: assignment.preferred_date ?? '',
    preferredTime: assignment.preferred_time?.slice(0, 5) ?? '',
    priceAmount: assignment.price_amount,
    currency: assignment.currency || 'SEK',
    invoiceName: assignment.invoice_name ?? '',
    invoiceOrgNo: assignment.personal_identity_number ?? '',
    invoiceEmail: assignment.invoice_email ?? '',
    invoiceAddress: assignment.invoice_address ?? '',
    details: normalizeDetails(assignment.assignment_details, defaults.details),
  }
}

export async function getEbAssignmentConfirmation(input: {
  orgId: string
  projectId: string
  inspectionId: string
}) {
  const { project, inspection } = await getProjectAndInspection(input)
  const defaults = buildDefaultForm(project, inspection)
  const link = await getCurrentLink(input.orgId, input.inspectionId)
  if (!link) return defaults
  const assignment = await getAssignmentById(input.orgId, link.assignment_id)
  if (!assignment || assignment.assignment_type !== 'EB') {
    throw new Error('EB_ASSIGNMENT_NOT_FOUND')
  }
  return formFromAssignment(link, assignment, defaults)
}

function toSummary(
  link: Pick<ConfirmationLinkRow, 'assignment_id' | 'inspection_id' | 'version_no'>,
  assignment: AssignmentSummaryRow
): EbAssignmentConfirmationSummary {
  return {
    assignmentId: link.assignment_id,
    inspectionId: link.inspection_id,
    versionNo: link.version_no,
    status: assignment.status,
    acceptedAt: assignment.accepted_at,
    lastSentAt: assignment.last_sent_at,
    customerEmail: assignment.customer_email,
    priceAmount: assignment.price_amount,
    currency: assignment.currency || 'SEK',
    pricingModel: pricingModel(assignment.assignment_details?.pricingModel),
  }
}

export async function listEbAssignmentConfirmationSummaries(input: {
  orgId: string
  inspectionIds: string[]
}) {
  if (input.inspectionIds.length === 0) return []
  const admin = createSupabaseAdminClient()
  const { data: linkData, error: linkError } = await admin
    .from('eb_assignment_confirmations')
    .select('id,org_id,inspection_id,assignment_id,version_no,is_current,replaced_at')
    .eq('org_id', input.orgId)
    .eq('is_current', true)
    .in('inspection_id', input.inspectionIds)

  if (linkError) throw new Error(linkError.message ?? 'Kunde inte hämta uppdragsbekräftelser.')
  const links = (linkData ?? []) as ConfirmationLinkRow[]
  if (links.length === 0) return []

  const { data: assignmentData, error: assignmentError } = await admin
    .from('assignments')
    .select('id,status,accepted_at,last_sent_at,customer_email,price_amount,currency,assignment_details')
    .eq('org_id', input.orgId)
    .in('id', links.map((link) => link.assignment_id))

  if (assignmentError) {
    throw new Error(assignmentError.message ?? 'Kunde inte hämta uppdragsbekräftelser.')
  }
  const assignmentsById = new Map(
    ((assignmentData ?? []) as AssignmentSummaryRow[]).map((assignment) => [assignment.id, assignment])
  )
  return links.flatMap((link) => {
    const assignment = assignmentsById.get(link.assignment_id)
    return assignment ? [toSummary(link, assignment)] : []
  })
}

export async function hasAcceptedEbAssignmentConfirmation(input: {
  orgId: string
  inspectionId: string
}) {
  const summaries = await listEbAssignmentConfirmationSummaries({
    orgId: input.orgId,
    inspectionIds: [input.inspectionId],
  })
  return Boolean(summaries[0]?.acceptedAt)
}

async function createDraft(
  input: SaveEbAssignmentConfirmationInput,
  project: EbProjectListItem
) {
  const admin = createSupabaseAdminClient()
  const details = normalizeDetails(input.details)
  const assignment = await createAssignment({
    orgId: input.orgId,
    createdBy: input.requestedByUserId,
    responsibleProfileId: project.ownerProfileId || input.requestedByUserId,
    assignmentType: 'EB',
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerAddress: input.customerAddress,
    customerPostalCode: input.customerPostalCode,
    customerCity: input.customerCity,
    preliminaryAddress: input.propertyAddress,
    propertyAddress: input.propertyAddress,
    propertyPostalCode: input.propertyPostalCode,
    propertyCity: input.propertyCity,
    propertyMunicipality: input.propertyMunicipality,
    propertyOwnerName: input.propertyOwnerName,
    cadastralId: input.propertyDesignation,
    scopeDescription: input.scopeDescription,
    ordererRole:
      details.customerType === 'consumer'
        ? 'Entreprenadbesiktning - Konsument'
        : 'Entreprenadbesiktning - Företag',
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
    priceAmount: input.priceAmount,
    currency: input.currency || 'SEK',
    invoiceEmail: input.invoiceEmail,
    invoiceName: input.invoiceName,
    invoiceAddress: input.invoiceAddress,
    personalIdentityNumber: input.invoiceOrgNo,
    assignmentDetails: details,
  })

  const { error } = await admin.from('eb_assignment_confirmations').insert({
    org_id: input.orgId,
    inspection_id: input.inspectionId,
    assignment_id: assignment.id,
    version_no: 1,
    is_current: true,
    created_by: input.requestedByUserId,
  })
  if (error) {
    await admin.from('assignments').delete().eq('org_id', input.orgId).eq('id', assignment.id)
    throw new Error(error.message ?? 'Kunde inte koppla uppdragsbekräftelsen till besiktningen.')
  }
  return assignment
}

export async function saveEbAssignmentConfirmation(input: SaveEbAssignmentConfirmationInput) {
  const { project } = await getProjectAndInspection(input)
  const currentLink = await getCurrentLink(input.orgId, input.inspectionId)
  let assignment: AssignmentDetails

  if (!currentLink) {
    assignment = await createDraft(input, project)
  } else {
    const current = await getAssignmentById(input.orgId, currentLink.assignment_id)
    if (!current || current.assignment_type !== 'EB') throw new Error('EB_ASSIGNMENT_NOT_FOUND')
    if (current.status !== 'draft') throw new Error('EB_ASSIGNMENT_LOCKED')

    assignment = await updateAssignmentById({
      orgId: input.orgId,
      assignmentId: current.id,
      updatedBy: input.requestedByUserId,
      patch: {
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        customer_address: input.customerAddress,
        customer_postal_code: input.customerPostalCode,
        customer_city: input.customerCity,
        preliminary_address: input.propertyAddress,
        property_address: input.propertyAddress,
        property_postal_code: input.propertyPostalCode,
        property_city: input.propertyCity,
        property_municipality: input.propertyMunicipality,
        property_owner_name: input.propertyOwnerName,
        cadastral_id: input.propertyDesignation,
        orderer_role:
          customerType(input.details.customerType) === 'consumer'
            ? 'Entreprenadbesiktning - Konsument'
            : 'Entreprenadbesiktning - Företag',
        scope_description: input.scopeDescription,
        preferred_date: input.preferredDate,
        preferred_time: input.preferredTime,
        price_amount: input.priceAmount,
        currency: input.currency || 'SEK',
        invoice_name: input.invoiceName,
        invoice_address: input.invoiceAddress,
        invoice_email: input.invoiceEmail,
        personal_identity_number: input.invoiceOrgNo,
        assignment_details: normalizeDetails(input.details),
      },
    })
  }

  const link = (await getCurrentLink(input.orgId, input.inspectionId))!
  const defaults = buildDefaultForm(project, project.inspections.find((item) => item.inspectionId === input.inspectionId)!)
  return formFromAssignment(link, assignment, defaults)
}

export async function sendEbAssignmentConfirmation(input: SaveEbAssignmentConfirmationInput & {
  orgName: string | null
}) {
  const form = await saveEbAssignmentConfirmation(input)
  if (!form.assignmentId) throw new Error('EB_ASSIGNMENT_NOT_FOUND')
  if (!form.customerEmail) throw new Error('CUSTOMER_EMAIL_REQUIRED')
  if (!form.propertyDesignation) throw new Error('PROPERTY_DESIGNATION_REQUIRED')
  if (!form.preferredDate || !form.preferredTime) throw new Error('INSPECTION_SCHEDULE_REQUIRED')
  if (!form.scopeDescription) throw new Error('SCOPE_REQUIRED')
  if (form.priceAmount === null) throw new Error('PRICE_REQUIRED')
  if (!form.details.underlyingContract) throw new Error('UNDERLYING_CONTRACT_REQUIRED')

  const assignment = await getAssignmentById(input.orgId, form.assignmentId)
  if (!assignment) throw new Error('EB_ASSIGNMENT_NOT_FOUND')
  const responsible = await getProfileContact(assignment.responsible_profile_id)
  const result = await sendAssignmentConfirmation({
    assignment,
    orgName: input.orgName,
    requestedByUserId: input.requestedByUserId,
    responsibleEmail: responsible?.email ?? null,
    baseUrl: buildBaseUrl(),
  })
  const updated = await getEbAssignmentConfirmation(input)
  return { confirmation: updated, ...result }
}

export async function reissueEbAssignmentConfirmation(input: {
  orgId: string
  requestedByUserId: string
  projectId: string
  inspectionId: string
}) {
  await getProjectAndInspection(input)
  const admin = createSupabaseAdminClient()
  const currentLink = await getCurrentLink(input.orgId, input.inspectionId)
  if (!currentLink) throw new Error('EB_ASSIGNMENT_NOT_FOUND')
  const source = await getAssignmentById(input.orgId, currentLink.assignment_id)
  if (!source || source.assignment_type !== 'EB') throw new Error('EB_ASSIGNMENT_NOT_FOUND')
  if (source.status !== 'sent' && source.status !== 'ordered' && source.status !== 'booked') {
    throw new Error('EB_ASSIGNMENT_REISSUE_NOT_ALLOWED')
  }

  const draft = await createAssignment({
    orgId: input.orgId,
    createdBy: input.requestedByUserId,
    responsibleProfileId: source.responsible_profile_id,
    assignmentType: 'EB',
    customerEmail: source.customer_email,
    customerName: source.customer_name,
    customerPhone: source.customer_phone,
    customerPostalCode: source.customer_postal_code,
    customerCity: source.customer_city,
    customerAddress: source.customer_address,
    preliminaryAddress: source.preliminary_address,
    scopeDescription: source.scope_description,
    propertyAddress: source.property_address,
    propertyPostalCode: source.property_postal_code,
    propertyCity: source.property_city,
    propertyMunicipality: source.property_municipality,
    propertyOwnerName: source.property_owner_name,
    cadastralId: source.cadastral_id,
    invoiceEmail: source.invoice_email,
    invoiceName: source.invoice_name,
    invoiceAddress: source.invoice_address,
    personalIdentityNumber: source.personal_identity_number,
    ordererRole: source.orderer_role,
    preferredDate: source.preferred_date,
    preferredTime: source.preferred_time,
    priceAmount: source.price_amount,
    currency: source.currency,
    notesInternal: source.notes_internal,
    assignmentDetails: source.assignment_details,
  })
  const replacedAt = new Date().toISOString()
  const { error: replaceError } = await admin
    .from('eb_assignment_confirmations')
    .update({ is_current: false, replaced_at: replacedAt })
    .eq('id', currentLink.id)
    .eq('org_id', input.orgId)
  if (replaceError) {
    await admin.from('assignments').delete().eq('org_id', input.orgId).eq('id', draft.id)
    throw new Error(replaceError.message ?? 'Kunde inte ersätta uppdragsbekräftelsen.')
  }

  const { error: linkError } = await admin.from('eb_assignment_confirmations').insert({
    org_id: input.orgId,
    inspection_id: input.inspectionId,
    assignment_id: draft.id,
    version_no: currentLink.version_no + 1,
    is_current: true,
    created_by: input.requestedByUserId,
  })
  if (linkError) {
    await admin
      .from('eb_assignment_confirmations')
      .update({ is_current: true, replaced_at: null })
      .eq('id', currentLink.id)
      .eq('org_id', input.orgId)
    await admin.from('assignments').delete().eq('org_id', input.orgId).eq('id', draft.id)
    throw new Error(linkError.message ?? 'Kunde inte skapa ny version av uppdragsbekräftelsen.')
  }

  await updateAssignmentById({
    orgId: input.orgId,
    assignmentId: source.id,
    updatedBy: input.requestedByUserId,
    patch: { status: 'cancelled' },
  })

  return getEbAssignmentConfirmation(input)
}

export { AssignmentEmailSendError }
