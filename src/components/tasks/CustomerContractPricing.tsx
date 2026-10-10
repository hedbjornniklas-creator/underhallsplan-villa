'use client'

import { useId, useState } from 'react'
import { Download, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { importableCustomerPrice } from '@/lib/action-cases/offerImport'
import { contractFixedAmount, contractFixedRows, contractRowAmount, importContractPrices, type ContractPricing, type ContractPriceRow } from '@/lib/action-cases/contractPricing'
import { money } from '@/lib/action-cases/customerOffers'
import PriceInput from './CustomerOfferPriceInput'

const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
const modeLabels = { fixed: 'Fast pris', running: 'Löpande räkning', mixed: 'Fast + löpande' }
function Modes<T extends string>({ title, value, choices, onChange }: { title: string; value: T; choices: readonly { value: T; label: string }[]; onChange: (value: T) => void }) {
  const name = useId()
  return <fieldset className="min-w-0"><legend className="mb-2 text-sm font-medium">{title}</legend><div className="gizmo-price-modes">
    {choices.map((choice) => <label key={choice.value} className={value === choice.value ? 'selected' : ''}>
      <input type="radio" name={name} checked={value === choice.value} onChange={() => onChange(choice.value)} />{choice.label}
    </label>)}
  </div></fieldset>
}
export default function CustomerContractPricing({ value, sources, blocked, importBlocked, onChange }: {
  value: ContractPricing; sources: ActionCaseItemView[]; blocked: boolean; importBlocked: boolean; onChange: (value: ContractPricing) => void
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editHiddenRows, setEditHiddenRows] = useState(false)
  const [picker, setPicker] = useState(false), [selected, setSelected] = useState<string[]>([])
  const [importError, setImportError] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null), [switchBasis, setSwitchBasis] = useState<'rows' | 'priced' | null>(null)
  const available = sources.map((row) => ({ id: row.id, title: row.title, amountOre: importableCustomerPrice(row) }))
  const priced = available.filter((row) => row.amountOre !== null)
  const total = contractFixedAmount(value)
  const isRunning = (row: ContractPriceRow) => value.mode === 'running' || (value.mode === 'mixed' && row.kind === 'running')
  const showPrices = value.mode !== 'running' && value.basis === 'rows' && (value.display === 'priced' || editHiddenRows)
  const showSplit = showPrices && value.split === 'separate'
  const showPriceColumn = showPrices || value.mode !== 'fixed'
  const visibleRows = value.rows.filter((row) => isRunning(row) || value.display !== 'total' || editHiddenRows)
  const fixed = contractFixedRows(value)
  const splitAmount = (key: 'labourOre' | 'materialOre') => value.basis === 'total' ? value[key] :
    !fixed.length || fixed.some((row) => row[key] === null) ? null : fixed.reduce((sum, row) => sum + row[key]!, 0)
  const patch = (values: Partial<ContractPricing>) => { if (!blocked) onChange({ ...value, ...values }) }
  const patchRow = (id: string, values: Partial<ContractPriceRow>) => patch({ rows: value.rows.map((row) => {
    if (row.id !== id) return row
    const next = { ...row, ...values }
    if (value.split === 'combined' && values.amountOre !== undefined) { next.labourOre = null; next.materialOre = null }
    if (value.split === 'separate' && next.labourOre !== null && next.materialOre !== null) next.amountOre = next.labourOre + next.materialOre
    return next
  }) })
  const running = (values: Partial<ContractPricing['running']>) => patch({ running: { ...value.running, ...values } })
  const splitTotal = (values: Partial<ContractPricing>) => {
    const next = { ...value, ...values }
    patch({ ...values, totalOre: next.labourOre === null || next.materialOre === null ? null : next.labourOre + next.materialOre })
  }
  return <fieldset disabled={blocked} className="gizmo-contract-pricing min-w-0 space-y-6" aria-label="Avtalets pris">
    <Modes title="Prisform" value={value.mode} choices={Object.entries(modeLabels).map(([key, label]) => ({ value: key as ContractPricing['mode'], label }))} onChange={(mode) => { patch({ mode }); setSwitchBasis(null); setEditHiddenRows(false); setExpanded(null) }} />
    {value.mode !== 'running' && <section className="gizmo-price-settings" aria-label="Prisets redovisning och beräkning">
      <Modes title="Redovisning i avtalet" value={value.display} choices={[{ value: 'priced', label: 'Delmoment med pris + totalsumma' }, { value: 'unpriced', label: 'Delmoment utan pris + totalsumma' }, { value: 'total', label: 'Enbart totalsumma' }]}
        onChange={(display) => {
          setEditHiddenRows(false); setExpanded(null); setSwitchBasis(null)
          if (display === 'priced' && value.basis === 'total' && total !== null) { setSwitchBasis('priced'); return }
          patch({ display, ...(display === 'priced' ? { basis: 'rows' as const } : {}) })
        }} />
      <div className="gizmo-price-settings-grid">
        <Modes title="Arbete och material" value={value.split} choices={[{ value: 'combined', label: 'Tillsammans' }, { value: 'separate', label: 'Separat' }]} onChange={(split) => patch({ split })} />
        {value.display !== 'priced' && <Modes title="Beräkna fast pris" value={value.basis} choices={[{ value: 'rows', label: 'Summan av raderna' }, { value: 'total', label: 'Manuell klumpsumma' }]} onChange={(basis) => {
          setSwitchBasis(null)
          if (basis === 'rows' && value.basis === 'total' && total !== null) { setSwitchBasis('rows'); return }
          patch({ basis, ...(basis === 'total' ? { totalOre: total,
            labourOre: fixed.every((row) => row.labourOre !== null) && fixed.length > 0 ? splitAmount('labourOre') : null,
            materialOre: fixed.every((row) => row.materialOre !== null) && fixed.length > 0 ? splitAmount('materialOre') : null } : {}) })
        }} />}
      </div>
      {switchBasis && <div role="alert" className="border-l-2 border-[#206961] pl-3 text-sm">Klumpsumman {money(total)} ersätts av summan av prisraderna. Beloppet fördelas inte automatiskt.
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="gizmo-button" onClick={() => { patch({ basis: 'rows', ...(switchBasis === 'priced' ? { display: 'priced' } : {}) }); setSwitchBasis(null) }}>Använd prisraderna</button><button type="button" className="gizmo-button" onClick={() => setSwitchBasis(null)}>Avbryt</button></div></div>}
    </section>}
    <section aria-label="Avtalets priser">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">{value.mode === 'running' ? 'Moment på löpande räkning' : 'Avtalets priser'}</h3><div className="flex flex-wrap gap-2">
        <button type="button" className="gizmo-button" disabled={blocked || importBlocked} onClick={() => { setPicker(!picker); setSelected([]); setImportError('') }}><Download size={17} />Hämta från Projektarbete</button>
        <button type="button" className="gizmo-button" disabled={value.rows.length >= 200} onClick={() => {
          const id = crypto.randomUUID(); patch({ rows: [...value.rows, { id, title: '', kind: value.mode === 'running' ? 'running' : 'fixed', amountOre: null, labourOre: null, materialOre: null }] }); setExpanded(id); setEditHiddenRows(value.display === 'total')
        }}><Plus size={17} />Lägg till</button>
        {value.mode !== 'running' && value.display === 'total' && value.rows.some((row) => !isRunning(row)) && <button type="button" className="gizmo-button" aria-expanded={editHiddenRows} onClick={() => { setEditHiddenRows(!editHiddenRows); setExpanded(null) }}><Pencil size={17} />{editHiddenRows ? 'Dölj delmoment' : `Redigera delmoment (${fixed.length})`}</button>}
      </div></div>
      {picker && <section className="mb-4 border-y border-[#D5DCDD]" aria-label="Hämta projektpriser">
        <label className="flex min-h-12 items-center gap-3 bg-[#EDF1F1] px-3 text-sm font-semibold"><input type="checkbox" disabled={blocked || importBlocked || !priced.length} checked={priced.length > 0 && selected.length === priced.length}
          onChange={(e) => setSelected(e.target.checked ? priced.map((row) => row.id) : [])} />Välj alla kontrollerade kundpriser</label>
        {!available.length && <p className="py-3 text-sm">Inga moment i Projektarbete.</p>}
        {available.map((row) => <label key={row.id} className="flex min-h-14 items-center gap-3 border-t border-[#D5DCDD] px-3 text-sm">
          <input type="checkbox" disabled={blocked || importBlocked || row.amountOre === null} checked={selected.includes(row.id)} aria-label={`Hämta pris för ${row.title}`}
            onChange={(e) => setSelected(e.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} /><span className="min-w-0 flex-1 break-words font-semibold">{row.title}</span><span>{row.amountOre === null ? 'Pris ej kontrollerat' : money(row.amountOre)}</span>
        </label>)}
        <p className="py-3 text-sm text-[#596368]">Valda prisrader ersätts. Beloppen hämtas som arbete och material tillsammans; summan beräknas från raderna. Avtalets omfattningstexter ändras inte.</p>
        {importError && <p role="alert" className="mb-3 text-sm text-[#A52E42]">{importError}</p>}
        <button type="button" className="gizmo-button gizmo-button-primary mb-3" disabled={blocked || importBlocked || !selected.length || selected.some((id) => !priced.some((row) => row.id === id))} onClick={() => {
          if (blocked || importBlocked) return
          try { onChange(importContractPrices(value, available, selected)); setPicker(false); setSelected([]); setImportError('') }
          catch (error) { setImportError(error instanceof Error && error.message === 'CUSTOMER_CONTRACT_PRICE_AMBIGUOUS'
            ? 'Flera prisrader har samma namn och kan inte kopplas entydigt. Importen avbröts; befintliga priser är kvar.'
            : 'Priserna kunde inte hämtas. Kontrollera radantal och belopp. Befintliga priser är kvar.') }
        }}><Download size={17} />Hämta och ersätt valda priser ({selected.length})</button>
      </section>}
      <div className="gizmo-price-table" role="table" aria-label="Prisrader" data-columns={showSplit ? 'split' : showPriceColumn ? 'priced' : 'unpriced'}>
        {visibleRows.length > 0 && <div role="row" className="gizmo-price-header"><span role="columnheader">Moment</span>{showSplit ? <><span role="columnheader">Arbete inkl. moms</span><span role="columnheader">Material inkl. moms</span><span role="columnheader">Summa</span></> : showPriceColumn && <span role="columnheader">{showPrices ? 'Pris inkl. moms' : 'Prisform'}</span>}<span role="columnheader" className="sr-only">Redigera</span></div>}
        {visibleRows.map((row) => <div key={row.id}>
          <div role="row" className={`gizmo-price-row ${expanded === row.id ? 'open' : ''}`}>
            <div role="cell" className="min-w-0"><button type="button" className="gizmo-price-row-title w-full break-words text-left font-semibold" aria-expanded={expanded === row.id} aria-label={`Redigera pris för ${row.title || 'nytt moment'}`} onClick={() => setExpanded(expanded === row.id ? null : row.id)}>{row.title || 'Nytt moment'}</button></div>
            {showSplit ? <><span role="cell" className="gizmo-price-value">{isRunning(row) ? '-' : money(row.labourOre)}</span><span role="cell" className="gizmo-price-value">{isRunning(row) ? '-' : money(row.materialOre)}</span><span role="cell" className="gizmo-price-value">{isRunning(row) ? 'Löpande räkning' : money(contractRowAmount(value, row))}</span></> : showPriceColumn && <span role="cell" className="gizmo-price-value">{isRunning(row) ? 'Löpande räkning' : showPrices ? money(contractRowAmount(value, row)) : 'Fast pris'}</span>}
            <div role="cell" className="flex justify-end gap-1"><button type="button" className="gizmo-button gizmo-icon-button" title={`Redigera ${row.title || 'moment'}`} aria-label={`Öppna prisrad ${row.title || 'nytt moment'}`} onClick={() => setExpanded(expanded === row.id ? null : row.id)}><Pencil size={17} /></button>
              <button type="button" className="gizmo-button gizmo-icon-button" title="Radera prisrad" aria-label={`Radera prisrad ${row.title || 'nytt moment'}`} onClick={() => setRemoveId(row.id)}><Trash2 size={17} /></button></div>
          </div>
          {removeId === row.id && <div role="alert" className="border-b border-[#D5DCDD] p-3 text-sm">Radera prisraden för {row.title || 'nytt moment'}? Omfattningen i avtalet ligger kvar.
            <div className="mt-3 flex gap-2"><button type="button" className="gizmo-button" onClick={() => { patch({ rows: value.rows.filter((entry) => entry.id !== row.id) }); setRemoveId(null); if (expanded === row.id) setExpanded(null) }}><Trash2 size={17} />Radera prisrad</button><button type="button" className="gizmo-button" onClick={() => setRemoveId(null)}><X size={17} />Avbryt</button></div></div>}
          {expanded === row.id && <div className="gizmo-price-row-editor space-y-4 border-b border-[#D5DCDD] px-3 py-4">
            <label className="block text-sm font-medium">Moment<input className={field} maxLength={250} value={row.title} aria-label="Prisradens moment" onChange={(e) => patchRow(row.id, { title: e.target.value })} /></label>
            {value.mode === 'mixed' && <Modes title="Momentets prisform" value={row.kind} choices={[{ value: 'fixed', label: 'Fast pris' }, { value: 'running', label: 'Löpande räkning' }]} onChange={(kind) => patchRow(row.id, { kind })} />}
            {value.mode !== 'running' && value.basis === 'rows' && (value.mode !== 'mixed' || row.kind === 'fixed') && (value.split === 'combined'
              ? <PriceInput label="Momentets pris inkl. moms (kr)" value={row.amountOre} onChange={(amountOre) => patchRow(row.id, { amountOre })} />
              : <div className="grid gap-4 sm:grid-cols-2"><PriceInput label="Arbete inkl. moms (kr)" value={row.labourOre} onChange={(labourOre) => patchRow(row.id, { labourOre })} /><PriceInput label="Material inkl. moms (kr)" value={row.materialOre} onChange={(materialOre) => patchRow(row.id, { materialOre })} /></div>)}
          </div>}
        </div>)}
      </div>
      {value.mode !== 'running' && <>
        <div className="gizmo-price-total" aria-label="Avtalets totalsumma">
          {value.split === 'separate' && <dl className="gizmo-price-total-line text-sm"><dt>Arbete inkl. moms</dt><dd>{money(splitAmount('labourOre'))}</dd><dt>Material inkl. moms</dt><dd>{money(splitAmount('materialOre'))}</dd></dl>}
          <dl className="gizmo-price-total-line font-semibold"><dt>{value.mode === 'mixed' ? 'Fast del inkl. moms' : 'Totalsumma inkl. moms'}</dt><dd>{money(total)}</dd></dl>
        </div>
        {value.basis === 'total' && <div className="gizmo-price-row-editor py-3">{value.split === 'combined' ? <PriceInput label="Fast klumpsumma inkl. moms (kr)" value={value.totalOre} onChange={(totalOre) => patch({ totalOre, labourOre: null, materialOre: null })} />
          : <div className="grid gap-4 sm:grid-cols-2"><PriceInput label="Totalt arbete inkl. moms (kr)" value={value.labourOre} onChange={(labourOre) => splitTotal({ labourOre })} /><PriceInput label="Totalt material inkl. moms (kr)" value={value.materialOre} onChange={(materialOre) => splitTotal({ materialOre })} /></div>}</div>}
      </>}
    </section>
    {value.mode !== 'fixed' && <section className="space-y-5 border-t border-[#D5DCDD] pt-5" aria-label="Löpande prisgrunder">
      <h3 className="font-semibold">Arbete</h3>
      <PriceInput label="Timpris inkl. arvode och moms (kr/tim)" value={value.running.hourlyOre} onChange={(hourlyOre) => running({ hourlyOre })} />
      <Modes title="Arbetsledning" value={value.running.managementOre === null ? 'same' : 'own'} choices={[{ value: 'same', label: 'Samma timpris' }, { value: 'own', label: 'Eget timpris' }]} onChange={(next) => running({ managementOre: next === 'same' ? null : 0 })} />
      {value.running.managementOre !== null && <PriceInput label="Arbetsledning inkl. arvode och moms (kr/tim)" value={value.running.managementOre} onChange={(managementOre) => running({ managementOre: managementOre ?? 0 })} />}
      <h3 className="border-t border-[#D5DCDD] pt-4 font-semibold">Material, varor, hjälpmedel, UE och övrigt</h3>
      <p className="text-sm">Självkostnad</p>
      <PriceInput label="Arvode på självkostnad (%)" max={100000} value={value.running.markupPercent === null ? null : Math.round(value.running.markupPercent * 100)} onChange={(amount) => running({ markupPercent: amount === null ? null : amount / 100 })} />
      <p className="text-sm text-[#596368]">Moms tillkommer på kostnader och arvode.</p>
      <PriceInput label="Ungefärligt pris för den löpande delen inkl. moms (kr, valfritt)" value={value.running.approximateOre} onChange={(approximateOre) => running({ approximateOre })} />
      <p className="text-sm text-[#596368]">Beställaren får granska originalverifikationerna för arbetena.</p>
      {value.mode === 'running' && <p className="text-sm">Ingen fast kontraktssumma.</p>}
    </section>}
  </fieldset>
}

export function ContractPriceDocument({ value: p, compact = false }: { value: ContractPricing; compact?: boolean }) {
  const fixed = contractFixedRows(p), total = contractFixedAmount(p)
  const splitTotals = (key: 'labourOre' | 'materialOre') => p.basis === 'total' ? p[key] : fixed.some((row) => row[key] === null) ? null : fixed.reduce((sum, row) => sum + row[key]!, 0)
  return <section aria-label="Priset enligt avtalet" className="space-y-3 text-sm">
    {!compact && <h3 className="text-lg font-semibold">Priset</h3>}
    {p.mode !== 'running' && <>
      <p className="font-semibold">{p.mode === 'mixed' ? 'Fast pris för den fasta delen' : 'Fast pris'}</p>
      {p.display !== 'total' && fixed.length > 0 && <div className={`gizmo-price-document ${p.display === 'priced' && p.split === 'separate' ? 'gizmo-price-document-split' : ''}`}>
        <table className="w-full text-left"><thead className="bg-[#EDF1F1]"><tr><th>Moment</th>{p.display === 'priced' && (p.split === 'combined' ? <th>Pris inkl. moms</th> : <><th>Arbete</th><th>Material</th><th>Summa</th></>)}</tr></thead>
          <tbody>{fixed.map((row) => <tr key={row.id}><td>{row.title || 'Moment saknar namn'}</td>{p.display === 'priced' && (p.split === 'combined' ? <td>{money(row.amountOre)}</td> : <><td>{money(row.labourOre)}</td><td>{money(row.materialOre)}</td><td>{money(contractRowAmount(p, row))}</td></>)}</tr>)}</tbody></table>
      </div>}
      {p.split === 'separate' ? <dl className="grid grid-cols-2 gap-2"><dt>Arbete inkl. moms</dt><dd className="text-right">{money(splitTotals('labourOre'))}</dd><dt>Material inkl. moms</dt><dd className="text-right">{money(splitTotals('materialOre'))}</dd></dl> : <p>Arbete och material tillsammans</p>}
      <p className="font-semibold">{p.mode === 'mixed' ? 'Fast del' : 'Totalsumma'} inkl. moms: {money(total)}</p>
    </>}
    {p.mode !== 'fixed' && <div className="space-y-2">
      <p className="font-semibold">Löpande räkning</p>
      {p.rows.length > 0 && <p>Moment: {p.rows.filter((row) => p.mode === 'running' || row.kind === 'running').map((row) => row.title).join(', ')}</p>}
      <p>Arbete: {money(p.running.hourlyOre)}/tim inklusive entreprenörarvode och moms.</p>
      <p>Arbetsledning: {money(p.running.managementOre ?? p.running.hourlyOre)}/tim inklusive entreprenörarvode och moms.</p>
      <p>Material, varor, hjälpmedel, överenskomna underentreprenader och övriga kostnader: självkostnad + {p.running.markupPercent ?? 'Ej angivet'} % entreprenörarvode. Moms tillkommer på kostnader och arvode.</p>
      <p>Beställaren får granska originalverifikationerna för arbetena.</p>
      {p.running.approximateOre !== null && <p>Ungefärligt pris för den löpande delen inklusive moms: {money(p.running.approximateOre)}.</p>}
      {p.mode === 'running' && <p>Ingen fast kontraktssumma.</p>}
    </div>}
  </section>
}
