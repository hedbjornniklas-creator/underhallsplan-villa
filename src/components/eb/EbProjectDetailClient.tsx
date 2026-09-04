'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  ListChecks,
  Lock,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Send,
  Smartphone,
  Trash2,
  Unlock,
  UserPlus,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import PendingLink from '@/components/ui/PendingLink'
import EbAgreementDocumentField from '@/components/eb/EbAgreementDocumentField'
import EbProjectAttachmentsPanel from '@/components/eb/EbProjectAttachmentsPanel'
import EbAssignmentConfirmationDialog from '@/components/eb/EbAssignmentConfirmationDialog'
import { useEbToast } from '@/components/eb/EbToastProvider'
import EbProjectForm, {
  buildEbProjectForm,
  ebProjectFormToPayload,
  type EbProjectFormState,
} from '@/components/eb/EbProjectForm'
import {
  isEbFinalDecisionInspection,
  isEbPreliminaryInspection,
} from '@/lib/eb/reportSectionRules'
import type {
  EbProjectAgreementAttachmentLink,
  EbProjectAgreementAttachmentLinkInput,
  EbProjectAttachment,
  EbInspectionDocument,
  EbInspectionSummary,
  EbInspectionVariant,
  EbInvitationContext,
  EbInvitationParticipant,
  EbPreviousInspectionItem,
  EbProjectListItem,
} from '@/lib/eb/server'
import { resolveEbAgreementVocabulary } from '@/lib/eb/vocabulary'
import type { EbAssignmentConfirmationSummary } from '@/lib/eb/assignmentConfirmationTypes'

const DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION =
  'Fönster, dörrar, väggar etc numreras från vänster till höger. Vägg 1 = vägg till vänster om entrévägg. Vägg 2 = nästa vägg till höger om vägg 1 osv.'
const STANDARD_AGREEMENT_ATTACHMENT_KEY = 'standard'

type EbProjectDetailClientProps = {
  project: EbProjectListItem
  attachments: EbProjectAttachment[]
  assignmentConfirmations: EbAssignmentConfirmationSummary[]
}

type InspectionFormState = {
  variant: EbInspectionVariant
  parentInspectionId: string
  inspectionDate: string
  inspectionTime: string
  meetingPlace: string
  startMeetingTime: string
  finalMeetingTime: string
}

type CreateInspectionResponse = {
  project?: EbProjectListItem
  error?: string
}

type UpdateInspectionResponse = {
  project?: EbProjectListItem
  error?: string
}

type DeleteInspectionResponse = {
  project?: EbProjectListItem
  inspectionId?: string
  error?: string
}

type UpdateProjectResponse = {
  project?: EbProjectListItem
  error?: string
}

type AgreementAttachmentsResponse = {
  links?: EbProjectAgreementAttachmentLink[]
  documents?: EbProjectAttachment[]
  available?: boolean
  project?: EbProjectListItem
  error?: string
}

type InvitationResponse = EbInvitationContext & {
  error?: string
}

type InspectionDocumentsResponse = {
  documents?: EbInspectionDocument[]
  error?: string
}

type SendInvitationResponse = {
  sentCount?: number
  project?: EbProjectListItem
  error?: string
}

type ReportDeliveryResponse = {
  project?: EbProjectListItem
  downloadUrl?: string | null
  pdfStatus?: string | null
  error?: string
}

type UnlockInspectionResponse = {
  ok?: boolean
  project?: EbProjectListItem
  error?: string
}

type EditableParticipant = EbInvitationParticipant & {
  localId: string
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
  invoiceRecipientMatchesClient: boolean
  invoiceName: string
  invoiceOrgNo: string
  invoiceReference: string
  invoiceEmailMatchesClient: boolean
  invoiceEmail: string
  invoiceAddressMatchesClient: boolean
  invoiceAddress: string
  invoicePostalCode: string
  invoiceCity: string
}

type InspectionDetailsTabKey =
  | 'time'
  | 'previous'
  | 'documents'
  | 'defect_explanations'
  | 'report'
  | 'participants'
  | 'billing'

const INSPECTION_DETAILS_TABS: Array<{
  key: InspectionDetailsTabKey
  label: string
  icon: typeof CalendarDays
}> = [
  { key: 'time', label: 'Tid och kallelse', icon: CalendarDays },
  { key: 'previous', label: 'Tidigare', icon: ClipboardCheck },
  { key: 'documents', label: 'Handlingar', icon: FileText },
  { key: 'defect_explanations', label: 'Förklaringar', icon: FileText },
  { key: 'report', label: 'Utlåtande', icon: Pencil },
  { key: 'participants', label: 'Närvarande', icon: UserPlus },
  { key: 'billing', label: 'Fakturering', icon: FileCheck2 },
]

const VARIANT_OPTIONS: Array<{ value: EbInspectionVariant; label: string }> = [
  { value: 'SLB', label: 'Slutbesiktning' },
  { value: 'EB', label: 'Efterbesiktning' },
  { value: 'FB', label: 'Förbesiktning' },
  { value: 'GB', label: 'Garantibesiktning' },
  { value: 'KSB', label: 'Kompletterande slutbesiktning' },
  { value: 'SAB', label: 'Särskild besiktning' },
]

function buildInitialInspectionForm(project: EbProjectListItem): InspectionFormState {
  const latestInspection = project.inspections.at(-1)
  return {
    variant: project.inspections.length === 0 ? 'SLB' : 'EB',
    parentInspectionId: latestInspection?.inspectionId ?? '',
    inspectionDate: '',
    inspectionTime: '',
    meetingPlace: '',
    startMeetingTime: '',
    finalMeetingTime: '',
  }
}

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

function formatDateTime(value: string | null) {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('sv-SE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function getStatusLabel(status: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (normalized === 'draft') return 'Utkast'
  if (normalized === 'ongoing') return 'Pågående'
  if (normalized === 'completed') return 'Klar'
  if (normalized === 'archived') return 'Arkiverad'
  return status ?? 'Pågående'
}

function inspectionScheduleHasPassed(
  inspectionDate: string | null,
  inspectionTime: string | null,
  now = new Date()
) {
  const date = inspectionDate?.slice(0, 10) ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false

  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')

  if (date < today) return true
  if (date > today) return false

  const time = inspectionTime?.slice(0, 5) ?? ''
  if (!/^\d{2}:\d{2}$/.test(time)) return false

  const [hours, minutes] = time.split(':').map(Number)
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return false
  return hours * 60 + minutes < now.getHours() * 60 + now.getMinutes()
}

type InspectionStatusTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'

type InspectionPreparationStatus = {
  label: string
  detail: string
  tone: InspectionStatusTone
  actionLabel: string
}

const INSPECTION_STATUS_TONE_CLASSES: Record<
  InspectionStatusTone,
  { icon: string; badge: string }
> = {
  success: {
    icon: 'bg-emerald-100 text-emerald-700',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  info: {
    icon: 'bg-blue-100 text-blue-700',
    badge: 'bg-blue-100 text-blue-800',
  },
  warning: {
    icon: 'bg-amber-100 text-amber-700',
    badge: 'bg-amber-100 text-amber-900',
  },
  danger: {
    icon: 'bg-rose-100 text-rose-700',
    badge: 'bg-rose-100 text-rose-800',
  },
  neutral: {
    icon: 'bg-gray-100 text-gray-600',
    badge: 'bg-gray-100 text-gray-700',
  },
}

function getAssignmentPreparationStatus(
  confirmation: EbAssignmentConfirmationSummary | null
): InspectionPreparationStatus {
  if (!confirmation) {
    return {
      label: 'Inte skapad',
      detail: 'Ingen uppdragsbekräftelse har skapats.',
      tone: 'neutral',
      actionLabel: 'Skapa',
    }
  }

  const version = `Version ${confirmation.versionNo}`
  const recipient = confirmation.customerEmail ? ` till ${confirmation.customerEmail}` : ''

  if (confirmation.status === 'expired') {
    return {
      label: 'Utgången',
      detail: `${version} · Skapa och skicka en ny version.`,
      tone: 'warning',
      actionLabel: 'Öppna',
    }
  }

  if (confirmation.status === 'cancelled') {
    return {
      label: 'Ersatt eller avbruten',
      detail: `${version} · Bekräftelsen kan inte längre godkännas.`,
      tone: 'danger',
      actionLabel: 'Öppna',
    }
  }

  if (
    confirmation.acceptedAt ||
    confirmation.status === 'ordered' ||
    confirmation.status === 'booked' ||
    confirmation.status === 'completed'
  ) {
    return {
      label: 'Godkänd',
      detail: confirmation.acceptedAt
        ? `${version} · Godkänd ${formatDateTime(confirmation.acceptedAt)}`
        : `${version} · Godkänd av beställaren`,
      tone: 'success',
      actionLabel: 'Visa',
    }
  }

  if (confirmation.status === 'sent' || confirmation.lastSentAt) {
    return {
      label: 'Inväntar godkännande',
      detail: confirmation.lastSentAt
        ? `${version} · Skickad ${formatDateTime(confirmation.lastSentAt)}${recipient}`
        : `${version} · Skickad${recipient}`,
      tone: 'info',
      actionLabel: 'Visa',
    }
  }

  return {
    label: 'Utkast – inte skickad',
    detail: `${version} · Beställaren har ännu inte fått den.`,
    tone: 'warning',
    actionLabel: 'Fortsätt',
  }
}

function getInvitationPreparationStatus(
  inspection: EbInspectionSummary
): InspectionPreparationStatus {
  if (inspection.invitationSentAt) {
    return {
      label: 'Skickad',
      detail: `Skickad via e-post ${formatDateTime(inspection.invitationSentAt)}`,
      tone: 'success',
      actionLabel: 'Visa / skicka igen',
    }
  }

  if (inspection.invitationDate) {
    return {
      label: 'Registrerad som kallad',
      detail: `Kallad ${formatDate(inspection.invitationDate)}${
        inspection.invitationMethod ? ` via ${inspection.invitationMethod}` : ''
      }`,
      tone: 'info',
      actionLabel: 'Visa / uppdatera',
    }
  }

  return {
    label: 'Ej skickad',
    detail: 'Ingen kallelse har skickats för besiktningen.',
    tone: 'warning',
    actionLabel: 'Skapa och skicka',
  }
}

function getReportStatus(inspection: EbInspectionSummary) {
  if (inspection.reportPdfStatus === 'failed') {
    return {
      label: 'PDF kunde inte skapas',
      className: 'bg-rose-100 text-rose-800',
    }
  }
  if (inspection.reportPdfStatus === 'pending' || inspection.reportPdfStatus === 'processing') {
    return {
      label: 'PDF skapas',
      className: 'bg-amber-100 text-amber-900',
    }
  }
  if (inspection.reportPdfDownloadUrl) {
    return {
      label: 'PDF sparad',
      className: 'bg-emerald-100 text-emerald-800',
    }
  }
  if (inspection.reportLockedAt) {
    return {
      label: 'Utlåtande låst',
      className: 'bg-blue-100 text-blue-800',
    }
  }
  return {
    label: 'Utlåtande i utkast',
    className: 'bg-gray-100 text-gray-700',
  }
}

function InspectionPreparationCard({
  title,
  icon: Icon,
  status,
  disabled,
  onClick,
}: {
  title: string
  icon: typeof FileCheck2
  status: InspectionPreparationStatus
  disabled: boolean
  onClick: () => void
}) {
  const toneClasses = INSPECTION_STATUS_TONE_CLASSES[status.tone]

  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${toneClasses.icon}`}>
          <Icon size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-950">{title}</p>
          <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${toneClasses.badge}`}>
            {status.label}
          </span>
          <p className="mt-1.5 break-words text-xs leading-5 text-gray-600">{status.detail}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex w-full items-center justify-center rounded-md border border-emerald-200 bg-emerald-50/50 px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {status.actionLabel}
      </button>
    </div>
  )
}

function inputClassName() {
  return 'w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
}

function inspectionNavigationClassName(primary: boolean, busy: boolean) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600'
  const variant = primary
    ? 'bg-emerald-700 text-white hover:bg-emerald-800'
    : 'border border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50'
  return busy ? `${base} ${variant} pointer-events-none cursor-wait opacity-70` : `${base} ${variant}`
}

function inspectionNavigationIconClassName(busy: boolean) {
  const base =
    'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600'
  return busy ? `${base} pointer-events-none cursor-wait opacity-70` : base
}

function inspectionMenuItemClassName(options?: { danger?: boolean; disabled?: boolean }) {
  const color = options?.danger
    ? 'text-rose-700 hover:bg-rose-50'
    : 'text-gray-800 hover:bg-emerald-50 hover:text-emerald-900'
  const disabled = options?.disabled
    ? 'cursor-not-allowed bg-gray-50 text-gray-400 hover:bg-gray-50 hover:text-gray-400'
    : color
  return `flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold transition ${disabled}`
}

function fieldLabel(label: string, children: ReactNode) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold text-gray-700">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  )
}

function invitationMethodOption(value: string) {
  const normalized = value.trim().toLocaleLowerCase('sv-SE')
  return INVITATION_METHOD_OPTIONS.find((option) => option.toLocaleLowerCase('sv-SE') === normalized)
}

function InvitationMethodField({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className: string
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
        className={className}
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
          className={className}
        />
      ) : null}
    </div>
  )
}

function toLocalParticipant(
  participant: EbInvitationParticipant,
  index: number
): EditableParticipant {
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

function ParticipantEditor({
  project,
  participants,
  onAdd,
  onRemove,
  onChange,
  title,
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
  title: string
}) {
  const vocabulary = resolveEbAgreementVocabulary(project.standardAgreement)

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-950">{title}</h3>
          <p className="mt-1 text-xs text-gray-600">
            Kryssa i vilka som var närvarande, vilka som ska kallas och vilka som ska få utlåtandet.
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
        >
          <UserPlus size={16} />
          Lägg till
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {participants.map((participant, index) => (
          <div
            key={participant.localId}
            className="rounded-lg border border-emerald-100 bg-emerald-50/25 p-3"
          >
            <div className="grid gap-2 sm:grid-cols-2">
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
              <div className="flex items-center justify-between gap-2">
                <div className="grid gap-2 text-sm font-medium text-gray-700">
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
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
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
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
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
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-gray-950">Tidigare besiktningar</h3>
          <p className="mt-1 text-xs text-gray-600">
            Lägg till tidigare besiktningar eller kompletterande fritextrader.
          </p>
        </div>
        <button
          type="button"
          onClick={addRow}
          className="inline-flex items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
        >
          <Plus size={16} />
          Lägg till
        </button>
      </div>
      <div className="grid gap-2">
        {rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-emerald-200 bg-emerald-50/40 px-3 py-2 text-sm text-gray-600">
            Inga tidigare besiktningar är registrerade. Utlåtandet visar “-”.
          </p>
        ) : null}
        {rows.map((row, index) => (
          <div
            key={`${row.key}-${index}`}
            className="grid gap-2 rounded-md border border-emerald-100 bg-white p-2 sm:grid-cols-[1fr_9rem_10rem_auto]"
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
    </section>
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
  loading,
  onChange,
}: {
  documents: EbInspectionDocument[]
  loading: boolean
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

  return (
    <section className="space-y-3 lg:col-span-2">
      <div>
        <h3 className="text-sm font-semibold text-gray-950">Provning och dokumentation</h3>
        <p className="mt-1 text-xs text-gray-600">
          Markera vilka handlingar som redovisats och granskats inför utlåtandet.
        </p>
      </div>

      {loading ? (
        <div className="rounded-md border border-emerald-100 bg-emerald-50/40 px-3 py-2 text-sm text-gray-700">
          Laddar dokumenttyper...
        </div>
      ) : documents.length === 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Inga EB-dokumenttyper finns upplagda i admin.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-emerald-100">
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
                    {document.resultLabel ? (
                      <div className="mt-0.5 text-xs text-gray-500">{document.resultLabel}</div>
                    ) : null}
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
      )}
    </section>
  )
}

function buildInspectionDetailsForm(inspection: EbInspectionSummary): InspectionDetailsFormState {
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
    reportDistributionDate: inspection.reportDistributionDate ?? new Date().toISOString().slice(0, 10),
    previousInspections: inspection.previousInspections,
    defectNumberingExplanation:
      inspection.defectNumberingExplanation ?? DEFAULT_EB_DEFECT_NUMBERING_EXPLANATION,
    defectNoErrorPartsPolicy: inspection.defectNoErrorPartsPolicy ?? 'not_listed',
    invoiceRecipientMatchesClient: inspection.invoiceRecipientMatchesClient,
    invoiceName: inspection.invoiceName ?? '',
    invoiceOrgNo: inspection.invoiceOrgNo ?? '',
    invoiceReference: inspection.invoiceReference ?? '',
    invoiceEmailMatchesClient: inspection.invoiceEmailMatchesClient,
    invoiceEmail: inspection.invoiceEmail ?? '',
    invoiceAddressMatchesClient: inspection.invoiceAddressMatchesClient,
    invoiceAddress: inspection.invoiceAddress ?? '',
    invoicePostalCode: inspection.invoicePostalCode ?? '',
    invoiceCity: inspection.invoiceCity ?? '',
  }
}

function booleanFromSelect(value: string) {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function inspectionTitle(inspection: EbInspectionSummary) {
  return `${inspection.sequenceNo}. ${inspection.variantLabel}`
}

function CreateInspectionDialog({
  open,
  project,
  onClose,
  onCreated,
}: {
  open: boolean
  project: EbProjectListItem
  onClose: () => void
  onCreated: (project: EbProjectListItem) => void
}) {
  const { showError } = useEbToast()
  const [form, setForm] = useState<InspectionFormState>(() => buildInitialInspectionForm(project))
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(buildInitialInspectionForm(project))
  }, [open, project])

  if (!open) return null

  const updateField = <K extends keyof InspectionFormState>(
    field: K,
    value: InspectionFormState[K]
  ) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    try {
      setSubmitting(true)
      const response = await fetch(`/api/eb/projects/${project.id}/inspections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json().catch(() => ({}))) as CreateInspectionResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte skapa besiktning.')
      }

      onCreated(payload.project)
      onClose()
    } catch (submitError) {
      showError(submitError, 'Kunde inte skapa besiktning.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">EB</p>
            <h2 className="text-lg font-semibold text-gray-950">Ny besiktning</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="p-4">
          <div className="grid gap-4 md:grid-cols-2">
            {fieldLabel(
              'Typ',
              <select
                value={form.variant}
                onChange={(event) => updateField('variant', event.target.value as EbInspectionVariant)}
                className={inputClassName()}
              >
                {VARIANT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )}
            {fieldLabel(
              'Kopplas till',
              <select
                value={form.parentInspectionId}
                onChange={(event) => updateField('parentInspectionId', event.target.value)}
                className={inputClassName()}
              >
                <option value="">Ingen</option>
                {project.inspections.map((inspection) => (
                  <option key={inspection.inspectionId} value={inspection.inspectionId}>
                    {inspectionTitle(inspection)}
                  </option>
                ))}
              </select>
            )}
            {fieldLabel(
              'Datum',
              <input
                type="date"
                value={form.inspectionDate}
                onChange={(event) => updateField('inspectionDate', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Tid',
              <input
                type="time"
                value={form.inspectionTime}
                onChange={(event) => updateField('inspectionTime', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Samlingsplats',
              <input
                value={form.meetingPlace}
                onChange={(event) => updateField('meetingPlace', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Startmöte',
              <input
                type="time"
                value={form.startMeetingTime}
                onChange={(event) => updateField('startMeetingTime', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Slutmöte',
              <input
                type="time"
                value={form.finalMeetingTime}
                onChange={(event) => updateField('finalMeetingTime', event.target.value)}
                className={inputClassName()}
              />
            )}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
              {submitting ? 'Skapar...' : 'Skapa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function InspectionDetailsDialog({
  open,
  project,
  inspection,
  onClose,
  onUpdated,
}: {
  open: boolean
  project: EbProjectListItem
  inspection: EbInspectionSummary | null
  onClose: () => void
  onUpdated: (project: EbProjectListItem) => void
}) {
  const { showError } = useEbToast()
  const partyVocabulary = resolveEbAgreementVocabulary(project.standardAgreement)
  const clientAddressLine = [
    project.clientAddress,
    [project.clientPostalCode, project.clientCity].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
  const [form, setForm] = useState<InspectionDetailsFormState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [participantsLoading, setParticipantsLoading] = useState(false)
  const [participantsLoaded, setParticipantsLoaded] = useState(false)
  const [documentsLoading, setDocumentsLoading] = useState(false)
  const [documentsLoaded, setDocumentsLoaded] = useState(false)
  const [documents, setDocuments] = useState<EbInspectionDocument[]>([])
  const [invitationSubject, setInvitationSubject] = useState('')
  const [invitationBody, setInvitationBody] = useState('')
  const [participants, setParticipants] = useState<EditableParticipant[]>([])
  const [activeTab, setActiveTab] = useState<InspectionDetailsTabKey>('time')

  useEffect(() => {
    if (!open || !inspection) return
    let cancelled = false

    setForm(buildInspectionDetailsForm(inspection))
    setParticipants([])
    setParticipantsLoaded(false)
    setDocuments([])
    setDocumentsLoaded(false)
    setInvitationSubject('')
    setInvitationBody('')
    setActiveTab('time')
    const loadParticipants = async () => {
      try {
        setParticipantsLoading(true)
        const response = await fetch(
          `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/invitation`
        )
        const payload = (await response.json().catch(() => ({}))) as InvitationResponse

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte hämta närvarande.')
        }

        if (cancelled) return

        setInvitationSubject(payload.subject ?? '')
        setInvitationBody(payload.body ?? '')
        setParticipants((payload.participants ?? []).map(toLocalParticipant))
        setParticipantsLoaded(true)
      } catch (loadError) {
        if (!cancelled) {
          showError(loadError, 'Kunde inte hämta närvarande.')
        }
      } finally {
        if (!cancelled) {
          setParticipantsLoading(false)
        }
      }
    }

    const loadDocuments = async () => {
      try {
        setDocumentsLoading(true)
        const response = await fetch(
          `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/documents`
        )
        const payload = (await response.json().catch(() => ({}))) as InspectionDocumentsResponse

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte hämta granskade handlingar.')
        }

        if (cancelled) return
        setDocuments(payload.documents ?? [])
        setDocumentsLoaded(true)
      } catch (loadError) {
        if (!cancelled) {
          showError(loadError, 'Kunde inte hämta granskade handlingar.')
        }
      } finally {
        if (!cancelled) {
          setDocumentsLoading(false)
        }
      }
    }

    void loadParticipants()
    void loadDocuments()

    return () => {
      cancelled = true
    }
  }, [inspection, open, project.id, showError])

  if (!open || !inspection || !form) return null

  const preliminaryInspection = isEbPreliminaryInspection(inspection.variant)
  const supportsFinalDecision = isEbFinalDecisionInspection(inspection.variant)

  const updateField = <K extends keyof InspectionDetailsFormState>(
    field: K,
    value: InspectionDetailsFormState[K]
  ) => {
    setForm((current) => (current ? { ...current, [field]: value } : current))
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    try {
      setSubmitting(true)
      const response = await fetch(
        `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            requiresContinuedFinalInspection: booleanFromSelect(form.requiresContinuedFinalInspection),
            warrantyPeriodYears: form.warrantyPeriodYears ? Number(form.warrantyPeriodYears) : null,
            afterInspectionRequested: booleanFromSelect(form.afterInspectionRequested),
          }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as UpdateInspectionResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte spara besiktningsuppgifter.')
      }

      if (participantsLoaded) {
        const participantsResponse = await fetch(
          `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/invitation`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              subject: invitationSubject,
              body: invitationBody,
              participants: participantPayload(participants),
            }),
          }
        )
        const participantsPayload = (await participantsResponse.json().catch(() => ({}))) as InvitationResponse

        if (!participantsResponse.ok) {
          throw new Error(participantsPayload.error ?? 'Kunde inte spara närvarande och sändlista.')
        }
      }

      if (documentsLoaded) {
        const documentsResponse = await fetch(
          `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/documents`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents }),
          }
        )
        const documentsPayload = (await documentsResponse.json().catch(() => ({}))) as InspectionDocumentsResponse

        if (!documentsResponse.ok) {
          throw new Error(documentsPayload.error ?? 'Kunde inte spara granskade handlingar.')
        }
      }

      onUpdated(payload.project)
      onClose()
    } catch (submitError) {
      showError(submitError, 'Kunde inte spara besiktningsuppgifter.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              {inspection.variant}
            </p>
            <h2 className="text-lg font-semibold text-gray-950">Besiktningsuppgifter</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="overflow-auto p-4">
          <div className="border-b border-emerald-100">
            <div role="tablist" aria-label="Besiktningsuppgifter" className="flex gap-2 overflow-x-auto pb-3">
              {INSPECTION_DETAILS_TABS.map((tab) => {
                const Icon = tab.icon
                const selected = activeTab === tab.key
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`inspection-details-${tab.key}`}
                    id={`inspection-details-tab-${tab.key}`}
                    onClick={() => setActiveTab(tab.key)}
                    className={`inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${
                      selected
                        ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm'
                        : 'border-emerald-100 bg-white text-gray-700 hover:bg-emerald-50 hover:text-emerald-900'
                    }`}
                  >
                    <Icon size={16} />
                    {tab.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-4">
            {activeTab === 'time' ? (
              <section
                id="inspection-details-time"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-time"
                className="space-y-3"
              >
                <h3 className="text-sm font-semibold text-gray-950">Tid och kallelse</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {fieldLabel(
                    'Besiktningsdatum',
                    <input
                      type="date"
                      value={form.inspectionDate}
                      onChange={(event) => updateField('inspectionDate', event.target.value)}
                      className={inputClassName()}
                    />
                  )}
                  {fieldLabel(
                    'Besiktningstid',
                    <input
                      type="time"
                      value={form.inspectionTime}
                      onChange={(event) => updateField('inspectionTime', event.target.value)}
                      className={inputClassName()}
                    />
                  )}
                  {fieldLabel(
                    'Samlingsplats',
                    <input
                      value={form.meetingPlace}
                      onChange={(event) => updateField('meetingPlace', event.target.value)}
                      className={inputClassName()}
                    />
                  )}
                  {fieldLabel(
                    'Kallelsemetod',
                    <InvitationMethodField
                      value={form.invitationMethod}
                      onChange={(value) => updateField('invitationMethod', value)}
                      className={inputClassName()}
                    />
                  )}
                  {fieldLabel(
                    'Kallelsedatum',
                    <input
                      type="date"
                      value={form.invitationDate}
                      onChange={(event) => updateField('invitationDate', event.target.value)}
                      className={inputClassName()}
                    />
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    {fieldLabel(
                      'Försammanträde',
                      <input
                        type="time"
                        value={form.startMeetingTime}
                        onChange={(event) => updateField('startMeetingTime', event.target.value)}
                        className={inputClassName()}
                      />
                    )}
                    {fieldLabel(
                      'Slutsammanträde',
                      <input
                        type="time"
                        value={form.finalMeetingTime}
                        onChange={(event) => updateField('finalMeetingTime', event.target.value)}
                        className={inputClassName()}
                      />
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === 'previous' ? (
              <div
                id="inspection-details-previous"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-previous"
              >
                <PreviousInspectionsEditor
                  rows={form.previousInspections}
                  onChange={(rows) => updateField('previousInspections', rows)}
                />
              </div>
            ) : null}

            {activeTab === 'documents' ? (
              <div
                id="inspection-details-documents"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-documents"
              >
                <InspectionDocumentsEditor
                  documents={documents}
                  loading={documentsLoading}
                  onChange={setDocuments}
                />
              </div>
            ) : null}

            {activeTab === 'defect_explanations' ? (
              <section
                id="inspection-details-defect_explanations"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-defect_explanations"
                className="space-y-4"
              >
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Fel och förhållanden</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Dessa uppgifter visas under Förklaringar för respektive kolumn i utlåtandet.
                  </p>
                </div>

                {fieldLabel(
                  'Övriga förklaringar',
                  <textarea
                    value={form.defectNumberingExplanation}
                    onChange={(event) => updateField('defectNumberingExplanation', event.target.value)}
                    rows={4}
                    className={inputClassName()}
                  />
                )}

                {fieldLabel(
                  'Lokal, byggdel eller installationsdel utan fel redovisas',
                  <select
                    value={form.defectNoErrorPartsPolicy}
                    onChange={(event) => updateField('defectNoErrorPartsPolicy', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="not_listed">inte</option>
                    <option value="listed_with_dash">med ---</option>
                  </select>
                )}

                <div className="rounded-md border border-emerald-100 bg-emerald-50/50 px-3 py-2 text-sm text-gray-700">
                  Lokal, byggdel eller installationsdel utan fel redovisas{' '}
                  <span className="font-semibold">
                    {form.defectNoErrorPartsPolicy === 'listed_with_dash' ? 'med ---' : 'inte'}
                  </span>{' '}
                  och gäller eventuell förekomst av allmänna fel.
                </div>
              </section>
            ) : null}

            {activeTab === 'report' ? (
              <section
                id="inspection-details-report"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-report"
                className="space-y-3"
              >
                <h3 className="text-sm font-semibold text-gray-950">Utlåtande</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {fieldLabel(
                    'Besiktningsman utsedd av',
                    <select
                      value={form.inspectorAppointedBy}
                      onChange={(event) => updateField('inspectorAppointedBy', event.target.value)}
                      className={inputClassName()}
                    >
                      <option value="">Ej satt</option>
                      <option value="client">Beställare</option>
                      <option value="parties_jointly">Parterna gemensamt</option>
                      <option value="contractor">Entreprenör</option>
                    </select>
                  )}
                  {supportsFinalDecision ? (
                    <>
                      {fieldLabel(
                        'Beslut',
                        <select
                          value={form.approvalStatus}
                          onChange={(event) => updateField('approvalStatus', event.target.value)}
                          className={inputClassName()}
                        >
                          <option value="">Ej satt</option>
                          <option value="approved">Godkänd</option>
                          <option value="not_approved">Ej godkänd</option>
                          <option value="partly_approved">Delvis godkänd</option>
                        </select>
                      )}
                      <div className="sm:col-span-2">
                        {fieldLabel(
                          'Beslutets motivering',
                          <textarea
                            value={form.approvalNote}
                            onChange={(event) => updateField('approvalNote', event.target.value)}
                            rows={3}
                            className={inputClassName()}
                          />
                        )}
                      </div>
                      {fieldLabel(
                        'Fortsatt slutbesiktning',
                        <select
                          value={form.requiresContinuedFinalInspection}
                          onChange={(event) =>
                            updateField('requiresContinuedFinalInspection', event.target.value)
                          }
                          className={inputClassName()}
                        >
                          <option value="">Ej satt</option>
                          <option value="true">Ja</option>
                          <option value="false">Nej</option>
                        </select>
                      )}
                      {form.requiresContinuedFinalInspection === 'true' ? (
                        <>
                          {fieldLabel(
                            'Ny slutbesiktning datum',
                            <input
                              type="date"
                              value={form.continuedFinalInspectionDate}
                              onChange={(event) =>
                                updateField('continuedFinalInspectionDate', event.target.value)
                              }
                              className={inputClassName()}
                            />
                          )}
                          {fieldLabel(
                            'Ny slutbesiktning tid',
                            <input
                              type="time"
                              value={form.continuedFinalInspectionTime}
                              onChange={(event) =>
                                updateField('continuedFinalInspectionTime', event.target.value)
                              }
                              className={inputClassName()}
                            />
                          )}
                        </>
                      ) : null}
                      {fieldLabel(
                        'Garantitid',
                        <select
                          value={form.warrantyPeriodYears}
                          onChange={(event) =>
                            updateField('warrantyPeriodYears', event.target.value)
                          }
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
                          value={form.warrantyEndDate}
                          onChange={(event) => updateField('warrantyEndDate', event.target.value)}
                          className={inputClassName()}
                        />
                      )}
                      {fieldLabel(
                        'Särskild varugaranti för',
                        <input
                          value={form.warrantyScope}
                          onChange={(event) => updateField('warrantyScope', event.target.value)}
                          placeholder="Exempel: vara, produkt eller material"
                          className={inputClassName()}
                        />
                      )}
                    </>
                  ) : null}
                  {fieldLabel(
                    'Fel avhjälpta senast',
                    <input
                      type="date"
                      value={form.defaultRemedyDeadline}
                      onChange={(event) => updateField('defaultRemedyDeadline', event.target.value)}
                      className={inputClassName()}
                    />
                  )}
                  {!preliminaryInspection ? (
                    <>
                      {fieldLabel(
                        'Efterbesiktning påkallad',
                        <select
                          value={form.afterInspectionRequested}
                          onChange={(event) =>
                            updateField('afterInspectionRequested', event.target.value)
                          }
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
                          value={form.afterInspectionRequestedBy}
                          onChange={(event) =>
                            updateField('afterInspectionRequestedBy', event.target.value)
                          }
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
                          value={form.afterInspectionDueDate}
                          onChange={(event) =>
                            updateField('afterInspectionDueDate', event.target.value)
                          }
                          className={inputClassName()}
                        />
                      )}
                    </>
                  ) : null}
                  {fieldLabel(
                    'Distributionsdatum',
                    <input
                      type="date"
                      value={form.reportDistributionDate}
                      onChange={(event) => updateField('reportDistributionDate', event.target.value)}
                      className={inputClassName()}
                    />
                  )}
                  <div className="sm:col-span-2">
                    {fieldLabel(
                      'Besiktningskostnadens fördelning',
                      <textarea
                        value={form.inspectionCostDistribution}
                        onChange={(event) => updateField('inspectionCostDistribution', event.target.value)}
                        rows={3}
                        placeholder="Exempel: Kostnaden för besiktningen betalas av beställaren."
                        className={inputClassName()}
                      />
                    )}
                  </div>
                  {!preliminaryInspection ? (
                    <label className="inline-flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm font-medium text-emerald-900">
                      <input
                        type="checkbox"
                        checked={form.afterInspectionNoticeInReport}
                        onChange={(event) => updateField('afterInspectionNoticeInReport', event.target.checked)}
                        className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                      />
                      Utlåtandet gäller som kallelse till efterbesiktning
                    </label>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeTab === 'participants' ? (
              <div
                id="inspection-details-participants"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-participants"
              >
                {participantsLoading ? (
                  <div className="flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/50 px-3 py-3 text-sm text-gray-600">
                    <Loader2 size={16} className="animate-spin text-emerald-700" />
                    Hämtar närvarande och sändlista...
                  </div>
                ) : (
                  <ParticipantEditor
                    project={project}
                    participants={participants}
                    onAdd={addParticipant}
                    onRemove={removeParticipant}
                    onChange={updateParticipant}
                    title="Närvarande och sändlista"
                  />
                )}
              </div>
            ) : null}

            {activeTab === 'billing' ? (
              <section
                id="inspection-details-billing"
                role="tabpanel"
                aria-labelledby="inspection-details-tab-billing"
                className="space-y-5"
              >
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Fakturering för besiktningen</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    Uppgifterna gäller endast {inspectionTitle(inspection)} och används som förval i
                    besiktningens uppdragsbekräftelse.
                  </p>
                </div>

                <div className="space-y-3 rounded-lg border border-emerald-100 bg-emerald-50/40 p-4">
                  <label className="flex items-start gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.invoiceRecipientMatchesClient}
                      onChange={(event) =>
                        updateField('invoiceRecipientMatchesClient', event.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    Fakturamottagaren är samma som {partyVocabulary.clientShortLabel.toLowerCase()}
                  </label>
                  {form.invoiceRecipientMatchesClient ? (
                    <p className="text-sm text-gray-700">
                      <strong>{project.clientName || 'Beställare ej satt'}</strong>
                      {project.clientOrgNo ? ` · ${project.clientOrgNo}` : ''}
                    </p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      {fieldLabel(
                        'Fakturamottagare',
                        <input
                          value={form.invoiceName}
                          onChange={(event) => updateField('invoiceName', event.target.value)}
                          className={inputClassName()}
                        />
                      )}
                      {fieldLabel(
                        'Org.nr/personnummer',
                        <input
                          value={form.invoiceOrgNo}
                          onChange={(event) => updateField('invoiceOrgNo', event.target.value)}
                          className={inputClassName()}
                        />
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-gray-200 p-4">
                  <label className="flex items-start gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.invoiceEmailMatchesClient}
                      onChange={(event) => updateField('invoiceEmailMatchesClient', event.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    Faktura-e-post är samma som beställarens e-post
                  </label>
                  {form.invoiceEmailMatchesClient ? (
                    <p className="text-sm text-gray-700">{project.clientEmail || 'E-post ej satt'}</p>
                  ) : (
                    fieldLabel(
                      'Faktura-e-post',
                      <input
                        type="email"
                        value={form.invoiceEmail}
                        onChange={(event) => updateField('invoiceEmail', event.target.value)}
                        className={inputClassName()}
                      />
                    )
                  )}
                </div>

                <div className="space-y-3 rounded-lg border border-gray-200 p-4">
                  <label className="flex items-start gap-2 text-sm font-medium text-gray-800">
                    <input
                      type="checkbox"
                      checked={form.invoiceAddressMatchesClient}
                      onChange={(event) =>
                        updateField('invoiceAddressMatchesClient', event.target.checked)
                      }
                      className="mt-0.5 h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    Fakturaadressen är samma som beställarens adress
                  </label>
                  {form.invoiceAddressMatchesClient ? (
                    <p className="text-sm text-gray-700">{clientAddressLine || 'Adress ej satt'}</p>
                  ) : (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        {fieldLabel(
                          'Fakturaadress',
                          <input
                            value={form.invoiceAddress}
                            onChange={(event) => updateField('invoiceAddress', event.target.value)}
                            className={inputClassName()}
                          />
                        )}
                      </div>
                      {fieldLabel(
                        'Postnummer',
                        <input
                          value={form.invoicePostalCode}
                          onChange={(event) => updateField('invoicePostalCode', event.target.value)}
                          className={inputClassName()}
                        />
                      )}
                      {fieldLabel(
                        'Ort',
                        <input
                          value={form.invoiceCity}
                          onChange={(event) => updateField('invoiceCity', event.target.value)}
                          className={inputClassName()}
                        />
                      )}
                    </div>
                  )}
                </div>

                {fieldLabel(
                  'Referens/märkning',
                  <input
                    value={form.invoiceReference}
                    onChange={(event) => updateField('invoiceReference', event.target.value)}
                    className={inputClassName()}
                  />
                )}
              </section>
            ) : null}
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2 border-t border-emerald-100 pt-4 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={submitting || participantsLoading || documentsLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
              {submitting ? 'Sparar...' : 'Spara'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function agreementAttachmentLinksFromAttachments(
  attachments: EbProjectAttachment[]
): EbProjectAgreementAttachmentLinkInput[] {
  return attachments.flatMap((attachment) =>
    attachment.agreementLinks.map((link) => ({
      agreementKey: link.agreementKey,
      attachmentId: attachment.id,
      includeInReport: link.includeInReport,
      sortOrder: link.sortOrder,
    }))
  )
}

function EditProjectDialog({
  open,
  project,
  attachments,
  onClose,
  onUpdated,
  onAttachmentsChange,
}: {
  open: boolean
  project: EbProjectListItem
  attachments: EbProjectAttachment[]
  onClose: () => void
  onUpdated: (project: EbProjectListItem) => void
  onAttachmentsChange: (attachments: EbProjectAttachment[]) => void
}) {
  const { showError } = useEbToast()
  const [form, setForm] = useState<EbProjectFormState>(() => buildEbProjectForm(project))
  const [submitting, setSubmitting] = useState(false)
  const [agreementAttachmentLinks, setAgreementAttachmentLinks] = useState<
    EbProjectAgreementAttachmentLinkInput[]
  >(() => agreementAttachmentLinksFromAttachments(attachments))
  const [agreementAttachmentsLoading, setAgreementAttachmentsLoading] = useState(false)
  const [agreementAttachmentsAvailable, setAgreementAttachmentsAvailable] = useState<boolean | null>(null)
  const [savingAgreementAttachmentTitleOperations, setSavingAgreementAttachmentTitleOperations] = useState<string[]>([])
  const [unsavedAgreementAttachmentTitleDrafts, setUnsavedAgreementAttachmentTitleDrafts] = useState<string[]>([])
  const dirtyRef = useRef(false)
  const agreementAttachmentLinksTouchedRef = useRef(false)
  const openProjectIdRef = useRef<string | null>(null)
  const openProjectUpdatedAtRef = useRef<string | null>(project.updatedAt)
  const attachmentsRef = useRef(attachments)

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    if (!open) {
      dirtyRef.current = false
      agreementAttachmentLinksTouchedRef.current = false
      openProjectIdRef.current = null
      openProjectUpdatedAtRef.current = null
      setAgreementAttachmentsAvailable(null)
      setSavingAgreementAttachmentTitleOperations([])
      setUnsavedAgreementAttachmentTitleDrafts([])
      return
    }

    const openedForAnotherProject = openProjectIdRef.current !== project.id

    // Refreshes can replace the project prop while this dialog is open (for
    // example when the window regains focus or a PDF status is polled). Keep
    // locally edited data in that case; otherwise a complete PATCH can write
    // those lost values back as empty fields.
    if (openedForAnotherProject || !dirtyRef.current) {
      setForm(buildEbProjectForm(project))
      setAgreementAttachmentLinks(agreementAttachmentLinksFromAttachments(attachments))
      dirtyRef.current = false
      agreementAttachmentLinksTouchedRef.current = false
      openProjectIdRef.current = project.id
      openProjectUpdatedAtRef.current = project.updatedAt
      if (openedForAnotherProject) setAgreementAttachmentsAvailable(null)
    }
  }, [attachments, open, project])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    const loadAgreementAttachments = async () => {
      try {
        setAgreementAttachmentsLoading(true)
        const response = await fetch(`/api/eb/projects/${project.id}/agreement-attachments`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => ({}))) as AgreementAttachmentsResponse
        if (!response.ok || !payload.links) {
          throw new Error(payload.error ?? 'Kunde inte hämta avtalsfiler.')
        }
        if (cancelled) return

        // A fresh document list is required when the dialog opens from a
        // page that was rendered before a PDF was uploaded elsewhere.
        if (payload.documents) {
          onAttachmentsChange([
            ...attachmentsRef.current.filter((attachment) => attachment.attachmentType === 'image'),
            ...payload.documents,
          ])
        }
        setAgreementAttachmentsAvailable(payload.available === true)

        if (!agreementAttachmentLinksTouchedRef.current) {
          setAgreementAttachmentLinks(
            payload.links.map((link) => ({
              agreementKey: link.agreementKey,
              attachmentId: link.attachmentId,
              includeInReport: link.includeInReport,
              sortOrder: link.sortOrder,
            }))
          )
        }
      } catch (error) {
        if (!cancelled) {
          showError(error, 'Kunde inte hämta avtalsfiler.')
        }
      } finally {
        if (!cancelled) setAgreementAttachmentsLoading(false)
      }
    }

    void loadAgreementAttachments()
    return () => {
      cancelled = true
    }
  }, [onAttachmentsChange, open, project.id, showError])

  if (!open) return null

  const updateField = <K extends keyof EbProjectFormState>(field: K, value: EbProjectFormState[K]) => {
    dirtyRef.current = true
    setForm((current) => ({ ...current, [field]: value }))
  }

  const updateAgreementAttachmentIds = (agreementKey: string, attachmentIds: string[]) => {
    dirtyRef.current = true
    agreementAttachmentLinksTouchedRef.current = true
    setAgreementAttachmentLinks((current) => {
      const currentLinks = current.filter((link) => link.agreementKey === agreementKey)
      const currentByAttachmentId = new Map(currentLinks.map((link) => [link.attachmentId, link]))
      const otherLinks = current.filter((link) => link.agreementKey !== agreementKey)
      const nextLinks = [...new Set(attachmentIds.filter(Boolean))].map((attachmentId, index) => {
        const existing = currentByAttachmentId.get(attachmentId)
        return {
          agreementKey,
          attachmentId,
          includeInReport: existing?.includeInReport ?? true,
          sortOrder: existing?.sortOrder ?? (index + 1) * 100,
        }
      })
      return [...otherLinks, ...nextLinks]
    })
  }

  const handleAgreementAttachmentsChange = (nextAttachments: EbProjectAttachment[]) => {
    onAttachmentsChange(nextAttachments)
  }

  const handleAttachmentProjectUpdated = (updatedProject: EbProjectListItem) => {
    if (!updatedProject.updatedAt) return false
    const currentUpdatedAt = openProjectUpdatedAtRef.current
    const currentTimestamp = currentUpdatedAt ? Date.parse(currentUpdatedAt) : Number.NaN
    const incomingTimestamp = Date.parse(updatedProject.updatedAt)
    // Date.parse compares only milliseconds. The API emits timestamps in one
    // UTC format, so a lexical tiebreaker retains PostgreSQL microseconds.
    const incomingIsCurrent =
      !currentUpdatedAt ||
      Number.isNaN(currentTimestamp) ||
      Number.isNaN(incomingTimestamp) ||
      incomingTimestamp > currentTimestamp ||
      (incomingTimestamp === currentTimestamp && updatedProject.updatedAt >= currentUpdatedAt)
    if (!incomingIsCurrent) return false

    openProjectUpdatedAtRef.current = updatedProject.updatedAt
    onUpdated(updatedProject)
    return true
  }

  const handleAgreementAttachmentTitleSaving = (operationKey: string, saving: boolean) => {
    setSavingAgreementAttachmentTitleOperations((current) => {
      if (saving) return current.includes(operationKey) ? current : [...current, operationKey]
      const next = current.filter((currentOperationKey) => currentOperationKey !== operationKey)
      return next.length === current.length ? current : next
    })
  }

  const handleAgreementAttachmentTitleDraftChange = (draftKey: string, dirty: boolean) => {
    setUnsavedAgreementAttachmentTitleDrafts((current) => {
      if (dirty) return current.includes(draftKey) ? current : [...current, draftKey]
      const next = current.filter((currentDraftKey) => currentDraftKey !== draftKey)
      return next.length === current.length ? current : next
    })
  }

  const seedAgreementItemTitleFromAttachment = (
    agreementItemId: string | undefined,
    attachment: EbProjectAttachment
  ) => {
    if (!agreementItemId) return
    const title = attachment.title || attachment.fileName || 'Handling'
    setForm((current) => ({
      ...current,
      agreementItems: current.agreementItems.map((item) =>
        item.id === agreementItemId && !item.title.trim()
          ? { ...item, title }
          : item
      ),
    }))
  }

  const handleClose = () => {
    if (
      unsavedAgreementAttachmentTitleDrafts.length > 0 &&
      !window.confirm('Du har osparade PDF-namn. Vill du stänga utan att spara dem?')
    ) {
      return
    }
    dirtyRef.current = false
    agreementAttachmentLinksTouchedRef.current = false
    openProjectIdRef.current = null
    openProjectUpdatedAtRef.current = null
    setSavingAgreementAttachmentTitleOperations([])
    setUnsavedAgreementAttachmentTitleDrafts([])
    setForm(buildEbProjectForm(project))
    setAgreementAttachmentLinks(agreementAttachmentLinksFromAttachments(attachments))
    onClose()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || savingAgreementAttachmentTitleOperations.length > 0) return
    if (unsavedAgreementAttachmentTitleDrafts.length > 0) {
      showError(new Error('Spara PDF-namnet innan du sparar resten av entreprenaden.'), 'PDF-namnet är inte sparat.')
      return
    }

    const agreementLinksWereTouched = agreementAttachmentLinksTouchedRef.current

    try {
      setSubmitting(true)

      const response = await fetch(`/api/eb/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ebProjectFormToPayload(form),
          expectedUpdatedAt: openProjectUpdatedAtRef.current,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as UpdateProjectResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera entreprenaden.')
      }

      let savedProject = payload.project

      if (agreementLinksWereTouched) {
        const validAgreementKeys = new Set([
          STANDARD_AGREEMENT_ATTACHMENT_KEY,
          ...payload.project.agreementItems.map((item) => item.id),
        ])
        const linksToSave = agreementAttachmentLinks.filter((link) =>
          validAgreementKeys.has(link.agreementKey)
        )
        const agreementResponse = await fetch(`/api/eb/projects/${project.id}/agreement-attachments`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            links: linksToSave,
            expectedUpdatedAt: payload.project.updatedAt,
          }),
        })
        const agreementPayload = (await agreementResponse.json().catch(() => ({}))) as AgreementAttachmentsResponse
        if (!agreementResponse.ok || !agreementPayload.links) {
          // The project data is already saved. Keep the dialog open with its
          // current draft so a transient link error can be retried safely.
          dirtyRef.current = true
          agreementAttachmentLinksTouchedRef.current = true
          openProjectUpdatedAtRef.current = payload.project.updatedAt
          setForm(buildEbProjectForm(payload.project))
          onUpdated(payload.project)
          throw new Error(
            agreementPayload.error ??
              'Entreprenadens uppgifter sparades, men avtalsfilerna kunde inte kopplas. Försök spara igen.'
          )
        }

        if (agreementPayload.documents) {
          onAttachmentsChange([
            ...attachmentsRef.current.filter((attachment) => attachment.attachmentType === 'image'),
            ...agreementPayload.documents,
          ])
        }

        savedProject = agreementPayload.project ?? savedProject
      }

      dirtyRef.current = false
      agreementAttachmentLinksTouchedRef.current = false
      openProjectUpdatedAtRef.current = savedProject.updatedAt
      setForm(buildEbProjectForm(savedProject))
      onUpdated(savedProject)
      onClose()
    } catch (submitError) {
      showError(submitError, 'Kunde inte uppdatera entreprenaden.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">EB</p>
            <h2 className="text-lg font-semibold text-gray-950">Redigera entreprenad</h2>
          </div>
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting || savingAgreementAttachmentTitleOperations.length > 0}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="overflow-auto p-4">
          <EbProjectForm
            form={form}
            onChange={updateField}
            showNotePrefix
            renderAgreementDocumentField={({ agreementKey, label, description, agreementItem }) => {
              const attachmentIds = agreementAttachmentLinks
                .filter((link) => link.agreementKey === agreementKey)
                .sort((left, right) => (left.sortOrder ?? 100) - (right.sortOrder ?? 100))
                .map((link) => link.attachmentId)

              if (agreementAttachmentsAvailable !== true) {
                return (
                  <p className="mt-4 rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    {agreementAttachmentsAvailable === false
                      ? 'Avtalsfiler aktiveras när den senaste EB-databasuppdateringen är körd.'
                      : 'Läser möjligheten att koppla avtalsfiler…'}
                  </p>
                )
              }

              return (
                <EbAgreementDocumentField
                  key={agreementKey}
                  projectId={project.id}
                  attachments={attachments}
                  attachmentIds={attachmentIds}
                  label={label}
                  description={description}
                  titleStateScope={agreementKey}
                  titleEditingDisabled={savingAgreementAttachmentTitleOperations.length > 0}
                  onAttachmentIdsChange={(nextAttachmentIds) =>
                    updateAgreementAttachmentIds(agreementKey, nextAttachmentIds)
                  }
                  onAttachmentSelected={(attachment) =>
                    seedAgreementItemTitleFromAttachment(agreementItem?.id, attachment)
                  }
                  onAttachmentsChange={handleAgreementAttachmentsChange}
                  onProjectUpdated={handleAttachmentProjectUpdated}
                  onTitleSavingChange={handleAgreementAttachmentTitleSaving}
                  onTitleDraftChange={handleAgreementAttachmentTitleDraftChange}
                />
              )
            }}
          />

          {agreementAttachmentsLoading ? (
            <p className="mt-3 flex items-center gap-2 text-xs text-gray-600">
              <Loader2 size={14} className="animate-spin" />
              Läser avtalsfiler…
            </p>
          ) : null}

          {unsavedAgreementAttachmentTitleDrafts.length > 0 ? (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Spara det ändrade PDF-namnet innan du sparar resten av entreprenaden.
            </p>
          ) : null}

          <div className="mt-5 flex justify-end gap-2 border-t border-emerald-100 pt-4">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting || savingAgreementAttachmentTitleOperations.length > 0}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={submitting || savingAgreementAttachmentTitleOperations.length > 0 || unsavedAgreementAttachmentTitleDrafts.length > 0}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting || savingAgreementAttachmentTitleOperations.length > 0 ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
              {submitting
                ? 'Sparar...'
                : savingAgreementAttachmentTitleOperations.length > 0
                  ? 'Sparar PDF-namn...'
                  : unsavedAgreementAttachmentTitleDrafts.length > 0
                    ? 'Spara PDF-namn först'
                    : 'Spara ändringar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function InvitationDialog({
  open,
  project,
  inspection,
  assignmentConfirmation,
  onClose,
  onEditSchedule,
  onSent,
}: {
  open: boolean
  project: EbProjectListItem
  inspection: EbInspectionSummary | null
  assignmentConfirmation: EbAssignmentConfirmationSummary | null
  onClose: () => void
  onEditSchedule: () => void
  onSent: (project: EbProjectListItem) => void
}) {
  const { showError } = useEbToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)
  const [pastScheduleWarningOpen, setPastScheduleWarningOpen] = useState(false)
  const invitationOperationRef = useRef(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [participants, setParticipants] = useState<EditableParticipant[]>([])

  useEffect(() => {
    if (!open || !inspection) return

    let cancelled = false
    setPastScheduleWarningOpen(false)

    const loadInvitation = async () => {
      try {
        setLoading(true)
        const response = await fetch(
          `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/invitation`
        )
        const payload = (await response.json().catch(() => ({}))) as InvitationResponse

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte hämta kallelse.')
        }

        if (cancelled) return

        setSubject(payload.subject ?? '')
        setBody(payload.body ?? '')
        setParticipants((payload.participants ?? []).map(toLocalParticipant))
      } catch (loadError) {
        if (!cancelled) {
          showError(loadError, 'Kunde inte hämta kallelse.')
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadInvitation()

    return () => {
      cancelled = true
    }
  }, [inspection, open, project.id, showError])

  if (!open || !inspection) return null

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

  const handleSave = async () => {
    if (invitationOperationRef.current) return false

    try {
      invitationOperationRef.current = true
      setSaving(true)
      setStatusMessage(null)
      const response = await fetch(
        `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/invitation`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            body,
            participants: participantPayload(participants),
          }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as InvitationResponse

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte spara kallelse och deltagare.')
      }

      setSubject(payload.subject ?? subject)
      setBody(payload.body ?? body)
      setParticipants((payload.participants ?? []).map(toLocalParticipant))
      setStatusMessage('Kallelsen och deltagarna är sparade.')
      return true
    } catch (saveError) {
      showError(saveError, 'Kunde inte spara kallelse och deltagare.')
      return false
    } finally {
      invitationOperationRef.current = false
      setSaving(false)
    }
  }

  const handleEditSchedule = async () => {
    const saved = await handleSave()
    if (saved) onEditSchedule()
  }

  const handleSend = async (allowPastSchedule = false) => {
    if (invitationOperationRef.current) return

    if (
      !allowPastSchedule &&
      inspectionScheduleHasPassed(inspection.date, inspection.inspectionTime)
    ) {
      setPastScheduleWarningOpen(true)
      return
    }

    setPastScheduleWarningOpen(false)

    const hasAcceptedAssignment = Boolean(assignmentConfirmation?.acceptedAt)
    if (
      !hasAcceptedAssignment &&
      !window.confirm(
        'Det finns ingen godkänd uppdragsbekräftelse för den här besiktningen. Vill du ändå skicka kallelsen?'
      )
    ) {
      return
    }

    try {
      invitationOperationRef.current = true
      setSending(true)
      setStatusMessage(null)

      const response = await fetch(
        `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/invitation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            body,
            participants: participantPayload(participants),
            allowWithoutAcceptedAssignment: !hasAcceptedAssignment,
          }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as SendInvitationResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte skicka kallelse.')
      }

      onSent(payload.project)
      onClose()
    } catch (sendError) {
      showError(sendError, 'Kunde inte skicka kallelse.')
    } finally {
      invitationOperationRef.current = false
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">
              {inspection.variant}
            </p>
            <h2 className="text-lg font-semibold text-gray-950">Kallelse</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading || saving || sending}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="max-h-[calc(92vh-70px)] overflow-auto p-4">
          {loading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-gray-600">
              <Loader2 size={17} className="animate-spin text-emerald-700" />
              Laddar...
            </div>
          ) : (
            <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
              <section className="space-y-4">
                {fieldLabel(
                  'Ämne',
                  <input
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Text',
                  <textarea
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    rows={17}
                    className={`${inputClassName()} min-h-[360px] resize-y leading-6`}
                  />
                )}
              </section>

              <ParticipantEditor
                project={project}
                participants={participants}
                onAdd={addParticipant}
                onRemove={removeParticipant}
                onChange={updateParticipant}
                title="Mottagare och närvarande"
              />
            </div>
          )}

          {statusMessage ? (
            <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800" role="status">
              {statusMessage}
            </p>
          ) : null}

          {pastScheduleWarningOpen ? (
            <section
              className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4"
              role="alert"
              aria-live="assertive"
            >
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 shrink-0 text-amber-700" size={21} />
                <div>
                  <h3 className="font-semibold text-amber-950">Besiktningstiden har passerat</h3>
                  <p className="mt-1 text-sm leading-6 text-amber-900">
                    Du är på väg att skicka en kallelse till en besiktning som är angiven till{' '}
                    <strong>
                      {formatDate(inspection.date)}
                      {inspection.inspectionTime ? ` kl. ${formatTime(inspection.inspectionTime)}` : ''}
                    </strong>
                    . Kontrollera datum och tid innan du fortsätter.
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={() => void handleEditSchedule()}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-amber-400 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100"
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CalendarDays size={16} />}
                  {saving ? 'Sparar kallelsen...' : 'Ändra datum och tid'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSend(true)}
                  disabled={saving}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-amber-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-800"
                >
                  <Send size={16} />
                  Skicka ändå
                </button>
              </div>
            </section>
          ) : (
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onClose}
                disabled={loading || saving || sending}
                className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={loading || saving || sending}
                className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
                {saving ? 'Sparar...' : 'Spara'}
              </button>
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={loading || saving || sending}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
              >
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
                {sending ? 'Skickar...' : 'Skicka kallelse'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function EbProjectDetailClient({
  project,
  attachments,
  assignmentConfirmations,
}: EbProjectDetailClientProps) {
  const router = useRouter()
  const { showError } = useEbToast()
  const [currentProject, setCurrentProject] = useState(project)
  const [currentAttachments, setCurrentAttachments] = useState(attachments)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [detailsInspection, setDetailsInspection] = useState<EbInspectionSummary | null>(null)
  const [invitationInspection, setInvitationInspection] = useState<EbInspectionSummary | null>(null)
  const [assignmentInspection, setAssignmentInspection] = useState<EbInspectionSummary | null>(null)
  const [assignmentConfirmationByInspection, setAssignmentConfirmationByInspection] = useState<
    Record<string, EbAssignmentConfirmationSummary>
  >(() =>
    Object.fromEntries(
      assignmentConfirmations.map((confirmation) => [confirmation.inspectionId, confirmation])
    )
  )
  const [reportActionInspectionId, setReportActionInspectionId] = useState<string | null>(null)
  const [deletingInspectionId, setDeletingInspectionId] = useState<string | null>(null)
  const [pendingNavigationKey, setPendingNavigationKey] = useState<string | null>(null)
  const processingPdfInspectionId =
    currentProject.inspections.find((inspection) => inspection.reportPdfStatus === 'processing')
      ?.inspectionId ?? null

  useEffect(() => {
    setCurrentProject(project)
  }, [project])

  useEffect(() => {
    setCurrentAttachments(attachments)
  }, [attachments])

  useEffect(() => {
    setAssignmentConfirmationByInspection(
      Object.fromEntries(
        assignmentConfirmations.map((confirmation) => [confirmation.inspectionId, confirmation])
      )
    )
  }, [assignmentConfirmations])

  useEffect(() => {
    const refreshStatus = () => router.refresh()
    window.addEventListener('focus', refreshStatus)
    return () => window.removeEventListener('focus', refreshStatus)
  }, [router])

  useEffect(() => {
    if (!processingPdfInspectionId) return

    let cancelled = false
    let timer: number | null = null
    const pollPdfStatus = async () => {
      try {
        const response = await fetch(
          `/api/eb/projects/${currentProject.id}/inspections/${processingPdfInspectionId}/report-delivery`,
          { cache: 'no-store' }
        )
        const payload = (await response.json().catch(() => ({}))) as ReportDeliveryResponse
        if (!response.ok || !payload.project) {
          throw new Error(payload.error ?? 'Kunde inte uppdatera PDF-status.')
        }
        if (cancelled) return
        setCurrentProject(payload.project)
        if (payload.pdfStatus === 'processing') {
          timer = window.setTimeout(() => void pollPdfStatus(), 2000)
        }
      } catch (error) {
        if (!cancelled) showError(error, 'Kunde inte uppdatera PDF-status.')
      }
    }

    timer = window.setTimeout(() => void pollPdfStatus(), 1200)
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [currentProject.id, processingPdfInspectionId, showError])

  const addressLine = [currentProject.address, currentProject.postalCode, currentProject.city]
    .filter(Boolean)
    .join(', ')
  const agreementLine = [currentProject.standardAgreement, currentProject.contractForm]
    .filter(Boolean)
    .join(' - ')
  const propertyLine = [currentProject.propertyDesignation, currentProject.municipality]
    .filter(Boolean)
    .join(' - ')
  const objectIdentifier = propertyLine || currentProject.brfApartmentNumber
  const partyVocabulary = resolveEbAgreementVocabulary(currentProject.standardAgreement)
  const clientAddressLine = [currentProject.clientAddress, [currentProject.clientPostalCode, currentProject.clientCity].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const contractorAddressLine = [currentProject.contractorAddress, [currentProject.contractorPostalCode, currentProject.contractorCity].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const backNavigationKey = 'eb'
  const isBackNavigating = pendingNavigationKey === backNavigationKey
  const navigationInProgress = Boolean(pendingNavigationKey)

  const handleCreated = (updatedProject: EbProjectListItem) => {
    setCurrentProject(updatedProject)
    router.refresh()
  }

  const handleUpdated = (updatedProject: EbProjectListItem) => {
    setCurrentProject(updatedProject)
    router.refresh()
  }

  const handleAssignmentConfirmationUpdated = useCallback((summary: EbAssignmentConfirmationSummary) => {
    setAssignmentConfirmationByInspection((current) => ({
      ...current,
      [summary.inspectionId]: summary,
    }))
  }, [])

  const handleInspectionNavigation = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    if (pendingNavigationKey) {
      event.preventDefault()
      return
    }
    setPendingNavigationKey(key)
  }

  const handleLockInspection = async (inspection: EbInspectionSummary) => {
    if (reportActionInspectionId || deletingInspectionId) return

    try {
      setReportActionInspectionId(inspection.inspectionId)

      const response = await fetch(
        `/api/eb/projects/${currentProject.id}/inspections/${inspection.inspectionId}/report-delivery`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'lock_only' }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as ReportDeliveryResponse
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte låsa utlåtandet.')
      }

      setCurrentProject(payload.project)
      router.refresh()
    } catch (error) {
      showError(error, 'Kunde inte låsa utlåtandet.')
    } finally {
      setReportActionInspectionId(null)
    }
  }

  const handleUnlockInspection = async (inspection: EbInspectionSummary) => {
    if (reportActionInspectionId || deletingInspectionId) return
    const reason = window.prompt('Ange anledning till upplåsning, minst 10 tecken:')
    if (!reason) return

    try {
      setReportActionInspectionId(inspection.inspectionId)

      const response = await fetch(
        `/api/eb/projects/${currentProject.id}/inspections/${inspection.inspectionId}/unlock`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as UnlockInspectionResponse
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte låsa upp utlåtandet.')
      }

      setCurrentProject(payload.project)
      router.refresh()
    } catch (error) {
      showError(error, 'Kunde inte låsa upp utlåtandet.')
    } finally {
      setReportActionInspectionId(null)
    }
  }

  const handleDeleteInspection = async (inspection: EbInspectionSummary) => {
    if (reportActionInspectionId || deletingInspectionId) return
    if (inspection.reportLockedAt) {
      showError('Låsta besiktningar kan inte raderas. Lås upp besiktningen först.')
      return
    }

    const confirmed = window.confirm(
      `Radera ${inspectionTitle(inspection)}? Det går inte att ångra.`
    )
    if (!confirmed) return

    try {
      setDeletingInspectionId(inspection.inspectionId)

      const response = await fetch(
        `/api/eb/projects/${currentProject.id}/inspections/${inspection.inspectionId}`,
        { method: 'DELETE' }
      )
      const payload = (await response.json().catch(() => ({}))) as DeleteInspectionResponse
      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte radera besiktningen.')
      }

      setCurrentProject(payload.project)
      setDetailsInspection((current) =>
        current?.inspectionId === inspection.inspectionId ? null : current
      )
      setInvitationInspection((current) =>
        current?.inspectionId === inspection.inspectionId ? null : current
      )
      router.refresh()
    } catch (error) {
      showError(error, 'Kunde inte radera besiktningen.')
    } finally {
      setDeletingInspectionId(null)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 72% at 50% 0%, rgba(220,252,231,0.08) 0%, rgba(220,252,231,0) 62%), linear-gradient(135deg, #ffffff 0%, #fbfefc 52%, #fafdfb 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/62 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-6xl px-4 py-5 md:px-6">
          <header className="rounded-lg border border-emerald-100 bg-white/90 p-4 shadow-sm md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <Link
                  href="/eb"
                  onClick={(event) => handleInspectionNavigation(event, backNavigationKey)}
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  aria-disabled={navigationInProgress}
                  aria-busy={isBackNavigating}
                  className={inspectionNavigationIconClassName(navigationInProgress)}
                >
                  {isBackNavigating ? <Loader2 size={17} className="animate-spin" /> : <ArrowLeft size={17} strokeWidth={2} />}
                </Link>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">EB-projekt</p>
                  <h1 className="truncate text-2xl font-semibold text-gray-950">{currentProject.title}</h1>
                  <p className="mt-1 truncate text-sm text-gray-600">
                    {addressLine || objectIdentifier || 'Adress ej satt'}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setEditDialogOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <Pencil size={16} />
                  Redigera entreprenad
                </button>
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                >
                  <Plus size={16} />
                  Ny besiktning
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-4 border-t border-emerald-100 pt-4 sm:grid-cols-2 xl:grid-cols-4">
              <dl>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  {partyVocabulary.clientShortLabel}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-gray-950">{currentProject.clientName ?? 'Ej satt'}</dd>
                {currentProject.clientOrgNo ? <dd className="text-xs text-gray-600">{currentProject.clientOrgNo}</dd> : null}
                {clientAddressLine ? <dd className="text-xs text-gray-600">{clientAddressLine}</dd> : null}
                {currentProject.clientEmail ? <dd className="text-xs text-gray-600">{currentProject.clientEmail}</dd> : null}
                {currentProject.clientPhone ? <dd className="text-xs text-gray-600">{currentProject.clientPhone}</dd> : null}
                {!currentProject.clientIsPropertyOwner ? (
                  <dd className="mt-1 text-xs text-gray-600">Fastighetsägare: {currentProject.propertyOwnerName ?? 'Ej satt'}</dd>
                ) : null}
              </dl>
              <dl>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                  {partyVocabulary.contractorShortLabel}
                </dt>
                <dd className="mt-1 text-sm font-semibold text-gray-950">{currentProject.contractorName ?? 'Ej satt'}</dd>
                {currentProject.contractorOrgNo ? <dd className="text-xs text-gray-600">{currentProject.contractorOrgNo}</dd> : null}
                {contractorAddressLine ? <dd className="text-xs text-gray-600">{contractorAddressLine}</dd> : null}
                {currentProject.contractorEmail ? <dd className="text-xs text-gray-600">{currentProject.contractorEmail}</dd> : null}
                {currentProject.contractorPhone ? <dd className="text-xs text-gray-600">{currentProject.contractorPhone}</dd> : null}
              </dl>
              <dl>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Kontrakt</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-950">{currentProject.contractName ?? currentProject.title}</dd>
                <dd className="text-xs text-gray-600">{agreementLine || 'Avtal ej satt'}</dd>
                <dd className="text-xs text-gray-600">
                  {currentProject.procurementForm ? `Upphandling: ${currentProject.procurementForm}` : 'Upphandling ej satt'}
                </dd>
              </dl>
              <dl>
                <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Objekt</dt>
                <dd className="mt-1 text-sm font-semibold text-gray-950">{objectIdentifier || addressLine || 'Ej satt'}</dd>
                {propertyLine && currentProject.brfApartmentNumber ? (
                  <dd className="text-xs text-gray-600">{currentProject.brfApartmentNumber}</dd>
                ) : null}
                <dd className="text-xs text-gray-600">{addressLine || 'Adress ej satt'}</dd>
              </dl>
            </div>

            {currentProject.objectDescription ? (
              <div className="mt-4 border-t border-emerald-100 pt-4">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Beskrivning av entreprenaden</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{currentProject.objectDescription}</p>
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-emerald-100 bg-emerald-50/45 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Besiktningar</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{currentProject.inspections.length} st</p>
              </div>
              <div className="rounded-md border border-emerald-100 bg-white px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Noteringsserie</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{currentProject.notePrefix}</p>
              </div>
            </div>
          </header>

          <div className="mt-4">
            <section className="min-w-0 rounded-lg border border-emerald-100 bg-white/90 shadow-sm">
              <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-950">Besiktningar</h2>
                  <p className="text-xs text-gray-500">Välj arbetsläge för respektive besiktning.</p>
                </div>
                <span className="text-xs font-medium text-gray-500">{currentProject.inspections.length} st</span>
              </div>

              {currentProject.inspections.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-600">Ingen besiktning skapad.</div>
              ) : (
                <div className="divide-y divide-emerald-100">
                  {currentProject.inspections.map((inspection) => {
                    const parentInspection = inspection.parentInspectionId
                      ? currentProject.inspections.find((item) => item.inspectionId === inspection.parentInspectionId)
                      : null
                    const isLocked = Boolean(inspection.reportLockedAt)
                    const isWorking = reportActionInspectionId === inspection.inspectionId
                    const isDeleting = deletingInspectionId === inspection.inspectionId
                    const actionInProgress = Boolean(reportActionInspectionId || deletingInspectionId)
                    const roundNavigationKey = `${inspection.inspectionId}:round`
                    const reviewNavigationKey = `${inspection.inspectionId}:perform`
                    const reportNavigationKey = `${inspection.inspectionId}:report`
                    const remediationNavigationKey = `${inspection.inspectionId}:remediation`
                    const isRoundNavigating = pendingNavigationKey === roundNavigationKey
                    const isReviewNavigating = pendingNavigationKey === reviewNavigationKey
                    const isReportNavigating = pendingNavigationKey === reportNavigationKey
                    const isRemediationNavigating = pendingNavigationKey === remediationNavigationKey
                    const navigationInProgress = Boolean(pendingNavigationKey)
                    const assignmentConfirmation =
                      assignmentConfirmationByInspection[inspection.inspectionId] ?? null
                    const assignmentStatus = getAssignmentPreparationStatus(assignmentConfirmation)
                    const invitationStatus = getInvitationPreparationStatus(inspection)
                    const reportStatus = getReportStatus(inspection)
                    const inspectionInvoiceAddressLine = [
                      inspection.invoiceAddress,
                      [inspection.invoicePostalCode, inspection.invoiceCity].filter(Boolean).join(' '),
                    ]
                      .filter(Boolean)
                      .join(', ')

                    return (
                      <article key={inspection.inspectionId} className="p-4">
                        <div className="grid gap-5 xl:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.55fr)] xl:items-start">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                              <ClipboardCheck size={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-base font-semibold text-gray-950">
                                  {inspectionTitle(inspection)}
                                </h3>
                                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600">
                                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
                                  Besiktning: {getStatusLabel(inspection.status)}
                                </span>
                              </div>
                              <div className="mt-3 flex items-start gap-2 text-sm text-gray-700">
                                <CalendarDays size={16} className="mt-0.5 shrink-0 text-emerald-700" />
                                <div>
                                  <p className="text-xs font-medium text-gray-500">Datum och tid</p>
                                  <p className="font-semibold text-gray-900">
                                    {formatDate(inspection.date)}
                                    {inspection.inspectionTime ? ` kl. ${formatTime(inspection.inspectionTime)}` : ''}
                                  </p>
                                </div>
                              </div>
                              <p className="mt-2 text-xs text-gray-600">
                                {parentInspection
                                  ? `Följer på: ${parentInspection.variantLabel}`
                                  : 'Grundbesiktning'}
                              </p>
                              <div className="mt-3 rounded-md border border-gray-100 bg-gray-50/70 px-2.5 py-2 text-xs leading-5 text-gray-600">
                                <span className="font-semibold text-gray-800">Fakturering:</span>{' '}
                                {inspection.invoiceName || 'Mottagare ej satt'}
                                {inspection.invoiceReference ? ` · Ref. ${inspection.invoiceReference}` : ''}
                                {inspection.invoiceEmail ? ` · ${inspection.invoiceEmail}` : ''}
                                {inspectionInvoiceAddressLine ? ` · ${inspectionInvoiceAddressLine}` : ''}
                              </div>
                            </div>
                          </div>

                          <div className="min-w-0 space-y-4">
                            <section aria-labelledby={`preparation-${inspection.inspectionId}`}>
                              <div className="mb-2">
                                <p
                                  id={`preparation-${inspection.inspectionId}`}
                                  className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-600"
                                >
                                  Före besiktningen
                                </p>
                                <p className="mt-0.5 text-xs text-gray-500">
                                  Status för uppdragsbekräftelse och kallelse.
                                </p>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                <InspectionPreparationCard
                                  title="Uppdragsbekräftelse"
                                  icon={
                                    assignmentStatus.tone === 'success'
                                      ? CheckCircle2
                                      : assignmentStatus.tone === 'info'
                                        ? Clock3
                                        : assignmentStatus.tone === 'neutral'
                                          ? CircleDashed
                                          : FileCheck2
                                  }
                                  status={assignmentStatus}
                                  disabled={navigationInProgress}
                                  onClick={() => setAssignmentInspection(inspection)}
                                />
                                <InspectionPreparationCard
                                  title="Kallelse"
                                  icon={inspection.invitationSentAt ? CheckCircle2 : Send}
                                  status={invitationStatus}
                                  disabled={navigationInProgress}
                                  onClick={() => setInvitationInspection(inspection)}
                                />
                              </div>
                            </section>

                            <section
                              aria-labelledby={`workflow-${inspection.inspectionId}`}
                              className="border-t border-gray-100 pt-4"
                            >
                              <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
                                <div>
                                  <p
                                    id={`workflow-${inspection.inspectionId}`}
                                    className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-600"
                                  >
                                    Arbeta med besiktningen
                                  </p>
                                  <p className="mt-0.5 text-xs text-gray-500">
                                    Runda, granska och färdigställ utlåtandet.
                                  </p>
                                </div>
                                <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${reportStatus.className}`}>
                                  {inspection.reportPdfStatus === 'pending' || inspection.reportPdfStatus === 'processing' ? (
                                    <Loader2 size={12} className="animate-spin" aria-hidden="true" />
                                  ) : null}
                                  {reportStatus.label}
                                </span>
                              </div>
                              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                              <PendingLink
                                href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/round`}
                                onClick={(event) => handleInspectionNavigation(event, roundNavigationKey)}
                                disabled={navigationInProgress}
                                pending={isRoundNavigating}
                                pendingLabel="Öppnar runda …"
                                icon={<Smartphone size={16} aria-hidden="true" />}
                                className={inspectionNavigationClassName(true, navigationInProgress)}
                              >
                                Runda
                              </PendingLink>
                              <PendingLink
                                href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/perform`}
                                onClick={(event) => handleInspectionNavigation(event, reviewNavigationKey)}
                                disabled={navigationInProgress}
                                pending={isReviewNavigating}
                                pendingLabel="Öppnar granska …"
                                icon={<ClipboardCheck size={16} aria-hidden="true" />}
                                className={inspectionNavigationClassName(false, navigationInProgress)}
                              >
                                Granska
                              </PendingLink>
                              <PendingLink
                                href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/report`}
                                onClick={(event) => handleInspectionNavigation(event, reportNavigationKey)}
                                disabled={navigationInProgress}
                                pending={isReportNavigating}
                                pendingLabel="Öppnar utlåtande …"
                                icon={<FileText size={16} aria-hidden="true" />}
                                className={inspectionNavigationClassName(false, navigationInProgress)}
                              >
                                Utlåtande
                              </PendingLink>
                                <details className="group relative sm:ml-auto">
                                <summary className="inline-flex cursor-pointer list-none items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 [&::-webkit-details-marker]:hidden">
                                  <MoreHorizontal size={17} />
                                  Hantera
                                </summary>
                                <div className="absolute right-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-xl">
                                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                    Besiktning
                                  </p>
                                  <button
                                    type="button"
                                    onClick={() => setDetailsInspection(inspection)}
                                    disabled={navigationInProgress}
                                    className={inspectionMenuItemClassName({ disabled: navigationInProgress })}
                                  >
                                    <Pencil size={16} />
                                    Besiktningsuppgifter och fakturering
                                  </button>
                                  <PendingLink
                                    href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/remediation`}
                                    onClick={(event) => handleInspectionNavigation(event, remediationNavigationKey)}
                                    disabled={navigationInProgress}
                                    pending={isRemediationNavigating}
                                    pendingLabel="Öppnar Åtgärdsportal …"
                                    icon={<ListChecks size={16} aria-hidden="true" />}
                                    className={inspectionMenuItemClassName({ disabled: navigationInProgress })}
                                  >
                                    Åtgärdsportal
                                  </PendingLink>

                                  <div className="my-1 border-t border-gray-100" />
                                  <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-gray-500">
                                    Utlåtande
                                  </p>
                                  {inspection.reportPdfDownloadUrl ? (
                                    <Link
                                      href={inspection.reportPdfDownloadUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className={inspectionMenuItemClassName()}
                                    >
                                      <Download size={16} />
                                      Öppna sparad PDF
                                    </Link>
                                  ) : (
                                    <span className={inspectionMenuItemClassName({ disabled: true })}>
                                      <Download size={16} />
                                      Ingen sparad PDF
                                    </span>
                                  )}
                                  {isLocked ? (
                                    <button
                                      type="button"
                                      onClick={() => void handleUnlockInspection(inspection)}
                                      disabled={actionInProgress}
                                      className={inspectionMenuItemClassName({ disabled: actionInProgress })}
                                    >
                                      {isWorking ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />}
                                      {isWorking ? 'Låser upp...' : 'Lås upp utlåtandet'}
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => void handleLockInspection(inspection)}
                                      disabled={actionInProgress}
                                      className={inspectionMenuItemClassName({ disabled: actionInProgress })}
                                    >
                                      {isWorking ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
                                      {isWorking ? 'Låser och skapar PDF...' : 'Lås och spara PDF'}
                                    </button>
                                  )}

                                  <div className="my-1 border-t border-gray-100" />
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteInspection(inspection)}
                                    disabled={isLocked || actionInProgress}
                                    title={isLocked ? 'Låsta besiktningar kan inte raderas' : 'Radera besiktning'}
                                    className={inspectionMenuItemClassName({
                                      danger: true,
                                      disabled: isLocked || actionInProgress,
                                    })}
                                  >
                                    {isDeleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                                    {isDeleting ? 'Raderar...' : 'Radera besiktning'}
                                  </button>
                                </div>
                              </details>
                              </div>
                              {inspection.reportPdfStatus === 'failed' ? (
                                <p className="mt-2 text-xs font-medium text-rose-700">
                                  Den sparade PDF-filen kunde inte skapas. Försök igen via Hantera.
                                </p>
                              ) : null}
                            </section>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="mt-4 rounded-lg border border-emerald-100 bg-white/90 p-4 shadow-sm">
            <EbProjectAttachmentsPanel
              projectId={currentProject.id}
              initialAttachments={currentAttachments}
              onAttachmentsChange={setCurrentAttachments}
              onProjectUpdated={handleUpdated}
            />
          </section>
        </div>

        <CreateInspectionDialog
          open={dialogOpen}
          project={currentProject}
          onClose={() => setDialogOpen(false)}
          onCreated={handleCreated}
        />
        <EditProjectDialog
          open={editDialogOpen}
          project={currentProject}
          attachments={currentAttachments}
          onClose={() => setEditDialogOpen(false)}
          onUpdated={handleUpdated}
          onAttachmentsChange={setCurrentAttachments}
        />
        <InspectionDetailsDialog
          open={Boolean(detailsInspection)}
          project={currentProject}
          inspection={detailsInspection}
          onClose={() => setDetailsInspection(null)}
          onUpdated={handleUpdated}
        />
        <InvitationDialog
          open={Boolean(invitationInspection)}
          project={currentProject}
          inspection={invitationInspection}
          assignmentConfirmation={
            invitationInspection
              ? assignmentConfirmationByInspection[invitationInspection.inspectionId] ?? null
              : null
          }
          onClose={() => setInvitationInspection(null)}
          onEditSchedule={() => {
            const inspectionToEdit = invitationInspection
            setInvitationInspection(null)
            setDetailsInspection(inspectionToEdit)
          }}
          onSent={handleCreated}
        />
        <EbAssignmentConfirmationDialog
          open={Boolean(assignmentInspection)}
          project={currentProject}
          inspection={assignmentInspection}
          onClose={() => setAssignmentInspection(null)}
          onUpdated={handleAssignmentConfirmationUpdated}
        />
      </main>
    </Protected>
  )
}



