'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useState, type FormEvent } from 'react'
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
import EbProjectForm, {
  EMPTY_EB_PROJECT_FORM,
  EbProjectFieldLabel,
  ebProjectFormToPayload,
  ebProjectInputClassName,
  type EbProjectFormState,
} from '@/components/eb/EbProjectForm'
import type { EbProjectListItem } from '@/lib/eb/server'

type EbDashboardClientProps = {
  initialProjects: EbProjectListItem[]
  initialError: string | null
}

type CreateProjectFormState = EbProjectFormState & {
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

const INITIAL_FORM: CreateProjectFormState = {
  ...EMPTY_EB_PROJECT_FORM,
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
  return project.inspections.find((inspection) => inspection.variant === 'SLB') ?? project.inspections[0] ?? null
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
  const [form, setForm] = useState<CreateProjectFormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const updateField = <K extends keyof CreateProjectFormState>(field: K, value: CreateProjectFormState[K]) => {
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
        body: JSON.stringify(ebProjectFormToPayload(form)),
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
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-lg border border-emerald-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-emerald-100 px-4 py-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">SLB</p>
            <h2 className="text-lg font-semibold text-gray-950">Ny entreprenad</h2>
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
          <div className="space-y-5">
            <EbProjectForm form={form} onChange={updateField} />

            <section>
              <h3 className="text-sm font-semibold text-gray-950">Första slutbesiktning</h3>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <EbProjectFieldLabel label="Besiktningsdatum">
                  <input
                    type="date"
                    value={form.inspectionDate}
                    onChange={(event) => updateField('inspectionDate', event.target.value)}
                    className={ebProjectInputClassName()}
                  />
                </EbProjectFieldLabel>
                <EbProjectFieldLabel label="Besiktningstid">
                  <input
                    type="time"
                    value={form.inspectionTime}
                    onChange={(event) => updateField('inspectionTime', event.target.value)}
                    className={ebProjectInputClassName()}
                  />
                </EbProjectFieldLabel>
                <EbProjectFieldLabel label="Samlingsplats">
                  <input
                    value={form.meetingPlace}
                    onChange={(event) => updateField('meetingPlace', event.target.value)}
                    className={ebProjectInputClassName()}
                  />
                </EbProjectFieldLabel>
                <div className="grid grid-cols-2 gap-3">
                  <EbProjectFieldLabel label="Försammanträde">
                    <input
                      type="time"
                      value={form.startMeetingTime}
                      onChange={(event) => updateField('startMeetingTime', event.target.value)}
                      className={ebProjectInputClassName()}
                    />
                  </EbProjectFieldLabel>
                  <EbProjectFieldLabel label="Slutsammanträde">
                    <input
                      type="time"
                      value={form.finalMeetingTime}
                      onChange={(event) => updateField('finalMeetingTime', event.target.value)}
                      className={ebProjectInputClassName()}
                    />
                  </EbProjectFieldLabel>
                </div>
              </div>
            </section>
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
              {submitting ? 'Skapar...' : 'Skapa entreprenad'}
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
  const agreement = [project.standardAgreement, project.contractForm].filter(Boolean).join(' · ')

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
        {agreement ? <p className="mt-0.5 truncate text-emerald-800">{agreement}</p> : null}
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
              'radial-gradient(100% 72% at 50% 0%, rgba(220,252,231,0.08) 0%, rgba(220,252,231,0) 62%), linear-gradient(135deg, #ffffff 0%, #fbfefc 52%, #fafdfb 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/62 backdrop-blur-[1px]" />

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
                  Ny entreprenad
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
                  Ny entreprenad
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



