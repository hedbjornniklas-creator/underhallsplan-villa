'use client'
import { useProjectSaveProtection } from './ProjectSaveProtection'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, ExternalLink, FileText, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { ProjectInvoiceWorkspace, SupplierInvoice, SupplierInvoiceAllocation, SupplierInvoiceDraft } from '@/lib/supplier-invoices/contracts'
import { formatInvoiceAmount as money, normalizeSupplierInvoiceDraft, parseInvoiceAmount, invoiceSignedAmount } from '@/lib/supplier-invoices/domain'
import { useQuestionAutosave } from './useQuestionAutosave'
import SupplierInvoicePdfPreview from './SupplierInvoicePdfPreview'
import './project-supplier-invoices.css'

const field = 'psi-field'
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Stockholm' })
const amountText = (ore: number) => String(ore / 100).replace('.', ',')
const categories = { material: 'Material', subcontractor: 'Underentreprenör', waste: 'Avfall', transport: 'Transport', other: 'Övrigt' }
type Row = Omit<SupplierInvoiceAllocation, 'amountOre'> & { id: string; amount: string }
type Form = Omit<SupplierInvoiceDraft, 'netAmountOre' | 'vatAmountOre' | 'allocations'> & { net: string; vat: string; rows: Row[]; distribution: 'whole' | 'split'; identityVersion: number }
function formOf(invoice: SupplierInvoice | null, caseId: string): Form {
  const draft: SupplierInvoiceDraft = invoice ?? { supplierName: '', supplierOrgNumber: '', invoiceNumber: '', invoiceDate: today(), dueDate: '', documentKind: 'invoice', creditReferenceInvoiceId: null, currency: 'SEK', netAmountOre: 0, vatAmountOre: 0, approvalStatus: 'registered', paymentStatus: 'unpaid', paidOn: null, notes: '', sourceText: '', allocations: [] }
  const rows: Row[] = draft.allocations.map(({ amountOre, ...a }) => ({ ...a, id: a.id ?? crypto.randomUUID(), amount: amountText(amountOre) }))
  const other = rows.filter(r => r.caseId !== caseId).reduce((sum, r) => sum + (parseInvoiceAmount(r.amount) ?? 0), 0)
  const allocated = rows.reduce((sum, r) => sum + (parseInvoiceAmount(r.amount) ?? 0), 0)
  // Project registration always accounts for the invoice remainder, even before a moment is known.
  if (!invoice || allocated < draft.netAmountOre && other === 0) rows.push({ id: crypto.randomUUID(), caseId, itemId: null, changeId: null, category: 'other', description: '', amount: invoice ? amountText(draft.netAmountOre - allocated) : '' })
  return { ...draft, identityVersion: invoice && (invoice.allocations.some(a => !a.id) || allocated < draft.netAmountOre) ? 0 : 1, net: invoice ? amountText(draft.netAmountOre) : '', vat: invoice ? amountText(draft.vatAmountOre) : '', rows,
    distribution: rows.filter(r => r.caseId === caseId).length === 1 && (!invoice || allocated === draft.netAmountOre || other === 0) ? 'whole' : 'split' }
}
function parsed(form: Form): SupplierInvoiceDraft {
  const result = normalizeSupplierInvoiceDraft({ ...form, netAmountOre: parseInvoiceAmount(form.net), vatAmountOre: parseInvoiceAmount(form.vat), allocations: form.rows.map(({ amount, ...row }) => ({ ...row, amountOre: parseInvoiceAmount(amount) })) })
  if (result.allocations.reduce((sum, a) => sum + a.amountOre, 0) !== result.netAmountOre) throw new Error('INVOICE_ALLOCATION_INVALID')
  return result
}
async function json(response: Response) {
  let result
  try { result = await response.json() } catch { throw new Error('Svaret kunde inte läsas. Dina uppgifter finns kvar. Försök igen.') }
  if (!response.ok) throw new Error(result.error || 'Åtgärden kunde inte bekräftas. Försök igen.')
  return result
}
const fileValid = (file: File) => file.size > 0 && file.size <= 4 * 1024 * 1024 && /\.(pdf|jpe?g|png|webp)$/i.test(file.name)

export default function ProjectSupplierInvoices({ caseId, active, onDirty, onBasis, basisBlocked = false, items = [] }: { caseId: string; active: boolean; onDirty: (dirty: boolean) => void; onBasis: (id: string) => void; basisBlocked?: boolean; items?: { id: string; estimatedCost: number | null }[] }) {
  const [data, setData] = useState<ProjectInvoiceWorkspace | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [page, setPage] = useState(0)
  const [recovery, setRecovery] = useState<string | null>(null)
  const [editor, setEditor] = useState<{ id: string; invoice: SupplierInvoice | null; file: File | null } | null>(null), [queued, setQueued] = useState<File[]>([])
  const token = useRef(0), input = useRef<HTMLInputElement>(null), dirty = useRef(false)
  useEffect(() => { if (!editor) { dirty.current = false; onDirty(false) } }, [editor, onDirty])
  const load = useCallback(async () => {
    const current = ++token.current; setLoading(true); setError('')
    try {
      const result = await json(await fetch(`/api/action-cases/${caseId}/supplier-invoices`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) }))
      if (current !== token.current) return
      setData(result)
      try { setRecovery(localStorage.getItem(`supplier-invoice:${result.userId}:${caseId}:pending`)) } catch { /* Local draft support is optional. */ }
    }
    catch (e) { if (current === token.current) setError((e as Error).message) } finally { if (current === token.current) setLoading(false) }
  }, [caseId])
  useEffect(() => { if (active && !dirty.current) void load(); return () => { token.current++ } }, [active, load])
  function begin(files: File[] = []) {
    if (editor || !data) return
    if (recovery) { setError('Det finns ett osparat fakturautkast. Öppna utkastet innan du registrerar en ny faktura.'); return }
    if (files.some(f => !fileValid(f))) { setError('Välj PDF, JPG, PNG eller WebP, högst 4 MB per fil. Inga filer har lagts till.'); return }
    setQueued(files.slice(1)); setEditor({ id: crypto.randomUUID(), invoice: null, file: files[0] ?? null })
  }
  const live = data?.invoices.filter(i => i.approvalStatus !== 'void') ?? []
  const projectRows = (invoice: SupplierInvoice) => invoice.allocations.filter(a => a.caseId === caseId)
  const cost = (invoice: SupplierInvoice) => invoiceSignedAmount(invoice, projectRows(invoice).reduce((sum, a) => sum + a.amountOre, 0))
  const total = live.reduce((sum, i) => sum + cost(i), 0)
  const common = live.reduce((sum, i) => sum + invoiceSignedAmount(i, projectRows(i).filter(a => !a.itemId && !a.changeId).reduce((s, a) => s + a.amountOre, 0)), 0)
  const list = data?.invoices.filter(i => `${i.supplierName} ${i.invoiceNumber}`.toLocaleLowerCase('sv').includes(search.toLocaleLowerCase('sv')) && (filter === 'all' || filter === 'unassigned' && projectRows(i).some(a => !a.itemId && !a.changeId) || filter === 'missing' && !i.attachments.length || filter === 'credit' && i.documentKind === 'credit')) ?? []
  const closed = data?.status === 'completed' || data?.status === 'cancelled'
  return <section className="psi" aria-label="Leverantörsfakturor" onDragOver={e => { if (!closed && !editor) e.preventDefault() }} onDrop={e => { e.preventDefault(); if (!closed) begin(Array.from(e.dataTransfer.files)) }}>
    <header className="psi-toolbar"><h3>Leverantörsfakturor</h3><div><button type="button" className="gizmo-text-button" aria-label="Uppdatera leverantörsfakturor" title="Uppdatera" disabled={loading || !!editor} onClick={() => void load()}><RefreshCw size={17} /></button><button type="button" className="gizmo-button" disabled={!data || !!editor || closed} onClick={() => input.current?.click()}><Upload size={17} />Lägg till fakturor</button><button type="button" className="gizmo-text-button" disabled={!data || !!editor || closed} onClick={() => begin()}><Plus size={17} />Registrera</button></div></header>
    <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple hidden onChange={e => { begin(Array.from(e.target.files ?? [])); e.target.value = '' }} />
    {recovery && data && !editor && <button type="button" className="gizmo-button" onClick={() => { setEditor({ id: recovery, invoice: data.invoices.find(i => i.id === recovery) ?? null, file: null }); setRecovery(null); setError('') }}>Öppna osparat fakturautkast</button>}
    {error && <p role="alert" className="psi-error">{error}<button type="button" className="gizmo-text-button" onClick={() => void load()}>Försök igen</button></p>}
    {loading && !data && <p role="status">Hämtar fakturor…</p>}
    {data && <>
      <dl className="psi-summary"><div><dt>Leverantörskostnad exkl. moms</dt><dd>{money(total)}</dd></div><div><dt>Gemensamt / ej momentfördelat</dt><dd>{money(common)}</dd></div><div><dt>Original saknas</dt><dd>{live.filter(i => !i.attachments.length).length} fakturor</dd></div></dl>
      <div className="psi-filters"><label><Search size={17} /><input aria-label="Sök leverantör eller fakturanummer" placeholder="Leverantör eller fakturanummer" value={search} onChange={e => { setSearch(e.target.value); setPage(0) }} /></label><select aria-label="Filtrera fakturor" className={field} value={filter} onChange={e => { setFilter(e.target.value); setPage(0) }}><option value="all">Alla fakturor</option><option value="unassigned">Ej momentfördelade</option><option value="missing">Original saknas</option><option value="credit">Kreditfakturor</option></select></div>
      <div className="psi-table-wrap"><table><caption className="sr-only">Projektets leverantörsfakturor, belopp exklusive moms</caption><thead><tr><th>Leverantör / fakturanummer</th><th>Datum</th><th>Projektkostnad exkl. moms</th><th>Fördelning</th><th>Underlag</th></tr></thead><tbody>{list.slice(page * 25, page * 25 + 25).map(i => <tr key={i.id} onClick={() => setEditor({ id: i.id, invoice: i, file: null })}><td><button type="button" className="psi-open" onClick={e => { e.stopPropagation(); setEditor({ id: i.id, invoice: i, file: null }) }}>{i.supplierName}<small>{i.documentKind === 'credit' ? 'Kredit · ' : ''}{i.invoiceNumber}{i.approvalStatus === 'void' ? ' · Makulerad' : i.approvalStatus === 'disputed' ? ' · Bestridd' : ''}</small></button></td><td>{i.invoiceDate}</td><td className="psi-money">{money(cost(i))}</td><td>{projectRows(i).map(a => data.targets.find(t => t.id === (a.changeId || a.itemId))?.title ?? (a.changeId || a.itemId ? 'Tidigare moment / ÄTA' : 'Gemensamt')).filter((v, n, a) => a.indexOf(v) === n).join(', ')}</td><td>{i.attachments.length ? <FileText size={17} aria-label="Original finns" /> : 'Original saknas'}</td></tr>)}</tbody></table></div>
      {!list.length && <p className="psi-empty">{search || filter !== 'all' ? 'Inga fakturor matchar urvalet.' : 'Inga leverantörsfakturor registrerade.'}</p>}
      {list.length > 25 && <div className="psi-toolbar"><button type="button" className="gizmo-text-button" disabled={!page} onClick={() => setPage(p => p - 1)}>Föregående</button><span>{page + 1} / {Math.ceil(list.length / 25)}</span><button type="button" className="gizmo-text-button" disabled={(page + 1) * 25 >= list.length} onClick={() => setPage(p => p + 1)}>Nästa</button></div>}
      <details className="psi-economy"><summary>Kostnader per moment och ÄTA</summary><div className="psi-table-wrap"><table><thead><tr><th>Moment / ÄTA</th><th>Intern kalkyl exkl. moms</th><th>Leverantörskostnad exkl. moms</th><th>Skillnad exkl. moms</th></tr></thead><tbody>{data.targets.map(t => {
        const estimate = items.find(i => i.id === t.id)?.estimatedCost, estimateOre = estimate == null ? null : Math.round(estimate * 100)
        const actual = live.reduce((sum, i) => sum + invoiceSignedAmount(i, projectRows(i).filter(a => (a.changeId || a.itemId) === t.id).reduce((s, a) => s + a.amountOre, 0)), 0)
        return <tr key={`${t.kind}:${t.id}`}><th>{t.kind === 'change' ? 'ÄTA · ' : ''}{t.title}</th><td className="psi-money">{estimateOre === null ? '—' : money(estimateOre)}</td><td className="psi-money">{money(actual)}</td><td className="psi-money">{estimateOre === null ? '—' : money(estimateOre - actual)}</td></tr>
      })}<tr><th>Gemensamt / ej momentfördelat</th><td /><td className="psi-money">{money(common)}</td><td /></tr><tr><th>Summa projektkostnad</th><td /><td className="psi-money">{money(total)}</td><td /></tr></tbody></table></div><p className="psi-muted">Utfallet omfattar registrerade leverantörskostnader. Eget arbete och framtida kostnader ingår inte. Skillnaden är ingen slutkostnadsprognos.</p></details>
    </>}
    {editor && data && <ProjectSupplierInvoicePanel key={editor.id} {...editor} caseId={caseId} workspace={data} more={queued.length} basisBlocked={basisBlocked} onDirty={value => { dirty.current = value; onDirty(value) }} onSaved={(invoice, fresh) => setData(d => fresh ?? (d ? { ...d, invoices: [invoice, ...d.invoices.filter(i => i.id !== invoice.id)] } : d))} onBasis={id => { setEditor(null); onBasis(id); void load() }} onClose={() => { setEditor(null); dirty.current = false; onDirty(false); void load() }} onNext={() => { const next = queued[0]; setQueued(q => q.slice(1)); setEditor({ id: crypto.randomUUID(), invoice: null, file: next }) }} />}
  </section>
}

function ProjectSupplierInvoicePanel({ id, invoice, file, caseId, workspace, more, basisBlocked, onDirty, onSaved, onClose, onNext, onBasis }: { id: string; invoice: SupplierInvoice | null; file: File | null; caseId: string; workspace: ProjectInvoiceWorkspace; more: number; basisBlocked: boolean; onDirty: (value: boolean) => void; onSaved: (invoice: SupplierInvoice, fresh?: ProjectInvoiceWorkspace) => void; onClose: () => void; onNext: () => void; onBasis: (id: string) => void }) {
  const [form, setForm] = useState<Form>(() => formOf(invoice, caseId)), [files, setFiles] = useState(invoice?.attachments ?? [])
  const [pendingFile, setPendingFile] = useState<File | null>(file), [uploading, setUploading] = useState(false), [uploadError, setUploadError] = useState(''), [error, setError] = useState('')
  const [preview, setPreview] = useState(''), [basisBusy, setBasisBusy] = useState(false)
  const panel = useRef<HTMLDivElement>(null), fileInput = useRef<HTMLInputElement>(null), uploadingRef = useRef(false)
  const valid = (value: Form) => { try { parsed(value); return true } catch { return false } }
  const autosave = useQuestionAutosave<Form>({ valid, staleMessage: 'Fakturan har ändrats i en annan flik. Hämta sparad faktura innan du fortsätter.', save: async attempt => {
    const result = await json(await fetch('/api/supplier-invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'save', id, expectedRevision: attempt.revision, invoice: parsed(attempt.value) }), signal: AbortSignal.timeout(45_000) }))
    if (result.saved?.id !== id || result.saved?.revision !== attempt.revision + 1) throw new Error('Sparningen kunde inte bekräftas.')
  }, onSaved: (value, revision) => onSaved({ ...parsed(value), id, revision, source: invoice?.source ?? 'manual', externalId: invoice?.externalId ?? null, createdAt: invoice?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), attachments: files }) })
  const close = useRef<() => void>(() => {}), aRef = useRef(autosave); aRef.current = autosave
  useEffect(() => { const restored = aRef.current.seed(`supplier-invoice:${workspace.userId}:${caseId}:${id}`, formOf(invoice, caseId), invoice?.revision ?? 0); if (restored) setForm(restored) }, [caseId, id, invoice, workspace.userId])
  // Existing rows acquire stable identifiers only when the invoice is actually edited.
  useEffect(() => { onDirty(autosave.dirty || autosave.busy || uploading || !!pendingFile || basisBusy) }, [autosave.dirty, autosave.busy, uploading, pendingFile, basisBusy, onDirty])
  useEffect(() => {
    const key = `supplier-invoice:${workspace.userId}:${caseId}:pending`
    try { if (autosave.dirty) localStorage.setItem(key, id); else if (localStorage.getItem(key) === id) localStorage.removeItem(key) } catch { /* The queue reports local persistence failures separately. */ }
  }, [autosave.dirty, caseId, id, workspace.userId])
  useEffect(() => {
    const old = document.body.style.overflow, focus = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'; panel.current?.querySelector<HTMLElement>('button')?.focus()
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); close.current() }
      if (e.key !== 'Tab') return
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]') ?? []).filter(n => n.offsetParent !== null)
      if (e.shiftKey && document.activeElement === nodes[0]) { e.preventDefault(); nodes.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === nodes.at(-1)) { e.preventDefault(); nodes[0]?.focus() }
    }
    document.addEventListener('keydown', key); return () => { document.body.style.overflow = old; document.removeEventListener('keydown', key); focus?.focus() }
  }, [])
  useProjectSaveProtection({ label: `Betalning och fakturering · Leverantörsfaktura${invoice?.invoiceNumber ? ` ${invoice.invoiceNumber}` : ''}`,
    pending: autosave.dirty || Boolean(pendingFile) || uploading || basisBusy || more > 0, lossRisk: Boolean(pendingFile) || uploading || basisBusy || more > 0 || !autosave.local,
    detail: pendingFile ? `${pendingFile.name} är inte uppladdad.` : more ? `${more} filer återstår i uppladdningskön.` : autosave.error || 'Fakturautkastet finns på den här enheten.', view: 'payments',
    flush: async () => !uploadingRef.current && !basisBusy && !pendingFile && more === 0 && await aRef.current.flush() })
  useEffect(() => { if (!pendingFile) { setPreview(''); return }; const url = URL.createObjectURL(pendingFile); setPreview(url); return () => URL.revokeObjectURL(url) }, [pendingFile])
  const readOnly = workspace.status === 'completed' || workspace.status === 'cancelled' || invoice?.source === 'fortnox'
  const linked = workspace.links.filter(l => l.invoiceId === id), claims = workspace.billingClaims?.filter(c => c.invoiceId === id && c.protected) ?? []
  const protectedIds = new Set([...linked, ...claims].map(l => l.allocationId)), financialLocked = linked.length > 0 || claims.length > 0
  function edit(next: Form) {
    if (readOnly) return
    next = { ...next, identityVersion: 1 }
    if (next.distribution === 'whole') {
      const foreign = next.rows.filter(r => r.caseId !== caseId).reduce((s, r) => s + (parseInvoiceAmount(r.amount) ?? 0), 0), net = parseInvoiceAmount(next.net)
      next = { ...next, rows: next.rows.map(r => r.caseId === caseId ? { ...r, amount: net === null ? '' : amountText(Math.max(0, net - foreign)) } : r) }
    }
    setForm(next); autosave.change(next)
  }
  async function leave(next = false) {
    if (uploadingRef.current || basisBusy) return
    const saved = await autosave.flush()
    if (saved) clearPendingDraft()
    if ((!saved && !autosave.isLocal() || pendingFile || more && !next) && !window.confirm(pendingFile ? 'Filen är inte uppladdad. Stäng ändå? Filen måste väljas på nytt.' : more && !next ? `${more} filer återstår att registrera. Stäng kön?` : 'Fakturans textändringar är inte sparade och kunde inte lagras lokalt. Stäng ändå?')) return
    if (next) onNext(); else onClose()
  }
  function clearPendingDraft() {
    const key = `supplier-invoice:${workspace.userId}:${caseId}:pending`
    try { if (localStorage.getItem(key) === id) localStorage.removeItem(key) } catch { /* Server confirmation remains authoritative. */ }
  }
  close.current = () => { void leave() }
  async function reloadSaved() {
    if (autosave.busy || uploading || basisBusy || !window.confirm('Hämta sparad faktura och kasta lokala textändringar?')) return
    setError('')
    try {
      const fresh = await json(await fetch(`/api/action-cases/${caseId}/supplier-invoices`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })) as ProjectInvoiceWorkspace
      const saved = fresh.invoices.find(i => i.id === id) ?? null
      const value = autosave.seed(`supplier-invoice:${workspace.userId}:${caseId}:${id}`, formOf(saved, caseId), saved?.revision ?? 0, true)
      if (value) setForm(value)
      setFiles(saved?.attachments ?? [])
      if (saved) onSaved(saved, fresh)
    } catch (e) { setError((e as Error).message) }
  }
  async function upload() {
    if (!pendingFile || uploadingRef.current) return
    uploadingRef.current = true; setUploading(true); setUploadError('')
    try {
      if (!(await autosave.flush()) || !autosave.revision()) return
      const body = new FormData(); body.set('file', pendingFile)
      await json(await fetch(`/api/supplier-invoices/${id}/attachments`, { method: 'POST', body, signal: AbortSignal.timeout(60_000) }))
      const fresh = await json(await fetch(`/api/action-cases/${caseId}/supplier-invoices`, { cache: 'no-store' })), saved = fresh.invoices.find((i: SupplierInvoice) => i.id === id)
      if (!saved) throw new Error('Filen laddades upp, men fakturan kunde inte läsas. Uppdatera listan innan du försöker igen.')
      setFiles(saved.attachments); setPendingFile(null); onSaved(saved)
    } catch (e) { setUploadError((e as Error).message) } finally { uploadingRef.current = false; setUploading(false) }
  }
  const uploadRef = useRef(upload); uploadRef.current = upload
  const revision = autosave.revision()
  useEffect(() => { if (pendingFile && revision > 0 && !autosave.dirty && !autosave.busy && !uploadError && !readOnly) void uploadRef.current() }, [pendingFile, revision, autosave.dirty, autosave.busy, uploadError, readOnly])
  const net = parseInvoiceAmount(form.net), vat = parseInvoiceAmount(form.vat)
  const missing = [!form.supplierName.trim() && 'leverantör', !form.invoiceNumber.trim() && 'fakturanummer', !form.invoiceDate && 'datum', net === null && 'belopp exkl. moms', vat === null && 'momsbelopp'].filter(Boolean)
  const remaining = (net ?? 0) - form.rows.reduce((sum, r) => sum + (parseInvoiceAmount(r.amount) ?? 0), 0)
  const rows = form.rows.filter(r => r.caseId === caseId)
  const target = (row: Row) => workspace.targets.find(t => t.id === (row.changeId || row.itemId))
  const formValid = valid(form)
  const saved = autosave.revision() > 0 && !autosave.dirty && !autosave.busy && !autosave.error && !pendingFile && !uploading && !uploadError
  const assigned = rows.every(r => r.itemId || r.changeId)
  const fixedOnly = rows.length > 0 && rows.every(r => target(r)?.mode === 'fixed')
  const blockers = missing.length ? `Fyll i ${missing.join(', ')}.` : !formValid ? 'Kontrollera fakturauppgifterna och att hela nettobeloppet är fördelat.' : uploadError || autosave.error || (uploading ? 'Originalet laddas upp.' : autosave.busy || autosave.dirty ? 'Vänta tills fakturan är sparad.' : pendingFile ? 'Originalet väntar på uppladdning.' : !files.length ? 'Lägg till fakturans original före kunddebitering.' : basisBlocked ? 'Spara pågående ändringar i faktureringen först.' : '')
  const steps = [
    { title: 'Faktura', complete: files.length > 0 && !pendingFile, detail: uploading ? 'Laddar upp' : pendingFile ? 'Vald på denna enhet' : files.length ? 'Original uppladdat' : 'Original saknas' },
    { title: 'Uppgifter', complete: missing.length === 0, detail: missing.length ? `${missing.length} uppgifter saknas` : 'Ifyllda' },
    { title: 'Fördelning', complete: formValid, detail: !formValid ? 'Kontrollera beloppen' : assigned ? 'Moment / ÄTA valt' : 'Gemensam kostnad' },
    { title: 'Sparat', complete: saved, detail: saved ? 'Finns i projektet' : autosave.error || uploadError ? 'Behöver åtgärdas' : 'Inte klart' },
  ]
  async function reviewBasis() {
    if (basisBlocked) { setError('Spara eller återställ pågående ändringar i Fakturaunderlag först.'); return }
    setBasisBusy(true); setError('')
    try {
      if (form.identityVersion === 0) {
        const upgraded = { ...form, identityVersion: 1 }
        setForm(upgraded); autosave.change(upgraded)
      }
      if (await autosave.flush()) { clearPendingDraft(); onBasis(id) }
    } catch (e) { setError((e as Error).message) } finally { setBasisBusy(false) }
  }
  const original = preview || (files[0] ? `/api/supplier-invoices/${id}/attachments/${files[0].id}?inline=1` : '')
  const originalPdf = pendingFile ? /\.pdf$/i.test(pendingFile.name) : files[0]?.contentType === 'application/pdf'
  return createPortal(<div className="psi-overlay uppdrag-scope" onMouseDown={e => { if (e.target === e.currentTarget) void leave() }}><div ref={panel} className="psi-panel gizmo-workspace" role="dialog" aria-modal="true" aria-labelledby={`psi-title-${id}`}>
    <header className="psi-panel-header"><div><small>Leverantörsfaktura{more ? ` · ${more} filer i kö` : ''}</small><h2 id={`psi-title-${id}`}>{form.supplierName || pendingFile?.name || 'Ny faktura'}</h2></div><button type="button" className="gizmo-text-button" aria-label="Stäng faktura" title="Stäng" onClick={() => void leave()} disabled={uploading || basisBusy}><X size={22} /></button></header>
    <ol className="psi-progress" aria-label="Fakturans arbetsgång">{steps.map((step, index) => <li key={step.title} data-complete={step.complete}><span className="psi-step-number" aria-hidden="true">{step.complete ? <Check size={15} /> : index + 1}</span><div><strong>{step.title}</strong><small>{step.detail}</small></div></li>)}</ol>
    <div className="psi-panel-body"><aside className="psi-original">
      <header><strong>1. Fakturans original</strong>{original && <a href={original} target="_blank" rel="noreferrer" className="gizmo-text-button" title="Öppna original" aria-label="Öppna original"><ExternalLink size={17} /></a>}</header>
      {pendingFile || original ? originalPdf ? <SupplierInvoicePdfPreview source={pendingFile || original} /> : <img src={original} alt="Fakturans original" /> : <div className="psi-no-original"><FileText size={32} /><p>Original saknas</p></div>}
      <input type="file" ref={fileInput} accept=".pdf,.jpg,.jpeg,.png,.webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f && fileValid(f)) { setPendingFile(f); setUploadError('') } else if (f) setUploadError('Välj PDF eller bild, högst 4 MB.'); e.target.value = '' }} />
      <button type="button" className="gizmo-text-button" disabled={readOnly || uploading || files.length >= 20} onClick={() => fileInput.current?.click()}><Upload size={17} />{files.length ? 'Lägg till bilaga' : 'Välj original'}</button>
      {pendingFile && <p role="status">{pendingFile.name} · {uploading ? 'Laddar upp…' : 'Vald fil, inte uppladdad'}{!uploading && <span className="psi-pending-details">{missing.length > 0 ? `Fyll i ${missing.join(', ')}. ` : ''}Originalet laddas upp när fakturauppgifterna och fördelningen är sparade.</span>}</p>}
      {!pendingFile && files.length > 0 && <p className="psi-linked"><Check size={15} /> Original uppladdat</p>}
      {uploadError && <p role="alert" className="psi-error">{uploadError}<button type="button" className="gizmo-text-button" disabled={uploading || autosave.busy} onClick={() => void upload()}>Försök ladda upp igen</button></p>}
      {files.map(f => <a key={f.id} href={`/api/supplier-invoices/${id}/attachments/${f.id}`} target="_blank" rel="noreferrer">{f.fileName}</a>)}
    </aside>
    <div className="psi-edit"><fieldset disabled={readOnly || basisBusy}><legend>2. Fakturauppgifter</legend><div className="psi-fields"><label>Leverantör<input className={field} maxLength={200} disabled={financialLocked} value={form.supplierName} onChange={e => edit({ ...form, supplierName: e.target.value })} /></label><label>Fakturanummer<input className={field} maxLength={100} disabled={financialLocked} value={form.invoiceNumber} onChange={e => edit({ ...form, invoiceNumber: e.target.value })} /></label><label>Fakturadatum<input className={field} type="date" disabled={financialLocked} value={form.invoiceDate} onChange={e => edit({ ...form, invoiceDate: e.target.value })} /></label><label>Belopp exkl. moms<input className={field} inputMode="decimal" disabled={financialLocked} value={form.net} onChange={e => edit({ ...form, net: e.target.value })} /></label><label>Momsbelopp<input className={field} inputMode="decimal" disabled={financialLocked} value={form.vat} onChange={e => edit({ ...form, vat: e.target.value })} /></label><div className="psi-gross"><small>Totalt inkl. moms</small><strong>{net === null || vat === null ? 'Belopp saknas' : money((net + vat) * (form.documentKind === 'credit' ? -1 : 1))}</strong></div></div>
      <details><summary>Fakturatyp och rättning</summary><label>Typ<select className={field} value={form.documentKind} disabled={financialLocked} onChange={e => edit({ ...form, documentKind: e.target.value as Form['documentKind'], creditReferenceInvoiceId: null })}><option value="invoice">Faktura</option><option value="credit">Kreditfaktura</option></select></label>{form.documentKind === 'credit' && <label>Krediterar faktura<select className={field} disabled={financialLocked} value={form.creditReferenceInvoiceId ?? ''} onChange={e => edit({ ...form, creditReferenceInvoiceId: e.target.value || null })}><option value="">Ingen referens vald</option>{workspace.invoices.filter(i => i.id !== id && i.documentKind === 'invoice' && i.approvalStatus !== 'void').map(i => <option key={i.id} value={i.id}>{i.supplierName} · {i.invoiceNumber}</option>)}</select></label>}<label>Granskning<select className={field} disabled={financialLocked} value={form.approvalStatus} onChange={e => edit({ ...form, approvalStatus: e.target.value as Form['approvalStatus'] })}><option value="registered">Registrerad</option><option value="approved">Granskad</option><option value="disputed">Bestridd</option><option value="void">Makulerad</option></select></label></details>
      <h3>3. Fördelning exkl. moms</h3><div className="psi-segment" role="group" aria-label="Fördelningssätt">{(['whole', 'split'] as const).map(value => <button type="button" key={value} aria-pressed={form.distribution === value} disabled={financialLocked || value === 'whole' && rows.length > 1} onClick={() => edit({ ...form, distribution: value })}>{value === 'whole' ? 'Hela projektbeloppet' : 'Dela upp beloppet'}</button>)}</div>
      {!assigned && <p className="psi-muted">Gemensam kostnad räknas i projektets utfall, men inte på ett särskilt moment eller ÄTA.</p>}
      {form.rows.some(r => r.caseId !== caseId) && <p className="psi-muted">{money(form.rows.filter(r => r.caseId !== caseId).reduce((sum, r) => sum + (parseInvoiceAmount(r.amount) ?? 0), 0))} är fördelat till andra projekt och lämnas oförändrat.</p>}
      {rows.map(row => {
        const oldLink = linked.find(l => l.allocationId === row.id)
        return <div className="psi-allocation" key={row.id}>
          <label>Moment eller ÄTA<select className={field} value={row.changeId ? `change:${row.changeId}` : row.itemId ? `item:${row.itemId}` : ''} disabled={protectedIds.has(row.id)} onChange={e => { const [kind, id] = e.target.value.split(':'); edit({ ...form, rows: form.rows.map(r => r.id === row.id ? { ...r, itemId: kind === 'item' ? id : null, changeId: kind === 'change' ? id : null } : r) }) }}><option value="">Gemensamt / ej momentfördelat</option>{row.itemId && !target(row) && <option value={`item:${row.itemId}`}>Tidigare moment</option>}{row.changeId && !target(row) && <option value={`change:${row.changeId}`}>Tidigare ÄTA</option>}{workspace.targets.map(t => <option key={`${t.kind}:${t.id}`} value={`${t.kind}:${t.id}`}>{t.kind === 'change' ? 'ÄTA · ' : ''}{t.title}</option>)}</select></label>
          <div className="psi-fields"><label>Kostnadsslag<select className={field} value={row.category} disabled={protectedIds.has(row.id)} onChange={e => edit({ ...form, rows: form.rows.map(r => r.id === row.id ? { ...r, category: e.target.value as Row['category'] } : r) })}>{Object.entries(categories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label>Belopp exkl. moms<input className={field} inputMode="decimal" value={row.amount} disabled={form.distribution === 'whole' || protectedIds.has(row.id)} onChange={e => edit({ ...form, rows: form.rows.map(r => r.id === row.id ? { ...r, amount: e.target.value } : r) })} /></label></div>
          <div className="psi-toolbar"><label className="psi-grow">Beskrivning<input className={field} maxLength={500} disabled={protectedIds.has(row.id)} value={row.description} onChange={e => edit({ ...form, rows: form.rows.map(r => r.id === row.id ? { ...r, description: e.target.value } : r) })} /></label>{form.distribution === 'split' && <button type="button" className="gizmo-text-button" title="Ta bort fördelning" aria-label="Ta bort fördelning" disabled={protectedIds.has(row.id) || rows.length === 1} onClick={() => edit({ ...form, rows: form.rows.filter(r => r.id !== row.id) })}><Trash2 size={17} /></button>}</div>
          {oldLink ? <p className="psi-linked">Ingår i fakturaunderlag · {money(oldLink.customerNetOre)} exkl. moms</p> : protectedIds.has(row.id) ? <p className="psi-linked">Kopplad till granskad fakturering. Rättning hanteras under Fakturering.</p> : target(row)?.mode === 'fixed' ? <p className="psi-muted">Fast pris · intern kostnad, inte extra kunddebitering</p> : row.changeId ? <p className="psi-muted">ÄTA · kundens godkännande måste kontrolleras före fakturaunderlag</p> : null}
        </div>
      })}
      {form.distribution === 'split' && <button type="button" className="gizmo-text-button" disabled={form.rows.length >= 100} onClick={() => edit({ ...form, rows: [...form.rows, { id: crypto.randomUUID(), caseId, itemId: null, changeId: null, category: 'other', description: '', amount: remaining > 0 ? amountText(remaining) : '' }] })}><Plus size={17} />Lägg till fördelning</button>}
      <p className={remaining < 0 ? 'psi-error' : 'psi-balance'}>Kvar att fördela: <strong>{money(remaining)}</strong></p><label>Intern anteckning<textarea className={field} rows={2} maxLength={5000} value={form.notes} onChange={e => edit({ ...form, notes: e.target.value })} /></label>
    </fieldset>
    {error && <p role="alert" className="psi-error">{error}</p>}
    {(autosave.error || autosave.dirty) && <button type="button" className="gizmo-text-button" disabled={autosave.busy || uploading || basisBusy} onClick={() => void reloadSaved()}><RefreshCw size={17} />Hämta sparad faktura</button>}
    <section className="psi-result" aria-label="Sammanfattning och nästa steg">
      <h3>4. {saved ? 'Sparat i projektet' : 'Kontroll och sparning'}</h3>
      <dl>{rows.map(row => <div key={row.id}><dt>{row.changeId ? 'ÄTA · ' : ''}{target(row)?.title || 'Gemensamt / ej momentfördelat'}<small>{categories[row.category]}</small></dt><dd>{parseInvoiceAmount(row.amount) === null ? 'Belopp saknas' : money(invoiceSignedAmount(form, parseInvoiceAmount(row.amount)!))} exkl. moms</dd></div>)}</dl>
      <p>{fixedOnly ? 'Kostnaden ingår i en fastprisdel och ger inte extra kunddebitering. Fakturering följer den avtalade betalningsplanen.' : 'Kostnaden är intern. Kunddebitering och uppföljning mot kundens budget sker separat i Fakturering, efter kontroll av överenskommelsen.'}</p>
      <label className="psi-check"><input type="checkbox" disabled={readOnly || financialLocked || basisBusy || !formValid || ['void', 'disputed'].includes(form.approvalStatus)} checked={form.approvalStatus === 'approved'} onChange={e => edit({ ...form, approvalStatus: e.target.checked ? 'approved' : 'registered' })} />Fakturauppgifter och kostnadsfördelning är granskade</label>
      <p className="psi-muted">Granskning skapar ingen kundfaktura eller betalning.</p>
      {blockers && <p id={`psi-next-${id}`} className="psi-next-status">{blockers}</p>}
    </section>
    </div></div>
    <footer className="psi-panel-footer">
      <div role="status" aria-live="polite">{uploading ? 'Laddar upp original…' : autosave.busy ? 'Sparar…' : uploadError || autosave.error || (pendingFile && missing.length ? `Inte uppladdad. Saknas: ${missing.join(', ')}.` : autosave.dirty ? valid(form) ? 'Väntar på sparning…' : 'Fyll i leverantör, nummer, datum och giltiga belopp. Inte sparat.' : pendingFile ? 'Filen väntar på uppladdning.' : autosave.revision() ? 'Sparat' : 'Nytt utkast')}{!autosave.local && <strong> Kan inte lagra lokalt. Lämna inte sidan.</strong>}{autosave.error && <button type="button" className="gizmo-text-button" onClick={() => void autosave.retry()}>Försök igen</button>}</div>
      <div><button type="button" className="gizmo-text-button" disabled={uploading || basisBusy} onClick={() => void leave()}>Stäng</button>{more > 0 && <button type="button" className="gizmo-button" disabled={uploading || !!pendingFile || !autosave.revision() || basisBusy} onClick={() => void leave(true)}>Nästa fil ({more})</button>}
        <button type="button" className="gizmo-button" aria-describedby={blockers ? `psi-next-${id}` : undefined} disabled={readOnly || !saved || basisBusy || basisBlocked || more > 0 || form.approvalStatus === 'void' || form.approvalStatus === 'disputed'} onClick={() => void reviewBasis()}><ArrowRight size={17} />Fortsätt till fakturering</button>
      </div>
    </footer>
    </div></div>, document.body)
}
