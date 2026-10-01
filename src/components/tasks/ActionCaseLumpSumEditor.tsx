'use client'
import { useEffect, useState } from 'react'
import { Save } from 'lucide-react'
import type { ActionLumpSum } from '@/lib/action-cases/lumpSum'
import PriceInput from './CustomerOfferPriceInput'

export default function ActionCaseLumpSumEditor({ value, busy, onSave, onDirty }: {
  value: ActionLumpSum | null
  busy: boolean
  onSave: (value: ActionLumpSum | null) => Promise<boolean>
  onDirty: (dirty: boolean) => void
}) {
  const [enabled, setEnabled] = useState(Boolean(value))
  const [draft, setDraft] = useState<ActionLumpSum>(value ?? { internalCost: null, customerPrice: null, vatRate: 25, verified: false })
  const dirty = JSON.stringify(enabled ? draft : null) !== JSON.stringify(value)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  return <fieldset disabled={busy} className="mb-5 space-y-4 border-b border-slate-200 pb-5">
    <label className="block text-sm font-semibold">Prisunderlag<select className="mt-2 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3" value={enabled ? 'total' : 'detailed'} onChange={(e) => setEnabled(e.target.value === 'total')}>
      <option value="detailed">Detaljerad kalkyl</option><option value="total">Samlat pris för åtgärden</option>
    </select></label>
    {enabled && <>
      <p className="text-sm text-slate-600">Omfattar hela åtgärden, inklusive arbete och material. Befintliga kalkylrader bevaras men läggs inte ovanpå priset.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <PriceInput label="Kundpris exkl. moms (kr) *" value={draft.customerPrice === null ? null : Math.round(draft.customerPrice * 100)} onChange={(value) => setDraft({ ...draft, customerPrice: value === null ? null : value / 100, verified: false })} />
        <PriceInput label="Intern kostnad exkl. moms (kr, valfri)" value={draft.internalCost === null ? null : Math.round(draft.internalCost * 100)} onChange={(value) => setDraft({ ...draft, internalCost: value === null ? null : value / 100, verified: false })} />
      </div>
      <label className="block text-sm">Moms<select value={draft.vatRate} className="ml-3 min-h-11 rounded-md border border-slate-300 px-3" onChange={(e) => setDraft({ ...draft, vatRate: Number(e.target.value), verified: false })}>{[25, 12, 6, 0].map((v) => <option key={v} value={v}>{v} %</option>)}</select></label>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" disabled={draft.customerPrice === null} checked={draft.verified} onChange={(e) => setDraft({ ...draft, verified: e.target.checked })} />Jag har kontrollerat priset mot hela omfattningen</label>
    </>}
    {dirty && <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white disabled:opacity-40" onClick={() => void onSave(enabled ? draft : null)}><Save size={17} /> Spara prisunderlag</button>}
  </fieldset>
}
