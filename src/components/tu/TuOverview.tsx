'use client'

import { useId, useMemo, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Download, FileCheck2, FileText, Play, RefreshCw, Search, TriangleAlert, X } from 'lucide-react'
import PendingLink from '@/components/ui/PendingLink'
import type { TuAssignmentListItem } from '@/lib/tu/server'
import { buildTuOverviewItems, selectTuOverviewPage, type TuOverviewFilter, type TuOverviewItem, type TuOverviewSort, type TuOverviewInvestigation } from '@/lib/tu/overview'
import '../ob/ob-overview.css'
import './tu-overview.css'

const filters: Array<{ value: TuOverviewFilter; label: string }> = [
  { value: 'all', label: 'Alla' }, { value: 'active', label: 'Aktuella' }, { value: 'closed', label: 'Avslutade' },
]

function dateLabel(value: string | null) {
  const date = value ? new Date(value) : null
  return !date || Number.isNaN(date.getTime()) ? 'Datum saknas' : date.toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
}

function OverviewRow({ item, busy, onStartAssignment }: {
  item: TuOverviewItem; busy: boolean; onStartAssignment: (assignment: TuAssignmentListItem) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const detailsLabel = `${expanded ? 'Dölj' : 'Visa'} detaljer för ${item.address}`
  const marker = item.attention.length ? 'attention' : item.closed ? 'closed' : 'active'
  return <>
    <tr data-marker={marker} data-row-id={item.id}>
      <td className="obo-date">{item.date ? <time dateTime={item.date}>{dateLabel(item.date)}</time> : 'Datum saknas'}</td>
      <td className="obo-identity">
        <span className="obo-address obo-cell-text" title={item.address}>{item.address}</span>
        <span className="obo-mobile-only">{item.customer}</span>
        {item.city && <span className="obo-mobile-only obo-meta">{item.city}</span>}
        {item.attention.length > 0 && <ul className="obo-attention obo-mobile-only">{item.attention.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </td>
      <td className="obo-city obo-desktop-only"><span className="obo-cell-text" title={item.city}>{item.city || '-'}</span></td>
      <td className="obo-customer obo-desktop-only"><span className="obo-cell-text" title={item.customer}>{item.customer}</span></td>
      <td className="obo-state"><span className="obo-mobile-label">Bekräftelse</span><span className="obo-cell-text" title={item.confirmation}>{item.confirmation}</span></td>
      <td className="obo-state"><span className="obo-mobile-label">Utredning</span><span className="obo-cell-text">{item.investigationStatus}</span></td>
      <td className="obo-details-toggle obo-desktop-only">
        <button type="button" className="obo-icon obo-row-toggle" aria-label={detailsLabel} title={detailsLabel}
          aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} data-attention={item.attention.length > 0}
          onClick={() => setExpanded(value => !value)}>
          {item.attention.length ? <TriangleAlert size={18} aria-hidden /> : <ChevronDown size={18} aria-hidden />}
        </button>
      </td>
      <td className="obo-actions"><div className="obo-action-links">
        {item.investigationHref && <PendingLink href={item.investigationHref} className="obo-inspection-link" prefetch={false} autoPending pendingLabel="Öppnar utredning..."
          aria-label={`Öppna utredning: ${item.address}`} title="Öppna utredning" icon={<FileText size={18} aria-hidden />}>Öppna utredning</PendingLink>}
        {item.startAssignment && <button type="button" className="obo-inspection-link tu-start-investigation" disabled={busy}
          aria-label={`Starta utredning: ${item.address}`} title="Starta utredning" onClick={() => onStartAssignment(item.startAssignment!)}>
          <Play size={18} aria-hidden /><span>Starta utredning</span>
        </button>}
        {item.confirmationHref && <PendingLink href={item.confirmationHref} className="obo-confirmation-link" prefetch={false} autoPending pendingLabel="Öppnar bekräftelse..."
          aria-label={`Öppna uppdragsbekräftelse: ${item.address}`} title="Öppna uppdragsbekräftelse" icon={<FileCheck2 size={18} aria-hidden />}>Öppna bekräftelse</PendingLink>}
        {item.pdfHref && <a href={item.pdfHref} className="obo-pdf-link" target="_blank" rel="noopener noreferrer" aria-label={`Ladda ner PDF: ${item.address}`} title="Ladda ner PDF">
          <Download size={18} aria-hidden /><span>Ladda ner PDF</span>
        </a>}
      </div></td>
    </tr>
    {expanded && <tr className="obo-detail-row obo-desktop-only"><td colSpan={8}>
      <div id={detailsId} className="obo-row-details"><dl>
        <div><dt>Utredning</dt><dd>{item.title}</dd></div>
        <div><dt>Adress</dt><dd>{item.address}</dd></div>
        <div><dt>Ort</dt><dd>{item.city || '-'}</dd></div>
        <div><dt>Kund</dt><dd>{item.customer}</dd></div>
        <div><dt>Uppdragsbekräftelse</dt><dd>{item.confirmation}</dd></div>
        <div><dt>Utredningens status</dt><dd>{item.investigationStatus}</dd></div>
      </dl>
      {item.attention.length > 0 && <ul className="obo-attention">{item.attention.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      </div>
    </td></tr>}
  </>
}

export default function TuOverview({ organizationId, assignments, investigations, loading, error, busy, onRefresh, onStartAssignment }: {
  organizationId: string; assignments: TuAssignmentListItem[]; investigations: TuOverviewInvestigation[]
  loading: boolean; error: string | null; busy: boolean; onRefresh: () => void
  onStartAssignment: (assignment: TuAssignmentListItem) => void
}) {
  const heading = useId()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<TuOverviewFilter>('all')
  const [sort, setSort] = useState<TuOverviewSort>('date-desc')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [pageSize, setPageSize] = useState(10)
  const [page, setPage] = useState(1)
  const items = useMemo(() => buildTuOverviewItems({ organizationId, assignments, investigations }), [organizationId, assignments, investigations])
  const result = useMemo(() => selectTuOverviewPage(items, { search, filter, sort, attentionOnly, showArchived, page, pageSize }),
    [items, search, filter, sort, attentionOnly, showArchived, page, pageSize])
  const filtered = Boolean(search.trim() || filter !== 'all' || attentionOnly)
  const changeFilter = (value: TuOverviewFilter) => { setFilter(value); setPage(1) }
  const resetFilters = () => { setSearch(''); setFilter('all'); setAttentionOnly(false); setPage(1) }

  return <section className="obo tu-overview" aria-labelledby={heading} aria-busy={loading}>
    <div className="obo-heading">
      <h2 id={heading}>TU-uppdrag</h2>
      <button type="button" className="obo-icon" onClick={onRefresh} disabled={loading || busy} aria-label="Uppdatera uppdragslistan" title="Uppdatera uppdragslistan">
        <RefreshCw size={20} className={loading ? 'obo-spinning' : undefined} aria-hidden />
      </button>
    </div>
    <div className="obo-workspace">
      <div className="obo-toolbar">
        <div className="obo-search"><Search size={20} aria-hidden />
          <input type="search" aria-label="Sök uppdrag" title="Sök adress, kund, rubrik eller uppdragsnummer" placeholder="Sök uppdrag" maxLength={200}
            value={search} onChange={event => { setSearch(event.target.value); setPage(1) }} />
          {search && <button type="button" className="obo-icon" aria-label="Rensa sökning" title="Rensa sökning" onClick={() => { setSearch(''); setPage(1) }}><X size={18} aria-hidden /></button>}
        </div>
        <label className="obo-sort"><span>Sortering</span><select value={sort} onChange={event => { setSort(event.target.value as TuOverviewSort); setPage(1) }}>
          <option value="date-desc">Nyast först</option><option value="date-asc">Äldst först</option><option value="customer">Kund A–Ö</option><option value="address">Adress A–Ö</option>
        </select></label>
        <label className="obo-page-size"><span>Rader</span><select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1) }}>
          <option value="10">10</option><option value="25">25</option><option value="50">50</option>
        </select></label>
      </div>
      <div className="obo-filters">
        <div className="obo-filter-buttons" role="group" aria-label="Filtrera uppdrag">
          {filters.map(option => <button type="button" key={option.value} aria-pressed={filter === option.value} onClick={() => changeFilter(option.value)}>
            {option.label}<span>{result.counts[option.value]}</span>
          </button>)}
        </div>
        <label className="obo-filter-select"><span>Visa</span><select value={filter} onChange={event => changeFilter(event.target.value as TuOverviewFilter)}>
          {filters.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select></label>
        <label className="obo-check"><input type="checkbox" checked={attentionOnly} onChange={event => { setAttentionOnly(event.target.checked); setPage(1) }} />Kräver åtgärd</label>
        <label className="obo-check"><input type="checkbox" checked={showArchived} onChange={event => { setShowArchived(event.target.checked); setPage(1) }} />Visa arkiverade</label>
      </div>
      {error && <div className="obo-error" role="alert"><p>{error}</p><button type="button" onClick={onRefresh} disabled={loading || busy}>Försök igen</button></div>}
      {loading && <p className="obo-empty" role="status">Uppdaterar uppdragslistan...</p>}
      {!result.items.length && !loading && !error && <div className="obo-empty" role="status">
        <p>{filtered ? 'Inga uppdrag matchar dina val.' : 'Inga TU-uppdrag ännu.'}</p>
        {filtered && <button type="button" onClick={resetFilters}>Rensa filter</button>}
      </div>}
      {result.items.length > 0 && <table className="obo-table">
        <caption className="obo-sr">TU-uppdrag med separata statusar för uppdragsbekräftelse och utredning</caption>
        <thead><tr><th scope="col">Besiktningsdag</th><th scope="col">Adress</th><th scope="col">Ort</th><th scope="col">Kund</th>
          <th scope="col">Uppdragsbekräftelse</th><th scope="col">Utredning</th><th scope="col"><span className="obo-sr">Detaljer</span></th><th scope="col"><span className="obo-sr">Öppna</span></th>
        </tr></thead>
        <tbody>{result.items.map(item => <OverviewRow key={item.id} item={item} busy={busy || loading} onStartAssignment={onStartAssignment} />)}</tbody>
      </table>}
      <div className="obo-pagination">
        <span role="status" aria-live="polite">{result.total ? `${result.start + 1}–${result.start + result.items.length} av ${result.total} uppdrag` : '0 uppdrag'}</span>
        <nav aria-label="Sidbläddring uppdrag">
          <button type="button" className="obo-icon" aria-label="Föregående sida" title="Föregående sida" disabled={result.page === 1} onClick={() => setPage(result.page - 1)}><ChevronLeft size={20} aria-hidden /></button>
          <span>{result.page} / {result.pages}</span>
          <button type="button" className="obo-icon" aria-label="Nästa sida" title="Nästa sida" disabled={result.page >= result.pages} onClick={() => setPage(result.page + 1)}><ChevronRight size={20} aria-hidden /></button>
        </nav>
      </div>
    </div>
  </section>
}
