'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, CalendarDays, ClipboardCheck, Loader2, Plus, X } from 'lucide-react'
import Protected from '@/components/Protected'
import type { EbInspectionSummary, EbInspectionVariant, EbProjectListItem } from '@/lib/eb/server'

type EbProjectDetailClientProps = {
  project: EbProjectListItem
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

export default function EbProjectDetailClient({ project }: EbProjectDetailClientProps) {
  const router = useRouter()
  const [currentProject, setCurrentProject] = useState(project)
  const [dialogOpen, setDialogOpen] = useState(false)
  const addressLine = [currentProject.address, currentProject.postalCode, currentProject.city]
    .filter(Boolean)
    .join(', ')

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
              'radial-gradient(100% 72% at 50% 0%, rgba(220,252,231,0.18) 0%, rgba(220,252,231,0) 62%), linear-gradient(135deg, #fbfefc 0%, #f8fdf9 52%, #f6fbf7 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/55 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl p-4 md:p-6">
          <header className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm backdrop-blur-sm md:p-5">
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

          <section className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Beställare</p>
              <p className="mt-2 truncate text-sm font-semibold text-gray-950">
                {currentProject.clientName ?? 'Ej satt'}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Entreprenör</p>
              <p className="mt-2 truncate text-sm font-semibold text-gray-950">
                {currentProject.contractorName ?? 'Ej satt'}
              </p>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Besiktningar</p>
              <p className="mt-2 text-sm font-semibold text-gray-950">{currentProject.inspections.length} st</p>
            </div>
          </section>

          <section className="mt-4 overflow-hidden rounded-lg border border-emerald-100 bg-white/78 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-950">Besiktningar</h2>
              <span className="text-xs font-medium text-gray-500">{currentProject.inspections.length} st</span>
            </div>

            {currentProject.inspections.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-gray-600">Ingen besiktning skapad.</div>
            ) : (
              <div className="divide-y divide-emerald-100">
                {currentProject.inspections.map((inspection) => (
                  <div
                    key={inspection.inspectionId}
                    className="grid gap-3 bg-white/82 px-4 py-3 md:grid-cols-[0.7fr_1.2fr_0.8fr_0.7fr]"
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
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <CreateInspectionDialog
          open={dialogOpen}
          project={currentProject}
          onClose={() => setDialogOpen(false)}
          onCreated={handleCreated}
        />
      </main>
    </Protected>
  )
}
