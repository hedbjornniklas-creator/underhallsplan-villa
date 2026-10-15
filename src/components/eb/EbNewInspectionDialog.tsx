'use client'

import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Building2, Loader2, Plus, X } from 'lucide-react'
import EbProjectForm, {
  EMPTY_EB_PROJECT_FORM,
  ebProjectFormToPayload,
  type EbProjectFormState,
} from '@/components/eb/EbProjectForm'
import type { EbInspectionVariant, EbProjectListItem } from '@/lib/eb/server'

type EbNewInspectionDialogProps = {
  open: boolean
  projects: EbProjectListItem[]
  initialProjectId?: string
  onClose: () => void
  onProjectCreated?: (project: EbProjectListItem) => void
  onCreated: (project: EbProjectListItem, inspectionId?: string) => void
}

type InspectionForm = {
  variant: EbInspectionVariant
  parentInspectionId: string
  inspectionDate: string
  inspectionTime: string
  meetingPlace: string
  startMeetingTime: string
  finalMeetingTime: string
}

const VARIANTS: Array<{ value: EbInspectionVariant; label: string }> = [
  { value: 'SLB', label: 'Slutbesiktning' },
  { value: 'FB', label: 'Förbesiktning' },
  { value: 'EB', label: 'Efterbesiktning' },
  { value: 'GB', label: 'Garantibesiktning' },
  { value: 'KSB', label: 'Kompletterande slutbesiktning' },
  { value: 'SAB', label: 'Särskild besiktning' },
]

const INITIAL_INSPECTION: InspectionForm = {
  variant: 'SLB', parentInspectionId: '', inspectionDate: '', inspectionTime: '',
  meetingPlace: '', startMeetingTime: '', finalMeetingTime: '',
}

const inputClassName = 'mt-1 block w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50'

function latestInspection(project: EbProjectListItem) {
  return project.inspections.reduce<EbProjectListItem['inspections'][number] | null>(
    (latest, inspection) => !latest || inspection.sequenceNo > latest.sequenceNo ? inspection : latest,
    null,
  )
}

export default function EbNewInspectionDialog({ open, projects, initialProjectId, onClose, onProjectCreated, onCreated }: EbNewInspectionDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const submittingRef = useRef(false)
  const wasOpenRef = useRef(false)
  const titleId = useId()
  const [mode, setMode] = useState<'existing' | 'new'>(() => projects.length ? 'existing' : 'new')
  const [projectId, setProjectId] = useState('')
  const [projectForm, setProjectForm] = useState<EbProjectFormState>(() => ({ ...EMPTY_EB_PROJECT_FORM, agreementItems: [] }))
  const [inspection, setInspection] = useState<InspectionForm>({ ...INITIAL_INSPECTION })
  const [savedProject, setSavedProject] = useState<EbProjectListItem | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const selectedProject = savedProject ?? projects.find(project => project.id === projectId) ?? null

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (wasOpenRef.current) return
    wasOpenRef.current = true
    const initialProject = projects.find(project => project.id === initialProjectId)
    if (!initialProject || savedProject) return
    const previous = latestInspection(initialProject)
    setMode('existing')
    setProjectId(initialProject.id)
    setError('')
    setInspection(current => ({ ...current, variant: previous ? 'EB' : 'SLB', parentInspectionId: previous?.inspectionId ?? '' }))
  }, [open, projects, initialProjectId, savedProject])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!open || !dialog) return
    const previousFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [open])

  const chooseProject = (id: string) => {
    setProjectId(id)
    setError('')
    const project = projects.find(item => item.id === id)
    const previous = project ? latestInspection(project) : null
    setInspection(current => ({
      ...current,
      variant: previous ? 'EB' : 'SLB',
      parentInspectionId: previous?.inspectionId ?? '',
    }))
  }

  const chooseMode = (value: 'existing' | 'new') => {
    setMode(value)
    setError('')
    const previous = value === 'existing' && selectedProject ? latestInspection(selectedProject) : null
    setInspection(current => ({ ...current, variant: previous ? 'EB' : 'SLB', parentInspectionId: previous?.inspectionId ?? '' }))
  }

  const updateInspection = <K extends keyof InspectionForm>(field: K, value: InspectionForm[K]) => {
    setInspection(current => ({ ...current, [field]: value }))
  }

  const handleClose = () => {
    if (submittingRef.current) return
    // The home list keeps the partial project, so closing can start a fresh
    // inspection next time without losing the saved project's entry point.
    if (savedProject && onProjectCreated) {
      setSavedProject(null)
      setProjectId('')
      setProjectForm({ ...EMPTY_EB_PROJECT_FORM, agreementItems: [] })
      setInspection({ ...INITIAL_INSPECTION })
      setMode('existing')
      setError('')
    }
    onClose()
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submittingRef.current) return
    if (mode === 'existing' && !selectedProject) {
      setError('Välj entreprenad för besiktningen.')
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    setError('')
    let project = selectedProject

    try {
      if (mode === 'new' && !savedProject) {
        const response = await fetch('/api/eb/projects', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ebProjectFormToPayload(projectForm)),
        })
        const payload = await response.json().catch(() => ({})) as { project?: EbProjectListItem; error?: string }
        if (!response.ok || !payload.project) throw new Error(payload.error ?? 'Kunde inte skapa entreprenaden.')
        project = payload.project
        // Keep a successfully saved project when creating its inspection fails.
        // Retrying the form must not create another property and project.
        setSavedProject(project)
        onProjectCreated?.(project)
      }
      if (!project) throw new Error('Välj entreprenad för besiktningen.')
      const previousIds = new Set(project.inspections.map(item => item.inspectionId))
      const response = await fetch(`/api/eb/projects/${encodeURIComponent(project.id)}/inspections`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inspection),
      })
      const payload = await response.json().catch(() => ({})) as { project?: EbProjectListItem; error?: string }
      if (!response.ok || !payload.project) throw new Error(payload.error ?? 'Kunde inte skapa besiktningen.')
      const created = payload.project.inspections.find(item => !previousIds.has(item.inspectionId))
      onCreated(payload.project, created?.inspectionId)
      setSavedProject(null)
      setProjectId('')
      setProjectForm({ ...EMPTY_EB_PROJECT_FORM, agreementItems: [] })
      setInspection({ ...INITIAL_INSPECTION })
      setMode('existing')
      onClose()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa besiktningen. Försök igen.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const previousInspections = mode === 'existing' ? selectedProject?.inspections ?? [] : []

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); handleClose() }}
      className="m-auto max-h-[92dvh] w-[calc(100%_-_1.5rem)] max-w-5xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-950/45"
    >
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <div>
          <h2 id={titleId} className="text-xl font-semibold text-slate-950">Ny besiktning</h2>
          <p className="mt-1 text-sm text-slate-600">Välj entreprenad, besiktningstyp och tid.</p>
        </div>
        <button type="button" onClick={handleClose} disabled={submitting} aria-label="Stäng" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-40">
          <X size={20} aria-hidden="true" />
        </button>
      </header>

      <form onSubmit={event => void handleSubmit(event)}>
        <fieldset disabled={submitting} className="min-w-0 space-y-6 p-5 sm:p-6">
          <fieldset disabled={Boolean(savedProject)} className="min-w-0">
            <legend className="text-sm font-semibold text-slate-950">Entreprenad</legend>
            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name={`${titleId}-project-mode`} value="existing" checked={mode === 'existing'} onChange={() => chooseMode('existing')} className="size-4 accent-emerald-700" />Befintlig entreprenad</label>
              <label className="flex cursor-pointer items-center gap-2 text-sm"><input type="radio" name={`${titleId}-project-mode`} value="new" checked={mode === 'new'} onChange={() => chooseMode('new')} className="size-4 accent-emerald-700" />Ny entreprenad</label>
            </div>
          </fieldset>

          {savedProject ? (
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
              <p className="font-semibold">Entreprenaden {savedProject.title} är sparad.</p>
              <p className="mt-1">Besiktningen skapas i denna entreprenad. Du kan komplettera uppgifterna nedan och försöka igen.</p>
            </div>
          ) : mode === 'existing' ? (
            <div>
              <label className="block text-sm font-medium text-slate-700">Välj entreprenad
                <select required value={projectId} onChange={event => chooseProject(event.target.value)} className={inputClassName}>
                  <option value="">Välj entreprenad</option>
                  {projects.map(project => <option key={project.id} value={project.id}>{[project.title, project.address, project.clientName].filter(Boolean).join(' · ')}</option>)}
                </select>
              </label>
              {!projects.length ? <p className="mt-2 text-sm text-slate-600">Ingen entreprenad finns ännu. Välj Ny entreprenad för att börja.</p> : null}
              {selectedProject ? <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><Building2 size={18} className="mt-0.5 shrink-0 text-slate-400" aria-hidden="true" /><div><p className="font-medium text-slate-900">{selectedProject.title}</p><p>{[selectedProject.address, selectedProject.postalCode, selectedProject.city].filter(Boolean).join(', ') || 'Adress ej angiven'}</p><p className="mt-1">Beställare: {selectedProject.clientName || 'Ej angiven'}</p></div></div> : null}
            </div>
          ) : null}

          <section aria-label="Besiktningsuppgifter" className="border-t border-slate-200 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-950">Besiktningsuppgifter</h3>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <label className="block min-w-0 text-sm font-medium text-slate-700">Typ av besiktning
                <select value={inspection.variant} onChange={event => {
                  const variant = event.target.value as EbInspectionVariant
                  setInspection(current => ({ ...current, variant, parentInspectionId: current.parentInspectionId || (selectedProject ? latestInspection(selectedProject)?.inspectionId : '') || '' }))
                }} className={inputClassName}>{VARIANTS.map(variant => <option key={variant.value} value={variant.value}>{variant.label}</option>)}</select>
              </label>
              {previousInspections.length ? <label className="block min-w-0 text-sm font-medium text-slate-700">Tidigare besiktning
                <select value={inspection.parentInspectionId} onChange={event => updateInspection('parentInspectionId', event.target.value)} className={inputClassName}>
                  {[...previousInspections].sort((a, b) => b.sequenceNo - a.sequenceNo).map(previous => <option key={previous.inspectionId} value={previous.inspectionId}>{previous.variantLabel} {previous.sequenceNo}{previous.date ? ` · ${previous.date}` : ''}</option>)}
                </select>
              </label> : null}
              <label className="block min-w-0 text-sm font-medium text-slate-700">Datum<input type="date" value={inspection.inspectionDate} onChange={event => updateInspection('inspectionDate', event.target.value)} className={inputClassName} /></label>
              <label className="block min-w-0 text-sm font-medium text-slate-700">Tid<input type="time" value={inspection.inspectionTime} onChange={event => updateInspection('inspectionTime', event.target.value)} className={inputClassName} /></label>
            </div>
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600">Samlingsplats och mötestider</summary>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">Samlingsplats<input value={inspection.meetingPlace} onChange={event => updateInspection('meetingPlace', event.target.value)} className={inputClassName} /></label>
                <label className="block text-sm font-medium text-slate-700">Startmöte<input type="time" value={inspection.startMeetingTime} onChange={event => updateInspection('startMeetingTime', event.target.value)} className={inputClassName} /></label>
                <label className="block text-sm font-medium text-slate-700">Slutmöte<input type="time" value={inspection.finalMeetingTime} onChange={event => updateInspection('finalMeetingTime', event.target.value)} className={inputClassName} /></label>
              </div>
            </details>
          </section>

          {mode === 'new' && !savedProject ? (
            <section aria-label="Entreprenaduppgifter" className="border-t border-slate-200 pt-5">
              <h3 className="mb-3 text-sm font-semibold text-slate-950">Entreprenaduppgifter</h3>
              <EbProjectForm form={projectForm} onChange={(field, value) => setProjectForm(current => ({ ...current, [field]: value }))} />
            </section>
          ) : null}
        </fieldset>

        {error ? <p role="alert" className="mx-5 mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 sm:mx-6">{error}</p> : null}

        <footer className="sticky bottom-0 flex flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button type="button" onClick={handleClose} disabled={submitting} className="rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 disabled:opacity-40">Avbryt</button>
          <button type="submit" disabled={submitting} className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60">{submitting ? <Loader2 size={17} className="animate-spin" aria-hidden="true" /> : <Plus size={17} aria-hidden="true" />}{submitting ? 'Skapar besiktning …' : 'Skapa besiktning'}</button>
        </footer>
      </form>
    </dialog>
  )
}
