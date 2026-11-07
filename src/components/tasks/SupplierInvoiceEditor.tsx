'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ClipboardPaste, FileText, Plus, Save, Trash2, Upload, X } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import { useToast } from '@/components/ui/AppToastProvider'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import type { InvoiceCostCategory, SupplierInvoice, SupplierInvoiceAllocation, SupplierInvoiceDraft, SupplierInvoiceSaveResult, SupplierInvoiceWorkspace } from '@/lib/supplier-invoices/contracts'
import { extractInvoiceText, formatInvoiceAmount, normalizeSupplierInvoiceDraft, parseInvoiceAmount } from '@/lib/supplier-invoices/domain'

const field = 'mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-950 disabled:bg-slate-50'
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50'
export const INVOICE_CATEGORIES: Record<InvoiceCostCategory, string> = { material: 'Material', subcontractor: 'Underentreprenör', waste: 'Avfall', transport: 'Transport', other: 'Övrigt' }
export const INVOICE_APPROVALS = { registered: 'Registrerad', approved: 'Granskad', disputed: 'Bestridd', void: 'Makulerad' } as const

export function invoiceToday() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
function inputAmount(ore: number) { return (ore / 100).toFixed(2).replace('.', ',') }
type AllocationForm = Omit<SupplierInvoiceAllocation, 'amountOre'> & { key: string; amount: string }
type Props = {
  initial: SupplierInvoice | null
  invoices: SupplierInvoice[]
  cases: ActionCaseView[]
  defaultCaseId?: string
  onClose: () => void
  onSaved: (workspace: SupplierInvoiceWorkspace) => void
}

function emptyDraft(): SupplierInvoiceDraft {
  return { supplierName: '', supplierOrgNumber: '', invoiceNumber: '', invoiceDate: invoiceToday(), dueDate: '', documentKind: 'invoice', creditReferenceInvoiceId: null, currency: 'SEK', netAmountOre: 0, vatAmountOre: 0, approvalStatus: 'registered', paymentStatus: 'unpaid', paidOn: null, notes: '', sourceText: '', allocations: [] }
}

type InvoiceResponse = SupplierInvoiceWorkspace & Partial<Pick<SupplierInvoiceSaveResult, 'saved'>>

async function readResponse(response: Response): Promise<InvoiceResponse> {
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || 'Kunde inte spara fakturan. Försök igen.')
  if (!Array.isArray(result.invoices)) throw new Error('Svaret kunde inte läsas. Uppdatera fakturavyn innan du försöker igen.')
  return result
}

export default function SupplierInvoiceEditor({ initial, invoices, cases, defaultCaseId, onClose, onSaved }: Props) {
  const toast = useToast()
  const [draft, setDraft] = useState<SupplierInvoiceDraft>(() => initial ?? emptyDraft())
  const [id] = useState(() => initial?.id ?? crypto.randomUUID())
  const [revision, setRevision] = useState(initial?.revision ?? 0)
  const [net, setNet] = useState(initial ? inputAmount(initial.netAmountOre) : '')
  const [vat, setVat] = useState(initial ? inputAmount(initial.vatAmountOre) : '0,00')
  const [allocations, setAllocations] = useState<AllocationForm[]>(() => initial?.allocations.map((a) => ({ ...a, key: crypto.randomUUID(), amount: inputAmount(a.amountOre) })) ?? (defaultCaseId ? [{ key: crypto.randomUUID(), caseId: defaultCaseId, itemId: null, category: 'other', description: '', amount: '' }] : []))
  const [files, setFiles] = useState<File[]>([])
  const [savedAttachments, setSavedAttachments] = useState(initial?.attachments ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pasteMessage, setPasteMessage] = useState('')
  const [reviewed, setReviewed] = useState(!initial?.sourceText)
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  closeRef.current = onClose
  busyRef.current = busy

  useEffect(() => {
    const oldOverflow = document.body.style.overflow
    const active = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLElement>('button, input')?.focus()
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]') ?? [])
      const first = focusable[0], last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', keyboard); active?.focus() }
  }, [])

  const update = <K extends keyof SupplierInvoiceDraft>(key: K, value: SupplierInvoiceDraft[K]) => setDraft((current) => ({ ...current, [key]: value }))
  const updateAllocation = (key: string, patch: Partial<AllocationForm>) => setAllocations((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row))
  const netOre = parseInvoiceAmount(net)
  const vatOre = parseInvoiceAmount(vat)
  const allocatedOre = allocations.reduce((total, row) => total + (parseInvoiceAmount(row.amount) ?? 0), 0)
  const remainingOre = (netOre ?? 0) - allocatedOre
  let normalized: SupplierInvoiceDraft | null = null
  try {
    normalized = normalizeSupplierInvoiceDraft({ ...draft, netAmountOre: netOre, vatAmountOre: vatOre, allocations: allocations.map(({ key, amount, ...row }) => ({ ...row, id: row.id ?? key, amountOre: parseInvoiceAmount(amount) })) })
  } catch { /* Native fields and the form explanation guide completion. Never submit partial amounts. */ }
  const canSave = Boolean(normalized) && (!draft.sourceText.trim() || reviewed)

  const applyPastedText = () => {
    const suggestions = extractInvoiceText(draft.sourceText)
    setDraft((current) => ({ ...current, ...suggestions, sourceText: current.sourceText }))
    if (suggestions.netAmountOre !== undefined) setNet(inputAmount(suggestions.netAmountOre))
    if (suggestions.vatAmountOre !== undefined) setVat(inputAmount(suggestions.vatAmountOre))
    setReviewed(false)
    setPasteMessage(Object.keys(suggestions).some((key) => key !== 'sourceText') ? 'Fält har fyllts från texten. Kontrollera leverantör, datum, belopp och moms mot fakturan före sparning.' : 'Inga säkra fält kunde hittas. Fyll i uppgifterna manuellt med texten som stöd.')
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || !canSave || !normalized) return
    setBusy(true)
    setError(null)
    let invoiceSaved = false
    try {
      let result = await readResponse(await fetch('/api/supplier-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'save', id, expectedRevision: revision, invoice: normalized }) }))
      // Only the exact revision returned by our command is safe for a later retry.
      // The accompanying workspace can already contain a concurrent writer's newer body.
      const saved = result.saved
      if (!saved || saved.id !== id || !Number.isSafeInteger(saved.revision) || saved.revision < 1) throw new Error('Fakturans sparversion kunde inte bekräftas. Stäng och öppna fakturan igen innan du fortsätter.')
      invoiceSaved = true
      setRevision(saved.revision)
      const visibleInvoice = result.invoices.find((invoice) => invoice.id === id)
      if (visibleInvoice) setSavedAttachments(visibleInvoice.attachments)
      onSaved(result)
      for (let index = 0; index < files.length; index++) {
        const body = new FormData()
        body.set('file', files[index])
        try {
          result = await readResponse(await fetch(`/api/supplier-invoices/${id}/attachments`, { method: 'POST', body }))
        } catch (caught) {
          setFiles(files.slice(index))
          throw caught
        }
        const latest = result.invoices.find((invoice) => invoice.id === id)
        // Attachment uploads do not change the invoice body revision.
        if (latest) setSavedAttachments(latest.attachments)
        onSaved(result)
      }
      setFiles([])
      toast.success(files.length ? 'Fakturan och valda bilagor har sparats.' : 'Fakturan har sparats.')
      onClose()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Kunde inte spara fakturan.'
      const finalMessage = invoiceSaved ? `Fakturan är sparad, men alla bilagor kunde inte laddas upp. ${message} Dina återstående filval är kvar.` : message
      setError(finalMessage)
      toast.error(finalMessage)
    } finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/45" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="invoice-editor-title" className="flex h-full w-full max-w-4xl flex-col bg-white shadow-2xl">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-5 sm:px-7">
        <div><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Leverantörsfaktura · SEK</p><h2 id="invoice-editor-title" className="mt-1 text-xl font-semibold text-slate-950">{revision ? 'Granska och redigera faktura' : 'Registrera leverantörsfaktura'}</h2><p className="mt-1 text-sm text-slate-500">Fördela kostnaden på projekt och åtgärder.</p></div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Stäng faktura" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 disabled:opacity-50"><X size={20} /></button>
      </header>
      <form onSubmit={(event) => void submit(event)} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <fieldset disabled={busy} className="space-y-7 disabled:opacity-75">
            <section className="rounded-xl border border-violet-200 bg-violet-50/50 p-4">
              <label className="block text-sm font-semibold text-slate-900">Klistra in fakturatext <span className="font-normal text-slate-500">(valfritt)</span><textarea value={draft.sourceText} onChange={(event) => { update('sourceText', event.target.value); setReviewed(false); setPasteMessage('') }} maxLength={50000} rows={4} placeholder="Kopiera text från en faktura eller ett mejl och klistra in här." className={`${field} resize-y bg-white`} /></label>
              <div className="mt-3 flex flex-wrap items-center gap-3"><button type="button" disabled={!draft.sourceText.trim()} onClick={applyPastedText} className={secondary}><ClipboardPaste size={17} /> Fyll fält från texten</button><p className="text-xs leading-5 text-slate-600">Textförslag behöver kontrolleras. Ingen automatisk bokföring sker.</p></div>
              {pasteMessage ? <p role="status" className="mt-3 text-sm leading-6 text-violet-900">{pasteMessage}</p> : null}
            </section>

            <section><h3 className="text-base font-semibold text-slate-950">Fakturauppgifter</h3>
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-semibold text-slate-700">Leverantör<input autoComplete="organization" required maxLength={200} value={draft.supplierName} onChange={(e) => update('supplierName', e.target.value)} className={field} /></label>
                <label className="text-sm font-semibold text-slate-700">Organisationsnummer <span className="font-normal text-slate-500">(valfritt)</span><input maxLength={40} value={draft.supplierOrgNumber} onChange={(e) => update('supplierOrgNumber', e.target.value)} className={field} /></label>
                <label className="text-sm font-semibold text-slate-700">Fakturanummer<input required maxLength={100} value={draft.invoiceNumber} onChange={(e) => update('invoiceNumber', e.target.value)} className={field} /></label>
                <label className="text-sm font-semibold text-slate-700">Dokumenttyp<select value={draft.documentKind} onChange={(e) => { update('documentKind', e.target.value as SupplierInvoiceDraft['documentKind']); if (e.target.value === 'invoice') update('creditReferenceInvoiceId', null) }} className={field}><option value="invoice">Faktura</option><option value="credit">Kreditfaktura</option></select></label>
                <label className="text-sm font-semibold text-slate-700">Fakturadatum<input required type="date" value={draft.invoiceDate} onChange={(e) => update('invoiceDate', e.target.value)} className={field} /></label>
                <label className="text-sm font-semibold text-slate-700">Förfallodatum<input required type="date" value={draft.dueDate} onChange={(e) => update('dueDate', e.target.value)} className={field} /></label>
                {draft.documentKind === 'credit' ? <label className="text-sm font-semibold text-slate-700 sm:col-span-2">Krediterar faktura <span className="font-normal text-slate-500">(valfritt)</span><select value={draft.creditReferenceInvoiceId ?? ''} onChange={(e) => update('creditReferenceInvoiceId', e.target.value || null)} className={field}><option value="">Ingen koppling vald</option>{invoices.filter((invoice) => invoice.id !== id && invoice.documentKind === 'invoice' && invoice.approvalStatus !== 'void').map((invoice) => <option key={invoice.id} value={invoice.id}>{invoice.supplierName} · {invoice.invoiceNumber}</option>)}</select></label> : null}
              </div>
            </section>

            <section><h3 className="text-base font-semibold text-slate-950">Belopp</h3><p className="mt-1 text-xs leading-5 text-slate-500">Ange beloppen i kronor. {draft.documentKind === 'credit' ? 'Ange kreditbelopp utan minustecken. Krediten dras av från kostnaderna.' : 'Momsen anges som belopp, så även fakturor med flera momssatser kan registreras.'}</p>
              <div className="mt-3 grid gap-4 sm:grid-cols-3">
                <label className="text-sm font-semibold text-slate-700">Exklusive moms<input required inputMode="decimal" value={net} onChange={(e) => setNet(e.target.value)} placeholder="0,00" aria-invalid={net.trim() && (netOre === null || netOre <= 0) ? true : undefined} className={`${field} tabular-nums`} />{net.trim() && (netOre === null || netOre <= 0) ? <span className="mt-1 block text-xs font-normal text-rose-700">Ange ett positivt belopp med högst två decimaler.</span> : null}</label>
                <label className="text-sm font-semibold text-slate-700">Moms<input required inputMode="decimal" value={vat} onChange={(e) => setVat(e.target.value)} placeholder="0,00" aria-invalid={vat.trim() && vatOre === null ? true : undefined} className={`${field} tabular-nums`} />{vat.trim() && vatOre === null ? <span className="mt-1 block text-xs font-normal text-rose-700">Ange momsbeloppet med högst två decimaler, eller 0.</span> : null}</label>
                <div className="rounded-xl bg-slate-50 px-4 py-3"><p className="text-xs font-semibold text-slate-500">Inklusive moms</p><p className="mt-2 text-lg font-semibold tabular-nums text-slate-950">{netOre !== null && vatOre !== null ? formatInvoiceAmount((netOre + vatOre) * (draft.documentKind === 'credit' ? -1 : 1)) : '–'}</p></div>
              </div>
            </section>

            <section><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-semibold text-slate-950">Fördela nettokostnaden</h3><p className="mt-1 text-xs leading-5 text-slate-500">En faktura kan delas mellan flera projekt och åtgärder.</p></div><button type="button" disabled={!cases.length || allocations.length >= 100} className={secondary} onClick={() => setAllocations((rows) => [...rows, { key: crypto.randomUUID(), caseId: defaultCaseId ?? cases[0]?.id ?? '', itemId: null, category: 'other', description: '', amount: remainingOre > 0 ? inputAmount(remainingOre) : '' }])}><Plus size={17} /> Lägg till fördelning</button></div>
              {!cases.length ? <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">Det finns inga åtgärdsärenden att fördela på ännu. Fakturan kan sparas och fördelas senare.</p> : null}
              <div className="mt-3 space-y-3">{allocations.map((row, index) => {
                const project = cases.find((c) => c.id === row.caseId)
                return <div key={row.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-slate-500">Fördelning {index + 1}</span><button type="button" onClick={() => setAllocations((rows) => rows.filter((a) => a.key !== row.key))} aria-label={`Ta bort fördelning ${index + 1}`} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700"><Trash2 size={16} /></button></div>
                  <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-semibold text-slate-600">Projekt / åtgärdsärende<select required value={row.caseId} onChange={(e) => updateAllocation(row.key, { caseId: e.target.value, itemId: null })} className={field}>{!project ? <option value={row.caseId}>{row.caseId ? 'Projektet är inte tillgängligt' : 'Välj projekt'}</option> : null}{cases.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-600">Åtgärd<select value={row.itemId ?? ''} onChange={(e) => updateAllocation(row.key, { itemId: e.target.value || null })} className={field}><option value="">Hela projektet</option>{row.itemId && !project?.items.some((item) => item.id === row.itemId) ? <option value={row.itemId}>Åtgärden är inte tillgänglig</option> : null}{project?.items.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-600">Kostnadsslag<select value={row.category} onChange={(e) => updateAllocation(row.key, { category: e.target.value as InvoiceCostCategory })} className={field}>{Object.entries(INVOICE_CATEGORIES).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
                    <label className="text-xs font-semibold text-slate-600">Belopp exkl. moms<input required inputMode="decimal" value={row.amount} onChange={(e) => updateAllocation(row.key, { amount: e.target.value })} className={`${field} tabular-nums`} /></label>
                    <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Beskrivning <span className="font-normal">(valfritt)</span><input maxLength={500} value={row.description} onChange={(e) => updateAllocation(row.key, { description: e.target.value })} className={field} /></label>
                  </div></div>
              })}</div>
              <div className={`mt-3 flex flex-wrap justify-between gap-2 rounded-lg px-3 py-3 text-sm ${remainingOre < 0 ? 'bg-rose-50 text-rose-800' : remainingOre > 0 ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'}`}><span>Fördelat: <strong className="tabular-nums">{formatInvoiceAmount(allocatedOre)}</strong></span><span>{remainingOre < 0 ? 'För mycket fördelat' : 'Kvar att fördela'}: <strong className="tabular-nums">{formatInvoiceAmount(Math.abs(remainingOre))}</strong></span></div>
              {remainingOre > 0 ? <p className="mt-2 text-xs leading-5 text-slate-500">Ofördelade belopp syns i fakturaregistret men räknas inte som kostnad i något projekt.</p> : null}
            </section>

            <section><h3 className="text-base font-semibold text-slate-950">Granskning och betalning</h3><div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-semibold text-slate-700">Granskningsstatus<select value={draft.approvalStatus} onChange={(e) => update('approvalStatus', e.target.value as SupplierInvoiceDraft['approvalStatus'])} className={field}>{Object.entries(INVOICE_APPROVALS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label className="text-sm font-semibold text-slate-700">Betalningsstatus<select value={draft.paymentStatus} onChange={(e) => { update('paymentStatus', e.target.value as SupplierInvoiceDraft['paymentStatus']); update('paidOn', e.target.value === 'paid' ? invoiceToday() : null) }} className={field}><option value="unpaid">Obetald / oreglerad</option><option value="paid">Betald / reglerad</option></select></label>
              {draft.paymentStatus === 'paid' ? <label className="text-sm font-semibold text-slate-700">Betalningsdatum<input required type="date" value={draft.paidOn ?? ''} onChange={(e) => update('paidOn', e.target.value || null)} className={field} /></label> : null}
            </div><p className="mt-2 text-xs leading-5 text-slate-500">Status anges manuellt. Granskad innebär att uppgifterna har kontrollerats; betalningsstatus uppdateras separat. Makulerade fakturor räknas inte i ekonomin.</p></section>

            <section><h3 className="text-base font-semibold text-slate-950">Fakturaunderlag</h3><p className="mt-1 text-xs leading-5 text-slate-500">PDF, JPEG, PNG eller WebP. Högst 4 MB per fil och 20 bilagor per faktura. Bilagorna är interna och delas inte i kundvyn.</p>
              {savedAttachments.length ? <ul className="mt-3 space-y-2">{savedAttachments.map((file) => <li key={file.id}><a target="_blank" rel="noreferrer" href={`/api/supplier-invoices/${id}/attachments/${file.id}`} className="inline-flex min-h-10 items-center gap-2 break-all text-sm font-semibold text-violet-700 underline underline-offset-4"><FileText size={16} className="shrink-0" />{file.fileName}</a></li>)}</ul> : null}
              <label className={`${secondary} mt-3 cursor-pointer`}><Upload size={17} /> Välj fakturafiler<input type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" disabled={busy} className="sr-only" onChange={(e) => { const chosen = Array.from(e.target.files ?? []); e.target.value = ''; if (chosen.some((file) => file.size > 4 * 1024 * 1024 || file.size === 0 || !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type))) { setError('Välj PDF, JPEG, PNG eller WebP, högst 4 MB per fil.'); return } if (savedAttachments.length + files.length + chosen.length > 20) { setError('En faktura kan ha högst 20 bilagor.'); return } setFiles((current) => [...current, ...chosen]); setError(null) }} /></label>
              {files.length ? <ul className="mt-3 space-y-1">{files.map((file, index) => <li key={`${file.name}:${index}`} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="min-w-0 truncate">{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-500" aria-label={`Ta bort fil ${file.name}`}><X size={16} /></button></li>)}</ul> : null}
            </section>

            <label className="block text-sm font-semibold text-slate-700">Intern anteckning<textarea rows={3} maxLength={5000} value={draft.notes} onChange={(e) => update('notes', e.target.value)} className={`${field} resize-y`} /></label>
            {draft.sourceText.trim() ? <label className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-slate-800"><input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-violet-700" />Jag har kontrollerat uppgifterna och beloppen mot fakturaunderlaget.</label> : null}
          </fieldset>
          {error ? <div role="alert" className="mt-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-900">{error}</div> : null}
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-7">
          <p className="max-w-sm text-xs leading-5 text-slate-500">{!canSave ? 'Fyll i leverantör, fakturanummer, datum och giltiga belopp. Fördelningen får inte överstiga nettobeloppet.' : files.length ? 'Fakturan sparas först, därefter laddas bilagorna upp.' : 'Fakturan sparas i organisationens interna register.'}</p><div className="flex gap-2"><button type="button" disabled={busy} onClick={onClose} className={secondary}>Avbryt</button><ActionButton type="submit" busy={busy} busyLabel={files.length ? 'Sparar faktura och bilagor…' : 'Sparar faktura…'} disabled={!canSave} icon={<Save size={17} />} tone="slate" className="min-h-11 rounded-lg px-4 py-2 text-sm font-semibold">Spara faktura</ActionButton></div>
        </footer>
      </form>
    </div>
  </div>
}
