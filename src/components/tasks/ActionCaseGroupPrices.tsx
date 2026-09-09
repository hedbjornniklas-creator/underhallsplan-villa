'use client'

import { useState } from 'react'
import { Check, Loader2, Plus, RotateCcw } from 'lucide-react'
import type { ActionCaseQuoteRequest, ActionCaseView } from '@/lib/action-cases/contracts'
import { groupRequestLines, type QuoteRequestGroup } from '@/lib/action-cases/quoteRequests'
import { normalizeQuotePackageAction } from '@/lib/action-cases/quotePackages'
import { groupPriceUsability } from './actionCaseGroupPricing'

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-200'
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40'
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-40'
const money = (value: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(value)

type Props = {
  actionCase: ActionCaseView
  request: ActionCaseQuoteRequest
  busy: boolean
  onEditing: (value: boolean) => void
  onAction: (action: string, payload: Record<string, unknown>) => Promise<boolean>
}

function GroupPriceForm({ actionCase, request, group, busy, onSave, onCancel }: Pick<Props, 'actionCase' | 'request' | 'busy'> & {
  group: QuoteRequestGroup
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
  onCancel: () => void
}) {
  const multiple = groupRequestLines(request.lines).length > 1
  const item = actionCase.items.find((item) => item.id === group.itemId)
  const [expected] = useState(request.updatedAt)
  const [versions] = useState(() => Object.fromEntries((item?.costLines ?? []).map((line) => [line.id, line.updatedAt])))
  const [amount, setAmount] = useState(!multiple && request.responseMode === 'package' ? request.packageAmount?.toString() ?? '' : '')
  const [scope, setScope] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [covered, setCovered] = useState<string[]>([])
  const [checked, setChecked] = useState(false)
  const [independent, setIndependent] = useState(false)
  const extras = (item?.costLines ?? []).filter((line) => !['own_labor', 'subcontractor'].includes(line.category) &&
    (!line.workPartId || line.workPartId === group.workPartId) && !line.coveredByQuoteId && !line.selectedQuoteId)
  const priceIds = [...group.lines.map((line) => line.costLineId), ...covered]
  const payload = {
    caseId: actionCase.id, requestId: request.id, groupKey: group.key, operation: 'accept',
    expectedUpdatedAt: expected, expectedLines: priceIds.map((costLineId) => ({ costLineId, updatedAt: versions[costLineId] })),
    amount, offeredScope: scope, validUntil, coveredLineIds: covered, checked,
    separateGroupPriceConfirmed: multiple ? independent : true,
  }
  let valid = !multiple || independent
  try { normalizeQuotePackageAction(payload) } catch { valid = false }
  const change = (update: () => void) => { update(); setChecked(false) }
  return <form className="mt-3 space-y-4" aria-label={`Grupppris för ${group.workPartTitle || group.itemTitle}`} onSubmit={(event) => {
    event.preventDefault()
    if (!busy && valid) void onSave(payload).then((saved) => { if (saved) onCancel() })
  }}>
    <fieldset disabled={busy} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Grupppris exkl. moms, kr *<input autoFocus required name="groupAmount" type="number" min="0" step="0.01" className={input} value={amount} onChange={(event) => change(() => setAmount(event.target.value))} /></label>
        <label className="text-sm">Giltig till<input type="date" className={input} value={validUntil} onChange={(event) => change(() => setValidUntil(event.target.value))} /></label>
      </div>
      <label className="block text-sm">Offertens omfattning och eventuella undantag *<textarea required name="groupOfferedScope" rows={3} maxLength={4000} className={`${input} py-2`} value={scope} onChange={(event) => change(() => setScope(event.target.value))} /></label>
      {extras.length ? <fieldset><legend className="text-sm font-semibold">Ingår också i grupppriset</legend>{extras.map((line) => <label key={line.id} className="flex min-h-11 items-center gap-3 py-1 text-sm"><input type="checkbox" name="groupCoveredLine" className="h-4 w-4 shrink-0 accent-violet-600" value={line.id} checked={covered.includes(line.id)} onChange={(event) => change(() => setCovered((current) => event.target.checked ? [...current, line.id] : current.filter((id) => id !== line.id)))} /><span className="min-w-0 break-words">{line.description}</span></label>)}</fieldset> : null}
      {multiple ? <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" name="independentGroupPrice" className="mt-1 h-4 w-4 shrink-0 accent-violet-600" checked={independent} onChange={(event) => change(() => setIndependent(event.target.checked))} /><span>UE har bekräftat att detta grupppris gäller även vid separat beställning.</span></label> : null}
      <label className="flex min-h-11 items-start gap-3 py-2 text-sm"><input type="checkbox" name="groupPriceChecked" className="mt-1 h-4 w-4 shrink-0 accent-violet-600" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>Jag har kontrollerat belopp, omfattning och vilka kostnader som ingår.</span></label>
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2"><button type="button" className={secondary} disabled={busy} onClick={onCancel}>Avbryt</button><button className={primary} type="submit" disabled={busy || !valid}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}Använd grupppriset i kalkylen</button></div>
  </form>
}

export default function ActionCaseGroupPrices({ actionCase, request, busy, onEditing, onAction }: Props) {
  const [editing, setEditing] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const cancel = () => { setEditing(null); setRemoving(null); onEditing(false) }
  const groups = groupRequestLines(request.lines)
  return <section className="border-t border-slate-200 pt-4" aria-label="Grupppriser">
    <h3 className="font-semibold">Pris per åtgärd eller arbetsdel</h3>
    <ul className="mt-2 divide-y divide-slate-200">{groups.map((group) => {
      const active = actionCase.quotePackages?.find((price) => price.requestId === request.id && price.groupKey === group.key && price.state === 'active')
      const item = actionCase.items.find((item) => item.id === group.itemId)
      const savedQuote = active ? item?.costLines.find((line) => line.id === active.anchorLineId)?.quotes?.find((quote) => quote.id === active.quoteId) : undefined
      const priceStatus = groupPriceUsability(savedQuote, item)
      const currentLines = group.lines.map((source) => item?.costLines.find((line) => line.id === source.costLineId))
      const missing = currentLines.some((line) => !line)
      const conflicting = currentLines.some((line) => line?.selectedQuoteId || line?.coveredByQuoteId)
      return <li key={group.key} className="py-3">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><strong className="block break-words text-sm">{group.workPartTitle ? `${group.itemTitle}: ${group.workPartTitle}` : group.itemTitle}</strong><p className="mt-1 text-xs text-slate-500">{group.lines.length} arbetsmoment</p>{active ? <p role="status" className={`mt-1 break-words text-sm font-semibold ${priceStatus.usable ? 'text-violet-800' : 'text-amber-800'}`}>{money(active.amount)} · {priceStatus.label}</p> : null}</div>
          {active ? <button className={secondary} disabled={busy || Boolean(editing || removing)} type="button" onClick={() => { setRemoving(group.key); onEditing(true) }}><RotateCcw size={16} />Ta bort prisval</button> : <button className={secondary} disabled={busy || Boolean(editing || removing) || missing || conflicting} type="button" onClick={() => { setEditing(group.key); onEditing(true) }}><Plus size={16} />Registrera grupppris</button>}
        </div>
        {active && savedQuote ? <div className="mt-3 space-y-2">
          <p className="whitespace-pre-wrap break-words text-sm text-slate-600"><strong>Offertens omfattning:</strong> {savedQuote.offeredScope || 'Omfattning saknas'}</p>
          {savedQuote.exclusions ? <p className="whitespace-pre-wrap break-words text-sm text-amber-800"><strong>Undantag:</strong> {savedQuote.exclusions}</p> : null}
          <p className="text-xs text-slate-500">{savedQuote.validUntil ? `Giltig till ${savedQuote.validUntil}` : 'Giltighet ej angiven'}</p>
        </div> : null}
        {!active && (missing || conflicting) ? <p className="mt-2 text-xs text-amber-800">{missing ? 'Ett arbetsmoment finns inte längre.' : 'Ta bort tidigare offertval för dessa arbeten innan ett gemensamt pris väljs.'}</p> : null}
        {editing === group.key ? <GroupPriceForm actionCase={actionCase} request={request} group={group} busy={busy} onCancel={cancel} onSave={(data) => onAction('quote_package', data)} /> : null}
        {removing === group.key ? <div className="mt-3 flex flex-wrap items-center gap-2"><p className="basis-full text-sm">Ta bort grupppriset ur kalkylen och återställ det tidigare prisunderlaget?</p><button type="button" className={secondary} disabled={busy} onClick={cancel}>Avbryt</button><button type="button" className={secondary} disabled={busy} onClick={() => void onAction('quote_package', { operation: 'remove', caseId: actionCase.id, requestId: request.id, groupKey: group.key, expectedUpdatedAt: request.updatedAt }).then((ok) => { if (ok) cancel() })}>{busy ? <Loader2 size={16} className="animate-spin" /> : <RotateCcw size={16} />}Återställ prisunderlag</button></div> : null}
      </li>
    })}</ul>
  </section>
}
