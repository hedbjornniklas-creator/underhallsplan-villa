'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  FileText,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import EbProjectAttachmentsPanel from '@/components/eb/EbProjectAttachmentsPanel'
import EbProjectForm, {
  buildEbProjectForm,
  ebProjectFormToPayload,
  type EbProjectFormState,
} from '@/components/eb/EbProjectForm'
import type {
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

type EbProjectDetailClientProps = {
  project: EbProjectListItem
  attachments: EbProjectAttachment[]
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

type UpdateProjectResponse = {
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
  warrantyPeriodYears: string
  warrantyEndDate: string
  defaultRemedyDeadline: string
  afterInspectionRequested: string
  afterInspectionDueDate: string
  afterInspectionNoticeInReport: boolean
  reportDistributionDate: string
  previousInspections: EbPreviousInspectionItem[]
}

const VARIANT_OPTIONS: Array<{ value: EbInspectionVariant; label: string }> = [
  { value: 'EB', label: 'Efterbesiktning' },
  { value: 'FB', label: 'Förbesiktning' },
  { value: 'GB', label: 'Garantibesiktning' },
  { value: 'KSB', label: 'Kompletterande slutbesiktning' },
  { value: 'SAB', label: 'Särskild besiktning' },
]

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

function getStatusLabel(status: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (normalized === 'draft') return 'Utkast'
  if (normalized === 'completed') return 'Klar'
  if (normalized === 'archived') return 'Arkiverad'
  return status ?? 'Pågående'
}

function inputClassName() {
  return 'w-full rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-950 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100'
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

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-gray-950">Tidigare besiktningar</h3>
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div key={row.key} className="grid gap-2 rounded-md border border-emerald-100 bg-white p-2 sm:grid-cols-[1fr_9rem_10rem]">
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
    warrantyPeriodYears: inspection.warrantyPeriodYears ? String(inspection.warrantyPeriodYears) : '',
    warrantyEndDate: inspection.warrantyEndDate ?? '',
    defaultRemedyDeadline: inspection.defaultRemedyDeadline ?? '',
    afterInspectionRequested:
      typeof inspection.afterInspectionRequested === 'boolean'
        ? String(inspection.afterInspectionRequested)
        : '',
    afterInspectionDueDate: inspection.afterInspectionDueDate ?? '',
    afterInspectionNoticeInReport: inspection.afterInspectionNoticeInReport,
    reportDistributionDate: inspection.reportDistributionDate ?? new Date().toISOString().slice(0, 10),
    previousInspections: inspection.previousInspections,
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
  const latestInspection = project.inspections.at(-1)
  const [form, setForm] = useState<InspectionFormState>({
    variant: 'EB',
    parentInspectionId: latestInspection?.inspectionId ?? '',
    inspectionDate: '',
    inspectionTime: '',
    meetingPlace: '',
    startMeetingTime: '',
    finalMeetingTime: '',
  })
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(null)

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
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa besiktning.')
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
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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

          {error ? (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

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
  const [error, setError] = useState<string | null>(null)

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
    setError(null)

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
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta närvarande.')
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
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta granskade handlingar.')
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
  }, [inspection, open, project.id])

  if (!open || !inspection || !form) return null

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
      setError(null)
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
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte spara besiktningsuppgifter.')
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
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="overflow-auto p-4">
          <div className="grid gap-5 lg:grid-cols-2">
            <section className="space-y-3">
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

            <PreviousInspectionsEditor
              rows={form.previousInspections}
              onChange={(rows) => updateField('previousInspections', rows)}
            />

            <InspectionDocumentsEditor
              documents={documents}
              loading={documentsLoading}
              onChange={setDocuments}
            />

            <section className="space-y-3">
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
                    onChange={(event) => updateField('requiresContinuedFinalInspection', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="true">Ja</option>
                    <option value="false">Nej</option>
                  </select>
                )}
                {fieldLabel(
                  'Garantitid',
                  <select
                    value={form.warrantyPeriodYears}
                    onChange={(event) => updateField('warrantyPeriodYears', event.target.value)}
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
                  'Fel avhjälpta senast',
                  <input
                    type="date"
                    value={form.defaultRemedyDeadline}
                    onChange={(event) => updateField('defaultRemedyDeadline', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Efterbesiktning påkallad',
                  <select
                    value={form.afterInspectionRequested}
                    onChange={(event) => updateField('afterInspectionRequested', event.target.value)}
                    className={inputClassName()}
                  >
                    <option value="">Ej satt</option>
                    <option value="true">Ja</option>
                    <option value="false">Nej</option>
                  </select>
                )}
                {fieldLabel(
                  'Efterbesiktning senast',
                  <input
                    type="date"
                    value={form.afterInspectionDueDate}
                    onChange={(event) => updateField('afterInspectionDueDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                {fieldLabel(
                  'Distributionsdatum',
                  <input
                    type="date"
                    value={form.reportDistributionDate}
                    onChange={(event) => updateField('reportDistributionDate', event.target.value)}
                    className={inputClassName()}
                  />
                )}
                <label className="inline-flex items-center gap-2 rounded-md border border-emerald-100 bg-emerald-50/60 px-3 py-2 text-sm font-medium text-emerald-900">
                  <input
                    type="checkbox"
                    checked={form.afterInspectionNoticeInReport}
                    onChange={(event) => updateField('afterInspectionNoticeInReport', event.target.checked)}
                    className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                  />
                  Utlåtandet gäller som kallelse till efterbesiktning
                </label>
              </div>
            </section>
          </div>

          <div className="mt-5 border-t border-emerald-100 pt-4">
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

          {error ? (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

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
              disabled={submitting || participantsLoading}
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

function EditProjectDialog({
  open,
  project,
  onClose,
  onUpdated,
}: {
  open: boolean
  project: EbProjectListItem
  onClose: () => void
  onUpdated: (project: EbProjectListItem) => void
}) {
  const [form, setForm] = useState<EbProjectFormState>(() => buildEbProjectForm(project))
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setForm(buildEbProjectForm(project))
    setError(null)
  }, [open, project])

  if (!open) return null

  const updateField = <K extends keyof EbProjectFormState>(field: K, value: EbProjectFormState[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    try {
      setSubmitting(true)
      setError(null)

      const response = await fetch(`/api/eb/projects/${project.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ebProjectFormToPayload(form)),
      })
      const payload = (await response.json().catch(() => ({}))) as UpdateProjectResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera entreprenaden.')
      }

      onUpdated(payload.project)
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte uppdatera entreprenaden.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">EB</p>
            <h2 className="text-lg font-semibold text-gray-950">Redigera entreprenad</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={(event) => void handleSubmit(event)} className="overflow-auto p-4">
          <EbProjectForm form={form} onChange={updateField} showNotePrefix />

          {error ? <p className="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p> : null}

          <div className="mt-5 flex justify-end gap-2 border-t border-emerald-100 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
            >
              Avbryt
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
              {submitting ? 'Sparar...' : 'Spara ändringar'}
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
  onClose,
  onSent,
}: {
  open: boolean
  project: EbProjectListItem
  inspection: EbInspectionSummary | null
  onClose: () => void
  onSent: (project: EbProjectListItem) => void
}) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [participants, setParticipants] = useState<EditableParticipant[]>([])

  useEffect(() => {
    if (!open || !inspection) return

    let cancelled = false

    const loadInvitation = async () => {
      try {
        setLoading(true)
        setError(null)
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
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta kallelse.')
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
  }, [inspection, open, project.id])

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
    if (sending) return

    try {
      setSending(true)
      setError(null)
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
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara kallelse och deltagare.')
    } finally {
      setSending(false)
    }
  }

  const handleSend = async () => {
    if (sending) return

    try {
      setSending(true)
      setError(null)

      const response = await fetch(
        `/api/eb/projects/${project.id}/inspections/${inspection.inspectionId}/invitation`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            body,
            participants: participantPayload(participants),
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
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skicka kallelse.')
    } finally {
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
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
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

          {error ? (
            <p className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="inline-flex items-center justify-center rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Avbryt
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={loading || sending}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Pencil size={16} />}
              Spara
            </button>
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={loading || sending}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-emerald-300"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              {sending ? 'Skickar...' : 'Skicka kallelse'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function EbProjectDetailClient({ project, attachments }: EbProjectDetailClientProps) {
  const router = useRouter()
  const [currentProject, setCurrentProject] = useState(project)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [detailsInspection, setDetailsInspection] = useState<EbInspectionSummary | null>(null)
  const [invitationInspection, setInvitationInspection] = useState<EbInspectionSummary | null>(null)
  const addressLine = [currentProject.address, currentProject.postalCode, currentProject.city]
    .filter(Boolean)
    .join(', ')
  const agreementLine = [currentProject.standardAgreement, currentProject.contractForm]
    .filter(Boolean)
    .join(' - ')
  const propertyLine = [currentProject.propertyDesignation, currentProject.municipality]
    .filter(Boolean)
    .join(' - ')
  const partyVocabulary = resolveEbAgreementVocabulary(currentProject.standardAgreement)
  const clientAddressLine = [currentProject.clientAddress, [currentProject.clientPostalCode, currentProject.clientCity].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const contractorAddressLine = [currentProject.contractorAddress, [currentProject.contractorPostalCode, currentProject.contractorCity].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')

  const handleCreated = (updatedProject: EbProjectListItem) => {
    setCurrentProject(updatedProject)
    router.refresh()
  }

  const handleUpdated = (updatedProject: EbProjectListItem) => {
    setCurrentProject(updatedProject)
    router.refresh()
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
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <ArrowLeft size={17} strokeWidth={2} />
                </Link>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">EB-projekt</p>
                  <h1 className="truncate text-2xl font-semibold text-gray-950">{currentProject.title}</h1>
                  <p className="mt-1 truncate text-sm text-gray-600">
                    {addressLine || currentProject.propertyDesignation || 'Adress ej satt'}
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

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border border-emerald-100 bg-emerald-50/45 px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Besiktningar</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{currentProject.inspections.length} st</p>
              </div>
              <div className="rounded-md border border-emerald-100 bg-white px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Noteringsserie</p>
                <p className="mt-1 text-lg font-semibold text-gray-950">{currentProject.notePrefix}</p>
              </div>
              <div className="rounded-md border border-emerald-100 bg-white px-3 py-2">
                <p className="text-xs font-medium text-gray-500">Avtal</p>
                <p className="mt-1 truncate text-sm font-semibold text-gray-950">{agreementLine || 'Ej satt'}</p>
              </div>
            </div>
          </header>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
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

                    return (
                      <article key={inspection.inspectionId} className="p-4">
                        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                              <ClipboardCheck size={18} />
                            </span>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <h3 className="truncate text-base font-semibold text-gray-950">
                                  {inspectionTitle(inspection)}
                                </h3>
                                <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                                  {inspection.variant}
                                </span>
                                <span className="inline-flex rounded-full border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700">
                                  {getStatusLabel(inspection.status)}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
                                <span className="inline-flex items-center gap-1.5">
                                  <CalendarDays size={14} className="text-emerald-700" />
                                  {formatDate(inspection.date)}
                                  {inspection.inspectionTime ? ` ${formatTime(inspection.inspectionTime)}` : ''}
                                </span>
                                <span>Koppling: {parentInspection?.variantLabel ?? 'Grundbesiktning'}</span>
                                <span>
                                  Kallelse: {inspection.invitationSentAt ? formatDate(inspection.invitationSentAt) : 'Ej skickad'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
                            <Link
                              href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/round`}
                              className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <Smartphone size={16} />
                              Runda
                            </Link>
                            <Link
                              href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/perform`}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <ClipboardCheck size={16} />
                              Granska
                            </Link>
                            <Link
                              href={`/eb/projects/${project.id}/inspections/${inspection.inspectionId}/report`}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <FileText size={16} />
                              Utlåtande
                            </Link>
                            <button
                              type="button"
                              onClick={() => setDetailsInspection(inspection)}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <Pencil size={16} />
                              Uppgifter
                            </button>
                            <button
                              type="button"
                              onClick={() => setInvitationInspection(inspection)}
                              className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                            >
                              <Mail size={16} />
                              Kallelse
                            </button>
                          </div>
                        </div>
                      </article>
                    )
                  })}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <section className="rounded-lg border border-emerald-100 bg-white/90 p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-gray-950">Projektfakta</h2>
                  <button
                    type="button"
                    onClick={() => setEditDialogOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-50"
                  >
                    <Pencil size={14} />
                    Redigera entreprenad
                  </button>
                </div>
                <dl className="mt-4 space-y-4">
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      {partyVocabulary.clientShortLabel}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-950">{currentProject.clientName ?? 'Ej satt'}</dd>
                    {currentProject.clientOrgNo ? <dd className="text-xs text-gray-600">{currentProject.clientOrgNo}</dd> : null}
                    {clientAddressLine ? <dd className="text-xs text-gray-600">{clientAddressLine}</dd> : null}
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">
                      {partyVocabulary.contractorShortLabel}
                    </dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-950">{currentProject.contractorName ?? 'Ej satt'}</dd>
                    {currentProject.contractorOrgNo ? <dd className="text-xs text-gray-600">{currentProject.contractorOrgNo}</dd> : null}
                    {contractorAddressLine ? <dd className="text-xs text-gray-600">{contractorAddressLine}</dd> : null}
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Kontrakt</dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-950">{currentProject.contractName ?? currentProject.title}</dd>
                    <dd className="text-xs text-gray-600">
                      {currentProject.procurementForm ? `Upphandling: ${currentProject.procurementForm}` : 'Upphandling ej satt'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs font-semibold uppercase tracking-[0.12em] text-emerald-700">Objekt</dt>
                    <dd className="mt-1 text-sm font-semibold text-gray-950">{propertyLine || addressLine || 'Ej satt'}</dd>
                    <dd className="text-xs text-gray-600">{addressLine || 'Adress ej satt'}</dd>
                  </div>
                </dl>
              </section>

              {currentProject.objectDescription ? (
                <section className="rounded-lg border border-emerald-100 bg-white/90 p-4 shadow-sm">
                  <h2 className="text-base font-semibold text-gray-950">Beskrivning av entreprenaden</h2>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                    {currentProject.objectDescription}
                  </p>
                </section>
              ) : null}
            </aside>
          </div>

          <section className="mt-4 rounded-lg border border-emerald-100 bg-white/90 p-4 shadow-sm">
            <EbProjectAttachmentsPanel projectId={currentProject.id} initialAttachments={attachments} />
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
          onClose={() => setEditDialogOpen(false)}
          onUpdated={handleUpdated}
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
          onClose={() => setInvitationInspection(null)}
          onSent={handleCreated}
        />
      </main>
    </Protected>
  )
}



