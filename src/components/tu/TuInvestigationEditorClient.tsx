'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ChevronDown, ChevronUp, FileText, Image as ImageIcon, MoveDown, MoveUp, Printer, Sparkles, Trash2, Upload } from 'lucide-react'
import DebouncedTextarea from '@/components/ob/DebouncedTextarea'
import type { TuInvestigationDetails, TuReportDraft, TuReportSectionKey } from '@/lib/tu/server'

const TU_IMAGE_DRAG_DATA_TYPE = 'application/x-tu-image-id'
const IMAGE_FILE_ACCEPT = 'image/*'
const DOCUMENT_FILE_ACCEPT = '.pdf,.doc,.docx,.xls,.xlsx,.txt,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/plain'

type TuImageSectionKey = 'bank' | 'appendix'

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
  error?: string
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

type AssignmentPartiesFieldKey =
  | 'customerName'
  | 'customerRole'
  | 'customerIdentityNumber'
  | 'customerAddress'
  | 'customerPhone'
  | 'customerEmail'
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

const EMPTY_ASSIGNMENT_PARTIES_FORM: AssignmentPartiesForm = {
  customerName: '',
  customerRole: '',
  customerIdentityNumber: '',
  customerAddress: '',
  customerPhone: '',
  customerEmail: '',
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
      if (label === 'e-post') parsed.customerEmail = value
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
      if (label === 'e-post') parsed.inspectorEmail = value
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
  return {
    sections: draft.sections.map((section) => (section.key === key ? { ...section, text } : section)),
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
  return file.type.toLowerCase().startsWith('image/')
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

export default function TuInvestigationEditorClient({
  initialInvestigation,
}: {
  initialInvestigation: TuInvestigationDetails
}) {
  const [investigation, setInvestigation] = useState(initialInvestigation)
  const [draft, setDraft] = useState<TuReportDraft>(initialInvestigation.reportDraft)
  const [title, setTitle] = useState(initialInvestigation.title)
  const [objectDetails, setObjectDetails] = useState<ObjectDetailsForm>(() =>
    buildObjectDetailsForm(initialInvestigation)
  )
  const [assignmentParties, setAssignmentParties] = useState<AssignmentPartiesForm>(() =>
    buildAssignmentPartiesForm(initialInvestigation)
  )
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [images, setImages] = useState<TuInvestigationImage[]>([])
  const [imagesLoading, setImagesLoading] = useState(true)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<TuInvestigationDocument[]>([])
  const [documentsLoading, setDocumentsLoading] = useState(true)
  const [documentBusy, setDocumentBusy] = useState(false)
  const [documentError, setDocumentError] = useState<string | null>(null)
  const [documentDropActive, setDocumentDropActive] = useState(false)
  const [bankDropActive, setBankDropActive] = useState(false)
  const [appendixDropActive, setAppendixDropActive] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Set<TuReportSectionKey>>(() => new Set())
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiSuggestions, setAiSuggestions] = useState<TuAiSuggestion[]>([])
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const draftRef = useRef(initialInvestigation.reportDraft)
  const objectDetailsRef = useRef(objectDetails)
  const assignmentPartiesRef = useRef(assignmentParties)
  const bankFileInputRef = useRef<HTMLInputElement>(null)
  const appendixFileInputRef = useRef<HTMLInputElement>(null)
  const documentFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])

  useEffect(() => {
    objectDetailsRef.current = objectDetails
  }, [objectDetails])

  useEffect(() => {
    assignmentPartiesRef.current = assignmentParties
  }, [assignmentParties])

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
    setSaveState('saving')
    setError(null)
    const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      setSaveState('idle')
      throw new Error(payload.error ?? 'Kunde inte spara TU-utredningen.')
    }
    if (payload.investigation) {
      setInvestigation(payload.investigation)
      if (payload.investigation.reportDraft) {
        setDraft(payload.investigation.reportDraft)
        draftRef.current = payload.investigation.reportDraft
      }
    }
    setSaveState('saved')
  }

  const saveHeaderDetails = async (nextObjectDetails = objectDetailsRef.current) => {
    try {
      await savePatch({
        title,
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

  const saveSection = async (key: TuReportSectionKey, value: string) => {
    const nextDraft = cloneDraftWithSection(draftRef.current, key, value)
    draftRef.current = nextDraft
    setDraft(nextDraft)
    try {
      await savePatch({ reportDraft: nextDraft })
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara avsnittet.')
      throw saveError
    }
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

  const toggleSectionCollapsed = (key: TuReportSectionKey) => {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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

  const locked = Boolean(investigation.reportLockedAt)
  const bankImages = images.filter((image) => image.sectionKey !== 'appendix')
  const appendixImages = images.filter((image) => image.sectionKey === 'appendix')
  const objectAddress = joinDisplay([
    investigation.property?.address ?? investigation.propertyAddress,
    joinDisplay([investigation.property?.postal_code, investigation.property?.city ?? investigation.propertyCity]),
  ])
  const customerName = investigation.assignment?.customer_name ?? investigation.inspection.customer_name
  const customerContact = joinDisplay([
    investigation.assignment?.customer_phone ?? investigation.inspection.customer_phone,
    investigation.assignment?.customer_email ?? investigation.inspection.customer_email,
  ])

  const uploadImages = async (files: File[], sectionKey: TuImageSectionKey) => {
    if (locked || files.length === 0) return
    const imageFiles = files.filter(isImageFile)
    if (imageFiles.length === 0) {
      setImageError('Endast bildfiler kan laddas upp.')
      return
    }

    setImageBusy(true)
    setImageError(null)
    try {
      const formData = new FormData()
      formData.set('sectionKey', sectionKey)
      for (const file of imageFiles) formData.append('files', file)

      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte ladda upp bilder.')
      setImages((current) => upsertImages(current, payload.images ?? []))
    } catch (uploadError) {
      setImageError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bilder.')
    } finally {
      setImageBusy(false)
    }
  }

  const patchImage = async (imageId: string, patch: Record<string, unknown>) => {
    if (locked) return null
    setImageBusy(true)
    setImageError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${investigation.inspectionId}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId, ...patch }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageApiResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte spara bild.')
      if (payload.image) {
        setImages((current) => upsertImages(current, [payload.image as TuInvestigationImage]))
      }
      return payload.image ?? null
    } catch (patchError) {
      setImageError(patchError instanceof Error ? patchError.message : 'Kunde inte spara bild.')
      return null
    } finally {
      setImageBusy(false)
    }
  }

  const deleteImage = async (imageId: string) => {
    if (locked) return
    if (!confirm('Ta bort bilden?')) return
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
      setImages((current) => current.filter((image) => image.id !== imageId))
    } catch (deleteError) {
      setImageError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort bild.')
    } finally {
      setImageBusy(false)
    }
  }

  const firstSortOrderForSection = (sectionKey: TuImageSectionKey, excludeImageId: string) => {
    const sectionImages = images.filter((image) => {
      if (image.id === excludeImageId) return false
      return sectionKey === 'appendix' ? image.sectionKey === 'appendix' : image.sectionKey !== 'appendix'
    })
    if (sectionImages.length === 0) return 10
    return Math.min(...sectionImages.map((image) => image.sortOrder)) - 10
  }

  const moveImageToSection = async (imageId: string, sectionKey: TuImageSectionKey) => {
    await patchImage(imageId, {
      sectionKey,
      sortOrder: firstSortOrderForSection(sectionKey, imageId),
    })
  }

  const handleDropToSection = async (event: React.DragEvent, sectionKey: TuImageSectionKey) => {
    event.preventDefault()
    setBankDropActive(false)
    setAppendixDropActive(false)
    if (locked) return

    const droppedFiles = getDroppedImageFiles(event)
    if (droppedFiles.length > 0) {
      await uploadImages(droppedFiles, sectionKey)
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

  const handleMoveAppendixImage = async (imageId: string, direction: -1 | 1) => {
    const currentIndex = appendixImages.findIndex((image) => image.id === imageId)
    const targetIndex = currentIndex + direction
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= appendixImages.length) return

    const reordered = [...appendixImages]
    const current = reordered[currentIndex]
    const target = reordered[targetIndex]
    reordered[currentIndex] = target
    reordered[targetIndex] = current

    const updates = reordered.map((image, index) => ({
      id: image.id,
      sortOrder: (index + 1) * 10,
    }))

    setImages((currentImages) =>
      sortTuImages(
        currentImages.map((image) => {
          const update = updates.find((item) => item.id === image.id)
          return update ? { ...image, sortOrder: update.sortOrder } : image
        })
      )
    )

    for (const update of updates) {
      await patchImage(update.id, { sortOrder: update.sortOrder })
    }
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
    if (locked) return
    if (!confirm('Ta bort dokumentet?')) return

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
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 md:px-6">
        <header className="space-y-4 border-b border-violet-100 pb-4">
          <Link
            href="/tu"
            className="inline-flex items-center gap-2 text-sm font-medium text-violet-800 hover:text-violet-950"
          >
            <ArrowLeft size={16} aria-hidden />
            Till TU
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">TU-utlåtande</p>
              <h1 className="text-2xl font-semibold tracking-tight text-gray-950">{title}</h1>
              <p className="mt-1 text-sm text-gray-600">
                {investigation.property?.address || 'Ingen adress'} {investigation.property?.city || ''}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/tu/investigations/${encodeURIComponent(investigation.inspectionId)}/print?autoprint=1`}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
              >
                <Printer size={16} aria-hidden />
                Skriv ut
              </Link>
              <div className="rounded-md border border-violet-200 bg-white px-3 py-2 text-xs text-gray-600 shadow-sm">
                {saveState === 'saving' ? 'Sparar...' : `Sparad: ${formatSavedAt(investigation.updatedAt)}`}
              </div>
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

        <section className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="grid gap-4">
            <label className="space-y-1">
              <span className="block text-xs font-medium text-gray-600">Rubrik</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => void saveHeaderDetails()}
                disabled={locked}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
          </div>
          <div className="mt-4 border-t border-violet-100 pt-4">
            <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
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
            <dl className="mt-4 grid gap-3 border-t border-violet-100 pt-4 md:grid-cols-2 lg:grid-cols-3">
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
              <ReadOnlyInfoRow label="Beställare" value={customerName} />
              <ReadOnlyInfoRow label="Kontakt" value={customerContact} />
            </dl>
          </div>
        </section>

        <section className="order-last grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <article className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Bildbank</h2>
                <p className="mt-1 text-sm text-gray-600">Ladda upp bilder och dra dem till bildbilagan.</p>
              </div>
              <button
                type="button"
                onClick={() => bankFileInputRef.current?.click()}
                disabled={locked || imageBusy}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <Upload size={16} aria-hidden />
                Ladda upp
              </button>
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

            <div
              onDragEnter={() => !locked && setBankDropActive(true)}
              onDragLeave={() => setBankDropActive(false)}
              onDragOver={handleDragOverDropZone}
              onDrop={(event) => void handleDropToSection(event, 'bank')}
              className={`mb-4 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
                bankDropActive
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-violet-200 bg-violet-50/50 text-gray-600'
              } ${locked ? 'opacity-60' : ''}`}
            >
              <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
              <p className="text-sm font-medium">Släpp bilder här</p>
              <p className="mt-1 text-xs text-gray-500">Eller dra tillbaka bilder från bilagan.</p>
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
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {bankImages.map((image) => (
                  <div
                    key={image.id}
                    draggable={!locked}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(TU_IMAGE_DRAG_DATA_TYPE, image.id)
                    }}
                    className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.publicUrl} alt={image.caption ?? 'TU-bild'} className="aspect-square w-full object-cover" />
                    <div className="space-y-2 p-2">
                      <button
                        type="button"
                        onClick={() => void moveImageToSection(image.id, 'appendix')}
                        disabled={locked || imageBusy}
                        className="w-full rounded-md border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                      >
                        Lägg i bilaga
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>

          <article className="rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Bildbilaga</h2>
                <p className="mt-1 text-sm text-gray-600">Placera bilder och skriv en kort bildtext.</p>
              </div>
              <button
                type="button"
                onClick={() => appendixFileInputRef.current?.click()}
                disabled={locked || imageBusy}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
              >
                <Upload size={16} aria-hidden />
                Direkt till bilaga
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
              className={`mb-4 flex min-h-28 flex-col items-center justify-center rounded-lg border border-dashed px-4 py-5 text-center transition ${
                appendixDropActive
                  ? 'border-violet-500 bg-violet-50 text-violet-900'
                  : 'border-violet-200 bg-violet-50/50 text-gray-600'
              } ${locked ? 'opacity-60' : ''}`}
            >
              <ImageIcon size={24} className="mb-2 text-violet-500" aria-hidden />
              <p className="text-sm font-medium">Släpp bilder i bilagan</p>
              <p className="mt-1 text-xs text-gray-500">Bilderna visas i den ordning de ligger här.</p>
            </div>

            {appendixImages.length === 0 ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Bildbilagan är tom.
              </div>
            ) : (
              <div className="space-y-3">
                {appendixImages.map((image, index) => (
                  <div
                    key={image.id}
                    draggable={!locked}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData(TU_IMAGE_DRAG_DATA_TYPE, image.id)
                    }}
                    className="grid gap-3 rounded-md border border-gray-200 bg-white p-2 shadow-sm sm:grid-cols-[112px_minmax(0,1fr)_auto]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={image.publicUrl} alt={image.caption ?? 'Bilagebild'} className="aspect-square w-full rounded-md object-cover sm:w-28" />
                    <label className="min-w-0 space-y-1">
                      <span className="block text-xs font-medium text-gray-600">Bildtext</span>
                      <textarea
                        value={image.caption ?? ''}
                        rows={3}
                        disabled={locked}
                        onChange={(event) => {
                          const caption = event.target.value
                          setImages((current) =>
                            current.map((currentImage) =>
                              currentImage.id === image.id ? { ...currentImage, caption } : currentImage
                            )
                          )
                        }}
                        onBlur={(event) => void patchImage(image.id, { caption: event.target.value })}
                        className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                        placeholder="Kort beskrivande text"
                      />
                    </label>
                    <div className="flex items-center gap-2 sm:flex-col sm:items-stretch">
                      <button
                        type="button"
                        onClick={() => void handleMoveAppendixImage(image.id, -1)}
                        disabled={locked || imageBusy || index === 0}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                        aria-label="Flytta upp"
                        title="Flytta upp"
                      >
                        <MoveUp size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleMoveAppendixImage(image.id, 1)}
                        disabled={locked || imageBusy || index === appendixImages.length - 1}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                        aria-label="Flytta ned"
                        title="Flytta ned"
                      >
                        <MoveDown size={16} aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveImageToSection(image.id, 'bank')}
                        disabled={locked || imageBusy}
                        className="rounded-md border border-violet-200 px-2 py-1.5 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                      >
                        Bildbank
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteImage(image.id)}
                        disabled={locked || imageBusy}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                        aria-label="Ta bort bild"
                        title="Ta bort bild"
                      >
                        <Trash2 size={16} aria-hidden />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </article>
        </section>

        <section className="order-last rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-gray-950">Dokument</h2>
              <p className="mt-1 text-sm text-gray-600">Lagra underlag som PDF, Word, Excel eller textfiler.</p>
            </div>
            <button
              type="button"
              onClick={() => documentFileInputRef.current?.click()}
              disabled={locked || documentBusy}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <Upload size={16} aria-hidden />
              Ladda upp dokument
            </button>
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
              documentDropActive
                ? 'border-violet-500 bg-violet-50 text-violet-900'
                : 'border-violet-200 bg-violet-50/50 text-gray-600'
            } ${locked ? 'opacity-60' : ''}`}
          >
            <FileText size={24} className="mb-2 text-violet-500" aria-hidden />
            <p className="text-sm font-medium">Släpp dokument här</p>
            <p className="mt-1 text-xs text-gray-500">PDF, Word, Excel eller textfil. Max 25 MB.</p>
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
              {documents.map((document) => (
                <div
                  key={document.id}
                  className="flex flex-col gap-3 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                      <FileText size={18} aria-hidden />
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
                      disabled={locked || documentBusy}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                      aria-label="Ta bort dokument"
                      title="Ta bort dokument"
                    >
                      <Trash2 size={16} aria-hidden />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {documentError ? (
          <div className="order-last rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {documentError}
          </div>
        ) : null}

        {imageError ? (
          <div className="order-last rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {imageError}
          </div>
        ) : null}

        <section className="space-y-4">
          {draft.sections.map((section, index) => {
            const isAssignmentParties = section.key === 'assignment_parties'
            const collapsed = collapsedSections.has(section.key)

            return (
              <article key={section.key} className="rounded-lg border border-violet-100 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-gray-950">
                    {index + 1}. {section.title}
                  </h2>
                  <div className="flex items-center gap-2">
                    {!isAssignmentParties && section.key !== 'signature' ? (
                      <button
                        type="button"
                        onClick={() => void requestAiSuggestions({ sectionKey: section.key })}
                        disabled={locked || aiBusy}
                        title="Skapa AI-förslag för sektionen"
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-400"
                      >
                        <Sparkles size={15} aria-hidden />
                        AI
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => toggleSectionCollapsed(section.key)}
                      aria-expanded={!collapsed}
                      aria-controls={`tu-section-${section.key}`}
                      title={collapsed ? 'Visa sektion' : 'Minimera sektion'}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-violet-200 bg-white text-violet-800 transition hover:bg-violet-50"
                    >
                      {collapsed ? <ChevronDown size={17} aria-hidden /> : <ChevronUp size={17} aria-hidden />}
                    </button>
                  </div>
                </div>

                {collapsed ? null : isAssignmentParties ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md border border-gray-200 bg-gray-50/60 p-3">
                      <h3 className="mb-3 text-sm font-semibold text-gray-950">Uppdragsgivare</h3>
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
                ) : (
                  <DebouncedTextarea
                    value={section.text}
                    draftKey={`tu:${investigation.inspectionId}:${section.key}`}
                    disabled={locked}
                    rows={7}
                    className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
                    onValueChange={(value) => {
                      const nextDraft = cloneDraftWithSection(draftRef.current, section.key, value)
                      draftRef.current = nextDraft
                      setDraft(nextDraft)
                    }}
                    onSave={(value) => saveSection(section.key, value)}
                  />
                )}
              </article>
            )
          })}
        </section>
      </div>
    </main>
  )
}
