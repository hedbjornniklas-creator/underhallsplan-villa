'use client'

import { useId, useState } from 'react'
import { Check, Loader2, LockKeyhole, RotateCcw } from 'lucide-react'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { customerChargeLabels, customerPricingParts, emptyProjectCustomerPricing, projectPricingIssues, type CustomerCharge, type ProjectCustomerPricing } from '@/lib/action-cases/projectCustomerPricing'
import { defaultBudgetReviewTerms } from '@/lib/action-cases/contractPricing'
import type { CustomerPricingEntry } from './useProjectCustomerPricingAutosave'
import PriceInput from './CustomerOfferPriceInput'
import ActionCaseContractPrice from './ActionCaseContractPrice'

export default function ActionCaseCustomerPricing({ item, entry, blocked, onChange, onRetry, onReload, onDraftDirty }: {
  item: ActionCaseItemView; entry?: CustomerPricingEntry; blocked: boolean
  onChange: (terms: ProjectCustomerPricing, immediate?: boolean) => void
  onRetry: () => void; onReload: () => void; onDraftDirty: (dirty: boolean) => void
}) {
  const shared = item.contractWork?.customerPricing
  const [initial, setInitial] = useState<ProjectCustomerPricing | null>(null)
  const [confirm, setConfirm] = useState(false)
  const [reloadConfirmation, setReloadConfirmation] = useState(false)
  const groupName = useId()
  const value = entry?.terms ?? shared?.terms ?? initial
  const locked = item.contractWork?.locked
  const adopted = Boolean(entry || shared?.terms)
  const change = (next: ProjectCustomerPricing) => {
    if (blocked || locked) return
    if (adopted) onChange(next)
    else { setInitial(next); onDraftDirty(true) }
  }
  if (locked && !shared?.terms) return <div className="space-y-4"><p className="flex items-center gap-2 text-sm"><LockKeyhole size={16} />Momentet ingår i ett låst avtal. Kundprisvillkoren kan inte ändras.</p>{item.contractWork && <ActionCaseContractPrice link={item.contractWork} busy onDirty={() => {}} onSave={async () => false} />}</div>
  if (!shared) return <p role="alert">Kundprisvillkoren kunde inte läsas. Ladda om sidan innan du fortsätter.</p>
  const issues = value ? projectPricingIssues(value) : []
  const patchPart = (key: string, patch: Partial<CustomerCharge>) => {
    if (!value) return
    const next = { ...value, [key]: { ...value[key as 'combined' | 'labour' | 'material'], ...patch } }
    if (patch.mode === 'budget' && !next.reviewTerms) next.reviewTerms = defaultBudgetReviewTerms
    change(next)
  }
  return <section className="gizmo-contract-pricing min-w-0 space-y-5" aria-label="Momentets kundprisvillkor">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Kundprisvillkor</h3>
      {locked ? <span className="flex items-center gap-1 text-sm"><LockKeyhole size={16} />Låst för signering</span> : entry ? <span role="status" className="flex items-center gap-2 text-sm">
        {entry.status === 'saving' || entry.status === 'pending' ? <><Loader2 size={15} className="animate-spin" />Sparar kundpris</> : entry.status === 'saved' ? <><Check size={15} />Sparat</> : 'Kunde inte spara'}
      </span> : null}
    </div>
    {!value && <div className="space-y-3">
      {shared.candidates.map(candidate => <button key={candidate.source} type="button" className="gizmo-button mr-2" disabled={blocked} onClick={() => { setInitial(candidate.terms); onDraftDirty(true) }}>Utgå från {candidate.source === 'offer' ? 'offertens' : 'avtalets'} prisvillkor</button>)}
      <button type="button" className="gizmo-button" disabled={blocked} onClick={() => { setInitial(emptyProjectCustomerPricing()); onDraftDirty(true) }}>Ange nya kundprisvillkor</button>
      {shared.candidates.length > 1 && <p className="text-sm text-[#815B18]">Offert och Avtal kan ha olika villkor. Välj underlag och granska innan du kopplar ihop dem.</p>}
    </div>}
    {value && <fieldset disabled={blocked || locked} className="min-w-0 space-y-5">
      <fieldset><legend className="mb-2 text-sm font-medium">Arbete och material</legend><div className="gizmo-price-modes">
        {([['combined', 'Samlat pris'], ['separate', 'Separata prisformer']] as const).map(([key, label]) => <label key={key} className={value.split === key ? 'selected' : ''}><input type="radio" name={groupName} checked={value.split === key} onChange={() => change({ ...value, split: key })} />{label}</label>)}
      </div></fieldset>
      <div className="grid min-w-0 gap-5 md:grid-cols-2">{customerPricingParts(value).map(({ key, label, charge }) => <fieldset key={key} className="min-w-0 space-y-3 border-t border-[#D5DCDD] pt-3">
        <legend className="px-1 text-sm font-semibold">{label || 'Arbete och material'}</legend>
        <label className="block text-sm">Prisform<select className="mt-1 w-full rounded-md border border-[#B9C3C4] bg-white px-3 py-2" aria-label={`${label || 'Samlad'} prisform`} value={charge.mode} onChange={e => patchPart(key, { mode: e.target.value as CustomerCharge['mode'] })}>
          {Object.entries(customerChargeLabels).map(([mode, text]) => <option key={mode} value={mode}>{text}</option>)}
        </select></label>
        {charge.mode === 'fixed' ? <PriceInput label={`${label || 'Samlat'} fast pris inkl. moms (kr)`} value={charge.fixedOre} onChange={fixedOre => patchPart(key, { fixedOre })} /> : <>
          {key !== 'material' && <PriceInput label={`${label || 'Samlat'} timpris inkl. arvode och moms (kr/tim)`} value={charge.hourlyOre} onChange={hourlyOre => patchPart(key, { hourlyOre })} />}
          {key !== 'labour' && <PriceInput label="Påslag på självkostnad exkl. moms (%)" max={100000} value={charge.markupPercent === null ? null : Math.round(charge.markupPercent * 100)} onChange={n => patchPart(key, { markupPercent: n === null ? null : n / 100 })} />}
          {charge.mode === 'budget' && <PriceInput label={`${label || 'Samlad'} planeringsbudget inkl. moms (kr)`} value={charge.budgetOre} onChange={budgetOre => patchPart(key, { budgetOre })} />}
        </>}
      </fieldset>)}</div>
      {customerPricingParts(value).some(part => part.charge.mode === 'budget') && <div className="grid gap-4">
        <label className="text-sm">Budgetens förutsättningar<textarea className="mt-1 w-full rounded-md border border-[#B9C3C4] p-3" rows={3} maxLength={6000} value={value.assumptions} onChange={e => change({ ...value, assumptions: e.target.value })} /></label>
        <label className="text-sm">Uppföljning och samråd<textarea className="mt-1 w-full rounded-md border border-[#B9C3C4] p-3" rows={5} maxLength={6000} value={value.reviewTerms} onChange={e => change({ ...value, reviewTerms: e.target.value })} /></label>
      </div>}
      {!adopted && <div className="flex flex-wrap gap-2"><button type="button" className="gizmo-button gizmo-button-primary" onClick={() => setConfirm(true)}>Använd som gemensamma kundprisvillkor</button><button type="button" className="gizmo-button" onClick={() => { setInitial(null); setConfirm(false); onDraftDirty(false) }}>Avbryt</button></div>}
      {confirm && !adopted && <div role="alertdialog" aria-label="Bekräfta gemensamma kundprisvillkor" className="border-l-4 border-[#206961] bg-[#EDF1F1] p-4 text-sm">
        <p>Dessa villkor ersätter momentets kundprisvillkor i kopplade offert- och avtalsutkast. Intern kalkyl, låsta avtal och skickade dokument ändras inte. Manuella klumpsummor fördelas inte.</p>
        <div className="mt-3 flex flex-wrap gap-2"><button type="button" className="gizmo-button gizmo-button-primary" onClick={() => { onChange(value, true); setConfirm(false); onDraftDirty(false) }}>Bekräfta och koppla</button><button type="button" className="gizmo-button" onClick={() => setConfirm(false)}>Granska igen</button></div>
      </div>}
    </fieldset>}
    {entry?.status === 'error' && <div role="alert" className="space-y-3 border-l-4 border-[#A52E42] pl-3 text-sm"><p>{entry.error}</p><div className="flex flex-wrap gap-2"><button type="button" className="gizmo-button" onClick={onRetry}><RotateCcw size={16} />Försök igen</button><button type="button" className="gizmo-button" onClick={() => setReloadConfirmation(true)}>Hämta sparade kundprisvillkor</button></div>
      {reloadConfirmation && <div role="alertdialog" aria-label="Ersätt osparade kundprisvillkor" className="space-y-3 bg-[#EDF1F1] p-3"><p>Ersätta dina osparade kundprisvillkor med de senast sparade uppgifterna?</p><div className="flex flex-wrap gap-2"><button type="button" className="gizmo-button" onClick={onReload}>Hämta och ersätt</button><button type="button" className="gizmo-button" onClick={() => setReloadConfirmation(false)}>Behåll mina ändringar</button></div></div>}
    </div>}
    {issues.length > 0 && <div className="border-l-2 border-[#AD8529] pl-3 text-sm" role="status"><strong>Utkast – behöver kompletteras</strong><ul className="mt-2 list-disc space-y-1 pl-4">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div>}
  </section>
}
