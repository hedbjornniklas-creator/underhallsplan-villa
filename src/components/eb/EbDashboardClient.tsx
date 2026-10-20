'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Building2, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, CopyPlus, FileText, LockOpen, Plus, RefreshCw, Search, Send, Settings, TriangleAlert, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Protected from '@/components/Protected'
import PendingLink from '@/components/ui/PendingLink'
import GettingStarted from '@/components/besiktapp/GettingStarted'
import EbNewInspectionDialog, { canReusePreviousFinalInspection } from '@/components/eb/EbNewInspectionDialog'
import EbReportDeliveryDialog from '@/components/eb/EbReportDeliveryDialog'
import type { EbInspectionSummary, EbProjectListItem } from '@/lib/eb/server'
import { buildEbOverviewItems, selectEbOverviewPage, type EbOverviewItem, type EbOverviewFilter, type EbOverviewSort } from '@/lib/eb/overview'
import { getEbInspectionLifecycle } from '@/lib/eb/inspectionLifecycle'
import '@/components/ob/ob-overview.css'
import './eb-overview.css'

type Props = { initialProjects: EbProjectListItem[]; initialError: string | null }
const filters: Array<{ value: EbOverviewFilter; label: string }> = [
  { value: 'active', label: 'Pågående' }, { value: 'closed', label: 'Klara' }, { value: 'all', label: 'Alla' },
]
type DeliveryTarget = { projectId: string; inspection: EbInspectionSummary; initialAction: 'delivery' | 'unlock' }
function dateLabel(value: string | null) {
  if (!value) return 'Datum saknas'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Datum saknas' : date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

function InspectionRow({ item, onDelivery, onReuse }: { item: EbOverviewItem; onDelivery: (target: DeliveryTarget) => void; onReuse: (projectId: string, inspectionId: string) => void }) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const { project, inspection, lifecycle } = item
  const base = `/eb/projects/${encodeURIComponent(project.id)}`
  const reportHref = `${base}/inspections/${encodeURIComponent(item.id)}/report`
  const performHref = `${base}/inspections/${encodeURIComponent(item.id)}/perform`
  const marker = lifecycle.needsAttention ? 'attention' : lifecycle.isOpen ? 'active' : 'closed'
  const canReuse = canReusePreviousFinalInspection(inspection) && getEbInspectionLifecycle({ status: 'draft' }, project.status).isOpen
  return <>
    <tr data-row-id={item.id} data-marker={marker}>
      <td className="obo-date"><time dateTime={inspection.date || undefined}>{dateLabel(inspection.date)}</time>{inspection.inspectionTime && <span className="obo-meta eb-time">kl. {inspection.inspectionTime.slice(0, 5)}</span>}</td>
      <td className="obo-identity"><span className="obo-address obo-cell-text" title={item.title}>{item.title}</span><span className="obo-cell-text obo-meta" title={item.address}>{item.address}</span>
        <span className="obo-mobile-only">{project.title} · {item.customer}</span>{lifecycle.deliveryAction && <span className="obo-attention obo-mobile-only">{lifecycle.deliveryAction}</span>}
        {canReuse && <button type="button" onClick={() => onReuse(project.id, inspection.inspectionId)} className="mt-1 inline-flex min-h-11 items-center gap-2 whitespace-normal text-left text-sm font-semibold text-blue-700" aria-label={`Ny slutbesiktning från tidigare: ${item.title}, ${project.title}`}><CopyPlus size={16} className="shrink-0" aria-hidden /><span>Ny slutbesiktning från tidigare</span></button>}</td>
      <td className="obo-desktop-only"><span className="obo-cell-text" title={project.title}>{project.title}</span><span className="obo-cell-text obo-meta">{project.propertyDesignation || project.city || '–'}</span></td>
      <td className="obo-customer obo-desktop-only"><span className="obo-cell-text" title={item.customer}>{item.customer}</span></td>
      <td className="obo-state"><span className="obo-mobile-label">Utlåtande</span><span className="obo-cell-text" title={lifecycle.deliveryLabel}>{lifecycle.deliveryLabel}</span></td>
      <td className="obo-state"><span className="obo-mobile-label">Besiktning</span><span className="obo-cell-text" title={lifecycle.workLabel}>{lifecycle.workLabel}</span></td>
      <td className="obo-details-toggle obo-desktop-only"><button type="button" className="obo-icon obo-row-toggle" data-attention={lifecycle.needsAttention}
        aria-label={`${expanded ? 'Dölj' : 'Visa'} detaljer för ${item.title}, ${project.title}`} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined}
        onClick={() => setExpanded(value => !value)}>{lifecycle.needsAttention ? <TriangleAlert size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}</button></td>
      <td className="obo-actions"><div className="obo-action-links">
        <PendingLink href={lifecycle.isOpen ? performHref : reportHref} className="obo-inspection-link" prefetch={false} autoPending pendingLabel="Öppnar besiktning…"
          aria-label={`Öppna besiktning: ${item.title}, ${project.title}`} title="Öppna besiktning" icon={<ClipboardList size={18} aria-hidden />}>Öppna besiktning</PendingLink>
        <PendingLink href={reportHref} className="obo-confirmation-link" prefetch={false} autoPending pendingLabel="Öppnar utlåtande…"
          aria-label={`Visa utlåtande: ${item.title}, ${project.title}`} title="Visa utlåtande" icon={<FileText size={18} aria-hidden />}>Utlåtande</PendingLink>
        <button type="button" className="eb-delivery-action" onClick={() => onDelivery({ projectId: project.id, inspection, initialAction: 'delivery' })}
          aria-label={`Hantera utlåtande: ${item.title}, ${project.title}`} title={lifecycle.deliveryAction || 'Hantera utlåtande'}><Send size={18} aria-hidden /><span>{lifecycle.deliveryAction || 'Hantera utlåtande'}</span></button>
      </div></td>
    </tr>
    {expanded && <tr className="obo-detail-row obo-desktop-only"><td colSpan={8}><div id={detailsId} className="obo-row-details">
      <dl><div><dt>Besiktning</dt><dd>{item.title}</dd></div><div><dt>Entreprenad</dt><dd>{project.title}</dd></div>
        <div><dt>Fastighet och adress</dt><dd>{[project.propertyDesignation, item.address, project.city].filter(Boolean).join(' · ')}</dd></div><div><dt>Beställare</dt><dd>{item.customer}</dd></div>
        <div><dt>Uppdragsnummer</dt><dd>{inspection.assignmentNumber || '–'}</dd></div><div><dt>Status</dt><dd>{lifecycle.workLabel} · {lifecycle.deliveryLabel}</dd></div></dl>
      {lifecycle.deliveryAction && <p className="obo-attention">{lifecycle.deliveryAction}</p>}
      <div className="eb-detail-actions"><PendingLink href={base} prefetch={false} autoPending pendingLabel="Öppnar entreprenad…" icon={<Building2 size={16} aria-hidden />}>Entreprenad, avtal och historik</PendingLink>
        {inspection.reportLockedAt && <button type="button" onClick={() => onDelivery({ projectId: project.id, inspection, initialAction: 'unlock' })}><LockOpen size={16} aria-hidden />Lås upp för ändring</button>}</div>
    </div></td></tr>}
    <tr className="eb-mobile-context"><td colSpan={8}><Link href={base}>Entreprenad och historik</Link>{inspection.reportLockedAt && <button type="button" onClick={() => onDelivery({ projectId: project.id, inspection, initialAction: 'unlock' })}><LockOpen size={16} aria-hidden />Lås upp för ändring</button>}</td></tr>
  </>
}

export default function EbDashboardClient({ initialProjects, initialError }: Props) {
  const router = useRouter()
  const [projects, setProjects] = useState(initialProjects)
  const [error, setError] = useState(initialError)
  const [loading, setLoading] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [createProjectId, setCreateProjectId] = useState<string | null>(null)
  const [createSourceInspectionId, setCreateSourceInspectionId] = useState<string | null>(null)
  const [deliveryTarget, setDeliveryTarget] = useState<DeliveryTarget | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<EbOverviewFilter>('active')
  const [sort, setSort] = useState<EbOverviewSort>('date-desc')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const request = useRef<AbortController | null>(null)
  const lastLoaded = useRef(0)
  const dialogOpen = useRef(false)
  const heading = useId()
  const items = useMemo(() => buildEbOverviewItems(projects), [projects])
  const result = useMemo(() => selectEbOverviewPage(items, { search, filter, sort, attentionOnly, showArchived, page, pageSize }), [items, search, filter, sort, attentionOnly, showArchived, page, pageSize])
  const selectableProjects = projects.filter(project => getEbInspectionLifecycle({ status: 'draft' }, project.status).isOpen)
  const emptyProjects = selectableProjects.filter(project => !project.inspections.length)
  const filtered = Boolean(search.trim() || filter !== 'active' || attentionOnly)
  useEffect(() => { dialogOpen.current = createOpen || Boolean(deliveryTarget) }, [createOpen, deliveryTarget])
  const refresh = useCallback(async (automatic = false) => {
    if (automatic && (dialogOpen.current || request.current || Date.now() - lastLoaded.current < 5000)) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller; setLoading(true)
    try {
      const response = await fetch('/api/eb/projects', { cache: 'no-store', signal: controller.signal })
      const payload = await response.json()
      if ([401, 403].includes(response.status) && !controller.signal.aborted) {
        setProjects([]); setDeliveryTarget(null); setCreateOpen(false)
      }
      if (!response.ok || !Array.isArray(payload.projects)) throw new Error(payload.error || 'Besiktningarna kunde inte hämtas.')
      if (!controller.signal.aborted) { setProjects(payload.projects); setError(null); lastLoaded.current = Date.now() }
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Besiktningarna kunde inte hämtas.') }
    finally { if (request.current === controller) { request.current = null; setLoading(false) } }
  }, [])
  useEffect(() => {
    void refresh(true)
    const visible = () => { if (document.visibilityState === 'visible') void refresh(true) }
    window.addEventListener('focus', visible); document.addEventListener('visibilitychange', visible)
    return () => { request.current?.abort(); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible) }
  }, [refresh])
  const updateProject = useCallback((project: EbProjectListItem) => {
    request.current?.abort()
    setProjects(current => [project, ...current.filter(item => item.id !== project.id)])
  }, [])
  const resetFilters = () => { setSearch(''); setFilter('active'); setAttentionOnly(false); setPage(1) }
  const reuseInspection = (projectId: string, inspectionId: string) => {
    setCreateProjectId(projectId)
    setCreateSourceInspectionId(inspectionId)
    setCreateOpen(true)
  }

  return <Protected><main className="obo-home eb-home min-h-screen"><div className="obo-home-inner mx-auto w-full p-4 md:p-6">
    <GettingStarted module="eb" onStart={() => setCreateOpen(true)} heading={<>
      <PendingLink href="/dashboard-v1" aria-label="Tillbaka" title="Tillbaka" autoPending pendingLabel="Öppnar dashboard…" icon={<ArrowLeft size={20} aria-hidden />}> </PendingLink><h1>Entreprenadbesiktning</h1>
    </>} />
    <div className="eb-home-actions"><button type="button" onClick={() => setCreateOpen(true)} className="eb-primary"><Plus size={18} aria-hidden />Ny besiktning</button><PendingLink href="/settings" autoPending pendingLabel="Öppnar inställningar…" icon={<Settings size={17} aria-hidden />}>Inställningar</PendingLink></div>
    <section className="obo eb-overview" aria-labelledby={heading} aria-busy={loading}>
      <div className="obo-heading"><h2 id={heading}>EB-besiktningar</h2><button type="button" className="obo-icon" disabled={loading} onClick={() => void refresh()} aria-label="Uppdatera besiktningslistan" title="Uppdatera besiktningslistan"><RefreshCw size={20} className={loading ? 'obo-spinning' : undefined} aria-hidden /></button></div>
      <p className="mb-3 text-sm text-slate-600">Pågående visar öppna besiktningar och kvarstående leveransuppgifter.</p>
      <div className="obo-workspace"><div className="obo-toolbar">
        <div className="obo-search"><Search size={20} aria-hidden /><input type="search" aria-label="Sök besiktningar" placeholder="Sök besiktning, entreprenad eller kund" maxLength={200} value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />{search && <button type="button" className="obo-icon" aria-label="Rensa sökning" onClick={() => { setSearch(''); setPage(1) }}><X size={18} aria-hidden /></button>}</div>
        <label className="obo-sort"><span>Sortering</span><select value={sort} onChange={event => { setSort(event.target.value as EbOverviewSort); setPage(1) }}><option value="date-desc">Nyast först</option><option value="date-asc">Äldst först</option><option value="customer">Kund A–Ö</option><option value="address">Adress A–Ö</option></select></label>
        <label className="obo-page-size"><span>Rader</span><select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}><option value="10">10</option><option value="25">25</option><option value="50">50</option></select></label>
      </div><div className="obo-filters"><div className="obo-filter-buttons" role="group" aria-label="Filtrera besiktningar">{filters.map(option => <button type="button" key={option.value} aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setPage(1) }}>{option.label}<span>{result.counts[option.value]}</span></button>)}</div>
        <label className="obo-filter-select"><span>Visa</span><select value={filter} onChange={event => { setFilter(event.target.value as EbOverviewFilter); setPage(1) }}>{filters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        <label className="obo-check"><input type="checkbox" checked={attentionOnly} onChange={event => { setAttentionOnly(event.target.checked); setPage(1) }} />Kräver åtgärd</label><label className="obo-check"><input type="checkbox" checked={showArchived} onChange={event => { setShowArchived(event.target.checked); setPage(1) }} />Visa arkiverade / avbokade</label>
      </div>
      {error && <div className="obo-error" role="alert"><p>{error}</p><button type="button" onClick={() => void refresh()} disabled={loading}>Försök igen</button></div>}{loading && <p className="obo-empty" role="status">Uppdaterar besiktningslistan…</p>}
      {!result.items.length && !loading && !error && <div className="obo-empty" role="status"><p>{filtered ? 'Inga besiktningar matchar dina val.' : items.length ? 'Inga pågående besiktningar eller leveransuppgifter.' : 'Inga besiktningar ännu.'}</p>{filtered ? <button type="button" onClick={resetFilters}>Rensa filter</button> : items.length ? <button type="button" onClick={() => setFilter('closed')}>Visa klara besiktningar</button> : <button type="button" onClick={() => setCreateOpen(true)}>Skapa din första besiktning</button>}</div>}
      {result.items.length > 0 && <table className="obo-table"><caption className="obo-sr">Besiktningar med separata statusar för arbete och utlåtandets leverans</caption><thead><tr><th scope="col">Besiktningsdag</th><th scope="col">Besiktning / adress</th><th scope="col">Entreprenad</th><th scope="col">Beställare</th><th scope="col">Utlåtande</th><th scope="col">Besiktning</th><th scope="col"><span className="obo-sr">Detaljer</span></th><th scope="col"><span className="obo-sr">Öppna</span></th></tr></thead><tbody>{result.items.map(item => <InspectionRow key={item.id} item={item} onDelivery={setDeliveryTarget} onReuse={reuseInspection} />)}</tbody></table>}
      <div className="obo-pagination"><span role="status" aria-live="polite">{result.total ? `${result.start + 1}–${result.start + result.items.length} av ${result.total} besiktningar` : '0 besiktningar'}</span><nav aria-label="Sidbläddring besiktningar"><button type="button" className="obo-icon" aria-label="Föregående sida" disabled={result.page === 1} onClick={() => setPage(result.page - 1)}><ChevronLeft size={20} aria-hidden /></button><span>{result.page} / {result.pages}</span><button type="button" className="obo-icon" aria-label="Nästa sida" disabled={result.page >= result.pages} onClick={() => setPage(result.page + 1)}><ChevronRight size={20} aria-hidden /></button></nav></div>
      </div>
    </section>
    {emptyProjects.length > 0 && <details className="eb-empty-projects"><summary>Entreprenader utan besiktning ({emptyProjects.length})</summary><ul>{emptyProjects.map(project => <li key={project.id}><Link href={`/eb/projects/${encodeURIComponent(project.id)}`}>{project.title}</Link><button type="button" onClick={() => { setCreateProjectId(project.id); setCreateOpen(true) }}>Lägg till besiktning</button></li>)}</ul></details>}
    <EbNewInspectionDialog open={createOpen} projects={selectableProjects} initialProjectId={createProjectId || undefined} initialSourceInspectionId={createSourceInspectionId || undefined} onClose={() => { setCreateOpen(false); setCreateProjectId(null); setCreateSourceInspectionId(null) }} onCreated={(project, inspectionId) => {
      updateProject(project)
      if (inspectionId) router.push(`/eb/projects/${encodeURIComponent(project.id)}/inspections/${encodeURIComponent(inspectionId)}/perform`)
    }} onProjectCreated={updateProject} />
    <EbReportDeliveryDialog open={Boolean(deliveryTarget)} projectId={deliveryTarget?.projectId || ''} inspection={deliveryTarget?.inspection || null} initialAction={deliveryTarget?.initialAction || 'delivery'} onClose={() => { setDeliveryTarget(null); void refresh() }} onProjectUpdated={updateProject} onChanged={() => undefined} />
  </div></main></Protected>
}
