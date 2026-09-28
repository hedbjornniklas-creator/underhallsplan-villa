'use client'

import { useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import PendingLink from '@/components/ui/PendingLink'
import { useToast } from '@/components/ui/AppToastProvider'
import type { MoistureOptions, MoistureProject } from '@/lib/moisture/domain'
import MoistureProjectForm, { type MoistureFormValues } from './MoistureProjectForm'
import { formatUpdated, MoistureGuide, MoistureWorkspace, readApiFailure } from './MoistureWorkspace'

export default function MoistureProjectClient({ orgId, orgName, initialProject, options }: {
  orgId: string
  orgName: string | null
  initialProject: MoistureProject
  options: MoistureOptions
}) {
  const toast = useToast()
  const [project, setProject] = useState(initialProject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState(false)
  const flight = useRef(false)
  const href = `/fuktsakerhet/projekt/${project.id}?orgId=${encodeURIComponent(orgId)}`
  const currentOptions: MoistureOptions = {
    ...options,
    properties: options.properties.map(property => property.id === project.propertyId
      ? { ...property, buildings: [...property.buildings, ...project.buildings.filter(building => !property.buildings.some(existing => existing.id === building.id))] }
      : property),
  }

  async function save(values: MoistureFormValues) {
    if (flight.current || conflict) return
    flight.current = true
    setBusy(true)
    setError(null)
    setFieldErrors({})
    try {
      const { property: _property, ...changes } = values
      void _property
      const response = await fetch(`/api/moisture/projects/${project.id}?orgId=${encodeURIComponent(orgId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...changes, revision: project.revision }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const failure = readApiFailure(payload, 'Grunddata kunde inte sparas. Försök igen.')
        setError(failure.message)
        setFieldErrors(failure.fieldErrors)
        setConflict(response.status === 409)
        if (!Object.keys(failure.fieldErrors).length) toast.error(failure.message)
        return
      }
      if (!payload?.project?.id) throw new Error('Svaret saknade projektet.')
      setProject(payload.project as MoistureProject)
      toast.success('Projektets grunddata är sparade.')
    } catch {
      const message = 'Sparandet kunde inte bekräftas. Dina ändringar finns kvar. Försök igen; om projektet redan har sparats behöver du jämföra med den senaste versionen.'
      setError(message)
      toast.error(message)
    } finally {
      flight.current = false
      setBusy(false)
    }
  }

  return <MoistureWorkspace orgName={orgName} title={project.title} description={[project.property.name, project.property.cadastralId].filter(Boolean).join(' · ')} backHref={`/fuktsakerhet?orgId=${encodeURIComponent(orgId)}`} backLabel="Alla fuktsäkerhetsprojekt">
    <div className="moisture-detail-layout">
      <section className="moisture-panel" aria-labelledby="moisture-data-title">
        <div className="moisture-panel-heading"><div><p className="moisture-eyebrow">Steg 1</p><h2 id="moisture-data-title">Grunddata</h2></div><span className="moisture-muted">Version {project.revision} · {formatUpdated(project.updatedAt)}</span></div>
        {conflict && <div className="moisture-conflict" role="alert"><h3>En nyare version finns</h3><p>Dina ändringar finns kvar i formuläret. Öppna den sparade versionen i en ny flik och jämför innan du fortsätter.</p><PendingLink href={href} target="_blank" rel="noopener noreferrer" className="moisture-text-link">Öppna sparad version i ny flik</PendingLink><p>För att börja om här från den sparade versionen, ladda om sidan. Osparade ändringar i formuläret följer inte med.</p><ActionButton tone="secondary" className="moisture-secondary" icon={<RefreshCw size={16} aria-hidden />} onClick={() => window.location.reload()}>Ladda om från sparad version</ActionButton></div>}
        <MoistureProjectForm key={`${project.id}:${project.revision}`} orgId={orgId} options={currentOptions} project={project} busy={busy} frozen={conflict} error={error} fieldErrors={fieldErrors} onSubmit={save} submitLabel={conflict ? 'Jämför senaste versionen först' : 'Spara grunddata'} busyLabel="Sparar grunddata …" />
      </section>
      <MoistureGuide />
    </div>
  </MoistureWorkspace>
}
