'use client'

import { Pencil, Wrench } from 'lucide-react'
import { useState } from 'react'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { money, type CustomerOfferDraft } from '@/lib/action-cases/customerOffers'
import { contractDisplayPricing, contractFixedAmount, contractPricingIssues, offerBudgetBreakdown, offerCompensationText, projectRunningPrices, type ContractPricing } from '@/lib/action-cases/contractPricing'
import { offerBillingSummary } from '@/lib/action-cases/projectPricingFlow'

export default function CustomerOfferPricingSummary({ draft, sources, blocked, onEditWork, onDisplayChange, onUseMomentPricing }: {
  draft: CustomerOfferDraft; sources: ActionCaseItemView[]; blocked: boolean
  onEditWork?: (itemId?: string) => void; onDisplayChange: (display: ContractPricing['display']) => void
  onUseMomentPricing?: () => void
}) {
  const [transition, setTransition] = useState(false)
  const p = draft.contractPricing, rows = offerBillingSummary(draft)
  const view = p ? contractDisplayPricing(p) : null
  const fixed = p ? contractFixedAmount(p) : draft.pricingMode === 'itemized'
    ? rows.some(row => row.amountOre === null) ? null : rows.reduce((sum, row) => sum + row.amountOre!, 0) : draft.baseAmountOre
  const budget = p ? offerBudgetBreakdown(p) : null
  const issues = p ? contractPricingIssues(p) : []
  const rates = p ? projectRunningPrices(p) : []
  const modeLabel = (mode: typeof rows[number]['mode']) => mode === 'missing' ? 'Inte angiven' : mode === 'fixed' ? 'Fast pris' : mode === 'budget' ? 'Löpande med planeringsbudget' : 'Löpande räkning'
  const rowAmount = (row: typeof rows[number]) => row.mode === 'running' ? 'Enligt prisgrunder' : row.amountOre === null ? 'Ej angivet' : money(row.amountOre)
  if (p && p.rows.some(row => !row.projectPricing && (p.mode === 'running' || row.kind === 'running'))) rates.push({ title: 'Äldre gemensamma prisgrunder', hourlyOre: p.running.hourlyOre, markupPercent: p.running.markupPercent, hourly: true, markup: true })
  const edit = (itemId?: string) => onEditWork ? <button type="button" className="gizmo-button" disabled={blocked} title={itemId ? 'Ändra prisvillkor i Projektarbete' : 'Öppna Projektarbete'} aria-label={itemId ? `Ändra prisvillkor för ${sources.find(item => item.id === itemId)?.title ?? 'momentet'} i Projektarbete` : undefined} onClick={() => onEditWork(itemId)}>{itemId ? <Pencil size={16} /> : <><Wrench size={16} />Projektarbete</>}</button> : null
  return <section aria-label="Offertens prissammanställning" className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Priser från Projektarbete</h3>{edit()}</div>
    {p && <p className="text-sm">{offerCompensationText(p)}</p>}
    {rows.some(row => !row.shared) && <p role="status" className="border-l-2 border-[#AD8529] pl-3 text-sm">Äldre offertbelopp visas oförändrade. Prisvillkor som ännu inte är gemensamma granskas i Projektarbete innan de ersätts.</p>}
    {onUseMomentPricing && ((p?.basis === 'total' && p.mode !== 'running') || (!p && draft.baseAmountOre !== null && draft.pricingMode !== 'itemized') || draft.offerHourEstimate || p?.running.approximateOre != null) && <div className="space-y-3 border-b border-[#D5DCDD] pb-3 text-sm">
      {!transition ? <button type="button" className="gizmo-button" disabled={blocked} onClick={() => setTransition(true)}><Wrench size={16} />Övergå till momentens prisvillkor</button> : <div role="alertdialog" aria-label="Övergå till momentens prisvillkor"><p>Det äldre prisunderlaget ersätts av momentens angivna priser. En klumpsumma {fixed === null ? '' : money(fixed)} fördelas inte. Saknade momentpriser förblir tomma. En gemensam timuppskattning och en ungefärlig prisuppgift tas bort från utkastet, inte omvandlas till budget. Skickade och låsta dokument ändras inte.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className="gizmo-button" disabled={blocked} onClick={() => { onUseMomentPricing(); setTransition(false) }}>Bekräfta övergång till momentpriser</button><button type="button" className="gizmo-button" onClick={() => setTransition(false)}>Behåll äldre underlag</button></div></div>}
    </div>}
    <div className="hidden sm:block"><table className="w-full text-left text-sm"><thead className="bg-[#EDF1F1]"><tr><th className="p-2 font-medium">Moment</th><th className="p-2 font-medium">Prisform</th><th className="p-2 text-right font-medium">Belopp inkl. moms</th><th className="w-12 p-2"><span className="sr-only">Projektarbete</span></th></tr></thead><tbody>
      {rows.map(row => <tr key={row.id} className="border-b border-[#D5DCDD]"><th scope="row" className="p-2 font-medium">{row.title || 'Moment utan namn'}</th><td className="p-2">{modeLabel(row.mode)}</td><td className="p-2 text-right tabular-nums">{rowAmount(row)}</td><td className="p-2">{row.sourceItemId && sources.some(item => item.id === row.sourceItemId) && edit(row.sourceItemId)}</td></tr>)}
      {!rows.length && <tr><td colSpan={4} className="py-3">Inga prisvillkor i offertunderlaget.</td></tr>}
    </tbody></table></div>
    <ul className="divide-y divide-[#D5DCDD] text-sm sm:hidden" aria-label="Momentens prisvillkor">{rows.map(row => <li key={row.id} className="min-w-0 space-y-2 py-3">
      <div className="flex items-start justify-between gap-2"><strong className="min-w-0 break-words font-medium">{row.title || 'Moment utan namn'}</strong>{row.sourceItemId && sources.some(item => item.id === row.sourceItemId) && <span className="shrink-0">{edit(row.sourceItemId)}</span>}</div>
      <p>{modeLabel(row.mode)}</p><div className="flex flex-wrap justify-between gap-2"><span className="text-[#596368]">Belopp inkl. moms</span><span className="tabular-nums">{rowAmount(row)}</span></div>
    </li>)}{!rows.length && <li className="py-3">Inga prisvillkor i offertunderlaget.</li>}</ul>
    {(!view || view.mode !== 'running') && <div className="flex flex-wrap justify-between gap-2 border-b border-[#B9C3C4] py-2 font-semibold"><span>Summa fasta priser inkl. moms</span><span>{fixed === null ? 'Behöver kompletteras' : money(fixed)}</span></div>}
    {budget && <div className="space-y-2 border-b border-[#B9C3C4] py-2"><div className="flex flex-wrap justify-between gap-2 font-semibold"><span>Planeringsbudget, löpande del inkl. moms</span><span>{budget.runningOre === null ? 'Ej angiven' : money(budget.runningOre)}</span></div>{budget.unbudgetedTitles.length > 0 && <p className="text-sm">Utan angiven budget: {budget.unbudgetedTitles.join(', ')}.</p>}</div>}
    {rates.length > 0 && <section className="space-y-2"><h4 className="text-sm font-semibold">Prisgrunder för löpande räkning</h4>{rates.map((rate, index) => <div key={`${rate.title}:${index}`} className="border-b border-[#D5DCDD] py-2 text-sm"><strong className="font-medium">{rate.title}</strong><div className="mt-1 flex flex-wrap gap-x-5 gap-y-1">{rate.hourly && <span>Timpris inkl. moms: {rate.hourlyOre === null ? 'Ej angivet' : `${money(rate.hourlyOre)}/tim`}</span>}{rate.markup && <span>Påslag på självkostnad exkl. moms: {rate.markupPercent === null ? 'Ej angivet' : `${rate.markupPercent} %`}</span>}</div></div>)}</section>}
    {p?.running.approximateOre !== undefined && p.running.approximateOre !== null && <p className="text-sm">Äldre ungefärlig prisuppgift inkl. moms: {money(p.running.approximateOre)}</p>}
    {view?.budget && <details className="border-b border-[#D5DCDD] py-2 text-sm"><summary className="cursor-pointer font-medium">Budgetens förutsättningar och samråd</summary><p className="mt-2 whitespace-pre-wrap">{view.budget.assumptions}</p><p className="mt-3 whitespace-pre-wrap">{view.budget.reviewTerms}</p></details>}
    {p && <label className="block text-sm">Redovisning i offerten<select aria-label="Redovisning i offerten" className="mt-1 w-full rounded-md border border-[#B9C3C4] p-2" disabled={blocked} value={p.display} onChange={e => onDisplayChange(e.target.value as ContractPricing['display'])}><option value="priced" disabled={p.basis === 'total' && p.mode !== 'running'}>Delmoment med pris och delsummeringar</option><option value="unpriced">Delmoment utan pris och delsummeringar</option><option value="total">Endast delsummeringar</option></select></label>}
    {issues.length > 0 && <div role="status" className="border-l-2 border-[#AD8529] pl-3 text-sm"><strong>Prisvillkor att komplettera i Projektarbete</strong><ul className="mt-2 list-disc space-y-1 pl-4">{[...new Set(issues)].map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
  </section>
}
