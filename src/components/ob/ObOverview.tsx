'use client'

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, ChevronDown, ChevronLeft, ChevronRight, RefreshCw, Search, X } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import PendingLink from '@/components/ui/PendingLink'
import { selectObOverview, type ObOverviewItem, type OverviewFilter, type OverviewSort } from '@/lib/ob/overview'
import './ob-overview.css'

export function ObDashboardShortcuts({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return <div className="obo-shortcuts" data-open={open}>
    <button type="button" className="obo-shortcuts-toggle" aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>
      <span>Genvägar</span><ChevronDown size={20} aria-hidden="true" />
    </button>
    <div className="obo-shortcuts-content" id={id}>{children}</div>
  </div>
}

const filters: { value: OverviewFilter; label: string }[] = [
  { value: 'all', label: 'Alla' }, { value: 'active', label: 'Aktuella' }, { value: 'closed', label: 'Avslutade' },
]

function dateLabel(value: string | null) {
  if (!value) return 'Datum saknas'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Datum saknas' : date.toLocaleDateString('sv-SE', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Stockholm',
  })
}

export default function ObOverview({ refreshKey = 0 }: { refreshKey?: number }) {
  const [items, setItems] = useState<ObOverviewItem[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<OverviewFilter>('all')
  const [sort, setSort] = useState<OverviewSort>('date-desc')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const request = useRef<AbortController | null>(null)
  const heading = useId()
  const load = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    try {
      const response = await fetch('/api/ob/overview', { signal: controller.signal, cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok || !Array.isArray(payload.items)) throw new Error(payload.error || 'Uppdragslistan kunde inte hämtas.')
      if (controller.signal.aborted) return
      setItems(payload.items)
      setError(null)
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : 'Uppdragslistan kunde inte hämtas.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', visible)
    document.addEventListener('visibilitychange', visible)
    return () => {
      request.current?.abort()
      window.removeEventListener('focus', visible)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [load, refreshKey])

  const selection = { search, filter, sort, attentionOnly, showArchived }
  const filtered = selectObOverview(items ?? [], selection)
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const currentPage = Math.min(page, pages)
  const start = (currentPage - 1) * pageSize
  const rows = filtered.slice(start, start + pageSize)
  function changeFilter(value: OverviewFilter) { setFilter(value); setPage(1) }
  function resetFilters() { setSearch(''); setFilter('all'); setAttentionOnly(false); setPage(1) }

  return <section className="obo" aria-labelledby={heading} aria-busy={loading}>
    <div className="obo-heading">
      <h2 id={heading}>ÖB-uppdrag</h2>
      <ActionButton className="obo-icon" aria-label="Uppdatera uppdragslistan" title="Uppdatera uppdragslistan"
        onClick={() => void load()} busy={loading} tone="secondary"
        icon={<RefreshCw size={20} aria-hidden="true" />}
        busyIcon={<RefreshCw size={20} aria-hidden="true" className="obo-spinning" />}>
        <span className="obo-sr">Uppdatera uppdragslistan</span>
      </ActionButton>
    </div>
    <div className="obo-workspace">
      <div className="obo-toolbar">
        <div className="obo-search">
          <Search size={20} aria-hidden="true" />
          <input type="search" aria-label="Sök uppdrag" title="Sök adress, kund eller uppdragsnummer" placeholder="Sök uppdrag"
            value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
          {search && <button type="button" className="obo-icon" aria-label="Rensa sökning" title="Rensa sökning"
            onClick={() => { setSearch(''); setPage(1) }}><X size={18} aria-hidden="true" /></button>}
        </div>
        <label className="obo-sort"><span>Sortering</span>
          <select value={sort} onChange={event => { setSort(event.target.value as OverviewSort); setPage(1) }}>
            <option value="date-desc">Nyast först</option><option value="date-asc">Äldst först</option>
            <option value="customer">Kund A–Ö</option><option value="address">Adress A–Ö</option>
          </select>
        </label>
        <label className="obo-page-size"><span>Rader</span>
          <select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>
            <option value="10">10</option><option value="25">25</option><option value="50">50</option>
          </select>
        </label>
      </div>
      <div className="obo-filters">
        <div className="obo-filter-buttons" role="group" aria-label="Filtrera uppdrag">
          {filters.map(option => <button type="button" key={option.value} aria-pressed={filter === option.value}
            onClick={() => changeFilter(option.value)}>{option.label}<span>{selectObOverview(items ?? [], { ...selection, filter: option.value }).length}</span></button>)}
        </div>
        <label className="obo-filter-select"><span>Visa</span>
          <select value={filter} onChange={event => changeFilter(event.target.value as OverviewFilter)}>
            {filters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="obo-check"><input type="checkbox" checked={attentionOnly}
          onChange={event => { setAttentionOnly(event.target.checked); setPage(1) }} />Kräver åtgärd</label>
        <label className="obo-check"><input type="checkbox" checked={showArchived}
          onChange={event => { setShowArchived(event.target.checked); setPage(1) }} />Visa arkiverade</label>
      </div>
      {error && <div className="obo-error" role="alert"><p>{error}{items ? ' Listan nedan visar senast hämtade uppgifter.' : ''}</p>
        <ActionButton className="obo-retry" tone="secondary" onClick={() => void load()} busy={loading} busyLabel="Hämtar…">Försök igen</ActionButton></div>}
      {items === null && !error ? <p className="obo-empty" role="status">Hämtar uppdrag…</p> : null}
      {items !== null && rows.length === 0 ? <div className="obo-empty" role="status">
        <p>{items.length === 0 ? 'Inga ÖB-uppdrag ännu.' : 'Inga uppdrag matchar dina val.'}</p>
        {items.length > 0 && <button type="button" onClick={resetFilters}>Rensa filter</button>}
      </div> : null}
      {rows.length > 0 && <table className="obo-table">
        <caption className="obo-sr">ÖB-uppdrag med separata statusar för uppdragsbekräftelse och besiktning</caption>
        <thead><tr><th scope="col">Besiktningsdag</th><th scope="col">Adress / kund</th>
          <th scope="col">Uppdragsbekräftelse</th><th scope="col">Besiktning</th><th scope="col"><span className="obo-sr">Åtgärder</span></th></tr></thead>
        <tbody>{rows.map(item => <tr key={item.id} data-marker={item.marker} data-row-id={item.id}>
          <td className="obo-date">{item.date ? <time dateTime={item.date}>{dateLabel(item.date)}</time> : 'Datum saknas'}</td>
          <td className="obo-identity">
            <span className="obo-address">{item.address}</span>
            <span>{item.customer}</span>
            {(item.city || item.assignmentNumber) && <small>{[item.city, item.assignmentNumber].filter(Boolean).join(' · ')}</small>}
            {item.attention.length > 0 && <ul className="obo-attention">{item.attention.map(reason => <li key={reason}>{reason}</li>)}</ul>}
          </td>
          <td className="obo-state"><span className="obo-mobile-label" aria-hidden="true">Bekräftelse</span><span>{item.confirmation}</span></td>
          <td className="obo-state"><span className="obo-mobile-label" aria-hidden="true">Besiktning</span><span>{item.inspection}</span></td>
          <td className="obo-actions">
            {item.inspectionHref && <PendingLink href={item.inspectionHref} prefetch={false} autoPending pendingLabel="Öppnar besiktning…"
              icon={<ArrowRight size={16} aria-hidden="true" />}>Öppna besiktning</PendingLink>}
            {item.confirmationHref && <PendingLink href={item.confirmationHref} prefetch={false} autoPending pendingLabel="Öppnar bekräftelse…"
              icon={<ArrowRight size={16} aria-hidden="true" />}>{item.confirmationAction}</PendingLink>}
          </td>
        </tr>)}</tbody>
      </table>}
      {items !== null && <div className="obo-pagination">
        <span role="status" aria-live="polite">{filtered.length ? `${start + 1}–${start + rows.length} av ${filtered.length} uppdrag` : '0 uppdrag'}</span>
        <nav aria-label="Sidbläddring uppdrag">
          <button type="button" className="obo-icon" aria-label="Föregående sida" title="Föregående sida" disabled={currentPage === 1}
            onClick={() => setPage(currentPage - 1)}><ChevronLeft size={20} aria-hidden="true" /></button>
          <span>{currentPage} / {pages}</span>
          <button type="button" className="obo-icon" aria-label="Nästa sida" title="Nästa sida" disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}><ChevronRight size={20} aria-hidden="true" /></button>
        </nav>
      </div>}
    </div>
  </section>
}
