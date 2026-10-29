'use client'

import { useState } from 'react'
import { Pencil, Save, X } from 'lucide-react'
import type { ContractWorkLink } from '@/lib/action-cases/contractWork'
import PriceInput from './CustomerOfferPriceInput'

export default function ActionCaseContractPrice({ link, busy, onSave, onDirty }: {
  link: ContractWorkLink; busy: boolean
  onSave: (price: ContractWorkLink['price']) => Promise<boolean>; onDirty: (dirty: boolean) => void
}) {
  const [editing, setEditing] = useState(false)
  const [price, setPrice] = useState(link.price)
  const close = () => { setEditing(false); onDirty(false) }
  const button = 'gizmo-button inline-flex items-center gap-2 disabled:opacity-40'
  return <section className="mb-4 border-b border-[#D5DCDD] pb-4" aria-label="Avtalat kundpris">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Avtalat kundpris inkl. moms</h3>
      <strong>{link.price.amountOre === null ? link.price.editable ? 'Pris inte angivet' : 'Se avtalets prisvillkor' : new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(link.price.amountOre / 100)}</strong>
      {!link.locked && link.price.editable && !editing && <button type="button" className={button} disabled={busy} title="Ändra avtalat kundpris" aria-label="Ändra avtalat kundpris" onClick={() => { setPrice(link.price); setEditing(true); onDirty(true) }}><Pencil size={16} /></button>}
    </div>
    {editing && <form className="mt-3 space-y-3" onSubmit={async event => { event.preventDefault(); if (!busy && !link.locked && await onSave(price)) close() }}>
      <fieldset disabled={busy || link.locked} className="grid gap-3 sm:grid-cols-2">
        {price.split === 'combined' ? <PriceInput label="Momentets pris inkl. moms (kr)" value={price.amountOre} onChange={amountOre => setPrice(current => ({ ...current, amountOre }))} /> : <>
          <PriceInput label="Arbete inkl. moms (kr)" value={price.labourOre} onChange={labourOre => setPrice(current => ({ ...current, labourOre }))} />
          <PriceInput label="Material inkl. moms (kr)" value={price.materialOre} onChange={materialOre => setPrice(current => ({ ...current, materialOre }))} />
        </>}
      </fieldset>
      <p className="text-sm text-slate-600">Ändringen gäller även Avtal. Den interna kalkylen nedan ändras inte.</p>
      <div className="flex gap-2"><button type="submit" className={button} disabled={busy || link.locked}><Save size={16} />Spara avtalat pris</button><button type="button" className={button} disabled={busy} onClick={close}><X size={16} />Avbryt</button></div>
    </form>}
  </section>
}
