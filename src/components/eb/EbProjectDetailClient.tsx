'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  CalendarDays,
  ClipboardCheck,
  Loader2,
  Mail,
  Plus,
  Send,
  Smartphone,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import EbProjectAttachmentsPanel from '@/components/eb/EbProjectAttachmentsPanel'
import type {
  EbProjectAttachment,
  EbInspectionSummary,
  EbInspectionVariant,
  EbInvitationContext,
  EbInvitationParticipant,
  EbProjectListItem,
} from '@/lib/eb/server'

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

type InvitationResponse = EbInvitationContext & {
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

const VARIANT_OPTIONS: Array<{ value: EbInspectionVariant; label: string }> = [
  { value: 'EB', label: 'Efterbesiktning' },
  { value: 'FB', label: 'Förbesiktning' },
  { value: 'GB', label: 'Garantibesiktning' },
  { value: 'KSB', label: 'Kompletterande slutbesiktning' },
  { value: 'SAB', label: 'Särskild besiktning' },
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
    sortOrder,
  }
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
            participants: participants.map((participant, index) => ({
              id: participant.id,
              roleLabel: participant.roleLabel,
              companyName: participant.companyName,
              personName: participant.personName,
              email: participant.email,
              phone: participant.phone,
              receivesInvitation: participant.receivesInvitation,
              sortOrder: participant.sortOrder || (index + 1) * 100,
            })),
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

              <section>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-gray-950">Mottagare</h3>
                  <button
                    type="button"
                    onClick={addParticipant}
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
                          onChange={(event) => updateParticipant(index, 'roleLabel', event.target.value)}
                          placeholder="Roll"
                          className={inputClassName()}
                        />
                        <input
                          value={participant.email ?? ''}
                          onChange={(event) => updateParticipant(index, 'email', event.target.value)}
                          placeholder="epost@exempel.se"
                          className={inputClassName()}
                        />
                        <input
                          value={participant.companyName ?? ''}
                          onChange={(event) => updateParticipant(index, 'companyName', event.target.value)}
                          placeholder="Företag"
                          className={inputClassName()}
                        />
                        <input
                          value={participant.personName ?? ''}
                          onChange={(event) => updateParticipant(index, 'personName', event.target.value)}
                          placeholder="Namn"
                          className={inputClassName()}
                        />
                        <input
                          value={participant.phone ?? ''}
                          onChange={(event) => updateParticipant(index, 'phone', event.target.value)}
                          placeholder="Telefon"
                          className={inputClassName()}
                        />
                        <div className="flex items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                            <input
                              type="checkbox"
                              checked={participant.receivesInvitation}
                              onChange={(event) =>
                                updateParticipant(index, 'receivesInvitation', event.target.checked)
                              }
                              className="h-4 w-4 rounded border-emerald-300 text-emerald-700 focus:ring-emerald-600"
                            />
                            Skicka
                          </label>
                          <button
                            type="button"
                            onClick={() => removeParticipant(index)}
                            aria-label="Ta bort mottagare"
                            title="Ta bort mottagare"
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

  const handleCreated = (updatedProject: EbProjectListItem) => {
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

        <div className="relative mx-auto w-full max-w-[88rem] px-4 py-5 md:px-6">
          <header className="border-b border-emerald-100 pb-5">
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
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">EB</p>
                  <h1 className="truncate text-2xl font-semibold text-gray-950">{currentProject.title}</h1>
                  <p className="mt-1 truncate text-sm text-gray-600">
                    {addressLine || currentProject.propertyDesignation || 'Adress ej satt'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
              >
                <Plus size={16} />
                Ny besiktning
              </button>
            </div>
          </header>

          <section className="grid gap-x-8 gap-y-5 border-b border-emerald-100 py-5 md:grid-cols-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Beställare</p>
              <p className="mt-2 truncate text-sm font-semibold text-gray-950">
                {currentProject.clientName ?? 'Ej satt'}
              </p>
              {currentProject.clientOrgNo ? (
                <p className="mt-1 truncate text-xs text-gray-600">{currentProject.clientOrgNo}</p>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Entreprenör</p>
              <p className="mt-2 truncate text-sm font-semibold text-gray-950">
                {currentProject.contractorName ?? 'Ej satt'}
              </p>
              {currentProject.contractorOrgNo ? (
                <p className="mt-1 truncate text-xs text-gray-600">{currentProject.contractorOrgNo}</p>
              ) : null}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Avtal</p>
              <p className="mt-2 truncate text-sm font-semibold text-gray-950">{agreementLine || 'Ej satt'}</p>
              <p className="mt-1 truncate text-xs text-gray-600">
                {currentProject.contractDate ? `Kontrakt ${formatDate(currentProject.contractDate)}` : 'Datum ej satt'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Besiktningar</p>
              <p className="mt-2 text-sm font-semibold text-gray-950">{currentProject.inspections.length} st</p>
              <p className="mt-1 truncate text-xs text-gray-600">Noteringar: {currentProject.notePrefix}</p>
            </div>
          </section>

          <section className="border-b border-emerald-100 py-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-gray-950">Grunduppgifter</h2>
            </div>
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-[1.1fr_1fr_1fr]">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Kontrakt</p>
                <p className="mt-2 truncate text-sm font-semibold text-gray-950">
                  {currentProject.contractName ?? currentProject.title}
                </p>
                <p className="mt-1 truncate text-xs text-gray-600">
                  {currentProject.procurementForm ? `Upphandling: ${currentProject.procurementForm}` : 'Upphandling ej satt'}
                </p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">Objekt</p>
                <p className="mt-2 truncate text-sm font-semibold text-gray-950">
                  {propertyLine || addressLine || 'Ej satt'}
                </p>
                <p className="mt-1 truncate text-xs text-gray-600">{addressLine || 'Adress ej satt'}</p>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                  Noteringsserie
                </p>
                <p className="mt-2 truncate text-sm font-semibold text-gray-950">{currentProject.notePrefix}</p>
                <p className="mt-1 truncate text-xs text-gray-600">SLB1</p>
              </div>
              {currentProject.objectDescription ? (
                <div className="md:col-span-3">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
                    Objektbeskrivning
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">
                    {currentProject.objectDescription}
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="border-b border-emerald-100 py-5">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-950">Besiktningar</h2>
              <span className="text-xs font-medium text-gray-500">{currentProject.inspections.length} st</span>
            </div>

            {currentProject.inspections.length === 0 ? (
              <div className="py-10 text-center text-sm text-gray-600">Ingen besiktning skapad.</div>
            ) : (
              <div className="divide-y divide-emerald-100">
                {currentProject.inspections.map((inspection) => (
                  <div
                    key={inspection.inspectionId}
                    className="grid gap-3 py-3 md:grid-cols-[0.75fr_1.05fr_0.75fr_0.55fr_0.7fr]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                        <ClipboardCheck size={17} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-950">
                          {inspectionTitle(inspection)}
                        </p>
                        <p className="text-xs text-gray-600">{getStatusLabel(inspection.status)}</p>
                      </div>
                    </div>
                    <div className="min-w-0 text-xs text-gray-600">
                      <p className="truncate">
                        Koppling:{' '}
                        {inspection.parentInspectionId
                          ? currentProject.inspections.find(
                              (item) => item.inspectionId === inspection.parentInspectionId
                            )?.variantLabel ?? 'Tidigare besiktning'
                          : 'Grundbesiktning'}
                      </p>
                      <p className="truncate">
                        Kallelse: {inspection.invitationSentAt ? formatDate(inspection.invitationSentAt) : 'Ej skickad'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-700">
                      <CalendarDays size={15} className="text-emerald-700" />
                      <span>
                        {formatDate(inspection.date)}
                        {inspection.inspectionTime ? ` ${formatTime(inspection.inspectionTime)}` : ''}
                      </span>
                    </div>
                    <div className="flex items-center justify-start md:justify-end">
                      <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
                        {inspection.variant}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center justify-start gap-2 md:justify-end">
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
                ))}
              </div>
            )}
          </section>

          <EbProjectAttachmentsPanel projectId={currentProject.id} initialAttachments={attachments} />
        </div>

        <CreateInspectionDialog
          open={dialogOpen}
          project={currentProject}
          onClose={() => setDialogOpen(false)}
          onCreated={handleCreated}
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
