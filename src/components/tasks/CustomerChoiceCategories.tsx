'use client'

import { useRef, useState } from 'react'
import { Check, ChevronDown, Download, ExternalLink, Loader2, RefreshCw, Save, Undo2 } from 'lucide-react'
import { categoryOptions, currentCategoryChoice, normalizeSharedChoices, type CustomerChoiceCategory, type SharedCustomerChoices } from '@/lib/action-cases/customerPlanning'
import { money } from '@/lib/action-cases/customerOffers'
import ProjectEditorRow from './ProjectEditorRow'
import CustomerChoiceOfferSummary from './CustomerChoiceOfferSummary'
import { choicePriceLabel } from '@/lib/action-cases/choiceOffer'

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#D5DCDD] px-3 py-2 text-sm font-semibold disabled:opacity-50'

export default function CustomerChoiceCategories({ shared, onSaved, token, previewCaseId, readOnly = false }: {
  shared: SharedCustomerChoices
  onSaved: (value: SharedCustomerChoices) => void
  token?: string
  previewCaseId?: string
  readOnly?: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [draft, setDraft] = useState<Record<string, string | null>>({})
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [stale, setStale] = useState(false)
  const running = useRef(false)
  const fileUrl = (id: string) => previewCaseId ? `/api/action-cases/${previewCaseId}/customer-choices/files/${id}` : token ? `/api/action-cases/public/${token}/customer-choices/files/${id}` : null
  async function refresh() {
    if (!token || readOnly || running.current) return
    running.current = true; setBusy('refresh')
    try {
      const response = await fetch(`/api/action-cases/public/${token}/customer-choices`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Valen kunde inte hämtas.')
      onSaved(normalizeSharedChoices(result)); setDraft({}); setStale(false); setError('')
    } catch (error) { setError(error instanceof Error ? error.message : 'Valen kunde inte hämtas.') }
    finally { running.current = false; setBusy('') }
  }
  async function save(category: CustomerChoiceCategory, optionId: string | null) {
    if (!token || readOnly || stale || running.current) return
    running.current = true; setBusy(category.id); setError('')
    try {
      const response = await fetch(`/api/action-cases/public/${token}/customer-choices`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          categoryId: category.id, categoryVersion: shared.versions[category.id], optionId,
          revision: shared.choices.find((choice) => choice.categoryId === category.id)?.revision ?? 0
        })
      })
      const result = await response.json()
      if (!response.ok) { if (response.status === 409 || response.status === 404 || response.status === 410) setStale(true); throw new Error(result.error || 'Valet kunde inte sparas.') }
      onSaved(normalizeSharedChoices(result))
      setDraft((current) => { const next = { ...current }; delete next[category.id]; return next })
    } catch (error) { setError(error instanceof Error ? error.message : 'Valet kunde inte sparas.') }
    finally { running.current = false; setBusy('') }
  }
  return <section aria-label="Val och tillval" className="gizmo-choice-categories py-6 text-[#252A2D]">
    <div className="mb-4"><h2 className="text-xl">Val och tillval</h2><p className="mt-2 text-sm text-[#596368]">Val registreras separat · Inte beställning · Påverkar inte avtalet</p></div>
    {error && <div role="alert" className="mb-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm"><p>{error}</p>
      {stale && <button type="button" className={`${button} mt-3 bg-white`} disabled={Boolean(busy)} onClick={() => void refresh()}><RefreshCw size={16} /> Uppdatera alternativ</button>}</div>}
    <div className="divide-y divide-[#D5DCDD] border-y border-[#D5DCDD]">
      {shared.categories.map((category) => {
        const options = categoryOptions(category, shared.items), choice = currentCategoryChoice(shared, category.id)
        const savedId = choice?.optionId ?? null, selectedId = Object.hasOwn(draft, category.id) ? draft[category.id] : savedId
        const oldChoice = shared.choices.find((row) => row.categoryId === category.id)
        const needsNewChoice = Boolean(oldChoice?.optionId && !choice)
        const chosen = options.find((item) => item.id === savedId)
        const changed = selectedId !== savedId
        return <ProjectEditorRow key={category.id} title={category.title} open={expanded === category.id} onToggle={() => setExpanded(expanded === category.id ? null : category.id)}
          summary={[chosen ? `Valt: ${chosen.title}` : needsNewChoice ? 'Nytt val behövs' : 'Inget alternativ valt', category.decisionBy && `Beslut ${category.decisionBy}`].filter(Boolean).join(' · ')}>
          {category.specification && <div className="mb-4 max-w-3xl"><h4 className="text-sm font-semibold">Specifikation</h4><p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{category.specification}</p></div>}
          <fieldset disabled={Boolean(busy) || stale} className="min-w-0">
            <legend className="mb-2 text-sm font-semibold">Alternativ för {category.title}</legend>
            <div className="flex justify-between gap-3 bg-[#EDF1F1] px-3 py-2 text-xs font-semibold"><span>Alternativ</span><span className="text-right">Prisunderlag inkl. moms</span></div>
            {options.map((option) => <div key={option.id} className="border-b border-[#D5DCDD]">
              <div className="flex items-start gap-2 px-3 py-3">
                <label className="grid min-h-11 min-w-0 flex-1 cursor-pointer grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2 text-sm sm:flex">
                  <input type="radio" disabled={readOnly} className="mt-0.5 h-5 w-5 shrink-0 accent-[#206961]" name={`customer-choice-${category.id}`} value={option.id} checked={selectedId === option.id}
                    onChange={() => { setDraft((current) => ({ ...current, [category.id]: option.id })); setError('') }} />
                  <span className="min-w-0 flex-1 break-words font-semibold">{option.title}</span>
                  <span className="col-start-2 tabular-nums sm:max-w-[45%] sm:text-right">{choicePriceLabel(option, money)}</span>
                </label>
                <button type="button" className="mt-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded border border-[#D5DCDD] disabled:opacity-50"
                  aria-label={`Visa detaljer för ${option.title}`} title="Visa detaljer" aria-expanded={details === option.id} aria-controls={`choice-details-${option.id}`} onClick={() => setDetails(details === option.id ? null : option.id)}>
                  <ChevronDown size={17} className={details === option.id ? 'rotate-180' : ''} /></button>
              </div>
              <div hidden={details !== option.id} id={`choice-details-${option.id}`} className="max-w-3xl px-3 pb-4 text-sm leading-6"><p className="whitespace-pre-wrap break-words">{option.scope}</p>
                <CustomerChoiceOfferSummary item={option} />
                {shared.files?.some((f) => f.optionId === option.id) && <ul className="mt-3 divide-y divide-[#D5DCDD] border-t border-[#D5DCDD]" aria-label={`PDF-bilagor för ${option.title}`}>{shared.files.filter((f) => f.optionId === option.id).map((file) => {
                  const url = fileUrl(file.id)
                  return <li key={file.id} className="flex min-w-0 flex-wrap items-center gap-2 py-2"><span className="min-w-0 flex-1 break-words">{file.fileName}</span>{url && <><a className={`${button} text-[#206961]`} href={url} target="_blank" rel="noreferrer"><ExternalLink size={16} /> Öppna</a><a className={`${button} w-11 px-0 text-[#206961]`} aria-label={`Ladda ner ${file.fileName}`} title="Ladda ner PDF" href={`${url}?download=1`} target="_blank" rel="noreferrer"><Download size={16} /></a></>}</li>
                })}</ul>}</div>
            </div>)}
          </fieldset>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {chosen && <p role="status" className="flex min-w-0 items-start gap-2 text-sm"><Check size={17} className="mt-0.5 shrink-0 text-[#206961]" /><span className="break-words">Val registrerat: {chosen.title}</span></p>}
            {needsNewChoice && <p className="text-sm text-amber-800">Tidigare val behöver bekräftas mot de uppdaterade alternativen.</p>}
            {!readOnly && <>
              <button type="button" className={`${button} bg-[#252A2D] text-white`} disabled={Boolean(busy) || stale || !changed || !selectedId} onClick={() => void save(category, selectedId)}>
                {busy === category.id ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Spara val</button>
              {savedId && <button type="button" className={button} disabled={Boolean(busy) || stale} onClick={() => void save(category, null)}><Undo2 size={16} /> Rensa val</button>}
            </>}
          </div>
        </ProjectEditorRow>
      })}
    </div>
  </section>
}
