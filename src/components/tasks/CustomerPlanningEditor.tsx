'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, Eye, EyeOff, Loader2, Paperclip, Plus, RefreshCw, Trash2, Undo2 } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { categoryOptions, currentCategoryChoice, legacyChoiceCategories, type CustomerChoiceCategory, type CustomerChoiceFileRef, type CustomerPlannedItem, type CustomerPlanning } from '@/lib/action-cases/customerPlanning'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import { money } from '@/lib/action-cases/customerOffers'
import { choiceCalculatedPrice, type CustomerChoiceCosting } from '@/lib/action-cases/customerChoiceCosting'
import { retainNewerDraft } from '@/lib/action-cases/draftSave'
import CustomerChoiceOptionSheet from './CustomerChoiceOptionSheet'
import ProjectEditorRow from './ProjectEditorRow'
import { useCustomerPlanningAutosave, type CustomerPlanningSnapshot } from './useCustomerPlanningAutosave'
import CustomerPlanningSaveStatus from './CustomerPlanningSaveStatus'

const field = 'mt-1 block w-full rounded-md border border-[#D5DCDD] bg-white px-3 py-2 text-sm'
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#D5DCDD] px-3 py-2 text-sm font-semibold disabled:opacity-50'
const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-[#D5DCDD] disabled:opacity-50'

export default function CustomerPlanningEditor({ caseId, initial, files = [], onDirty, onSaved }: {
  caseId: string
  initial: CustomerPlanning
  files?: ActionCaseAttachmentView[]
  onDirty: (dirty: boolean) => void
  onSaved: (value: CustomerPlanning) => void
}) {
  const [saved, setSaved] = useState(initial), [items, setItems] = useState(initial.items)
  const [categories, setCategories] = useState(initial.categories ?? legacyChoiceCategories(initial.items))
  const [costing, setCosting] = useState<CustomerChoiceCosting>(initial.costing ?? {})
  const [optionFiles, setOptionFiles] = useState(initial.optionFiles ?? []), [projectFiles, setProjectFiles] = useState(files)
  const [busy, setBusy] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null), [expandedOption, setExpandedOption] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ categories: CustomerChoiceCategory[]; items: CustomerPlannedItem[]; costing: CustomerChoiceCosting; files: CustomerChoiceFileRef[]; index: number } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<string | null>(null)
  const running = useRef(false), immediateSave = useRef(false), toast = useToast()
  const ready = saved.available && saved.categoriesAvailable === true
  const structured = saved.categoriesStored === true
  const fileKey = (refs: CustomerChoiceFileRef[]) => JSON.stringify([...refs].sort((a, b) => `${a.optionId}/${a.fileId}`.localeCompare(`${b.optionId}/${b.fileId}`)))
  const dirty = JSON.stringify(items) !== JSON.stringify(saved.items) || JSON.stringify(categories) !== JSON.stringify(saved.categories ?? legacyChoiceCategories(saved.items)) || JSON.stringify(costing) !== JSON.stringify(saved.costing ?? {}) || fileKey(optionFiles) !== fileKey(saved.optionFiles ?? [])
  const shared = Boolean(saved.sharedChoices) && JSON.stringify(saved.items) === JSON.stringify(saved.sharedChoices?.items) && JSON.stringify(saved.categories) === JSON.stringify(saved.sharedChoices?.categories) && fileKey(saved.optionFiles ?? []) === fileKey(saved.sharedFileRefs ?? [])
  const snapshot = useMemo(() => ({ items, categories, costing, optionFiles }), [items, categories, costing, optionFiles])
  const currentDraft = useRef(snapshot); currentDraft.current = snapshot
  function acknowledge(result: CustomerPlanning, submitted: CustomerPlanningSnapshot) {
    const next = retainNewerDraft(currentDraft.current, submitted, { items: result.items, categories: result.categories ?? legacyChoiceCategories(result.items), costing: result.costing ?? {}, optionFiles: result.optionFiles ?? [] })
    currentDraft.current = next
    setSaved(result); setItems(next.items); setCategories(next.categories); setCosting(next.costing); setOptionFiles(next.optionFiles)
    setConfirmed(false); onSaved(result)
  }
  const autosave = useCustomerPlanningAutosave({ initialRevision: initial.revision,
    save: async (submitted, revision) => {
      const response = await fetch(`/api/action-cases/${caseId}/customer-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
        body: JSON.stringify({ operation: 'save', revision, items: submitted.items, categories: submitted.categories,
          ...(saved.costingAvailable ? { costing: submitted.costing } : {}), ...(saved.filesAvailable ? { optionFiles: submitted.optionFiles } : {}) })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Val och tillval kunde inte sparas. Dina ändringar är kvar.')
      return result as CustomerPlanning
    }, onSaved: acknowledge, onError: error => toast.error(error, 'Val och tillval kunde inte sparas. Dina ändringar är kvar.')
  })
  const autosaveRef = useRef(autosave); autosaveRef.current = autosave
  useEffect(() => {
    if (!ready || (!dirty && !autosaveRef.current.isPending() && autosaveRef.current.state?.status !== 'error')) return
    autosaveRef.current.change(snapshot)
    if (immediateSave.current) { immediateSave.current = false; void autosaveRef.current.flush() }
  }, [ready, dirty, snapshot])
  const saving = dirty || autosave.isPending(), saveError = autosave.state?.status === 'error'
  useEffect(() => { onDirty(dirty || autosaveRef.current.isPending() || Boolean(busy)) }, [dirty, autosave.state, busy, onDirty])
  function changeItems(next: CustomerPlannedItem[]) { setItems(next); setConfirmed(false) }
  function changeCategories(next: CustomerChoiceCategory[]) { setCategories(next); setConfirmed(false) }
  function patchCategory(id: string, patch: Partial<CustomerChoiceCategory>) { changeCategories(categories.map((c) => c.id === id ? { ...c, ...patch } : c)) }
  function patchOption(id: string, patch: Partial<CustomerPlannedItem>) { changeItems(items.map((i) => i.id === id ? { ...i, ...patch } : i)) }
  function addOption(category: CustomerChoiceCategory) {
    const id = crypto.randomUUID()
    changeItems([...items, { id, title: '', scope: '', status: 'planned', budgetOre: null, decisionBy: '' }])
    patchCategory(category.id, { optionIds: [...category.optionIds, id] }); setExpandedOption(id)
  }
  function removeOption(id: string) {
    const category = categories.find((c) => c.optionIds.includes(id))
    if (!category) return
    immediateSave.current = true
    setRemoved({ categories: [category], items: items.filter((i) => i.id === id), costing: costing[id] ? { [id]: costing[id] } : {}, files: optionFiles.filter((r) => r.optionId === id), index: categories.indexOf(category) })
    setOptionFiles(optionFiles.filter((r) => r.optionId !== id)); setExpandedOption(null)
    changeItems(items.filter((item) => item.id !== id))
    setCosting(current => Object.fromEntries(Object.entries(current).filter(([key]) => key !== id)))
    changeCategories(categories.map((c) => ({ ...c, optionIds: c.optionIds.filter((optionId) => optionId !== id) })))
  }
  function removeCategory(id: string) {
    const category = categories.find((c) => c.id === id)
    if (!category) return
    immediateSave.current = true
    setRemoved({ categories: [category], items: categoryOptions(category, items), costing: Object.fromEntries(Object.entries(costing).filter(([key]) => category.optionIds.includes(key))), files: optionFiles.filter((r) => category.optionIds.includes(r.optionId)), index: categories.indexOf(category) })
    setOptionFiles(optionFiles.filter((r) => !category.optionIds.includes(r.optionId)))
    changeCategories(categories.filter((c) => c.id !== id))
    changeItems(items.filter((i) => !category.optionIds.includes(i.id)))
    setCosting(current => Object.fromEntries(Object.entries(current).filter(([key]) => !category.optionIds.includes(key))))
    setPendingDelete(null); setExpanded(null)
  }
  function moveOption(optionId: string, destination: string) {
    changeCategories(categories.map((category) => ({ ...category, optionIds: category.id === destination ? [...category.optionIds, optionId] : category.optionIds.filter((id) => id !== optionId) })))
    setExpanded(destination)
  }
  function restoreRemoved() {
    if (!removed) return
    const next = [...categories]
    for (const restored of removed.categories) {
      const existing = next.findIndex((c) => c.id === restored.id)
      if (existing < 0) next.splice(Math.min(removed.index, next.length), 0, restored)
      else {
        const optionIds = [...next[existing].optionIds]
        for (const restoredItem of removed.items.filter((item) => restored.optionIds.includes(item.id))) {
          if (optionIds.includes(restoredItem.id)) continue
          const following = restored.optionIds.slice(restored.optionIds.indexOf(restoredItem.id) + 1).find((id) => optionIds.includes(id))
          optionIds.splice(following ? optionIds.indexOf(following) : optionIds.length, 0, restoredItem.id)
        }
        next[existing] = { ...next[existing], optionIds }
      }
    }
    changeCategories(next)
    changeItems([...items, ...removed.items.filter((restored) => !items.some((i) => i.id === restored.id))])
    setOptionFiles([...optionFiles, ...removed.files.filter((r) => !optionFiles.some((f) => f.optionId === r.optionId && f.fileId === r.fileId))])
    setCosting((current) => ({ ...removed.costing, ...current })); setRemoved(null)
  }
  async function action(operation: 'share' | 'unshare') {
    if (!ready || running.current || saving || saveError) return false
    running.current = true; setBusy(operation)
    try {
      // Explicit sharing also accepts reviewed legacy category proposals, without a hidden write on opening.
      if (operation === 'share' && !structured) {
        autosave.change(currentDraft.current)
        if (!await autosave.flush()) return false
      }
      const submitted = currentDraft.current
      const response = await fetch(`/api/action-cases/${caseId}/customer-planning`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operation, revision: autosave.getRevision(), items: submitted.items, categories: submitted.categories,
          ...(saved.filesAvailable ? { optionFiles: submitted.optionFiles } : {}), confirmed })
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Kategorierna kunde inte sparas.')
      acknowledge(result, submitted); autosave.reset(result.revision)
      toast.success(operation === 'share' ? 'Kategorierna visas nu för beställaren. Avtalet är oförändrat.' : 'Val och tillval är nu interna.')
      return true
    } catch (error) { toast.error(error, 'Val och tillval kunde inte hanteras.'); return false }
    finally { running.current = false; setBusy('') }
  }
  async function refreshChoices() {
    if (saving || saveError || running.current) return
    running.current = true; setBusy('refresh')
    try {
      const response = await fetch(`/api/action-cases/${caseId}/customer-planning`, { cache: 'no-store' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Kundvalen kunde inte hämtas.')
      acknowledge(result, currentDraft.current); autosave.reset(result.revision)
    } catch (error) { toast.error(error, 'Kundvalen kunde inte hämtas.') }
    finally { running.current = false; setBusy('') }
  }
  if (!ready) return <section className="mx-auto max-w-5xl"><p role="status" className="border-l-4 border-amber-400 bg-amber-50 p-3 text-sm">Kategorier och kundval behöver aktiveras av administratören.</p><CustomerPlannedItems items={items} /></section>
  const incomplete = !categories.length || categories.some((c) => !c.title.trim() || !c.optionIds.length) || items.some((i) => !i.title.trim() || !i.scope.trim())
  return <section className="gizmo-choice-categories mx-auto max-w-5xl py-6 text-[#252A2D]" aria-label="Val och tillval">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-[#D5DCDD] pb-4">
      <div><h2 className="text-xl">Val och tillval</h2><p className="mt-2 text-sm text-[#596368]">Inte beställda · Påverkar inte avtalet</p></div>
      <div className="flex max-w-full flex-wrap items-center gap-3"><CustomerPlanningSaveStatus pending={saving || Boolean(busy)} error={saveError} refreshing={busy === 'refresh'} onRetry={() => void autosave.retry()} /><button type="button" className={iconButton} title="Uppdatera kundval" aria-label="Uppdatera kundval" disabled={Boolean(busy) || saving || saveError} onClick={() => void refreshChoices()}><RefreshCw size={17} /></button></div>
    </div>
    <fieldset disabled={!ready || Boolean(busy)} className="min-w-0 divide-y divide-[#D5DCDD] border-b border-[#D5DCDD]">
      {categories.map((category) => {
        const options = categoryOptions(category, items), choice = currentCategoryChoice(saved.sharedChoices, category.id)
        const chosen = saved.sharedChoices?.items.find((i) => i.id === choice?.optionId)
        const previous = saved.sharedChoices?.choices.find((c) => c.categoryId === category.id)
        const summary = [`${options.length} alternativ`, chosen ? `Kundens val: ${chosen.title}` : previous?.optionId ? 'Nytt kundval behövs' : 'Inget alternativ valt', category.decisionBy && `Beslut ${category.decisionBy}`].filter(Boolean).join(' · ')
        return <ProjectEditorRow key={category.id} title={category.title || 'Ny kategori'} summary={summary} open={expanded === category.id} onToggle={() => setExpanded(expanded === category.id ? null : category.id)}>
          <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px_auto]">
            <label className="text-sm">Kategori<input aria-label={`Kategori: ${category.title || 'Ny kategori'}`} className={field} value={category.title} maxLength={250} onChange={(e) => patchCategory(category.id, { title: e.target.value })} /></label>
            <label className="text-sm">Önskat beslutsdatum<input aria-label={`Beslutsdatum för ${category.title}`} className={field} type="date" max="9999-12-31" value={category.decisionBy} onChange={(e) => patchCategory(category.id, { decisionBy: e.target.value })} /></label>
            <button type="button" className={`${iconButton} sm:mt-6`} aria-label={`Ta bort kategori ${category.title}`} title="Ta bort kategori" onClick={() => setPendingDelete(category.id)}><Trash2 size={17} /></button>
            <label className="text-sm sm:col-span-3">Gemensam specifikation<textarea aria-label={`Specifikation för ${category.title}`} className={field} rows={3} maxLength={12000} value={category.specification} onChange={(e) => patchCategory(category.id, { specification: e.target.value })} /></label>
          </div>
          {pendingDelete === category.id && <div role="alert" className="mb-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm"><p>Ta bort kategorin {category.title} och dess {options.length} alternativ ur den interna planeringen?</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={button} onClick={() => setPendingDelete(null)}>Avbryt</button><button type="button" className={`${button} bg-white text-rose-700`} onClick={() => removeCategory(category.id)}><Trash2 size={16} /> Ta bort kategori</button></div></div>}
          <div className="flex justify-between gap-3 bg-[#EDF1F1] px-3 py-2 text-xs font-semibold"><span>Alternativ</span><span className="text-right">Prisunderlag inkl. moms</span></div>
          <div className="divide-y divide-[#D5DCDD]">
            {options.map((option) => <h4 key={option.id}><button type="button" className="flex min-h-12 w-full items-center gap-3 px-3 py-3 text-left text-sm hover:bg-[#F4F6F6]" aria-haspopup="dialog" aria-label={`Redigera ${option.title || 'Nytt alternativ'}`} onClick={() => setExpandedOption(option.id)}>
              <span className="min-w-0 flex-1 break-words font-semibold">{option.title || 'Nytt alternativ'}</span>{optionFiles.some((r) => r.optionId === option.id) && <span className="inline-flex shrink-0 items-center gap-1 text-xs text-[#596368]"><Paperclip size={14} /><span>{optionFiles.filter((r) => r.optionId === option.id).length} PDF</span></span>}<span className="shrink-0 text-right tabular-nums">{option.budgetOre === null ? 'Pris ej fastställt' : money(option.budgetOre)}</span><ChevronRight size={17} className="shrink-0" /></button></h4>)}
          </div>
          <button type="button" className={`${button} mt-3`} disabled={items.length >= 200} onClick={() => addOption(category)}><Plus size={16} /> Lägg till alternativ</button>
          {chosen && <p className="mt-3 text-sm text-[#596368]">Registrerat i delad version: {chosen.title}</p>}
        </ProjectEditorRow>
      })}
    </fieldset>
    {!categories.length && <p className="py-5 text-sm text-[#596368]">Inga kategorier har lagts till.</p>}
    <div className="flex flex-wrap gap-3 py-4">
      <button type="button" className={button} disabled={!ready || Boolean(busy) || categories.length >= 200} onClick={() => {
        const id = crypto.randomUUID(); changeCategories([...categories, { id, title: '', specification: '', decisionBy: '', optionIds: [] }]); setExpanded(id)
      }}><Plus size={17} /> Lägg till kategori</button>
      {removed && <button type="button" className={button} disabled={!ready || Boolean(busy)} onClick={restoreRemoved}><Undo2 size={17} /> Ångra borttagning</button>}
    </div>
    <section className="mt-2 border-t border-[#D5DCDD] py-4"><h3 className="font-semibold">Kundens vy</h3>
      <p className="mt-2 text-sm text-[#596368]">{saved.sharedItems.length ? `${saved.sharedChoices?.categories.length ?? legacyChoiceCategories(saved.sharedItems).length} kategorier visas för beställaren.` : 'Planeringen är intern.'}{saved.sharedItems.length && !shared ? ' Det finns ändringar som inte visas för beställaren.' : ''}</p>
      {!shared && categories.length > 0 && <label className="mt-4 flex items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#206961]" checked={confirmed} disabled={!ready || Boolean(busy) || saving || saveError} onChange={(e) => setConfirmed(e.target.checked)} />Jag har granskat kategorier, alternativ, kundpriser och PDF-bilagor för beställaren. Valen är inte beställningar och påverkar inte avtalet.</label>}
      <div className="mt-3 flex flex-wrap gap-3">
        {!shared && categories.length > 0 && <button type="button" className={button} disabled={!ready || Boolean(busy) || saving || saveError || !confirmed || incomplete} onClick={() => void action('share')}>{busy === 'share' ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />} Visa för beställaren</button>}
        {saved.sharedItems.length > 0 && <button type="button" className={button} disabled={!ready || Boolean(busy) || saving || saveError} onClick={() => void action('unshare')}>{busy === 'unshare' ? <Loader2 size={17} className="animate-spin" /> : <EyeOff size={17} />} Dölj val och tillval</button>}
      </div>
    </section>
    {items.filter((i) => i.id === expandedOption).map((option) => <CustomerChoiceOptionSheet key={option.id} caseId={caseId} option={option} categories={categories} files={projectFiles} references={optionFiles} filesAvailable={saved.filesAvailable === true} costing={costing[option.id]} costingAvailable={saved.costingAvailable === true} rowCostingAvailable={saved.rowCostingAvailable === true} busy={Boolean(busy)} saving={saving} saveError={saveError} onRetry={() => void autosave.retry()}
      onChange={(patch) => patchOption(option.id, patch)} onMove={(id) => moveOption(option.id, id)} onFiles={setProjectFiles}
      onReferences={(refs) => { setOptionFiles(refs); setConfirmed(false) }} onCosting={(value) => {
        setCosting({ ...costing, [option.id]: value }); setConfirmed(false)
        if (value.priceMode === 'calculated') {
          let budgetOre: number | null = null
          try { budgetOre = choiceCalculatedPrice(value.rows)?.grossOre ?? null } catch { /* Keep invalid draft editable; saving validates it. */ }
          patchOption(option.id, { budgetOre })
        }
      }} onRemove={() => removeOption(option.id)} onClose={() => setExpandedOption(null)} />)}
  </section>
}

// Previously shared, flat plans remain read-only until explicitly shared as categories.
export function CustomerPlannedItems({ items }: { items: CustomerPlannedItem[] }) {
  const [expanded, setExpanded] = useState<string | null>(null)
  return <section aria-label="Val och tillval" className="gizmo-choice-categories py-6"><h2 className="text-xl">Val och tillval</h2><p className="mt-2 text-sm text-[#596368]">Inte beställda · Påverkar inte avtalet</p>
    {legacyChoiceCategories(items).map((category) => <ProjectEditorRow key={category.id} title={category.title} summary={`${category.optionIds.length} alternativ · Inget val registrerat`} open={expanded === category.id} onToggle={() => setExpanded(expanded === category.id ? null : category.id)}>
      {categoryOptions(category, items).map((item) => <article key={item.id} className="border-b border-[#D5DCDD] py-3"><h4 className="font-semibold">{item.title}</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6">{item.scope}</p><p className="mt-2 text-sm">{item.budgetOre === null ? 'Pris ej fastställt' : `Prisunderlag: ${money(item.budgetOre)} inklusive moms`}</p></article>)}
    </ProjectEditorRow>)}
    {!items.length && <p className="mt-5 text-sm text-[#596368]">Inga val eller tillval har delats ännu.</p>}
  </section>
}
