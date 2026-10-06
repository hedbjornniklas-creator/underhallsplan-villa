'use client'

import { useEffect, useState } from 'react'
import { ArrowDownToLine, ChevronDown, ChevronUp, Loader2, RefreshCw } from 'lucide-react'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { money, type CustomerOfferItem } from '@/lib/action-cases/customerOffers'
import { addOfferSources, offerSourceDifferences, offerSourceNeedsReview, prepareOfferSource, reviewOfferSource,
  type OfferSourceField, type PreparedOfferSource } from '@/lib/action-cases/offerImport'

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50'

export default function CustomerOfferSourcePicker({ sources, items, itemized, blocked, onChange, onReviewCountChange }: {
  sources: ActionCaseItemView[]
  items: CustomerOfferItem[]
  itemized: boolean
  blocked: boolean
  onChange: (items: CustomerOfferItem[]) => void
  onReviewCountChange: (count: number) => void
}) {
  const [prepared, setPrepared] = useState<{ sources: ActionCaseItemView[]; rows: PreparedOfferSource[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const [prices, setPrices] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)
  useEffect(() => {
    let cancelled = false
    Promise.all(sources.map(prepareOfferSource)).then((rows) => {
      if (!cancelled) { setPrepared({ sources, rows }); setFailed(false) }
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => { cancelled = true }
  }, [sources, retry])
  const loading = !failed && prepared?.sources !== sources
  const rows = prepared?.sources === sources ? prepared.rows : []
  const existing = new Map(items.map((item) => [item.id, item]))
  const available = rows.filter((row) => !existing.has(row.id))
  const changed = rows.filter((row) => existing.has(row.id) && offerSourceNeedsReview(row, existing.get(row.id)!, itemized))
  const reviewCount = failed ? -2 : loading ? -1 : changed.length
  useEffect(() => { onReviewCountChange(reviewCount) }, [onReviewCountChange, reviewCount])
  const visible = rows.filter((row) => showAll || !existing.has(row.id) || changed.includes(row) || open === row.id)
  const selectedRows = available.filter((row) => selected.includes(row.id))
  const disabled = blocked || loading || failed
  return <section aria-label="Underlag från Projektarbete" className="my-4 border-y border-slate-200">
    <div className="flex min-h-14 flex-wrap items-center justify-between gap-2 py-3">
      <div><h3 className="text-sm font-semibold">Från Projektarbete</h3>
        <p className="mt-1 text-sm text-slate-600" role="status">{blocked ? 'Spara klart Projektarbete innan du hämtar uppgifter.' : loading ? 'Kontrollerar underlag…' : failed ? 'Underlaget kunde inte jämföras.' : `${available.length} att lägga till · ${changed.length} att granska`}</p></div>
      {loading ? <Loader2 size={18} className="animate-spin" /> : failed ? <button className={button} onClick={() => { setFailed(false); setRetry(retry + 1) }}><RefreshCw size={16} /> Försök igen</button> : rows.length > available.length + changed.length && <button className={button} aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>{showAll ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{showAll ? 'Visa bara nya och ändrade' : 'Visa alla arbetsdelar'}</button>}
    </div>
    {available.length > 1 && <label className="flex min-h-11 items-center gap-3 border-t border-slate-200 text-sm">
      <input type="checkbox" disabled={disabled} checked={selectedRows.length === available.length}
        onChange={(event) => setSelected(event.target.checked ? available.map((row) => row.id) : [])} />Välj alla nya arbetsdelar
    </label>}
    {visible.map((row) => {
      const target = existing.get(row.id)
      const needsReview = target && offerSourceNeedsReview(row, target, itemized)
      return <div key={row.id} className="border-t border-slate-200">
        <div className="flex min-h-14 items-center gap-3 py-2">
          {!target && <input type="checkbox" disabled={disabled} checked={selected.includes(row.id)} aria-label={`Ta med ${row.values.title}`}
            onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />}
          <div className="min-w-0 flex-1"><p className="break-words text-sm font-semibold">{row.values.title}</p>
            <p className={`text-xs ${needsReview ? 'text-amber-700' : 'text-slate-600'}`}>{!target ? 'Inte i grundavtalet' : needsReview ? target.sourceReview ? 'Underlaget har ändrats' : 'Skiljer från Projektarbete' : offerSourceDifferences(row, target, itemized).length ? 'Avtalstexten behålls' : 'Samma uppgifter'}</p></div>
          <button className={button} disabled={disabled} aria-expanded={open === row.id} aria-label={`${target ? 'Jämför' : 'Visa'} ${row.values.title}`}
            onClick={() => setOpen(open === row.id ? null : row.id)}>{open === row.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}{target ? 'Jämför' : 'Visa'}</button>
        </div>
        {open === row.id && (target ? <SourceComparison key={JSON.stringify([row.fingerprints, target])} source={row} target={target} withPrice={itemized} disabled={disabled}
          onApply={(replacement) => { onChange(items.map((item) => item.id === row.id ? reviewOfferSource(item, row, replacement, itemized) : item)); setOpen(null) }} /> : <dl className="space-y-3 pb-4 text-sm">
          {Object.entries(row.values).filter(([key, value]) => key !== 'title' && key !== 'amountOre' && value).map(([key, value]) => <div key={key}><dt className="font-semibold">{{ scope: 'Arbetets omfattning', scopeConditions: 'Förutsättningar', scopeExclusions: 'Ingår inte', scopeAdvice: 'Avrådan' }[key]}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{value}</dd></div>)}
          {itemized && <div><dt className="font-semibold">Kontrollerat kundpris inkl. moms</dt><dd>{row.values.amountOre == null ? 'Saknas' : money(row.values.amountOre)}</dd></div>}
        </dl>)}
      </div>
    })}
    {available.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 py-3">
      {itemized && <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={prices} onChange={(event) => setPrices(event.target.checked)} />Ta med kontrollerade kundpriser inkl. moms</label>}
      {items.length + selectedRows.length > 200 && <p role="alert" className="text-sm text-amber-700">Grundavtalet kan innehålla högst 200 arbetsdelar.</p>}
      <button className={button} disabled={disabled || !selectedRows.length || items.length + selectedRows.length > 200} onClick={() => {
        onChange(addOfferSources(items, selectedRows, itemized && prices)); setSelected([]); setOpen(null)
      }}><ArrowDownToLine size={17} /> Lägg till i grundavtalet ({selectedRows.length})</button>
    </div>}
  </section>
}

function SourceComparison({ source, target, withPrice, disabled, onApply }: {
  source: PreparedOfferSource; target: CustomerOfferItem; withPrice: boolean; disabled: boolean; onApply: (replace: OfferSourceField[]) => void
}) {
  const changes = offerSourceDifferences(source, target, withPrice)
  const [replace, setReplace] = useState<OfferSourceField[]>([])
  const display = (key: OfferSourceField, value: string | number | null | undefined) => key === 'amountOre' ? value == null ? 'Inget kontrollerat kundpris' : money(Number(value)) : value || 'Tomt'
  return <div className="space-y-4 pb-4">
    {changes.length ? <>
      <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={disabled} checked={replace.length === changes.length}
        onChange={(event) => setReplace(event.target.checked ? changes.map(({ key }) => key) : [])} />Använd alla ändringar från Projektarbete</label>
      {changes.map(({ key, label }) => <div key={key} className="border-t border-slate-200 pt-3">
        <label className="flex min-h-11 items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={disabled} checked={replace.includes(key)}
          onChange={(event) => setReplace(event.target.checked ? [...replace, key] : replace.filter((field) => field !== key))} />{label}</label>
        <div className="grid gap-3 text-sm xl:grid-cols-2">
          <div className="min-w-0 border-l-2 border-slate-300 pl-3"><p className="mb-2 font-semibold text-slate-600">I avtalsutkastet</p><p className="whitespace-pre-wrap break-words">{display(key, target[key])}</p></div>
          <div className="min-w-0 border-l-2 border-amber-400 pl-3"><p className="mb-2 font-semibold text-slate-600">Från Projektarbete</p><p className="whitespace-pre-wrap break-words">{display(key, source.values[key])}</p></div>
        </div>
      </div>)}
    </> : <p className="text-sm text-slate-600">Samma uppgifter i Projektarbete och avtalsutkastet.</p>}
    <button className={button} disabled={disabled} onClick={() => onApply(replace)}><ArrowDownToLine size={17} />{replace.length ? `Uppdatera ${replace.length} fält i utkastet` : 'Behåll avtalstexten'}</button>
  </div>
}
