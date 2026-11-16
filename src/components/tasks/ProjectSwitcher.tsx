'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Loader2, RefreshCw } from 'lucide-react'
import { projectSwitchGroups, type ProjectSwitchOption } from '@/lib/action-cases/projectSwitcher'
import { projectUrl } from '@/lib/action-cases/projectNavigation'
import { useProjectSaveNavigation } from './ProjectSaveProtection'

export default function ProjectSwitcher({ current, projects, error, onNavigate }: {
  current: ProjectSwitchOption; projects: ProjectSwitchOption[]; error?: string | null; onNavigate?: (url: string) => void
}) {
  const protect = useProjectSaveNavigation(), labelId = useId(), running = useRef(false)
  const [checking, setChecking] = useState(false), [leaving, setLeaving] = useState(false), [failure, setFailure] = useState('')
  const groups = projectSwitchGroups(projects, current)
  useEffect(() => {
    const restored = () => { setLeaving(false); setChecking(false); running.current = false }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])
  async function navigate(url: string) {
    if (running.current || leaving) return
    running.current = true; setChecking(true); setFailure('')
    try {
      const go = () => { setLeaving(true); if (onNavigate) onNavigate(url); else window.location.assign(url) }
      if (protect) await protect(go); else go()
    } catch { setLeaving(false); setFailure('Projektet kunde inte öppnas. Försök igen.') }
    finally { running.current = false; setChecking(false) }
  }
  return <div className="gizmo-project-switcher">
    <label id={labelId} htmlFor={`${labelId}-select`}>Byt projekt</label>
    <div className="gizmo-project-switcher-control">
      <select id={`${labelId}-select`} aria-labelledby={labelId} value={current.id} title={current.title} disabled={checking || leaving || Boolean(error)} onChange={event => {
        const id = event.target.value
        event.currentTarget.value = current.id
        if (id !== current.id && projects.some(project => project.id === id)) void navigate(projectUrl(id))
      }}>
        {groups.map(group => <optgroup key={group.label} label={group.label}>{group.projects.map(project => <option key={project.id} value={project.id}>{project.title}{project.status === 'cancelled' ? ' (Avbrutet)' : ''}</option>)}</optgroup>)}
      </select>
      {checking || leaving ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
    </div>
    {(error || failure) && <div className="gizmo-project-switcher-error" role="alert"><span>{failure || error}</span><button type="button" className="gizmo-button gizmo-icon-button" title="Hämta projektlistan igen" aria-label="Hämta projektlistan igen" disabled={checking || leaving} onClick={() => void navigate(window.location.href)}><RefreshCw size={16} /></button></div>}
    {(checking || leaving) && <span className="sr-only" role="status">{checking ? 'Kontrollerar pågående ändringar…' : 'Öppnar projektet…'}</span>}
  </div>
}
