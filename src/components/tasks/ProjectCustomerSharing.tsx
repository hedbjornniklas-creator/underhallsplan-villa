'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarClock, Eye, EyeOff, FileText, FolderOpen, ListChecks, Loader2, RefreshCw, RotateCcw, WalletCards } from 'lucide-react'
import { customerSections, type CustomerSharingWorkspace } from '@/lib/action-cases/customerSharing'
import type { ActionCasePortal } from '@/lib/action-cases/contracts'
import { useCustomerSharingAutosave } from './useCustomerSharingAutosave'
import ActionCaseCustomerPortal from './ActionCaseCustomerPortal'
import './customer-sharing.css'

const icons = { contract: FileText, choices: ListChecks, payments: WalletCards, schedule: CalendarClock, files: FolderOpen }
export default function ProjectCustomerSharing({ caseId, active, preview, refreshKey = 0, onDirty, onPreview }: { caseId: string; active: boolean; preview: boolean; refreshKey?: number; onDirty: (dirty: boolean) => void; onPreview: () => void }) {
  const save = useCustomerSharingAutosave(caseId)
  const [loading, setLoading] = useState(false), [loadError, setLoadError] = useState(''), [recipientId, setRecipientId] = useState('')
  const [previewPortal, setPortal] = useState<ActionCasePortal | null>(null), [portalKey, setPortalKey] = useState(''), [previewError, setPreviewError] = useState('')
  const [previewRefresh, setPreviewRefresh] = useState(0)
  const loadedKey = useRef<number | null>(null), controls = useRef(save); controls.current = save
  const workspace = save.workspace
  const portal = portalKey === `${caseId}:${recipientId}:${workspace?.revision}` ? previewPortal : null
  const load = useCallback(async (signal?: AbortSignal) => {
    if (controls.current.isBusy()) return
    setLoading(true)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/sharing`, { cache: 'no-store', signal }), result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Delningen kunde inte hämtas.')
      if (!Number.isSafeInteger(result.revision) || !Array.isArray(result.recipients) || customerSections.some(s => typeof result.tabs?.[s.key] !== 'boolean')) throw new Error('Delningen kunde inte hämtas.')
      if (signal?.aborted) return
      controls.current.reset(result as CustomerSharingWorkspace); setLoadError('')
      setPreviewRefresh(current => current + 1)
      setRecipientId(current => result.recipients.some((p: { id: string }) => p.id === current) ? current : result.recipients[0]?.id || '')
    } catch (error) { if (!signal?.aborted) setLoadError(error instanceof Error ? error.message : 'Delningen kunde inte hämtas.') }
    finally { setLoading(false) }
  }, [caseId])
  useEffect(() => {
    if (!active || (loadedKey.current === refreshKey && controls.current.workspace)) return
    const controller = new AbortController(); loadedKey.current = refreshKey; void load(controller.signal)
    return () => controller.abort()
  }, [active, refreshKey, load])
  useEffect(() => { onDirty(save.dirty || save.busy) }, [save.dirty, save.busy, onDirty])
  useEffect(() => {
    if (!save.dirty && !save.busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [save.dirty, save.busy])
  useEffect(() => {
    if (!active || !preview || !recipientId || save.dirty || save.busy) return
    const controller = new AbortController(); setPortal(null); setPreviewError('')
    void (async () => {
      try {
        const response = await fetch(`/api/action-cases/${caseId}/sharing/preview?participantId=${encodeURIComponent(recipientId)}`, { cache: 'no-store', signal: controller.signal }), result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Beställarvyn kunde inte hämtas.')
        if (result.participant?.id !== recipientId || result.participant.role !== 'customer' || result.actionCase?.id !== caseId) throw new Error('Beställarvyn kunde inte bekräftas.')
        if (!controller.signal.aborted) { setPortalKey(`${caseId}:${recipientId}:${workspace?.revision}`); setPortal(result) }
      } catch (e) { if (!controller.signal.aborted) setPreviewError(e instanceof Error ? e.message : 'Beställarvyn kunde inte hämtas.') }
    })()
    return () => controller.abort()
  }, [active, preview, recipientId, caseId, workspace?.revision, save.dirty, save.busy, previewRefresh])
  return <section hidden={!active} className="gizmo-sharing" aria-label={preview ? 'Visa som beställare' : 'Delning'}>
    <header className="gizmo-section-heading"><h2>{preview ? 'Visa som beställare' : 'Delning'}</h2><div className="gizmo-sharing-commands">
      {!preview && <button type="button" className="gizmo-button" disabled={!workspace?.recipients.length || save.dirty || loading} onClick={onPreview}><Eye size={17} />Visa som beställare</button>}
      <button type="button" className="gizmo-button gizmo-icon-button" title="Hämta sparade inställningar" aria-label="Hämta sparade inställningar" disabled={save.busy || loading} onClick={() => { if (!save.dirty || window.confirm('Hämta sparade inställningar och kasta dina osparade val?')) void load() }}><RefreshCw size={17} /></button>
    </div></header>
    {loadError && <p role="alert" className="gizmo-sharing-error">{loadError}</p>}
    {!workspace ? <p role="status">{loading ? 'Hämtar delning…' : 'Delningen kunde inte hämtas.'}</p> : preview ? <>
      <label className="gizmo-sharing-recipient">Beställare<select value={recipientId} disabled={save.dirty || save.busy} onChange={e => { setPortal(null); setRecipientId(e.target.value) }}>{!workspace.recipients.length && <option value="">Ingen beställare</option>}{workspace.recipients.map(p => <option key={p.id} value={p.id}>{p.name}{p.email ? ` · ${p.email}` : ''}</option>)}</select></label>
      {previewError ? <p role="alert" className="gizmo-sharing-error">{previewError}</p> : !recipientId ? <p>Ingen beställare är registrerad för delning.</p> : !portal ? <p role="status">Hämtar beställarvyn…</p> : portal.customerOffers?.enabled ? <ActionCaseCustomerPortal key={`${recipientId}:${workspace.revision}`} portal={portal} preview previewCaseId={caseId} /> : <section className="gizmo-sharing-legacy"><h2>{portal.actionCase.title}</h2><p>{portal.actionCase.propertyAddress}</p><h3>Arbeten</h3>{portal.actionCase.items.map(item => <div key={item.id}><h4>{item.title}</h4><p className="whitespace-pre-wrap">{item.scope}</p></div>)}<h3>Delade bilder och dokument</h3>{portal.actionCase.attachments.map(file => <a key={file.id} href={`/api/action-cases/${caseId}/attachments/${file.id}`} target="_blank" rel="noreferrer">{file.fileName}</a>)}</section>}
    </> : <>
      <div className="gizmo-sharing-table" role="table" aria-label="Beställarens flikar"><div className="gizmo-sharing-table-head" role="row"><span role="columnheader">Flik</span><span role="columnheader">Beställarens sida</span></div>
        {customerSections.map(({ key, label }) => { const Icon = icons[key], visible = save.edits[key] ?? workspace.tabs[key]; return <div className="gizmo-sharing-row" role="row" key={key}><span role="cell"><Icon size={18} aria-hidden="true" /><strong>{label}</strong></span><span role="cell"><span className="gizmo-sharing-visibility">{visible ? <Eye size={16} /> : <EyeOff size={16} />}{visible ? 'Visas' : 'Dold'}</span><button type="button" role="switch" className="gizmo-sharing-switch" aria-checked={visible} aria-label={`Visa ${label} för beställaren`} disabled={!workspace.canEdit || loading} onClick={() => save.change(key, !visible)}><span aria-hidden="true"><i /></span></button></span></div> })}
      </div>
      <div className="gizmo-sharing-status" aria-live="polite">{save.error ? <div role="alert" className="gizmo-sharing-error">{save.error}<button type="button" className="gizmo-button" disabled={save.busy} onClick={save.retry}><RotateCcw size={16} />Försök igen</button></div> : <span>{save.busy ? <Loader2 size={15} className="animate-spin" /> : null}{save.busy ? 'Sparar…' : save.dirty ? 'Osparade ändringar' : 'Sparat'}{workspace.updatedAt && !save.dirty && !save.busy ? ` · ${new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(workspace.updatedAt))}` : ''}</span>}</div>
      {!workspace.canEdit && <p className="gizmo-secondary">{workspace.managerId ? 'Behörighet: Läsning' : 'Projektansvarig saknas'}</p>}
    </>}
  </section>
}
