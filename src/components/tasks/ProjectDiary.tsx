'use client'
/* eslint-disable @next/next/no-img-element -- Diary images require the signed-in viewer's cookies. */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, ChevronDown, Copy, Filter, Loader2, LockKeyhole, Pencil, Plus, PowerOff, Printer, QrCode, RotateCcw, X } from 'lucide-react'
import DiaryPersonEntry from './DiaryPersonEntry'
import DiaryEntryForm from './DiaryEntryForm'
import DiaryHistory from './DiaryHistory'
import { diaryDuration, diaryTimeRange, type DiaryEntry, type DiaryWorkspace } from '@/lib/action-cases/projectDiary'
import { printDiaryQr } from '@/lib/action-cases/projectDiaryPrint'
import './project-diary.css'

type Workspace = DiaryWorkspace & { nextCursor: string | null }
type Filters = { from: string; to: string; person: string; item: string }
const emptyFilters: Filters = { from: '', to: '', person: '', item: '' }
const displayTime = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value))
function Correction({ endpoint, entryId, onSaved, onDirty }: { endpoint: string; entryId: string; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const [text, setText] = useState(''), [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [attempt, setAttempt] = useState<{ operation: string; entryId: string; requestId: string; text: string } | null>(null), running = useRef(false)
  useEffect(() => { onDirty(open && Boolean(text || attempt)); return () => onDirty(false) }, [open, text, attempt, onDirty])
  if (!open) return <button type="button" onClick={() => setOpen(true)}><Plus size={16} />Lägg till rättelse</button>
  return <form className="diary-correction-form" aria-label="Lägg till rättelse" onSubmit={event => {
    event.preventDefault(); if (running.current || !text.trim()) return
    const payload = attempt || { operation: 'correction', entryId, requestId: crypto.randomUUID(), text: text.trim() }
    running.current = true; setBusy(true); setAttempt(payload); setError('')
    void fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(async response => {
      const result = await response.json()
      if (!response.ok || result.id !== payload.requestId) { if (result.definite) setAttempt(null); throw new Error(result.error || 'Rättelsen kunde inte bekräftas.') }
      setText(''); setAttempt(null); setOpen(false); onSaved()
    }).catch(reason => setError(reason instanceof Error ? reason.message : 'Rättelsen kunde inte bekräftas.')).finally(() => { running.current = false; setBusy(false) })
  }}><label>Rättelse<textarea required maxLength={3000} rows={3} value={text} disabled={busy || Boolean(attempt)} onChange={e => setText(e.target.value)} /></label>{error && <p role="alert" className="diary-error">{error}</p>}<div><button type="button" disabled={busy || Boolean(attempt)} onClick={() => { setOpen(false); setText('') }}><X size={16} />Avbryt</button><button type="submit" disabled={busy || !text.trim()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}{attempt ? 'Försök igen' : 'Spara rättelse'}</button></div></form>
}
function QrDialog({ data, endpoint, onClose }: { data: Workspace; endpoint: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [copied, setCopied] = useState(false)
  useEffect(() => { const node = dialog.current, old = document.activeElement as HTMLElement | null; node?.showModal(); return () => { node?.close(); old?.focus() } }, [])
  async function current() { const response = await fetch(endpoint, { cache: 'no-store' }), result = await response.json(); if (!response.ok || !result.canManage || !result.link?.active || result.link.revision !== data.link.revision || result.link.url !== data.link.url) throw new Error('QR-länken har ändrats. Stäng rutan och hämta den nya koden.'); return result as Workspace }
  return <dialog ref={dialog} className="diary-qr-dialog" aria-labelledby="diary-qr-heading" onCancel={event => { if (busy) event.preventDefault(); else onClose() }}><header><div><h3 id="diary-qr-heading">Dagbokens QR-kod</h3><p>{data.project.title}</p></div><button type="button" className="diary-icon" disabled={busy} aria-label="Stäng QR-kod" title="Stäng" onClick={onClose}><X size={18} /></button></header>
    <img className="diary-qr" src={data.link.qrDataUrl!} alt={`QR-kod till dagboken för ${data.project.title}`} width="360" height="360" />
    {error && <p role="alert" className="diary-error">{error}</p>}<div className="diary-qr-actions"><button type="button" disabled={busy} onClick={() => { setBusy(true); setError(''); void current().then(value => navigator.clipboard.writeText(value.link.url!)).then(() => setCopied(true)).catch(reason => setError(reason instanceof Error ? reason.message : 'Länken kunde inte kopieras.')).finally(() => setBusy(false)) }}><Copy size={17} />{copied ? 'Kopierad' : 'Kopiera länk'}</button><button type="button" disabled={busy} onClick={() => { setBusy(true); setError(''); void current().then(value => printDiaryQr(value.project.title, value.link.url!, value.link.qrDataUrl!)).catch(reason => setError(reason instanceof Error ? reason.message : 'Utskriften kunde inte öppnas.')).finally(() => setBusy(false)) }}><Printer size={17} />Skriv ut QR-kod</button></div></dialog>
}
function Record({ entry, endpoint, canManage, onSaved, onDirty }: { entry: DiaryEntry; endpoint: string; canManage: boolean; onSaved: () => void; onDirty: (dirty: boolean) => void }) {
  const [editing, setEditing] = useState(false), [editDirty, setEditDirty] = useState(false), [correctionDirty, setCorrectionDirty] = useState(false), [now, setNow] = useState(() => Date.now())
  useEffect(() => { onDirty(editDirty || correctionDirty); return () => onDirty(false) }, [editDirty, correctionDirty, onDirty])
  useEffect(() => { if (!entry.canEdit || !entry.editUntil) return; const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(entry.editUntil) - Date.now())); return () => clearTimeout(timer) }, [entry.canEdit, entry.editUntil])
  const editable = canManage && entry.canEdit && entry.editUntil && now < Date.parse(entry.editUntil)
  return <details className="diary-record"><summary className="diary-record-heading"><time dateTime={entry.body.workDate}>{entry.body.workDate}</time><strong title={entry.body.name}>{entry.body.name}</strong><span title={entry.body.company}>{entry.body.company}</span><ChevronDown size={17} aria-hidden="true" /></summary><div className="diary-record-body"><div className="diary-record-person"><strong>{entry.body.name}</strong><span>{entry.body.company}</span></div><div className="diary-record-meta">{diaryTimeRange(entry.body) && <span>Tid på plats {diaryTimeRange(entry.body)}</span>}{entry.itemTitle && <span>{entry.itemTitle}</span>}{entry.photos.length > 0 && <span><Camera size={14} className="inline" /> {entry.photos.length}</span>}</div><p className="diary-record-text">{entry.body.text}</p>
    {entry.photos.length > 0 && <div className="diary-record-photos">{entry.photos.map(photo => <a key={photo.id} href={`${endpoint}/photos/${photo.id}`} target="_blank" rel="noreferrer" title={photo.name}><img src={`${endpoint}/photos/${photo.id}`} alt={photo.name} loading="lazy" /></a>)}</div>}
    <div className="diary-record-audit"><p>Mottagen {displayTime(entry.receivedAt)} · {entry.actorMethod === 'qr_selection' ? 'Person vald via QR' : entry.actorMethod === 'email_code' ? 'Mejl verifierad' : 'Intern inloggning'}{entry.authorEmail ? ` · ${entry.authorEmail}` : ''}</p><details><summary>Registreringsuppgifter</summary><p>Kvitto {entry.id}</p>{entry.body.breakMinutes > 0 && entry.minutes !== null && <p>Ursprunglig registrering: rast {entry.body.breakMinutes} min · {diaryDuration(entry.minutes)}</p>}{entry.emailVerifiedAt && <p>Mejladress verifierad {displayTime(entry.emailVerifiedAt)}</p>}{entry.photos.map(photo => <p key={photo.id}>{photo.name} · SHA-256 {photo.sha256}</p>)}</details></div>
    {entry.editedAt && <p className="diary-muted">Ändrad {displayTime(entry.editedAt)} · {entry.editedBy}</p>}
    {(entry.revision ?? 0) > 0 && <DiaryHistory key={`${entry.id}:${entry.revision}`} endpoint={endpoint} entryId={entry.id} revision={entry.revision!} />}
    {entry.corrections.length > 0 && <div className="diary-corrections">{entry.corrections.map(correction => <div className="diary-correction" key={correction.id}><strong>Rättelse · {correction.actorName}</strong><p>{correction.text}</p><span className="diary-muted">{displayTime(correction.createdAt)}</span></div>)}</div>}
    {canManage && <div className="diary-record-actions">{editable && <button type="button" disabled={correctionDirty} onClick={() => setEditing(true)}><Pencil size={16} />Redigera</button>}<Correction endpoint={endpoint} entryId={entry.id} onSaved={onSaved} onDirty={setCorrectionDirty} /></div>}
    {editing && canManage && <EditDiaryDialog entry={entry} endpoint={endpoint} onDirty={setEditDirty} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved() }} />}
  </div></details>
}
function EditDiaryDialog({ entry, endpoint, onSaved, onClose, onDirty }: { entry: DiaryEntry; endpoint: string; onSaved: () => void; onClose: () => void; onDirty: (dirty: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null), [items, setItems] = useState<{ id: string; title: string }[]>([]), [error, setError] = useState('')
  const [isWorking, setIsWorking] = useState(false), [confirmClose, setConfirmClose] = useState(false), confirmHeading = useRef<HTMLHeadingElement>(null)
  const working = useRef(false), dirty = useRef(false)
  const reportDirty = useCallback((value: boolean) => { dirty.current = value; onDirty(value) }, [onDirty])
  const reportWorking = useCallback((value: boolean) => { working.current = value; setIsWorking(value) }, [])
  const close = () => { if (!working.current) { if (dirty.current) setConfirmClose(true); else onClose() } }
  useEffect(() => { if (confirmClose) confirmHeading.current?.focus() }, [confirmClose])
  useEffect(() => {
    const node = dialog.current, old = document.activeElement as HTMLElement | null, controller = new AbortController()
    node?.showModal()
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal }).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Momenten kunde inte hämtas.'); setItems(data.items) }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Momenten kunde inte hämtas.') })
    return () => { controller.abort(); node?.close(); old?.focus() }
  }, [endpoint])
  return <dialog ref={dialog} className="diary-edit-dialog" aria-labelledby="diary-edit-heading" onCancel={event => { event.preventDefault(); close() }}>
    <header><h3 id="diary-edit-heading">Redigera anteckning</h3><button type="button" className="diary-icon" disabled={isWorking} title="Stäng" aria-label="Stäng redigering" onClick={close}><X size={18} /></button></header>
    {confirmClose && <div className="diary-notice" role="alertdialog" aria-labelledby="diary-edit-close-heading"><h3 id="diary-edit-close-heading" ref={confirmHeading} tabIndex={-1}>Stäng redigeringen?</h3><p>Utkastet bevaras på den här datorn. En ändring som redan skickats kan ha sparats även om svar saknas.</p><div className="diary-confirm-actions"><button type="button" onClick={() => setConfirmClose(false)}>Fortsätt redigera</button><button type="button" onClick={onClose}><X size={16} />Stäng och behåll utkast</button></div></div>}
    {error && <p className="diary-error" role="alert">{error}</p>}
    <div inert={confirmClose}><DiaryEntryForm endpoint={endpoint} storageKey={`diary-edit:${endpoint}:${entry.id}:${entry.revision ?? 0}`} person={{ id: entry.personId ?? entry.id, name: entry.body.name, company: entry.body.company }} items={items.length ? items : entry.body.itemId ? [{ id: entry.body.itemId, title: entry.itemTitle }] : []} editing={entry} onSaved={onSaved} onDirty={reportDirty} onWorking={reportWorking} onCancel={close} /></div>
  </dialog>
}
export default function ProjectDiary({ caseId, active, refreshKey = 0, onDirty }: { caseId: string; active: boolean; refreshKey?: number; onDirty?: (dirty: boolean) => void }) {
  const [data, setData] = useState<Workspace | null>(null), [loading, setLoading] = useState(false), [error, setError] = useState('')
  const [filters, setFilters] = useState<Filters>(emptyFilters), applied = useRef<Filters>(emptyFilters)
  const [formOpen, setFormOpen] = useState(false), [qrOpen, setQrOpen] = useState(false), [linkBusy, setLinkBusy] = useState(false)
  const [linkConfirm, setLinkConfirm] = useState<{ enabled: boolean; rotate: boolean; revision: number } | null>(null)
  const confirmHeading = useRef<HTMLHeadingElement>(null)
  const [formDirty, setFormDirty] = useState(false), [correctionDirty, setCorrectionDirty] = useState(false)
  const correctionStates = useRef(new Set<string>()), sequence = useRef(0), loadingRef = useRef(false), loadedRefresh = useRef(-1)
  const endpoint = `/api/action-cases/${caseId}/diary`
  const reportCorrection = useCallback((id: string, dirty: boolean) => { if (dirty) correctionStates.current.add(id); else correctionStates.current.delete(id); setCorrectionDirty(correctionStates.current.size > 0) }, [])
  useEffect(() => { onDirty?.(formDirty || correctionDirty || linkBusy); return () => onDirty?.(false) }, [formDirty, correctionDirty, linkBusy, onDirty])
  const load = useCallback(async (chosen: Filters = applied.current, cursor?: string) => {
    const serial = ++sequence.current; loadingRef.current = true; setLoading(true); setError('')
    const search = new URLSearchParams(Object.entries(chosen).filter(([, value]) => value)); if (cursor) search.set('cursor', cursor)
    try {
      const response = await fetch(`${endpoint}?${search}`, { cache: 'no-store' }), next = await response.json()
      if (!response.ok) throw new Error(next.error || 'Dagboken kunde inte hämtas.')
      if (serial !== sequence.current) return
      applied.current = chosen
      setData(current => cursor && current ? { ...next, entries: [...current.entries, ...next.entries.filter((entry: DiaryEntry) => !current.entries.some(old => old.id === entry.id))] } : next)
    } catch (reason) { if (serial === sequence.current) setError(reason instanceof Error ? reason.message : 'Dagboken kunde inte hämtas.') }
    finally { if (serial === sequence.current) { loadingRef.current = false; setLoading(false) } }
  }, [endpoint])
  useEffect(() => { if (active && loadedRefresh.current !== refreshKey) { loadedRefresh.current = refreshKey; void load() } }, [active, refreshKey, load])
  useEffect(() => { if (linkConfirm) confirmHeading.current?.focus() }, [linkConfirm])
  function askLink(enabled: boolean, rotate = false) { if (data && !linkBusy) setLinkConfirm({ enabled, rotate, revision: data.link.revision }) }
  async function changeLink() {
    if (!data || !linkConfirm || linkBusy || !data.canManage) return
    setLinkBusy(true); setError('')
    try { const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'link', active: linkConfirm.enabled, expectedRevision: linkConfirm.revision }) }), result = await response.json(); if (!response.ok) throw new Error(result.error || 'QR-länken kunde inte bekräftas.'); setLinkConfirm(null); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'QR-länken kunde inte bekräftas. Hämta det sparade läget.') }
    finally { setLinkBusy(false) }
  }
  return <section hidden={!active} className="diary-section" aria-label="Projektdagbok"><header className="diary-toolbar"><h2>Dagbok</h2><div className="diary-toolbar-actions"><button type="button" className="diary-icon" aria-label="Uppdatera dagbok" title="Uppdatera dagbok" disabled={loading || linkBusy || correctionDirty} onClick={() => void load()}><RotateCcw size={18} /></button>{data?.canManage && (data.link.active ? <><button type="button" disabled={linkBusy} onClick={() => setQrOpen(true)}><QrCode size={18} />Visa QR-kod</button><button type="button" className="diary-icon" disabled={linkBusy} title="Byt QR-kod" aria-label="Byt QR-kod" onClick={() => askLink(true, true)}><RotateCcw size={18} /></button><button type="button" className="diary-icon" disabled={linkBusy} title="Stäng QR-länk" aria-label="Stäng QR-länk" onClick={() => askLink(false)}><PowerOff size={18} /></button></> : <button type="button" disabled={linkBusy} onClick={() => askLink(true)}><QrCode size={18} />Skapa QR-kod</button>)}<button type="button" className="diary-primary" disabled={!data} onClick={() => { if (!formOpen || !formDirty || window.confirm('Stäng den påbörjade anteckningen? Det lokala utkastet finns kvar.')) setFormOpen(!formOpen) }}>{formOpen ? <X size={18} /> : <Plus size={18} />}{formOpen ? 'Stäng anteckning' : 'Ny anteckning'}</button></div></header>
    {loading && !data && <p className="diary-empty" role="status"><Loader2 size={18} className="inline animate-spin" /> Hämtar dagbok…</p>}
    {error && <p className="diary-error" role="alert">{error}</p>}
    {linkConfirm && <div className="diary-notice" role="region" aria-labelledby="diary-link-confirm"><h3 id="diary-link-confirm" ref={confirmHeading} tabIndex={-1}>{!linkConfirm.enabled ? 'Stäng QR-länken?' : linkConfirm.rotate ? 'Byt QR-kod?' : 'Aktivera QR-länken?'}</h3><p>{!linkConfirm.enabled ? 'QR-länken slutar fungera. Sparade anteckningar och bilder behålls.' : linkConfirm.rotate ? 'Den gamla koden slutar fungera. Sparade anteckningar och bilder behålls.' : 'Alla med koden kan se projektets namnlista och lämna anteckningar och bilder under ett valt namn, utan identitetsverifiering. Historik och övriga projektuppgifter delas inte.'}</p><div className="diary-confirm-actions"><button type="button" disabled={linkBusy} onClick={() => setLinkConfirm(null)}><X size={16} />Avbryt</button><button type="button" disabled={linkBusy} onClick={() => void changeLink()}>{linkBusy ? <Loader2 size={16} className="animate-spin" /> : <QrCode size={16} />}Bekräfta</button></div></div>}
    {data && <>
      {!data.managerAssigned && <p className="diary-notice"><LockKeyhole size={16} className="inline" /> Utse projektansvarig under Översikt för att aktivera QR-länken.</p>}
      {formOpen && <DiaryPersonEntry key={caseId} endpoint={endpoint} projectId={caseId} cacheScope={`profile:${data.authorId}`} people={data.people} items={data.items} onDirty={setFormDirty} onSaved={() => void load()} />}
      <form className="diary-filters" aria-label="Filtrera dagboken" onSubmit={event => { event.preventDefault(); if (!loadingRef.current && !correctionDirty) void load(filters) }}><label>Från datum<input type="date" value={filters.from} onChange={e => setFilters(current => ({ ...current, from: e.target.value }))} /></label><label>Till datum<input type="date" value={filters.to} onChange={e => setFilters(current => ({ ...current, to: e.target.value }))} /></label><label>Person<input type="search" maxLength={160} value={filters.person} onChange={e => setFilters(current => ({ ...current, person: e.target.value }))} /></label><label>Moment<select value={filters.item} onChange={e => setFilters(current => ({ ...current, item: e.target.value }))}><option value="">Alla moment</option>{data.items.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label><div className="diary-filter-actions"><button type="submit" disabled={loading || correctionDirty}><Filter size={16} />Filtrera</button><button type="button" className="diary-icon" aria-label="Rensa filter" title="Rensa filter" disabled={loading || correctionDirty} onClick={() => { setFilters(emptyFilters); void load(emptyFilters) }}><RotateCcw size={16} /></button></div></form>
      {!data.entries.length ? <p className="diary-empty">{Object.values(applied.current).some(Boolean) ? 'Inga anteckningar matchar filtret.' : 'Inga dagboksanteckningar ännu.'}</p> : <div className="diary-entries">{data.entries.map(entry => <DiaryRecord key={entry.id} entry={entry} endpoint={endpoint} canManage={data.canManage} onSaved={load} onDirty={reportCorrection} />)}</div>}
      {data.hasMore && <button type="button" disabled={loading || correctionDirty} onClick={() => void load(applied.current, data.nextCursor || undefined)}>{loading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}Visa fler</button>}
    </>}
    {qrOpen && data?.canManage && data.link.active && data.link.url && data.link.qrDataUrl && <QrDialog data={data} endpoint={endpoint} onClose={() => setQrOpen(false)} />}
  </section>
}
function DiaryRecord({ entry, endpoint, canManage, onSaved, onDirty }: { entry: DiaryEntry; endpoint: string; canManage: boolean; onSaved: () => void; onDirty: (id: string, dirty: boolean) => void }) {
  const report = useCallback((dirty: boolean) => onDirty(entry.id, dirty), [entry.id, onDirty])
  return <Record entry={entry} endpoint={endpoint} canManage={canManage} onSaved={onSaved} onDirty={report} />
}
