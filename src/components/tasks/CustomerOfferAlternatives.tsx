'use client'

import { useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import ProjectEditorRow from './ProjectEditorRow'
import PriceInput from './CustomerOfferPriceInput'
import { money, type CustomerOfferSnapshot } from '@/lib/action-cases/customerOffers'
import type { OfferAlternatives } from '@/lib/action-cases/offerAlternatives'
import { paymentConditionsText } from '@/lib/action-cases/customerPaymentPlan'

const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-50'

export default function CustomerOfferAlternatives({ value, onChange }: { value: OfferAlternatives; onChange: (value: OfferAlternatives) => void }) {
  const [open, setOpen] = useState<'work' | 'price' | null>('work')
  const [remove, setRemove] = useState<string | null>(null)
  const patch = (id: string, patch: Partial<OfferAlternatives['parts'][number]>) => onChange({ ...value, parts: value.parts.map(part => part.id === id ? { ...part, ...patch } : part) })
  return <>
    <ProjectEditorRow title="Arbeten" summary={`${value.parts.length} valbara offertdelar`} open={open === 'work'} onToggle={() => setOpen(open === 'work' ? null : 'work')}>
      <label className="block max-w-56 text-sm">Offertdatum<input type="date" aria-label="Offertdatum" className={field} value={value.issuedOn} onChange={event => onChange({ ...value, issuedOn: event.target.value })} /></label>
      {value.parts.map((part, index) => <div key={part.id} className="mt-4 border-t border-slate-200 pt-3">
        <div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">Rubrik<input aria-label={`Offertdel ${index + 1}: Rubrik`} maxLength={250} className={field} value={part.title} onChange={event => patch(part.id, { title: event.target.value })} /></label>
          <button type="button" className={button} title="Ta bort offertdel" aria-label={`Ta bort offertdel ${index + 1}`} onClick={() => setRemove(part.id)}><Trash2 size={16} /></button></div>
        <label className="mt-3 block text-sm">Omfattning<textarea aria-label={`Offertdel ${index + 1}: Omfattning`} maxLength={6000} rows={4} className={field} value={part.scope} onChange={event => patch(part.id, { scope: event.target.value })} /></label>
        {remove === part.id && <div role="alert" className="mt-3 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm"><p>Ta bort {part.title || 'offertdelen'} från utkastet? Kontrollera också hänvisningarna i beställningsvillkoren.</p><div className="mt-2 flex gap-2"><button type="button" className={button} onClick={() => { onChange({ ...value, parts: value.parts.filter(row => row.id !== part.id) }); setRemove(null) }}><Trash2 size={16} />Ta bort</button><button type="button" className={button} onClick={() => setRemove(null)}>Avbryt</button></div></div>}
      </div>)}
      <button type="button" className={`${button} mt-4`} disabled={value.parts.length >= 50} onClick={() => onChange({ ...value, parts: [...value.parts, { id: crypto.randomUUID(), title: '', scope: '', amountExVatOre: null }] })}><Plus size={16} />Lägg till offertdel</button>
    </ProjectEditorRow>
    <ProjectEditorRow title="Priser" summary="Fasta delpriser exklusive moms" open={open === 'price'} onToggle={() => setOpen(open === 'price' ? null : 'price')}>
      {value.parts.map((part, index) => <div key={part.id} className="grid gap-2 border-b border-slate-200 py-3 sm:grid-cols-[minmax(0,1fr)_14rem]"><span className="min-w-0 self-center text-sm font-semibold">{part.title || 'Namnlös offertdel'}</span><PriceInput label={`Offertdel ${index + 1}: Fast pris exkl. moms (kr)`} value={part.amountExVatOre} onChange={amountExVatOre => patch(part.id, { amountExVatOre })} /></div>)}
      <label className="mt-4 block text-sm">Villkor för val och sammanräkning<textarea aria-label="Villkor för val och sammanräkning" className={field} maxLength={6000} rows={4} value={value.selectionTerms} onChange={event => onChange({ ...value, selectionTerms: event.target.value })} /></label>
    </ProjectEditorRow>
  </>
}

export function OfferAlternativesDocument({ snapshot: s }: { snapshot: CustomerOfferSnapshot }) {
  const value = s.offerAlternatives
  if (!value) return null
  const sections = [
    ['Tid', s.schedule], ['Betalningsvillkor', paymentConditionsText(s.paymentConditions, s.paymentTerms)],
    ['Ändringar och tilläggsarbeten (ÄTA)', s.contractDetails?.fields.changes.text || ''], ['Beställning', s.terms],
  ]
  return <>
    <section className="border-b border-slate-200 py-5"><h3 className="text-lg font-semibold">Arbeten</h3>{value.issuedOn && <p className="mt-2 text-sm">Offertdatum: {value.issuedOn}</p>}{value.parts.map(part => <div key={part.id} className="mt-4"><h4 className="font-semibold">{part.title}</h4><p className="mt-2 whitespace-pre-wrap leading-6">{part.scope}</p></div>)}</section>
    <section className="border-b border-slate-200 py-5"><h3 className="text-lg font-semibold">Priser</h3><p className="mt-2 text-sm">Fasta priser exklusive moms.</p>{value.parts.map(part => <div key={part.id} className="flex flex-wrap justify-between gap-3 border-b border-slate-200 py-3"><span>{part.title}</span><strong>{money(part.amountExVatOre)}</strong></div>)}<p className="mt-3 whitespace-pre-wrap leading-6">{value.selectionTerms}</p></section>
    {sections.map(([title, text]) => text && <section key={title} className="border-b border-slate-200 py-5"><h3 className="text-lg font-semibold">{title}</h3><p className="mt-3 whitespace-pre-wrap leading-6">{text}</p></section>)}
  </>
}
