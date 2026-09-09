'use client'

import { useState } from 'react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import type { ActionCaseCostLineView } from '@/lib/action-cases/contracts'
import { normalizeCostLine } from '@/lib/action-cases/costing'

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-200'
const button = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const numericValue = (value: string) => value.trim() ? Number(value) : null

export const isHourlyWork = (line: ActionCaseCostLineView) => ['tim', 'h', 'timme', 'timmar'].includes(line.unit.trim().toLowerCase())
export const canEditDirectWork = (line: ActionCaseCostLineView) => ['own_labor', 'subcontractor'].includes(line.category) && line.pricingMethod !== 'quotes' && !line.selectedQuoteId && !line.coveredByQuoteId

export default function ActionCaseDirectCostFields({ line, expectedUpdatedAt, busy, onEditing, onSave }: {
  line: ActionCaseCostLineView
  expectedUpdatedAt: string
  busy: boolean
  onEditing: (editing: boolean) => void
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<{ quantity: string; unitCost: string; originalQuantity: string; originalUnitCost: string; expectedUpdatedAt: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const saved = { quantity: line.quantity?.toString() ?? '', unitCost: line.unitCost?.toString() ?? '', originalQuantity: line.quantity?.toString() ?? '', originalUnitCost: line.unitCost?.toString() ?? '', expectedUpdatedAt }
  const values = draft ?? saved
  const set = (key: 'quantity' | 'unitCost', value: string) => {
    const next = { ...values, [key]: value }
    const changed = numericValue(next.quantity) !== numericValue(next.originalQuantity) || numericValue(next.unitCost) !== numericValue(next.originalUnitCost)
    setDraft(changed ? next : null)
    onEditing(changed)
  }
  const cancel = () => { setDraft(null); onEditing(false) }
  let normalized: ReturnType<typeof normalizeCostLine> | null = null
  try {
    normalized = normalizeCostLine({ ...line, quantity: values.quantity, unitCost: values.unitCost, verified: false,
      quantityBasis: numericValue(values.quantity) === numericValue(values.originalQuantity) ? line.quantityBasis : values.quantity.trim() ? 'provided' : 'unknown' })
  } catch { /* Invalid drafts stay local until corrected. */ }
  const locked = busy || saving || !canEditDirectWork(line)
  const hourly = isHourlyWork(line)
  return <form aria-label={`Egen kalkyl för ${line.description}`} className="mt-3 flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => {
    event.preventDefault()
    if (locked || !draft || !normalized) return
    setSaving(true)
    void onSave({ operation: 'bulk_update', costLineIds: [line.id], expectedUpdatedAt: draft.expectedUpdatedAt,
      ...(numericValue(draft.quantity) !== numericValue(draft.originalQuantity) ? { quantity: normalized.quantity } : {}),
      ...(numericValue(draft.unitCost) !== numericValue(draft.originalUnitCost) ? { unitCost: normalized.unitCost } : {}),
    })
      .then((ok) => { if (ok) cancel() }).finally(() => setSaving(false))
  }}>
    <fieldset disabled={locked} className="grid min-w-0 flex-1 basis-56 grid-cols-2 gap-2">
      <label className="min-w-0 text-xs font-semibold text-slate-600">{hourly ? 'Timmar' : `Mängd (${line.unit})`}<input aria-label={`${hourly ? 'Timmar' : 'Mängd'} för ${line.description}`} className={input} type="number" min="0.001" max="99999999999.999" step="any" value={values.quantity} onChange={(event) => set('quantity', event.target.value)} /></label>
      <label className="min-w-0 text-xs font-semibold text-slate-600">{hourly ? 'Timkostnad, kr' : 'Kostnad/enhet, kr'}<input aria-label={`${hourly ? 'Timkostnad' : 'Enhetskostnad'} för ${line.description}`} className={input} type="number" min="0" max="999999999999.99" step="any" value={values.unitCost} onChange={(event) => set('unitCost', event.target.value)} /></label>
    </fieldset>
    <button className={button} type="submit" disabled={locked || !draft || !normalized} title="Spara mängd och kostnad" aria-label={`Spara egen kalkyl för ${line.description}`}>{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Spara</button>
    {draft ? <button className={`${button} px-0`} type="button" disabled={busy || saving} title="Återställ osparade värden" aria-label={`Återställ egen kalkyl för ${line.description}`} onClick={cancel}><RotateCcw size={16} /></button> : null}
    {draft ? <p role="status" className="basis-full text-xs text-amber-800">{!canEditDirectWork(line) ? 'Raden har ändrats och kan inte längre prissättas direkt.' : !normalized ? 'Ange en positiv mängd och en kostnad på minst 0 kr, eller lämna fältet tomt.' : 'Osparad egen kalkyl'}</p> : null}
  </form>
}
