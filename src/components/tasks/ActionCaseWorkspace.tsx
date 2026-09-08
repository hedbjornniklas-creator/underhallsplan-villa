'use client'

import { useMemo, useState } from 'react'
import {
  ArrowRight,
  Building2,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Hammer,
  Loader2,
  Mail,
  MapPin,
  PackageSearch,
  Plus,
  Search,
  Trash2,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ActionCaseItemView, ActionCaseView, ActionCaseWorkspace as Workspace } from '@/lib/action-cases/contracts'

type Props = {
  initialWorkspace: Workspace | null
  initialError: string | null
}

const CASE_STATUS: Record<ActionCaseView['status'], string> = {
  preparing: 'Samla underlag', pricing: 'Kalkyl pågår', quote_ready: 'Offert klar',
  awaiting_customer: 'Väntar på kund', approved: 'Godkänt', in_progress: 'Pågår',
  completed: 'Slutfört', cancelled: 'Avbrutet',
}

const ITEM_STATUS: Record<ActionCaseItemView['status'], string> = {
  scope_needed: 'Omfattning saknas', pricing_needed: 'Pris behövs',
  waiting_subcontractor: 'Väntar på UE', ready_for_quote: 'Klar för offert',
  offered: 'Offererad', approved: 'Godkänd', declined: 'Avböjd', scheduled: 'Planerad',
  in_progress: 'Pågår', ready_for_review: 'Klar för kontroll', completed: 'Slutförd', cancelled: 'Avbruten',
}

function nextAction(item: ActionCaseItemView) {
  if (!item.scope?.trim()) return 'Beskriv arbetets omfattning'
  if (!item.ownLaborReady) return 'Beräkna eget arbete'
  if (!item.materialPriceReady) return 'Kontrollera material och priser'
  if (item.requiresSubcontractor && !item.subcontractorPriceReady) return 'Begär eller registrera UE-pris'
  if (!item.wasteSolutionReady) return 'Välj avfallslösning'
  return 'Kontrollera kundpriset'
}

function completion(item: ActionCaseItemView) {
  const checks = [Boolean(item.scope), item.ownLaborReady, item.materialPriceReady, item.wasteSolutionReady]
  if (item.requiresSubcontractor) checks.push(item.subcontractorPriceReady)
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function CreateCaseSheet({ busy, onClose, onCreate }: { busy: boolean; onClose: () => void; onCreate: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState({ title: '', customerName: '', customerEmail: '', customerPhone: '', propertyAddress: '', sourceReference: '', description: '', siteVisitAt: '' })
  const [items, setItems] = useState([''])
  const update = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-slate-950/45 backdrop-blur-[2px] sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="new-action-case-title">
      <div className="flex max-h-[94dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-6">
          <div><p className="text-xs font-semibold uppercase text-violet-700">Nytt åtgärdsärende</p><h2 id="new-action-case-title" className="mt-1 text-xl font-semibold text-slate-950">Samla arbetena i ett ärende</h2></div>
          <button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Stäng"><X size={20} /></button>
        </header>
        <div className="overflow-y-auto px-5 py-5 sm:px-6">
          <section>
            <h3 className="text-sm font-semibold text-slate-950">Ärende och objekt</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Ärenderubrik *<input value={form.title} onChange={(e) => update('title', e.target.value)} placeholder="Exempel: Åtgärder efter besiktning" className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" /></label>
              <label className="text-sm font-medium text-slate-700 sm:col-span-2">Objektadress *<input value={form.propertyAddress} onChange={(e) => update('propertyAddress', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3 outline-none focus:border-violet-500 focus:ring-4 focus:ring-violet-100" /></label>
              <label className="text-sm font-medium text-slate-700">Datum för platsbesök<input type="datetime-local" value={form.siteVisitAt} onChange={(e) => update('siteVisitAt', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">Referens till utlåtande<input value={form.sourceReference} onChange={(e) => update('sourceReference', e.target.value)} placeholder="Rapportnummer eller länk" className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            </div>
          </section>
          <section className="mt-6 border-t border-slate-200 pt-5">
            <h3 className="text-sm font-semibold text-slate-950">Beställare</h3>
            <div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium text-slate-700">Namn *<input value={form.customerName} onChange={(e) => update('customerName', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">E-post<input type="email" value={form.customerEmail} onChange={(e) => update('customerEmail', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
              <label className="text-sm font-medium text-slate-700">Telefon<input value={form.customerPhone} onChange={(e) => update('customerPhone', e.target.value)} className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label>
            </div>
          </section>
          <section className="mt-6 border-t border-slate-200 pt-5">
            <div className="flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-950">Åtgärder *</h3><p className="mt-1 text-xs text-slate-500">En rad per arbete som kunden ska kunna välja separat.</p></div><button type="button" onClick={() => setItems((current) => [...current, ''])} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Plus size={16} /> Lägg till</button></div>
            <div className="mt-3 space-y-2">{items.map((item, index) => <div key={index} className="flex items-center gap-2"><span className="w-7 text-center text-sm font-semibold text-slate-400">{index + 1}</span><input value={item} onChange={(e) => setItems((current) => current.map((value, itemIndex) => itemIndex === index ? e.target.value : value))} placeholder="Beskriv arbetet kort" className="min-h-11 flex-1 rounded-lg border border-slate-300 px-3" /><button type="button" disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-30" aria-label="Ta bort åtgärd"><Trash2 size={17} /></button></div>)}</div>
          </section>
        </div>
        <footer className="flex justify-end gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6"><button type="button" onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm font-semibold text-slate-700">Avbryt</button><button type="button" disabled={busy || !form.title.trim() || !form.customerName.trim() || !form.propertyAddress.trim() || !items.some((item) => item.trim())} onClick={() => void onCreate({ ...form, siteVisitAt: form.siteVisitAt ? new Date(form.siteVisitAt).toISOString() : null, items })} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40">{busy ? <Loader2 className="animate-spin" size={17} /> : <ArrowRight size={17} />} Skapa ärende</button></footer>
      </div>
    </div>
  )
}

function ItemSheet({ item, busy, onClose, onSave }: { item: ActionCaseItemView; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const [form, setForm] = useState(item)
  const check = (key: keyof ActionCaseItemView, label: string, icon: React.ReactNode, disabled = false) => (
    <label className={`flex min-h-14 items-center gap-3 border-b border-slate-100 px-1 py-3 last:border-0 ${disabled ? 'opacity-50' : 'cursor-pointer'}`}><span className="text-slate-400">{icon}</span><span className="flex-1 text-sm font-medium text-slate-800">{label}</span><input type="checkbox" disabled={disabled} checked={Boolean(form[key])} onChange={(e) => setForm((current) => ({ ...current, [key]: e.target.checked }))} className="h-5 w-5 accent-violet-600" /></label>
  )
  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40" role="dialog" aria-modal="true"><div className="flex h-full w-full max-w-xl flex-col bg-white shadow-2xl"><header className="flex items-start justify-between border-b border-slate-200 px-5 py-5"><div><p className="text-xs font-semibold uppercase text-violet-700">Åtgärd {item.sortOrder / 100}</p><h2 className="mt-1 text-xl font-semibold text-slate-950">{item.title}</h2></div><button type="button" onClick={onClose} className="inline-flex h-10 w-10 items-center justify-center rounded-lg hover:bg-slate-100" aria-label="Stäng"><X size={20} /></button></header><div className="flex-1 overflow-y-auto px-5 py-5"><label className="text-sm font-semibold text-slate-800">Rubrik<input value={form.title} onChange={(e) => setForm((current) => ({ ...current, title: e.target.value }))} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3" /></label><label className="mt-5 block text-sm font-semibold text-slate-800">Arbetets omfattning<textarea value={form.scope ?? ''} onChange={(e) => setForm((current) => ({ ...current, scope: e.target.value }))} rows={6} placeholder="Vad ska göras, vad ingår och vilka förutsättningar gäller?" className="mt-2 w-full rounded-lg border border-slate-300 p-3 leading-6" /></label><div className="mt-6"><h3 className="text-sm font-semibold text-slate-950">Underlag för pris</h3><p className="mt-1 text-xs text-slate-500">Markera det som är kontrollerat. AI-stöd och prisrader kopplas in i nästa etapp.</p><div className="mt-2 border-y border-slate-200">{check('ownLaborReady', 'Egen arbetstid är beräknad', <Hammer size={18} />)}{check('materialPriceReady', 'Material och priser är kontrollerade', <PackageSearch size={18} />)}<label className="flex min-h-14 items-center gap-3 border-b border-slate-100 px-1 py-3"><span className="text-slate-400"><UsersRound size={18} /></span><span className="flex-1 text-sm font-medium text-slate-800">Underentreprenör behövs</span><input type="checkbox" checked={form.requiresSubcontractor} onChange={(e) => setForm((current) => ({ ...current, requiresSubcontractor: e.target.checked, subcontractorPriceReady: e.target.checked ? current.subcontractorPriceReady : false }))} className="h-5 w-5 accent-violet-600" /></label>{check('subcontractorPriceReady', 'UE-pris är mottaget och kontrollerat', <CircleDollarSign size={18} />, !form.requiresSubcontractor)}{check('wasteSolutionReady', 'Avfall och transport har en lösning', <Building2 size={18} />)}</div></div></div><footer className="border-t border-slate-200 bg-white p-4"><button type="button" disabled={busy || !form.title.trim()} onClick={() => void onSave({ itemId: item.id, title: form.title, scope: form.scope, ownLaborReady: form.ownLaborReady, materialPriceReady: form.materialPriceReady, requiresSubcontractor: form.requiresSubcontractor, subcontractorPriceReady: form.subcontractorPriceReady, wasteSolutionReady: form.wasteSolutionReady })} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-violet-700 px-5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50">{busy ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />} Spara åtgärden</button></footer></div></div>
}

export default function ActionCaseWorkspace({ initialWorkspace, initialError }: Props) {
  const toast = useToast()
  const [workspace, setWorkspace] = useState(initialWorkspace)
  const [error, setError] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedCaseId, setSelectedCaseId] = useState(initialWorkspace?.cases[0]?.id ?? null)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const selectedCase = workspace?.cases.find((item) => item.id === selectedCaseId) ?? null
  const selectedItem = selectedCase?.items.find((item) => item.id === selectedItemId) ?? null
  const filtered = useMemo(() => workspace?.cases.filter((item) => [item.title, item.customerName, item.propertyAddress].some((value) => value.toLocaleLowerCase('sv-SE').includes(search.toLocaleLowerCase('sv-SE')))) ?? [], [search, workspace])

  const action = async (name: string, payload: Record<string, unknown>) => {
    setBusy(true)
    try {
      const response = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name, payload }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Kunde inte spara.')
      setWorkspace(result.workspace)
      setError(null)
      if (name === 'create_case') setSelectedCaseId(result.workspace.cases[0]?.id ?? null)
      toast.success(name === 'create_case' ? 'Åtgärdsärendet skapades.' : 'Åtgärden sparades.')
    } catch (caught) { toast.error(caught instanceof Error ? caught.message : 'Kunde inte spara.') }
    finally { setBusy(false) }
  }

  if (!workspace) return <section className="mt-7 border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><ClipboardList className="mx-auto text-slate-400" /><h2 className="mt-3 text-lg font-semibold">Åtgärdsärenden är inte redo</h2><p className="mt-1 text-sm text-slate-500">{error}</p></section>

  return <>
    <section className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-6">{[
      ['Aktiva ärenden', workspace.summary.active], ['Behöver kalkyl', workspace.summary.pricingNeeded], ['Väntar på UE', workspace.summary.waitingSubcontractor], ['Väntar på kund', workspace.summary.awaitingCustomer], ['Klara att planera', workspace.summary.readyToSchedule], ['Klara att fakturera', workspace.summary.readyToInvoice],
    ].map(([label, value]) => <div key={label} className="border-b-2 border-slate-200 bg-white px-4 py-4"><strong className="block text-2xl text-slate-950">{value}</strong><span className="mt-1 block text-xs font-medium text-slate-500">{label}</span></div>)}</section>
    <section className="mt-7 overflow-hidden border border-slate-200 bg-white shadow-sm lg:grid lg:min-h-[620px] lg:grid-cols-[360px_minmax(0,1fr)]">
      <aside className="border-b border-slate-200 lg:border-b-0 lg:border-r"><div className="border-b border-slate-200 p-4"><div className="flex gap-2"><label className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Sök ärende" className="min-h-11 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm" /></label><button type="button" onClick={() => setCreating(true)} className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-slate-950 text-white" aria-label="Nytt åtgärdsärende"><Plus size={19} /></button></div></div><div>{filtered.map((item) => <button key={item.id} type="button" onClick={() => setSelectedCaseId(item.id)} className={`w-full border-b border-slate-100 px-4 py-4 text-left hover:bg-slate-50 ${selectedCaseId === item.id ? 'border-l-4 border-l-violet-600 bg-violet-50/50' : ''}`}><div className="flex items-start justify-between gap-3"><span className="font-semibold text-slate-950">{item.title}</span><ChevronRight size={17} className="mt-1 shrink-0 text-slate-400" /></div><p className="mt-1 truncate text-sm text-slate-600">{item.propertyAddress}</p><div className="mt-2 flex items-center justify-between text-xs"><span className="font-medium text-violet-700">{CASE_STATUS[item.status]}</span><span className="text-slate-400">{item.items.length} åtgärder</span></div></button>)}</div></aside>
      <div className="min-w-0">{selectedCase ? <><header className="border-b border-slate-200 px-5 py-5 sm:px-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div><p className="text-xs font-semibold uppercase text-violet-700">{CASE_STATUS[selectedCase.status]}</p><h2 className="mt-1 text-2xl font-semibold text-slate-950">{selectedCase.title}</h2><p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><MapPin size={16} /> {selectedCase.propertyAddress}</p></div><div className="rounded-lg bg-violet-50 px-4 py-3 text-sm text-violet-900"><strong className="block">Nästa steg</strong><span>Öppna den första ofullständiga åtgärden.</span></div></div><div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-slate-600"><span className="inline-flex items-center gap-2"><UserRound size={16} /> {selectedCase.customerName}</span>{selectedCase.customerEmail ? <span className="inline-flex items-center gap-2"><Mail size={16} /> {selectedCase.customerEmail}</span> : null}</div></header><div className="px-5 py-5 sm:px-6"><div className="flex items-end justify-between"><div><h3 className="text-lg font-semibold text-slate-950">Åtgärder</h3><p className="mt-1 text-sm text-slate-500">Öppna en rad för att komplettera omfattning och prisunderlag.</p></div><span className="text-sm font-semibold text-slate-500">{selectedCase.items.filter((item) => completion(item) === 100).length}/{selectedCase.items.length} kalkylklara</span></div><div className="mt-4 overflow-hidden rounded-lg border border-slate-200">{selectedCase.items.map((item, index) => <button key={item.id} type="button" onClick={() => setSelectedItemId(item.id)} className="grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 border-b border-slate-100 px-3 py-4 text-left last:border-0 hover:bg-slate-50 sm:grid-cols-[40px_minmax(0,1fr)_140px_auto]"><span className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-sm font-semibold text-slate-600">{index + 1}</span><span className="min-w-0"><strong className="block truncate text-sm text-slate-950">{item.title}</strong><span className="mt-1 block truncate text-xs text-slate-500">Nästa: {nextAction(item)}</span></span><span className="hidden sm:block"><span className="block h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full bg-violet-600" style={{ width: `${completion(item)}%` }} /></span><span className="mt-1 block text-right text-[11px] font-medium text-slate-500">{completion(item)} %</span></span><span className="inline-flex items-center gap-2 text-xs font-semibold text-violet-700">{ITEM_STATUS[item.status]} <ChevronRight size={17} /></span></button>)}</div></div></> : <div className="flex min-h-[500px] items-center justify-center text-sm text-slate-500">Välj ett ärende i listan.</div>}</div>
    </section>
    {creating ? <CreateCaseSheet busy={busy} onClose={() => setCreating(false)} onCreate={async (payload) => { await action('create_case', payload); setCreating(false) }} /> : null}
    {selectedItem ? <ItemSheet item={selectedItem} busy={busy} onClose={() => setSelectedItemId(null)} onSave={async (payload) => { await action('update_item', payload); setSelectedItemId(null) }} /> : null}
  </>
}
