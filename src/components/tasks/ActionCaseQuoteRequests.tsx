'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, FileText, Loader2, Mail, Pencil, Plus, Save, Send, Trash2, X } from 'lucide-react'
import type { ActionCaseQuoteRequest, ActionCaseView } from '@/lib/action-cases/contracts'
import { normalizeQuoteRequest, REQUEST_REQUIREMENTS, requestSources } from '@/lib/action-cases/quoteRequests'
import ActionCaseAttachmentPicker from './ActionCaseAttachmentPicker'
import { defaultRequestAttachments, quoteDocumentIds, reconcileRequestAttachments } from '@/lib/action-cases/scopeAttachments'

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-200'
const secondary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-40'
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-40'
const statuses = { draft: 'Utkast', sending: 'Utskick pågår', sent: 'Skickad', failed: 'Misslyckades', unknown: 'Osäker leveransstatus' }
const money = (value: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(value)

export function ActionCaseRequestsPanel({ actionCase, busy, onOpen }: { actionCase: ActionCaseView; busy: boolean; onOpen: (id: string | null) => void }) {
  return <section className="border-b border-slate-200 bg-white p-5" aria-label="Offertförfrågningar">
    <header className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg font-semibold">Offertförfrågningar <span className="font-normal text-slate-500">{actionCase.quoteRequests?.length ?? 0}</span></h3><button className={primary} disabled={busy} onClick={() => onOpen(null)}><Mail size={17} />Begär offert</button></header>
    {!actionCase.quoteRequests?.length ? <p className="mt-3 text-sm text-slate-500">Inga samlade förfrågningar ännu.</p> : <ul className="mt-3 divide-y divide-slate-200">{actionCase.quoteRequests.map((r) => <li key={r.id}><button disabled={busy} className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left hover:bg-slate-50" onClick={() => onOpen(r.id)}><span className="min-w-0"><strong className="block break-words text-sm">{r.supplierName}</strong><span className="mt-1 block text-xs text-slate-500">{r.lines.length} arbetsmoment · {statuses[r.deliveryStatus]}{r.supplementsId ? ' · Komplettering' : ''}</span></span><ArrowRight size={17} /></button></li>)}</ul>}
  </section>
}

type Props = {
  actionCase: ActionCaseView; requestId: string | null; preselectedLineId?: string; supplementId?: string
  busy: boolean; onClose: () => void
  onAction: (action: string, data: Record<string, unknown>) => Promise<boolean>
  onSupplement: (request: ActionCaseQuoteRequest) => void
  onOpenWork: (itemId: string, costLineId: string) => void
}

function ResponseForm({ request, actionCase, busy, onSave, onCancel }: { request: ActionCaseQuoteRequest; actionCase: ActionCaseView; busy: boolean; onSave: (data: Record<string, unknown>) => Promise<boolean>; onCancel: () => void }) {
  const [expected] = useState(request.updatedAt)
  const [mode, setMode] = useState(request.responseMode)
  const [amount, setAmount] = useState(request.packageAmount?.toString() ?? '')
  const [notes, setNotes] = useState(request.responseNotes)
  const [documentId, setDocumentId] = useState(request.responseDocumentId ?? '')
  return <form className="space-y-4 border-y border-slate-200 py-4" onSubmit={(e) => { e.preventDefault(); if (!busy) void onSave({ operation: 'response', expectedUpdatedAt: expected, responseMode: mode, packageAmount: amount, responseNotes: notes, responseDocumentId: documentId }).then((ok) => { if (ok) onCancel() }) }}>
    <h3 className="font-semibold">Offertens prissättning</h3>
    <fieldset disabled={busy} className="space-y-4">
      <label className="block text-sm">Prisvillkor<select className={input} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}><option value="pending">Inväntar besked om delpriser</option><option value="itemized">Delpriser gäller vid separat beställning</option><option value="package">Priset gäller endast hela paketet</option></select></label>
      {mode === 'package' ? <label className="block text-sm">Paketpris exkl. moms, kr<input name="packageAmount" className={input} type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></label> : null}
      <label className="block text-sm">Offertdokument<select className={input} value={documentId} onChange={(e) => setDocumentId(e.target.value)}><option value="">Inget valt</option>{actionCase.attachments.filter((a) => a.type === 'document').map((a) => <option key={a.id} value={a.id}>{a.title || a.fileName}</option>)}</select></label>
      <label className="block text-sm">Villkor och gemensamma kostnader<textarea className={`${input} py-2`} rows={3} value={notes} maxLength={6000} onChange={(e) => setNotes(e.target.value)} /></label>
    </fieldset>
    {mode !== 'itemized' ? <p role="status" className="text-sm text-amber-800">Delpriser kan inte väljas i kalkylen. Eventuella tidigare val från denna förfrågan tas bort.</p> : null}
    <div className="flex flex-wrap justify-end gap-2"><button className={secondary} type="button" disabled={busy} onClick={onCancel}>Avbryt</button><button className={primary} disabled={busy}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}Spara prisvillkor</button></div>
  </form>
}

export default function ActionCaseRequestSheet({ actionCase, requestId, preselectedLineId, supplementId, busy, onClose, onAction, onSupplement, onOpenWork }: Props) {
  const [id] = useState(() => requestId ?? crypto.randomUUID())
  const request = actionCase.quoteRequests?.find((r) => r.id === id)
  const base = request ?? actionCase.quoteRequests?.find((r) => r.id === supplementId)
  const sources = requestSources(actionCase)
  const privateDocs = quoteDocumentIds(actionCase)
  const defaultsFor = (lineIds: string[]) => defaultRequestAttachments(
    actionCase.items.filter((item) => sources.some((source) => source.itemId === item.id && lineIds.includes(source.costLineId))),
    actionCase.attachments, privateDocs,
  )
  const savedOverrides = (saved: ActionCaseQuoteRequest | undefined) => saved ? Object.fromEntries([
    ...defaultsFor(saved.lines.map((line) => line.costLineId)).map((id) => [id, false] as const),
    ...saved.attachmentIds.map((id) => [id, true] as const),
  ]) : {}
  const [attachmentOverrides, setAttachmentOverrides] = useState<Record<string, boolean>>(() => savedOverrides(request))
  const [form, setForm] = useState(() => ({
    requestId: id, supplierName: base?.supplierName ?? '', supplierEmail: base?.supplierEmail ?? '',
    subject: request?.subject ?? `${supplementId ? 'Komplettering: ' : ''}Offertförfrågan: ${actionCase.title}`.slice(0, 200),
    message: request?.message ?? `Objekt: ${actionCase.propertyAddress}`,
    selectedIds: request?.lines.map((l) => l.costLineId) ?? (preselectedLineId ? [preselectedLineId] : []),
    requirementKeys: base?.requirements.map((r) => r.key) ?? [], otherRequirements: base?.otherRequirements ?? '',
    attachmentIds: request?.attachmentIds ?? defaultsFor(preselectedLineId ? [preselectedLineId] : []), supplementsId: request?.supplementsId ?? supplementId ?? null,
  }))
  const [expected, setExpected] = useState(request?.updatedAt)
  const [editing, setEditing] = useState(!request)
  const [responseEditing, setResponseEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [pending, setPending] = useState(false)
  const inFlight = useRef(false), dialog = useRef<HTMLDivElement>(null)
  const working = busy || pending
  const locked = Boolean(request?.firstAttemptAt)
  const set = (key: string, value: unknown) => { setForm((f) => ({ ...f, [key]: value })); setDirty(true) }
  const toggle = (key: 'selectedIds' | 'requirementKeys' | 'attachmentIds', value: string, checked: boolean) => {
    if (key === 'attachmentIds') setAttachmentOverrides((current) => ({ ...current, [value]: checked }))
    setForm((current) => {
      const ids = checked ? [...new Set([...current[key], value])] : current[key].filter((id) => id !== value)
      return { ...current, [key]: ids, ...(key === 'selectedIds' ? {
        attachmentIds: reconcileRequestAttachments(current.attachmentIds, defaultsFor(current.selectedIds), defaultsFor(ids), attachmentOverrides),
      } : {}) }
    })
    setDirty(true)
  }
  const selectedLines = sources.filter((l) => form.selectedIds.includes(l.costLineId))
  let valid = selectedLines.length === form.selectedIds.length
  const attachmentBytes = actionCase.attachments.filter((file) => form.attachmentIds.includes(file.id)).reduce((sum, file) => sum + file.fileSizeBytes, 0)
  if (attachmentBytes > 5 * 1024 * 1024) valid = false
  try { normalizeQuoteRequest({ ...form, lines: selectedLines }); } catch { valid = false }
  const current = request && request.lines.every((line) => sources.some((s) => s.costLineId === line.costLineId && s.itemId === line.itemId && s.scope === line.scope && s.itemTitle === line.itemTitle && s.description === line.description))
  const close = () => { if (!working && (!(dirty || responseEditing) || window.confirm('Stäng utan att spara ändringarna?'))) onClose() }
  const run = async (name: string, data: Record<string, unknown>) => {
    if (inFlight.current) return false
    inFlight.current = true; setPending(true)
    try { return await onAction(name, { caseId: actionCase.id, requestId: id, ...data }) }
    finally { inFlight.current = false; setPending(false) }
  }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  useEffect(() => { if (!editing && !responseEditing) dialog.current?.querySelector<HTMLElement>('[data-request-content]')?.scrollTo({ top: 0 }) }, [editing, responseEditing])
  const requestPreview = request ? <><div><h3 className="font-semibold">{request.sentAt ? 'Skickad förfrågan' : 'Förhandsgranska förfrågan'}</h3><p className="mt-2 break-words text-sm">Till: {request.supplierName} &lt;{request.supplierEmail}&gt;</p><p className="mt-2 break-words font-semibold">{request.subject}</p></div>
        <p data-testid="request-body" className="whitespace-pre-wrap break-words text-sm leading-6">{request.body}</p>
        <div className="border-t border-slate-200 pt-4"><h4 className="text-sm font-semibold">Bilagor ({request.attachmentIds.length})</h4><ul>{request.attachmentIds.map((id) => <li key={id}><a className="inline-flex min-h-11 items-center gap-2 break-all text-sm text-violet-700 underline" href={`/api/action-cases/${actionCase.id}/attachments/${id}`} target="_blank" rel="noreferrer"><FileText size={16} className="shrink-0" />{actionCase.attachments.find((a) => a.id === id)?.fileName ?? 'Filen är inte längre tillgänglig'}</a></li>)}</ul></div></> : null
  if (typeof document === 'undefined') return null
  return createPortal(<div className="fixed inset-0 z-[70] flex justify-end bg-black/40"><div ref={dialog} role="dialog" aria-busy={working} aria-modal="true" aria-labelledby="group-request-title" tabIndex={-1} className="flex h-dvh w-full max-w-3xl flex-col bg-white text-slate-950 shadow-2xl outline-none" onKeyDown={(e) => {
    e.stopPropagation()
    if (e.key === 'Escape') { e.preventDefault(); close() }
    if (e.key !== 'Tab') return
    const nodes = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]') ?? []).filter((n) => n.getClientRects().length && !n.closest('fieldset:disabled'))
    const first = nodes[0], last = nodes.at(-1)
    if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }}>
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6"><div className="min-w-0"><p className="text-xs font-semibold text-violet-700">{actionCase.title}</p><h2 id="group-request-title" className="mt-1 text-xl font-semibold">{editing ? 'Samlad offertförfrågan' : request?.supplierName}</h2><p className="mt-1 text-xs text-slate-500">{request ? statuses[request.deliveryStatus] : 'Ny förfrågan'}{supplementId || request?.supplementsId ? ' · Komplettering' : ''}</p></div><button className={secondary} disabled={working} aria-label="Stäng offertförfrågan" title="Stäng" onClick={close}><X size={20} /></button></header>
    <div data-request-content className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
      {editing ? <form id="group-request-form" className="space-y-6" onSubmit={(e) => { e.preventDefault(); if (!valid || working) return; void run('quote_request', { ...form, operation: 'save', lines: selectedLines, expectedUpdatedAt: expected }).then((ok) => { if (ok) { setDirty(false); setEditing(false) } }) }}>
        <fieldset disabled={working} className="space-y-4">
          <legend className="mb-3 font-semibold">Mottagare</legend>
          {actionCase.participants.some((p) => p.role === 'subcontractor') ? <label className="block text-sm">Befintlig UE<select className={input} defaultValue="" disabled={Boolean(form.supplementsId)} onChange={(e) => { const p = actionCase.participants.find((p) => p.id === e.target.value); if (p) { set('supplierName', p.companyName || p.name); set('supplierEmail', p.email ?? '') } }}><option value="">Välj kontakt</option>{actionCase.participants.filter((p) => p.role === 'subcontractor').map((p) => <option key={p.id} value={p.id}>{p.companyName || p.name}</option>)}</select></label> : null}
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Företag / namn *<input name="supplierName" className={input} maxLength={200} value={form.supplierName} onChange={(e) => set('supplierName', e.target.value)} /></label><label className="text-sm">E-post *<input name="supplierEmail" className={input} type="email" maxLength={254} disabled={Boolean(form.supplementsId)} value={form.supplierEmail} onChange={(e) => set('supplierEmail', e.target.value)} /></label></div>
        </fieldset>
        <fieldset disabled={working} className="border-t border-slate-200 pt-4"><legend className="font-semibold">Arbeten att begära pris på *</legend>
          {actionCase.items.map((item) => { const rows = sources.filter((s) => s.itemId === item.id); return rows.length ? <div key={item.id} className="mt-3 border-b border-slate-100 pb-3"><strong className="text-sm">{item.title}</strong>{rows.map((line) => <label className="mt-1 flex min-h-11 items-center gap-3 text-sm" key={line.costLineId}><input className="h-4 w-4 shrink-0 accent-violet-600" type="checkbox" name="workLine" value={line.costLineId} checked={form.selectedIds.includes(line.costLineId)} onChange={(e) => toggle('selectedIds', line.costLineId, e.target.checked)} /><span className="min-w-0 break-words">{line.description}</span></label>)}</div> : null })}
          {!sources.length ? <p className="mt-3 text-sm text-amber-800">Det saknas arbetsrader i åtgärdernas kalkyler.</p> : null}
          {form.selectedIds.some((id) => !sources.some((s) => s.costLineId === id)) ? <p className="mt-3 text-sm text-amber-800">Ett tidigare valt arbete finns inte längre tillgängligt. <button type="button" className="underline" onClick={() => set('selectedIds', form.selectedIds.filter((id) => sources.some((s) => s.costLineId === id)))}>Ta bort otillgängliga val</button></p> : null}
        </fieldset>
        {(['included', 'separate'] as const).map((kind) => <fieldset disabled={working} className="border-t border-slate-200 pt-4" key={kind}><legend className="font-semibold">{kind === 'included' ? 'Önskas ingå i offererat pris' : 'Separata prisuppgifter'}</legend><div className="mt-2 grid gap-x-4 sm:grid-cols-2">{REQUEST_REQUIREMENTS.filter((r) => r.kind === kind).map((r) => <label className="flex min-h-11 items-center gap-3 py-2 text-sm" key={r.key}><input className="h-4 w-4 shrink-0 accent-violet-600" type="checkbox" name="requirement" value={r.key} checked={form.requirementKeys.includes(r.key)} onChange={(e) => toggle('requirementKeys', r.key, e.target.checked)} /><span>{r.label}</span></label>)}</div></fieldset>)}
        <fieldset disabled={working} className="space-y-4 border-t border-slate-200 pt-4">
          <label className="block text-sm">Övriga önskemål<textarea name="otherRequirements" rows={2} className={`${input} py-2`} maxLength={3000} value={form.otherRequirements} onChange={(e) => set('otherRequirements', e.target.value)} /></label>
          <label className="block text-sm">Ämne *<input className={input} maxLength={200} value={form.subject} onChange={(e) => set('subject', e.target.value)} /></label>
          <label className="block text-sm">Meddelande till UE<textarea name="message" rows={3} className={`${input} py-2`} maxLength={6000} value={form.message} onChange={(e) => set('message', e.target.value)} /></label>
        </fieldset>
        <fieldset disabled={working} className="border-t border-slate-200 pt-4"><legend className="font-semibold">Bilagor</legend><ActionCaseAttachmentPicker caseId={actionCase.id} files={actionCase.attachments.filter((a) => !a.isQuoteDocument && !privateDocs.has(a.id))} selectedIds={form.attachmentIds} inputName="attachment" disabled={working} onChange={(id, checked) => toggle('attachmentIds', id, checked)} /><p className="mt-2 text-xs text-slate-500">{form.attachmentIds.length} valda · högst 30 filer och 5 MB sammanlagt</p>{form.attachmentIds.length > 30 || attachmentBytes > 5 * 1024 * 1024 ? <p role="status" className="mt-2 text-sm text-amber-800">Bilagorna överstiger gränsen på 30 filer eller 5 MB. Välj färre eller mindre filer före förhandsgranskningen.</p> : null}</fieldset>
      </form> : request ? <div className="space-y-5">
        {!current && !locked ? <p role="status" className="text-sm text-amber-800">Arbetsunderlaget har ändrats. Redigera och granska förfrågan igen före utskick.</p> : null}
        {locked && !current ? <p role="status" className="text-sm text-amber-800">Arbetsunderlaget har ändrats efter att utskicket påbörjades. Den sparade förfrågan är oförändrad.</p> : null}
        {request.sentAt ? <details className="border-b border-slate-200 pb-4"><summary className="cursor-pointer text-sm font-semibold">Visa skickad förfrågan</summary><div className="mt-4 space-y-5">{requestPreview}</div></details> : requestPreview}
        {request.sentAt ? <section className="border-t border-slate-200 pt-4" aria-label="Offertsvar"><header className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Offertsvar</h3><button className={secondary} disabled={working || responseEditing} onClick={() => setResponseEditing(true)}><Pencil size={16} />Registrera prisvillkor</button></header>
          {responseEditing ? <ResponseForm request={request} actionCase={actionCase} busy={working} onSave={(data) => run('quote_request', data)} onCancel={() => setResponseEditing(false)} /> : <>
            <p className={`mt-3 text-sm ${request.responseMode === 'itemized' ? 'text-slate-700' : 'text-amber-800'}`}>{request.responseMode === 'itemized' ? 'Delpriser gäller vid separat beställning.' : request.responseMode === 'package' ? `Paketpris: ${request.packageAmount === null ? 'belopp saknas' : money(request.packageAmount)}. Behöver specificeras innan delpriser används i kalkylen.` : 'Bekräfta om delpriserna gäller vid separat beställning innan de används i kalkylen.'}</p>
            {request.responseNotes ? <p className="mt-3 whitespace-pre-wrap break-words text-sm">{request.responseNotes}</p> : null}
            {request.responseDocumentId ? <a className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm text-violet-700 underline" href={`/api/action-cases/${actionCase.id}/attachments/${request.responseDocumentId}`} target="_blank" rel="noreferrer"><FileText size={16} />Öppna offertdokument</a> : null}
            <ul className="mt-3 divide-y divide-slate-200">{request.lines.map((s) => { const item = actionCase.items.find((i) => i.id === s.itemId), line = item?.costLines.find((l) => l.id === s.costLineId), quote = line?.quotes?.find((q) => q.requestId === request.id); return <li className="flex flex-wrap items-center justify-between gap-2 py-3" key={s.costLineId}><div className="min-w-0"><strong className="block break-words text-sm">{s.itemTitle}: {s.description}</strong><p className="mt-1 text-xs text-slate-500">{quote?.amount == null ? 'Pris saknas' : `${money(quote.amount)} · ${quote.checked ? 'Kontrollerat' : 'Ej kontrollerat'}`}</p></div><button className={secondary} disabled={working || !line} onClick={() => onOpenWork(s.itemId, s.costLineId)}>Öppna kalkyl<ArrowRight size={16} /></button></li> })}</ul>
          </>}
        </section> : null}
        {deleting ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>Ta bort utkastet?</span><button className={secondary} disabled={working} onClick={() => setDeleting(false)}>Avbryt</button><button className={secondary} disabled={working} onClick={() => void run('quote_request', { operation: 'delete', expectedUpdatedAt: request.updatedAt }).then((ok) => { if (ok) onClose() })}><Trash2 size={16} />Ta bort</button></div> : null}
      </div> : null}
    </div>
    <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
      {editing ? <><button className={secondary} disabled={working} onClick={() => { if (request) { setEditing(false); setDirty(false) } else close() }}>Avbryt</button><button className={primary} form="group-request-form" type="submit" disabled={working || !valid}>{working ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}Spara och förhandsgranska</button></> : request ? <>
        {!locked ? <><button className={secondary} disabled={working} title="Ta bort utkast" aria-label="Ta bort utkast" onClick={() => setDeleting(true)}><Trash2 size={16} /></button><button className={secondary} disabled={working} onClick={() => { setForm({ requestId: request.id, supplierName: request.supplierName, supplierEmail: request.supplierEmail, subject: request.subject, message: request.message, selectedIds: request.lines.map((l) => l.costLineId), requirementKeys: request.requirements.map((r) => r.key), otherRequirements: request.otherRequirements, attachmentIds: request.attachmentIds, supplementsId: request.supplementsId }); setAttachmentOverrides(savedOverrides(request)); setExpected(request.updatedAt); setEditing(true) }}><Pencil size={16} />Redigera</button></> : <button className={secondary} disabled={working || responseEditing} onClick={() => onSupplement(request)}><Plus size={16} />Komplettera</button>}
        {!request.sentAt ? <button className={primary} disabled={working || (!locked && !current)} onClick={() => void run('send_grouped_quote_request', { confirmSend: true, expectedUpdatedAt: request.updatedAt })}>{working ? <Loader2 className="animate-spin" size={16} /> : <Send size={16} />}{locked ? 'Försök skicka igen' : 'Skicka förfrågan'}</button> : <button className={secondary} disabled={working} onClick={close}>Stäng</button>}
      </> : null}
    </footer>
  </div></div>, document.body)
}
