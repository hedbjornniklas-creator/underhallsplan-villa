'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  ClipboardCheck,
  Loader2,
  Plus,
  Settings,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type { EbProjectListItem } from '@/lib/eb/server'

type EbDashboardClientProps = {
  initialProjects: EbProjectListItem[]
  initialError: string | null
}

type ProjectFormState = {
  title: string
  contractName: string
  propertyDesignation: string
  address: string
  postalCode: string
  city: string
  municipality: string
  clientName: string
  contractorName: string
  inspectionDate: string
  inspectionTime: string
  meetingPlace: string
  startMeetingTime: string
  finalMeetingTime: string
}

type CreateProjectResponse = {
  project?: EbProjectListItem
  error?: string
}

const INITIAL_FORM: ProjectFormState = {
  title: '',
  contractName: '',
  propertyDesignation: '',
  address: '',
  postalCode: '',
  city: '',
  municipality: '',
  clientName: '',
  contractorName: '',
  inspectionDate: '',
  inspectionTime: '',
  meetingPlace: '',
  startMeetingTime: '',
  finalMeetingTime: '',
}

function formatDate(value: string | null) {
  if (!value) return 'Ej satt'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function getStatusLabel(status: string | null) {
  const normalized = String(status ?? '').trim().toLowerCase()
  if (normalized === 'draft') return 'Utkast'
  if (normalized === 'active') return 'Aktiv'
  if (normalized === 'completed') return 'Klar'
  if (normalized === 'archived') return 'Arkiverad'
  return status ?? 'Utkast'
}

function getPrimaryInspection(project: EbProjectListItem) {
  return project.inspections.find((inspection) => inspection.variant === 'SB') ?? project.inspections[0] ?? null
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

function CreateProjectDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (project: EbProjectListItem) => void
}) {
  const router = useRouter()
  const [form, setForm] = useState<ProjectFormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const updateField = (field: keyof ProjectFormState, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    try {
      setSubmitting(true)
      setError(null)

      const response = await fetch('/api/eb/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = (await response.json().catch(() => ({}))) as CreateProjectResponse

      if (!response.ok || !payload.project) {
        throw new Error(payload.error ?? 'Kunde inte skapa entreprenad.')
      }

      onCreated(payload.project)
      setForm(INITIAL_FORM)
      onClose()
      router.push(`/eb/projects/${payload.project.id}`)
      router.refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa entreprenad.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-3">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">SB</p>
            <h2 className="text-lg font-semibold text-gray-950">Ny slutbesiktning</h2>
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

        <form onSubmit={(event) => void handleSubmit(event)} className="max-h-[calc(92vh-70px)] overflow-auto p-4">
          <div className="grid gap-4 md:grid-cols-2">
            {fieldLabel(
              'Projektnamn',
              <input
                value={form.title}
                onChange={(event) => updateField('title', event.target.value)}
                className={inputClassName()}
                required
              />
            )}
            {fieldLabel(
              'Entreprenad',
              <input
                value={form.contractName}
                onChange={(event) => updateField('contractName', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Fastighetsbeteckning',
              <input
                value={form.propertyDesignation}
                onChange={(event) => updateField('propertyDesignation', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Adress',
              <input
                value={form.address}
                onChange={(event) => updateField('address', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Postnummer',
              <input
                value={form.postalCode}
                onChange={(event) => updateField('postalCode', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Ort',
              <input
                value={form.city}
                onChange={(event) => updateField('city', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Kommun',
              <input
                value={form.municipality}
                onChange={(event) => updateField('municipality', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Beställare',
              <input
                value={form.clientName}
                onChange={(event) => updateField('clientName', event.target.value)}
                className={inputClassName()}
              />
            )}
            {fieldLabel(
              'Entreprenör',
              <input
                value={form.contractorName}
                onChange={(event) => updateField('contractorName', event.target.value)}
                className={inputClassName()}
              />
            )}
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
              {submitting ? 'Skapar...' : 'Skapa SB'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function ProjectRow({ project }: { project: EbProjectListItem }) {
  const primaryInspection = getPrimaryInspection(project)
  const address = [project.address, project.postalCode, project.city].filter(Boolean).join(', ')

  return (
    <Link
      href={`/eb/projects/${project.id}`}
      className="grid gap-3 border-b border-emerald-100 bg-white/82 px-4 py-3 text-left transition hover:bg-emerald-50/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 md:grid-cols-[1.4fr_1fr_0.7fr_0.7fr]"
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-gray-950">{project.title}</p>
        <p className="mt-0.5 truncate text-xs text-gray-600">
          {address || project.propertyDesignation || 'Adress ej satt'}
        </p>
      </div>
      <div className="min-w-0 text-xs text-gray-600">
        <p className="truncate font-medium text-gray-800">{project.clientName ?? 'Beställare ej satt'}</p>
        <p className="truncate">{project.contractorName ?? 'Entreprenör ej satt'}</p>
      </div>
      <div className="text-xs text-gray-700">
        <p className="font-semibold text-emerald-800">
          {primaryInspection ? primaryInspection.variantLabel : 'Ingen besiktning'}
        </p>
        <p>{formatDate(primaryInspection?.date ?? null)}</p>
      </div>
      <div className="flex items-start justify-between gap-2 md:justify-end">
        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          {getStatusLabel(project.status)}
        </span>
      </div>
    </Link>
  )
}

export default function EbDashboardClient({
  initialProjects,
  initialError,
}: EbDashboardClientProps) {
  const [projects, setProjects] = useState(initialProjects)
  const [dialogOpen, setDialogOpen] = useState(false)
  const counts = useMemo(
    () => ({
      projects: projects.length,
      inspections: projects.reduce((sum, project) => sum + project.inspections.length, 0),
      invitations: projects.reduce(
        (sum, project) =>
          sum + project.inspections.filter((inspection) => Boolean(inspection.invitationSentAt)).length,
        0
      ),
    }),
    [projects]
  )

  const handleCreated = (project: EbProjectListItem) => {
    setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)])
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
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard-v1"
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <ArrowLeft size={17} strokeWidth={2} />
                </Link>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">EB</p>
                  <h1 className="text-2xl font-semibold text-gray-950">Entreprenadbesiktning</h1>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/settings"
                  className="inline-flex items-center justify-center gap-2 rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
                >
                  <Settings size={16} />
                  Inställningar
                </Link>
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                >
                  <Plus size={16} />
                  Ny SB
                </button>
              </div>
            </div>
          </header>

          <section className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <Building2 size={19} />
                </span>
                <div>
                  <p className="text-2xl font-semibold text-gray-950">{counts.projects}</p>
                  <p className="text-xs font-medium text-gray-600">Entreprenader</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <ClipboardCheck size={19} />
                </span>
                <div>
                  <p className="text-2xl font-semibold text-gray-950">{counts.inspections}</p>
                  <p className="text-xs font-medium text-gray-600">Besiktningar</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-emerald-100 bg-white/82 p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 text-emerald-700">
                  <CalendarDays size={19} />
                </span>
                <div>
                  <p className="text-2xl font-semibold text-gray-950">{counts.invitations}</p>
                  <p className="text-xs font-medium text-gray-600">Skickade kallelser</p>
                </div>
              </div>
            </div>
          </section>

          <section className="mt-4 overflow-hidden rounded-lg border border-emerald-100 bg-white/78 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-950">Entreprenader</h2>
              <span className="text-xs font-medium text-gray-500">{projects.length} st</span>
            </div>

            {initialError ? (
              <p className="px-4 py-6 text-sm text-rose-700">{initialError}</p>
            ) : projects.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-semibold text-gray-900">Ingen entreprenad skapad</p>
                <button
                  type="button"
                  onClick={() => setDialogOpen(true)}
                  className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-emerald-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
                >
                  <Plus size={16} />
                  Ny SB
                </button>
              </div>
            ) : (
              <div>
                {projects.map((project) => (
                  <ProjectRow key={project.id} project={project} />
                ))}
              </div>
            )}
          </section>
        </div>

        <CreateProjectDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onCreated={handleCreated}
        />
      </main>
    </Protected>
  )
}
