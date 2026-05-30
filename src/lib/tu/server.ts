import 'server-only'

import { requireModuleAccess } from '@/lib/access/server'
import {
  buildBaseUrl,
  createAssignment,
  getAssignmentById,
  getProfileContact,
  listAssignmentsByOrg,
  requireOrgContext,
  sendAssignmentConfirmation,
  updateAssignmentById,
  type AssignmentDetails,
  type AssignmentListItem,
} from '@/lib/assignments/server'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import { formatCertificationDisplayLines } from '@/lib/certifications/display'
import type { InspectorCertificationListItem } from '@/lib/certifications/profileSummary'
import { getNextInspectionAssignmentNumber } from '@/lib/inspections/assignmentNumber'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export type TuReportSectionKey =
  | 'assignment_parties'
  | 'background_scope'
  | 'assignment_scope'
  | 'construction_description'
  | 'basis_conditions'
  | 'observed_execution'
  | 'technical_assessment'
  | 'time_assessment'
  | 'continued_risk'
  | 'recommended_actions'
  | 'closing_comments'
  | 'signature'

export type TuObjectType = 'villa' | 'apartment'

export type TuReportSection = {
  key: TuReportSectionKey
  title: string
  text: string
}

export type TuReportDraft = {
  sections: TuReportSection[]
}

export type TuAssignmentListItem = AssignmentListItem & {
  assignment_type: 'TU'
}

export type TuPropertySummary = {
  id: string
  name: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null
  client_name: string | null
}

export type TuInspectionSummary = {
  inspectionId: string
  propertyId: string | null
  assignmentId: string | null
  assignmentNumber: string | null
  title: string
  objectType: TuObjectType
  status: string | null
  date: string | null
  inspectionTime: string | null
  customerName: string | null
  customerEmail: string | null
  propertyAddress: string | null
  propertyCity: string | null
  cadastralId: string | null
  brfName: string | null
  apartmentNumber: string | null
  apartmentHolderName: string | null
  scopeDescription: string | null
  reportLockedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type TuInspectorProfileCard = {
  fullName: string | null
  phone: string | null
  email: string | null
  companyName: string | null
  companyOrgNo: string | null
  companyAddress: string | null
  companyPostalCode: string | null
  companyCity: string | null
  avatarUrl: string | null
  logoUrl: string | null
  credentialLines: string[]
}

export type TuInvestigationDetails = TuInspectionSummary & {
  orgId: string
  inspection: {
    id: string
    status: string | null
    date: string | null
    inspection_time: string | null
    assignment_number: string | null
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    customer_address: string | null
    customer_postal_code: string | null
    customer_city: string | null
  }
  property: TuPropertySummary | null
  assignment: AssignmentDetails | null
  inspector: TuInspectorProfileRow | null
  reportDraft: TuReportDraft
  background: string | null
  basis: string | null
  accessibility: string | null
}

export type TuInvestigationImage = {
  id: string
  inspectionId: string
  orgId: string
  sectionKey: 'bank' | 'appendix' | 'cover'
  storageBucket: string
  filePath: string
  publicUrl: string
  caption: string | null
  sortOrder: number
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

type TuDetailRow = {
  inspection_id: string
  org_id: string
  assignment_id: string | null
  property_id: string | null
  title: string | null
  property_object_type: string | null
  scope_description: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
  background: string | null
  basis: string | null
  accessibility: string | null
  report_draft: unknown
  report_draft_updated_at: string | null
  report_locked_at: string | null
  created_by: string | null
  created_at: string | null
  updated_at: string | null
}

type TuInspectorProfileRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  avatar_path: string | null
  avatar_url: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  logo_path: string | null
  logo_url: string | null
  signature_path: string | null
  signature_url: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  certification_items: InspectorCertificationListItem[]
}

type InspectionRow = {
  id: string
  property_id: string | null
  status: string | null
  date: string | null
  inspection_time: string | null
  assignment_number: string | null
  customer_name: string | null
  customer_email: string | null
  customer_phone: string | null
  customer_address: string | null
  customer_postal_code: string | null
  customer_city: string | null
  created_at: string | null
}

type PropertyRow = TuPropertySummary

type TuImageRow = {
  id: string
  inspection_id: string
  org_id: string
  section_key: string | null
  storage_bucket: string | null
  file_path: string
  caption: string | null
  sort_order: number | null
  uploaded_by: string | null
  created_at: string | null
  updated_at: string | null
}

type SupabaseError = {
  message?: string
} | null

type SupabaseResponse<T> = Promise<{ data: T | null; error: SupabaseError }>
type SupabaseListResponse<T> = { data: T[] | null; error: SupabaseError }

type QueryBuilder<T = Record<string, unknown>> = {
  then: <TResult1 = SupabaseListResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseListResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
  select: (columns: string) => QueryBuilder<T>
  insert: (values: unknown) => QueryBuilder<T>
  update: (values: unknown) => QueryBuilder<T>
  delete: () => QueryBuilder<T>
  eq: (column: string, value: unknown) => QueryBuilder<T>
  is: (column: string, value: unknown) => QueryBuilder<T>
  in: (column: string, values: unknown[]) => QueryBuilder<T>
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder<T>
  single: () => SupabaseResponse<T>
  maybeSingle: () => SupabaseResponse<T>
}

type TuSupabaseClient = {
  from: (table: string) => QueryBuilder
}

type TuStorageClient = TuSupabaseClient & {
  storage: {
    from: (bucket: string) => {
      getPublicUrl: (path: string) => { data: { publicUrl: string } }
      remove: (paths: string[]) => Promise<{ error: SupabaseError }>
    }
  }
}

export const TU_REPORT_SECTIONS: Array<Pick<TuReportSection, 'key' | 'title'>> = [
  { key: 'assignment_parties', title: 'Uppdragsgivare och besiktningsman' },
  { key: 'background_scope', title: 'Bakgrund' },
  { key: 'assignment_scope', title: 'Uppdragets omfattning' },
  { key: 'construction_description', title: 'Beskrivning av konstruktionen' },
  { key: 'basis_conditions', title: 'Underlag och besiktningsförutsättningar' },
  { key: 'observed_execution', title: 'Iakttagelser vid platsbesök' },
  { key: 'technical_assessment', title: 'Teknisk bedömning' },
  { key: 'time_assessment', title: 'Tidsmässig bedömning' },
  { key: 'continued_risk', title: 'Bedömning av fortsatt risk' },
  { key: 'recommended_actions', title: 'Rekommenderad fortsatt hantering' },
  { key: 'closing_comments', title: 'Avslutande kommentarer' },
  { key: 'signature', title: 'Signering' },
]

const DEFAULT_TU_SECTION_TEXT: Partial<Record<TuReportSectionKey, string>> = {
  closing_comments:
    'Detta utlåtande baseras på de uppgifter, handlingar och iakttagelser som varit tillgängliga vid utredningstillfället. Bedömningarna avser de förhållanden som kunnat konstateras inom ramen för uppdraget och ska inte ses som en fullständig garanti för dolda fel, framtida skadeutveckling eller förhållanden som inte varit åtkomliga för kontroll.',
}

function cleanText(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized === '' ? null : normalized
}

function normalizeTuObjectType(value: string | null | undefined): TuObjectType {
  return value === 'apartment' ? 'apartment' : 'villa'
}

function resolveTuDetailObjectType(detail: Pick<TuDetailRow, 'property_object_type' | 'brf_name' | 'apartment_number'>): TuObjectType {
  if (normalizeTuObjectType(detail.property_object_type) === 'apartment') return 'apartment'
  if (cleanText(detail.brf_name) || cleanText(detail.apartment_number)) return 'apartment'
  return 'villa'
}

function inferTuObjectType(input: {
  objectType?: string | null
  brfName?: string | null
  apartmentNumber?: string | null
  assignment?: AssignmentDetails | null
}): TuObjectType {
  if (input.objectType === 'apartment') return 'apartment'
  if (input.objectType === 'villa') return 'villa'
  if (cleanText(input.brfName) || cleanText(input.apartmentNumber)) return 'apartment'
  const role = input.assignment?.orderer_role?.toLowerCase() ?? ''
  if (role.includes('lägenhet') || role.includes('lagenhet') || role.includes('apartment')) {
    return 'apartment'
  }
  if (input.assignment?.brf_name || input.assignment?.apartment_number) return 'apartment'
  return 'villa'
}

function toPropertyName(address: string | null, fallback: string) {
  return cleanText(address) ?? fallback
}

export function createTuReportDraft(seed?: Partial<Record<TuReportSectionKey, string>>): TuReportDraft {
  return {
    sections: TU_REPORT_SECTIONS.map((section) => ({
      key: section.key,
      title: section.title,
      text: seed?.[section.key] ?? DEFAULT_TU_SECTION_TEXT[section.key] ?? '',
    })),
  }
}

export function normalizeTuReportDraft(value: unknown): TuReportDraft {
  if (!value || typeof value !== 'object' || !('sections' in value)) return createTuReportDraft()

  const rawSections = Array.isArray((value as { sections?: unknown }).sections)
    ? ((value as { sections: unknown[] }).sections)
    : []

  const byKey = new Map<string, { title?: unknown; text?: unknown }>()
  for (const section of rawSections) {
    if (!section || typeof section !== 'object') continue
    const key = (section as { key?: unknown }).key
    if (typeof key !== 'string') continue
    byKey.set(key, {
      title: (section as { title?: unknown }).title,
      text: (section as { text?: unknown }).text,
    })
  }

  return {
    sections: TU_REPORT_SECTIONS.map((section) => {
      const raw = byKey.get(section.key)
      const legacyText =
        section.key === 'construction_description' && typeof byKey.get('accessibility')?.text === 'string'
          ? (byKey.get('accessibility')?.text as string)
          : ''
      return {
        key: section.key,
        title: section.title,
        text:
          typeof raw?.text === 'string'
            ? raw.text
            : legacyText || DEFAULT_TU_SECTION_TEXT[section.key] || '',
      }
    }),
  }
}

function extractTuInspectorBlock(text: string) {
  const match = text.match(/(?:^|\r?\n\r?\n)Besiktningsman\r?\n([\s\S]*)$/)
  return match?.[1]?.trim() ?? null
}

function upsertAssignmentPartiesSectionText(
  draft: TuReportDraft,
  defaultText: string | null
): TuReportDraft {
  const normalizedText = cleanText(defaultText)
  if (!normalizedText) return draft

  const inspectorBlock = extractTuInspectorBlock(normalizedText)
  const hasInspectorText = Boolean(inspectorBlock && inspectorBlock !== 'Ej angivet.')
  const missingInspectorPattern = /Besiktningsman\r?\nEj angivet\.?/m

  return {
    sections: draft.sections.map((section) => {
      if (section.key !== 'assignment_parties') return section

      const currentText = section.text.trim()
      if (!currentText) return { ...section, text: normalizedText }

      if (hasInspectorText && missingInspectorPattern.test(currentText)) {
        return {
          ...section,
          text: currentText.replace(missingInspectorPattern, `Besiktningsman\n${inspectorBlock}`),
        }
      }

      return section
    }),
  }
}

function upsertAssignmentScopeSectionText(draft: TuReportDraft, scopeDescription: string | null): TuReportDraft {
  const normalizedText = cleanText(scopeDescription)
  if (!normalizedText) return draft

  return {
    sections: draft.sections.map((section) => {
      if (section.key !== 'assignment_scope') return section
      return section.text.trim() ? section : { ...section, text: normalizedText }
    }),
  }
}

function joinLine(label: string, value: string | null | undefined) {
  const normalized = cleanText(value)
  return normalized ? `${label}: ${normalized}` : null
}

function joinAddress(parts: Array<string | null | undefined>) {
  return cleanText(parts.filter(Boolean).join(', '))
}

function resolveTuPublicMediaUrl(path: string | null | undefined) {
  const trimmed = cleanText(path)
  if (!trimmed) return null
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (trimmed.startsWith('/storage/')) return base ? `${base}${trimmed}` : trimmed
  if (trimmed.startsWith('storage/')) return base ? `${base}/${trimmed}` : `/${trimmed}`
  if (trimmed.startsWith('/')) return trimmed

  return createSupabaseAdminClient().storage.from('property-media').getPublicUrl(trimmed).data.publicUrl
}

function isMissingSignaturePathError(error: SupabaseError) {
  const message = (error?.message ?? '').toLowerCase()
  return message.includes('signature_path') || message.includes('42703')
}

function buildTuAssignmentPartiesText(input: {
  assignment: AssignmentDetails | null
  inspection: InspectionRow | null
  inspector: TuInspectorProfileRow | null
}) {
  const assignment = input.assignment
  const inspection = input.inspection
  const customerAddress = joinAddress([
    assignment?.customer_address ?? inspection?.customer_address,
    joinAddress([
      assignment?.customer_postal_code ?? inspection?.customer_postal_code,
      assignment?.customer_city ?? inspection?.customer_city,
    ]),
  ])
  const inspectorAddress = joinAddress([
    input.inspector?.company_address,
    joinAddress([input.inspector?.company_postal_code, input.inspector?.company_city]),
  ])

  const customerLines = [
    joinLine('Namn', assignment?.customer_name ?? inspection?.customer_name),
    joinLine('Roll/beställartyp', assignment?.orderer_role),
    joinLine('Person-/org.nr', assignment?.personal_identity_number),
    joinLine('Adress', customerAddress),
    joinLine('Telefon', assignment?.customer_phone ?? inspection?.customer_phone),
    joinLine('E-post', assignment?.customer_email ?? inspection?.customer_email),
    joinLine('Fakturanamn', assignment?.invoice_name),
    joinLine('Fakturaadress', assignment?.invoice_address),
    joinLine('Fastighetsägare', assignment?.property_owner_name),
  ].filter(Boolean)

  const inspectorLines = [
    joinLine('Namn', input.inspector?.full_name),
    joinLine('Företag', input.inspector?.company_name),
    joinLine('Org.nr', input.inspector?.company_orgno),
    joinLine('Adress', inspectorAddress),
    joinLine('Telefon', input.inspector?.phone),
    joinLine('E-post', input.inspector?.email),
    joinLine('SBR', input.inspector?.sbr_group),
    joinLine('Status', input.inspector?.sbr_status),
    joinLine('Medlemsnummer', input.inspector?.membership_number),
    joinLine('Certifieringsnummer', input.inspector?.certification_number),
  ].filter(Boolean)

  return [
    'Uppdragsgivare',
    ...(customerLines.length > 0 ? customerLines : ['Ej angivet.']),
    '',
    'Besiktningsman',
    ...(inspectorLines.length > 0 ? inspectorLines : ['Ej angivet.']),
  ].join('\n')
}

async function getTuInspectorProfile(input: {
  profileId: string | null | undefined
  orgId: string
}) {
  const normalizedProfileId = cleanText(input.profileId)
  if (!normalizedProfileId) return null

  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  let signatureColumnAvailable = true
  let profileResult = await admin
    .from('profiles')
    .select(
      'id,full_name,email,phone,avatar_path,company_name,company_orgno,company_address,company_postal_code,company_city,logo_path,signature_path'
    )
    .eq('id', normalizedProfileId)
    .maybeSingle()

  if (profileResult.error && isMissingSignaturePathError(profileResult.error)) {
    signatureColumnAvailable = false
    profileResult = await admin
      .from('profiles')
      .select(
        'id,full_name,email,phone,avatar_path,company_name,company_orgno,company_address,company_postal_code,company_city,logo_path'
      )
      .eq('id', normalizedProfileId)
      .maybeSingle()
  }

  if (profileResult.error || !profileResult.data) return null
  const rawProfile = profileResult.data as Omit<
    TuInspectorProfileRow,
    | 'avatar_url'
    | 'logo_url'
    | 'signature_url'
    | 'sbr_group'
    | 'sbr_status'
    | 'membership_number'
    | 'certification_number'
    | 'certification_items'
  >
  const profile = {
    ...rawProfile,
    signature_path: signatureColumnAvailable ? rawProfile.signature_path ?? null : null,
  }
  const { summary } = await resolveInspectorCertificationSummary(admin, {
    profileId: normalizedProfileId,
    orgId: input.orgId,
  })

  return {
    ...profile,
    avatar_url: resolveTuPublicMediaUrl(profile.avatar_path),
    logo_url: resolveTuPublicMediaUrl(profile.logo_path),
    signature_url: resolveTuPublicMediaUrl(profile.signature_path),
    sbr_group: summary.sbr_group,
    sbr_status: summary.sbr_status,
    membership_number: summary.membership_number,
    certification_number: summary.certification_number,
    certification_items: summary.all_selected_items,
  } satisfies TuInspectorProfileRow
}

export async function getTuInspectorProfileCard(input: {
  profileId: string | null | undefined
  orgId: string
}): Promise<TuInspectorProfileCard | null> {
  const profile = await getTuInspectorProfile(input)
  if (!profile) return null

  const fallbackCredentialLines = [
    profile.sbr_group,
    profile.sbr_status,
    profile.membership_number ? `Medlemsnummer: ${profile.membership_number}` : null,
    profile.certification_number ? `Certifieringsnummer: ${profile.certification_number}` : null,
  ].filter((line): line is string => Boolean(line))
  const credentialLines = formatCertificationDisplayLines(profile.certification_items).slice(0, 4)

  return {
    fullName: profile.full_name,
    phone: profile.phone,
    email: profile.email,
    companyName: profile.company_name,
    companyOrgNo: profile.company_orgno,
    companyAddress: profile.company_address,
    companyPostalCode: profile.company_postal_code,
    companyCity: profile.company_city,
    avatarUrl: profile.avatar_url,
    logoUrl: profile.logo_url,
    credentialLines: credentialLines.length > 0 ? credentialLines : fallbackCredentialLines,
  }
}

export async function requireTuContext() {
  await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'technical_investigations' })
  return requireOrgContext()
}

export async function listTuAssignments(orgId: string): Promise<TuAssignmentListItem[]> {
  const assignments = await listAssignmentsByOrg(orgId)
  return assignments.filter((assignment): assignment is TuAssignmentListItem => assignment.assignment_type === 'TU')
}

export async function getTuAssignmentById(orgId: string, assignmentId: string) {
  const assignment = await getAssignmentById(orgId, assignmentId)
  if (!assignment) return null
  if (assignment.assignment_type !== 'TU') throw new Error('TU_ASSIGNMENT_NOT_FOUND')
  return assignment
}

export async function createTuAssignmentDraft(input: {
  orgId: string
  createdBy: string
  responsibleProfileId: string
  customerEmail: string
  customerName?: string | null
  customerPhone?: string | null
  customerPostalCode?: string | null
  customerCity?: string | null
  customerAddress?: string | null
  propertyAddress?: string | null
  propertyPostalCode?: string | null
  propertyCity?: string | null
  propertyMunicipality?: string | null
  propertyOwnerName?: string | null
  cadastralId?: string | null
  brfName?: string | null
  apartmentNumber?: string | null
  apartmentHolderName?: string | null
  objectType?: TuObjectType | null
  scopeDescription?: string | null
  preferredDate?: string | null
  preferredTime?: string | null
  priceAmount?: number | null
  notesInternal?: string | null
}) {
  const objectType = inferTuObjectType({
    objectType: input.objectType,
    brfName: input.brfName,
    apartmentNumber: input.apartmentNumber,
  })

  return createAssignment({
    orgId: input.orgId,
    createdBy: input.createdBy,
    responsibleProfileId: input.responsibleProfileId,
    assignmentType: 'TU',
    customerEmail: input.customerEmail,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerPostalCode: input.customerPostalCode,
    customerCity: input.customerCity,
    customerAddress: input.customerAddress,
    preliminaryAddress: input.propertyAddress,
    propertyAddress: input.propertyAddress,
    propertyPostalCode: input.propertyPostalCode,
    propertyCity: input.propertyCity,
    propertyMunicipality: input.propertyMunicipality,
    propertyOwnerName: input.propertyOwnerName,
    cadastralId: objectType === 'villa' ? input.cadastralId : null,
    brfName: objectType === 'apartment' ? input.brfName : null,
    apartmentNumber: objectType === 'apartment' ? input.apartmentNumber : null,
    apartmentHolderName: objectType === 'apartment' ? input.apartmentHolderName : null,
    scopeDescription: input.scopeDescription,
    ordererRole: objectType === 'apartment' ? 'Teknisk utredning - Lägenhet' : 'Teknisk utredning - Villa',
    preferredDate: input.preferredDate,
    preferredTime: input.preferredTime,
    priceAmount: input.priceAmount,
    currency: 'SEK',
    notesInternal: input.notesInternal,
  })
}

export async function sendTuAssignmentConfirmation(input: {
  assignment: AssignmentDetails
  orgName: string | null
  requestedByUserId: string
}) {
  if (input.assignment.assignment_type !== 'TU') throw new Error('TU_ASSIGNMENT_NOT_FOUND')
  const responsibleProfile = await getProfileContact(input.assignment.responsible_profile_id)
  return sendAssignmentConfirmation({
    assignment: input.assignment,
    orgName: input.orgName,
    requestedByUserId: input.requestedByUserId,
    responsibleEmail: responsibleProfile?.email ?? null,
    baseUrl: buildBaseUrl(),
  })
}

async function createPropertyForTu(input: {
  ownerProfileId: string
  titleFallback: string
  objectType?: TuObjectType | null
  address?: string | null
  postalCode?: string | null
  city?: string | null
  municipality?: string | null
  cadastralId?: string | null
  ownerName?: string | null
  clientName?: string | null
}) {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const { data, error } = await admin
    .from('properties')
    .insert({
      owner: input.ownerProfileId,
      name: toPropertyName(input.address ?? null, input.titleFallback),
      status: 'Utkast',
      address: cleanText(input.address),
      postal_code: cleanText(input.postalCode),
      city: cleanText(input.city),
      municipality: cleanText(input.municipality ?? input.city),
      cadastral_id: normalizeTuObjectType(input.objectType) === 'villa' ? cleanText(input.cadastralId) : null,
      owner_name: cleanText(input.ownerName ?? input.clientName),
      client_name: cleanText(input.clientName),
    })
    .select('id,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa fastighet för TU.')
  return data as PropertyRow
}

async function createInspectionForTu(input: {
  propertyId: string
  status?: string | null
  date?: string | null
  inspectionTime?: string | null
  scopeDescription?: string | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerPostalCode?: string | null
  customerCity?: string | null
}) {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const contactParts = [input.customerPhone, input.customerEmail].filter(Boolean)
  const inspectionDate = cleanText(input.date)
  let assignmentNumber: string | null = null

  if (inspectionDate) {
    const { data: assignmentNumberRows, error: assignmentNumberError } = await admin
      .from('inspections')
      .select('assignment_number')
      .eq('date', inspectionDate)
      .eq('inspection_family', 'TU')

    if (assignmentNumberError) {
      throw new Error(assignmentNumberError.message ?? 'Kunde inte generera arbetsnummer för TU.')
    }

    assignmentNumber = getNextInspectionAssignmentNumber(inspectionDate, assignmentNumberRows ?? [])
  }

  const { data, error } = await admin
    .from('inspections')
    .insert({
      property_id: input.propertyId,
      type: 'TU',
      inspection_family: 'TU',
      inspection_variant: 'TU',
      status: input.status ?? 'draft',
      inspection_side: null,
      date: inspectionDate,
      inspection_time: cleanText(input.inspectionTime),
      assignment_number: assignmentNumber,
      scope: cleanText(input.scopeDescription),
      client_name: cleanText(input.customerName),
      client_contact: contactParts.length > 0 ? contactParts.join(' | ') : null,
      customer_name: cleanText(input.customerName),
      customer_email: cleanText(input.customerEmail),
      customer_phone: cleanText(input.customerPhone),
      customer_address: cleanText(input.customerAddress),
      customer_postal_code: cleanText(input.customerPostalCode),
      customer_city: cleanText(input.customerCity),
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa TU-utredning.')
  return data as { id: string }
}

async function createTuDetail(input: {
  inspectionId: string
  orgId: string
  assignmentId?: string | null
  propertyId: string
  title?: string | null
  objectType?: TuObjectType | null
  scopeDescription?: string | null
  brfName?: string | null
  apartmentNumber?: string | null
  apartmentHolderName?: string | null
  createdBy: string
  reportDraft?: TuReportDraft
}) {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const objectType = normalizeTuObjectType(input.objectType)
  const { data, error } = await admin
    .from('technical_investigation_details')
    .insert({
      inspection_id: input.inspectionId,
      org_id: input.orgId,
      assignment_id: input.assignmentId ?? null,
      property_id: input.propertyId,
      title: cleanText(input.title) ?? 'Teknisk utredning',
      property_object_type: objectType,
      scope_description: cleanText(input.scopeDescription),
      brf_name: objectType === 'apartment' ? cleanText(input.brfName) : null,
      apartment_number: objectType === 'apartment' ? cleanText(input.apartmentNumber) : null,
      apartment_holder_name: objectType === 'apartment' ? cleanText(input.apartmentHolderName) : null,
      background: cleanText(input.scopeDescription),
      report_draft: input.reportDraft ?? createTuReportDraft({ assignment_scope: input.scopeDescription ?? '' }),
      report_draft_updated_at: new Date().toISOString(),
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select('inspection_id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa TU-underlag.')
  return data as { inspection_id: string }
}

export async function createScratchTuInvestigation(input: {
  orgId: string
  createdBy: string
  responsibleProfileId?: string | null
  title?: string | null
  scopeDescription?: string | null
  propertyAddress?: string | null
  propertyPostalCode?: string | null
  propertyCity?: string | null
  propertyMunicipality?: string | null
  propertyOwnerName?: string | null
  cadastralId?: string | null
  brfName?: string | null
  apartmentNumber?: string | null
  apartmentHolderName?: string | null
  objectType?: TuObjectType | null
  customerName?: string | null
  customerEmail?: string | null
  customerPhone?: string | null
  customerAddress?: string | null
  customerPostalCode?: string | null
  customerCity?: string | null
  date?: string | null
  time?: string | null
}) {
  const ownerProfileId = cleanText(input.responsibleProfileId) ?? input.createdBy
  const title = cleanText(input.title) ?? 'Teknisk utredning'
  const objectType = inferTuObjectType({
    objectType: input.objectType,
    brfName: input.brfName,
    apartmentNumber: input.apartmentNumber,
  })
  const property = await createPropertyForTu({
    ownerProfileId,
    titleFallback: title,
    objectType,
    address: input.propertyAddress,
    postalCode: input.propertyPostalCode,
    city: input.propertyCity,
    municipality: input.propertyMunicipality,
    cadastralId: objectType === 'villa' ? input.cadastralId : null,
    ownerName: input.propertyOwnerName,
    clientName: input.customerName,
  })

  let createdInspectionId: string | null = null
  try {
    const inspection = await createInspectionForTu({
      propertyId: property.id,
      date: input.date,
      inspectionTime: input.time,
      scopeDescription: input.scopeDescription,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone,
      customerAddress: input.customerAddress,
      customerPostalCode: input.customerPostalCode,
      customerCity: input.customerCity,
    })
    createdInspectionId = inspection.id

    await createTuDetail({
      inspectionId: inspection.id,
      orgId: input.orgId,
      propertyId: property.id,
      title,
      objectType,
      scopeDescription: input.scopeDescription,
      brfName: input.brfName,
      apartmentNumber: input.apartmentNumber,
      apartmentHolderName: input.apartmentHolderName,
      createdBy: input.createdBy,
    })

    return { propertyId: property.id, inspectionId: inspection.id }
  } catch (error) {
    const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
    if (createdInspectionId) {
      await admin.from('inspections').delete().eq('id', createdInspectionId)
    }
    await admin.from('properties').delete().eq('id', property.id)
    throw error
  }
}

export async function convertTuAssignmentToInvestigation(input: {
  orgId: string
  assignmentId: string
  requestedByUserId: string
}) {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const assignment = await getTuAssignmentById(input.orgId, input.assignmentId)
  if (!assignment) throw new Error('TU_ASSIGNMENT_NOT_FOUND')

  if (assignment.inspection_id) {
    if (!assignment.property_id) throw new Error('TU_ASSIGNMENT_CONVERTED_WITHOUT_PROPERTY')
    return { propertyId: assignment.property_id, inspectionId: assignment.inspection_id }
  }

  if (assignment.status !== 'ordered') {
    throw new Error('TU_ASSIGNMENT_NOT_ACCEPTED')
  }

  const objectType = inferTuObjectType({
    assignment,
    brfName: assignment.brf_name,
    apartmentNumber: assignment.apartment_number,
  })
  const property = await createPropertyForTu({
    ownerProfileId: assignment.responsible_profile_id ?? input.requestedByUserId,
    titleFallback: 'Teknisk utredning',
    objectType,
    address: assignment.property_address ?? assignment.preliminary_address,
    postalCode: assignment.property_postal_code,
    city: assignment.property_city,
    municipality: assignment.property_municipality,
    cadastralId: objectType === 'villa' ? assignment.cadastral_id : null,
    ownerName: assignment.property_owner_name,
    clientName: assignment.customer_name,
  })

  let createdInspectionId: string | null = null
  try {
    const inspection = await createInspectionForTu({
      propertyId: property.id,
      date: assignment.preferred_date,
      inspectionTime: assignment.preferred_time,
      scopeDescription: assignment.scope_description,
      customerName: assignment.customer_name,
      customerEmail: assignment.customer_email,
      customerPhone: assignment.customer_phone,
      customerAddress: assignment.customer_address,
      customerPostalCode: assignment.customer_postal_code,
      customerCity: assignment.customer_city,
    })
    createdInspectionId = inspection.id

    await createTuDetail({
      inspectionId: inspection.id,
      orgId: input.orgId,
      assignmentId: assignment.id,
      propertyId: property.id,
      title: 'Teknisk utredning',
      objectType,
      scopeDescription: assignment.scope_description,
      brfName: assignment.brf_name,
      apartmentNumber: assignment.apartment_number,
      apartmentHolderName: assignment.apartment_holder_name,
      createdBy: input.requestedByUserId,
    })

    await updateAssignmentById({
      orgId: input.orgId,
      assignmentId: assignment.id,
      updatedBy: input.requestedByUserId,
      patch: {
        status: 'completed',
        property_id: property.id,
        inspection_id: inspection.id,
        converted_at: new Date().toISOString(),
      } as Parameters<typeof updateAssignmentById>[0]['patch'] & Record<string, unknown>,
    })

    return { propertyId: property.id, inspectionId: inspection.id }
  } catch (error) {
    if (createdInspectionId) {
      await admin.from('inspections').delete().eq('id', createdInspectionId)
    }
    await admin.from('properties').delete().eq('id', property.id)
    throw error
  }
}

function buildSummary(detail: TuDetailRow, inspection?: InspectionRow | null, property?: PropertyRow | null): TuInspectionSummary {
  const objectType = resolveTuDetailObjectType(detail)
  return {
    inspectionId: detail.inspection_id,
    propertyId: detail.property_id ?? inspection?.property_id ?? null,
    assignmentId: detail.assignment_id,
    assignmentNumber: inspection?.assignment_number ?? null,
    title: detail.title ?? 'Teknisk utredning',
    objectType,
    status: inspection?.status ?? null,
    date: inspection?.date ?? null,
    inspectionTime: inspection?.inspection_time ?? null,
    customerName: inspection?.customer_name ?? null,
    customerEmail: inspection?.customer_email ?? null,
    propertyAddress: property?.address ?? null,
    propertyCity: property?.city ?? null,
    cadastralId: property?.cadastral_id ?? null,
    brfName: detail.brf_name,
    apartmentNumber: detail.apartment_number,
    apartmentHolderName: detail.apartment_holder_name,
    scopeDescription: detail.scope_description,
    reportLockedAt: detail.report_locked_at,
    createdAt: detail.created_at,
    updatedAt: detail.updated_at,
  }
}

async function ensureTuInspectionAssignmentNumber(
  admin: TuSupabaseClient,
  inspection: InspectionRow | null
) {
  if (!inspection?.date || inspection.assignment_number) return inspection

  const { data: assignmentNumberRows, error: assignmentNumberError } = await admin
    .from('inspections')
    .select('assignment_number')
    .eq('date', inspection.date)
    .eq('inspection_family', 'TU')

  if (assignmentNumberError) {
    throw new Error(assignmentNumberError.message ?? 'Kunde inte generera arbetsnummer för TU.')
  }

  const assignmentNumber = getNextInspectionAssignmentNumber(inspection.date, assignmentNumberRows ?? [])
  if (!assignmentNumber) return inspection

  const { data: updatedInspection, error: updateError } = await admin
    .from('inspections')
    .update({ assignment_number: assignmentNumber })
    .eq('id', inspection.id)
    .is('assignment_number', null)
    .select(
      'id,property_id,status,date,inspection_time,assignment_number,customer_name,customer_email,customer_phone,customer_address,customer_postal_code,customer_city,created_at'
    )
    .maybeSingle()

  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte spara arbetsnummer för TU.')
  }

  return (updatedInspection as InspectionRow | null) ?? inspection
}

export async function listTuInvestigations(orgId: string): Promise<TuInspectionSummary[]> {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const { data: detailData, error: detailError } = await admin
    .from('technical_investigation_details')
    .select(
      'inspection_id,org_id,assignment_id,property_id,title,property_object_type,scope_description,brf_name,apartment_number,apartment_holder_name,background,basis,accessibility,report_draft,report_draft_updated_at,report_locked_at,created_by,created_at,updated_at'
    )
    .eq('org_id', orgId)
    .order('updated_at', { ascending: false })

  if (detailError) throw new Error(detailError.message ?? 'Kunde inte hämta TU-utredningar.')

  const details = (detailData ?? []) as TuDetailRow[]
  if (details.length === 0) return []

  const inspectionIds = details.map((detail) => detail.inspection_id)
  const propertyIds = [...new Set(details.map((detail) => detail.property_id).filter(Boolean) as string[])]

  const [{ data: inspectionData, error: inspectionError }, { data: propertyData, error: propertyError }] =
    await Promise.all([
      admin
        .from('inspections')
        .select(
          'id,property_id,status,date,inspection_time,assignment_number,customer_name,customer_email,customer_phone,customer_address,customer_postal_code,customer_city,created_at'
        )
        .in('id', inspectionIds),
      propertyIds.length > 0
        ? admin
            .from('properties')
            .select('id,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name')
            .in('id', propertyIds)
        : Promise.resolve({ data: [], error: null }),
    ])

  if (inspectionError) throw new Error(inspectionError.message ?? 'Kunde inte hämta TU-inspektioner.')
  if (propertyError) throw new Error(propertyError.message ?? 'Kunde inte hämta TU-fastigheter.')

  const inspectionRows = (inspectionData ?? []) as InspectionRow[]
  const propertyRows = (propertyData ?? []) as PropertyRow[]
  const inspections = new Map(inspectionRows.map((row) => [row.id, row]))
  const properties = new Map(propertyRows.map((row) => [row.id, row]))

  return details.map((detail) =>
    buildSummary(
      detail,
      inspections.get(detail.inspection_id) ?? null,
      detail.property_id ? properties.get(detail.property_id) ?? null : null
    )
  )
}

export async function getTuInvestigationById(input: {
  orgId: string
  inspectionId: string
  inspectorProfileId?: string | null
}): Promise<TuInvestigationDetails | null> {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const { data: detailData, error: detailError } = await admin
    .from('technical_investigation_details')
    .select(
      'inspection_id,org_id,assignment_id,property_id,title,property_object_type,scope_description,brf_name,apartment_number,apartment_holder_name,background,basis,accessibility,report_draft,report_draft_updated_at,report_locked_at,created_by,created_at,updated_at'
    )
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()

  if (detailError) throw new Error(detailError.message ?? 'Kunde inte hämta TU-utredning.')
  if (!detailData) return null

  const detail = detailData as TuDetailRow
  const [{ data: inspectionData, error: inspectionError }, { data: propertyData, error: propertyError }] =
    await Promise.all([
      admin
        .from('inspections')
        .select(
          'id,property_id,status,date,inspection_time,assignment_number,customer_name,customer_email,customer_phone,customer_address,customer_postal_code,customer_city,created_at'
        )
        .eq('id', detail.inspection_id)
        .maybeSingle(),
      detail.property_id
        ? admin
            .from('properties')
            .select('id,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name')
            .eq('id', detail.property_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

  if (inspectionError) throw new Error(inspectionError.message ?? 'Kunde inte hämta TU-inspektion.')
  if (propertyError) throw new Error(propertyError.message ?? 'Kunde inte hämta TU-fastighet.')

  const inspection = await ensureTuInspectionAssignmentNumber(admin, inspectionData as InspectionRow | null)
  const property = propertyData as PropertyRow | null
  const assignment = detail.assignment_id
    ? await getAssignmentById(input.orgId, detail.assignment_id)
    : null
  const inspector = await getTuInspectorProfile({
    profileId: input.inspectorProfileId ?? assignment?.responsible_profile_id ?? detail.created_by,
    orgId: input.orgId,
  })
  const summary = buildSummary(detail, inspection, property)
  const assignmentBrfName = cleanText(assignment?.brf_name)
  const assignmentApartmentNumber = cleanText(assignment?.apartment_number)
  const assignmentApartmentHolderName = cleanText(assignment?.apartment_holder_name)
  const hasApartmentAssignmentFields = Boolean(assignmentBrfName || assignmentApartmentNumber)
  const resolvedSummary = {
    ...summary,
    objectType: summary.objectType === 'apartment' || hasApartmentAssignmentFields ? 'apartment' : summary.objectType,
    brfName: cleanText(summary.brfName) ?? assignmentBrfName,
    apartmentNumber: cleanText(summary.apartmentNumber) ?? assignmentApartmentNumber,
    apartmentHolderName: cleanText(summary.apartmentHolderName) ?? assignmentApartmentHolderName,
  } satisfies TuInspectionSummary
  const reportDraft = upsertAssignmentScopeSectionText(
    upsertAssignmentPartiesSectionText(
      normalizeTuReportDraft(detail.report_draft),
      buildTuAssignmentPartiesText({ assignment, inspection, inspector })
    ),
    detail.scope_description
  )

  return {
    ...resolvedSummary,
    orgId: detail.org_id,
    inspection: {
      id: detail.inspection_id,
      status: inspection?.status ?? null,
      date: inspection?.date ?? null,
      inspection_time: inspection?.inspection_time ?? null,
      assignment_number: inspection?.assignment_number ?? null,
      customer_name: inspection?.customer_name ?? null,
      customer_email: inspection?.customer_email ?? null,
      customer_phone: inspection?.customer_phone ?? null,
      customer_address: inspection?.customer_address ?? null,
      customer_postal_code: inspection?.customer_postal_code ?? null,
      customer_city: inspection?.customer_city ?? null,
    },
    property,
    assignment,
    inspector,
    reportDraft,
    background: detail.background,
    basis: detail.basis,
    accessibility: detail.accessibility,
  }
}

const TU_IMAGE_COLUMNS =
  'id,inspection_id,org_id,section_key,storage_bucket,file_path,caption,sort_order,uploaded_by,created_at,updated_at'

function normalizeTuImageSectionKey(value: string | null | undefined): 'bank' | 'appendix' | 'cover' {
  if (value === 'appendix') return 'appendix'
  if (value === 'cover') return 'cover'
  return 'bank'
}

function mapTuInvestigationImage(row: TuImageRow, admin: TuStorageClient): TuInvestigationImage {
  const bucket = row.storage_bucket?.trim() || 'inspection-images'
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    orgId: row.org_id,
    sectionKey: normalizeTuImageSectionKey(row.section_key),
    storageBucket: bucket,
    filePath: row.file_path,
    publicUrl: admin.storage.from(bucket).getPublicUrl(row.file_path).data.publicUrl,
    caption: row.caption,
    sortOrder: row.sort_order ?? 100,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function listTuInvestigationImages(input: {
  orgId: string
  inspectionId: string
  sectionKey?: 'bank' | 'appendix' | 'cover'
}): Promise<TuInvestigationImage[]> {
  const admin = createSupabaseAdminClient() as unknown as TuStorageClient
  let query = admin
    .from('technical_investigation_images')
    .select(TU_IMAGE_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)

  if (input.sectionKey) {
    query = query.eq('section_key', input.sectionKey)
  }

  const { data, error } = await query
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message ?? 'Kunde inte hämta TU-bilder.')

  return ((data ?? []) as TuImageRow[]).map((row) => mapTuInvestigationImage(row, admin))
}

export async function updateTuInvestigationDraft(input: {
  orgId: string
  inspectionId: string
  updatedBy: string
  patch: {
    title?: string | null
    scopeDescription?: string | null
    objectType?: TuObjectType | null
    cadastralId?: string | null
    brfName?: string | null
    apartmentNumber?: string | null
    apartmentHolderName?: string | null
    background?: string | null
    basis?: string | null
    accessibility?: string | null
    reportDraft?: TuReportDraft
  }
}) {
  const admin = createSupabaseAdminClient() as unknown as TuSupabaseClient
  const existing = await getTuInvestigationById({
    orgId: input.orgId,
    inspectionId: input.inspectionId,
    inspectorProfileId: input.updatedBy,
  })
  if (!existing) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (existing.reportLockedAt) throw new Error('TU_REPORT_LOCKED')

  const payload: Record<string, unknown> = {
    updated_by: input.updatedBy,
  }

  if ('title' in input.patch) payload.title = cleanText(input.patch.title) ?? existing.title
  if ('scopeDescription' in input.patch) payload.scope_description = cleanText(input.patch.scopeDescription)
  const resolvedObjectType =
    'objectType' in input.patch ? normalizeTuObjectType(input.patch.objectType) : existing.objectType
  if (
    'objectType' in input.patch ||
    'brfName' in input.patch ||
    'apartmentNumber' in input.patch ||
    'apartmentHolderName' in input.patch
  ) {
    payload.property_object_type = resolvedObjectType
    payload.brf_name =
      resolvedObjectType === 'apartment'
        ? cleanText('brfName' in input.patch ? input.patch.brfName : existing.brfName)
        : null
    payload.apartment_number =
      resolvedObjectType === 'apartment'
        ? cleanText('apartmentNumber' in input.patch ? input.patch.apartmentNumber : existing.apartmentNumber)
        : null
    payload.apartment_holder_name =
      resolvedObjectType === 'apartment'
        ? cleanText(
            'apartmentHolderName' in input.patch ? input.patch.apartmentHolderName : existing.apartmentHolderName
          )
        : null
  }
  if ('background' in input.patch) payload.background = cleanText(input.patch.background)
  if ('basis' in input.patch) payload.basis = cleanText(input.patch.basis)
  if ('accessibility' in input.patch) payload.accessibility = cleanText(input.patch.accessibility)
  if ('reportDraft' in input.patch) {
    payload.report_draft = normalizeTuReportDraft(input.patch.reportDraft)
    payload.report_draft_updated_at = new Date().toISOString()
  }

  const { error } = await admin
    .from('technical_investigation_details')
    .update(payload)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)

  if (error) throw new Error(error.message ?? 'Kunde inte spara TU-utredning.')

  if (existing.propertyId && ('objectType' in input.patch || 'cadastralId' in input.patch)) {
    const { error: propertyError } = await admin
      .from('properties')
      .update({
        cadastral_id:
          resolvedObjectType === 'villa'
            ? cleanText('cadastralId' in input.patch ? input.patch.cadastralId : existing.cadastralId)
            : null,
      })
      .eq('id', existing.propertyId)

    if (propertyError) throw new Error(propertyError.message ?? 'Kunde inte spara TU-objekt.')
  }

  if ('scopeDescription' in input.patch || 'reportDraft' in input.patch) {
    await admin
      .from('inspections')
      .update({
        scope: 'scopeDescription' in input.patch ? cleanText(input.patch.scopeDescription) : existing.scopeDescription,
      })
      .eq('id', input.inspectionId)
  }

  return getTuInvestigationById({
    orgId: input.orgId,
    inspectionId: input.inspectionId,
    inspectorProfileId: input.updatedBy,
  })
}

export async function deleteTuInvestigation(input: {
  orgId: string
  inspectionId: string
}) {
  const admin = createSupabaseAdminClient() as unknown as TuStorageClient
  const { data: detailData, error: detailError } = await admin
    .from('technical_investigation_details')
    .select('inspection_id,report_locked_at')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()

  if (detailError) throw new Error(detailError.message ?? 'Kunde inte hämta TU-utredning.')
  if (!detailData) throw new Error('TU_INVESTIGATION_NOT_FOUND')

  const detail = detailData as Pick<TuDetailRow, 'inspection_id' | 'report_locked_at'>
  if (detail.report_locked_at) throw new Error('TU_REPORT_LOCKED')

  const { data: imageRows, error: imageError } = await admin
    .from('technical_investigation_images')
    .select('storage_bucket,file_path')
    .eq('org_id', input.orgId)
    .eq('inspection_id', detail.inspection_id)

  if (imageError) throw new Error(imageError.message ?? 'Kunde inte hämta TU-bilder.')

  const pathsByBucket = new Map<string, string[]>()
  for (const row of (imageRows ?? []) as Array<Pick<TuImageRow, 'storage_bucket' | 'file_path'>>) {
    const bucket = row.storage_bucket?.trim() || 'inspection-images'
    const path = row.file_path?.trim()
    if (!path) continue
    pathsByBucket.set(bucket, [...(pathsByBucket.get(bucket) ?? []), path])
  }

  for (const [bucket, paths] of pathsByBucket) {
    const { error: storageError } = await admin.storage.from(bucket).remove(paths)
    if (storageError) throw new Error(storageError.message ?? 'Kunde inte radera TU-bilder.')
  }

  const { error: deleteError } = await admin
    .from('inspections')
    .delete()
    .eq('id', detail.inspection_id)

  if (deleteError) throw new Error(deleteError.message ?? 'Kunde inte radera TU-utredning.')

  return { inspectionId: detail.inspection_id }
}
