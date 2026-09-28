'use client'

import { useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, Plus, Search, X } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import PendingLink from '@/components/ui/PendingLink'
import { useToast } from '@/components/ui/AppToastProvider'
import type { MoistureOptions, MoistureProject } from '@/lib/moisture/domain'
import MoistureProjectForm, { type MoistureFormValues } from './MoistureProjectForm'
import { formatUpdated, MoistureWorkspace, pricingLabel, readApiFailure, scopeLabel, statusLabel } from './MoistureWorkspace'

export default function MoistureDashboardClient({ orgId, orgName, initialProjects, options, initialError }: {
  orgId: string
  orgName: string | null
  initialProjects: MoistureProject[]
  options: MoistureOptions
  initialError?: string | null
}) {
  const router = useRouter()
  const toast = useToast()
  const [refreshing, startRefresh] = useTransition()
  const [query, setQuery] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [uncertain, setUncertain] = useState(false)
  const [created, setCreated] = useState<MoistureProject | null>(null)
  const flight = useRef(false)
  const projectId = useRef<string | null>(null)
  const pending = useRef<(MoistureFormValues & { projectId: string }) | null>(null)
  const projects = useMemo(() => created && !initialProjects.some(project => project.id === created.id) ? [created, ...initialProjects] : initialProjects, [created, initialProjects])
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('sv-SE')
    return projects.filter(project => !search || [project.title, project.property.name, project.property.address, project.property.cadastralId, project.customer?.name, ...project.buildings.map(building => building.name)]
      .filter(Boolean).join(' ').toLocaleLowerCase('sv-SE').includes(search))
  }, [projects, query])

  async function createProject(values: MoistureFormValues) {
    if (flight.current || created) return
    flight.current = true
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      projectId.current ??= crypto.randomUUID()
      pending.current ??= { ...values, projectId: projectId.current }
      const response = await fetch(`/api/moisture/projects?orgId=${encodeURIComponent(orgId)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pending.current),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const failure = readApiFailure(payload, 'Projektet kunde inte skapas. Försök igen.')
        setError(failure.message)
        setFieldErrors(failure.fieldErrors)
        // A server error can arrive after a successful write. Retry the same ID and snapshot.
        const outcomeUncertain = response.status >= 500 || response.status === 408
        setUncertain(outcomeUncertain)
        if (!outcomeUncertain) pending.current = null
        if (!Object.keys(failure.fieldErrors).length) toast.error(failure.message)
        return
      }
      if (!payload?.project?.id) throw new Error('Svaret saknade projektet.')
      const project = payload.project as MoistureProject
      setCreated(project)
      setUncertain(false)
      toast.success('Projektet är skapat.')
      router.push(`/fuktsakerhet/projekt/${project.id}?orgId=${encodeURIComponent(orgId)}`)
    } catch {
      setUncertain(true)
      const message = 'Skapandet kunde inte bekräftas. Dina uppgifter finns kvar. Försök igen med samma uppgifter så kontrolleras projektet utan att skapa en ny kopia.'
      setError(message)
      toast.error(message)
    } finally {
      setBusy(false)
      flight.current = false
    }
  }

  return <MoistureWorkspace orgName={orgName} title="Fuktsäkerhetsprojekt" description="Samla uppdragets grunddata och koppla arbetet till rätt fastighet och byggnader." backHref="/dashboard-v1" backLabel="Till HusHub">
    {initialError ? <div className="moisture-error" role="alert"><h2>Projekten kunde inte hämtas</h2><p>{initialError}</p><ActionButton tone="secondary" className="moisture-secondary" busy={refreshing} busyLabel="Läser projekt …" onClick={() => startRefresh(() => router.refresh())}>Försök läsa igen</ActionButton></div> : <>
      <section className="moisture-intro-strip">
        <p><strong>Börja med grunddata.</strong> Offert, handlingar, AI-stöd, platsbesök och dokumentleverans byggs i kommande steg.</p>
        <button type="button" className="moisture-primary" aria-expanded={showCreate} aria-controls="moisture-create" onClick={() => setShowCreate(true)} disabled={showCreate}><Plus size={18} aria-hidden />Nytt projekt</button>
      </section>
      <section id="moisture-create" className="moisture-panel moisture-create" hidden={!showCreate} aria-labelledby="moisture-create-title">
        <div className="moisture-panel-heading"><div><p className="moisture-eyebrow">Nytt uppdrag</p><h2 id="moisture-create-title">Skapa projekt</h2></div>
          <button type="button" className="moisture-icon-button" aria-label="Dölj formuläret, behåll uppgifterna" onClick={() => setShowCreate(false)} disabled={busy || uncertain || Boolean(created)}><X size={20} aria-hidden /></button>
        </div>
        {created ? <div className="moisture-created" role="status"><h3>{created.title} är skapat</h3><PendingLink href={`/fuktsakerhet/projekt/${created.id}?orgId=${encodeURIComponent(orgId)}`} autoPending pendingLabel="Öppnar projekt …" className="moisture-primary" icon={<ArrowRight size={17} aria-hidden />}>Öppna projektet</PendingLink></div>
          : <MoistureProjectForm orgId={orgId} options={options} busy={busy} frozen={uncertain} error={error} fieldErrors={fieldErrors} onSubmit={createProject} submitLabel={uncertain ? 'Bekräfta skapandet igen' : 'Skapa projekt'} busyLabel={uncertain ? 'Kontrollerar projekt …' : 'Skapar projekt …'} />}
      </section>

      <section className="moisture-project-list" aria-labelledby="moisture-projects-title">
        <div className="moisture-list-heading"><h2 id="moisture-projects-title">Projekt <span>{projects.length}</span></h2>
          <label className="moisture-search"><Search size={18} aria-hidden /><span className="sr-only">Sök projekt, kund eller fastighet</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Sök projekt, kund eller fastighet" /></label>
        </div>
        {matches.length ? <div className="moisture-project-rows">{matches.map(project => <article key={project.id} className="moisture-project-row">
          <div className="moisture-project-main"><div className="moisture-project-title"><h3><PendingLink href={`/fuktsakerhet/projekt/${project.id}?orgId=${encodeURIComponent(orgId)}`} autoPending pendingLabel="Öppnar projekt …">{project.title}</PendingLink></h3><span className="moisture-status">{statusLabel(project.status)}</span></div>
            <p className="moisture-location"><Building2 size={15} aria-hidden />{[project.property.name, project.property.cadastralId].filter(Boolean).join(' · ')}</p>
            <p className="moisture-muted">{project.customer?.name || 'Beställare anges senare'} · {project.buildings.length} {project.buildings.length === 1 ? 'byggnad' : 'byggnader'} · {pricingLabel(project.pricingMode)}</p>
            <div className="moisture-scope-labels">{project.scopes.map(scope => <span key={scope}>{scopeLabel(scope)}</span>)}</div>
          </div>
          <div className="moisture-project-meta"><span>Uppdaterat {formatUpdated(project.updatedAt)}</span><PendingLink href={`/fuktsakerhet/projekt/${project.id}?orgId=${encodeURIComponent(orgId)}`} autoPending pendingLabel="Öppnar …" className="moisture-open" icon={<ArrowRight size={18} aria-hidden />} aria-label={`Öppna ${project.title}`}>Öppna</PendingLink></div>
        </article>)}</div> : <div className="moisture-empty"><Building2 size={28} aria-hidden /><h3>{query.trim() ? 'Inga projekt matchar sökningen' : 'Ditt första projekt börjar här'}</h3><p>{query.trim() ? 'Prova ett annat projektnamn, en kund eller en fastighetsbeteckning.' : 'Skapa ett projekt för att samla kund, fastighet, byggnader och uppdragets omfattning.'}</p></div>}
      </section>
    </>}
  </MoistureWorkspace>
}
