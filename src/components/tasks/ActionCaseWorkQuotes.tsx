'use client'

import { useState } from 'react'
import { ArrowLeft, Check, FileText, Loader2, Mail, Pencil, Plus, RotateCcw, Save, Send, Trash2 } from 'lucide-react'
import type { ActionCaseCostLineView, ActionCaseItemView, ActionCaseQuote, ActionCaseView } from '@/lib/action-cases/contracts'
import { normalizeQuote, quoteIsStale, quoteRequestText } from '@/lib/action-cases/quotes'
import ActionCaseAttachmentPicker from './ActionCaseAttachmentPicker'
import { defaultRequestAttachments } from '@/lib/action-cases/scopeAttachments'
import ActionCaseDirectCostFields, { canEditDirectWork } from './ActionCaseDirectCostFields'
import { coveringQuoteForLine, groupPriceForLine, groupPriceUsability } from './actionCaseGroupPricing'

const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-200'
const button = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white disabled:opacity-40'
const money = (n: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(n)
const deliveryLabels = { draft: 'Ej skickad', sending: 'Skickar / inväntar leveransstatus', sent: 'Förfrågan skickad', failed: 'Utskicket misslyckades', unknown: 'Leveransstatus är osäker' }
type Props = {
  line: ActionCaseCostLineView; item: ActionCaseItemView; caseId?: string
  attachments: ActionCaseView['attachments']; participants: ActionCaseView['participants']; busy: boolean
  onAction: (name: string, data: Record<string, unknown>) => Promise<boolean>
  onEditing: (editing: boolean) => void
  onRequest?: (costLineIds: string[]) => void
  onOpenRequest?: (requestId: string) => void
}

function QuoteForm({ line, item, caseId, attachments, participants, quote, mode, busy, onSave, onCancel }: Props & {
  quote?: ActionCaseQuote; mode: 'request' | 'offer'
  onSave: (data: Record<string, unknown>) => Promise<boolean>; onCancel: () => void
}) {
  const [form, setForm] = useState(() => ({
    quoteId: quote?.id ?? crypto.randomUUID(), supplierName: quote?.supplierName ?? '', supplierEmail: quote?.supplierEmail ?? '',
    amount: quote?.amount?.toString() ?? '', offeredScope: quote?.offeredScope ?? '', exclusions: quote?.exclusions ?? '',
    validUntil: quote?.validUntil ?? '', availableFrom: quote?.availableFrom ?? '',
    materials: quote?.materials ?? 'unspecified', travel: quote?.travel ?? 'unspecified', waste: quote?.waste ?? 'unspecified',
    coveredLineIds: quote?.coveredLineIds ?? [], documentId: quote?.documentId ?? '', checked: quote?.checked ?? false,
    requestSubject: quote?.requestSubject || `Offertförfrågan: ${line.description}`.slice(0, 200),
    requestBody: quote?.requestBody || quoteRequestText(line.description), requestAttachmentIds: quote?.requestAttachmentIds ?? (mode === 'request' ? defaultRequestAttachments([item], attachments, new Set(item.costLines.flatMap((l) => (l.quotes ?? []).flatMap((q) => q.documentId ? [q.documentId] : [])))) : []),
    expectedUpdatedAt: quote?.updatedAt,
  }))
  const requestLocked = Boolean(quote && quote.deliveryStatus !== 'draft')
  const set = (key: string, value: unknown) => setForm((f) => ({ ...f, [key]: value, ...(key === 'checked' ? {} : { checked: false }) }))
  const toggle = (key: 'coveredLineIds' | 'requestAttachmentIds', id: string, checked: boolean) => set(key, checked ? [...form[key], id] : form[key].filter((value) => value !== id))
  const quoteDocuments = item.costLines.flatMap((l) => (l.quotes ?? []).map((q) => q.documentId)).filter(Boolean)
  const eligibleLines = item.costLines.filter((l) => l.id !== line.id && !['own_labor', 'subcontractor'].includes(l.category))
  const mayCover = (l: ActionCaseCostLineView) => l.category === 'other' || form[l.category === 'material' ? 'materials' : l.category === 'transport' ? 'travel' : 'waste'] === 'included'
  let valid = false
  try { normalizeQuote(form); valid = mode === 'offer' || Boolean(form.supplierEmail.trim() && form.requestSubject.trim() && form.requestBody.trim()) } catch { /* Form remains editable. */ }
  const tooLarge = mode === 'request' && (form.requestAttachmentIds.length > 30 || attachments.filter((file) => form.requestAttachmentIds.includes(file.id)).reduce((sum, file) => sum + file.fileSizeBytes, 0) > 5 * 1024 * 1024)
  if (tooLarge) valid = false
  const field = (key: 'supplierName' | 'supplierEmail' | 'amount' | 'validUntil' | 'availableFrom' | 'requestSubject', label: string, type = 'text', disabled = false) => <label className="min-w-0 text-xs font-semibold text-slate-600">{label}<input name={key} type={type} step={type === 'number' ? '0.01' : undefined} min={type === 'number' ? '0' : undefined} className={input} value={form[key]} disabled={disabled} onChange={(e) => set(key, e.target.value)} /></label>
  return <form className="space-y-4 py-4" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) void onSave(form).then((saved) => { if (saved) onCancel() }) }}>
    <h4 className="font-semibold">{mode === 'request' ? 'Offertförfrågan' : 'Registrera offert'}</h4>
    {quote && quoteIsStale(quote, item.scope, line.description) ? <p role="status" className="text-sm text-amber-800">Omfattningen eller giltigheten har ändrats. Registrera en ny, bekräftad offert innan den används i kalkylen.</p> : null}
    <fieldset disabled={busy} className="space-y-4">
      {!quote && participants.some((p) => p.role === 'subcontractor') ? <label className="block text-xs font-semibold text-slate-600">Befintlig underentreprenör<select className={input} defaultValue="" onChange={(e) => { const p = participants.find((p) => p.id === e.target.value); if (p) setForm((f) => ({ ...f, supplierName: p.companyName || p.name, supplierEmail: p.email ?? '' })) }}><option value="">Välj kontakt eller fyll i nedan</option>{participants.filter((p) => p.role === 'subcontractor').map((p) => <option value={p.id} key={p.id}>{p.companyName || p.name}</option>)}</select></label> : null}
      <div className="grid gap-3 sm:grid-cols-2">{field('supplierName', 'Företag / namn *', 'text', Boolean(quote?.requestId))}{field('supplierEmail', mode === 'request' ? 'E-post *' : 'E-post', 'email', requestLocked)}</div>
      {mode === 'request' ? <>
        {field('requestSubject', 'Ämne *', 'text', requestLocked)}
        <label className="block text-xs font-semibold text-slate-600">Meddelande *<textarea name="requestBody" rows={9} className={`${input} py-2`} disabled={requestLocked} value={form.requestBody} onChange={(e) => set('requestBody', e.target.value)} /></label>
        <fieldset disabled={requestLocked}><legend className="text-sm font-semibold">Bifoga från uppdraget</legend><ActionCaseAttachmentPicker caseId={caseId} files={attachments.filter((a) => !a.isQuoteDocument && !quoteDocuments.includes(a.id))} selectedIds={form.requestAttachmentIds} inputName="requestAttachmentIds" disabled={busy || requestLocked} onChange={(id, checked) => toggle('requestAttachmentIds', id, checked)} />{tooLarge ? <p role="status" className="mt-2 text-sm text-amber-800">Bilagorna överstiger gränsen på 30 filer eller 5 MB. Välj färre eller mindre filer.</p> : null}</fieldset>
      </> : <>
        <div className="grid gap-3 sm:grid-cols-2">{field('amount', 'Offertbelopp exkl. moms, kr', 'number')}{field('validUntil', 'Giltig till', 'date')}{field('availableFrom', 'Kan utföras från', 'date')}</div>
        <label className="block text-xs font-semibold text-slate-600">Offertens omfattning<textarea name="offeredScope" rows={3} className={`${input} py-2`} value={form.offeredScope} onChange={(e) => set('offeredScope', e.target.value)} /></label>
        <label className="block text-xs font-semibold text-slate-600">Undantag / reservationer<textarea rows={2} className={`${input} py-2`} value={form.exclusions} onChange={(e) => set('exclusions', e.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-3">{([['materials', 'Material'], ['travel', 'Resor / transport'], ['waste', 'Avfall']] as const).map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<select className={input} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value as ActionCaseQuote['materials'], checked: false, coveredLineIds: f.coveredLineIds.filter((id) => {
          const category = item.costLines.find((l) => l.id === id)?.category
          return e.target.value === 'included' || category !== (key === 'materials' ? 'material' : key === 'travel' ? 'transport' : 'waste')
        }) }))}><option value="unspecified">Ej angivet</option><option value="included">Ingår</option><option value="excluded">Ingår inte</option></select></label>)}</div>
        {eligibleLines.length ? <fieldset><legend className="text-sm font-semibold">Kalkylrader som redan ingår i offertbeloppet</legend>{eligibleLines.map((l) => <label className="mt-2 flex min-h-11 items-center gap-2 text-sm" key={l.id}><input className="h-4 w-4 shrink-0 accent-violet-600" type="checkbox" name="coveredLineIds" value={l.id} disabled={!mayCover(l) || Boolean(l.coveredByQuoteId && l.coveredByQuoteId !== quote?.id && l.coveredByQuoteId !== line.selectedQuoteId)} checked={form.coveredLineIds.includes(l.id)} onChange={(e) => toggle('coveredLineIds', l.id, e.target.checked)} /><span className="min-w-0 break-words">{l.description}</span></label>)}</fieldset> : null}
        <label className="block text-xs font-semibold text-slate-600">Offertdokument<select className={input} value={form.documentId} onChange={(e) => set('documentId', e.target.value)}><option value="">Inget valt</option>{attachments.filter((a) => a.type === 'document').map((a) => <option key={a.id} value={a.id}>{a.title || a.fileName}</option>)}</select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input name="checked" className="h-4 w-4 shrink-0 accent-violet-600" type="checkbox" disabled={!form.amount.trim() || !form.offeredScope.trim()} checked={form.checked} onChange={(e) => set('checked', e.target.checked)} />Jag har kontrollerat belopp och omfattning</label>
      </>}
    </fieldset>
    <div className="flex flex-wrap justify-end gap-2"><button className={button} type="button" disabled={busy} onClick={onCancel}>Avbryt</button><button className={primary} disabled={busy || !valid} type="submit">{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{mode === 'request' ? 'Spara och förhandsgranska' : 'Spara offert'}</button></div>
  </form>
}

export default function ActionCaseWorkQuotes(props: Props) {
  const { line, item, attachments, busy, onAction, onEditing, caseId } = props
  const [editor, setEditor] = useState<{ quote?: ActionCaseQuote; mode: 'request' | 'offer' } | null>(null)
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [view, setView] = useState<'direct' | 'quotes'>(line.pricingMethod ?? 'direct')
  const [directEditing, setDirectEditing] = useState(false)
  const [markupDraft, setMarkupDraft] = useState<{ value: string; expectedLineUpdatedAt?: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const quotes = line.quotes ?? []
  const groupQuote = groupPriceForLine(line, item)
  const coveringQuote = coveringQuoteForLine(line, item)
  const preview = quotes.find((q) => q.id === previewId && q.packageGroupKey == null)
  const action = (operation: string, data: Record<string, unknown> = {}) => {
    if (busy || groupQuote || line.coveredByQuoteId || quotes.some((quote) => quote.id === data.quoteId && quote.packageGroupKey != null)) return Promise.resolve(false)
    return onAction('work_quote', { costLineId: line.id, operation, expectedLineUpdatedAt: line.updatedAt, ...data })
  }
  const edit = (value: typeof editor) => { setEditor(value); onEditing(Boolean(value) || directEditing || Boolean(markupDraft)) }
  const controlsBusy = busy || directEditing || Boolean(markupDraft)
  const markup = markupDraft?.value ?? String(line.markupPercent)
  const markupValid = Boolean(markup.trim()) && Number.isFinite(Number(markup)) && Number(markup) >= -100 && Number(markup) <= 1000
  if (groupQuote || line.coveredByQuoteId) {
    const requestId = (groupQuote ?? coveringQuote)?.requestId
    const drafting = Boolean(editor) || directEditing || Boolean(markupDraft)
    const priceStatus = groupQuote ? groupPriceUsability(groupQuote, item) : null
    return <section className="mt-3 space-y-3 border-y border-violet-200 py-4" aria-label={`Prisunderlag för ${line.description}`}>
      <p role="status" className={`text-sm font-semibold ${priceStatus && !priceStatus.usable ? 'text-amber-800' : 'text-violet-700'}`}>{groupQuote ? 'Ingår i grupppris' : 'Ingår i vald offert'}{priceStatus ? ` · ${priceStatus.label}` : ''}{line.coveredByQuoteId ? ' · räknas inte separat' : ''}</p>
      {groupQuote ? <p className="break-words text-sm text-slate-600">{groupQuote.supplierName}{groupQuote.amount === null ? '' : ` · Grupppris ${money(groupQuote.amount)}`}</p> : null}
      {groupQuote ? <div className="space-y-2">
        <p className="whitespace-pre-wrap break-words text-sm text-slate-600"><strong>Offertens omfattning:</strong> {groupQuote.offeredScope || 'Omfattning saknas'}</p>
        {groupQuote.exclusions ? <p className="whitespace-pre-wrap break-words text-sm text-amber-800"><strong>Undantag:</strong> {groupQuote.exclusions}</p> : null}
        <p className="text-xs text-slate-500">{groupQuote.validUntil ? `Giltig till ${groupQuote.validUntil}` : 'Giltighet ej angiven'}</p>
      </div> : null}
      <button type="button" className={button} disabled={busy || drafting || !requestId || !props.onOpenRequest} onClick={() => { if (requestId) props.onOpenRequest?.(requestId) }}><Mail size={16} />{groupQuote ? 'Öppna grupppris' : 'Öppna offertförfrågan'}</button>
      {drafting ? <button type="button" className={button} disabled={busy} onClick={() => { setEditor(null); setDirectEditing(false); setMarkupDraft(null); onEditing(false) }}><RotateCcw size={16} />Återställ osparade ändringar</button> : null}
    </section>
  }
  return <section className="mt-3 border-y border-violet-200 py-4" aria-label={`Prisunderlag för ${line.description}`}>
    <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">{([['direct', line.unit === 'tim' || line.pricingMethod === 'quotes' ? 'Timmar' : 'Eget pris'], ['quotes', `Offerter (${quotes.length})`]] as const).map(([key, label]) => <button type="button" className={`min-h-11 rounded-md text-sm font-semibold disabled:opacity-40 ${view === key ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600'}`} key={key} aria-pressed={view === key} disabled={controlsBusy || Boolean(editor)} onClick={() => setView(key)}>{label}</button>)}</div>
    {view === 'direct' ? canEditDirectWork(line) || directEditing ? <ActionCaseDirectCostFields line={line} expectedUpdatedAt={item.updatedAt} busy={busy} onEditing={(value) => { setDirectEditing(value); onEditing(value) }} onSave={(payload) => onAction('work_part', payload)} /> : <div className="mt-3 space-y-3">
      <p className="text-sm text-slate-600">{line.coveredByQuoteId ? 'Arbetet ingår i en vald offert.' : line.selectedQuoteId ? 'Vald offert används i kalkylen.' : 'Offertpris används för arbetet. Ingen offert är vald.'}</p>
      {!line.coveredByQuoteId ? <button type="button" className={button} disabled={busy} onClick={() => void action('method', { method: 'direct' })}><Pencil size={16} />Använd egen kalkyl</button> : null}
    </div> : <>
      {editor ? <QuoteForm {...props} key={editor.quote?.id ?? editor.mode} quote={editor.quote} mode={editor.mode} onCancel={() => edit(null)} onSave={async (data) => {
        const saved = await action('save', data)
        if (saved && editor.mode === 'request') setPreviewId(String(data.quoteId))
        return saved
      }} /> : <>
        <div className="my-4 flex flex-wrap gap-2"><button className={button} disabled={controlsBusy} onClick={() => edit({ mode: 'offer' })}><Plus size={16} />Registrera offert</button><button className={button} disabled={controlsBusy} onClick={() => props.onRequest ? props.onRequest([line.id]) : edit({ mode: 'request' })}><Mail size={16} />Begär offert</button></div>
        {!quotes.length ? <p className="py-3 text-sm text-slate-500">Inga offertalternativ ännu.</p> : <ul className="divide-y divide-slate-200">{quotes.map((q) => {
          const stale = quoteIsStale(q, item.scope, line.description), selected = line.selectedQuoteId === q.id
          const grouped = q.packageGroupKey != null
          return <li className="space-y-2 py-4" key={q.id}>
            <div className="flex flex-wrap items-baseline justify-between gap-2"><strong className="min-w-0 break-words text-sm">{q.supplierName}</strong><span className="text-sm font-semibold">{q.amount === null ? 'Inväntar pris' : money(q.amount)}</span></div>
            <p className={`text-xs ${stale ? 'text-amber-800' : selected ? 'text-emerald-700' : 'text-slate-500'}`}>{grouped ? 'Grupppris · ' : ''}{stale ? 'Behöver ny offert: ändrad omfattning eller utgången giltighet' : selected ? 'Vald i kalkylen' : q.checked ? 'Kontrollerad offert' : 'Ej kontrollerad'} · {deliveryLabels[q.deliveryStatus]}</p>
            {q.offeredScope ? <p className="whitespace-pre-wrap break-words text-sm text-slate-600">{q.offeredScope}</p> : null}
            {q.exclusions ? <p className="whitespace-pre-wrap break-words text-sm text-amber-800">Undantag: {q.exclusions}</p> : null}
            <p className="text-xs text-slate-500">{q.validUntil ? `Giltig till ${q.validUntil}` : 'Giltighet ej angiven'}{q.availableFrom ? ` · Tillgänglig ${q.availableFrom}` : ''}{q.coveredLineIds.length ? ` · ${q.coveredLineIds.length} kalkylrader ingår` : ''}</p>
            {q.documentId && caseId ? <a className="inline-flex min-h-11 items-center gap-2 text-sm text-violet-700 underline" href={`/api/action-cases/${caseId}/attachments/${q.documentId}`} target="_blank" rel="noreferrer"><FileText size={16} />Öppna offertdokument</a> : null}
            <div className="flex flex-wrap gap-2">
              {grouped ? <button type="button" className={button} disabled={controlsBusy || !q.requestId || !props.onOpenRequest} onClick={() => { if (q.requestId) props.onOpenRequest?.(q.requestId) }}><Mail size={16} />Öppna grupppris</button> : <>
              <button className={selected ? button : primary} disabled={controlsBusy || (!selected && (stale || !q.checked || q.amount === null || q.separatePricesConfirmed === false))} onClick={() => void action(selected ? 'unselect' : 'select', { quoteId: q.id, expectedQuoteUpdatedAt: q.updatedAt })}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}{selected ? 'Ta bort val' : 'Använd i kalkylen'}</button>
              <button className={button} disabled={controlsBusy} title="Redigera offert" aria-label={`Redigera offert från ${q.supplierName}`} onClick={() => edit({ quote: q, mode: 'offer' })}><Pencil size={16} /></button>
              <button className={button} disabled={controlsBusy} title="Visa förfrågan" aria-label={`Visa förfrågan till ${q.supplierName}`} onClick={() => q.requestId && props.onOpenRequest ? props.onOpenRequest(q.requestId) : setPreviewId(previewId === q.id ? null : q.id)}><Mail size={16} /></button>
              {q.deliveryStatus === 'draft' ? <button className={button} disabled={controlsBusy} title="Ta bort offertalternativ" aria-label={`Ta bort offert från ${q.supplierName}`} onClick={() => setDeleting(q.id)}><Trash2 size={16} /></button> : null}
              </>}
            </div>
            {q.requestId && q.separatePricesConfirmed === false ? <p className="text-sm text-amber-800">Prisvillkoren behöver bekräftas i den samlade förfrågan.</p> : null}
            {!grouped && deleting === q.id ? <div className="flex flex-wrap items-center gap-2 text-sm"><span>Ta bort offertalternativet?</span><button className={button} disabled={controlsBusy} onClick={() => setDeleting(null)}>Avbryt</button><button className={button} disabled={controlsBusy} onClick={() => void action('delete', { quoteId: q.id, expectedQuoteUpdatedAt: q.updatedAt }).then((saved) => { if (saved) setDeleting(null) })}>Ta bort</button></div> : null}
          </li>
        })}</ul>}
        {preview ? <section aria-label="Förhandsgranska offertförfrågan" className="mt-4 border-y border-slate-300 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold">Förhandsgranska förfrågan</h4><button className={button} disabled={controlsBusy} onClick={() => setPreviewId(null)}><ArrowLeft size={16} />Stäng</button></div>
          <p className="mt-3 break-words text-sm"><strong>Till:</strong> {preview.supplierName} &lt;{preview.supplierEmail || 'E-post saknas'}&gt;</p>
          <p className="mt-2 break-words text-sm font-semibold">{preview.requestSubject}</p><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6">{preview.requestBody}</p>
          <p className="mt-3 text-xs font-semibold text-slate-600">Bilagor ({preview.requestAttachmentIds.length})</p><ul className="mt-1 text-sm text-slate-600">{preview.requestAttachmentIds.map((id) => <li className="break-words" key={id}>{attachments.find((a) => a.id === id)?.fileName || 'Filen är inte längre tillgänglig'}</li>)}</ul>
          <p role="status" className="mt-3 text-sm text-slate-600">{deliveryLabels[preview.deliveryStatus]}{preview.sentAt ? ` · ${new Date(preview.sentAt).toLocaleString('sv-SE')}` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">{preview.deliveryStatus === 'draft' ? <button className={button} disabled={controlsBusy} onClick={() => { edit({ quote: preview, mode: 'request' }); setPreviewId(null) }}><Pencil size={16} />Redigera förfrågan</button> : null}
            {!preview.sentAt ? <button className={primary} disabled={controlsBusy || !preview.supplierEmail || !preview.requestBody || quoteIsStale(preview, item.scope, line.description)} onClick={() => void onAction('send_quote_request', { costLineId: line.id, quoteId: preview.id, expectedQuoteUpdatedAt: preview.updatedAt, confirmSend: true })}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{preview.deliveryStatus === 'draft' ? 'Skicka förfrågan' : 'Försök skicka igen'}</button> : null}</div>
        </section> : null}
        {line.pricingMethod === 'quotes' ? <form className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-200 pt-4" onSubmit={(event) => {
          event.preventDefault()
          if (!busy && markupDraft && markupValid) void action('markup', { markupPercent: markup, expectedLineUpdatedAt: markupDraft.expectedLineUpdatedAt }).then((saved) => { if (saved) { setMarkupDraft(null); onEditing(false) } })
        }}><label className="min-w-0 text-xs font-semibold text-slate-600">Påslag, %<input className={input} style={{ maxWidth: 140 }} type="number" step="any" min="-100" max="1000" value={markup} disabled={busy} onChange={(event) => {
          const changed = !event.target.value.trim() || Number(event.target.value) !== line.markupPercent
          setMarkupDraft(changed ? { value: event.target.value, expectedLineUpdatedAt: markupDraft?.expectedLineUpdatedAt ?? line.updatedAt } : null); onEditing(changed)
        }} /></label><button className={button} type="submit" disabled={busy || !markupValid || !markupDraft}><Save size={16} />Spara påslag</button>{markupDraft ? <button type="button" className={button} disabled={busy} title="Återställ påslag" aria-label="Återställ påslag" onClick={() => { setMarkupDraft(null); onEditing(false) }}><RotateCcw size={16} /></button> : null}</form> : null}
      </>}
    </>}
  </section>
}
