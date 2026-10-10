'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Trash2, Undo2 } from 'lucide-react'
import { money } from '@/lib/action-cases/customerOffers'
import { importableCustomerPrice } from '@/lib/action-cases/offerImport'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { abs18PaymentText, configurePaymentPlan, distributePaymentPlan, importPaymentPlanRows, paymentConditionsText, paymentPlanIssues, paymentPlanTotal, type CustomerPayment, type CustomerPaymentPlan, type PaymentConditions } from '@/lib/action-cases/customerPaymentPlan'
import PriceInput from './CustomerOfferPriceInput'
import ProjectEditorRow from './ProjectEditorRow'

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 disabled:opacity-40'
const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

export function PaymentPlanDocument({ plan, paymentTerms, conditions, showTerms = true }: {
  plan?: CustomerPaymentPlan | null; paymentTerms: string; conditions?: PaymentConditions; showTerms?: boolean
}) {
  return <div>
    {plan?.installments.length ? <>
      <ol className="divide-y divide-slate-200">
        {plan.installments.map((row, index) => <li key={row.id} className="break-inside-avoid py-5">
          <div className="flex flex-wrap justify-between gap-2 font-semibold">
            <h3 className="min-w-0 break-words text-base">{index + 1}. {row.title || 'Delbetalning'}{row.kind ? ` · ${row.kind === 'final' ? 10 : plan.automation!.initialPercent} %` : ''}</h3>
            <span>{row.amountOre === null ? 'Belopp saknas' : money(row.amountOre)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{row.condition || 'Faktureringsvillkor saknas'}</p>
          {row.plannedDate && <p className="mt-2 text-sm text-slate-600">Planerad fakturering: <time dateTime={row.plannedDate}>{row.plannedDate}</time></p>}
        </li>)}
      </ol>
      <div className="flex flex-wrap justify-between gap-2 border-y border-slate-200 py-4 text-sm font-semibold">
        <span>Summa inklusive moms</span><span>{money(paymentPlanTotal(plan))}</span>
      </div>
    </> : <p className="py-4 text-sm text-slate-600">Ingen uppdelad betalningsplan finns i denna avtalsversion.</p>}
    {showTerms && <div className="py-5">
      <h3 className="text-base font-semibold">Betalningsvillkor</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{paymentConditionsText(conditions, paymentTerms) || 'Ej angivet'}</p>
    </div>}
  </div>
}

export function PaymentPlanEditor({ plan, baseAmount, paymentTerms, conditions, priceMode, contractForm, sources = [], importBlocked = false, onChange, onTermsChange, onConditionsChange }: {
  plan?: CustomerPaymentPlan | null; baseAmount: number | null; paymentTerms: string
  conditions?: PaymentConditions; priceMode?: string; contractForm: 'abs18' | 'custom'
  sources?: ActionCaseItemView[]; importBlocked?: boolean
  onConditionsChange: (value: PaymentConditions) => void
  onChange: (plan: CustomerPaymentPlan | null) => void; onTermsChange: (text: string) => void
}) {
  const [removed, setRemoved] = useState<{ row: CustomerPayment; index: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [previousPlan, setPreviousPlan] = useState<CustomerPaymentPlan | null>(null)
  const [allocationError, setAllocationError] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [importError, setImportError] = useState('')
  const [paymentDaysInput, setPaymentDaysInput] = useState<string | null>(null)
  const available = sources.map((source) => ({ id: source.id, title: source.title, amountOre: importableCustomerPrice(source) }))
  const priced = available.filter((source) => source.amountOre !== null && source.amountOre > 0)
  const terms = conditions ?? { version: 1 as const, days: 30, standardText: contractForm === 'abs18' ? abs18PaymentText : '' }
  const canAutomate = baseAmount !== null && (!priceMode || priceMode === 'fixed')
  const finalEnabled = Boolean(plan?.automation && plan.automation.finalEnabled !== false)
  const total = plan ? paymentPlanTotal(plan) : 0
  const remaining = baseAmount === null ? null : baseAmount - total
  const issues = paymentPlanIssues(plan, baseAmount, priceMode)
  function replace(next: () => CustomerPaymentPlan) {
    try {
      const value = next()
      const previous = plan?.automation ? { ...plan, automation: { ...plan.automation, finalEnabled } } : plan
      setPreviousPlan(Boolean(plan?.automation) === Boolean(value.automation) ? previous ?? null : null)
      setRemoved(null)
      onChange(value); setAllocationError('')
    }
    catch { setAllocationError('Beloppet räcker inte till delbetalningarna. Kontrollera avtalets pris och procentfördelningen.') }
  }
  function update(id: string, patch: Partial<CustomerPayment>) {
    setPreviousPlan(null)
    if (plan) onChange({ ...plan, installments: plan.installments.map((r) => r.id === id ? { ...r, ...patch } : r) })
  }
  function move(index: number, delta: number) {
    if (!plan) return
    const rows = [...plan.installments], target = index + delta
    if (target < 0 || target >= rows.length || rows[index].kind || rows[target].kind) return
    ;[rows[index], rows[target]] = [rows[target], rows[index]]
    setPreviousPlan(null)
    onChange({ ...plan, installments: rows })
  }
  function add() {
    setPreviousPlan(null)
    const id = crypto.randomUUID()
    setExpanded(id)
    if (!plan && canAutomate) { replace(() => configurePaymentPlan(null, baseAmount)); setExpanded(null); return }
    const rows = [...(plan?.installments ?? [])]
    rows.splice(finalEnabled ? rows.length - 1 : rows.length, 0, { id, title: '', condition: '', amountOre: null, plannedDate: '' })
    onChange({ ...(plan ?? { version: 1 }), installments: rows })
  }
  return <div className="gizmo-payment-editor gizmo-editor-scroll-scope">
    <details className="border-b border-slate-200 py-3"><summary className="cursor-pointer text-sm font-semibold">Betalningsvillkor · {terms.days} dagar</summary>
      <div className="gizmo-payment-terms">
        <label className="block text-sm font-medium">Betalning inom (dagar)<input aria-label="Betalning inom (dagar)" type="number" min={1} max={365} step={1} className={field} value={paymentDaysInput ?? terms.days} onBlur={() => setPaymentDaysInput(null)} onChange={(e) => {
          setPaymentDaysInput(e.target.value)
          const days = e.target.valueAsNumber
          if (Number.isInteger(days) && days >= 1 && days <= 365) onConditionsChange({ ...terms, days })
        }} /></label>
        <label className="block min-w-0 text-sm font-medium">Avtalets betalningsvillkor<textarea aria-label="Avtalets betalningsvillkor" className={field} rows={4} maxLength={6000} value={terms.standardText} onChange={(e) => onConditionsChange({ ...terms, standardText: e.target.value })} /></label>
      </div>
      <label className="mt-3 block max-w-3xl text-sm font-medium">Övriga betalningsvillkor
        <textarea aria-label="Övriga betalningsvillkor" className={field} rows={2} maxLength={6000} value={paymentTerms} onChange={(e) => onTermsChange(e.target.value)} />
      </label>
    </details>
    <dl className="gizmo-payment-totals" aria-live="polite">
      {[['Grundavtal inkl. moms', baseAmount], ['Fördelat', total], [remaining !== null && remaining < 0 ? 'Överfördelat' : 'Kvar att fördela', remaining === null ? null : Math.abs(remaining)]].map(([label, value]) =>
        <div key={String(label)}><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold">{value === null ? 'Pris saknas' : money(Number(value))}</dd></div>)}
    </dl>
    <div className="flex flex-wrap items-center gap-3 py-3">
      <button type="button" className={button} disabled={importBlocked || !sources.length} onClick={() => { setImportOpen(!importOpen); setSelected([]); setImportError('') }}><Download size={16} /> Hämta från Projektarbete</button>
      {importBlocked && <span className="text-sm text-slate-600">Vänta tills Projektarbete har sparats.</span>}
    </div>
    {importOpen && <section aria-label="Hämta delbetalningar från Projektarbete" className="border-y border-slate-200 py-3">
      <p className="mb-3 text-sm">Valda moment ersätter alla vanliga delbetalningar, inklusive deras villkor och datum. Eventuell första- och slutbetalning behålls. Kundpriser hämtas inklusive moms utan omfördelning.</p>
      <label className="flex min-h-9 items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={priced.length > 0 && priced.every((row) => selected.includes(row.id))} disabled={importBlocked || !priced.length} onChange={(e) => setSelected(e.target.checked ? priced.map((row) => row.id) : [])} />Välj alla moment med kontrollerat pris</label>
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-200">
        {available.map((row) => <label key={row.id} className="flex min-h-11 items-center gap-3 py-2 text-sm">
          <input type="checkbox" aria-label={`Hämta ${row.title}`} checked={selected.includes(row.id)} disabled={importBlocked || row.amountOre === null || row.amountOre <= 0} onChange={(e) => setSelected(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} />
          <span className="min-w-0 flex-1 break-words">{row.title}</span><span className="shrink-0">{row.amountOre === null ? 'Pris ej kontrollerat' : money(row.amountOre)}</span>
        </label>)}
      </div>
      <p className="my-3 text-sm">Faktureringsvillkor och datum fylls i på de nya raderna. Avtalets pris ändras inte.</p>
      {importError && <p role="alert" className="my-2 text-sm text-red-700">{importError}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={importBlocked || !selected.length} onClick={() => {
          if (importBlocked) return
          try {
            const next = importPaymentPlanRows(plan, available, selected)
            setPreviousPlan(plan?.automation ? { ...plan, automation: { ...plan.automation, finalEnabled } } : plan ?? null)
            onChange(next); setRemoved(null); setExpanded(null); setAllocationError(''); setImportOpen(false)
          } catch { setImportError('Kunde inte hämta momenten. Välj moment med positiva, kontrollerade priser. Planen får innehålla högst 60 rader.') }
        }}><Download size={16} /> Hämta och ersätt delbetalningar ({selected.length})</button>
        <button type="button" className={button} onClick={() => setImportOpen(false)}>Avbryt</button>
      </div>
    </section>}
    {plan && <div className="gizmo-payment-settings">
      {!plan.automation ? <button type="button" className={button} disabled={!canAutomate || plan.installments.length >= 60} onClick={() => replace(() => configurePaymentPlan(plan, baseAmount))}>Reservera slutbetalning 10 %</button> : <>
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" aria-label="Första delbetalning i procent" checked={plan.automation.initialEnabled} disabled={!plan.automation.initialEnabled && (!canAutomate || plan.installments.length >= 60)} onChange={(e) => replace(() => configurePaymentPlan(plan, baseAmount, e.target.checked, plan.automation!.initialPercent ?? 10))} />Första delbetalning i procent</label>
        {plan.automation.initialEnabled && <div className="gizmo-payment-percent"><PriceInput label="Procent (%)" value={plan.automation.initialPercent === null ? null : Math.round(plan.automation.initialPercent * 100)} max={9000} onChange={(value) => replace(() => configurePaymentPlan(plan, baseAmount, true, value === null ? null : value / 100))} /></div>}
        <label className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" aria-label="Slutbetalning 10 %" checked={finalEnabled} disabled={!finalEnabled && (!canAutomate || plan.installments.length >= 60)} onChange={(e) => replace(() => configurePaymentPlan(plan, baseAmount, plan.automation!.initialEnabled, plan.automation!.initialPercent, e.target.checked))} />Slutbetalning 10 %</label>
      </>}
      <button type="button" className={button} disabled={!canAutomate || !plan.installments.some((r) => !r.kind)} onClick={() => replace(() => distributePaymentPlan(plan, baseAmount!))}>Anpassa till avtalets belopp</button>
      <button type="button" className={button} disabled={!canAutomate || !plan.installments.some((r) => !r.kind)} onClick={() => replace(() => distributePaymentPlan(plan, baseAmount!, true))}>Fördela jämnt</button>
      {previousPlan && <button type="button" className={iconButton} title="Ångra senaste import eller fördelning" aria-label="Ångra senaste import eller fördelning" onClick={() => { onChange(previousPlan); setPreviousPlan(null) }}><Undo2 size={16} /></button>}
    </div>}
    {allocationError && <p role="alert" className="my-3 text-sm text-red-700">{allocationError}</p>}
    {plan?.automation && plan.automation.allocationBaseOre !== baseAmount && <p role="alert" className="my-3 text-sm text-amber-800">Avtalspriset har ändrats. Anpassa delbetalningarna till det nya beloppet.</p>}
    {!plan ? <div className="py-6"><button className={button} onClick={add}><Plus size={17} /> Lägg upp betalningsplan</button></div> : <>
      <ol className="divide-y divide-slate-200">
        {plan.installments.map((row, index) => <li key={row.id}>
          <ProjectEditorRow title={`${index + 1}. ${row.title || 'Ny delbetalning'}`} amount={row.amountOre === null ? 'Belopp saknas' : money(row.amountOre)}
            summary={`${row.kind ? `${row.kind === 'final' ? 10 : plan.automation!.initialPercent ?? 'Ej angiven'} % · ` : ''}${row.plannedDate || 'Datum ej planerat'}${!row.condition.trim() ? ' · Faktureringsvillkor saknas' : ''}`}
            open={expanded === row.id} onToggle={() => setExpanded(expanded === row.id ? null : row.id)}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Delbetalning {index + 1}</h3>
            <div className="flex gap-2">
              <button className={iconButton} aria-label={`Flytta upp delbetalning ${index + 1}`} title="Flytta upp" disabled={index === 0 || Boolean(row.kind) || Boolean(plan.installments[index - 1]?.kind)} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
              <button className={iconButton} aria-label={`Flytta ned delbetalning ${index + 1}`} title="Flytta ned" disabled={index === plan.installments.length - 1 || Boolean(row.kind) || Boolean(plan.installments[index + 1]?.kind)} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
              <button className={iconButton} aria-label={`Ta bort delbetalning ${index + 1}`} title="Ta bort" onClick={() => {
                if (row.kind) replace(() => configurePaymentPlan(plan, baseAmount, row.kind === 'initial' ? false : plan.automation!.initialEnabled, plan.automation!.initialPercent, row.kind === 'final' ? false : finalEnabled))
                else { setPreviousPlan(null); setRemoved({ row, index }); onChange({ ...plan, installments: plan.installments.filter((r) => r.id !== row.id) }) }
                setExpanded(null)
              }}><Trash2 size={17} /></button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Rubrik *<input className={field} maxLength={250} value={row.title} onChange={(e) => update(row.id, { title: e.target.value })} /></label>
            {row.kind ? <div className="text-sm"><span>Automatiskt belopp inkl. moms</span><output aria-label="Automatiskt belopp inkl. moms" className="mt-2 block font-semibold">{money(row.amountOre)}</output></div> : <PriceInput label="Belopp inkl. moms (kr) *" value={row.amountOre} onChange={(amountOre) => update(row.id, { amountOre })} />}
            <label className="text-sm font-medium sm:col-span-2">Villkor för fakturering *<textarea className={field} rows={2} maxLength={6000} value={row.condition} onChange={(e) => update(row.id, { condition: e.target.value })} /></label>
            <label className="text-sm font-medium">Planerat faktureringsdatum (valfritt)<input className={field} type="date" min="0001-01-01" max="9999-12-31" value={row.plannedDate} onChange={(e) => { if (!e.target.value || e.target.validity.valid) update(row.id, { plannedDate: e.target.value }) }} onBlur={(e) => { if (e.target.reportValidity() && e.target.value !== row.plannedDate) update(row.id, { plannedDate: e.target.value }) }} /></label>
            {!row.kind && <div className="flex items-end">
              <button className={button} disabled={remaining === null || remaining + (row.amountOre ?? 0) <= 0 || remaining + (row.amountOre ?? 0) > 100_000_000_000} onClick={() => update(row.id, { amountOre: (remaining ?? 0) + (row.amountOre ?? 0) })}>Använd återstående belopp</button>
            </div>}
          </div>
          </ProjectEditorRow>
        </li>)}
      </ol>
      <div aria-label="Betalningsplanens summa" className="gizmo-payment-sum" role="status">
        <dl className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 font-semibold">
          <dt>{plan.installments.some((row) => row.amountOre === null) ? 'Summa angivna belopp inkl. moms' : 'Summa inkl. moms'}</dt>
          <dd className="whitespace-nowrap tabular-nums">{money(total)}</dd>
        </dl>
        <p className="mt-1 text-sm text-slate-600">{remaining === null ? 'Avtalets pris saknas' : remaining === 0 ? 'Stämmer med avtalets belopp' : `${remaining < 0 ? 'Överfördelat' : 'Kvar att fördela'}: ${money(Math.abs(remaining))}`}</p>
      </div>
      {removed && <div className="flex flex-wrap items-center gap-3 py-3 text-sm" role="status">Delbetalningen togs bort.
        <button className={button} disabled={plan.installments.length >= 60} onClick={() => {
          const rows = [...plan.installments]; rows.splice(Math.max(plan.automation?.initialEnabled ? 1 : 0, Math.min(removed.index, rows.length - (finalEnabled ? 1 : 0))), 0, removed.row)
          onChange({ ...plan, installments: rows }); setRemoved(null); setPreviousPlan(null)
        }}><Undo2 size={16} /> Ångra</button>
      </div>}
      <div className="flex flex-wrap gap-3 border-t border-slate-200 py-5">
        <button className={button} disabled={plan.installments.length >= 60} onClick={add}><Plus size={17} /> Lägg till delbetalning</button>
        <button className={button} onClick={() => setConfirmRemove(true)}><Trash2 size={17} /> Ta bort betalningsplan</button>
      </div>
      {confirmRemove && <div className="border-l-4 border-amber-500 p-4">
        <p className="text-sm">Ta bort alla delbetalningar från utkastet? Betalningsvillkoren och redan skickade versioner behålls.</p>
        <div className="mt-3 flex flex-wrap gap-3"><button className={button} onClick={() => { onChange(null); setConfirmRemove(false); setRemoved(null); setPreviousPlan(null) }}>Ta bort planen</button><button className={button} onClick={() => setConfirmRemove(false)}>Avbryt</button></div>
      </div>}
      {issues.length > 0 && <div className="border-l-4 border-amber-500 p-4 text-sm">
        <h3 className="font-semibold">Kvar innan avtalet kan skickas</h3><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </div>}
    </>}
  </div>
}
