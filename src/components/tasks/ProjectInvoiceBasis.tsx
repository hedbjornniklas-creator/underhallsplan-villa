'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FileDown, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { emptyInvoiceBasis, invoiceBasisTotals, normalizeInvoiceBasis, type InvoiceBasis, type InvoiceBasisRecord, type ProjectCompletionWorkspace } from '@/lib/action-cases/projectCompletion'
import { useQuestionAutosave } from './useQuestionAutosave'
import './project-completion.css'

type Form = Omit<InvoiceBasis, 'lines'> & { lines: Array<Omit<InvoiceBasis['lines'][number], 'quantity' | 'unitPriceOre'> & { quantity: string; unitPrice: string }> }
const formOf = (body: InvoiceBasis): Form => ({ ...body, lines: body.lines.map(({ quantity, unitPriceOre, ...l }) => ({ ...l, quantity: quantity === null ? '' : String(quantity), unitPrice: unitPriceOre === null ? '' : String(unitPriceOre / 100) })) })
function parsed(form: Form): InvoiceBasis {
  const number = (text: string, decimals: number) => {
    const value = text.trim().replace(',', '.')
    if (!value) return null
    if (!new RegExp(`^-?\\d+(?:\\.\\d{1,${decimals}})?$`).test(value)) throw new Error('Kontrollera antal och à-priser.')
    return Number(value)
  }
  return normalizeInvoiceBasis({ ...form, lines: form.lines.map(({ quantity, unitPrice, ...l }) => { const price = number(unitPrice, 2); return { ...l, quantity: number(quantity, 4), unitPriceOre: price === null ? null : Math.round(price * 100) } }) })
}
const money = (ore: number) => `${(ore / 100).toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`
const input = 'min-h-11 w-full min-w-0 rounded-md border border-[#AEB8B9] bg-white px-3 py-2 text-base sm:text-sm disabled:bg-[#F4F6F6]'

export default function ProjectInvoiceBasis({ caseId, active, onDirty }: { caseId: string; active: boolean; onDirty: (dirty: boolean) => void }) {
  const [data, setData] = useState<ProjectCompletionWorkspace | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null), [form, setForm] = useState<Form | null>(null), [pdfBusy, setPdfBusy] = useState(false)
  const id = useRef<string | null>(null), runningPdf = useRef(false), loadToken = useRef(0)
  const valid = (value: Form) => { try { parsed(value); return true } catch { return false } }
  const autosave = useQuestionAutosave<Form>({ valid, staleMessage: 'Det lokala fakturaunderlaget avser en äldre version. Hämta den sparade versionen innan du fortsätter.',
    save: async attempt => {
      const response = await fetch(`/api/action-cases/${caseId}/administration`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'save_basis', id: id.current, requestId: attempt.requestId, revision: attempt.revision, body: parsed(attempt.value) }), signal: AbortSignal.timeout(45_000) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Sparningen kunde inte bekräftas.')
      if (result.id !== id.current || result.revision !== attempt.revision + 1) throw new Error('Sparningen kunde inte bekräftas.')
    },
    onSaved: (value, revision) => {
      const record = { id: id.current!, body: parsed(value), revision, updatedAt: new Date().toISOString() }
      setData(d => d ? { ...d, bases: [record, ...d.bases.filter(b => b.id !== record.id)] } : d)
    },
  })
  const autosaveRef = useRef(autosave); autosaveRef.current = autosave
  const key = (userId: string, basisId: string) => `invoice-basis:${userId}:${caseId}:${basisId}`
  const choose = (record: InvoiceBasisRecord, userId: string, discard = false) => {
    id.current = record.id; setSelected(record.id)
    const value = autosaveRef.current.seed(key(userId, record.id), formOf(record.body), record.revision, discard)
    setForm(value)
    try { localStorage.setItem(`invoice-basis:${userId}:${caseId}:selected`, record.id) } catch { /* Draft safety is handled by the autosave queue. */ }
  }
  const load = useCallback(async () => {
    const token = ++loadToken.current
    setLoading(true); setError('')
    try {
      const response = await fetch(`/api/action-cases/${caseId}/administration`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) }), result = await response.json() as ProjectCompletionWorkspace & { error?: string }
      if (!response.ok) throw new Error(result.error || 'Fakturaunderlagen kunde inte hämtas.')
      if (token !== loadToken.current) return
      setData(result)
      if (!id.current) {
        let previous: string | null = null
        try { previous = localStorage.getItem(`invoice-basis:${result.userId}:${caseId}:selected`) } catch { /* No saved selection. */ }
        const record = result.bases.find(b => b.id === previous)
        if (record) choose(record, result.userId)
        else if (previous && /^[0-9a-f-]{36}$/i.test(previous)) {
          try { if (localStorage.getItem(key(result.userId, previous))) choose({ id: previous, revision: 0, body: emptyInvoiceBasis(result.defaults), updatedAt: '' }, result.userId) } catch { /* No recoverable draft. */ }
        }
      }
    } catch (e) { if (token === loadToken.current) setError(e instanceof Error ? e.message : 'Kunde inte hämta underlagen.') }
    finally { if (token === loadToken.current) setLoading(false) }
  // Choosing a document uses refs so a later save cannot restart the fetch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId])
  const invalidateLoad = useCallback(() => { loadToken.current++ }, [])
  useEffect(() => { if (active && !autosaveRef.current.dirty && !autosaveRef.current.busy) void load(); return invalidateLoad }, [active, load, invalidateLoad])
  useEffect(() => { onDirty(autosave.dirty || autosave.busy || pdfBusy) }, [autosave.dirty, autosave.busy, pdfBusy, onDirty])
  useEffect(() => {
    if (!autosave.dirty && !autosave.busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [autosave.dirty, autosave.busy])
  const closed = data?.status === 'completed' || data?.status === 'cancelled'
  async function select(basisId: string | null) {
    if (!data || !(await autosave.flush())) return
    choose(basisId ? data.bases.find(b => b.id === basisId)! : { id: crypto.randomUUID(), revision: 0, body: emptyInvoiceBasis(data.defaults), updatedAt: '' }, data.userId)
  }
  function edit(next: Form) { if (closed) return; setForm(next); autosave.change(next) }
  async function print() {
    if (runningPdf.current || !selected || !totals?.complete || !(await autosave.flush()) || !autosave.revision()) return
    runningPdf.current = true; setPdfBusy(true); setError('')
    try {
      const response = await fetch(`/api/action-cases/${caseId}/invoice-basis/${selected}/pdf?revision=${autosave.revision()}`, { cache: 'no-store', signal: AbortSignal.timeout(60_000) })
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'PDF kunde inte skapas.') }
      const url = URL.createObjectURL(await response.blob()), a = document.createElement('a')
      a.href = url; a.download = `Fakturaunderlag-${form!.date.replaceAll('-', '')}-${selected.slice(0, 8)}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (e) { setError(e instanceof Error ? e.message : 'PDF kunde inte skapas.') }
    finally { runningPdf.current = false; setPdfBusy(false) }
  }
  let body: InvoiceBasis | null = null
  try { if (form) body = parsed(form) } catch { /* Keep partially typed numeric values visible. */ }
  const totals = body ? invoiceBasisTotals(body) : null
  return <section className="gizmo-invoice-basis" aria-label="Fakturaunderlag" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Fakturaunderlag</h3><div className="flex gap-2"><button type="button" className="gizmo-text-button" title="Uppdatera fakturaunderlag" aria-label="Uppdatera fakturaunderlag" disabled={loading || autosave.dirty || autosave.busy || pdfBusy} onClick={() => void load()}><RefreshCw size={17} /></button><button type="button" className="gizmo-button" disabled={!data || closed || loading || autosave.busy || pdfBusy} onClick={() => void select(null)}><Plus size={17} />Nytt underlag</button></div></div>
    <p className="my-2 text-sm text-[#596368]">Bilaga till faktura i ekonomisystemet.</p>
    {error && <p role="alert" className="my-2 text-rose-800">{error}</p>}
    {!data && <button type="button" className="gizmo-text-button" disabled={loading} onClick={() => void load()}>{loading ? 'Hämtar…' : 'Försök igen'}</button>}
    {data && <div className="my-4 flex flex-wrap gap-2" aria-label="Sparade fakturaunderlag">{data.bases.map(b => <button type="button" key={b.id} className="gizmo-text-button" aria-pressed={selected === b.id} disabled={autosave.busy || pdfBusy} onClick={() => void select(b.id)}>{b.body.title || 'Namnlöst underlag'} · {b.body.date}</button>)}{!data.bases.length && !form && <p className="text-sm">Inga fakturaunderlag skapade.</p>}</div>}
    {form && <>
      <div className="my-3 flex flex-wrap items-center justify-between gap-3"><div role="status" aria-live="polite" className="text-sm">{autosave.busy ? 'Sparar…' : autosave.error ? autosave.error : autosave.dirty ? valid(form) ? 'Väntar på sparning…' : 'Kontrollera datum, antal och priser. Ändringarna är inte sparade.' : autosave.revision() ? 'Sparat' : 'Nytt underlag'}{!autosave.local && <strong> Utkastet kunde inte lagras på enheten. Lämna inte sidan.</strong>}{autosave.error && <button type="button" className="gizmo-text-button" onClick={() => void autosave.retry()}>Försök igen</button>}</div><button type="button" className="gizmo-button" disabled={!totals?.complete || autosave.dirty || autosave.busy || Boolean(autosave.error) || pdfBusy || !autosave.revision()} onClick={() => void print()}><FileDown size={17} />{pdfBusy ? 'Skapar PDF…' : 'PDF'}</button></div>
      {(autosave.error || autosave.dirty) && <button type="button" className="gizmo-text-button mb-3" disabled={autosave.busy || pdfBusy} onClick={async () => {
        if (!data || !window.confirm('Hämta sparat underlag och kasta lokala ändringar?')) return
        try {
          const response = await fetch(`/api/action-cases/${caseId}/administration`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) }), fresh = await response.json()
          if (!response.ok) throw new Error(fresh.error || 'Kunde inte hämta underlaget.')
          setData(fresh); const saved = fresh.bases.find((b: InvoiceBasisRecord) => b.id === selected)
          choose(saved || { id: selected!, revision: 0, body: emptyInvoiceBasis(fresh.defaults), updatedAt: '' }, fresh.userId, true)
        } catch (e) { setError(e instanceof Error ? e.message : 'Kunde inte hämta underlaget. Dina ändringar är kvar.') }
      }}>Hämta sparat underlag</button>}
      {closed && <p className="mb-3 text-sm">Projektet är avslutat eller avbrutet. Sparade underlag kan fortfarande hämtas som PDF.</p>}
      <fieldset disabled={closed || pdfBusy} className="min-w-0">
        <div className="grid gap-3 sm:grid-cols-3"><label className="sm:col-span-2">Rubrik<input className={input} maxLength={200} value={form.title} onChange={e => edit({ ...form, title: e.target.value })} /></label><label>Datum<input type="date" className={input} value={form.date} onChange={e => edit({ ...form, date: e.target.value })} /></label><label className="sm:col-span-3">Period<input className={input} maxLength={200} value={form.period} onChange={e => edit({ ...form, period: e.target.value })} /></label></div>
        <div className="my-3 grid gap-3 sm:grid-cols-2"><label>Avsändare<textarea className={input} rows={4} maxLength={1500} value={form.issuer} onChange={e => edit({ ...form, issuer: e.target.value })} /></label><label>Fakturakund<textarea className={input} rows={4} maxLength={1500} value={form.recipient} onChange={e => edit({ ...form, recipient: e.target.value })} /></label></div>
        <div className="my-3 flex justify-end"><button type="button" className="gizmo-text-button" disabled={form.lines.length >= 100} onClick={() => edit({ ...form, lines: [...form.lines, { id: crypto.randomUUID(), description: '', quantity: '1', unit: 'st', unitPrice: '', vatRate: 25 }] })}><Plus size={16} />Lägg till rad</button></div>
        <div className="gizmo-invoice-lines">{form.lines.map(line => <div key={line.id} className="gizmo-invoice-row">
          <label className="gizmo-invoice-description">Beskrivning<textarea className={input} rows={2} maxLength={1500} value={line.description} onChange={e => edit({ ...form, lines: form.lines.map(l => l.id === line.id ? { ...l, description: e.target.value } : l) })} /></label>
          {(['quantity', 'unit', 'unitPrice'] as const).map(field => <label key={field}>{field === 'quantity' ? 'Antal' : field === 'unit' ? 'Enhet' : 'À-pris exkl. moms'}<input className={input} inputMode={field === 'unit' ? 'text' : 'decimal'} maxLength={field === 'unit' ? 30 : 25} value={line[field]} onChange={e => edit({ ...form, lines: form.lines.map(l => l.id === line.id ? { ...l, [field]: e.target.value } : l) })} /></label>)}
          <label>Moms<select className={input} value={line.vatRate} onChange={e => edit({ ...form, lines: form.lines.map(l => l.id === line.id ? { ...l, vatRate: Number(e.target.value) } : l) })}>{[0, 6, 12, 25].map(rate => <option key={rate} value={rate}>{rate} %</option>)}</select></label>
          <div className="self-end pb-2 text-right text-sm">{totals?.lines.find(l => l.id === line.id)?.netOre == null ? 'Belopp saknas' : money(totals.lines.find(l => l.id === line.id)!.netOre!)}<small className="block text-[#596368]">exkl. moms</small></div><button type="button" className="gizmo-text-button self-end" title="Ta bort rad" aria-label={`Ta bort ${line.description || 'rad'}`} onClick={() => edit({ ...form, lines: form.lines.filter(l => l.id !== line.id) })}><Trash2 size={17} /></button>
        </div>)}</div>
        <label className="my-4 block">Notering till underlaget<textarea className={input} rows={3} maxLength={10000} value={form.note} onChange={e => edit({ ...form, note: e.target.value })} /></label>
      </fieldset>
      {totals && <dl className="gizmo-invoice-totals">{[['Summa exkl. moms', totals.netOre], ['Moms', totals.vatOre], ['Summa inkl. moms', totals.grossOre]].map(([label, amount]) => <div key={String(label)} className="flex justify-between gap-4"><dt>{label}</dt><dd className="font-semibold">{money(Number(amount))}</dd></div>)}</dl>}
      {!totals?.complete && <p className="my-2 text-sm" role="status">Preliminär summering. Fyll i rubrik, avsändare, fakturakund och alla rader innan PDF skapas. Noll kronor är ett giltigt belopp.</p>}
    </>}
  </section>
}
