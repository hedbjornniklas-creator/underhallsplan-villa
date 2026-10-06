'use client'

import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowRight, Plus, Search } from 'lucide-react'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import { projectNeeds, projectStatus, projectUrl } from '@/lib/action-cases/projectNavigation'
import PendingLink from '@/components/ui/PendingLink'

export default function ActionCaseProjectList({ cases, onCreate, pendingProjectId }: { cases: ActionCaseView[]; onCreate: () => void; pendingProjectId?: string }) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const [sort, setSort] = useState<'updated' | 'title'>('updated')
  const [page, setPage] = useState(0)
  const filtered = useMemo(() => cases.filter((item) => {
    const closed = ['completed', 'cancelled'].includes(item.status)
    return (filter === 'all' || (filter === 'closed' ? closed : !closed)) &&
      [item.title, item.customerName, item.propertyAddress].join(' ').toLocaleLowerCase('sv-SE').includes(search.trim().toLocaleLowerCase('sv-SE'))
  }).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'sv-SE') : b.updatedAt.localeCompare(a.updatedAt)), [cases, filter, search, sort])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1))
  const visible = filtered.slice(currentPage * 25, (currentPage + 1) * 25)
  return <section className="gizmo-project-list" aria-label="Projektlista">
    <div className="gizmo-list-toolbar">
      <label className="gizmo-search"><Search size={18} aria-hidden="true" /><span className="sr-only">Sök projekt, adress eller beställare</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} placeholder="Sök projekt, adress eller beställare" /></label>
      <label className="gizmo-filter"><span className="sr-only">Visa projekt</span><select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(0) }}><option value="active">Aktiva projekt</option><option value="closed">Avslutade projekt</option><option value="all">Alla projekt</option></select></label>
      <button className="gizmo-button gizmo-primary" disabled={Boolean(pendingProjectId)} onClick={onCreate}><Plus size={18} /> Nytt projekt</button>
    </div>
    <div className="gizmo-list-meta"><span role="status">{filtered.length} projekt</span><button onClick={() => { setSort(sort === 'updated' ? 'title' : 'updated'); setPage(0) }} className="gizmo-text-button">{sort === 'updated' ? <ArrowDown size={15} /> : <ArrowUp size={15} />}{sort === 'updated' ? 'Senast uppdaterade' : 'Projektnamn A–Ö'}</button></div>
    <div className="gizmo-project-columns" aria-hidden="true"><span>Projekt / objekt</span><span>Beställare</span><span>Status</span><span>Behöver hanteras</span><span /></div>
    <ul className="gizmo-project-rows">
      {visible.map((item) => <li key={item.id}><PendingLink autoPending prefetch={false} pending={pendingProjectId === item.id} disabled={Boolean(pendingProjectId)} className="gizmo-project-row" href={projectUrl(item.id)}>
        <span className="gizmo-project-name"><strong>{item.title}</strong><span>{item.propertyAddress}</span></span>
        <span><span className="gizmo-mobile-label">Beställare</span>{item.customerName}</span>
        <span><span className="gizmo-mobile-label">Status</span>{projectStatus[item.status]}</span>
        <span className="gizmo-project-needs"><span className="gizmo-project-idle"><span className="gizmo-mobile-label">Behöver hanteras</span>{projectNeeds(item)}</span><span className="gizmo-project-opening" role="status">Öppnar projekt…</span></span>
        <ArrowRight className="gizmo-row-arrow" size={18} aria-hidden="true" />
      </PendingLink></li>)}
    </ul>
    {!visible.length && <p className="gizmo-empty">{cases.length ? 'Inga projekt matchar din sökning och ditt filter.' : 'Inga projekt ännu.'}</p>}
    {filtered.length > 25 && <div className="gizmo-pagination"><button className="gizmo-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Föregående</button><span>Sida {currentPage + 1} av {Math.ceil(filtered.length / 25)}</span><button className="gizmo-button" disabled={(currentPage + 1) * 25 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Nästa</button></div>}
  </section>
}
