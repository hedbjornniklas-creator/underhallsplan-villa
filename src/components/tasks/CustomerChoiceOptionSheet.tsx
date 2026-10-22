'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Banknote, Calculator, ClipboardList, Download, ExternalLink, HelpCircle, Trash2, Upload, X } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import type { CustomerChoiceCategory, CustomerChoiceFileRef, CustomerPlannedItem } from '@/lib/action-cases/customerPlanning'
import type { CustomerChoiceCalculation, CustomerChoiceCosting } from '@/lib/action-cases/customerChoiceCosting'
import PriceInput from './CustomerOfferPriceInput'
import CustomerChoiceCostTable from './CustomerChoiceCostTable'
import CustomerPlanningSaveStatus from './CustomerPlanningSaveStatus'
import CustomerChoicePriceTime from './CustomerChoicePriceTime'
import { choiceOfferForEditing } from '@/lib/action-cases/choiceOffer'

const field = 'mt-1 block w-full rounded-md border border-[#D5DCDD] bg-white px-3 py-2 text-base sm:text-sm'
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#D5DCDD] px-3 py-2 text-sm font-semibold disabled:opacity-50'

export default function CustomerChoiceOptionSheet({ caseId, revision, offerAvailable = false, option, categories, files, references, filesAvailable, costing, costingAvailable, rowCostingAvailable, busy, saving, saveError, onRetry, onChange, onMove, onReferences, onFiles, onCosting, onRemove, onClose }: {
  caseId: string; option: CustomerPlannedItem; categories: CustomerChoiceCategory[]; files: ActionCaseAttachmentView[]
  revision?: number; offerAvailable?: boolean
  references: CustomerChoiceFileRef[]; filesAvailable: boolean; costing?: CustomerChoiceCosting[string]; costingAvailable: boolean
  rowCostingAvailable: boolean
  busy: boolean; saving: boolean; saveError: boolean; onRetry: () => void
  onChange: (patch: Partial<CustomerPlannedItem>) => void; onMove: (categoryId: string) => void
  onReferences: (refs: CustomerChoiceFileRef[]) => void; onFiles: (files: ActionCaseAttachmentView[]) => void
  onCosting: (value: CustomerChoiceCalculation) => void; onRemove: () => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDivElement>(null), backdrop = useRef(false), uploadInput = useRef<HTMLInputElement>(null), uploadingRef = useRef(false)
  const [uploading, setUploading] = useState(false), [error, setError] = useState('')
  const [tab, setTab] = useState<'scope' | 'cost' | 'price'>('scope'), [exporting, setExporting] = useState(false)
  const titleId = useId(), working = busy || uploading || exporting
  const offer = choiceOfferForEditing(option, costing)
  const pdfs = files.filter((f) => f.contentType === 'application/pdf' && !f.isQuoteDocument)
  const selected = references.filter((r) => r.optionId === option.id)
  const category = categories.find((c) => c.optionIds.includes(option.id))
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus()
  }, [working])
  useEffect(() => {
    if (!uploading) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [uploading])
  const toggle = (id: string, checked: boolean) => onReferences(checked ? [...references, { optionId: option.id, fileId: id }] : references.filter((r) => r.optionId !== option.id || r.fileId !== id))
  async function downloadPdf() {
    if (working || saving || saveError || revision === undefined) return
    setExporting(true); setError('')
    try {
      const response = await fetch(`/api/action-cases/${caseId}/customer-planning/${option.id}/pdf?revision=${revision}`, { cache: 'no-store', signal: AbortSignal.timeout(120000) })
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || 'PDF:en kunde inte skapas.') }
      if (!response.headers.get('content-type')?.includes('application/pdf')) throw new Error('PDF:en kunde inte skapas.')
      const url = URL.createObjectURL(await response.blob()), link = document.createElement('a')
      link.href = url; link.download = `Val-tillval-${option.id.slice(0, 8)}-v${revision}.pdf`; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (error) { setError(error instanceof Error ? error.message : 'PDF:en kunde inte skapas.') }
    finally { setExporting(false) }
  }
  async function upload(file?: File) {
    if (!file || working || uploadingRef.current) return
    if (file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf') || file.size < 100 || file.size > 20_000_000 || file.name.length > 250) { setError('Välj en PDF, högst 20 MB.'); return }
    uploadingRef.current = true; setUploading(true); setError('')
    try {
      const post = async (action: string, payload: Record<string, unknown>) => {
        const response = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload: { ...payload, caseId } }) })
        const result = await response.json(); if (!response.ok) throw new Error(result.error || 'PDF:en kunde inte laddas upp.'); return result
      }
      const signed = await post('create_signed_upload', { fileName: file.name, contentType: file.type, fileSize: file.size })
      const result = await supabase.storage.from(signed.upload.bucket).uploadToSignedUrl(signed.upload.filePath, signed.upload.token, file, { contentType: signed.upload.contentType })
      if (result.error) { await post('abort_upload', { filePath: signed.upload.filePath }).catch(() => undefined); throw new Error('PDF:en kunde inte laddas upp. Försök igen.') }
      // Do not delete an uploaded original on an uncertain completion response.
      const completed = await post('complete_upload', { filePath: signed.upload.filePath, fileName: file.name, contentType: file.type, fileSize: file.size, itemId: null, participantIds: [] })
      const next: ActionCaseAttachmentView[] = completed.workspace.cases.find((c: { id: string }) => c.id === caseId)?.attachments ?? []
      // complete_upload normalizes project filenames before returning the workspace.
      const storedName = file.name.replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim().slice(0, 180) || 'bilaga'
      const candidates = next.filter((f) => !files.some((existing) => existing.id === f.id) && f.fileName === storedName && f.fileSizeBytes === file.size && f.contentType === 'application/pdf' && !f.isQuoteDocument)
      const added = candidates.length === 1 ? candidates[0] : undefined
      onFiles(next)
      if (!added) throw new Error('PDF:en laddades upp men kunde inte kopplas automatiskt. Välj den från projektet.')
      toggle(added.id, true)
    } catch (error) { setError(error instanceof Error ? error.message : 'PDF:en kunde inte laddas upp.') }
    finally { uploadingRef.current = false; setUploading(false); if (uploadInput.current) uploadInput.current.value = '' }
  }
  if (typeof document === 'undefined') return null
  return createPortal(<div className="uppdrag-scope gizmo-dialog-scope gizmo-choice-categories fixed inset-0 z-[70] flex justify-end bg-black/40"
    onPointerDown={(e) => { backdrop.current = e.target === e.currentTarget }} onClick={(e) => { if (e.target === e.currentTarget && backdrop.current && !working) onClose(); backdrop.current = false }}>
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={working} tabIndex={-1} className="gizmo-choice-sheet flex h-dvh w-full flex-col bg-white text-[#252A2D] shadow-2xl outline-none" onKeyDown={(e) => {
      if (e.key === 'Escape') { e.preventDefault(); if (!working) onClose() }
      if (e.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]') ?? []).filter((n) => n.tabIndex >= 0 && n.getClientRects().length)
      if (!controls.length) { e.preventDefault(); return }
      if (e.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) { e.preventDefault(); controls.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus() }
    }}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-[#D5DCDD] px-4 py-4 sm:px-6"><div className="min-w-0"><p className="text-xs text-[#596368]">{category?.title || 'Alternativ'}</p><h2 id={titleId} className="mt-1 break-words text-xl font-semibold">{option.title || 'Nytt alternativ'}</h2></div><button type="button" className={`${button} h-11 w-11 shrink-0 px-0`} disabled={working} aria-label="Stäng alternativ" title="Stäng" onClick={onClose}><X size={19} /></button></header>
      {offerAvailable && <div role="tablist" className="gizmo-register-tabs gizmo-choice-tabs" aria-label="Alternativets delar" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
        if (!tabs.length) return
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length
        tabs[next]?.focus(); tabs[next]?.click()
      }}>
        {([['scope', 'Omfattning', ClipboardList], ['cost', 'Kalkyl', Calculator], ['price', 'Pris och tid', Banknote]] as const).map(([id, title, Icon]) => <button type="button" role="tab" key={id} id={`${titleId}-${id}`} aria-controls={`${titleId}-panel`} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} className="gizmo-register-tab" disabled={working} onClick={() => setTab(id)}><Icon size={17} aria-hidden="true" />{title}</button>)}
      </div>}
      <div role={offerAvailable ? 'tabpanel' : undefined} id={offerAvailable ? `${titleId}-panel` : undefined} aria-labelledby={offerAvailable ? `${titleId}-${tab}` : undefined} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {error && <p role="alert" className="mb-4 border-l-4 border-amber-500 bg-amber-50 p-3 text-sm">{error}</p>}
        {offerAvailable && <details className="mb-4 border-b border-[#D5DCDD] pb-3 text-sm"><summary className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-[#206961]" title="Hjälp om kalkylpris och kundpris"><HelpCircle size={18} />Kalkylpris och kundpris</summary><div className="max-w-3xl space-y-2 pb-2 leading-6 text-[#596368]"><p>Kalkylen är intern och visar kostnader och prispåslag exklusive moms. Kalkylpriset är en beräkning, inte i sig en överenskommelse med beställaren.</p><p>Under Pris och tid anger du kundens prisvillkor. Välj ett eget fast kundpris eller Beräkna från kalkylen. Bara det senare valet kopplar kundens fasta pris till kalkylraderna. Timpriser och ungefärliga priser på löpande räkning är inte fasta totalsummor.</p><p>PDF-underlaget innehåller omfattning, kundens prisvillkor, tidspåverkan och bilageförteckning. Inköpskostnader och interna kalkylpåslag visas inte. Befintliga leverantörsofferter kan innehålla priser; granska bilagorna innan du mejlar dem. Grundavtalet och betalningsplanen ändras inte.</p></div></details>}
        <fieldset disabled={working} className="grid min-w-0 gap-4">
          {(!offerAvailable || tab === 'scope') && <>
          <label className="text-sm">Namn<input className={field} value={option.title} maxLength={250} onChange={(e) => onChange({ title: e.target.value })} /></label>
          <label className="text-sm">{offerAvailable ? 'Arbetets omfattning / specifikation' : 'Beskrivning'}<textarea className={field} rows={5} maxLength={12000} value={option.scope} onChange={(e) => onChange({ scope: e.target.value })} /></label>
          {offerAvailable && <><label className="text-sm">Förutsättningar<textarea className={field} rows={3} maxLength={6000} value={offer.conditions} onChange={event => onChange({ offer: { ...offer, conditions: event.target.value } })} /></label><label className="text-sm">Ingår inte<textarea className={field} rows={3} maxLength={6000} value={offer.exclusions} onChange={event => onChange({ offer: { ...offer, exclusions: event.target.value } })} /></label></>}
          </>}
          {(!offerAvailable || tab === 'cost') && <>
          {costingAvailable ? <CustomerChoiceCostTable optionId={option.id} value={costing} customerPrice={option.budgetOre} available={rowCostingAvailable} detailed={offerAvailable} controlsPrice={!offerAvailable} mixed={offer.pricing.mode === 'mixed'} onChange={onCosting} onPrice={(budgetOre) => onChange({ budgetOre })} />
            : <PriceInput label="Kundpris inkl. moms (kr)" value={option.budgetOre} onChange={(budgetOre) => onChange({ budgetOre })} />}
          </>}
          {offerAvailable && tab === 'price' && <CustomerChoicePriceTime value={offer} onChange={value => onChange({ offer: value })} />}
          {(!offerAvailable || tab === 'scope') && <>
          <section className="border-y border-[#D5DCDD] py-4" aria-label="PDF-bilagor"><h3 className="font-semibold">PDF-bilagor</h3>
            {!filesAvailable ? <p role="status" className="mt-2 text-sm text-[#596368]">PDF-bilagor behöver aktiveras av administratören.</p> : <>
              <ul className="mt-2 divide-y divide-[#D5DCDD]">{selected.map((ref) => {
                const file = pdfs.find((f) => f.id === ref.fileId)
                return <li key={ref.fileId} className="flex min-w-0 items-center gap-2 py-2">{file ? <a className="flex min-h-11 min-w-0 flex-1 items-center gap-2 break-words text-sm text-[#206961] underline" target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/attachments/${file.id}`}><ExternalLink size={16} className="shrink-0" />{file.fileName}</a> : <span className="min-w-0 flex-1 text-sm text-amber-800">Vald PDF är inte tillgänglig.</span>}<button type="button" className={`${button} h-11 w-11 shrink-0 px-0`} aria-label={`Ta bort PDF ${file?.fileName || 'som saknas'}`} title="Ta bort kopplingen" onClick={() => toggle(ref.fileId, false)}><Trash2 size={16} /></button></li>
              })}</ul>
              <div className="mt-3 flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-sm">Från projektet<select className={field} value="" disabled={references.length >= 30} onChange={(e) => { if (e.target.value) toggle(e.target.value, true) }}><option value="">Välj PDF…</option>{pdfs.filter((f) => !selected.some((r) => r.fileId === f.id)).map((f) => <option value={f.id} key={f.id}>{f.fileName}</option>)}</select></label><button type="button" disabled={references.length >= 30} className={`${button} self-end`} onClick={() => uploadInput.current?.click()}><Upload size={16} /> Ladda upp PDF</button><input ref={uploadInput} className="hidden" type="file" accept="application/pdf,.pdf" aria-label="Ladda upp PDF till alternativet" onChange={(e) => void upload(e.target.files?.[0])} /></div>
            </>}
          </section>
          {categories.length > 1 && <label className="text-sm">Kategori<select className={field} value={category?.id || ''} onChange={(e) => onMove(e.target.value)}>{categories.map((c) => <option value={c.id} key={c.id}>{c.title || 'Ny kategori'}</option>)}</select></label>}
          <button type="button" className={`${button} justify-self-start text-rose-700`} onClick={onRemove}><Trash2 size={16} /> Ta bort alternativ</button>
          </>}
        </fieldset>
      </div>
      <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[#D5DCDD] bg-white px-4 py-3 sm:px-6">{uploading ? <p role="status" className="flex h-8 w-60 max-w-full items-center text-xs text-[#596368]">Laddar upp PDF…</p> : <CustomerPlanningSaveStatus pending={saving || busy} error={saveError} onRetry={onRetry} />}<div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={working || saving || saveError || revision === undefined} onClick={() => void downloadPdf()}><Download size={16} />{exporting ? 'Skapar PDF…' : 'PDF-underlag'}</button><button type="button" className={button} disabled={working} onClick={onClose}>Stäng</button></div></footer>
    </div>
  </div>, document.body)
}
