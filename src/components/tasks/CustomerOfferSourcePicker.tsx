'use client'

import { useEffect, useId, useState } from 'react'
import { ArrowDownToLine, ChevronUp, Loader2, RefreshCw } from 'lucide-react'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import type { CustomerOfferItem } from '@/lib/action-cases/customerOffers'
import { importOfferSources, offerSourceTargets, prepareOfferSource, type PreparedOfferSource } from '@/lib/action-cases/offerImport'

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50'

export default function CustomerOfferSourcePicker({ sources, items, itemized, blocked, collapsible = false, onChange }: {
  sources: ActionCaseItemView[]
  items: CustomerOfferItem[]
  itemized: boolean
  blocked: boolean
  collapsible?: boolean
  onChange: (items: CustomerOfferItem[]) => void
}) {
  const contentId = useId()
  const [expanded, setExpanded] = useState(!collapsible)
  const [prepared, setPrepared] = useState<{ sources: ActionCaseItemView[]; rows: PreparedOfferSource[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [replacements, setReplacements] = useState<Record<string, string | null>>({})
  const [prices, setPrices] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.all(sources.map(prepareOfferSource)).then((rows) => {
      if (!cancelled) { setPrepared({ sources, rows }); setFailed(false) }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [sources, retry])
  const loading = !failed && prepared?.sources !== sources
  const rows = prepared?.sources === sources ? prepared.rows : []
  const targets = offerSourceTargets(items, rows)
  const reserved = new Set([...targets.values()])
  const legacy = items.filter((item) => item.kind === 'included' && !item.sourceItemId && !reserved.has(item.id))
  const selectedRows = rows.filter((row) => selected.includes(row.id))
  const selections = selectedRows.map((row) => ({ sourceId: row.id, targetId: targets.get(row.id) === undefined ? replacements[row.id] : targets.get(row.id) }))
  const unresolved = selections.some((selection) => selection.targetId === undefined)
  const targetIds = selections.flatMap((selection) => selection.targetId ? [selection.targetId] : [])
  const duplicate = new Set(targetIds).size !== targetIds.length
  const tooMany = items.length + selections.filter((selection) => selection.targetId === null).length > 200
  const disabled = blocked || loading || failed
  return <section aria-label="Underlag från Projektarbete" className="my-4 border-y border-slate-200">
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-2">
      <h3 className="text-sm font-semibold">Från Projektarbete</h3>
      {loading ? <Loader2 size={18} className="animate-spin" aria-label="Hämtar arbetsdelar" /> : failed ? <button type="button" className={button} onClick={() => { setFailed(false); setRetry(retry + 1) }}><RefreshCw size={16} /> Försök igen</button> : null}
      {collapsible && <button type="button" className={button} disabled={blocked} aria-expanded={expanded} aria-controls={contentId} onClick={() => setExpanded(!expanded)}>
        {expanded ? <ChevronUp size={16} /> : <ArrowDownToLine size={16} />}{expanded ? 'Stäng' : 'Hämta från projektdata'}
      </button>}
    </div>
    <div id={contentId} hidden={!expanded}>
      {failed && <p role="alert" className="py-2 text-sm text-red-700">Arbetsdelarna kunde inte hämtas. Försök igen.</p>}
      {blocked && <p role="status" className="py-2 text-sm text-slate-600">Import är inte tillgänglig medan ändringar sparas eller avtalet är låst.</p>}
      {!loading && !failed && !rows.length && <p className="py-3 text-sm text-slate-600">Inga arbetsdelar i Projektarbete.</p>}
      {rows.length > 0 && <>
        <label className="flex min-h-11 items-center gap-3 border-t border-slate-200 bg-[#EDF1F1] px-3 text-sm font-semibold">
          <input type="checkbox" disabled={disabled} checked={selectedRows.length === rows.length}
            onChange={(event) => setSelected(event.target.checked ? rows.map((row) => row.id) : [])} />Välj alla arbetsdelar
        </label>
        {rows.map((row) => <div key={row.id} className="flex min-h-14 flex-wrap items-center gap-x-4 border-t border-slate-200 px-3 py-1 hover:bg-[#F6F8F8]">
          <label className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-sm font-semibold">
            <input type="checkbox" disabled={disabled} checked={selected.includes(row.id)} aria-label={`Hämta ${row.values.title}`}
              onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
            <span className="break-words">{row.values.title}</span>
          </label>
          {targets.get(row.id) === undefined && selected.includes(row.id) && <select
            className="min-h-11 w-full min-w-0 max-w-full rounded-md border border-slate-300 px-2 text-sm sm:w-72"
            disabled={disabled} aria-label={`Ersätt arbetsdel för ${row.values.title}`}
            value={replacements[row.id] === null ? 'new' : replacements[row.id] ?? ''}
            onChange={(event) => setReplacements((current) => {
              const next = { ...current }
              if (!event.target.value) delete next[row.id]
              else next[row.id] = event.target.value === 'new' ? null : event.target.value
              return next
            })}>
            <option value="">Välj vilken arbetsdel som ersätts…</option>
            <option value="new">Lägg till som ny arbetsdel</option>
            {legacy.map((item) => <option key={item.id} value={item.id}>Ersätt: {item.title}</option>)}
          </select>}
        </div>)}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 py-3">
          {itemized && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={prices} onChange={(event) => setPrices(event.target.checked)} />Hämta även kontrollerade kundpriser inkl. moms</label>}
          {duplicate && <p role="alert" className="text-sm text-amber-700">Två valda delar kan inte ersätta samma arbetsdel.</p>}
          {tooMany && <p role="alert" className="text-sm text-amber-700">Grundavtalet kan innehålla högst 200 arbetsdelar.</p>}
          <button type="button" className={`${button} bg-[#252A2D] text-white`} disabled={disabled || !selectedRows.length || unresolved || duplicate || tooMany} onClick={() => {
            onChange(importOfferSources(items, rows, selections, itemized && prices))
            setSelected([]); setReplacements({}); setExpanded(!collapsible)
          }}><ArrowDownToLine size={17} /> Hämta och ersätt ({selectedRows.length})</button>
        </div>
      </>}
    </div>
  </section>
}
