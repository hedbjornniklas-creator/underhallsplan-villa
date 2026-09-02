'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ChevronDown, ChevronUp, FileText, Image as ImageIcon, Images, Loader2, MessageSquareText, MoveDown, MoveUp, Paperclip, Pencil, Plus, Printer, Sparkles, Trash2, Upload } from 'lucide-react'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import TuAnalysisWorkspace from '@/components/tu/TuAnalysisWorkspace'
import TuEvidenceWorkspace from '@/components/tu/TuEvidenceWorkspace'
import TuFieldLogWorkspace from '@/components/tu/TuFieldLogWorkspace'
import TuPrintActions from '@/components/tu/TuPrintActions'
import TuReportReviewDrawer from '@/components/tu/TuReportReviewDrawer'
import TuWorkflowRail from '@/components/tu/TuWorkflowRail'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { useTuFieldQueue, type TuFieldServerImage } from '@/hooks/useTuFieldQueue'
import { useTuWorkflowState } from '@/hooks/useTuWorkflowState'
import { supabase } from '@/lib/supabaseClient'
import { usesTuAiAssistedWorkflow } from '@/lib/tu/authoring'
import type { TuReportSectionTypeOption } from '@/lib/tu/reportSectionTypes'
import type { TuWorkspaceView } from '@/lib/tu/workflow'
import type {
  TuInvestigationDetails,
  TuReportDraft,
  TuReportSection,
  TuReportSectionKey,
  TuReportSubsection,
} from '@/lib/tu/server'

const TU_IMAGE_DRAG_DATA_TYPE = 'application/x-tu-image-id'
const IMAGE_FILE_ACCEPT = 'image/*'
const DOCUMENT_FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain'
const MAX_IMAGE_FILES_PER_UPLOAD = 20
const MAX_IMAGE_UPLOAD_BYTES = 15 * 1024 * 1024

type TuImageSectionKey = 'bank' | 'appendix' | 'cover'
type TuImageViewCount = 9 | 4 | 1
type TuImageActionTarget = TuImageSectionKey | 'delete' | 'reorder'
type TuDocumentActionTarget = 'include' | 'delete'
type AppendixImageOrderUpdate = { id: string; sortOrder: number }

type TuInvestigationImage = {
  id: string
  inspectionId: string
  orgId: string
  sectionKey: TuImageSectionKey
  storageBucket: string
  filePath: string
  publicUrl: string
  caption: string | null
  sortOrder: number
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
}

type ImageApiResponse = {
  image?: TuInvestigationImage
  images?: TuInvestigationImage[]
  upload?: {
    bucket: string
    filePath: string
    token: string
    publicUrl: string
  }
  error?: string
  detail?: string
}

type TuInvestigationDocument = {
  id: string
  inspectionId: string
  orgId: string
  storageBucket: string
  filePath: string
  fileName: string | null
  title: string | null
  contentType: string | null
  fileSizeBytes: number | null
  includeInDelivery: boolean
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  signedUrl: string | null
}

type DocumentApiResponse = {
  document?: TuInvestigationDocument
  documents?: TuInvestigationDocument[]
  error?: string
}

type TuAiSuggestion = {
  sectionKey: TuReportSectionKey
  title: string
  text: string
}

type TuAiResponse = {
  model?: string
  suggestions?: TuAiSuggestion[]
  error?: string
}

type TuSavePatchResponse = {
  investigation?: TuInvestigationDetails
  error?: string
}

type AssignmentPartiesFieldKey =
  | 'customerName'
  | 'customerRole'
  | 'customerIdentityNumber'
  | 'customerAddress'
  | 'customerPhone'
  | 'customerEmail'
  | 'customerAttendees'
  | 'invoiceName'
  | 'invoiceAddress'
  | 'propertyOwnerName'
  | 'inspectorName'
  | 'inspectorCompany'
  | 'inspectorOrgNo'
  | 'inspectorAddress'
  | 'inspectorPhone'
  | 'inspectorEmail'
  | 'inspectorSbrGroup'
  | 'inspectorStatus'
  | 'inspectorMembershipNumber'
  | 'inspectorCertificationNumber'

type AssignmentPartiesForm = Record<AssignmentPartiesFieldKey, string>

type ObjectDetailsForm = {
  objectType: 'villa' | 'apartment'
  cadastralId: string
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
}

type AssignmentPartiesField = {
  key: AssignmentPartiesFieldKey
  label: string
  multiline?: boolean
}

const CUSTOMER_PARTY_FIELDS: AssignmentPartiesField[] = [
  { key: 'customerName', label: 'Namn' },
  { key: 'customerRole', label: 'Roll/beställartyp' },
  { key: 'customerIdentityNumber', label: 'Person-/org.nr' },
  { key: 'customerAddress', label: 'Adress', multiline: true },
  { key: 'customerPhone', label: 'Telefon' },
  { key: 'customerEmail', label: 'E-post' },
  { key: 'customerAttendees', label: 'Närvarande' },
  { key: 'invoiceName', label: 'Fakturanamn' },
  { key: 'invoiceAddress', label: 'Fakturaadress', multiline: true },
  { key: 'propertyOwnerName', label: 'Fastighetsägare' },
]

const INSPECTOR_PARTY_FIELDS: AssignmentPartiesField[] = [
  { key: 'inspectorName', label: 'Namn' },
  { key: 'inspectorCompany', label: 'Företag' },
  { key: 'inspectorOrgNo', label: 'Org.nr' },
  { key: 'inspectorAddress', label: 'Adress', multiline: true },
  { key: 'inspectorPhone', label: 'Telefon' },
  { key: 'inspectorEmail', label: 'E-post' },
  { key: 'inspectorSbrGroup', label: 'SBR' },
  { key: 'inspectorStatus', label: 'Status' },
  { key: 'inspectorMembershipNumber', label: 'Medlemsnummer' },
  { key: 'inspectorCertificationNumber', label: 'Certifieringsnummer' },
]

const PROTECTED_SECTION_KEYS = new Set<string>(['assignment_parties'])
const HIDDEN_SECTION_KEYS = new Set<string>(['signature'])

function normalizeSectionTypeOptions(options: TuReportSectionTypeOption[] | undefined) {
  const source = options ?? []
  const seen = new Set<string>()
  const normalized = source
    .map((option) => ({
      ...option,
      key: option.key.trim(),
      title: cleanFieldValue(option.title),
    }))
    .filter(
      (option) =>
        option.key &&
        option.title &&
        !PROTECTED_SECTION_KEYS.has(option.key) &&
        !HIDDEN_SECTION_KEYS.has(option.key)
    )
    .filter((option) => {
      const normalizedKey = option.key.toLowerCase()
      if (seen.has(normalizedKey)) return false
      seen.add(normalizedKey)
      return true
    })

  return normalized.sort(
    (left, right) => left.title.localeCompare(right.title, 'sv') || left.key.localeCompare(right.key, 'sv')
  )
}

function getSectionTypeOption(options: TuReportSectionTypeOption[], key: TuReportSectionKey) {
  return options.find((option) => option.key === key) ?? null
}

function createSectionInstanceId(key: TuReportSectionKey) {
  return `${key}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createSubsectionInstanceId(sectionId: string) {
  return `${sectionId}-subsection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function createReportSection(key: TuReportSectionKey, options: TuReportSectionTypeOption[]): TuReportSection {
  const option = getSectionTypeOption(options, key)
  return {
    id: createSectionInstanceId(key),
    key,
    title: option?.title ?? 'Ny del',
    text: '',
    subsections: [],
  }
}

function getSectionInstanceId(section: Pick<TuReportSection, 'id' | 'key'>) {
  return section.id || section.key
}

function createReportSubsection(sectionId: string): TuReportSubsection {
  return {
    id: createSubsectionInstanceId(sectionId),
    title: 'Underrubrik',
    text: '',
  }
}

const EMPTY_ASSIGNMENT_PARTIES_FORM: AssignmentPartiesForm = {
  customerName: '',
  customerRole: '',
  customerIdentityNumber: '',
  customerAddress: '',
  customerPhone: '',
  customerEmail: '',
  customerAttendees: '',
  invoiceName: '',
  invoiceAddress: '',
  propertyOwnerName: '',
  inspectorName: '',
  inspectorCompany: '',
  inspectorOrgNo: '',
  inspectorAddress: '',
  inspectorPhone: '',
  inspectorEmail: '',
  inspectorSbrGroup: '',
  inspectorStatus: '',
  inspectorMembershipNumber: '',
  inspectorCertificationNumber: '',
}

function buildObjectDetailsForm(investigation: TuInvestigationDetails): ObjectDetailsForm {
  return {
    objectType: investigation.objectType === 'apartment' ? 'apartment' : 'villa',
    cadastralId: investigation.cadastralId ?? '',
    brfName: investigation.brfName ?? '',
    apartmentNumber: investigation.apartmentNumber ?? '',
    apartmentHolderName: investigation.apartmentHolderName ?? '',
  }
}

function cleanFieldValue(value: string | null | undefined) {
  return value?.trim() ?? ''
}

function compactAddress(parts: Array<string | null | undefined>) {
  return parts.map(cleanFieldValue).filter(Boolean).join(', ')
}

function getSectionText(draft: TuReportDraft, key: TuReportSectionKey) {
  return draft.sections.find((section) => section.key === key)?.text ?? ''
}

function assignIfPresent(
  form: AssignmentPartiesForm,
  key: AssignmentPartiesFieldKey,
  value: string | null | undefined
) {
  const cleaned = cleanFieldValue(value)
  if (cleaned) form[key] = cleaned
}

function parseAssignmentPartiesText(text: string) {
  const parsed: Partial<AssignmentPartiesForm> = {}
  let activeBlock: 'customer' | 'inspector' | null = null

  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.toLowerCase() === 'uppdragsgivare') {
      activeBlock = 'customer'
      continue
    }
    if (line.toLowerCase() === 'besiktningsman') {
      activeBlock = 'inspector'
      continue
    }

    const separatorIndex = line.indexOf(':')
    if (!activeBlock || separatorIndex < 0) continue

    const label = line.slice(0, separatorIndex).trim().toLowerCase()
    const value = line.slice(separatorIndex + 1).trim()
    if (!value) continue

    if (activeBlock === 'customer') {
      if (label === 'namn') parsed.customerName = value
      if (label === 'roll/beställartyp' || label === 'roll' || label === 'beställartyp') parsed.customerRole = value
      if (
        label === 'person-/org.nr' ||
        label === 'person-/organisationsnummer' ||
        label === 'personnummer/org.nr'
      ) {
        parsed.customerIdentityNumber = value
      }
      if (label === 'adress') parsed.customerAddress = value
      if (label === 'telefon') parsed.customerPhone = value
      if (label === 'e-post' || label === 'e.post' || label === 'e-mail' || label === 'email') {
        parsed.customerEmail = value
      }
      if (label === 'närvarande') parsed.customerAttendees = value
      if (label === 'fakturanamn') parsed.invoiceName = value
      if (label === 'fakturaadress') parsed.invoiceAddress = value
      if (label === 'fastighetsägare') parsed.propertyOwnerName = value
    }

    if (activeBlock === 'inspector') {
      if (label === 'namn') parsed.inspectorName = value
      if (label === 'företag') parsed.inspectorCompany = value
      if (label === 'org.nr') parsed.inspectorOrgNo = value
      if (label === 'adress') parsed.inspectorAddress = value
      if (label === 'telefon') parsed.inspectorPhone = value
      if (label === 'e-post' || label === 'e.post' || label === 'e-mail' || label === 'email') {
        parsed.inspectorEmail = value
      }
      if (label === 'sbr') parsed.inspectorSbrGroup = value
      if (label === 'status') parsed.inspectorStatus = value
      if (label === 'medlemsnummer') parsed.inspectorMembershipNumber = value
      if (label === 'certifieringsnummer') parsed.inspectorCertificationNumber = value
    }
  }

  return parsed
}

function mergeNonEmptyFields(base: AssignmentPartiesForm, parsed: Partial<AssignmentPartiesForm>) {
  const next = { ...base }
  for (const [key, value] of Object.entries(parsed) as Array<[AssignmentPartiesFieldKey, string | undefined]>) {
    if (cleanFieldValue(value)) next[key] = cleanFieldValue(value)
  }
  return next
}

function buildAssignmentPartiesForm(investigation: TuInvestigationDetails): AssignmentPartiesForm {
  const assignment = investigation.assignment
  const inspection = investigation.inspection
  const inspector = investigation.inspector
  const base = { ...EMPTY_ASSIGNMENT_PARTIES_FORM }

  assignIfPresent(base, 'customerName', assignment?.customer_name ?? inspection.customer_name)
  assignIfPresent(base, 'customerRole', assignment?.orderer_role)
  assignIfPresent(base, 'customerIdentityNumber', assignment?.personal_identity_number)
  assignIfPresent(
    base,
    'customerAddress',
    compactAddress([
      assignment?.customer_address ?? inspection.customer_address,
      compactAddress([
        assignment?.customer_postal_code ?? inspection.customer_postal_code,
        assignment?.customer_city ?? inspection.customer_city,
      ]),
    ])
  )
  assignIfPresent(base, 'customerPhone', assignment?.customer_phone ?? inspection.customer_phone)
  assignIfPresent(base, 'customerEmail', assignment?.customer_email ?? inspection.customer_email)
  assignIfPresent(base, 'invoiceName', assignment?.invoice_name)
  assignIfPresent(base, 'invoiceAddress', assignment?.invoice_address)
  assignIfPresent(base, 'propertyOwnerName', assignment?.property_owner_name)

  assignIfPresent(base, 'inspectorName', inspector?.full_name)
  assignIfPresent(base, 'inspectorCompany', inspector?.company_name)
  assignIfPresent(base, 'inspectorOrgNo', inspector?.company_orgno)
  assignIfPresent(
    base,
    'inspectorAddress',
    compactAddress([inspector?.company_address, compactAddress([inspector?.company_postal_code, inspector?.company_city])])
  )
  assignIfPresent(base, 'inspectorPhone', inspector?.phone)
  assignIfPresent(base, 'inspectorEmail', inspector?.email)
  assignIfPresent(base, 'inspectorSbrGroup', inspector?.sbr_group)
  assignIfPresent(base, 'inspectorStatus', inspector?.sbr_status)
  assignIfPresent(base, 'inspectorMembershipNumber', inspector?.membership_number)
  assignIfPresent(base, 'inspectorCertificationNumber', inspector?.certification_number)

  const parsed = parseAssignmentPartiesText(getSectionText(investigation.reportDraft, 'assignment_parties'))
  const parsedCustomerFields = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key.startsWith('customer') || key.startsWith('invoice') || key === 'propertyOwnerName')
  ) as Partial<AssignmentPartiesForm>

  const merged = mergeNonEmptyFields(base, parsedCustomerFields)
  for (const field of INSPECTOR_PARTY_FIELDS) {
    if (!merged[field.key] && cleanFieldValue(parsed[field.key])) {
      merged[field.key] = cleanFieldValue(parsed[field.key])
    }
  }

  return merged
}

function buildLine(label: string, value: string) {
  const cleaned = cleanFieldValue(value)
  return cleaned ? `${label}: ${cleaned}` : null
}

function buildAssignmentPartiesText(form: AssignmentPartiesForm) {
  const customerLines = [
    buildLine('Namn', form.customerName),
    buildLine('Roll/beställartyp', form.customerRole),
    buildLine('Person-/org.nr', form.customerIdentityNumber),
    buildLine('Adress', form.customerAddress),
    buildLine('Telefon', form.customerPhone),
    buildLine('E-post', form.customerEmail),
    buildLine('Närvarande', form.customerAttendees),
    buildLine('Fakturanamn', form.invoiceName),
    buildLine('Fakturaadress', form.invoiceAddress),
    buildLine('Fastighetsägare', form.propertyOwnerName),
  ].filter(Boolean)

  const inspectorLines = [
    buildLine('Namn', form.inspectorName),
    buildLine('Företag', form.inspectorCompany),
    buildLine('Org.nr', form.inspectorOrgNo),
    buildLine('Adress', form.inspectorAddress),
    buildLine('Telefon', form.inspectorPhone),
    buildLine('E-post', form.inspectorEmail),
    buildLine('SBR', form.inspectorSbrGroup),
    buildLine('Status', form.inspectorStatus),
    buildLine('Medlemsnummer', form.inspectorMembershipNumber),
    buildLine('Certifieringsnummer', form.inspectorCertificationNumber),
  ].filter(Boolean)

  return [
    'Uppdragsgivare',
    ...(customerLines.length > 0 ? customerLines : ['Ej angivet.']),
    '',
    'Besiktningsman',
    ...(inspectorLines.length > 0 ? inspectorLines : ['Ej angivet.']),
  ].join('\n')
}

function AssignmentPartiesInput({
  field,
  value,
  disabled,
  readOnly,
  onChange,
  onBlur,
}: {
  field: AssignmentPartiesField
  value: string
  disabled: boolean
  readOnly?: boolean
  onChange?: (value: string) => void
  onBlur?: () => void
}) {
  const inputClassName = `w-full rounded-md border border-gray-300 px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 ${
    readOnly ? 'bg-gray-50 text-gray-700' : 'bg-white'
  } disabled:bg-gray-100 disabled:text-gray-500`

  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{field.label}</span>
      {field.multiline ? (
        <textarea
          value={value}
          rows={2}
          readOnly={readOnly}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={onBlur}
          className={`${inputClassName} resize-y`}
        />
      ) : (
        <input
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
          onBlur={onBlur}
          className={`${inputClassName} h-10`}
        />
      )}
    </label>
  )
}

function ObjectDetailsInput({
  label,
  value,
  disabled,
  onChange,
  onBlur,
}: {
  label: string
  value: string
  disabled: boolean
  onChange: (value: string) => void
  onBlur: () => void
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
      />
    </label>
  )
}

function ReadOnlyInfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  const normalized = value?.trim()
  if (!normalized) return null
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <dt className="text-xs font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm font-semibold text-gray-950">{normalized}</dd>
    </div>
  )
}

function cloneDraftWithSection(draft: TuReportDraft, key: TuReportSectionKey, text: string): TuReportDraft {
  let updated = false
  return {
    sections: draft.sections.map((section) => {
      if (updated || section.key !== key) return section
      updated = true
      return { ...section, text }
    }),
  }
}

function cloneDraftWithSectionId(draft: TuReportDraft, sectionId: string, text: string): TuReportDraft {
  return {
    sections: draft.sections.map((section) =>
      getSectionInstanceId(section) === sectionId ? { ...section, text } : section
    ),
  }
}

function cloneDraftWithSubsection(
  draft: TuReportDraft,
  sectionId: string,
  subsectionId: string,
  patch: Partial<Pick<TuReportSubsection, 'title' | 'text'>>
): TuReportDraft {
  return {
    sections: draft.sections.map((section) => {
      if (getSectionInstanceId(section) !== sectionId) return section
      return {
        ...section,
        subsections: (section.subsections ?? []).map((subsection) =>
          subsection.id === subsectionId ? { ...subsection, ...patch } : subsection
        ),
      }
    }),
  }
}

function getAiSectionTitle(draft: TuReportDraft, key: TuReportSectionKey, fallback: string) {
  return draft.sections.find((section) => section.key === key)?.title ?? fallback
}

function formatSavedAt(value: string | null) {
  if (!value) return 'Inte sparad'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function formatDisplayDate(value: string | null | undefined) {
  if (!value) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function formatDisplayTime(value: string | null | undefined) {
  if (!value) return ''
  const match = value.trim().match(/^(\d{2}):(\d{2})/)
  return match ? `${match[1]}:${match[2]}` : value
}

function joinDisplay(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(', ')
}

function isImageFile(file: File) {
  if (file.type.toLowerCase().startsWith('image/')) return true
  return /\.(avif|gif|heic|heif|jpe?g|png|tiff?|webp)$/i.test(file.name)
}

function hasDraggedTuImage(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes(TU_IMAGE_DRAG_DATA_TYPE)
}

function hasExternalImageFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function getDroppedImageFiles(event: React.DragEvent) {
  return Array.from(event.dataTransfer.files).filter(isImageFile)
}

function getDroppedDocumentFile(event: React.DragEvent) {
  return Array.from(event.dataTransfer.files).find((file) => !isImageFile(file)) ?? null
}

function sortTuImages(images: TuInvestigationImage[]) {
  return [...images].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
    return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
  })
}

function sortTuImagesNewestFirst(images: TuInvestigationImage[]) {
  return [...images].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return b.sortOrder - a.sortOrder
    return (b.createdAt ?? '').localeCompare(a.createdAt ?? '')
  })
}

function sortTuDocuments(documents: TuInvestigationDocument[]) {
  return [...documents].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
}

function upsertImages(current: TuInvestigationImage[], updates: TuInvestigationImage[]) {
  const byId = new Map(current.map((image) => [image.id, image]))
  for (const image of updates) byId.set(image.id, image)
  return sortTuImages(Array.from(byId.values()))
}

function upsertDocument(current: TuInvestigationDocument[], document: TuInvestigationDocument) {
  const byId = new Map(current.map((item) => [item.id, item]))
  byId.set(document.id, document)
  return sortTuDocuments(Array.from(byId.values()))
}

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

function formatFileSizeForError(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

async function readApiError(response: Response, fallback: string) {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    const payload = (await response.json().catch(() => ({}))) as { error?: unknown; detail?: unknown }
    const message = typeof payload.error === 'string' ? payload.error.trim() : ''
    const detail = typeof payload.detail === 'string' ? payload.detail.trim() : ''
    return [message, detail].filter(Boolean).join(' ')
  }

  const text = (await response.text().catch(() => '')).trim()
  if (text) return `${fallback} Servern svarade ${response.status}: ${text.slice(0, 400)}`
  return `${fallback} Servern svarade ${response.status}.`
}

function buildImageUploadContext(files: File[]) {
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0)
  const largest = files.reduce<File | null>((current, file) => {
    if (!current || file.size > current.size) return file
    return current
  }, null)
  const parts = [`${files.length} bild${files.length === 1 ? '' : 'er'}`]
  if (totalBytes > 0) parts.push(`totalt ${formatFileSizeForError(totalBytes)}`)
  if (largest) parts.push(`största fil ${largest.name} (${formatFileSizeForError(largest.size)})`)
  return parts.join(', ')
}

function getTuImageGridClass(viewCount: TuImageViewCount) {
  if (viewCount === 1) return 'grid grid-cols-1 gap-3'
  if (viewCount === 4) return 'grid grid-cols-2 gap-2.5'
  return 'grid grid-cols-3 gap-2'
}

function getTuImageClass(viewCount: TuImageViewCount) {
  if (viewCount === 1) return 'max-h-[430px] w-full object-contain bg-gray-100'
  return 'aspect-square w-full object-cover transition group-hover:scale-[1.02]'
}

function getCollapsedSectionsStorageKey(inspectionId: string) {
  return `tu:${inspectionId}:collapsed-sections`
}

function parseStoredCollapsedSections(value: string | null, allowedKeys: Set<string>) {
  if (!value) return new Set<string>()
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return new Set<string>()
    return new Set(
      parsed.filter((key): key is string => typeof key === 'string' && allowedKeys.has(key))
    )
  } catch {
    return new Set<string>()
  }
}

export default function TuInvestigationEditorClient({
  initialInvestigation,
  sectionTypeOptions: initialSectionTypeOptions,
}: {
  initialInvestigation: TuInvestigationDetails
  sectionTypeOptions?: TuReportSectionTypeOption[]
}) {
  const [investigation, setInvestigation] = useState(initialInvestigation)
  const sectionTypeOptions = useMemo(
    () => normalizeSectionTypeOptions(initialSectionTypeOptions),
    [initialSectionTypeOptions]
  )
  const [draft, setDraft] = useState<TuReportDraft>(initialInvestigation.reportDraft)
  const [title, setTitle] = useState(initialInvestigation.title)
  const [projectType, setProjectType] = useState(initialInvestigation.projectType ?? 'Fördjupad teknisk utredning')
  const [objectDetails, setObjectDetails] = useState<ObjectDetailsForm>(() =>
    buildObjectDetailsForm(initialInvestigation)
  )
  const [assignmentParties, setAssignmentParties] = useState<AssignmentPartiesForm>(() =>
    buildAssignmentPartiesForm(initialInvestigation)
  )
  const [error, setError] = useState<string | null>(null)
  const [images, setImages] = useState<TuInvestigationImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(true)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageActionIds, setImageActionIds] = useState<Set<string>>(() => new Set())
  const [imageActionTargets, setImageActionTargets] = useState<Record<string, TuImageActionTarget>>({})
  const [imageDropBusySection, setImageDropBusySection] = useState<TuImageSectionKey | null>(null)
  const [imageError, setImageError] = useState<string | null>(null)
  const [imageUploadProgress, setImageUploadProgress] = useState<string | null>(null)
  const [imageViewCount, setImageViewCount] = useState<TuImageViewCount>(9)
  const [previewImageId, setPreviewImageId] = useState<string | null>(null)
  const [appendixReorderStatus, setAppendixReorderStatus] = useState<'idle' | 'queued' | 'saving'>('idle')
  const [appendixInsertIndex, setAppendixInsertIndex] = useState<number | null>(null)
  const [appendixDropBusyIndex, setAppendixDropBusyIndex] = useState<number | null>(null)
  const [documents, setDocuments] = useState<TuInvestigationDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentBusy, setDocumentBusy] = useState(false)
  const [documentActionTargets, setDocumentActionTargets] = useState<Record<string, TuDocumentActionTarget>>({})
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [documentDropActive, setDocumentDropActive] = useState(false)
  const [coverDropActive, setCoverDropActive] = useState(false)
  const [bankDropActive, setBankDropActive] = useState(false)
  const [appendixDropActive, setAppendixDropActive] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => new Set())
  const [reportDetailsOpen, setReportDetailsOpen] = useState(false)
  const [imageBankOpen, setImageBankOpen] = useState(false)
  const [deliveryDocumentsOpen, setDeliveryDocumentsOpen] = useState(false)
  const [newSectionKey, setNewSectionKey] = useState<TuReportSectionKey>(sectionTypeOptions[0]?.key ?? '')
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState<TuAiSuggestion[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [reportReviewTarget, setReportReviewTarget] = useState<
    { id: string; title: string } | null | undefined
  >(undefined)
  const aiWorkflowEnabled = usesTuAiAssistedWorkflow(
    initialInvestigation.reportAuthoringMode,
    initialInvestigation.reportTemplateKey
  )
  const locked = Boolean(investigation.reportLockedAt)
  const [workspaceView, setWorkspaceView] = useState<TuWorkspaceView>(
    aiWorkflowEnabled ? 'field' : 'report'
  )
  const handleFieldImageUploaded = useCallback((image: TuFieldServerImage) => {
    setImages((current) => upsertImages(current, [image]))
  }, [])
  const fieldQueue = useTuFieldQueue({
    inspectionId: initialInvestigation.inspectionId,
    enabled: aiWorkflowEnabled,
    locked,
    onImageUploaded: handleFieldImageUploaded,
  })
  const draftRef = useRef(initialInvestigation.reportDraft)
  const objectDetailsRef = useRef(objectDetails)
  const assignmentPartiesRef = useRef(assignmentParties)
  const coverFileInputRef = useRef<HTMLInputElement>(null)
  const bankFileInputRef = useRef<HTMLInputElement>(null)
  const appendixFileInputRef = useRef<HTMLInputElement>(null)
  const documentFileInputRef = useRef<HTMLInputElement>(null)
  const imageErrorRef = useRef<HTMLDivElement>(null)
  const pendingFocusSectionIdRef = useRef<string | null>(null)
  const imagesRef = useRef<TuInvestigationImage[]>([])
  const appendixReorderTimerRef = useRef<number | null>(null)
  const appendixReorderVersionRef = useRef(0)
  const appendixReorderUpdatesRef = useRef<AppendixImageOrderUpdate[]>([])

  const saveTuPatch = useCallback(
    async (body: Record<string, unknown>): Promise<TuSavePatchResponse> => {
      const response = await fetch(`/api/tu/investigations/${initialInvestigation.inspectionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const payload = (await response.json().catch(() => ({}))) as TuSavePatchResponse
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara TU-utredningen.')
      }
      return payload
    },
    [initialInvestigation.inspectionId]
  )

  const autosave = useAutosaveQueue<Record<string, unknown>, TuSavePatchResponse>({
    save: saveTuPatch,
    mergePayload: (previous, next) => ({ ...previous, ...next }),
    onSaved: (payload) => {
      if (payload.investigation) {
        setInvestigation(payload.investigation)
      }
    },
    onError: (saveError) => {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
    },
  })

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    imagesRef.current = images
  }, [images])

  useEffect(() => {
    objectDetailsRef.current = objectDetails
  }, [objectDetails])

  useEffect(() => {
    return () => {
      if (appendixReorderTimerRef.current) {
        window.clearTimeout(appendixReorderTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    assignmentPartiesRef.current = assignmentParties
  }, [assignmentParties])

  useEffect(() => {
    if (sectionTypeOptions.some((option) => option.key === newSectionKey)) return
    setNewSectionKey(sectionTypeOptions[0]?.key ?? '')
  }, [newSectionKey, sectionTypeOptions])

  useEffect(() => {
    if (!imageError) return
    imageErrorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [imageError])

  useEffect(() => {
    const sectionId = pendingFocusSectionIdRef.current
    if (!sectionId) return
    pendingFocusSectionIdRef.current = null

    window.requestAnimationFrame(() => {
      const sectionElement = document.getElementById(`tu-section-${sectionId}`)
      if (!sectionElement) return

      sectionElement.scrollIntoView({ behavior: 'smooth', block: 'start' })
      const textarea = sectionElement.querySelector<HTMLTextAreaElement>('[data-tu-section-textarea="true"]')
      textarea?.focus({ preventScroll: true })
    })
  }, [draft.sections, workspaceView])

  useEffect(() => {
    const allowedKeys = new Set(draftRef.current.sections.map((section) => getSectionInstanceId(section)))
    const stored = window.localStorage.getItem(getCollapsedSectionsStorageKey(initialInvestigation.inspectionId))
    setCollapsedSections(parseStoredCollapsedSections(stored, allowedKeys))
  }, [initialInvestigation.inspectionId])

  useEffect(() => {
    let cancelled = false

    async function loadImages() {
      setImagesLoading(true)
      setImageError(null)
      try {
        const response = await fetch(`/api/tu/investigations/${initialInvestigation.inspectionId}/images`)
        const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta TU-bilder.')
        if (!cancelled) setImages(sortTuImages(payload.images ?? []))
      } catch (loadError) {
        if (!cancelled) {
          setImageError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta TU-bilder.')
        }
      } finally {
        if (!cancelled) setImagesLoading(false)
      }
    }

    void loadImages()

    return () => {
      cancelled = true
    }
  }, [initialInvestigation.inspectionId])

  useEffect(() => {
    let cancelled = false

    async function loadDocuments() {
      setDocumentsLoading(true)
      setDocumentError(null)
      try {
        const response = await fetch(`/api/tu/investigations/${initialInvestigation.inspectionId}/documents`)
        const payload = (await response.json().catch(() => ({}))) as DocumentApiResponse
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta TU-dokument.')
        if (!cancelled) setDocuments(sortTuDocuments(payload.documents ?? []))
      } catch (loadError) {
        if (!cancelled) {
          setDocumentError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta TU-dokument.')
        }
      } finally {
        if (!cancelled) setDocumentsLoading(false)
      }
    }

    void loadDocuments()

    return () => {
      cancelled = true
    }
  }, [initialInvestigation.inspectionId])

  const savePatch = async (body: Record<string, unknown>) => {
    setError(null)
    autosave.resetError()
    await autosave.enqueue(body)
  }

  const saveHeaderDetails = async (nextObjectDetails = objectDetailsRef.current) => {
    try {
      await savePatch({
        title,
        projectType,
        objectType: nextObjectDetails.objectType,
        cadastralId: nextObjectDetails.cadastralId,
        brfName: nextObjectDetails.brfName,
        apartmentNumber: nextObjectDetails.apartmentNumber,
        apartmentHolderName: nextObjectDetails.apartmentHolderName,
      })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
    }
  }

  const updateObjectDetailsField = <K extends keyof ObjectDetailsForm>(
    key: K,
    value: ObjectDetailsForm[K],
    saveImmediately = false
  ) => {
    setObjectDetails((current) => {
      const next = { ...current, [key]: value }
      objectDetailsRef.current = next
      if (saveImmediately) void saveHeaderDetails(next)
      return next
    })
  }

  const saveDraft = async (nextDraft: TuReportDraft, errorMessage = 'Kunde inte spara utlåtandet.') => {
    draftRef.current = nextDraft
    setDraft(nextDraft)
    try {
      await savePatch({ reportDraft: nextDraft })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : errorMessage)
      throw saveError
    }
  }

  const saveSection = async (key: TuReportSectionKey, value: string) => {
    const nextDraft = cloneDraftWithSection(draftRef.current, key, value)
    await saveDraft(nextDraft, 'Kunde inte spara avsnittet.')
  }

  const saveSectionById = async (sectionId: string, value: string) => {
    const nextDraft = cloneDraftWithSectionId(draftRef.current, sectionId, value)
    await saveDraft(nextDraft, 'Kunde inte spara avsnittet.')
  }

  const updateAssignmentPartiesField = (field: AssignmentPartiesFieldKey, value: string) => {
    setAssignmentParties((current) => {
      const next = { ...current, [field]: value }
      assignmentPartiesRef.current = next
      const nextDraft = cloneDraftWithSection(draftRef.current, 'assignment_parties', buildAssignmentPartiesText(next))
      draftRef.current = nextDraft
      setDraft(nextDraft)
      return next
    })
  }

  const saveAssignmentParties = async () => {
    try {
      await saveSection('assignment_parties', buildAssignmentPartiesText(assignmentPartiesRef.current))
    } catch {
      // saveSection already shows the specific error state.
    }
  }

  const toggleSectionCollapsedById = (sectionId: string) => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      window.localStorage.setItem(
        getCollapsedSectionsStorageKey(investigation.inspectionId),
        JSON.stringify(Array.from(next))
      )
      return next
    })
  }

  const addReportSection = async (insertAfterSectionId?: string) => {
    if (locked) return
    if (!sectionTypeOptions.some((option) => option.key === newSectionKey)) {
      setError('Det saknas aktiva TU-rubriker i admin. Lägg in rubriker innan du lägger till fler delar.')
      return
    }
    const sections = [...draftRef.current.sections]
    const signatureIndex = sections.findIndex((section) => section.key === 'signature')
    const nextSection = createReportSection(newSectionKey, sectionTypeOptions)
    const nextSectionId = getSectionInstanceId(nextSection)
    const afterIndex = insertAfterSectionId
      ? sections.findIndex((section) => getSectionInstanceId(section) === insertAfterSectionId)
      : -1
    let insertIndex = afterIndex >= 0 ? afterIndex + 1 : -1

    if (signatureIndex >= 0 && (insertIndex < 0 || insertIndex > signatureIndex)) {
      insertIndex = signatureIndex
    }

    if (insertIndex >= 0) {
      sections.splice(insertIndex, 0, nextSection)
    } else {
      sections.push(nextSection)
    }
    const nextDraft = {
      sections,
    }
    pendingFocusSectionIdRef.current = nextSectionId
    try {
      await saveDraft(nextDraft, 'Kunde inte lägga till del.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const removeReportSection = async (sectionId: string) => {
    if (locked) return
    const section = draftRef.current.sections.find((item) => getSectionInstanceId(item) === sectionId)
    if (!section || PROTECTED_SECTION_KEYS.has(section.key) || section.isRequired || section.allowDelete === false) return
    const nextDraft = {
      sections: draftRef.current.sections.filter((item) => getSectionInstanceId(item) !== sectionId),
    }
    try {
      await saveDraft(nextDraft, 'Kunde inte ta bort del.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const moveReportSection = async (sectionId: string, direction: -1 | 1) => {
    if (locked) return
    const sections = [...draftRef.current.sections]
    const visibleSectionIds = sections
      .filter((section) => !HIDDEN_SECTION_KEYS.has(section.key))
      .map((section) => getSectionInstanceId(section))
    const visibleIndex = visibleSectionIds.indexOf(sectionId)
    const targetSectionId = visibleSectionIds[visibleIndex + direction]
    if (visibleIndex < 0 || !targetSectionId) return
    const index = sections.findIndex((section) => getSectionInstanceId(section) === sectionId)
    const targetIndex = sections.findIndex((section) => getSectionInstanceId(section) === targetSectionId)
    if (index < 0 || targetIndex < 0) return
    const current = sections[index]
    const target = sections[targetIndex]
    if (current.key === 'assignment_parties' || target.key === 'assignment_parties') return
    sections[index] = target
    sections[targetIndex] = current
    try {
      await saveDraft({ sections }, 'Kunde inte flytta del.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const changeReportSectionType = async (sectionId: string, key: TuReportSectionKey) => {
    if (locked) return
    const option = getSectionTypeOption(sectionTypeOptions, key)
    if (!option) return
    const nextDraft = {
      sections: draftRef.current.sections.map((section) =>
        getSectionInstanceId(section) === sectionId
          ? {
              ...section,
              key,
              title: option.title,
            }
          : section
      ),
    }
    try {
      await saveDraft(nextDraft, 'Kunde inte byta deltyp.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const addReportSubsection = async (sectionId: string) => {
    if (locked) return
    const nextDraft = {
      sections: draftRef.current.sections.map((section) =>
        getSectionInstanceId(section) === sectionId
          ? {
              ...section,
              subsections: [...(section.subsections ?? []), createReportSubsection(sectionId)],
            }
          : section
      ),
    }
    try {
      await saveDraft(nextDraft, 'Kunde inte lägga till underrubrik.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const updateReportSubsectionTitle = (sectionId: string, subsectionId: string, title: string) => {
    const nextDraft = cloneDraftWithSubsection(draftRef.current, sectionId, subsectionId, { title })
    draftRef.current = nextDraft
    setDraft(nextDraft)
  }

  const saveReportSubsectionTitle = async (sectionId: string, subsectionId: string, title: string) => {
    const cleanedTitle = cleanFieldValue(title) || 'Underrubrik'
    const nextDraft = cloneDraftWithSubsection(draftRef.current, sectionId, subsectionId, { title: cleanedTitle })
    try {
      await saveDraft(nextDraft, 'Kunde inte spara underrubrik.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const saveReportSubsectionText = async (sectionId: string, subsectionId: string, text: string) => {
    const nextDraft = cloneDraftWithSubsection(draftRef.current, sectionId, subsectionId, { text })
    await saveDraft(nextDraft, 'Kunde inte spara underrubrik.')
  }

  const removeReportSubsection = async (sectionId: string, subsectionId: string) => {
    if (locked) return
    const nextDraft = {
      sections: draftRef.current.sections.map((section) =>
        getSectionInstanceId(section) === sectionId
          ? {
              ...section,
              subsections: (section.subsections ?? []).filter((subsection) => subsection.id !== subsectionId),
            }
          : section
      ),
    }
    try {
      await saveDraft(nextDraft, 'Kunde inte ta bort underrubrik.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const moveReportSubsection = async (sectionId: string, subsectionId: string, direction: -1 | 1) => {
    if (locked) return
    const section = draftRef.current.sections.find((item) => getSectionInstanceId(item) === sectionId)
    const subsections = [...(section?.subsections ?? [])]
    const index = subsections.findIndex((subsection) => subsection.id === subsectionId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= subsections.length) return
    const current = subsections[index]
    subsections[index] = subsections[targetIndex]
    subsections[targetIndex] = current
    const nextDraft = {
      sections: draftRef.current.sections.map((item) =>
        getSectionInstanceId(item) === sectionId ? { ...item, subsections } : item
      ),
    }
    try {
      await saveDraft(nextDraft, 'Kunde inte flytta underrubrik.')
    } catch {
      // saveDraft shows the specific error.
    }
  }

  const requestAiSuggestions = async (options?: { sectionKey?: TuReportSectionKey; fillEmpty?: boolean }) => {
    if (locked || aiBusy) return
    const prompt = aiPrompt.trim()
    if (prompt.length < 8) {
      setAiError('Skriv en lite tydligare instruktion till AI:n.')
      return
    }

    setAiBusy(true)
    setAiError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/ai-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          mode: options?.fillEmpty ? 'fill_empty' : 'suggest',
          sectionKey: options?.sectionKey,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as TuAiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skapa AI-förslag.')
      setAiSuggestions(payload.suggestions ?? [])
      if ((payload.suggestions ?? []).length === 0) {
        setAiError('AI:n hittade inga tomma eller relevanta sektioner att föreslå text till.')
      }
    } catch (requestError) {
      setAiError(requestError instanceof Error ? requestError.message : 'Kunde inte skapa AI-förslag.')
    } finally {
      setAiBusy(false)
    }
  }

  const applyAiSuggestion = async (suggestion: TuAiSuggestion, mode: 'replace' | 'append') => {
    if (locked) return
    const currentText = getSectionText(draftRef.current, suggestion.sectionKey)
    const nextText =
      mode === 'append' && currentText.trim()
        ? `${currentText.trimEnd()}\n\n${suggestion.text.trim()}`
        : suggestion.text.trim()

    try {
      await saveSection(suggestion.sectionKey, nextText)
      setAiSuggestions((current) => current.filter((item) => item !== suggestion))
    } catch {
      // saveSection already reports the error.
    }
  }

  const applyEvidenceSuggestion = async (
    sectionId: string,
    text: string,
    mode: 'replace' | 'append'
  ) => {
    const section = draftRef.current.sections.find((item) => getSectionInstanceId(item) === sectionId)
    if (!section) throw new Error('Rapportsektionen hittades inte.')
    const nextText =
      mode === 'append' && section.text.trim()
        ? `${section.text.trimEnd()}\n\n${text.trim()}`
        : text.trim()
    await saveSectionById(sectionId, nextText)
  }

  const applyWholeReportDraft = async (
    generatedSections: Array<{ sectionId: string; text: string }>
  ) => {
    if (locked) throw new Error('Utlåtandet är låst och kan inte ändras.')
    const textBySectionId = new Map(
      generatedSections.map((section) => [section.sectionId, section.text.trim()])
    )
    const knownSectionIds = new Set(
      draftRef.current.sections.map((section) => getSectionInstanceId(section))
    )
    if (generatedSections.some((section) => !knownSectionIds.has(section.sectionId))) {
      throw new Error('En rapportdel i AI-utkastet finns inte längre i utlåtandet.')
    }
    const nextDraft = {
      sections: draftRef.current.sections.map((section) => {
        const nextText = textBySectionId.get(getSectionInstanceId(section))
        return nextText === undefined ? section : { ...section, text: nextText }
      }),
    }
    await saveDraft(nextDraft, 'Kunde inte föra över rapportutkastet.')
  }

  const openReportWorkspace = (sectionId?: string) => {
    if (sectionId) pendingFocusSectionIdRef.current = sectionId
    setWorkspaceView('report')
  }

  const visibleSections = draft.sections.filter((section) => !HIDDEN_SECTION_KEYS.has(section.key))
  const reportEditorSections = visibleSections.filter((section) => section.key !== 'assignment_parties')
  const coverImages = images.filter((image) => image.sectionKey === 'cover')
  const coverImage = coverImages[0] ?? null
  const bankImages = images.filter((image) => image.sectionKey === 'bank')
  const appendixImages = images.filter((image) => image.sectionKey === 'appendix')
  const appendixImagesForEditor = sortTuImagesNewestFirst(appendixImages)
  const previewImages = [...coverImages, ...bankImages, ...appendixImages]
  const previewImage = previewImages.find((image) => image.id === previewImageId) ?? null
  const previewImageIndex = previewImage ? previewImages.findIndex((image) => image.id === previewImage.id) : -1
  const deliveryDocumentCount = documents.filter((document) => document.includeInDelivery).length
  const objectAddress = joinDisplay([
    investigation.property?.address ?? investigation.propertyAddress,
    joinDisplay([investigation.property?.postal_code, investigation.property?.city ?? investigation.propertyCity]),
  ])
  const customerName = investigation.assignment?.customer_name ?? investigation.inspection.customer_name
  const customerContact = joinDisplay([
    investigation.assignment?.customer_phone ?? investigation.inspection.customer_phone,
    investigation.assignment?.customer_email ?? investigation.inspection.customer_email,
  ])
  const autosaveSavedAt = autosave.lastSavedAt
    ? formatSavedAt(autosave.lastSavedAt.toISOString())
    : formatSavedAt(investigation.updatedAt)
  const autosaveStatusText =
    autosave.status === 'saving'
      ? 'Sparar...'
      : autosave.status === 'error'
        ? 'Kunde inte spara'
        : `Sparad: ${autosaveSavedAt}`
  const systemStatusText = !fieldQueue.online
    ? fieldQueue.counts.total > 0
      ? `Offline · ${fieldQueue.counts.total} fältposter väntar på synkning`
      : 'Offline'
    : fieldQueue.counts.failed > 0
      ? `${fieldQueue.counts.failed} bakgrundsjobb behöver nytt försök`
      : fieldQueue.counts.total > 0
        ? `${fieldQueue.counts.total} fältposter bearbetas`
        : autosaveStatusText
  const systemStatusTone =
    autosave.status === 'error' || fieldQueue.counts.failed > 0
      ? 'bg-rose-500'
      : !fieldQueue.online || fieldQueue.counts.total > 0
        ? 'bg-amber-500'
        : autosave.status === 'saving'
          ? 'animate-pulse bg-violet-600'
          : 'bg-emerald-500'
  const workflowReportSections = visibleSections.filter(
    (section) => !['assignment_parties', 'signature'].includes(section.key)
  )
  const workflowReportFilledSectionCount = workflowReportSections.filter(
    (section) => section.text.trim() || section.subsections?.some((subsection) => subsection.text.trim())
  ).length
  const workflowState = useTuWorkflowState({
    inspectionId: investigation.inspectionId,
    enabled: aiWorkflowEnabled,
    refreshToken: fieldQueue.completedRevision,
    queue: {
      total: fieldQueue.counts.total,
      failed: fieldQueue.counts.failed,
    },
    reportFilledSectionCount: workflowReportFilledSectionCount,
    reportSectionCount: workflowReportSections.length,
  })
  const refreshWorkflowState = workflowState.refresh
  const finalizationBlockedReason = useMemo(() => {
    if (!aiWorkflowEnabled) return null
    const assessmentStep = workflowState.steps.find((step) => step.id === 'assessment')
    const reportStep = workflowState.steps.find((step) => step.id === 'report')
    if (assessmentStep?.status !== 'complete') {
      return assessmentStep?.statusText ?? 'Bedömningen måste slutföras.'
    }
    if (reportStep?.status !== 'complete') {
      return reportStep?.statusText ?? 'Utlåtandet måste slutgranskas.'
    }
    return null
  }, [aiWorkflowEnabled, workflowState.steps])
  const handleDeliveryStatusChange = useCallback(({ reportLockedAt }: { reportLockedAt: string | null }) => {
    setInvestigation((current) => (
      current.reportLockedAt === reportLockedAt ? current : { ...current, reportLockedAt }
    ))
    void refreshWorkflowState(true)
  }, [refreshWorkflowState])

  const imageSectionLabel = (sectionKey: TuImageSectionKey) => {
    if (sectionKey === 'cover') return 'omslagsbild'
    if (sectionKey === 'appendix') return 'bildbilaga'
    return 'bildbank'
  }

  const setImageActionTarget = (imageId: string, target: TuImageActionTarget | null) => {
    setImageActionIds((current) => {
      const next = new Set(current)
      if (target) {
        next.add(imageId)
      } else {
        next.delete(imageId)
      }
      return next
    })
    setImageActionTargets((current) => {
      const next = { ...current }
      if (target) {
        next[imageId] = target
      } else {
        delete next[imageId]
      }
      return next
    })
  }

  const setDocumentActionTarget = (documentId: string, target: TuDocumentActionTarget | null) => {
    setDocumentActionTargets((current) => {
      const next = { ...current }
      if (target) {
        next[documentId] = target
      } else {
        delete next[documentId]
      }
      return next
    })
  }

  const showImageOperationMessage = (message: string) => {
    setImageUploadProgress(message)
    window.setTimeout(() => {
      setImageUploadProgress((current) => (current === message ? null : current))
    }, 2500)
  }

  const uploadImages = async (files: File[], sectionKey: TuImageSectionKey) => {
    if (locked || files.length === 0) return []
    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) {
      setImageError('Endast bildfiler kan laddas upp.')
      return []
    }
    if (imageFiles.length > MAX_IMAGE_FILES_PER_UPLOAD) {
      setImageError(`Ladda upp max ${MAX_IMAGE_FILES_PER_UPLOAD} bilder åt gången.`)
      return []
    }
    const tooLargeFile = imageFiles.find((file) => file.size > MAX_IMAGE_UPLOAD_BYTES)
    if (tooLargeFile) {
      setImageError(
        `${tooLargeFile.name} är för stor (${formatFileSizeForError(tooLargeFile.size)}). Max per originalbild är 15 MB.`
      )
      return []
    }

    setImageBusy(true)
    setImageDropBusySection(sectionKey)
    setImageError(null)
    setImageUploadProgress(`Startar uppladdning av ${imageFiles.length} bild${imageFiles.length === 1 ? '' : 'er'}...`)
    const uploadedImages: TuInvestigationImage[] = []
    try {
      if (sectionKey === 'cover') {
        for (const image of coverImages) {
          await patchImage(image.id, {
            sectionKey: 'bank',
            sortOrder: firstSortOrderForSection('bank', image.id),
          })
        }
      }

      for (const [index, originalFile] of imageFiles.entries()) {
        const position = `${index + 1}/${imageFiles.length}`
        setImageUploadProgress(`Skapar uppladdningslänk ${position}: ${originalFile.name}`)
        const signedResponse = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'createSignedUpload',
            sectionKey,
            fileName: originalFile.name,
            contentType: originalFile.type,
            fileSize: originalFile.size,
          }),
        })
        if (!signedResponse.ok) {
          const message = await readApiError(signedResponse, 'Kunde inte skapa uppladdningslänk.')
          throw new Error(`${message} (${buildImageUploadContext([originalFile])})`)
        }
        const signedPayload = (await signedResponse.json().catch(() => ({}))) as ImageApiResponse
        const upload = signedPayload.upload
        if (!upload?.bucket || !upload.filePath || !upload.token) {
          throw new Error(`Servern saknade uppladdningsuppgifter för ${originalFile.name}.`)
        }

        setImageUploadProgress(`Laddar upp originalbild ${position}: ${originalFile.name}`)
        const { error: storageError } = await supabase.storage
          .from(upload.bucket)
          .uploadToSignedUrl(upload.filePath, upload.token, originalFile, {
            contentType: originalFile.type || undefined,
          })

        if (storageError) {
          throw new Error(
            `Supabase kunde inte ta emot ${originalFile.name}: ${storageError.message ?? 'okänt storage-fel'}.`
          )
        }

        setImageUploadProgress(`Sparar bildrad ${position}: ${originalFile.name}`)
        const completeResponse = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'completeSignedUpload',
            sectionKey,
            filePath: upload.filePath,
          }),
        })
        if (!completeResponse.ok) {
          const message = await readApiError(completeResponse, 'Bilden laddades upp men kunde inte sparas i listan.')
          throw new Error(`${message} (${buildImageUploadContext([originalFile])})`)
        }
        const completePayload = (await completeResponse.json().catch(() => ({}))) as ImageApiResponse
        const nextImages = completePayload.images ?? (completePayload.image ? [completePayload.image] : [])
        uploadedImages.push(...nextImages)
        setImages((current) => {
          const next = upsertImages(current, nextImages)
          imagesRef.current = next
          return next
        })
      }
      setImageUploadProgress(`Uppladdning klar: ${uploadedImages.length} bild${uploadedImages.length === 1 ? '' : 'er'}.`)
      return uploadedImages.map((image) => image.id)
    } catch (uploadError) {
      setImageError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bilder.')
      return uploadedImages.map((image) => image.id)
    } finally {
      setImageBusy(false)
      setImageDropBusySection(null)
      window.setTimeout(() => {
        setImageUploadProgress(null)
      }, 3500)
    }
  }

  const showPreviewImageAtOffset = (offset: number) => {
    if (previewImages.length === 0 || previewImageIndex < 0) return
    const nextIndex = (previewImageIndex + offset + previewImages.length) % previewImages.length
    setPreviewImageId(previewImages[nextIndex]?.id ?? null)
  }

  const renderImageViewCountButtons = () => {
    const imageViewCounts: TuImageViewCount[] = [9, 4, 1]
    return (
      <div className="flex flex-wrap gap-2">
        {imageViewCounts.map((count) => (
          <button
            key={count}
            type="button"
            onClick={() => setImageViewCount(count)}
            className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              imageViewCount === count
                ? 'border-violet-700 bg-violet-700 text-white'
                : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
            }`}
            aria-label={`Visa ${count} bild${count === 1 ? '' : 'er'}`}
            title={`Visa ${count} bild${count === 1 ? '' : 'er'}`}
          >
            <span
              aria-hidden="true"
              className={
                count === 9
                  ? 'grid h-5 w-5 grid-cols-3 gap-0.5'
                  : count === 4
                    ? 'grid h-5 w-5 grid-cols-2 gap-0.5'
                    : 'grid h-5 w-5 grid-cols-1 gap-0.5'
              }
            >
              {Array.from({ length: count }).map((_, index) => (
                <span
                  key={index}
                  className={`rounded-[1px] ${imageViewCount === count ? 'bg-white' : 'bg-gray-600'}`}
                />
              ))}
            </span>
          </button>
        ))}
      </div>
    )
  }

  const renderImagePreview = () => {
    if (!previewImage) return null
    const canNavigate = previewImages.length > 1 && previewImageIndex >= 0
    const previewImageActionBusy = imageBusy || imageActionIds.has(previewImage.id)
    const previewActionTarget = imageActionTargets[previewImage.id] ?? null
    const sectionLabel =
      previewImage.sectionKey === 'cover'
        ? 'Omslagsbild'
        : previewImage.sectionKey === 'appendix'
          ? 'Bildbilaga'
          : 'Bildbank'

    return (
      <div className="fixed inset-0 z-[90] bg-black/85 p-4" role="dialog" aria-modal="true">
        <div className="flex h-full flex-col">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/60">{sectionLabel}</div>
              <div className="text-xs font-semibold text-white/75">
                {canNavigate ? `${previewImageIndex + 1} / ${previewImages.length}` : ''}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPreviewImageId(null)}
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-white/20"
            >
              Stäng
            </button>
          </div>
          <div className="relative min-h-0 flex-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewImage.publicUrl} alt={previewImage.caption ?? ''} className="h-full w-full object-contain" />
            {canNavigate ? (
              <>
                <button
                  type="button"
                  onClick={() => showPreviewImageAtOffset(-1)}
                  className="absolute left-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/40 text-2xl leading-none text-white shadow-lg transition hover:bg-black/60"
                  aria-label="Föregående bild"
                  title="Föregående bild"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => showPreviewImageAtOffset(1)}
                  className="absolute right-2 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/40 text-2xl leading-none text-white shadow-lg transition hover:bg-black/60"
                  aria-label="Nästa bild"
                  title="Nästa bild"
                >
                  ›
                </button>
              </>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-white shadow-lg backdrop-blur">
            <div className="min-w-0 text-xs text-white/75">
              {previewImage.caption?.trim() ? previewImage.caption : 'Ingen bildtext angiven.'}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void moveImageToSection(previewImage.id, 'appendix')}
                disabled={locked || previewImageActionBusy || previewImage.sectionKey === 'appendix'}
                aria-busy={previewActionTarget === 'appendix'}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-white/25 bg-white px-3 text-xs font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-white/10 disabled:text-white/45"
              >
                {previewActionTarget === 'appendix' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <MoveDown size={14} aria-hidden />}
                {previewActionTarget === 'appendix'
                  ? 'Lägger till...'
                  : previewImage.sectionKey === 'appendix'
                    ? 'Finns i bilaga'
                    : 'Lägg till i bilaga'}
              </button>
              <button
                type="button"
                onClick={() => void moveImageToSection(previewImage.id, 'cover')}
                disabled={locked || previewImageActionBusy || previewImage.sectionKey === 'cover'}
                aria-busy={previewActionTarget === 'cover'}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/45"
              >
                {previewActionTarget === 'cover' ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ImageIcon size={14} aria-hidden />}
                {previewActionTarget === 'cover'
                  ? 'Väljer...'
                  : previewImage.sectionKey === 'cover'
                    ? 'Vald omslagsbild'
                    : 'Använd som omslagsbild'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const patchImageRequest = async (imageId: string, patch: Record<string, unknown>) => {
    const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageId, ...patch }),
    })
    const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
    if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara bild.')
    return payload.image ?? null
  }

  const patchImage = async (imageId: string, patch: Record<string, unknown>) => {
    if (locked) return null
    setImageBusy(true)
    setImageError(null)
    try {
      const savedImage = await patchImageRequest(imageId, patch)
      if (savedImage) {
        setImages((current) => {
          const next = upsertImages(current, [savedImage as TuInvestigationImage])
          imagesRef.current = next
          return next
        })
      }
      return savedImage
    } catch (patchError) {
      setImageError(patchError instanceof Error ? patchError.message : 'Kunde inte spara bild.')
      return null
    } finally {
      setImageBusy(false)
    }
  }

  const deleteImage = async (imageId: string) => {
    if (locked || imageBusy || imageActionIds.has(imageId)) return
    if (!confirm('Ta bort bilden?')) return
    setImageActionTarget(imageId, 'delete')
    setImageBusy(true)
    setImageError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort bild.')
      setImages((current) => {
        const next = current.filter((image) => image.id !== imageId)
        imagesRef.current = next
        return next
      })
    } catch (deleteError) {
      setImageError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort bild.')
    } finally {
      setImageBusy(false)
      setImageActionTarget(imageId, null)
    }
  }

  const firstSortOrderForSection = (sectionKey: TuImageSectionKey, excludeImageId: string) => {
    const sectionImages = images.filter((image) => {
      if (image.id === excludeImageId) return false
      return image.sectionKey === sectionKey
    })
    if (sectionImages.length === 0) return 10
    return Math.min(...sectionImages.map((image) => image.sortOrder)) - 10
  }

  const lastSortOrderForSection = (sectionKey: TuImageSectionKey, excludeImageId: string) => {
    const sectionImages = images.filter((image) => {
      if (image.id === excludeImageId) return false
      return image.sectionKey === sectionKey
    })
    if (sectionImages.length === 0) return 10
    return Math.max(...sectionImages.map((image) => image.sortOrder)) + 10
  }

  const moveImageToSection = async (imageId: string, sectionKey: TuImageSectionKey) => {
    if (locked || imageBusy || imageActionIds.has(imageId)) return
    const movingImage = images.find((image) => image.id === imageId)
    if (!movingImage) return
    if (movingImage.sectionKey === sectionKey) {
      showImageOperationMessage(`Bilden finns redan i ${imageSectionLabel(sectionKey)}.`)
      return
    }

    setImageActionTarget(imageId, sectionKey)
    setImageDropBusySection(sectionKey)

    try {
      if (sectionKey === 'cover') {
        for (const image of coverImages) {
          if (image.id !== imageId) {
            await patchImage(image.id, {
              sectionKey: 'bank',
              sortOrder: firstSortOrderForSection('bank', image.id),
            })
          }
        }
      }

      const movedImage = await patchImage(imageId, {
        sectionKey,
        sortOrder:
          sectionKey === 'appendix'
            ? lastSortOrderForSection(sectionKey, imageId)
            : firstSortOrderForSection(sectionKey, imageId),
      })
      if (movedImage) {
        showImageOperationMessage(`Bilden flyttades till ${imageSectionLabel(sectionKey)}.`)
      }
    } finally {
      setImageActionTarget(imageId, null)
      setImageDropBusySection(null)
    }
  }

  const handleDropToSection = async (event: React.DragEvent, sectionKey: TuImageSectionKey) => {
    event.preventDefault()
    setCoverDropActive(false)
    setBankDropActive(false)
    setAppendixDropActive(false)
    setAppendixInsertIndex(null)
    if (locked) return

    const droppedFiles = getDroppedImageFiles(event)
    if (droppedFiles.length > 0) {
      await uploadImages(sectionKey === 'cover' ? droppedFiles.slice(0, 1) : droppedFiles, sectionKey)
      return
    }

    const imageId = event.dataTransfer.getData(TU_IMAGE_DRAG_DATA_TYPE)
    if (imageId) {
      await moveImageToSection(imageId, sectionKey)
    }
  }

  const handleDragOverDropZone = (event: React.DragEvent) => {
    if (locked) return
    if (!hasExternalImageFiles(event) && !hasDraggedTuImage(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = hasExternalImageFiles(event) ? 'copy' : 'move'
  }

  const buildAppendixOrderUpdates = (visibleOrder: TuInvestigationImage[]) =>
    [...visibleOrder].reverse().map((image, index) => ({
      id: image.id,
      sortOrder: (index + 1) * 10,
    }))

  const applyAppendixVisibleOrder = (
    visibleOrder: TuInvestigationImage[],
    options: { movedImageId?: string } = {}
  ) => {
    const updates = buildAppendixOrderUpdates(visibleOrder)
    const updateById = new Map(updates.map((update) => [update.id, update.sortOrder]))

    setImages((currentImages) => {
      const nextImages = sortTuImages(
        currentImages.map((image) => {
          const sortOrder = updateById.get(image.id)
          if (sortOrder === undefined) return image
          return {
            ...image,
            sectionKey: image.id === options.movedImageId ? 'appendix' : image.sectionKey,
            sortOrder,
          }
        })
      )
      imagesRef.current = nextImages
      return nextImages
    })

    scheduleAppendixImageOrderSave(updates)
    return updates
  }

  const persistAppendixImageOrder = async (version: number) => {
    const updates = appendixReorderUpdatesRef.current
    if (updates.length === 0) {
      if (version === appendixReorderVersionRef.current) setAppendixReorderStatus('idle')
      return
    }

    setAppendixReorderStatus('saving')
    try {
      await Promise.all(
        updates.map((update) => patchImageRequest(update.id, { sortOrder: update.sortOrder }))
      )
    } catch (orderError) {
      setImageError(orderError instanceof Error ? orderError.message : 'Kunde inte spara bildordningen.')
    } finally {
      if (version === appendixReorderVersionRef.current) {
        appendixReorderUpdatesRef.current = []
        setAppendixReorderStatus('idle')
      }
    }
  }

  const scheduleAppendixImageOrderSave = (updates: AppendixImageOrderUpdate[]) => {
    appendixReorderUpdatesRef.current = updates
    appendixReorderVersionRef.current += 1
    const version = appendixReorderVersionRef.current
    setAppendixReorderStatus('queued')
    if (appendixReorderTimerRef.current) {
      window.clearTimeout(appendixReorderTimerRef.current)
    }
    appendixReorderTimerRef.current = window.setTimeout(() => {
      appendixReorderTimerRef.current = null
      void persistAppendixImageOrder(version)
    }, 550)
  }

  const insertImageInAppendixVisibleOrder = async (imageId: string, rawInsertIndex: number) => {
    if (locked || imageBusy || imageActionIds.has(imageId)) return
    const allImages = imagesRef.current
    const previousImages = allImages
    const movingImage = allImages.find((image) => image.id === imageId)
    if (!movingImage) return

    const currentVisibleOrder = sortTuImagesNewestFirst(
      allImages.filter((image) => image.sectionKey === 'appendix' && image.id !== imageId)
    )
    const originalVisibleIndex = sortTuImagesNewestFirst(
      allImages.filter((image) => image.sectionKey === 'appendix')
    ).findIndex((image) => image.id === imageId)
    const adjustedInsertIndex =
      originalVisibleIndex >= 0 && originalVisibleIndex < rawInsertIndex ? rawInsertIndex - 1 : rawInsertIndex
    const insertIndex = Math.max(0, Math.min(adjustedInsertIndex, currentVisibleOrder.length))
    const nextVisibleOrder = [...currentVisibleOrder]
    nextVisibleOrder.splice(insertIndex, 0, { ...movingImage, sectionKey: 'appendix' })

    const updates = applyAppendixVisibleOrder(nextVisibleOrder, { movedImageId: imageId })
    const movedUpdate = updates.find((update) => update.id === imageId)
    if (!movedUpdate) return

    if (movingImage.sectionKey !== 'appendix') {
      setImageActionTarget(imageId, 'appendix')
      setImageDropBusySection('appendix')
      setAppendixDropBusyIndex(insertIndex)
      try {
        const savedImage = await patchImageRequest(imageId, {
          sectionKey: 'appendix',
          sortOrder: movedUpdate.sortOrder,
        })
        if (savedImage) {
          setImages((current) => {
            const next = upsertImages(current, [savedImage as TuInvestigationImage])
            imagesRef.current = next
            return next
          })
        }
        showImageOperationMessage('Bilden lades in i bildbilagan.')
      } catch (moveError) {
        if (appendixReorderTimerRef.current) {
          window.clearTimeout(appendixReorderTimerRef.current)
          appendixReorderTimerRef.current = null
        }
        appendixReorderUpdatesRef.current = []
        appendixReorderVersionRef.current += 1
        setAppendixReorderStatus('idle')
        imagesRef.current = previousImages
        setImages(previousImages)
        setImageError(moveError instanceof Error ? moveError.message : 'Kunde inte lägga in bilden i bilagan.')
      } finally {
        setImageActionTarget(imageId, null)
        setImageDropBusySection(null)
        setAppendixDropBusyIndex(null)
      }
    }
  }

  const handleAppendixInsertDragOver = (event: React.DragEvent, insertIndex: number) => {
    if (locked) return
    if (!hasExternalImageFiles(event) && !hasDraggedTuImage(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = hasExternalImageFiles(event) ? 'copy' : 'move'
    setAppendixInsertIndex(insertIndex)
  }

  const handleAppendixInsertDrop = async (event: React.DragEvent, insertIndex: number) => {
    event.preventDefault()
    event.stopPropagation()
    setAppendixInsertIndex(null)
    if (locked) return

    const imageId = event.dataTransfer.getData(TU_IMAGE_DRAG_DATA_TYPE)
    if (imageId) {
      await insertImageInAppendixVisibleOrder(imageId, insertIndex)
      return
    }

    const droppedFiles = getDroppedImageFiles(event)
    if (droppedFiles.length > 0) {
      const uploadedImageIds = await uploadImages(droppedFiles, 'appendix')
      if (uploadedImageIds.length > 0) {
        const uploadedIdSet = new Set(uploadedImageIds)
        const allImages = imagesRef.current
        const uploadedImages = uploadedImageIds
          .map((uploadedImageId) => allImages.find((image) => image.id === uploadedImageId))
          .filter((image): image is TuInvestigationImage => Boolean(image))
        const currentVisibleOrder = sortTuImagesNewestFirst(
          allImages.filter((image) => image.sectionKey === 'appendix' && !uploadedIdSet.has(image.id))
        )
        const nextVisibleOrder = [...currentVisibleOrder]
        const insertAt = Math.max(0, Math.min(insertIndex, currentVisibleOrder.length))
        nextVisibleOrder.splice(insertAt, 0, ...uploadedImages)
        applyAppendixVisibleOrder(nextVisibleOrder)
      }
    }
  }

  const handleMoveAppendixImage = (imageId: string, visibleDirection: -1 | 1) => {
    if (locked || imageBusy || imageActionIds.has(imageId)) return
    const visibleOrder = sortTuImagesNewestFirst(
      imagesRef.current.filter((image) => image.sectionKey === 'appendix')
    )
    const currentIndex = visibleOrder.findIndex((image) => image.id === imageId)
    const targetIndex = currentIndex + visibleDirection
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= visibleOrder.length) return

    const nextVisibleOrder = [...visibleOrder]
    const current = nextVisibleOrder[currentIndex]
    const target = nextVisibleOrder[targetIndex]
    nextVisibleOrder[currentIndex] = target
    nextVisibleOrder[targetIndex] = current

    applyAppendixVisibleOrder(nextVisibleOrder)
  }

  const renderAppendixInsertZone = (insertIndex: number) => {
    const active = appendixInsertIndex === insertIndex || appendixDropBusyIndex === insertIndex
    return (
      <div
        aria-label="Släpp bild här i bildbilagan"
        onDragEnter={(event) => handleAppendixInsertDragOver(event, insertIndex)}
        onDragOver={(event) => handleAppendixInsertDragOver(event, insertIndex)}
        onDragLeave={() => {
          setAppendixInsertIndex((current) => (current === insertIndex ? null : current))
        }}
        onDrop={(event) => void handleAppendixInsertDrop(event, insertIndex)}
        className={`group flex h-5 items-center rounded-md transition ${
          locked ? 'pointer-events-none opacity-50' : ''
        }`}
      >
        <span
          className={`block h-1 w-full rounded-full border transition ${
            active
              ? 'border-violet-500 bg-violet-500 shadow-[0_0_0_4px_rgba(124,58,237,0.12)]'
              : 'border-transparent bg-transparent group-hover:border-violet-200 group-hover:bg-violet-100'
          }`}
        />
      </div>
    )
  }

  const uploadDocument = async (file: File | null | undefined) => {
    if (locked || !file) return

    setDocumentBusy(true)
    setDocumentError(null)
    try {
      const formData = new FormData()
      formData.set('file', file)

      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/documents`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as DocumentApiResponse
      if (!response.ok || !payload.document) {
        throw new Error(payload.error ?? 'Kunde inte ladda upp dokument.')
      }
      setDocuments((current) => upsertDocument(current, payload.document as TuInvestigationDocument))
    } catch (uploadError) {
      setDocumentError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp dokument.')
    } finally {
      setDocumentBusy(false)
    }
  }

  const deleteDocument = async (documentId: string) => {
    if (locked || documentBusy || documentActionTargets[documentId]) return
    if (!confirm('Ta bort dokumentet?')) return

    setDocumentActionTarget(documentId, 'delete')
    setDocumentBusy(true)
    setDocumentError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/documents`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      const payload = (await response.json().catch(() => ({}))) as DocumentApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ta bort dokument.')
      setDocuments((current) => current.filter((document) => document.id !== documentId))
    } catch (deleteError) {
      setDocumentError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort dokument.')
    } finally {
      setDocumentBusy(false)
      setDocumentActionTarget(documentId, null)
    }
  }

  const patchDocument = async (documentId: string, patch: Record<string, unknown>) => {
    if (locked || documentBusy || documentActionTargets[documentId]) return

    setDocumentActionTarget(documentId, 'include')
    setDocumentBusy(true)
    setDocumentError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/documents`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, ...patch }),
      })
      const payload = (await response.json().catch(() => ({}))) as DocumentApiResponse
      if (!response.ok || !payload.document) throw new Error(payload.error ?? 'Kunde inte spara dokument.')
      setDocuments((current) => upsertDocument(current, payload.document as TuInvestigationDocument))
    } catch (patchError) {
      setDocumentError(patchError instanceof Error ? patchError.message : 'Kunde inte spara dokument.')
    } finally {
      setDocumentBusy(false)
      setDocumentActionTarget(documentId, null)
    }
  }

  const handleDocumentDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDocumentDropActive(false)
    if (locked) return

    const file = getDroppedDocumentFile(event)
    if (!file) {
      setDocumentError('Släpp en PDF-, Word-, Excel- eller textfil här.')
      return
    }
    await uploadDocument(file)
  }

  return (
    <main className="min-h-screen bg-violet-50/40">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-6">
        <header className="space-y-4 border-b border-violet-100 pb-4">
          <Link
              href="/tu/investigations"
            className="inline-flex items-center gap-2 text-sm font-medium text-violet-800 hover:text-violet-950"
          >
            <ArrowLeft size={16} aria-hidden />
            Till tekniska utlåtanden
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">TU-utlåtande</p>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {investigation.property?.address || 'Ingen adress'} {investigation.property?.city || ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <p className="inline-flex items-center gap-2 whitespace-nowrap text-xs text-gray-600" aria-live="polite">
                <span className={`size-2 rounded-full ${systemStatusTone}`} />
                {systemStatusText}
              </p>
            </div>
          </div>
        </header>

        {error ? (
          <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}
        {locked ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Utlåtandet är låst och kan inte ändras.
          </div>
        ) : null}

        <div className={aiWorkflowEnabled ? 'grid items-start gap-5 lg:grid-cols-[250px_minmax(0,1fr)]' : ''}>
          {aiWorkflowEnabled ? (
            <TuWorkflowRail
              steps={workflowState.steps}
              current={workspaceView}
              onChange={setWorkspaceView}
              loading={workflowState.loading}
            />
          ) : null}
          <div className="flex min-w-0 flex-col gap-5">
          {workflowState.error && aiWorkflowEnabled ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              Statusen kunde inte uppdateras. Arbetsytan går fortfarande att använda.
            </div>
          ) : null}

        {aiWorkflowEnabled && workspaceView === 'field' ? (
          <TuFieldLogWorkspace
            inspectionId={investigation.inspectionId}
            locked={locked}
            images={images}
            queue={fieldQueue}
            onPreviewImage={setPreviewImageId}
            onOpenEvidence={() => setWorkspaceView('evidence')}
          />
        ) : aiWorkflowEnabled && workspaceView === 'evidence' ? (
          <TuEvidenceWorkspace
            inspectionId={investigation.inspectionId}
            refreshToken={fieldQueue.completedRevision}
            locked={locked}
            queue={fieldQueue}
            sections={draft.sections}
            images={images}
            imageBusy={imageBusy}
            onUploadImages={(files) => uploadImages(files, 'bank')}
            onSetImageSection={moveImageToSection}
            onPreviewImage={setPreviewImageId}
            onApplySuggestion={applyEvidenceSuggestion}
            onOpenReport={openReportWorkspace}
            onOpenAnalysis={() => setWorkspaceView('assessment')}
          />
        ) : aiWorkflowEnabled && workspaceView === 'assessment' ? (
          <TuAnalysisWorkspace
            inspectionId={investigation.inspectionId}
            refreshToken={fieldQueue.completedRevision}
            locked={locked}
            sections={draft.sections}
            images={images}
            queueCounts={fieldQueue.counts}
            onPreviewImage={setPreviewImageId}
            onOpenField={() => setWorkspaceView('field')}
            onOpenEvidence={() => setWorkspaceView('evidence')}
            onApplyReportDraft={applyWholeReportDraft}
            onOpenReport={() => openReportWorkspace()}
          />
        ) : workspaceView === 'delivery' ? (
          <div className="space-y-3">
            {!aiWorkflowEnabled ? (
              <button
                type="button"
                onClick={() => setWorkspaceView('report')}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
              >
                <ArrowLeft size={16} aria-hidden />
                Till granskningen
              </button>
            ) : null}
            <TuPrintActions
              inspectionId={investigation.inspectionId}
              finalizationBlockedReason={finalizationBlockedReason}
              stageLabel={aiWorkflowEnabled ? 'Steg 5' : 'Leverans'}
              onStatusChange={handleDeliveryStatusChange}
              onOpenEvidence={aiWorkflowEnabled ? () => setWorkspaceView('evidence') : undefined}
              onOpenReport={() => setWorkspaceView('report')}
            />
          </div>
        ) : (
          <>

        <div className="flex flex-col gap-4 rounded-lg border border-violet-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-violet-700">
              {aiWorkflowEnabled ? 'Steg 4' : 'Slutgranskning'}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950">Granska utlåtandet</h2>
            <p className="mt-1 max-w-2xl text-sm text-gray-600">
              Läs rapportdelarna och justera det som behövs. Förhandsgranska därefter rapporten innan du går vidare.
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <Link
              href={`/tu/investigations/${encodeURIComponent(investigation.inspectionId)}/print`}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
            >
              <Printer size={16} aria-hidden />
              Förhandsgranska utkast
            </Link>
            <button
              type="button"
              onClick={() => setWorkspaceView('delivery')}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
            >
              {locked ? 'Gå vidare till leverans' : 'Gå vidare till fastställande'}
              <ArrowRight size={16} aria-hidden />
            </button>
            <span className="text-xs text-gray-500">
              {locked
                ? 'Den fastställda revisionen kan nu skickas till mottagaren.'
                : 'Utlåtandet låses först när du väljer Fastställ utlåtandet.'}
            </span>
          </div>
        </div>

        {!aiWorkflowEnabled ? (
        <section className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-violet-700" aria-hidden />
                <h2 className="text-base font-semibold text-gray-950">AI-textstöd</h2>
              </div>
              <p className="mt-1 text-sm text-gray-600">
                Beskriv ärendet, observationer eller önskad ändring. Förslagen infogas först när du väljer det.
              </p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            <textarea
              value={aiPrompt}
              disabled={locked || aiBusy}
              onChange={(event) => setAiPrompt(event.target.value)}
              rows={4}
              className="w-full resize-y rounded-md border border-violet-200 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
              placeholder="Exempel: Skriv ett sakligt utlåtande om drag och misstänkt otäthet vid fönster. Underlaget är okulär kontroll och uppgifter från bostadsrättshavaren."
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void requestAiSuggestions()}
                disabled={locked || aiBusy}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Sparkles size={16} aria-hidden />
                {aiBusy ? 'Skapar förslag...' : 'Skapa textförslag'}
              </button>
              <button
                type="button"
                onClick={() => void requestAiSuggestions({ fillEmpty: true })}
                disabled={locked || aiBusy}
                className="inline-flex h-10 items-center rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                Fyll tomma sektioner
              </button>
              {aiSuggestions.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setAiSuggestions([])}
                  disabled={aiBusy}
                  className="inline-flex h-10 items-center rounded-md border border-gray-200 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                >
                  Rensa förslag
                </button>
              ) : null}
            </div>
            {aiError ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {aiError}
              </div>
            ) : null}
            {aiSuggestions.length > 0 ? (
              <div className="space-y-3">
                {aiSuggestions.map((suggestion, suggestionIndex) => (
                  <article
                    key={`${suggestion.sectionKey}:${suggestionIndex}`}
                    className="rounded-md border border-violet-100 bg-violet-50/40 p-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-semibold text-violet-950">
                          {getAiSectionTitle(draft, suggestion.sectionKey, suggestion.title)}
                        </h3>
                        <p className="mt-1 text-xs text-violet-700">AI-förslag, granska innan infogning.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void applyAiSuggestion(suggestion, 'replace')}
                          disabled={locked || aiBusy}
                          className="rounded-md bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-violet-800 disabled:bg-gray-300"
                        >
                          Ersätt
                        </button>
                        <button
                          type="button"
                          onClick={() => void applyAiSuggestion(suggestion, 'append')}
                          disabled={locked || aiBusy}
                          className="rounded-md border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:border-gray-200 disabled:text-gray-400"
                        >
                          Lägg till
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 whitespace-pre-wrap rounded-md border border-white bg-white px-3 py-2 text-sm leading-6 text-gray-800">
                      {suggestion.text}
                    </div>
                  </article>
                ))}
              </div>
            ) : null}
          </div>
        </section>
        ) : null}

        <section className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                <FileText size={18} aria-hidden />
              </div>
              <div>
                <h2 className="text-base font-semibold text-gray-950">Rapportuppgifter</h2>
                <p className="mt-1 text-sm text-gray-600">
                  Beställare och objekt visas i rapporthuvudet och rapportens första del.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReportDetailsOpen((current) => !current)}
              aria-expanded={reportDetailsOpen}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50"
            >
              {reportDetailsOpen ? <ChevronUp size={16} aria-hidden /> : <Pencil size={15} aria-hidden />}
              {reportDetailsOpen ? 'Stäng uppgifterna' : 'Redigera uppgifter'}
            </button>
          </div>

          {!reportDetailsOpen ? (
            <dl className="mt-4 grid gap-3 border-t border-violet-100 pt-4 md:grid-cols-2 lg:grid-cols-3">
              <ReadOnlyInfoRow label="Dokumentrubrik" value={title} />
              <ReadOnlyInfoRow label="Projekttyp" value={projectType} />
              <ReadOnlyInfoRow
                label="Objekt"
                value={objectAddress || investigation.propertyAddress || investigation.property?.address}
              />
              <ReadOnlyInfoRow label="Beställare" value={assignmentParties.customerName || customerName} />
              <ReadOnlyInfoRow label="Kontakt" value={customerContact} />
              <ReadOnlyInfoRow label="Besiktningsman" value={assignmentParties.inspectorName} />
            </dl>
          ) : (
            <div className="mt-4 space-y-5 border-t border-violet-100 pt-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-600">Dokumentrubrik</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    onBlur={() => void saveHeaderDetails()}
                    disabled={locked}
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </label>
                <label className="space-y-1">
                  <span className="block text-xs font-medium text-gray-600">Projekttyp</span>
                  <input
                    value={projectType}
                    onChange={(event) => setProjectType(event.target.value)}
                    onBlur={() => void saveHeaderDetails()}
                    disabled={locked}
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                  />
                </label>
              </div>

              <div className="grid gap-4 border-t border-violet-100 pt-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                <fieldset className="space-y-1">
                  <legend className="text-xs font-medium text-gray-600">Objekttyp</legend>
                  <div className="grid grid-cols-2 gap-1 rounded-md border border-gray-200 bg-gray-50 p-1">
                    {[
                      { value: 'villa' as const, label: 'Villa' },
                      { value: 'apartment' as const, label: 'BRF/lgh' },
                    ].map((option) => {
                      const active = objectDetails.objectType === option.value
                      return (
                        <button
                          key={option.value}
                          type="button"
                          disabled={locked}
                          aria-pressed={active}
                          onClick={() => updateObjectDetailsField('objectType', option.value, true)}
                          className={
                            active
                              ? 'rounded bg-violet-700 px-3 py-2 text-sm font-semibold text-white shadow-sm'
                              : 'rounded px-3 py-2 text-sm font-medium text-gray-700 transition hover:bg-white disabled:text-gray-400'
                          }
                        >
                          {option.label}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>

                <div className="grid gap-3 md:grid-cols-3">
                  {objectDetails.objectType === 'apartment' ? (
                    <>
                      <ObjectDetailsInput
                        label="BRF"
                        value={objectDetails.brfName}
                        disabled={locked}
                        onChange={(value) => updateObjectDetailsField('brfName', value)}
                        onBlur={() => void saveHeaderDetails()}
                      />
                      <ObjectDetailsInput
                        label="Lägenhetsnummer"
                        value={objectDetails.apartmentNumber}
                        disabled={locked}
                        onChange={(value) => updateObjectDetailsField('apartmentNumber', value)}
                        onBlur={() => void saveHeaderDetails()}
                      />
                      <ObjectDetailsInput
                        label="Bostadsrättshavare"
                        value={objectDetails.apartmentHolderName}
                        disabled={locked}
                        onChange={(value) => updateObjectDetailsField('apartmentHolderName', value)}
                        onBlur={() => void saveHeaderDetails()}
                      />
                    </>
                  ) : (
                    <ObjectDetailsInput
                      label="Fastighetsbeteckning"
                      value={objectDetails.cadastralId}
                      disabled={locked}
                      onChange={(value) => updateObjectDetailsField('cadastralId', value)}
                      onBlur={() => void saveHeaderDetails()}
                    />
                  )}
                </div>
              </div>

              <dl className="grid gap-3 border-t border-violet-100 pt-4 md:grid-cols-2 lg:grid-cols-4">
                <ReadOnlyInfoRow
                  label="Objektadress"
                  value={objectAddress || investigation.propertyAddress || investigation.property?.address}
                />
                <ReadOnlyInfoRow
                  label="Arbetsnummer"
                  value={investigation.assignmentNumber ?? investigation.inspection.assignment_number}
                />
                <ReadOnlyInfoRow
                  label="Besiktningsdag"
                  value={formatDisplayDate(investigation.date ?? investigation.inspection.date)}
                />
                <ReadOnlyInfoRow
                  label="Tid"
                  value={formatDisplayTime(investigation.inspectionTime ?? investigation.inspection.inspection_time)}
                />
              </dl>

              <div className="grid gap-4 border-t border-violet-100 pt-4 lg:grid-cols-2">
                <div className="rounded-md border border-gray-200 bg-gray-50/60 p-3">
                  <h3 className="mb-3 text-sm font-semibold text-gray-950">Beställare</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {CUSTOMER_PARTY_FIELDS.map((field) => (
                      <AssignmentPartiesInput
                        key={field.key}
                        field={field}
                        value={assignmentParties[field.key]}
                        disabled={locked}
                        onChange={(value) => updateAssignmentPartiesField(field.key, value)}
                        onBlur={() => void saveAssignmentParties()}
                      />
                    ))}
                  </div>
                </div>
                <div className="rounded-md border border-gray-200 bg-gray-50/60 p-3">
                  <h3 className="mb-3 text-sm font-semibold text-gray-950">Besiktningsman</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {INSPECTOR_PARTY_FIELDS.map((field) => (
                      <AssignmentPartiesInput
                        key={field.key}
                        field={field}
                        value={assignmentParties[field.key]}
                        disabled={locked}
                        readOnly
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section className="order-last rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-950">Omslagsbild</h2>
              <p className="mt-1 text-sm text-gray-600">
                Bilden visas på rapportens framsida. Välj en befintlig bild i bildbanken eller en ny bild från datorn.
              </p>
            </div>
            <button
              type="button"
              onClick={() => coverFileInputRef.current?.click()}
              disabled={locked || imageBusy}
              aria-busy={imageDropBusySection === 'cover'}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {imageDropBusySection === 'cover' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
              {imageDropBusySection === 'cover'
                ? 'Sparar omslagsbild...'
                : coverImage
                  ? 'Välj ny bild från datorn'
                  : 'Välj bild från datorn'}
            </button>
            <input
              ref={coverFileInputRef}
              type="file"
              accept={IMAGE_FILE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []).slice(0, 1)
                event.target.value = ''
                void uploadImages(files, 'cover')
              }}
            />
          </div>

          <div
            onDragEnter={() => !locked && setCoverDropActive(true)}
              onDragLeave={() => setCoverDropActive(false)}
              onDragOver={handleDragOverDropZone}
              onDrop={(event) => void handleDropToSection(event, 'cover')}
              className={`flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
              coverDropActive || imageDropBusySection === 'cover'
                ? 'border-violet-500 bg-violet-50 text-violet-900'
                : 'border-violet-200 bg-violet-50/50 text-gray-600'
            } ${locked ? 'opacity-60' : ''} ${imageDropBusySection === 'cover' ? 'cursor-wait ring-2 ring-violet-100' : ''}`}
              aria-busy={imageDropBusySection === 'cover'}
            >
              {coverImage ? (
                <div className="grid w-full gap-4 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                <div className="relative overflow-hidden rounded-md">
                  <button
                    type="button"
                    onClick={() => setPreviewImageId(coverImage.id)}
                    disabled={imageActionIds.has(coverImage.id)}
                    className="block overflow-hidden rounded-md text-left focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-wait"
                    aria-label="Visa omslagsbild"
                    title="Visa bild"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={coverImage.publicUrl}
                      alt={coverImage.caption ?? 'Omslagsbild'}
                      className={`aspect-[4/3] w-full object-cover ${imageActionIds.has(coverImage.id) ? 'opacity-55' : ''}`}
                    />
                  </button>
                  {imageActionIds.has(coverImage.id) ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/55 text-violet-900">
                      <Loader2 size={18} className="animate-spin" aria-hidden />
                    </div>
                  ) : null}
                </div>
                <div className="text-left">
                  <p className="text-sm font-semibold text-gray-950">Vald omslagsbild</p>
                  <p className="mt-1 text-sm text-gray-600">
                    Den här bilden används på rapportens framsida. Dra hit en annan bild från bildbanken om du vill byta.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void moveImageToSection(coverImage.id, 'bank')}
                      disabled={locked || imageBusy || imageActionIds.has(coverImage.id)}
                      aria-busy={imageActionTargets[coverImage.id] === 'bank'}
                      className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                    >
                      {imageActionTargets[coverImage.id] === 'bank' ? <Loader2 size={12} className="animate-spin" aria-hidden /> : null}
                      {imageActionTargets[coverImage.id] === 'bank' ? 'Flyttar...' : 'Flytta till bildbank'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteImage(coverImage.id)}
                      disabled={locked || imageBusy || imageActionIds.has(coverImage.id)}
                      aria-busy={imageActionTargets[coverImage.id] === 'delete'}
                      className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                      aria-label="Ta bort omslagsbild"
                      title="Ta bort omslagsbild"
                    >
                      {imageActionTargets[coverImage.id] === 'delete' ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <Trash2 size={10} aria-hidden />}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {imageDropBusySection === 'cover' ? (
                  <Loader2 size={24} className="mb-2 animate-spin text-violet-700" aria-hidden />
                ) : (
                  <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
                )}
                <p className="text-sm font-medium">
                  {imageDropBusySection === 'cover' ? 'Sparar omslagsbild...' : 'Släpp en bild här för att använda den som omslag'}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {imageDropBusySection === 'cover'
                    ? 'Vänta tills bilden är sparad.'
                    : 'Bilden läggs direkt på rapportens framsida. Du kan även öppna bildbanken och välja en befintlig bild.'}
                </p>
              </>
            )}
          </div>
        </section>

        <section className={`order-last grid gap-4 ${imageBankOpen ? 'lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]' : ''}`}>
          {imageError ? (
            <div
              ref={imageErrorRef}
              className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 lg:col-span-2"
              aria-live="polite"
            >
              {imageError}
            </div>
          ) : null}
          {imageUploadProgress ? (
            <div
              className="rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900 lg:col-span-2"
              aria-live="polite"
            >
              {imageUploadProgress}
            </div>
          ) : null}

          <article className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className={`flex flex-wrap items-center justify-between gap-3 ${imageBankOpen ? 'mb-3' : ''}`}>
              <div className="flex min-w-0 items-start gap-3">
                <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                  <Images size={18} aria-hidden />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-950">Bildbank</h2>
                  <p className="mt-1 text-sm text-gray-600">
                    {bankImages.length} bild{bankImages.length === 1 ? '' : 'er'} som kan användas som omslag eller i bildbilagan.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {imageBankOpen ? (
                  <>
                    {renderImageViewCountButtons()}
                    <button
                      type="button"
                      onClick={() => bankFileInputRef.current?.click()}
                      disabled={locked || imageBusy}
                      aria-busy={imageDropBusySection === 'bank'}
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {imageDropBusySection === 'bank' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
                      {imageDropBusySection === 'bank' ? 'Bearbetar...' : 'Ladda upp bilder'}
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setImageBankOpen((current) => !current)}
                  aria-expanded={imageBankOpen}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50"
                >
                  {imageBankOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                  {imageBankOpen ? 'Minimera' : 'Öppna bildbanken'}
                </button>
              </div>
              <input
                ref={bankFileInputRef}
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void uploadImages(files, 'bank')
                }}
              />
            </div>

            {imageBankOpen ? (
              <>
            <div
              onDragEnter={() => !locked && setBankDropActive(true)}
              onDragLeave={() => setBankDropActive(false)}
              onDragOver={handleDragOverDropZone}
              onDrop={(event) => void handleDropToSection(event, 'bank')}
              className={`mb-4 flex ${bankImages.length > 0 ? 'min-h-16 py-3' : 'min-h-28 py-5'} flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center transition ${
                bankDropActive || imageDropBusySection === 'bank'
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-violet-200 bg-violet-50/50 text-gray-600'
              } ${locked ? 'opacity-60' : ''} ${imageDropBusySection === 'bank' ? 'cursor-wait ring-2 ring-violet-100' : ''}`}
              aria-busy={imageDropBusySection === 'bank'}
            >
              {imageDropBusySection === 'bank' ? (
                <Loader2 size={24} className="mb-2 animate-spin text-violet-700" aria-hidden />
              ) : (
                <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
              )}
              <p className="text-sm font-medium">
                {imageDropBusySection === 'bank'
                  ? 'Flyttar till bildbank...'
                  : bankDropActive
                    ? 'Släpp för att flytta till bildbank'
                    : 'Släpp bilder här'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {imageDropBusySection === 'bank' ? 'Vänta tills bilden är sparad.' : 'Eller dra tillbaka bilder från bilagan.'}
              </p>
            </div>

            {imagesLoading ? (
              <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-800">
                Hämtar bilder...
              </div>
            ) : bankImages.length === 0 ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Bildbanken är tom.
              </div>
            ) : (
              <div className="max-h-[560px] overflow-y-auto pr-1">
                <div className={getTuImageGridClass(imageViewCount)}>
                  {bankImages.map((image) => {
                    const actionTarget = imageActionTargets[image.id] ?? null
                    const actionPending = Boolean(actionTarget)
                    return (
                    <div
                      key={image.id}
                      draggable={!locked && !actionPending && !imageBusy}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData(TU_IMAGE_DRAG_DATA_TYPE, image.id)
                      }}
                      className={`group relative overflow-hidden rounded-md border bg-white shadow-sm transition ${
                        actionPending ? 'cursor-wait border-violet-300 ring-2 ring-violet-100' : 'border-gray-200'
                      }`}
                      aria-busy={actionPending}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewImageId(image.id)}
                        disabled={actionPending}
                        className="block w-full overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-wait"
                        aria-label="Visa bild"
                        title="Visa bild"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.publicUrl}
                          alt={image.caption ?? 'TU-bild'}
                          className={`${getTuImageClass(imageViewCount)} ${actionPending ? 'opacity-55' : ''}`}
                        />
                      </button>
                      {actionPending ? (
                        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 bg-white/55 text-xs font-semibold text-violet-900">
                          <Loader2 size={18} className="animate-spin" aria-hidden />
                          {actionTarget === 'appendix'
                            ? 'Lägger i bilaga'
                            : actionTarget === 'cover'
                              ? 'Väljer omslag'
                              : actionTarget === 'delete'
                                ? 'Tar bort'
                                : 'Sparar'}
                        </div>
                      ) : null}
                      <div className="absolute bottom-1.5 right-1.5 flex gap-1 rounded-md bg-white/45 p-0.5 opacity-65 shadow-sm ring-1 ring-black/5 transition group-hover:bg-white/80 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void moveImageToSection(image.id, 'cover')
                          }}
                          disabled={locked || imageBusy || actionPending}
                          aria-busy={actionTarget === 'cover'}
                          className="inline-flex h-6 w-6 items-center justify-center rounded bg-violet-700/75 text-white transition hover:bg-violet-800 hover:opacity-100 disabled:cursor-not-allowed disabled:bg-gray-300/60"
                          aria-label="Använd som omslag"
                          title="Använd som omslag"
                        >
                          {actionTarget === 'cover' ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <ImageIcon size={11} aria-hidden />}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            void moveImageToSection(image.id, 'appendix')
                          }}
                          disabled={locked || imageBusy || actionPending}
                          aria-busy={actionTarget === 'appendix'}
                          className="inline-flex h-6 w-6 items-center justify-center rounded border border-violet-200/70 bg-white/75 text-violet-800 transition hover:bg-violet-50 hover:opacity-100 disabled:cursor-not-allowed disabled:border-gray-200/70 disabled:text-gray-400"
                          aria-label="Lägg i bilaga"
                          title="Lägg i bilaga"
                        >
                          {actionTarget === 'appendix' ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <MoveDown size={11} aria-hidden />}
                        </button>
                      </div>
                    </div>
                    )
                  })}
                </div>
              </div>
            )}
              </>
            ) : null}
          </article>

          <article className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Bildbilaga</h2>
              <p className="mt-1 text-sm text-gray-600">
                {appendixImages.length} bild{appendixImages.length === 1 ? '' : 'er'} i bilagan.
              </p>
              {appendixReorderStatus !== 'idle' ? (
                <p className="mt-1 inline-flex items-center gap-1.5 text-xs font-medium text-violet-700">
                  <Loader2 size={12} className="animate-spin" aria-hidden />
                  {appendixReorderStatus === 'queued' ? 'Ordningen sparas strax...' : 'Sparar bildordning...'}
                </p>
              ) : null}
            </div>
              <button
                type="button"
                onClick={() => appendixFileInputRef.current?.click()}
                disabled={locked || imageBusy}
                aria-busy={imageDropBusySection === 'appendix'}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                {imageDropBusySection === 'appendix' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
                {imageDropBusySection === 'appendix' ? 'Bearbetar...' : 'Direkt till bilaga'}
              </button>
              <input
                ref={appendixFileInputRef}
                type="file"
                accept={IMAGE_FILE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => {
                  const files = Array.from(event.target.files ?? [])
                  event.target.value = ''
                  void uploadImages(files, 'appendix')
                }}
              />
            </div>

            <div
              onDragEnter={() => !locked && setAppendixDropActive(true)}
              onDragLeave={() => setAppendixDropActive(false)}
              onDragOver={handleDragOverDropZone}
              onDrop={(event) => void handleDropToSection(event, 'appendix')}
              className={`mb-4 flex ${appendixImages.length > 0 ? 'min-h-16 py-3' : 'min-h-28 py-5'} flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center transition ${
                appendixDropActive || imageDropBusySection === 'appendix'
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-violet-200 bg-violet-50/50 text-gray-600'
              } ${locked ? 'opacity-60' : ''} ${imageDropBusySection === 'appendix' ? 'cursor-wait ring-2 ring-violet-100' : ''}`}
              aria-busy={imageDropBusySection === 'appendix'}
            >
              {imageDropBusySection === 'appendix' ? (
                <Loader2 size={24} className="mb-2 animate-spin text-violet-700" aria-hidden />
              ) : (
                <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
              )}
              <p className="text-sm font-medium">
                {imageDropBusySection === 'appendix'
                  ? 'Lägger till i bilagan...'
                  : appendixDropActive
                    ? 'Släpp för att lägga i bildbilaga'
                    : 'Släpp bilder i bilagan'}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {imageDropBusySection === 'appendix'
                  ? 'Vänta tills bilden är sparad innan du släpper nästa.'
                  : 'Senaste bilden visas överst här. Utskriften följer ordningen bilderna lades till.'}
              </p>
            </div>

            {appendixImages.length === 0 ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Bildbilagan är tom.
              </div>
            ) : (
              <div className="max-h-[640px] space-y-3 overflow-y-auto pr-1">
                {renderAppendixInsertZone(0)}
                {appendixImagesForEditor.map((image, visibleIndex) => {
                  const printIndex = appendixImages.findIndex((appendixImage) => appendixImage.id === image.id)
                  const printNumber = printIndex >= 0 ? printIndex + 1 : null
                  const actionTarget = imageActionTargets[image.id] ?? null
                  const actionPending = Boolean(actionTarget)

                  return (
                    <div key={image.id} className="space-y-3">
                      <div
                        draggable={!locked && !imageBusy && !actionPending}
                        onDragStart={(event) => {
                          event.dataTransfer.effectAllowed = 'move'
                          event.dataTransfer.setData(TU_IMAGE_DRAG_DATA_TYPE, image.id)
                        }}
                        className={`grid gap-3 rounded-md border bg-white p-2 shadow-sm transition sm:grid-cols-[112px_minmax(0,1fr)] ${
                          actionPending ? 'cursor-wait border-violet-300 ring-2 ring-violet-100' : 'border-gray-200'
                        }`}
                        aria-busy={actionPending}
                      >
                      <div className="relative overflow-hidden rounded-md sm:w-28">
                        <button
                          type="button"
                          onClick={() => setPreviewImageId(image.id)}
                          disabled={actionPending}
                          className="block overflow-hidden rounded-md text-left focus:outline-none focus:ring-2 focus:ring-violet-300 disabled:cursor-wait"
                          aria-label="Visa bilagebild"
                          title="Visa bild"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={image.publicUrl}
                            alt={image.caption ?? 'Bilagebild'}
                            className={`aspect-square w-full object-cover ${actionPending ? 'opacity-55' : ''}`}
                          />
                        </button>
                        {actionPending ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-white/55 text-[11px] font-semibold text-violet-900">
                            <Loader2 size={16} className="animate-spin" aria-hidden />
                            {actionTarget === 'bank'
                              ? 'Flyttar'
                              : actionTarget === 'cover'
                                ? 'Väljer omslag'
                                : actionTarget === 'delete'
                                  ? 'Tar bort'
                                  : 'Sparar'}
                          </div>
                        ) : null}
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-medium text-gray-600">
                            Bildtext{printNumber ? ` · Utskrift #${printNumber}` : ''}
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleMoveAppendixImage(image.id, -1)}
                              disabled={locked || imageBusy || actionPending || visibleIndex <= 0}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                              aria-label="Flytta upp i listan"
                              title="Flytta upp i listan"
                            >
                              <MoveUp size={10} aria-hidden />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleMoveAppendixImage(image.id, 1)}
                              disabled={locked || imageBusy || actionPending || visibleIndex === appendixImagesForEditor.length - 1}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                              aria-label="Flytta ned i listan"
                              title="Flytta ned i listan"
                            >
                              <MoveDown size={10} aria-hidden />
                            </button>
                          <button
                            type="button"
                            onClick={() => void moveImageToSection(image.id, 'bank')}
                            disabled={locked || imageBusy || actionPending}
                            aria-busy={actionTarget === 'bank'}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                            aria-label="Flytta till bildbank"
                            title="Flytta till bildbank"
                          >
                            {actionTarget === 'bank' ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <ImageIcon size={10} aria-hidden />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void moveImageToSection(image.id, 'cover')}
                            disabled={locked || imageBusy || actionPending}
                            aria-busy={actionTarget === 'cover'}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] bg-violet-700 text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                            aria-label="Använd som omslag"
                            title="Använd som omslag"
                          >
                            {actionTarget === 'cover' ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <Upload size={10} aria-hidden />}
                          </button>
                          <button
                            type="button"
                            onClick={() => void deleteImage(image.id)}
                            disabled={locked || imageBusy || actionPending}
                            aria-busy={actionTarget === 'delete'}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-[3px] border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                            aria-label="Ta bort bild"
                            title="Ta bort bild"
                          >
                            {actionTarget === 'delete' ? <Loader2 size={10} className="animate-spin" aria-hidden /> : <Trash2 size={10} aria-hidden />}
                          </button>
                        </div>
                      </div>
                      <textarea
                        value={image.caption ?? ''}
                        rows={3}
                        disabled={locked || actionPending}
                        onChange={(event) => {
                          const caption = event.target.value
                          setImages((current) => {
                            const next = current.map((currentImage) =>
                              currentImage.id === image.id ? { ...currentImage, caption } : currentImage
                            )
                            imagesRef.current = next
                            return next
                          })
                        }}
                        onBlur={(event) => void patchImage(image.id, { caption: event.target.value })}
                        className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="Plats, byggnadsdel och vad bilden visar"
                      />
                      {!image.caption?.trim() || /^(?:bild|foto|besiktningsbild)(?:\s+\d+)?$/i.test(image.caption.trim()) ? (
                        <p className="text-xs font-medium text-amber-700">
                          Lägg till en beskrivande bildtext innan utlåtandet fastställs.
                        </p>
                      ) : null}
                      </div>
                      </div>
                      {renderAppendixInsertZone(visibleIndex + 1)}
                    </div>
                  )
                })}
              </div>
            )}
          </article>
        </section>

        <section className="order-last rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className={`flex flex-wrap items-center justify-between gap-3 ${deliveryDocumentsOpen ? 'mb-3' : ''}`}>
            <div className="flex min-w-0 items-start gap-3">
              <div className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                <Paperclip size={18} aria-hidden />
              </div>
              <div>
              <h2 className="text-base font-semibold text-gray-950">Leveransbilagor <span className="font-normal text-gray-500">(valfritt)</span></h2>
              <p className="mt-1 text-sm text-gray-600">
                Extra filer som mottagaren ska kunna ladda ner tillsammans med utlåtandet. De används inte när AI skriver rapporttexten.
                {documents.length > 0
                  ? ` ${deliveryDocumentCount} av ${documents.length} dokument inkluderas i leveransen.`
                  : ''}
              </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {deliveryDocumentsOpen ? (
                <button
                  type="button"
                  onClick={() => documentFileInputRef.current?.click()}
                  disabled={locked || documentBusy}
                  aria-busy={documentBusy}
                  className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {documentBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
                  {documentBusy ? 'Arbetar...' : 'Ladda upp bilaga'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setDeliveryDocumentsOpen((current) => !current)}
                aria-expanded={deliveryDocumentsOpen}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50"
              >
                {deliveryDocumentsOpen ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
                {deliveryDocumentsOpen ? 'Minimera' : 'Hantera bilagor'}
              </button>
            </div>
            <input
              ref={documentFileInputRef}
              type="file"
              accept={DOCUMENT_FILE_ACCEPT}
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null
                event.target.value = ''
                void uploadDocument(file)
              }}
            />
          </div>

          {deliveryDocumentsOpen ? (
            <>
          <div
            onDragEnter={() => !locked && setDocumentDropActive(true)}
            onDragLeave={() => setDocumentDropActive(false)}
            onDragOver={(event) => {
              if (locked || !hasExternalImageFiles(event)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => void handleDocumentDrop(event)}
            className={`mb-4 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
              documentDropActive || documentBusy
                ? 'border-violet-500 bg-violet-50 text-violet-900'
                : 'border-violet-200 bg-violet-50/50 text-gray-600'
            } ${locked ? 'opacity-60' : ''} ${documentBusy ? 'cursor-wait ring-2 ring-violet-100' : ''}`}
            aria-busy={documentBusy}
          >
            {documentBusy ? (
              <Loader2 size={24} className="mb-2 animate-spin text-violet-700" aria-hidden />
            ) : (
              <FileText size={24} className="mb-2 text-violet-500" aria-hidden />
            )}
            <p className="text-sm font-medium">
              {documentBusy ? 'Sparar dokument...' : documentDropActive ? 'Släpp för att ladda upp dokument' : 'Släpp dokument här'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {documentBusy ? 'Vänta tills dokumentet är sparat.' : 'PDF, Word, Excel eller textfil. Max 25 MB.'}
            </p>
          </div>

          {documentsLoading ? (
            <div className="rounded-md border border-violet-100 bg-violet-50 px-3 py-2 text-sm text-violet-800">
              Hämtar dokument...
            </div>
          ) : documents.length === 0 ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
              Inga dokument uppladdade.
            </div>
          ) : (
            <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {documents.map((document) => {
                const documentActionTarget = documentActionTargets[document.id] ?? null
                const documentActionPending = Boolean(documentActionTarget)
                return (
                <div
                  key={document.id}
                  className={`flex flex-col gap-3 px-3 py-3 transition sm:flex-row sm:items-center sm:justify-between ${
                    documentActionPending ? 'cursor-wait bg-violet-50/50' : ''
                  }`}
                  aria-busy={documentActionPending}
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                      {documentActionPending ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <FileText size={18} aria-hidden />}
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-gray-950">
                        {document.title || document.fileName || 'Dokument'}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                        {document.fileName ? <span>{document.fileName}</span> : null}
                        {formatFileSize(document.fileSizeBytes) ? <span>{formatFileSize(document.fileSizeBytes)}</span> : null}
                        {document.createdAt ? (
                          <span>{new Date(document.createdAt).toLocaleDateString('sv-SE')}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <label className="inline-flex min-h-9 items-center gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 text-xs font-semibold text-violet-800">
                      <input
                        type="checkbox"
                        checked={document.includeInDelivery}
                        disabled={locked || documentBusy || documentActionPending}
                        onChange={(event) =>
                          void patchDocument(document.id, { includeInDelivery: event.target.checked })
                        }
                        className="h-4 w-4 rounded border-violet-300 text-violet-700 focus:ring-violet-500 disabled:cursor-not-allowed"
                      />
                      Inkludera i leverans
                    </label>
                    {document.signedUrl ? (
                      <a
                        href={document.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50"
                      >
                        Öppna
                      </a>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void deleteDocument(document.id)}
                      disabled={locked || documentBusy || documentActionPending}
                      aria-busy={documentActionTarget === 'delete'}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                      aria-label="Ta bort dokument"
                      title="Ta bort dokument"
                    >
                      {documentActionTarget === 'delete' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Trash2 size={16} aria-hidden />}
                    </button>
                  </div>
                </div>
                )
              })}
            </div>
          )}
            </>
          ) : null}
        </section>

        {documentError ? (
          <div className="order-last rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {documentError}
          </div>
        ) : null}

        <section className="space-y-4">
          <div className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Utlåtandets delar</h2>
                <p className="mt-1 max-w-2xl text-sm text-gray-600">
                  Läs varje rapportdel. Du kan redigera texten direkt eller be AI att justera en del eller hela utlåtandet.
                </p>
              </div>
              {aiWorkflowEnabled ? (
                <button
                  type="button"
                  onClick={() => setReportReviewTarget(null)}
                  disabled={locked}
                  title="Beskriv en ändring som AI ska tillämpa och kontrollera i hela utlåtandet"
                  className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                >
                  <MessageSquareText size={16} aria-hidden />
                  Justera hela med AI
                </button>
              ) : null}
            </div>
            {sectionTypeOptions.length === 0 ? (
              <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                Det finns inga aktiva TU-rubriker i admin. Kör seed-migrationen eller lägg in rubriker i
                admin innan nya delar kan läggas till.
              </div>
            ) : null}
          </div>

          {reportEditorSections.map((section, index) => {
            const sectionId = getSectionInstanceId(section)
            const sectionNumberLabel = String(visibleSections.findIndex((item) => getSectionInstanceId(item) === sectionId) + 1)
            const isProtected = PROTECTED_SECTION_KEYS.has(section.key)
            const canChangeSectionType = !isProtected && !section.isRequired
            const canDeleteSection = !isProtected && !section.isRequired && section.allowDelete !== false
            const collapsed = collapsedSections.has(sectionId)
            const canMoveUp = index > 0 && !isProtected
            const canMoveDown = index < reportEditorSections.length - 1 && !isProtected
            const sectionOptions = sectionTypeOptions.some((option) => option.key === section.key)
              ? sectionTypeOptions
              : [{ key: section.key, title: section.title }, ...sectionTypeOptions]

            return (
              <div key={sectionId} className="space-y-2">
                <article
                  id={`tu-section-${sectionId}`}
                  className="rounded-lg border border-violet-100 bg-white p-4 shadow-sm"
                >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-gray-950">{sectionNumberLabel}.</span>
                    {!canChangeSectionType ? (
                      <h2 className="text-base font-semibold text-gray-950">{section.title}</h2>
                    ) : (
                      <select
                        value={section.key}
                        disabled={locked}
                        onChange={(event) =>
                          void changeReportSectionType(sectionId, event.target.value as TuReportSectionKey)
                        }
                        className="h-9 min-w-[260px] rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                        aria-label="Välj deltyp"
                      >
                        {sectionOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.title}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!HIDDEN_SECTION_KEYS.has(section.key) ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (aiWorkflowEnabled) {
                            setReportReviewTarget({ id: sectionId, title: section.title })
                            return
                          }
                          void requestAiSuggestions({ sectionKey: section.key })
                        }}
                        disabled={locked || aiBusy}
                        title={aiWorkflowEnabled ? 'Ge AI en instruktion för rapportdelen' : 'Skapa AI-förslag för sektionen'}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                      >
                        {aiWorkflowEnabled ? <MessageSquareText size={15} aria-hidden /> : <Sparkles size={15} aria-hidden />}
                        {aiWorkflowEnabled ? 'Justera med AI' : 'AI'}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => void moveReportSection(sectionId, -1)}
                      disabled={locked || !canMoveUp}
                      title="Flytta upp"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                    >
                      <MoveUp size={15} aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => void moveReportSection(sectionId, 1)}
                      disabled={locked || !canMoveDown}
                      title="Flytta ned"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                    >
                      <MoveDown size={15} aria-hidden />
                    </button>
                    {canDeleteSection ? (
                      <button
                        type="button"
                        onClick={() => void removeReportSection(sectionId)}
                        disabled={locked}
                        title="Ta bort del"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapsedById(sectionId)}
                      aria-expanded={!collapsed}
                      aria-controls={`tu-section-${sectionId}`}
                      title={collapsed ? 'Visa sektion' : 'Minimera sektion'}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50"
                    >
                      {collapsed ? <ChevronDown size={17} aria-hidden /> : <ChevronUp size={17} aria-hidden />}
                    </button>
                  </div>
                </div>

                {collapsed ? null : (
                  <div className="space-y-4">
                    <DebouncedTextarea
                      value={section.text}
                      draftKey={`tu:${investigation.inspectionId}:${sectionId}`}
                      data-tu-section-textarea="true"
                      disabled={locked}
                      rows={7}
                      className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                      onValueChange={(value) => {
                        const nextDraft = cloneDraftWithSectionId(draftRef.current, sectionId, value)
                        draftRef.current = nextDraft
                        setDraft(nextDraft)
                      }}
                      onSave={(value) => saveSectionById(sectionId, value)}
                    />

                    <div className="rounded-md border border-gray-200 bg-gray-50/60 p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-950">Underrubriker</h3>
                      </div>

                      {(section.subsections ?? []).length === 0 ? (
                        <div className="rounded-md border border-dashed border-gray-200 bg-white px-3 py-3 text-sm text-gray-500">
                          Inga underrubriker tillagda.
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {(section.subsections ?? []).map((subsection, subsectionIndex, allSubsections) => (
                            <div
                              key={subsection.id}
                              className="rounded-md border border-gray-200 bg-white p-3 shadow-sm"
                            >
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="min-w-[2.75rem] text-sm font-semibold text-violet-900">
                                  {sectionNumberLabel}.{subsectionIndex + 1}
                                </span>
                                <input
                                  value={subsection.title}
                                  disabled={locked}
                                  onChange={(event) =>
                                    updateReportSubsectionTitle(sectionId, subsection.id, event.target.value)
                                  }
                                  onBlur={(event) =>
                                    void saveReportSubsectionTitle(sectionId, subsection.id, event.target.value)
                                  }
                                  className="h-9 min-w-[220px] flex-1 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                                  aria-label="Underrubrik"
                                />
                                <button
                                  type="button"
                                  onClick={() => void moveReportSubsection(sectionId, subsection.id, -1)}
                                  disabled={locked || subsectionIndex === 0}
                                  title="Flytta underrubrik upp"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                                >
                                  <MoveUp size={14} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void moveReportSubsection(sectionId, subsection.id, 1)}
                                  disabled={locked || subsectionIndex === allSubsections.length - 1}
                                  title="Flytta underrubrik ned"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                                >
                                  <MoveDown size={14} aria-hidden />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void removeReportSubsection(sectionId, subsection.id)}
                                  disabled={locked}
                                  title="Ta bort underrubrik"
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                                >
                                  <Trash2 size={14} aria-hidden />
                                </button>
                              </div>
                              <DebouncedTextarea
                                value={subsection.text}
                                draftKey={`tu:${investigation.inspectionId}:${sectionId}:${subsection.id}`}
                                disabled={locked}
                                rows={4}
                                className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                                onValueChange={(value) => {
                                  const nextDraft = cloneDraftWithSubsection(draftRef.current, sectionId, subsection.id, { text: value })
                                  draftRef.current = nextDraft
                                  setDraft(nextDraft)
                                }}
                                onSave={(value) => saveReportSubsectionText(sectionId, subsection.id, value)}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="mt-3 flex justify-end">
                        <button
                          type="button"
                          onClick={() => void addReportSubsection(sectionId)}
                          disabled={locked}
                          className="inline-flex h-8 items-center gap-2 rounded-md border border-violet-200 bg-white px-2.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                        >
                          <Plus size={14} aria-hidden />
                          Lägg till underrubrik
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                </article>

                {!locked && sectionTypeOptions.length > 0 ? (
                  <div className="flex flex-col gap-2 border-l border-dashed border-violet-200 pl-3 sm:ml-4 sm:flex-row sm:items-center">
                    <label className="flex flex-col gap-1 sm:flex-row sm:items-center">
                      <span className="text-xs font-medium text-gray-600">Ny del här</span>
                      <select
                        value={newSectionKey}
                        onChange={(event) => setNewSectionKey(event.target.value as TuReportSectionKey)}
                        className="h-9 min-w-[220px] rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                      >
                        {sectionTypeOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void addReportSection(sectionId)}
                      className="inline-flex h-9 items-center justify-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50"
                    >
                      <Plus size={14} aria-hidden />
                      Lägg till del här
                    </button>
                  </div>
                ) : null}
              </div>
            )
          })}
        </section>
          </>
        )}
          </div>
        </div>
        {reportReviewTarget !== undefined ? (
          <TuReportReviewDrawer
            inspectionId={investigation.inspectionId}
            locked={locked}
            target={reportReviewTarget}
            onClose={() => setReportReviewTarget(undefined)}
            onApplySections={applyWholeReportDraft}
          />
        ) : null}
        {renderImagePreview()}
      </div>
    </main>
  )
}
