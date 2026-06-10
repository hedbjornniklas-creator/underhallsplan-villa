'use client'

/* eslint-disable @next/next/no-img-element */

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Camera,
  ChevronDown,
  ChevronUp,
  FileText,
  Grid2X2,
  Grid3X3,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Save,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import type {
  EbInspectionDocument,
  EbInspectionCheckpoint,
  EbInspectionCheckpointStatus,
  EbInspectionReport,
  EbInspectionRound,
  EbInvitationParticipant,
  EbNote,
  EbNoteImage,
  EbPreviousInspectionItem,
  EbProjectListItem,
  EbReportDraftSection,
  EbReportSectionStatus,
} from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'

type EbInspectionRoundClientProps = {
  initialRound: EbInspectionReport
  initialDisciplineId: string | null
}

type NoteFormState = {
  markerKey: string
  statusKey: string
  location: string
  room: string
  placeDetail: string
  noteText: string
  responsibleParty: string
  tradeGroup: string
  investigationResponsibleParty: string
  investigationResponsibleNote: string
  investigationCostParty: string
  investigationDueDate: string
  deductionAmount: string
}

type InspectionDetailsFormState = {
  inspectionDate: string
  inspectionTime: string
  meetingPlace: string
  startMeetingTime: string
  finalMeetingTime: string
  inspectorAppointedBy: string
  invitationMethod: string
  invitationDate: string
  approvalStatus: string
  approvalNote: string
  requiresContinuedFinalInspection: string
  continuedFinalInspectionDate: string
  continuedFinalInspectionTime: string
  warrantyPeriodYears: string
  warrantyEndDate: string
  warrantyScope: string
  defaultRemedyDeadline: string
  afterInspectionRequested: string
  afterInspectionRequestedBy: string
  afterInspectionDueDate: string
  afterInspectionNoticeInReport: boolean
  inspectionCostDistribution: string
  reportDistributionDate: string
  previousInspections: EbPreviousInspectionItem[]
  defectNumberingExplanation: string
  defectNoErrorPartsPolicy: string
}

type EditableParticipant = EbInvitationParticipant & {
  localId: string
}

type NoteResponse = {
  note?: EbNote
  error?: string
}

type NoteAutosavePayload = {
  noteId: string
  disciplineId: string | null
  form: NoteFormState
}

type ReviewAutosavePayload =
  | { kind: 'inspection'; form: InspectionDetailsFormState }
  | { kind: 'participants'; subject: string; body: string; participants: EditableParticipant[] }
  | { kind: 'documents'; documents: EbInspectionDocument[] }
  | { kind: 'checkpoints'; checkpoints: EbInspectionCheckpoint[] }
  | { kind: 'reportDraft'; sections: EbReportDraftSection[] }

type ReviewAutosaveResult =
  | { kind: 'inspection'; payload: UpdateInspectionResponse }
  | { kind: 'participants'; payload: InvitationResponse }
  | { kind: 'documents'; payload: InspectionDocumentsResponse }
  | { kind: 'checkpoints'; payload: InspectionCheckpointsResponse }
  | { kind: 'reportDraft'; payload: ReportDraftResponse }

type DeleteResponse = {
  ok?: boolean
  error?: string
}

type ImageResponse = {
  image?: EbNoteImage
  ok?: boolean
  error?: string
}

type ReorderResponse = {
  ok?: boolean
  error?: string
}

type UpdateInspectionResponse = {
  project?: EbProjectListItem
  error?: string
}

type InvitationResponse = {
  project?: EbProjectListItem
  inspection?: EbInspectionReport['inspection']
  participants?: EbInvitationParticipant[]
  subject?: string
  body?: string
  error?: string
}

type InspectionDocumentsResponse = {
  documents?: EbInspectionDocument[]
  error?: string
}

type InspectionCheckpointsResponse = {
  checkpoints?: EbInspectionCheckpoint[]
  error?: string
}

type ReportDraftResponse = {
  report?: EbInspectionReport
  reportDraft?: {
    sections?: EbReportDraftSection[]
  }
  error?: string
}

const IMAGE_UPLOAD_MAX_EDGE = 1600
const IMAGE_UPLOAD_JPEG_QUALITY = 0.72
const IMAGE_UPLOAD_REENCODE_THRESHOLD_BYTES = 900 * 1024

const DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION =
  'Fönster, dörrar, väggar etc numreras från vänster till höger. Vägg 1 = vägg till vänster om entrévägg. Vägg 2 = nästa vägg till höger om vägg 1 osv.'

const INVITATION_METHOD_OPTIONS = [
  'E-post',
  'Brev',
  'Telefon',
  'SMS',
  'Muntligen',
  'Digitalt möte',
]

const PREVIOUS_INSPECTION_STATUS_OPTIONS: Array<{
  value: Exclude<EbPreviousInspectionItem['status'], null>
  label: string
}> = [
  { value: 'performed', label: 'Utförd' },
  { value: 'not_performed', label: 'Ej utförd' },
  { value: 'not_applicable', label: 'Ej aktuell' },
]

const REPORT_SECTION_STATUS_LABELS: Record<EbReportSectionStatus, string> = {
  draft: 'Utkast',
  complete: 'Klar',
  missing: 'Saknas',
  not_applicable: 'Ej relevant',
}

const REPORT_SECTION_SOURCE_LABELS: Record<EbReportDraftSection['source'], string> = {
  project: 'Entreprenad',
  inspection: 'Besiktning',
  participants: 'Parter och närvarande',
  notes: 'Noteringar',
  checkpoints: 'Kontrollpunkter',
  standard_text: 'Standardtext',
  manual: 'Manuell',
}

const CHECKPOINT_STATUS_OPTIONS: Array<{
  value: EbInspectionCheckpointStatus
  label: string
}> = [
  { value: 'not_checked', label: 'Ej kontrollerat' },
  { value: 'ok', label: 'OK' },
  { value: 'deviation', label: 'Avvikelse' },
  { value: 'not_applicable', label: 'Ej aktuellt' },
  { value: 'not_accessible', label: 'Ej åtkomligt' },
  { value: 'not_verifiable', label: 'Ej verifierbart' },
]

function inputClassName() {
  return 'w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
}

function formatDate(value: string | null) {
  if (!value) return 'Ej satt'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function formatTime(value: string | null) {
  if (!value) return ''
  return value.slice(0, 5)
}

function todayInputValue() {
  return new Date().toISOString().slice(0, 10)
}

function fieldLabel(label: string, children: ReactNode) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function ReviewSection({
  title,
  description,
  children,
  action,
  hidden = false,
}: {
  title: string
  description?: string
  children: ReactNode
  action?: ReactNode
  hidden?: boolean
}) {
  if (hidden) return null

  return (
    <section className="rounded-lg border border-emerald-100 bg-white/90 p-4 shadow-sm backdrop-blur-sm md:p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-950">{title}</h2>
          {description ? <p className="mt-1 text-sm text-gray-600">{description}</p> : null}
        </div>
        {action ? <div className="hidden">{action}</div> : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function LockedValue({
  label,
  value,
}: {
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <dt className="text-xs font-semibold text-gray-500">{label}</dt>
      <dd className="mt-1 whitespace-pre-wrap text-sm font-medium text-gray-950">{value || '-'}</dd>
    </div>
  )
}

function inspectionTitle(round: EbInspectionRound) {
  return `${round.inspection.variant}${round.inspection.sequenceNo}`
}

function buildInspectionDetailsForm(inspection: EbInspectionReport['inspection']): InspectionDetailsFormState {
  return {
    inspectionDate: inspection.date ?? '',
    inspectionTime: formatTime(inspection.inspectionTime),
    meetingPlace: inspection.meetingPlace ?? '',
    startMeetingTime: formatTime(inspection.startMeetingTime),
    finalMeetingTime: formatTime(inspection.finalMeetingTime),
    inspectorAppointedBy: inspection.inspectorAppointedBy ?? '',
    invitationMethod: inspection.invitationMethod ?? '',
    invitationDate: inspection.invitationDate ?? '',
    approvalStatus: inspection.approvalStatus ?? '',
    approvalNote: inspection.approvalNote ?? '',
    requiresContinuedFinalInspection:
      typeof inspection.requiresContinuedFinalInspection === 'boolean'
        ? String(inspection.requiresContinuedFinalInspection)
        : '',
    continuedFinalInspectionDate: inspection.continuedFinalInspectionDate ?? '',
    continuedFinalInspectionTime: formatTime(inspection.continuedFinalInspectionTime),
    warrantyPeriodYears: inspection.warrantyPeriodYears ? String(inspection.warrantyPeriodYears) : '',
    warrantyEndDate: inspection.warrantyEndDate ?? '',
    warrantyScope: inspection.warrantyScope ?? '',
    defaultRemedyDeadline: inspection.defaultRemedyDeadline ?? '',
    afterInspectionRequested:
      typeof inspection.afterInspectionRequested === 'boolean'
        ? String(inspection.afterInspectionRequested)
        : '',
    afterInspectionRequestedBy: inspection.afterInspectionRequestedBy ?? '',
    afterInspectionDueDate: inspection.afterInspectionDueDate ?? '',
    afterInspectionNoticeInReport: inspection.afterInspectionNoticeInReport,
    inspectionCostDistribution: inspection.inspectionCostDistribution ?? '',
    reportDistributionDate: inspection.reportDistributionDate ?? todayInputValue(),
    previousInspections: inspection.previousInspections,
    defectNumberingExplanation:
      inspection.defectNumberingExplanation ?? DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION,
    defectNoErrorPartsPolicy: inspection.defectNoErrorPartsPolicy ?? 'not_listed',
  }
}

function booleanFromSelect(value: string) {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function invitationMethodOption(value: string) {
  const normalized = value.trim().toLocaleLowerCase('sv-SE')
  return INVITATION_METHOD_OPTIONS.find((option) => option.toLocaleLowerCase('sv-SE') === normalized)
}

function InvitationMethodField({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  const [customOpen, setCustomOpen] = useState(false)
  const selectedOption = value ? invitationMethodOption(value) : null
  const isCustom = customOpen || Boolean(value && !selectedOption)

  return (
    <div className="space-y-2">
      <select
        value={isCustom ? '__custom__' : selectedOption ?? ''}
        onChange={(event) => {
          if (event.target.value === '__custom__') {
            setCustomOpen(true)
            return
          }
          setCustomOpen(false)
          onChange(event.target.value)
        }}
        className={inputClassName()}
      >
        <option value="">Ej satt</option>
        {INVITATION_METHOD_OPTIONS.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="__custom__">Annat</option>
      </select>
      {isCustom ? (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ange kallelsemetod"
          className={inputClassName()}
        />
      ) : null}
    </div>
  )
}

function toLocalParticipant(participant: EbInvitationParticipant, index: number): EditableParticipant {
  return {
    ...participant,
    localId: participant.id ?? `new-${index}-${Date.now()}`,
  }
}

function createEmptyParticipant(sortOrder: number): EditableParticipant {
  return {
    id: null,
    localId: `new-${sortOrder}-${Date.now()}`,
    roleLabel: '',
    companyName: '',
    personName: '',
    email: '',
    phone: '',
    receivesInvitation: true,
    attended: false,
    receivesReport: true,
    representsPartyKey: null,
    canRepresentParty: false,
    sortOrder,
  }
}

function participantPayload(participants: EditableParticipant[]) {
  return participants.map((participant, index) => ({
    id: participant.id,
    roleLabel: participant.roleLabel,
    companyName: participant.companyName,
    personName: participant.personName,
    email: participant.email,
    phone: participant.phone,
    receivesInvitation: participant.receivesInvitation,
    attended: participant.attended,
    receivesReport: participant.receivesReport,
    representsPartyKey: participant.representsPartyKey,
    canRepresentParty: participant.canRepresentParty,
    sortOrder: participant.sortOrder || (index + 1) * 100,
  }))
}

function createInitialForm(round: EbInspectionRound): NoteFormState {
  return {
    markerKey: round.markers.find((marker) => marker.key === 'E')?.key ?? round.markers[0]?.key ?? '',
    statusKey:
      round.statuses.find((status) => status.isDefault)?.key ?? round.statuses[0]?.key ?? 'open',
    location: '',
    room: '',
    placeDetail: '',
    noteText: '',
    responsibleParty: '',
    tradeGroup: '',
    investigationResponsibleParty: '',
    investigationResponsibleNote: '',
    investigationCostParty: '',
    investigationDueDate: '',
    deductionAmount: '',
  }
}

function formFromNote(note: EbNote): NoteFormState {
  return {
    markerKey: note.markerKey ?? '',
    statusKey: note.statusKey,
    location: note.location ?? '',
    room: note.room ?? '',
    placeDetail: note.placeDetail ?? '',
    noteText: note.noteText,
    responsibleParty: note.responsibleParty ?? '',
    tradeGroup: note.tradeGroup ?? '',
    investigationResponsibleParty: note.investigationResponsibleParty ?? '',
    investigationResponsibleNote: note.investigationResponsibleNote ?? '',
    investigationCostParty: note.investigationCostParty ?? '',
    investigationDueDate: note.investigationDueDate ?? '',
    deductionAmount: note.deductionAmount ?? '',
  }
}

function noteFormFingerprint(form: NoteFormState) {
  return JSON.stringify(form)
}

function inspectionFormFingerprint(form: InspectionDetailsFormState) {
  return JSON.stringify(form)
}

function documentsFingerprint(documents: EbInspectionDocument[]) {
  return JSON.stringify(documents)
}

function checkpointsFingerprint(checkpoints: EbInspectionCheckpoint[]) {
  return JSON.stringify(
    checkpoints.map((checkpoint) => ({
      id: checkpoint.id,
      checkpointKey: checkpoint.checkpointKey,
      status: checkpoint.status,
      comment: checkpoint.comment,
      noteId: checkpoint.noteId,
    }))
  )
}

function reportSectionsFingerprint(sections: EbReportDraftSection[]) {
  return JSON.stringify(sections)
}

function participantsFingerprint(subject: string, body: string, participants: EditableParticipant[]) {
  return JSON.stringify({
    subject,
    body,
    participants: participantPayload(participants),
  })
}

function getNoteLabel(round: EbInspectionRound, note: EbNote | null, nextNumber: number) {
  return `${round.project.notePrefix} ${note?.noteNumber ?? nextNumber}`
}

function sortNotes(notes: EbNote[]) {
  return [...notes].sort((left, right) => {
    if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    }
    if ((left.noteNumber ?? 0) !== (right.noteNumber ?? 0)) {
      return (left.noteNumber ?? 0) - (right.noteNumber ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function sortImages(images: EbNoteImage[]) {
  return [...images].sort((left, right) => {
    if ((left.sortOrder ?? 0) !== (right.sortOrder ?? 0)) {
      return (left.sortOrder ?? 0) - (right.sortOrder ?? 0)
    }
    return String(left.createdAt ?? '').localeCompare(String(right.createdAt ?? ''))
  })
}

function imageFileNameAsJpeg(name: string) {
  const baseName = name.replace(/\.[^.]+$/, '').trim()
  return `${baseName || 'bild'}.jpg`
}

function loadImageFromFile(file: File) {
  return new Promise<{ image: HTMLImageElement; objectUrl: string }>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve({ image, objectUrl })
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('Kunde inte läsa bilden.'))
    }
    image.src = objectUrl
  })
}

function canvasToJpegBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', IMAGE_UPLOAD_JPEG_QUALITY)
  })
}

async function prepareImageForUpload(file: File) {
  const contentType = file.type.toLowerCase()
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    !contentType.startsWith('image/') ||
    contentType === 'image/gif' ||
    contentType === 'image/svg+xml'
  ) {
    return file
  }

  let objectUrl: string | null = null

  try {
    const loaded = await loadImageFromFile(file)
    objectUrl = loaded.objectUrl
    const { image } = loaded
    const sourceWidth = image.naturalWidth
    const sourceHeight = image.naturalHeight
    if (sourceWidth <= 0 || sourceHeight <= 0) return file

    const scale = Math.min(1, IMAGE_UPLOAD_MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const shouldResize = scale < 1
    const shouldReencode =
      file.size > IMAGE_UPLOAD_REENCODE_THRESHOLD_BYTES || contentType !== 'image/jpeg'
    if (!shouldResize && !shouldReencode) return file

    const targetWidth = Math.max(1, Math.round(sourceWidth * scale))
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const context = canvas.getContext('2d')
    if (!context) return file

    context.drawImage(image, 0, 0, targetWidth, targetHeight)
    const blob = await canvasToJpegBlob(canvas)
    if (!blob || blob.size >= file.size * 0.98) return file

    return new File([blob], imageFileNameAsJpeg(file.name), {
      type: 'image/jpeg',
      lastModified: file.lastModified,
    })
  } catch {
    return file
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

function sortCheckpoints(checkpoints: EbInspectionCheckpoint[]) {
  return [...checkpoints].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) return left.sortOrder - right.sortOrder
    return left.title.localeCompare(right.title, 'sv-SE')
  })
}

function groupedCheckpoints(checkpoints: EbInspectionCheckpoint[]) {
  const groups: Array<{ key: string; label: string; checkpoints: EbInspectionCheckpoint[] }> = []
  const byKey = new Map<string, { key: string; label: string; checkpoints: EbInspectionCheckpoint[] }>()

  for (const checkpoint of sortCheckpoints(checkpoints)) {
    const groupKey = checkpoint.groupKey || 'other'
    const existing = byKey.get(groupKey)
    if (existing) {
      existing.checkpoints.push(checkpoint)
      continue
    }
    const group = {
      key: groupKey,
      label: checkpoint.groupLabel || 'Övrigt',
      checkpoints: [checkpoint],
    }
    byKey.set(groupKey, group)
    groups.push(group)
  }

  return groups
}

function checkpointStatusLabel(status: EbInspectionCheckpointStatus) {
  return CHECKPOINT_STATUS_OPTIONS.find((option) => option.value === status)?.label ?? 'Ej kontrollerat'
}

function checkpointStatusClassName(status: EbInspectionCheckpointStatus) {
  if (status === 'ok') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (status === 'deviation') return 'border-rose-200 bg-rose-50 text-rose-700'
  if (status === 'not_accessible' || status === 'not_verifiable') {
    return 'border-amber-200 bg-amber-50 text-amber-800'
  }
  if (status === 'not_applicable') return 'border-gray-200 bg-gray-50 text-gray-600'
  return 'border-slate-200 bg-white text-slate-600'
}

function moveNoteInOrder(notes: EbNote[], noteId: string, direction: 'up' | 'down') {
  const orderedNotes = sortNotes(notes)
  const currentIndex = orderedNotes.findIndex((item) => item.id === noteId)
  const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1
  if (currentIndex === -1 || targetIndex < 0 || targetIndex >= orderedNotes.length) return null

  const movedNotes = [...orderedNotes]
  const [movedNote] = movedNotes.splice(currentIndex, 1)
  movedNotes.splice(targetIndex, 0, movedNote)

  return movedNotes.map((note, index) => ({
    ...note,
    sortOrder: (index + 1) * 100,
  }))
}

function ParticipantEditor({
  project,
  participants,
  onAdd,
  onRemove,
  onChange,
}: {
  project: EbProjectListItem
  participants: EditableParticipant[]
  onAdd: () => void
  onRemove: (index: number) => void
  onChange: <K extends keyof EditableParticipant>(
    index: number,
    field: K,
    value: EditableParticipant[K]
  ) => void
}) {
  const vocabulary = resolveEbAgreementVocabulary(project.standardAgreement)

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
        >
          <Plus size={16} />
          Lägg till
        </button>
      </div>

      {participants.length === 0 ? (
        <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-3 text-sm text-gray-600">
          Inga deltagare är registrerade.
        </p>
      ) : null}

      {participants.map((participant, index) => (
        <div key={participant.localId} className="rounded-md border border-emerald-100 bg-emerald-50/25 p-3">
          <div className="grid gap-2 md:grid-cols-2">
            <input
              value={participant.roleLabel ?? ''}
              onChange={(event) => onChange(index, 'roleLabel', event.target.value)}
              placeholder="Roll"
              className={inputClassName()}
            />
            <input
              value={participant.email ?? ''}
              onChange={(event) => onChange(index, 'email', event.target.value)}
              placeholder="epost@exempel.se"
              className={inputClassName()}
            />
            <input
              value={participant.companyName ?? ''}
              onChange={(event) => onChange(index, 'companyName', event.target.value)}
              placeholder="Företag"
              className={inputClassName()}
            />
            <input
              value={participant.personName ?? ''}
              onChange={(event) => onChange(index, 'personName', event.target.value)}
              placeholder="Namn"
              className={inputClassName()}
            />
            <input
              value={participant.phone ?? ''}
              onChange={(event) => onChange(index, 'phone', event.target.value)}
              placeholder="Telefon"
              className={inputClassName()}
            />
            <select
              value={participant.representsPartyKey ?? ''}
              onChange={(event) =>
                onChange(
                  index,
                  'representsPartyKey',
                  (event.target.value || null) as EditableParticipant['representsPartyKey']
                )
              }
              className={inputClassName()}
            >
              <option value="">Företräder inte part</option>
              <option value="client">{vocabulary.clientShortLabel}</option>
              <option value="contractor">{vocabulary.contractorShortLabel}</option>
              <option value="other">Annan</option>
            </select>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm font-medium text-gray-700">
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={participant.receivesInvitation}
                  onChange={(event) => onChange(index, 'receivesInvitation', event.target.checked)}
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                />
                Kallelse
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={participant.attended}
                  onChange={(event) => onChange(index, 'attended', event.target.checked)}
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                />
                Närvarande
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={participant.receivesReport}
                  onChange={(event) => onChange(index, 'receivesReport', event.target.checked)}
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                />
                Utlåtande
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={participant.canRepresentParty}
                  onChange={(event) => onChange(index, 'canRepresentParty', event.target.checked)}
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                />
                För talan
              </label>
            </div>
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label="Ta bort deltagare"
              title="Ta bort deltagare"
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50"
            >
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function PreviousInspectionsEditor({
  rows,
  onChange,
}: {
  rows: EbPreviousInspectionItem[]
  onChange: (rows: EbPreviousInspectionItem[]) => void
}) {
  const updateRow = <K extends keyof EbPreviousInspectionItem>(
    index: number,
    field: K,
    value: EbPreviousInspectionItem[K]
  ) => {
    onChange(rows.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)))
  }

  const addRow = () => {
    onChange([
      ...rows,
      {
        key: `custom_${Date.now()}_${rows.length + 1}`,
        label: '',
        status: null,
        date: null,
      },
    ])
  }

  const removeRow = (index: number) => {
    onChange(rows.filter((_, rowIndex) => rowIndex !== index))
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
        >
          <Plus size={16} />
          Lägg till
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-3 text-sm text-gray-600">
          Inga tidigare besiktningar är registrerade.
        </p>
      ) : null}
      {rows.map((row, index) => (
        <div
          key={`${row.key}-${index}`}
          className="grid gap-2 rounded-md border border-emerald-100 bg-white p-2 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]"
        >
          <input
            value={row.label}
            onChange={(event) => updateRow(index, 'label', event.target.value)}
            className={inputClassName()}
          />
          <select
            value={row.status ?? ''}
            onChange={(event) =>
              updateRow(index, 'status', (event.target.value || null) as EbPreviousInspectionItem['status'])
            }
            className={inputClassName()}
          >
            <option value="">Ej satt</option>
            {PREVIOUS_INSPECTION_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={row.date ?? ''}
            onChange={(event) => updateRow(index, 'date', event.target.value || null)}
            className={inputClassName()}
          />
          <button
            type="button"
            onClick={() => removeRow(index)}
            aria-label="Ta bort tidigare besiktning"
            title="Ta bort tidigare besiktning"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50"
          >
            <Trash2 size={16} />
          </button>
        </div>
      ))}
    </div>
  )
}

function isHandoverDocument(document: EbInspectionDocument) {
  return document.resultLabel?.toLocaleLowerCase('sv-SE').includes('överlämnas') ?? false
}

function documentStatusLabel(document: EbInspectionDocument, status: EbInspectionDocument['status']) {
  if (isHandoverDocument(document)) {
    if (status === 'present') return 'Överlämnad'
    if (status === 'missing') return 'Ej överlämnad'
    return 'Ej aktuell'
  }
  if (status === 'present') return 'Granskad'
  if (status === 'missing') return 'Ej redovisad'
  return 'Ej aktuell'
}

function InspectionDocumentsEditor({
  documents,
  onChange,
}: {
  documents: EbInspectionDocument[]
  onChange: (documents: EbInspectionDocument[]) => void
}) {
  const updateDocument = <K extends keyof EbInspectionDocument>(
    index: number,
    field: K,
    value: EbInspectionDocument[K]
  ) => {
    onChange(documents.map((document, documentIndex) =>
      documentIndex === index ? { ...document, [field]: value } : document
    ))
  }

  if (documents.length === 0) {
    return (
      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">
        Inga EB-dokumenttyper finns upplagda i admin.
      </p>
    )
  }

  return (
    <div className="overflow-x-auto rounded-md border border-emerald-100">
      <table className="min-w-[760px] w-full text-sm">
        <thead className="bg-emerald-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-emerald-800">
          <tr>
            <th className="px-3 py-2">Handling</th>
            <th className="w-40 px-3 py-2">Status</th>
            <th className="w-36 px-3 py-2">Datum</th>
            <th className="w-64 px-3 py-2">Kommentar</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-emerald-100 bg-white">
          {documents.map((document, index) => (
            <tr key={document.documentTypeId}>
              <td className="px-3 py-2 align-top">
                <div className="font-medium text-gray-950">{document.title}</div>
                {document.resultLabel ? <div className="mt-0.5 text-xs text-gray-500">{document.resultLabel}</div> : null}
              </td>
              <td className="px-3 py-2 align-top">
                <select
                  value={document.status}
                  onChange={(event) =>
                    updateDocument(index, 'status', event.target.value as EbInspectionDocument['status'])
                  }
                  className={inputClassName()}
                >
                  {(['na', 'present', 'missing'] as const).map((status) => (
                    <option key={status} value={status}>
                      {documentStatusLabel(document, status)}
                    </option>
                  ))}
                </select>
              </td>
              <td className="px-3 py-2 align-top">
                {isHandoverDocument(document) ? (
                  <span className="block px-3 py-2 text-sm text-gray-500">-</span>
                ) : (
                  <input
                    type="date"
                    value={document.documentDate ?? ''}
                    onChange={(event) => updateDocument(index, 'documentDate', event.target.value || null)}
                    className={inputClassName()}
                  />
                )}
              </td>
              <td className="px-3 py-2 align-top">
                <input
                  value={document.note ?? ''}
                  onChange={(event) => updateDocument(index, 'note', event.target.value || null)}
                  className={inputClassName()}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ReportDraftSectionsEditor({
  sections,
  onChange,
}: {
  sections: EbReportDraftSection[]
  onChange: (sections: EbReportDraftSection[]) => void
}) {
  const updateSection = (key: string, patch: Partial<EbReportDraftSection>) => {
    onChange(sections.map((section) => (section.key === key ? { ...section, ...patch } : section)))
  }

  if (sections.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-3 text-sm text-gray-600">
        Inga utlåtandesektioner hittades.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <article key={section.key} className="rounded-md border border-emerald-100 bg-white p-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                {section.sbrPoint ? `SBR punkt ${section.sbrPoint}` : 'Utlåtande'}
              </p>
              <h3 className="mt-1 text-sm font-semibold text-gray-950">{section.title}</h3>
              <p className="mt-1 text-xs text-gray-500">{REPORT_SECTION_SOURCE_LABELS[section.source]}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-2 rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold">
                <input
                  type="checkbox"
                  checked={section.isRelevant}
                  onChange={(event) =>
                    updateSection(section.key, {
                      isRelevant: event.target.checked,
                      status: event.target.checked ? 'draft' : 'not_applicable',
                    })
                  }
                  className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                />
                Relevant
              </label>
              <select
                value={section.status}
                onChange={(event) =>
                  updateSection(section.key, { status: event.target.value as EbReportSectionStatus })
                }
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-950"
              >
                {Object.entries(REPORT_SECTION_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <textarea
            value={section.text}
            onChange={(event) => updateSection(section.key, { text: event.target.value })}
            rows={8}
            className={`${inputClassName()} mt-3 resize-y leading-6`}
          />
        </article>
      ))}
    </div>
  )
}

export default function EbInspectionRoundClient({
  initialRound,
  initialDisciplineId,
}: EbInspectionRoundClientProps) {
  const router = useRouter()
  const pathname = usePathname()
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const noteRowImageInputRef = useRef<HTMLInputElement | null>(null)
  const noteRowImageTargetRef = useRef<string | null>(null)
  const checkpointImageInputRef = useRef<HTMLInputElement | null>(null)
  const checkpointImageTargetRef = useRef<string | null>(null)
  const notesRef = useRef(initialRound.notes)
  const lastSavedNotesRef = useRef(initialRound.notes)
  const orderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const orderSaveVersionRef = useRef(0)
  const noteAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutosavedNoteFormRef = useRef<string | null>(null)
  const [round, setRound] = useState(initialRound)
  const initialDiscipline = initialRound.disciplines.find(
    (discipline) => discipline.id === initialDisciplineId
  )
  const [activeDisciplineId, setActiveDisciplineId] = useState<string | null>(
    initialDiscipline?.id ?? null
  )
  const [editorOpen, setEditorOpen] = useState(false)
  const [form, setForm] = useState<NoteFormState>(() => createInitialForm(initialRound))
  const [editingNote, setEditingNote] = useState<EbNote | null>(null)
  const [saving, setSaving] = useState(false)
  const [uploadingImage, setUploadingImage] = useState(false)
  const [uploadingImageNoteId, setUploadingImageNoteId] = useState<string | null>(null)
  const [uploadingCheckpointImageId, setUploadingCheckpointImageId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deletingImageId, setDeletingImageId] = useState<string | null>(null)
  const [orderSaving, setOrderSaving] = useState(false)
  const [movingImageId, setMovingImageId] = useState<string | null>(null)
  const [showLinkedImages, setShowLinkedImages] = useState(false)
  const [imageViewCount, setImageViewCount] = useState(4)
  const [error, setError] = useState<string | null>(null)
  const [inspectionForm, setInspectionForm] = useState<InspectionDetailsFormState>(() =>
    buildInspectionDetailsForm(initialRound.inspection)
  )
  const [documents, setDocuments] = useState<EbInspectionDocument[]>(initialRound.inspectionDocuments)
  const [checkpoints, setCheckpoints] = useState<EbInspectionCheckpoint[]>(initialRound.checkpoints)
  const [participants, setParticipants] = useState<EditableParticipant[]>(() =>
    initialRound.participants.map(toLocalParticipant)
  )
  const [invitationSubject, setInvitationSubject] = useState('')
  const [invitationBody, setInvitationBody] = useState('')
  const [invitationLoading, setInvitationLoading] = useState(true)
  const [invitationLoaded, setInvitationLoaded] = useState(false)
  const [reportSections, setReportSections] = useState<EbReportDraftSection[]>(
    initialRound.reportDraft.sections
  )
  const [inspectionSaving, setInspectionSaving] = useState(false)
  const [participantsSaving, setParticipantsSaving] = useState(false)
  const [documentsSaving, setDocumentsSaving] = useState(false)
  const [checkpointsSaving, setCheckpointsSaving] = useState(false)
  const [reportDraftSaving, setReportDraftSaving] = useState(false)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const inspectionAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const participantsAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const documentsAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkpointsAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reportSectionsAutosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastAutosavedInspectionRef = useRef(inspectionFormFingerprint(inspectionForm))
  const lastAutosavedParticipantsRef = useRef(
    participantsFingerprint(invitationSubject, invitationBody, participants)
  )
  const lastAutosavedDocumentsRef = useRef(documentsFingerprint(documents))
  const lastAutosavedCheckpointsRef = useRef(checkpointsFingerprint(checkpoints))
  const lastAutosavedReportSectionsRef = useRef(reportSectionsFingerprint(reportSections))
  const isLocked = Boolean(round.inspection.reportLockedAt)
  const isDrainageProject = round.project.projectTemplateKey === 'drainage_foundation'
  const lockedMessage = 'Utlåtandet är låst och kan inte ändras.'

  const activeDiscipline = round.disciplines.find((discipline) => discipline.id === activeDisciplineId) ?? null
  const filteredNotes = useMemo(
    () =>
      activeDisciplineId
        ? sortNotes(round.notes.filter((note) => note.disciplineId === activeDisciplineId))
        : sortNotes(round.notes),
    [activeDisciplineId, round.notes]
  )
  const imagesByNoteId = useMemo(() => {
    const map = new Map<string, EbNoteImage[]>()
    for (const image of round.images) {
      if (!image.noteId) continue
      map.set(image.noteId, [...(map.get(image.noteId) ?? []), image])
    }
    for (const [noteId, images] of map) {
      map.set(noteId, sortImages(images))
    }
    return map
  }, [round.images])
  const allImages = useMemo(() => sortImages(round.images), [round.images])
  const checkpointGroups = useMemo(() => groupedCheckpoints(checkpoints), [checkpoints])
  const imageBankImages = useMemo(
    () => allImages.filter((image) => showLinkedImages || !image.noteId),
    [allImages, showLinkedImages]
  )
  const orderedNotes = useMemo(() => sortNotes(round.notes), [round.notes])
  const editingNoteIndex = editingNote ? orderedNotes.findIndex((note) => note.id === editingNote.id) : -1
  const previousEditingNote = editingNoteIndex > 0 ? orderedNotes[editingNoteIndex - 1] : null
  const nextEditingNote =
    editingNoteIndex >= 0 && editingNoteIndex < orderedNotes.length - 1
      ? orderedNotes[editingNoteIndex + 1]
      : null
  const displayNumberByNoteId = useMemo(() => {
    const map = new Map<string, number>()
    orderedNotes.forEach((note, index) => {
      map.set(note.id, index + 1)
    })
    return map
  }, [orderedNotes])
  const nextNoteNumber = useMemo(
    () => round.notes.reduce((max, note) => Math.max(max, note.noteNumber ?? 0), 0) + 1,
    [round.notes]
  )
  const showInvestigationFields = form.markerKey === 'S'
  const showDeductionFields = form.markerKey === 'N'
  const showReportFields = showInvestigationFields || showDeductionFields
  const suggestionCandidates = useMemo(() => {
    const unique = new Map<string, string>()
    for (const suggestion of round.suggestions) {
      unique.set(suggestion.phrase.toLocaleLowerCase('sv-SE'), suggestion.phrase)
    }
    for (const note of round.notes) {
      if (note.noteText.trim()) {
        unique.set(note.noteText.trim().toLocaleLowerCase('sv-SE'), note.noteText.trim())
      }
    }
    return Array.from(unique.values())
  }, [round.notes, round.suggestions])
  const visibleSuggestions = useMemo(() => {
    const value = form.noteText.trim().toLocaleLowerCase('sv-SE')
    if (value.length < 1) return []
    return suggestionCandidates
      .filter((candidate) => {
        const normalized = candidate.toLocaleLowerCase('sv-SE')
        return normalized.startsWith(value) && normalized !== value
      })
      .slice(0, 5)
  }, [form.noteText, suggestionCandidates])

  useEffect(() => {
    if (editingNote) return
    setForm(createInitialForm(round))
  }, [activeDisciplineId, editingNote, round])

  const notesBasePath = `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/notes`
  const inspectionBasePath = `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}`
  const invitationPath = `${inspectionBasePath}/invitation`
  const documentsPath = `${inspectionBasePath}/documents`
  const reportDraftPath = `${inspectionBasePath}/report-draft`

  useEffect(() => {
    let cancelled = false

    const loadInvitation = async () => {
      try {
        setInvitationLoading(true)
        const response = await fetch(invitationPath)
        const payload = (await response.json().catch(() => ({}))) as InvitationResponse
        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte hämta kallelse och deltagare.')
        }
        if (cancelled) return
        const nextSubject = payload.subject ?? ''
        const nextBody = payload.body ?? ''
        const nextParticipants = (payload.participants ?? []).map(toLocalParticipant)
        lastAutosavedParticipantsRef.current = participantsFingerprint(nextSubject, nextBody, nextParticipants)
        setInvitationSubject(nextSubject)
        setInvitationBody(nextBody)
        setParticipants(nextParticipants)
        setInvitationLoaded(true)
      } catch (loadError) {
        if (!cancelled) {
          setReviewMessage(loadError instanceof Error ? loadError.message : 'Kunde inte hämta kallelse och deltagare.')
        }
      } finally {
        if (!cancelled) {
          setInvitationLoading(false)
        }
      }
    }

    void loadInvitation()

    return () => {
      cancelled = true
    }
  }, [invitationPath])

  useEffect(() => {
    notesRef.current = round.notes
  }, [round.notes])

  useEffect(() => {
    return () => {
      if (orderSaveTimerRef.current) {
        clearTimeout(orderSaveTimerRef.current)
      }
      if (noteAutosaveTimerRef.current) {
        clearTimeout(noteAutosaveTimerRef.current)
      }
      if (inspectionAutosaveTimerRef.current) clearTimeout(inspectionAutosaveTimerRef.current)
      if (participantsAutosaveTimerRef.current) clearTimeout(participantsAutosaveTimerRef.current)
      if (documentsAutosaveTimerRef.current) clearTimeout(documentsAutosaveTimerRef.current)
      if (checkpointsAutosaveTimerRef.current) clearTimeout(checkpointsAutosaveTimerRef.current)
      if (reportSectionsAutosaveTimerRef.current) clearTimeout(reportSectionsAutosaveTimerRef.current)
    }
  }, [])

  const persistNoteOrder = async (notesToSave: EbNote[], version: number) => {
    if (isLocked) {
      setError(lockedMessage)
      setOrderSaving(false)
      return
    }
    setOrderSaving(true)
    try {
      const response = await fetch(`${notesBasePath}/reorder`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedNoteIds: sortNotes(notesToSave).map((note) => note.id) }),
      })
      const payload = (await response.json().catch(() => ({}))) as ReorderResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara noteringsordningen.')
      }
      if (version === orderSaveVersionRef.current) {
        lastSavedNotesRef.current = notesToSave
        setError(null)
      }
    } catch (orderError) {
      if (version === orderSaveVersionRef.current) {
        const fallbackNotes = lastSavedNotesRef.current
        notesRef.current = fallbackNotes
        setRound((currentRound) => ({ ...currentRound, notes: fallbackNotes }))
        setError(orderError instanceof Error ? orderError.message : 'Kunde inte spara noteringsordningen.')
      }
    } finally {
      if (version === orderSaveVersionRef.current) {
        setOrderSaving(false)
      }
    }
  }

  const scheduleNoteOrderSave = (notesToSave: EbNote[]) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    if (orderSaveTimerRef.current) {
      clearTimeout(orderSaveTimerRef.current)
    }
    const version = orderSaveVersionRef.current + 1
    orderSaveVersionRef.current = version
    setOrderSaving(true)
    orderSaveTimerRef.current = setTimeout(() => {
      void persistNoteOrder(notesToSave, version)
    }, 500)
  }

  const clearPendingNoteOrderSave = () => {
    if (orderSaveTimerRef.current) {
      clearTimeout(orderSaveTimerRef.current)
      orderSaveTimerRef.current = null
    }
    setOrderSaving(false)
  }

  const selectDiscipline = (disciplineId: string) => {
    setActiveDisciplineId(disciplineId)
    setEditingNote(null)
    router.replace(`${pathname}?disciplineId=${disciplineId}`, { scroll: false })
  }

  const showAllDisciplines = () => {
    setActiveDisciplineId(null)
    setEditingNote(null)
    router.replace(pathname, { scroll: false })
  }

  const updateField = <K extends keyof NoteFormState>(field: K, value: NoteFormState[K]) => {
    setForm((current) => {
      if (field === 'markerKey') {
        return {
          ...current,
          [field]: value,
          investigationResponsibleParty: value === 'S' ? current.investigationResponsibleParty : '',
          investigationResponsibleNote: value === 'S' ? current.investigationResponsibleNote : '',
          investigationCostParty: value === 'S' ? current.investigationCostParty : '',
          investigationDueDate: value === 'S' ? current.investigationDueDate : '',
          deductionAmount: value === 'N' ? current.deductionAmount : '',
        }
      }

      return { ...current, [field]: value }
    })
  }

  const updateInspectionField = <K extends keyof InspectionDetailsFormState>(
    field: K,
    value: InspectionDetailsFormState[K]
  ) => {
    setInspectionForm((current) => ({ ...current, [field]: value }))
  }

  const updateParticipant = <K extends keyof EditableParticipant>(
    index: number,
    field: K,
    value: EditableParticipant[K]
  ) => {
    setParticipants((current) =>
      current.map((participant, participantIndex) =>
        participantIndex === index ? { ...participant, [field]: value } : participant
      )
    )
  }

  const addParticipant = () => {
    setParticipants((current) => [
      ...current,
      createEmptyParticipant((current.length + 1) * 100),
    ])
  }

  const removeParticipant = (index: number) => {
    setParticipants((current) => current.filter((_, participantIndex) => participantIndex !== index))
  }

  const saveInspectionDetails = async () => {
    if (isLocked) {
      setReviewMessage(lockedMessage)
      return
    }
    if (inspectionSaving) return

    try {
      setInspectionSaving(true)
      setReviewMessage(null)
      const response = await fetch(inspectionBasePath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...inspectionForm,
          requiresContinuedFinalInspection: booleanFromSelect(
            inspectionForm.requiresContinuedFinalInspection
          ),
          warrantyPeriodYears: inspectionForm.warrantyPeriodYears
            ? Number(inspectionForm.warrantyPeriodYears)
            : null,
          afterInspectionRequested: booleanFromSelect(inspectionForm.afterInspectionRequested),
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as UpdateInspectionResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte spara besiktningsuppgifter.')
      }

      const updatedInspection = payload.project.inspections.find(
        (inspection) => inspection.inspectionId === round.inspection.inspectionId
      )
      setRound((current) => ({
        ...current,
        project: payload.project!,
        inspection: updatedInspection ?? current.inspection,
      }))
      if (updatedInspection) {
        setInspectionForm(buildInspectionDetailsForm(updatedInspection))
      }
      setReviewMessage('Besiktningsuppgifterna är sparade.')
    } catch (saveError) {
      setReviewMessage(saveError instanceof Error ? saveError.message : 'Kunde inte spara besiktningsuppgifter.')
    } finally {
      setInspectionSaving(false)
    }
  }

  const saveParticipants = async () => {
    if (isLocked) {
      setReviewMessage(lockedMessage)
      return
    }
    if (participantsSaving || invitationLoading || !invitationLoaded) return

    try {
      setParticipantsSaving(true)
      setReviewMessage(null)
      const response = await fetch(invitationPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: invitationSubject,
          body: invitationBody,
          participants: participantPayload(participants),
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as InvitationResponse

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara kallelse och deltagare.')
      }

      setInvitationSubject(payload.subject ?? invitationSubject)
      setInvitationBody(payload.body ?? invitationBody)
      setParticipants((payload.participants ?? []).map(toLocalParticipant))
      setReviewMessage('Kallelse och deltagare är sparade.')
    } catch (saveError) {
      setReviewMessage(saveError instanceof Error ? saveError.message : 'Kunde inte spara kallelse och deltagare.')
    } finally {
      setParticipantsSaving(false)
    }
  }

  const saveDocuments = async () => {
    if (isLocked) {
      setReviewMessage(lockedMessage)
      return
    }
    if (documentsSaving) return

    try {
      setDocumentsSaving(true)
      setReviewMessage(null)
      const response = await fetch(documentsPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents }),
      })
      const payload = (await response.json().catch(() => ({}))) as InspectionDocumentsResponse

      if (!response.ok || !payload.documents) {
        throw new Error(payload.error ?? 'Kunde inte spara granskade handlingar.')
      }

      setDocuments(payload.documents)
      setReviewMessage('Handlingarna är sparade.')
    } catch (saveError) {
      setReviewMessage(saveError instanceof Error ? saveError.message : 'Kunde inte spara granskade handlingar.')
    } finally {
      setDocumentsSaving(false)
    }
  }

  const updateCheckpoint = <K extends keyof EbInspectionCheckpoint>(
    checkpointId: string,
    field: K,
    value: EbInspectionCheckpoint[K]
  ) => {
    setCheckpoints((current) =>
      current.map((checkpoint) =>
        checkpoint.id === checkpointId ? { ...checkpoint, [field]: value } : checkpoint
      )
    )
  }

  const saveCheckpoints = async () => {
    if (isLocked) {
      setReviewMessage(lockedMessage)
      return
    }
    if (checkpointsSaving) return

    try {
      setCheckpointsSaving(true)
      setReviewMessage(null)
      const response = await fetch(
        `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/checkpoints`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            checkpoints: checkpoints.map((checkpoint) => ({
              id: checkpoint.id,
              checkpointKey: checkpoint.checkpointKey,
              status: checkpoint.status,
              comment: checkpoint.comment,
              noteId: checkpoint.noteId,
            })),
          }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as InspectionCheckpointsResponse

      if (!response.ok || !payload.checkpoints) {
        throw new Error(payload.error ?? 'Kunde inte spara kontrollpunkter.')
      }

      setCheckpoints(payload.checkpoints)
      setRound((current) => ({ ...current, checkpoints: payload.checkpoints ?? current.checkpoints }))
      setReviewMessage('Kontrollpunkterna är sparade.')
    } catch (saveError) {
      setReviewMessage(saveError instanceof Error ? saveError.message : 'Kunde inte spara kontrollpunkter.')
    } finally {
      setCheckpointsSaving(false)
    }
  }

  const saveReportDraft = async () => {
    if (isLocked) {
      setReviewMessage(lockedMessage)
      return
    }
    if (reportDraftSaving) return

    try {
      setReportDraftSaving(true)
      setReviewMessage(null)
      const response = await fetch(reportDraftPath, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sections: reportSections }),
      })
      const payload = (await response.json().catch(() => ({}))) as ReportDraftResponse

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara utlåtandetexterna.')
      }

      if (payload.reportDraft?.sections) {
        setReportSections(payload.reportDraft.sections)
      }
      setReviewMessage('Utlåtandetexterna är sparade.')
    } catch (saveError) {
      setReviewMessage(saveError instanceof Error ? saveError.message : 'Kunde inte spara utlåtandetexterna.')
    } finally {
      setReportDraftSaving(false)
    }
  }

  const saveReviewAutosavePatch = useCallback(
    async (payload: ReviewAutosavePayload): Promise<ReviewAutosaveResult> => {
      if (payload.kind === 'inspection') {
        setInspectionSaving(true)
        try {
          const response = await fetch(inspectionBasePath, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ...payload.form,
              requiresContinuedFinalInspection: booleanFromSelect(
                payload.form.requiresContinuedFinalInspection
              ),
              warrantyPeriodYears: payload.form.warrantyPeriodYears
                ? Number(payload.form.warrantyPeriodYears)
                : null,
              afterInspectionRequested: booleanFromSelect(payload.form.afterInspectionRequested),
            }),
          })
          const body = (await response.json().catch(() => ({}))) as UpdateInspectionResponse
          if (!response.ok || !body.project) {
            throw new Error(body.error ?? 'Kunde inte autospara besiktningsuppgifter.')
          }
          return { kind: 'inspection', payload: body }
        } finally {
          setInspectionSaving(false)
        }
      }

      if (payload.kind === 'participants') {
        setParticipantsSaving(true)
        try {
          const response = await fetch(invitationPath, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: payload.subject,
              body: payload.body,
              participants: participantPayload(payload.participants),
            }),
          })
          const body = (await response.json().catch(() => ({}))) as InvitationResponse
          if (!response.ok) {
            throw new Error(body.error ?? 'Kunde inte autospara kallelse och deltagare.')
          }
          return { kind: 'participants', payload: body }
        } finally {
          setParticipantsSaving(false)
        }
      }

      if (payload.kind === 'documents') {
        setDocumentsSaving(true)
        try {
          const response = await fetch(documentsPath, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: payload.documents }),
          })
          const body = (await response.json().catch(() => ({}))) as InspectionDocumentsResponse
          if (!response.ok || !body.documents) {
            throw new Error(body.error ?? 'Kunde inte autospara granskade handlingar.')
          }
          return { kind: 'documents', payload: body }
        } finally {
          setDocumentsSaving(false)
        }
      }

      if (payload.kind === 'checkpoints') {
        setCheckpointsSaving(true)
        try {
          const response = await fetch(
            `/api/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/checkpoints`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                checkpoints: payload.checkpoints.map((checkpoint) => ({
                  id: checkpoint.id,
                  checkpointKey: checkpoint.checkpointKey,
                  status: checkpoint.status,
                  comment: checkpoint.comment,
                  noteId: checkpoint.noteId,
                })),
              }),
            }
          )
          const body = (await response.json().catch(() => ({}))) as InspectionCheckpointsResponse
          if (!response.ok || !body.checkpoints) {
            throw new Error(body.error ?? 'Kunde inte autospara kontrollpunkter.')
          }
          return { kind: 'checkpoints', payload: body }
        } finally {
          setCheckpointsSaving(false)
        }
      }

      setReportDraftSaving(true)
      try {
        const response = await fetch(reportDraftPath, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sections: payload.sections }),
        })
        const body = (await response.json().catch(() => ({}))) as ReportDraftResponse
        if (!response.ok) {
          throw new Error(body.error ?? 'Kunde inte autospara utlåtandetexterna.')
        }
        return { kind: 'reportDraft', payload: body }
      } finally {
        setReportDraftSaving(false)
      }
    },
    [
      documentsPath,
      inspectionBasePath,
      invitationPath,
      reportDraftPath,
      round.inspection.inspectionId,
      round.project.id,
    ]
  )

  const reviewAutosave = useAutosaveQueue<ReviewAutosavePayload, ReviewAutosaveResult>({
    save: saveReviewAutosavePatch,
    mergePayload: (_previous, next) => next,
    onSaved: (result) => {
      if (result.kind === 'inspection') {
        const project = result.payload.project
        if (!project) return
        const updatedInspection = project.inspections.find(
          (inspection) => inspection.inspectionId === round.inspection.inspectionId
        )
        setRound((current) => ({
          ...current,
          project,
          inspection: updatedInspection ?? current.inspection,
        }))
        if (updatedInspection) {
          const nextForm = buildInspectionDetailsForm(updatedInspection)
          lastAutosavedInspectionRef.current = inspectionFormFingerprint(nextForm)
          setInspectionForm(nextForm)
        }
        return
      }

      if (result.kind === 'participants') {
        const nextSubject = result.payload.subject ?? invitationSubject
        const nextBody = result.payload.body ?? invitationBody
        const nextParticipants = (result.payload.participants ?? []).map(toLocalParticipant)
        lastAutosavedParticipantsRef.current = participantsFingerprint(nextSubject, nextBody, nextParticipants)
        setInvitationSubject(nextSubject)
        setInvitationBody(nextBody)
        setParticipants(nextParticipants)
        return
      }

      if (result.kind === 'documents' && result.payload.documents) {
        lastAutosavedDocumentsRef.current = documentsFingerprint(result.payload.documents)
        setDocuments(result.payload.documents)
        return
      }

      if (result.kind === 'checkpoints' && result.payload.checkpoints) {
        lastAutosavedCheckpointsRef.current = checkpointsFingerprint(result.payload.checkpoints)
        setCheckpoints(result.payload.checkpoints)
        setRound((current) => ({ ...current, checkpoints: result.payload.checkpoints ?? current.checkpoints }))
        return
      }

      if (result.kind === 'reportDraft' && result.payload.reportDraft?.sections) {
        lastAutosavedReportSectionsRef.current = reportSectionsFingerprint(result.payload.reportDraft.sections)
        setReportSections(result.payload.reportDraft.sections)
      }
    },
    onError: (autosaveError) => {
      setReviewMessage(autosaveError instanceof Error ? autosaveError.message : 'Kunde inte autospara.')
    },
  })
  const {
    enqueue: enqueueReviewAutosave,
    resetError: resetReviewAutosaveError,
    status: reviewAutosaveStatus,
  } = reviewAutosave

  useEffect(() => {
    if (inspectionAutosaveTimerRef.current) {
      clearTimeout(inspectionAutosaveTimerRef.current)
      inspectionAutosaveTimerRef.current = null
    }
    if (isLocked) return

    const fingerprint = inspectionFormFingerprint(inspectionForm)
    if (fingerprint === lastAutosavedInspectionRef.current) return

    inspectionAutosaveTimerRef.current = setTimeout(() => {
      lastAutosavedInspectionRef.current = fingerprint
      resetReviewAutosaveError()
      void enqueueReviewAutosave({ kind: 'inspection', form: inspectionForm })
    }, 700)

    return () => {
      if (inspectionAutosaveTimerRef.current) {
        clearTimeout(inspectionAutosaveTimerRef.current)
        inspectionAutosaveTimerRef.current = null
      }
    }
  }, [enqueueReviewAutosave, inspectionForm, isLocked, resetReviewAutosaveError])

  useEffect(() => {
    if (participantsAutosaveTimerRef.current) {
      clearTimeout(participantsAutosaveTimerRef.current)
      participantsAutosaveTimerRef.current = null
    }
    if (isLocked || invitationLoading || !invitationLoaded) return

    const fingerprint = participantsFingerprint(invitationSubject, invitationBody, participants)
    if (fingerprint === lastAutosavedParticipantsRef.current) return

    participantsAutosaveTimerRef.current = setTimeout(() => {
      lastAutosavedParticipantsRef.current = fingerprint
      resetReviewAutosaveError()
      void enqueueReviewAutosave({
        kind: 'participants',
        subject: invitationSubject,
        body: invitationBody,
        participants,
      })
    }, 700)

    return () => {
      if (participantsAutosaveTimerRef.current) {
        clearTimeout(participantsAutosaveTimerRef.current)
        participantsAutosaveTimerRef.current = null
      }
    }
  }, [
    enqueueReviewAutosave,
    invitationBody,
    invitationLoaded,
    invitationLoading,
    invitationSubject,
    isLocked,
    participants,
    resetReviewAutosaveError,
  ])

  useEffect(() => {
    if (documentsAutosaveTimerRef.current) {
      clearTimeout(documentsAutosaveTimerRef.current)
      documentsAutosaveTimerRef.current = null
    }
    if (isLocked || isDrainageProject) return

    const fingerprint = documentsFingerprint(documents)
    if (fingerprint === lastAutosavedDocumentsRef.current) return

    documentsAutosaveTimerRef.current = setTimeout(() => {
      lastAutosavedDocumentsRef.current = fingerprint
      resetReviewAutosaveError()
      void enqueueReviewAutosave({ kind: 'documents', documents })
    }, 700)

    return () => {
      if (documentsAutosaveTimerRef.current) {
        clearTimeout(documentsAutosaveTimerRef.current)
        documentsAutosaveTimerRef.current = null
      }
    }
  }, [documents, enqueueReviewAutosave, isDrainageProject, isLocked, resetReviewAutosaveError])

  useEffect(() => {
    if (checkpointsAutosaveTimerRef.current) {
      clearTimeout(checkpointsAutosaveTimerRef.current)
      checkpointsAutosaveTimerRef.current = null
    }
    if (isLocked || checkpoints.length === 0) return

    const fingerprint = checkpointsFingerprint(checkpoints)
    if (fingerprint === lastAutosavedCheckpointsRef.current) return

    checkpointsAutosaveTimerRef.current = setTimeout(() => {
      lastAutosavedCheckpointsRef.current = fingerprint
      resetReviewAutosaveError()
      void enqueueReviewAutosave({ kind: 'checkpoints', checkpoints })
    }, 700)

    return () => {
      if (checkpointsAutosaveTimerRef.current) {
        clearTimeout(checkpointsAutosaveTimerRef.current)
        checkpointsAutosaveTimerRef.current = null
      }
    }
  }, [checkpoints, enqueueReviewAutosave, isLocked, resetReviewAutosaveError])

  useEffect(() => {
    if (reportSectionsAutosaveTimerRef.current) {
      clearTimeout(reportSectionsAutosaveTimerRef.current)
      reportSectionsAutosaveTimerRef.current = null
    }
    if (isLocked) return

    const fingerprint = reportSectionsFingerprint(reportSections)
    if (fingerprint === lastAutosavedReportSectionsRef.current) return

    reportSectionsAutosaveTimerRef.current = setTimeout(() => {
      lastAutosavedReportSectionsRef.current = fingerprint
      resetReviewAutosaveError()
      void enqueueReviewAutosave({ kind: 'reportDraft', sections: reportSections })
    }, 700)

    return () => {
      if (reportSectionsAutosaveTimerRef.current) {
        clearTimeout(reportSectionsAutosaveTimerRef.current)
        reportSectionsAutosaveTimerRef.current = null
      }
    }
  }, [enqueueReviewAutosave, isLocked, reportSections, resetReviewAutosaveError])

  const resetForm = () => {
    setEditingNote(null)
    lastAutosavedNoteFormRef.current = null
    setForm(createInitialForm(round))
    setError(null)
  }

  const closeEditor = () => {
    resetForm()
    setEditorOpen(false)
  }

  const upsertNoteInState = (note: EbNote) => {
    clearPendingNoteOrderSave()
    const withoutSame = notesRef.current.filter((item) => item.id !== note.id)
    const notes = sortNotes([...withoutSame, note])
    notesRef.current = notes
    lastSavedNotesRef.current = notes

    setRound((current) => {
      const hasSuggestion = current.suggestions.some(
        (suggestion) =>
          suggestion.phrase.toLocaleLowerCase('sv-SE') === note.noteText.toLocaleLowerCase('sv-SE')
      )
      return {
        ...current,
        notes,
        suggestions: hasSuggestion
          ? current.suggestions
          : [
              {
                id: `local-${note.id}`,
                phrase: note.noteText,
                normalizedPrefix: note.noteText.slice(0, 1).toLocaleLowerCase('sv-SE'),
                useCount: 1,
                lastUsedAt: note.updatedAt ?? note.createdAt,
              },
              ...current.suggestions,
            ],
      }
    })
  }

  const upsertImageInState = (image: EbNoteImage) => {
    setRound((current) => ({
      ...current,
      images: sortImages([...current.images.filter((item) => item.id !== image.id), image]),
    }))
  }

  const updateImageInState = (image: EbNoteImage) => {
    setRound((current) => ({
      ...current,
      images: sortImages(current.images.map((item) => (item.id === image.id ? image : item))),
    }))
  }

  const saveNotePatch = useCallback(
    async (payload: NoteAutosavePayload): Promise<NoteResponse> => {
      const response = await fetch(`${notesBasePath}/${payload.noteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload.form,
          disciplineId: payload.disciplineId,
        }),
      })
      const body = (await response.json().catch(() => ({}))) as NoteResponse
      if (!response.ok || !body.note) {
        throw new Error(body.error ?? 'Kunde inte autospara noteringen.')
      }
      return body
    },
    [notesBasePath]
  )

  const noteAutosave = useAutosaveQueue<NoteAutosavePayload, NoteResponse>({
    save: saveNotePatch,
    mergePayload: (_previous, next) => next,
    onSaved: (payload) => {
      const savedNote = payload.note
      if (!savedNote) return
      upsertNoteInState(savedNote)
      setEditingNote((current) => (current?.id === savedNote.id ? savedNote : current))
    },
    onError: (autosaveError) => {
      setError(autosaveError instanceof Error ? autosaveError.message : 'Kunde inte autospara noteringen.')
    },
  })
  const {
    enqueue: enqueueNoteAutosave,
    resetError: resetNoteAutosaveError,
    status: noteAutosaveStatus,
    lastSavedAt: noteAutosaveLastSavedAt,
  } = noteAutosave

  useEffect(() => {
    if (noteAutosaveTimerRef.current) {
      clearTimeout(noteAutosaveTimerRef.current)
      noteAutosaveTimerRef.current = null
    }

    if (!editingNote || isLocked) return

    const fingerprint = noteFormFingerprint(form)
    if (fingerprint === lastAutosavedNoteFormRef.current) return

    noteAutosaveTimerRef.current = setTimeout(() => {
      lastAutosavedNoteFormRef.current = fingerprint
      resetNoteAutosaveError()
      void enqueueNoteAutosave({
        noteId: editingNote.id,
        disciplineId: editingNote.disciplineId ?? activeDisciplineId,
        form,
      })
    }, 700)

    return () => {
      if (noteAutosaveTimerRef.current) {
        clearTimeout(noteAutosaveTimerRef.current)
        noteAutosaveTimerRef.current = null
      }
    }
  }, [activeDisciplineId, editingNote, enqueueNoteAutosave, form, isLocked, resetNoteAutosaveError])

  const saveCurrentNote = async () => {
    if (isLocked) {
      throw new Error(lockedMessage)
    }
    const disciplineId =
      editingNote?.disciplineId ?? activeDisciplineId ?? round.disciplines[0]?.id ?? null
    if (saving || !disciplineId) return null

    setSaving(true)
    const response = await fetch(editingNote ? `${notesBasePath}/${editingNote.id}` : notesBasePath, {
      method: editingNote ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        disciplineId,
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as NoteResponse
    if (!response.ok || !payload.note) {
      throw new Error(payload.error ?? 'Kunde inte spara noteringen.')
    }

    upsertNoteInState(payload.note)
    setEditingNote(payload.note)
    const savedForm = formFromNote(payload.note)
    lastAutosavedNoteFormRef.current = noteFormFingerprint(savedForm)
    setForm(savedForm)
    return payload.note
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    try {
      setError(null)
      await saveCurrentNote()
      closeEditor()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara noteringen.')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = (note: EbNote) => {
    const nextForm = formFromNote(note)
    setEditingNote(note)
    setEditorOpen(true)
    setActiveDisciplineId(note.disciplineId)
    if (note.disciplineId) {
      router.replace(`${pathname}?disciplineId=${note.disciplineId}`, { scroll: false })
    }
    lastAutosavedNoteFormRef.current = noteFormFingerprint(nextForm)
    setForm(nextForm)
    setError(null)
  }

  const handleNewNote = () => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    setEditingNote(null)
    lastAutosavedNoteFormRef.current = null
    setActiveDisciplineId((current) => current ?? round.disciplines[0]?.id ?? null)
    setForm(createInitialForm(round))
    setError(null)
    setEditorOpen(true)
  }

  const handleMoveNote = (note: EbNote, direction: 'up' | 'down') => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    const movedNotes = moveNoteInOrder(notesRef.current, note.id, direction)
    if (!movedNotes) return

    notesRef.current = movedNotes
    setError(null)
    setRound((currentRound) => ({ ...currentRound, notes: movedNotes }))
    scheduleNoteOrderSave(movedNotes)
  }

  const uploadImage = async (file: File, targetNote?: EbNote) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    if (uploadingImage) return

    try {
      setUploadingImage(true)
      setError(null)
      const note = targetNote ?? editingNote ?? (await saveCurrentNote())
      if (!note) return
      setUploadingImageNoteId(note.id)
      setSaving(false)

      const thumbnailFile = await prepareImageForUpload(file)
      const formData = new FormData()
      formData.append('file', file)
      if (thumbnailFile !== file) {
        formData.append('thumbnail', thumbnailFile)
      }
      const response = await fetch(`${notesBasePath}/${note.id}/images`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => ({}))) as ImageResponse
      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? 'Kunde inte ladda upp bild.')
      }
      upsertImageInState(payload.image)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bild.')
    } finally {
      setSaving(false)
      setUploadingImage(false)
      setUploadingImageNoteId(null)
    }
  }

  const handleImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    await uploadImage(file)
  }

  const handleNoteRowImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    const noteId = noteRowImageTargetRef.current
    noteRowImageTargetRef.current = null
    if (!file || !noteId) return
    const note = notesRef.current.find((item) => item.id === noteId)
    if (!note) return
    await uploadImage(file, note)
  }

  const chooseNoteRowImage = (note: EbNote) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    noteRowImageTargetRef.current = note.id
    noteRowImageInputRef.current?.click()
  }

  const ensureCheckpointNote = async (checkpoint: EbInspectionCheckpoint) => {
    if (checkpoint.noteId) {
      const existingNote = round.notes.find((note) => note.id === checkpoint.noteId)
      if (existingNote) return existingNote
    }

    const disciplineId = activeDisciplineId ?? round.disciplines[0]?.id ?? null
    if (!disciplineId) throw new Error('VÃ¤lj fack innan foto sparas.')

    const response = await fetch(notesBasePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        disciplineId,
        markerKey: round.markers.find((marker) => marker.key === 'E')?.key ?? round.markers[0]?.key ?? null,
        statusKey:
          round.statuses.find((status) => status.isDefault)?.key ?? round.statuses[0]?.key ?? 'open',
        location: checkpoint.groupLabel ?? 'Kontrollunderlag',
        room: '',
        placeDetail: '',
        noteText: checkpoint.comment?.trim() || checkpoint.title,
        responsibleParty: '',
        tradeGroup: 'DrÃ¤nering',
      }),
    })
    const payload = (await response.json().catch(() => ({}))) as NoteResponse
    if (!response.ok || !payload.note) {
      throw new Error(payload.error ?? 'Kunde inte skapa notering fÃ¶r kontrollpunkten.')
    }

    upsertNoteInState(payload.note)
    const nextCheckpoints = checkpoints.map((item) =>
      item.id === checkpoint.id ? { ...item, noteId: payload.note!.id } : item
    )
    lastAutosavedCheckpointsRef.current = checkpointsFingerprint(nextCheckpoints)
    setCheckpoints(nextCheckpoints)
    void enqueueReviewAutosave({ kind: 'checkpoints', checkpoints: nextCheckpoints })
    return payload.note
  }

  const uploadCheckpointImage = async (file: File, checkpoint: EbInspectionCheckpoint) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    if (uploadingImage || uploadingCheckpointImageId) return

    try {
      setUploadingCheckpointImageId(checkpoint.id)
      setError(null)
      const note = await ensureCheckpointNote(checkpoint)
      await uploadImage(file, note)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp foto.')
    } finally {
      setUploadingCheckpointImageId(null)
    }
  }

  const handleCheckpointImageSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    const checkpointId = checkpointImageTargetRef.current
    checkpointImageTargetRef.current = null
    if (!file || !checkpointId) return
    const checkpoint = checkpoints.find((item) => item.id === checkpointId)
    if (!checkpoint) return
    await uploadCheckpointImage(file, checkpoint)
  }

  const chooseCheckpointImage = (checkpoint: EbInspectionCheckpoint) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    checkpointImageTargetRef.current = checkpoint.id
    checkpointImageInputRef.current?.click()
  }

  const detachImage = async (image: EbNoteImage) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    if (!editingNote || deletingImageId) return

    try {
      setDeletingImageId(image.id)
      setError(null)
      const response = await fetch(`${notesBasePath}/${editingNote.id}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId: image.id, action: 'detach' }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageResponse
      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? 'Kunde inte koppla loss bilden.')
      }
      updateImageInState(payload.image)
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte koppla loss bilden.')
    } finally {
      setDeletingImageId(null)
    }
  }

  const attachImage = async (imageId: string) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    if (!editingNote || movingImageId) return

    try {
      setMovingImageId(imageId)
      setError(null)
      const response = await fetch(`${notesBasePath}/${editingNote.id}/images`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageId, action: 'attach' }),
      })
      const payload = (await response.json().catch(() => ({}))) as ImageResponse
      if (!response.ok || !payload.image) {
        throw new Error(payload.error ?? 'Kunde inte koppla bilden.')
      }
      updateImageInState(payload.image)
    } catch (attachError) {
      setError(attachError instanceof Error ? attachError.message : 'Kunde inte koppla bilden.')
    } finally {
      setMovingImageId(null)
    }
  }

  const handleDelete = async (note: EbNote) => {
    if (isLocked) {
      setError(lockedMessage)
      return
    }
    if (deletingId) return
    const confirmed = window.confirm(`Radera ${round.project.notePrefix} ${note.noteNumber}?`)
    if (!confirmed) return

    try {
      setDeletingId(note.id)
      setError(null)
      const response = await fetch(`${notesBasePath}/${note.id}`, { method: 'DELETE' })
      const payload = (await response.json().catch(() => ({}))) as DeleteResponse
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? 'Kunde inte radera noteringen.')
      }
      clearPendingNoteOrderSave()
      const notes = notesRef.current.filter((item) => item.id !== note.id)
      notesRef.current = notes
      lastSavedNotesRef.current = notes
      setRound((current) => ({
        ...current,
        notes,
        images: current.images.map((image) =>
          image.noteId === note.id ? { ...image, noteId: null } : image
        ),
      }))
      if (editingNote?.id === note.id) {
        resetForm()
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte radera noteringen.')
    } finally {
      setDeletingId(null)
    }
  }

  const vocabulary = resolveEbAgreementVocabulary(round.project.standardAgreement)
  const noteAutosaveStatusText =
    editingNote && noteAutosaveStatus === 'saving'
      ? 'Autosparar...'
      : editingNote && noteAutosaveStatus === 'error'
        ? 'Autospar misslyckades'
        : editingNote && noteAutosaveLastSavedAt
          ? 'Autosparat'
          : null
  const addressLine = [round.project.address, round.project.postalCode, round.project.city]
    .filter(Boolean)
    .join(', ')
  const clientAddressLine = [
    round.project.clientAddress,
    [round.project.clientPostalCode, round.project.clientCity].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  const contractorAddressLine = [
    round.project.contractorAddress,
    [round.project.contractorPostalCode, round.project.contractorCity].filter(Boolean).join(' '),
  ].filter(Boolean).join(', ')
  const contractLine = [
    round.project.standardAgreement,
    round.project.contractForm,
    round.project.procurementForm,
  ].filter(Boolean).join(' - ')

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <input
          ref={noteRowImageInputRef}
          type="file"
          accept="image/*"
          onChange={(event) => void handleNoteRowImageSelected(event)}
          className="hidden"
        />
        <input
          ref={checkpointImageInputRef}
          type="file"
          accept="image/*"
          onChange={(event) => void handleCheckpointImageSelected(event)}
          className="hidden"
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 72% at 50% 0%, rgba(220,252,231,0.08) 0%, rgba(220,252,231,0) 62%), linear-gradient(135deg, #ffffff 0%, #fbfefc 52%, #fafdfb 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/62 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl p-4 md:p-6">
          <header className="rounded-lg border border-emerald-100 bg-white/84 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Link
                  href={`/eb/projects/${round.project.id}`}
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <ArrowLeft size={17} strokeWidth={2} />
                </Link>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
                    {inspectionTitle(round)}
                  </p>
                  <h1 className="truncate text-2xl font-semibold text-gray-950">{round.project.title}</h1>
                  <p className="mt-1 truncate text-sm text-gray-600">
                    {round.inspection.variantLabel} · {formatDate(round.inspection.date)}
                    {round.inspection.inspectionTime ? ` ${formatTime(round.inspection.inspectionTime)}` : ''}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/report`}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <FileText size={16} />
                  Utlåtande
                </Link>
                <Link
                  href={`/eb/projects/${round.project.id}/inspections/${round.inspection.inspectionId}/round${
                    activeDisciplineId ? `?disciplineId=${activeDisciplineId}` : ''
                  }`}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <Smartphone size={16} />
                  Mobil runda
                </Link>
              </div>
            </div>
          </header>

          {isLocked ? (
            <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 shadow-sm">
              Utlåtandet är låst och visas i läsläge.
            </p>
          ) : null}

          {reviewMessage ? (
            <p className="mt-4 rounded-md border border-emerald-100 bg-white/90 px-3 py-2 text-sm font-medium text-gray-700 shadow-sm">
              {reviewMessage}
            </p>
          ) : null}

          {reviewAutosaveStatus === 'saving' ? (
            <p className="mt-4 inline-flex items-center gap-2 rounded-md border border-emerald-100 bg-white/90 px-3 py-2 text-sm font-semibold text-emerald-800 shadow-sm">
              <Loader2 size={15} className="animate-spin" />
              Autosparar
            </p>
          ) : reviewAutosaveStatus === 'error' ? (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700 shadow-sm">
              Autospar misslyckades
            </p>
          ) : null}

          <div className="mt-4 space-y-4">
            <ReviewSection
              title="Objekt och entreprenad"
              description="Uppgifter som hör till entreprenaden visas låsta här så Granska följer utlåtandet utan att skapa dubbla källor."
            >
              <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <LockedValue label="Fastighetsbeteckning" value={round.project.propertyDesignation} />
                <LockedValue label="BRF och lgh nr" value={round.project.brfApartmentNumber} />
                <LockedValue label="Gatuadress, ort" value={addressLine} />
                <LockedValue label="Kommun" value={round.project.municipality} />
                <LockedValue label="Entreprenad" value={round.project.objectDescription} />
                <LockedValue label="Kontrakt" value={round.project.contractName ?? round.project.title} />
                <LockedValue label="Avtal" value={contractLine} />
                <LockedValue label="Kontraktsdatum" value={round.project.contractDate} />
                <LockedValue label={vocabulary.clientLabel} value={round.project.clientName} />
                <LockedValue label={`${vocabulary.clientShortLabel} adress`} value={clientAddressLine} />
                <LockedValue label={vocabulary.contractorLabel} value={round.project.contractorName} />
                <LockedValue label={`${vocabulary.contractorShortLabel} adress`} value={contractorAddressLine} />
              </dl>
            </ReviewSection>

            <ReviewSection
              title="Tid och kallelse"
              description="Redigeras på besiktningen och styr motsvarande uppgifter i utlåtandet."
              action={
                <button
                  type="button"
                  onClick={() => void saveInspectionDetails()}
                  disabled={isLocked || inspectionSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {inspectionSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {inspectionSaving ? 'Sparar...' : 'Spara'}
                </button>
              }
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {fieldLabel(
                  'Besiktningsdatum',
                  <input
                    type="date"
                    value={inspectionForm.inspectionDate}
                    onChange={(event) => updateInspectionField('inspectionDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Besiktningstid',
                  <input
                    type="time"
                    value={inspectionForm.inspectionTime}
                    onChange={(event) => updateInspectionField('inspectionTime', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Samlingsplats',
                  <input
                    value={inspectionForm.meetingPlace}
                    onChange={(event) => updateInspectionField('meetingPlace', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Kallelsemetod',
                  <InvitationMethodField
                    value={inspectionForm.invitationMethod}
                    onChange={(value) => updateInspectionField('invitationMethod', value)}
                  />
                )}
                {fieldLabel(
                  'Kallelsedatum',
                  <input
                    type="date"
                    value={inspectionForm.invitationDate}
                    onChange={(event) => updateInspectionField('invitationDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Försammanträde',
                  <input
                    type="time"
                    value={inspectionForm.startMeetingTime}
                    onChange={(event) => updateInspectionField('startMeetingTime', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Slutsammanträde',
                  <input
                    type="time"
                    value={inspectionForm.finalMeetingTime}
                    onChange={(event) => updateInspectionField('finalMeetingTime', event.target.value)}
                    className={inputClassName()}
                  />
                )}
              </div>
            </ReviewSection>

            <ReviewSection
              title="Närvarande och sändlista"
              description="Samma deltagare används för närvaroredovisning, kallelse och sändlista."
              action={
                <button
                  type="button"
                  onClick={() => void saveParticipants()}
                  disabled={isLocked || participantsSaving || invitationLoading || !invitationLoaded}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {participantsSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {participantsSaving ? 'Sparar...' : 'Spara'}
                </button>
              }
            >
              {invitationLoading ? (
                <div className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/50 px-3 py-3 text-sm text-gray-600">
                  <Loader2 size={16} className="animate-spin text-emerald-700" />
                  Hämtar kallelse och deltagare...
                </div>
              ) : (
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <div className="space-y-3">
                    {fieldLabel(
                      'Ämne',
                      <input
                        value={invitationSubject}
                        onChange={(event) => setInvitationSubject(event.target.value)}
                        className={inputClassName()}
                      />
                    )}
                    {fieldLabel(
                      'Kallelsetext',
                      <textarea
                        value={invitationBody}
                        onChange={(event) => setInvitationBody(event.target.value)}
                        rows={10}
                        className={`${inputClassName()} resize-y leading-6`}
                      />
                    )}
                  </div>
                  <ParticipantEditor
                    project={round.project}
                    participants={participants}
                    onAdd={addParticipant}
                    onRemove={removeParticipant}
                    onChange={updateParticipant}
                  />
                </div>
              )}
            </ReviewSection>

            <ReviewSection
              title="Tidigare besiktningar"
              description="Visas i samma avsnitt som tidigare besiktningar i utlåtandet."
              action={
                <button
                  type="button"
                  onClick={() => void saveInspectionDetails()}
                  disabled={isLocked || inspectionSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {inspectionSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {inspectionSaving ? 'Sparar...' : 'Spara'}
                </button>
              }
            >
              <PreviousInspectionsEditor
                rows={inspectionForm.previousInspections}
                onChange={(rows) => updateInspectionField('previousInspections', rows)}
              />
            </ReviewSection>

            <ReviewSection
              hidden={isDrainageProject}
              title="Provning och dokumentation"
              description="Handlingar som redovisats inför besiktningen."
              action={
                <button
                  type="button"
                  onClick={() => void saveDocuments()}
                  disabled={isLocked || documentsSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {documentsSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {documentsSaving ? 'Sparar...' : 'Spara'}
                </button>
              }
            >
              <InspectionDocumentsEditor documents={documents} onChange={setDocuments} />
            </ReviewSection>

            {isDrainageProject || checkpoints.length > 0 ? (
              <ReviewSection
                title="Kontrollunderlag dränering"
                description="Status och kommentarer för mallens kontrollpunkter."
                action={
                  <button
                    type="button"
                    onClick={() => void saveCheckpoints()}
                    disabled={isLocked || checkpointsSaving || checkpoints.length === 0}
                    className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    {checkpointsSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                    {checkpointsSaving ? 'Sparar...' : 'Spara'}
                  </button>
                }
              >
                {checkpoints.length === 0 ? (
                  <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-3 text-sm text-gray-600">
                    Inga kontrollpunkter är skapade för besiktningen.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {checkpointGroups.map((group) => (
                      <section key={group.key} className="overflow-hidden rounded-md border border-emerald-100 bg-white">
                        <div className="flex items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/50 px-3 py-2">
                          <h3 className="text-sm font-semibold text-gray-950">{group.label}</h3>
                          <span className="text-xs font-medium text-gray-500">{group.checkpoints.length} st</span>
                        </div>
                        <div className="divide-y divide-emerald-100">
                          {group.checkpoints.map((checkpoint) => {
                            const checkpointImages = checkpoint.noteId
                              ? imagesByNoteId.get(checkpoint.noteId) ?? []
                              : []
                            return (
                            <div key={checkpoint.id} className="grid gap-3 px-3 py-3 lg:grid-cols-[minmax(0,1fr)_12rem_minmax(14rem,0.75fr)_9rem]">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <p className="text-sm font-semibold text-gray-950">{checkpoint.title}</p>
                                  {checkpoint.photoRequired ? (
                                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                                      Foto
                                    </span>
                                  ) : null}
                                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${checkpointStatusClassName(checkpoint.status)}`}>
                                    {checkpointStatusLabel(checkpoint.status)}
                                  </span>
                                </div>
                                {checkpoint.guidance ? (
                                  <p className="mt-1 text-xs leading-5 text-gray-600">{checkpoint.guidance}</p>
                                ) : null}
                                {checkpoint.verificationMethod ? (
                                  <p className="mt-1 text-xs leading-5 text-gray-500">{checkpoint.verificationMethod}</p>
                                ) : null}
                              </div>
                              <select
                                value={checkpoint.status}
                                onChange={(event) =>
                                  updateCheckpoint(
                                    checkpoint.id,
                                    'status',
                                    event.target.value as EbInspectionCheckpointStatus
                                  )
                                }
                                disabled={isLocked}
                                className={inputClassName()}
                              >
                                {CHECKPOINT_STATUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <textarea
                                value={checkpoint.comment ?? ''}
                                onChange={(event) => updateCheckpoint(checkpoint.id, 'comment', event.target.value)}
                                disabled={isLocked}
                                rows={3}
                                placeholder="Kommentar"
                                className={`${inputClassName()} resize-y leading-6`}
                              />
                              <div className="flex flex-col gap-2">
                                <button
                                  type="button"
                                  onClick={() => chooseCheckpointImage(checkpoint)}
                                  disabled={isLocked || uploadingImage || uploadingCheckpointImageId === checkpoint.id}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {uploadingCheckpointImageId === checkpoint.id ? (
                                    <Loader2 size={16} className="animate-spin" />
                                  ) : (
                                    <Camera size={16} />
                                  )}
                                  Foto
                                </button>
                                {checkpointImages.length > 0 ? (
                                  <div className="grid grid-cols-3 gap-1">
                                    {checkpointImages.slice(0, 3).map((image) => (
                                      <img
                                        key={image.id}
                                        src={image.thumbnailUrl ?? image.publicUrl}
                                        alt={image.label ?? 'Foto'}
                                        loading="lazy"
                                        decoding="async"
                                        className="aspect-square w-full rounded-md border border-emerald-100 object-cover"
                                      />
                                    ))}
                                  </div>
                                ) : (
                                  <span className="text-xs text-gray-500">Inga foton</span>
                                )}
                              </div>
                            </div>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </ReviewSection>
            ) : null}

            <ReviewSection
              title="Utlåtandeuppgifter"
              description="Beslut, datum, garanti, reklamation och kostnadsfördelning."
              action={
                <button
                  type="button"
                  onClick={() => void saveInspectionDetails()}
                  disabled={isLocked || inspectionSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {inspectionSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {inspectionSaving ? 'Sparar...' : 'Spara'}
                </button>
              }
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                {fieldLabel(
                  'Besiktningsman utsedd av',
                  <select
                    value={inspectionForm.inspectorAppointedBy}
                    onChange={(event) => updateInspectionField('inspectorAppointedBy', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="client">Beställare</option>
                    <option value="parties_jointly">Parterna gemensamt</option>
                    <option value="contractor">Entreprenör</option>
                  </select>
                )}
                {fieldLabel(
                  'Beslut',
                  <select
                    value={inspectionForm.approvalStatus}
                    onChange={(event) => updateInspectionField('approvalStatus', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="approved">Godkänd</option>
                    <option value="not_approved">Ej godkänd</option>
                    <option value="partly_approved">Delvis godkänd</option>
                  </select>
                )}
                <div className="md:col-span-2 xl:col-span-4">
                  {fieldLabel(
                    'Beslutets motivering',
                    <textarea
                      value={inspectionForm.approvalNote}
                      onChange={(event) => updateInspectionField('approvalNote', event.target.value)}
                      rows={3}
                      className={`${inputClassName()} resize-y leading-6`}
                    />
                  )}
                </div>
                {fieldLabel(
                  'Fortsatt slutbesiktning',
                  <select
                    value={inspectionForm.requiresContinuedFinalInspection}
                    onChange={(event) => updateInspectionField('requiresContinuedFinalInspection', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="true">Ja</option>
                    <option value="false">Nej</option>
                  </select>
                )}
                {inspectionForm.requiresContinuedFinalInspection === 'true' ? (
                  <>
                    {fieldLabel(
                      'Ny slutbesiktning datum',
                      <input
                        type="date"
                        value={inspectionForm.continuedFinalInspectionDate}
                        onChange={(event) => updateInspectionField('continuedFinalInspectionDate', event.target.value)}
                        className={inputClassName()}
                      />
                    )}
                    {fieldLabel(
                      'Ny slutbesiktning tid',
                      <input
                        type="time"
                        value={inspectionForm.continuedFinalInspectionTime}
                        onChange={(event) => updateInspectionField('continuedFinalInspectionTime', event.target.value)}
                        className={inputClassName()}
                      />
                    )}
                  </>
                ) : null}
                {fieldLabel(
                  'Garantitid',
                  <select
                    value={inspectionForm.warrantyPeriodYears}
                    onChange={(event) => updateInspectionField('warrantyPeriodYears', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    {Array.from({ length: 10 }, (_, index) => index + 1).map((year) => (
                      <option key={year} value={year}>
                        {year} år
                      </option>
                    ))}
                  </select>
                )}
                {fieldLabel(
                  'Garantitidens slut',
                  <input
                    type="date"
                    value={inspectionForm.warrantyEndDate}
                    onChange={(event) => updateInspectionField('warrantyEndDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Särskild varugaranti för',
                  <input
                    value={inspectionForm.warrantyScope}
                    onChange={(event) => updateInspectionField('warrantyScope', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Fel avhjälpta senast',
                  <input
                    type="date"
                    value={inspectionForm.defaultRemedyDeadline}
                    onChange={(event) => updateInspectionField('defaultRemedyDeadline', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Efterbesiktning påkallad',
                  <select
                    value={inspectionForm.afterInspectionRequested}
                    onChange={(event) => updateInspectionField('afterInspectionRequested', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="true">Ja</option>
                    <option value="false">Nej</option>
                  </select>
                )}
                {fieldLabel(
                  'Efterbesiktning påkallad av',
                  <select
                    value={inspectionForm.afterInspectionRequestedBy}
                    onChange={(event) => updateInspectionField('afterInspectionRequestedBy', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="client">Beställare</option>
                    <option value="contractor">Hantverkare</option>
                  </select>
                )}
                {fieldLabel(
                  'Efterbesiktning senast',
                  <input
                    type="date"
                    value={inspectionForm.afterInspectionDueDate}
                    onChange={(event) => updateInspectionField('afterInspectionDueDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Distributionsdatum',
                  <input
                    type="date"
                    value={inspectionForm.reportDistributionDate}
                    onChange={(event) => updateInspectionField('reportDistributionDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                <div className="md:col-span-2 xl:col-span-4">
                  {fieldLabel(
                    'Besiktningskostnadens fördelning',
                    <textarea
                      value={inspectionForm.inspectionCostDistribution}
                      onChange={(event) => updateInspectionField('inspectionCostDistribution', event.target.value)}
                      rows={3}
                      className={`${inputClassName()} resize-y leading-6`}
                    />
                  )}
                </div>
                <label className="flex min-h-[2.75rem] items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm font-medium text-emerald-900">
                  <input
                    type="checkbox"
                    checked={inspectionForm.afterInspectionNoticeInReport}
                    onChange={(event) => updateInspectionField('afterInspectionNoticeInReport', event.target.checked)}
                    className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  Utlåtandet gäller som kallelse till efterbesiktning
                </label>
              </div>
            </ReviewSection>

            <ReviewSection
              title="Förklaringar"
              description="Förklaringar som visas vid fel och förhållanden."
              action={
                <button
                  type="button"
                  onClick={() => void saveInspectionDetails()}
                  disabled={isLocked || inspectionSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {inspectionSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {inspectionSaving ? 'Sparar...' : 'Spara'}
                </button>
              }
            >
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                {fieldLabel(
                  'Övriga förklaringar',
                  <textarea
                    value={inspectionForm.defectNumberingExplanation}
                    onChange={(event) => updateInspectionField('defectNumberingExplanation', event.target.value)}
                    rows={4}
                    className={`${inputClassName()} resize-y leading-6`}
                  />
                )}
                {fieldLabel(
                  'Lokal, byggdel eller installationsdel utan fel redovisas',
                  <select
                    value={inspectionForm.defectNoErrorPartsPolicy}
                    onChange={(event) => updateInspectionField('defectNoErrorPartsPolicy', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="not_listed">inte</option>
                    <option value="listed_with_dash">med ---</option>
                  </select>
                )}
              </div>
            </ReviewSection>

            <ReviewSection
              title="Utlåtandetexter"
              description="Alla utlåtandesektioner visas i samma ordning som de sedan renderas i utlåtandet."
              action={
                <button
                  type="button"
                  onClick={() => void saveReportDraft()}
                  disabled={isLocked || reportDraftSaving}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {reportDraftSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
                  {reportDraftSaving ? 'Sparar...' : 'Spara texter'}
                </button>
              }
            >
              <ReportDraftSectionsEditor sections={reportSections} onChange={setReportSections} />
            </ReviewSection>

            <ReviewSection
              title="Noteringar"
              description="Ordningen här styr ordningen i utlåtandet."
            >
              <div className="overflow-x-auto rounded-md border border-emerald-100 bg-white/70 px-2 py-2">
            <div className="flex min-w-max gap-2">
              <button
                type="button"
                onClick={showAllDisciplines}
                className={
                  activeDisciplineId === null
                    ? 'inline-flex items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white'
                    : 'inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50'
                }
              >
                Alla
                <span
                  className={
                    activeDisciplineId === null
                      ? 'rounded-full bg-white/20 px-2 py-0.5 text-xs text-white'
                      : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                  }
                >
                  {round.notes.length}
                </span>
              </button>
              {round.disciplines.map((discipline) => {
                const count = round.notes.filter((note) => note.disciplineId === discipline.id).length
                const active = discipline.id === activeDisciplineId
                return (
                  <button
                    key={discipline.id}
                    type="button"
                    onClick={() => selectDiscipline(discipline.id)}
                    className={
                      active
                        ? 'inline-flex items-center gap-2 rounded-md border border-emerald-700 bg-emerald-700 px-3 py-2 text-sm font-semibold text-white'
                        : 'inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-50'
                    }
                  >
                    {discipline.label}
                    <span
                      className={
                        active
                          ? 'rounded-full bg-white/20 px-2 py-0.5 text-xs text-white'
                          : 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800'
                      }
                    >
                      {count}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-3 min-h-[62vh]">
            <section className="min-w-0 border-y border-emerald-100 bg-white/82 backdrop-blur-sm">
              <div className="grid grid-cols-[4rem_4rem_7rem_8rem_8rem_1fr_11rem_5rem_3rem] items-center gap-3 border-b border-emerald-100 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-gray-500">
                <span>Bet.</span>
                <span>Nr</span>
                <span>Status</span>
                <span>Rum</span>
                <span>Plats</span>
                <span>Notering</span>
                <span>Bilder</span>
                <span>Flytta</span>
                <span />
              </div>
              <div className="flex items-center justify-between border-b border-emerald-100 px-3 py-2">
                <div>
                  <h2 className="text-sm font-semibold text-gray-950">
                    {activeDiscipline ? activeDiscipline.label : 'Alla noteringar'}
                  </h2>
                  <p className="text-xs text-gray-600">{activeDiscipline?.littera ?? 'Samtliga fack'}</p>
                </div>
                <div className="flex items-center gap-3">
                  {orderSaving ? (
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <Loader2 size={13} className="animate-spin" />
                      Sparar ordning
                    </span>
                  ) : null}
                  <span className="text-xs font-medium text-gray-500">{filteredNotes.length} st</span>
                  <button
                    type="button"
                    onClick={handleNewNote}
                    disabled={isLocked}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-emerald-700 px-3 text-xs font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                  >
                    <Plus size={14} />
                    Ny notering
                  </button>
                </div>
              </div>

              {filteredNotes.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-600">Inga noteringar.</div>
              ) : (
                <div className="divide-y divide-emerald-100">
                  {filteredNotes.map((note, index) => {
                    const canMoveUp = index > 0
                    const canMoveDown = index < filteredNotes.length - 1
                    return (
                      <article
                        key={note.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleEdit(note)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') handleEdit(note)
                        }}
                        className="grid cursor-pointer grid-cols-[4rem_4rem_7rem_8rem_8rem_1fr_11rem_5rem_3rem] items-center gap-3 px-3 py-2 text-sm transition hover:bg-emerald-50/70"
                      >
                        <span className="truncate text-sm font-semibold text-amber-900">
                          {note.markerKey || note.responsibleParty || '-'}
                        </span>
                        <span className="font-semibold text-emerald-900">{displayNumberByNoteId.get(note.id) ?? '-'}</span>
                        <span className="truncate text-xs font-medium text-gray-700">{note.statusLabel ?? note.statusKey}</span>
                        <span className="truncate text-gray-700">{note.room || '-'}</span>
                        <span className="truncate text-gray-700">{note.location || '-'}</span>
                        <span className="truncate text-gray-950">{note.noteText}</span>
                        <div className="flex min-w-0 items-center gap-1.5">
                          {(imagesByNoteId.get(note.id) ?? []).slice(0, 3).map((image) => (
                            <img
                              key={image.id}
                              src={image.thumbnailUrl ?? image.publicUrl}
                              alt={image.label ?? 'Bild'}
                              loading="lazy"
                              decoding="async"
                              className="h-8 w-8 shrink-0 rounded-md border border-emerald-100 object-cover"
                            />
                          ))}
                          <span className="shrink-0 text-xs font-medium text-gray-600">
                            {imagesByNoteId.get(note.id)?.length ?? 0} st
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              chooseNoteRowImage(note)
                            }}
                            disabled={isLocked || uploadingImage}
                            className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="LÃ¤gg till bild"
                            title="LÃ¤gg till bild"
                          >
                            {uploadingImage && uploadingImageNoteId === note.id ? (
                              <Loader2 size={15} className="animate-spin" />
                            ) : (
                              <ImageIcon size={15} />
                            )}
                          </button>
                        </div>
                        <div className="flex justify-start gap-1">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              if (canMoveUp) handleMoveNote(note, 'up')
                            }}
                            disabled={isLocked || !canMoveUp}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            aria-label="Flytta upp"
                            title="Flytta upp"
                          >
                            <ChevronUp size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              if (canMoveDown) handleMoveNote(note, 'down')
                            }}
                            disabled={isLocked || !canMoveDown}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:text-gray-300 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            aria-label="Flytta ned"
                            title="Flytta ned"
                          >
                            <ChevronDown size={16} />
                          </button>
                        </div>
                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              handleEdit(note)
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-800 transition hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            aria-label="Redigera"
                            title="Redigera"
                          >
                            <Pencil size={16} />
                          </button>
                      </div>
                    </article>
                    )
                  })}
                </div>
              )}
            </section>
          </div>
        </ReviewSection>
      </div>
    </div>

        {editorOpen ? (
          <div className="fixed inset-0 z-[100] flex justify-end bg-slate-950/25" onClick={closeEditor}>
            <aside
              className="flex h-full w-full max-w-7xl flex-col bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">
                    {editingNote ? 'Redigera' : 'Ny notering'}
                  </p>
                  <h2 className="text-lg font-semibold text-gray-950">
                    {getNoteLabel(round, editingNote, nextNoteNumber)}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  {noteAutosaveStatusText ? (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                      {noteAutosaveStatus === 'saving' ? <Loader2 size={13} className="animate-spin" /> : null}
                      {noteAutosaveStatusText}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (previousEditingNote) handleEdit(previousEditingNote)
                    }}
                  disabled={isLocked || !previousEditingNote}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-base font-semibold text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                    aria-label="Föregående notering"
                    title="Föregående notering"
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (nextEditingNote) handleEdit(nextEditingNote)
                    }}
                  disabled={isLocked || !nextEditingNote}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-base font-semibold text-gray-800 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-300"
                    aria-label="Nästa notering"
                    title="Nästa notering"
                  >
                    &gt;
                  </button>
                <button
                    type="button"
                    onClick={closeEditor}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
                    aria-label="Stäng"
                    title="Stäng"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_32rem]">
              <form onSubmit={(event) => void handleSubmit(event)} className="min-h-0 space-y-3 overflow-y-auto p-4">
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={(event) => void handleImageSelected(event)} className="hidden" />
                <input ref={galleryInputRef} type="file" accept="image/*" onChange={(event) => void handleImageSelected(event)} className="hidden" />

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Beteckning</span>
                    <select
                      value={form.markerKey}
                      onChange={(event) => updateField('markerKey', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    >
                      {round.markers.map((marker) => (
                        <option key={marker.key} value={marker.key}>
                          {marker.key} - {marker.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Status</span>
                    <select
                      value={form.statusKey}
                      onChange={(event) => updateField('statusKey', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    >
                      {round.statuses.map((status) => (
                        <option key={status.key} value={status.key}>
                          {status.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Rum</span>
                    <input
                      value={form.room}
                      onChange={(event) => updateField('room', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Plats</span>
                    <input
                      value={form.location}
                      onChange={(event) => updateField('location', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    />
                  </label>
                </div>

                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700">Platskomplettering</span>
                  <input
                    value={form.placeDetail}
                    onChange={(event) => updateField('placeDetail', event.target.value)}
                    className={`${inputClassName()} mt-1`}
                  />
                </label>

                <label className="block">
                  <span className="block text-xs font-semibold text-gray-700">Notering</span>
                  <textarea
                    value={form.noteText}
                    onChange={(event) => updateField('noteText', event.target.value)}
                    rows={5}
                    required
                    className={`${inputClassName()} mt-1 resize-y leading-6`}
                  />
                </label>

                {visibleSuggestions.length > 0 ? (
                  <div className="space-y-1">
                    {visibleSuggestions.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => updateField('noteText', suggestion)}
                        className="block w-full rounded-md border border-emerald-100 bg-emerald-50 px-3 py-2 text-left text-xs text-emerald-950 transition hover:bg-emerald-100"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                ) : null}

                <section
                  className="rounded-md border border-dashed border-emerald-300 bg-white p-3"
                  onDragOver={(event) => {
                    if (!editingNote) return
                    event.preventDefault()
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const imageId = event.dataTransfer.getData('application/x-eb-image-id')
                    if (imageId) void attachImage(imageId)
                  }}
                >
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Noteringens bilder</p>
                      <p className="text-sm font-semibold text-gray-950">
                        {editingNote ? (imagesByNoteId.get(editingNote.id)?.length ?? 0) : 0} st
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        disabled={isLocked || uploadingImage || !editingNote}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-emerald-700 text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                        aria-label="Kamera"
                        title="Kamera"
                      >
                        {uploadingImage ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                      </button>
                      <button
                        type="button"
                        onClick={() => galleryInputRef.current?.click()}
                        disabled={isLocked || uploadingImage || !editingNote}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                        aria-label="Bild"
                        title="Bild"
                      >
                        <ImageIcon size={18} />
                      </button>
                    </div>
                  </div>

                  {editingNote && (imagesByNoteId.get(editingNote.id)?.length ?? 0) > 0 ? (
                    <div className={imageViewCount === 1 ? 'grid grid-cols-1 gap-2' : imageViewCount === 4 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-3 gap-2'}>
                      {(imagesByNoteId.get(editingNote.id) ?? []).slice(0, imageViewCount).map((image) => (
                        <div key={image.id} className="relative overflow-hidden rounded-md border border-emerald-100 bg-white">
                          <img
                            src={image.thumbnailUrl ?? image.publicUrl}
                            alt={image.label ?? 'Bild'}
                            loading="lazy"
                            decoding="async"
                            className="aspect-square w-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={() => void detachImage(image)}
                            disabled={isLocked || deletingImageId === image.id}
                            className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-rose-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label="Koppla loss bild"
                            title="Koppla loss"
                          >
                            {deletingImageId === image.id ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-md bg-emerald-50 px-3 py-4 text-sm text-gray-600">
                      Dra in bilder från bildbanken eller lägg till en ny bild.
                    </p>
                  )}
                </section>


                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Ansvarig</span>
                    <input
                      value={form.responsibleParty}
                      onChange={(event) => updateField('responsibleParty', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-gray-700">Yrkesgrupp</span>
                    <input
                      value={form.tradeGroup}
                      onChange={(event) => updateField('tradeGroup', event.target.value)}
                      className={`${inputClassName()} mt-1`}
                    />
                  </label>
                </div>

                {showReportFields ? (
                <section className="rounded-md border border-emerald-100 bg-emerald-50/25 p-3">
                  <div className="mb-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Utlåtandeuppgifter</p>
                    <p className="text-xs text-gray-600">
                      {showDeductionFields
                        ? 'Används för nedsättning i utlåtandet.'
                        : 'Används för särskild utredning i utlåtandet.'}
                    </p>
                  </div>
                  {showInvestigationFields ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="block">
                          <span className="block text-xs font-semibold text-gray-700">Utredning ansvarig</span>
                          <select
                            value={form.investigationResponsibleParty}
                            onChange={(event) => updateField('investigationResponsibleParty', event.target.value)}
                            className={`${inputClassName()} mt-1`}
                          >
                            <option value="">Ej vald</option>
                            <option value="contractor">Entreprenör</option>
                            <option value="client">Beställare</option>
                            <option value="other">Annat</option>
                          </select>
                        </label>
                        <label className="block">
                          <span className="block text-xs font-semibold text-gray-700">Kostnadsansvar</span>
                          <select
                            value={form.investigationCostParty}
                            onChange={(event) => updateField('investigationCostParty', event.target.value)}
                            className={`${inputClassName()} mt-1`}
                          >
                            <option value="">Ej vald</option>
                            <option value="contractor">Entreprenör</option>
                            <option value="client">Beställare</option>
                          </select>
                        </label>
                      </div>
                      <label className="mt-3 block">
                        <span className="block text-xs font-semibold text-gray-700">Klar senast</span>
                        <input
                          type="date"
                          value={form.investigationDueDate}
                          onChange={(event) => updateField('investigationDueDate', event.target.value)}
                          className={`${inputClassName()} mt-1`}
                        />
                      </label>
                      <label className="mt-3 block">
                        <span className="block text-xs font-semibold text-gray-700">Ansvarig/kommentar</span>
                        <input
                          value={form.investigationResponsibleNote}
                          onChange={(event) => updateField('investigationResponsibleNote', event.target.value)}
                          className={`${inputClassName()} mt-1`}
                        />
                      </label>
                    </>
                  ) : null}
                  {showDeductionFields ? (
                    <label className="block">
                      <span className="block text-xs font-semibold text-gray-700">
                        Uppskattad nedsättning, kronor
                      </span>
                      <input
                        value={form.deductionAmount}
                        onChange={(event) => updateField('deductionAmount', event.target.value)}
                        placeholder="Belopp"
                        className={`${inputClassName()} mt-1`}
                      />
                    </label>
                  ) : null}
                </section>
                ) : null}

                {error ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                {editingNote ? (
                  <button
                    type="button"
                    onClick={() => void handleDelete(editingNote)}
                    disabled={isLocked || deletingId === editingNote.id}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {deletingId === editingNote.id ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                    Radera notering
                  </button>
                ) : null}

                <button
                  type="submit"
                  disabled={isLocked || saving || round.disciplines.length === 0}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : editingNote ? <X size={16} /> : <Plus size={16} />}
                  {saving ? 'Sparar...' : editingNote ? 'Klar' : 'Skapa notering'}
                </button>
              </form>
              <aside className="min-h-0 border-l border-emerald-100 bg-emerald-50/20 p-4">
                <div className="flex h-full min-h-0 flex-col gap-4">
                  <section className="flex min-h-0 flex-1 flex-col rounded-md border border-emerald-100 bg-white">
                    <div className="border-b border-emerald-100 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Bildbank</p>
                          <p className="text-sm font-semibold text-gray-950">{imageBankImages.length} bilder</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowLinkedImages((current) => !current)}
                          className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                            showLinkedImages
                              ? 'border-emerald-700 bg-emerald-700 text-white'
                              : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
                          }`}
                        >
                          Visa kopplade
                        </button>
                      </div>
                      <div className="mt-3 flex gap-2">
                        {[1, 4, 9].map((count) => (
                          <button
                            key={count}
                            type="button"
                            onClick={() => setImageViewCount(count)}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-md border ${
                              imageViewCount === count
                                ? 'border-emerald-700 bg-emerald-700 text-white'
                                : 'border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
                            }`}
                            aria-label={`Visa ${count} bild${count === 1 ? '' : 'er'}`}
                            title={`Visa ${count} bild${count === 1 ? '' : 'er'}`}
                          >
                            {count === 1 ? <ImageIcon size={15} /> : count === 4 ? <Grid2X2 size={15} /> : <Grid3X3 size={15} />}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto p-3">
                      {imageBankImages.length === 0 ? (
                        <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-8 text-center text-sm text-gray-600">
                          Inga okopplade bilder i bildbanken.
                        </p>
                      ) : (
                        <div className={imageViewCount === 1 ? 'grid grid-cols-1 gap-2' : imageViewCount === 4 ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-3 gap-2'}>
                          {imageBankImages.map((image) => {
                            const note = image.noteId ? round.notes.find((item) => item.id === image.noteId) ?? null : null
                            const linkedToCurrent = editingNote?.id === image.noteId
                            return (
                              <button
                                key={image.id}
                                type="button"
                                draggable={Boolean(editingNote)}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData('application/x-eb-image-id', image.id)
                                  event.dataTransfer.effectAllowed = 'move'
                                }}
                                onClick={() => {
                                  if (!image.noteId) void attachImage(image.id)
                                  else if (note) handleEdit(note)
                                }}
                                disabled={isLocked || movingImageId === image.id}
                                className={
                                  linkedToCurrent
                                    ? 'relative overflow-hidden rounded-md border-2 border-emerald-600 bg-white text-left'
                                    : 'relative overflow-hidden rounded-md border border-emerald-100 bg-white text-left transition hover:border-emerald-300 disabled:cursor-wait disabled:opacity-60'
                                }
                              >
                                <img
                                  src={image.thumbnailUrl ?? image.publicUrl}
                                  alt={image.label ?? 'Bild'}
                                  loading="lazy"
                                  decoding="async"
                                  className="aspect-square w-full object-cover"
                                />
                                <span className="block truncate px-1.5 py-1 text-[11px] font-semibold text-gray-700">
                                  {note ? `${round.project.notePrefix} ${displayNumberByNoteId.get(note.id) ?? note.noteNumber ?? ''}` : 'Okopplad'}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </section>
                </div>
              </aside>
              </div>
            </aside>
          </div>
        ) : null}
      </main>
    </Protected>
  )
}
