'use client'
/* eslint-disable @next/next/no-img-element -- Local camera previews use revocable blob URLs. */

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Camera, CheckCircle2, ImagePlus, Loader2, Plus, RotateCcw, Save, Send, Trash2, X } from 'lucide-react'
import { DIARY_IMAGE_TYPES, DIARY_MAX_PHOTO_BYTES, DIARY_MAX_PHOTOS, diaryTimeInput, diaryTimeRange, diaryMinutes, diaryPersonEntryRequest, diaryRevisionRequest, diaryPhotoRequest, emptyDiaryBody, type DiaryBody, type DiaryPerson, type DiaryEntry } from '@/lib/action-cases/projectDiary'
import { uploadDiaryPhoto } from '@/lib/action-cases/projectDiaryUpload'

type Draft = Omit<DiaryBody, 'breakMinutes'> & { breakMinutes: string }
type Photo = { id: string; name: string; size: number; contentType: string; status: 'queued' | 'uploading' | 'ready' | 'error'; file?: File; preview?: string; error?: string; progress?: string }
type Attempt = ReturnType<typeof diaryPersonEntryRequest> | ReturnType<typeof diaryRevisionRequest>
type Receipt = { id: string; receivedAt: string; minutes: number | null }
const subscribe = (listener: () => void) => { window.addEventListener('diary-draft', listener); window.addEventListener('storage', listener); return () => { window.removeEventListener('diary-draft', listener); window.removeEventListener('storage', listener) } }
function cached(key: string) { try { return sessionStorage.getItem(key) } catch { return null } }
function store(key: string, value: unknown) { try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new Event('diary-draft')) } catch { /* Network submission remains available if device storage is unavailable. */ } }
function initial(name: string, company: string): Draft { return { ...emptyDiaryBody(name, company), breakMinutes: '0' } }
const dateTime = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value))

export default function DiaryEntryForm({ endpoint, storageKey, items, person, onSaved, onDirty, onWorking, editing, onCancel }: {
  endpoint: string; storageKey: string; items: { id: string; title: string }[]; person: DiaryPerson
  onSaved?: () => void; onDirty?: (dirty: boolean) => void; onWorking?: (working: boolean) => void
  editing?: DiaryEntry; onCancel?: () => void
}) {
  const baseline = useRef(editing ? { ...editing.body, breakMinutes: String(editing.body.breakMinutes) } : initial(person.name, person.company))
  const [draft, setDraft] = useState<Draft>(() => baseline.current), [photos, setPhotos] = useState<Photo[]>(() => editing?.photos.map(photo => ({ ...photo, status: 'ready', preview: `${endpoint}/photos/${photo.id}` })) ?? [])
  const [attempt, setAttempt] = useState<Attempt | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const running = useRef(false), uploads = useRef(new Set<string>()), controllers = useRef(new Set<AbortController>()), previews = useRef(new Set<string>())
  const pendingUploads = useRef<Photo[]>([]), mounted = useRef(true)
  const heading = useRef<HTMLHeadingElement>(null), input = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null)
  const timeHelp = useId(), photoHelp = useId()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { if (!editing?.editUntil) return; const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(editing.editUntil) - Date.now())); return () => clearTimeout(timer) }, [editing?.editUntil])
  const expired = Boolean(editing?.editUntil && now >= Date.parse(editing.editUntil))
  const latest = useRef({ draft, photos, attempt }); latest.current = { draft, photos, attempt }
  const snapshot = useSyncExternalStore(subscribe, useCallback(() => cached(storageKey), [storageKey]), () => null)
  const dirty = !receipt && (attempt !== null || photos.map(p => p.id).join(',') !== (editing?.photos ?? []).map(p => p.id).join(',') || JSON.stringify(draft) !== JSON.stringify(baseline.current))
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false) }, [dirty, onDirty])
  const working = busy || photos.some(p => p.status === 'queued' || p.status === 'uploading')
  const failedPhotos = photos.filter(p => p.status === 'error')
  useEffect(() => { onWorking?.(working); return () => onWorking?.(false) }, [working, onWorking])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
  useEffect(() => { const active = controllers.current, urls = previews.current, pending = pendingUploads.current; mounted.current = true; return () => { mounted.current = false; pending.length = 0; active.forEach(c => c.abort()); urls.forEach(url => URL.revokeObjectURL(url)) } }, [])
  const persist = (nextDraft: Draft, nextPhotos: Photo[], nextAttempt: Attempt | null) => store(storageKey, { draft: nextDraft, photos: nextPhotos.filter(p => p.status === 'ready').map(({ id, name, size, contentType }) => ({ id, name, size, contentType, status: 'ready' })), attempt: nextAttempt, ...(editing ? { entryId: editing.id, revision: editing.revision ?? 0 } : {}) })
  const change = (patch: Partial<Draft>) => { const next = { ...latest.current.draft, ...patch }; latest.current.draft = next; setDraft(next); setError(''); persist(next, latest.current.photos, latest.current.attempt) }
  const updatePhoto = (id: string, patch: Partial<Photo>) => { const next = latest.current.photos.map(p => p.id === id ? { ...p, ...patch } : p); latest.current.photos = next; setPhotos(next); persist(latest.current.draft, next, latest.current.attempt) }
  function drainUploads() {
    while (mounted.current && uploads.current.size < 3 && pendingUploads.current.length) void upload(pendingUploads.current.shift()!)
  }
  function queueUploads(photos: Photo[]) {
    for (const photo of photos) {
      if (!photo.file || uploads.current.has(photo.id) || pendingUploads.current.some(p => p.id === photo.id)) continue
      updatePhoto(photo.id, { status: 'queued', error: '' }); pendingUploads.current.push(photo)
    }
    drainUploads()
  }
  async function upload(photo: Photo) {
    if (!photo.file || uploads.current.has(photo.id)) return
    const controller = new AbortController(); controllers.current.add(controller); uploads.current.add(photo.id)
    updatePhoto(photo.id, { status: 'uploading', error: '' })
    try {
      await uploadDiaryPhoto({ endpoint, photo: { ...photo, file: photo.file }, signal: controller.signal,
        onProgress: progress => { if (!controller.signal.aborted && mounted.current) updatePhoto(photo.id, { progress }) } })
      updatePhoto(photo.id, { status: 'ready' })
    } catch (reason) { if (!controller.signal.aborted) updatePhoto(photo.id, { status: 'error', error: reason instanceof Error ? reason.message : 'Bilden kunde inte sparas.' }) }
    finally { uploads.current.delete(photo.id); controllers.current.delete(controller); drainUploads() }
  }
  function addFiles(files: File[]) {
    if (latest.current.attempt || busy || running.current) return
    if (latest.current.photos.length + files.length > DIARY_MAX_PHOTOS) { setError(`Välj högst ${DIARY_MAX_PHOTOS} bilder per anteckning.`); return }
    if (files.some(f => !DIARY_IMAGE_TYPES.includes(f.type as typeof DIARY_IMAGE_TYPES[number]) || f.size < 1 || f.size > DIARY_MAX_PHOTO_BYTES)) { setError('Välj JPG, PNG eller WebP, högst 8 MB per bild.'); return }
    const added: Photo[] = files.map(file => { const preview = URL.createObjectURL(file); previews.current.add(preview); return { id: crypto.randomUUID(), name: file.name, size: file.size, contentType: file.type, file, preview, status: 'queued' } })
    const next = [...latest.current.photos, ...added]; latest.current.photos = next; setPhotos(next); setError(''); persist(latest.current.draft, next, null); queueUploads(added)
  }
  async function submit() {
    if (running.current || photos.some(p => p.status !== 'ready') || expired && !attempt) return
    let request: Attempt
    try {
      const input = { requestId: crypto.randomUUID(), personId: person.id, body: { ...draft, name: person.name, company: person.company, startTime: diaryTimeInput(draft.startTime) ?? draft.startTime, endTime: diaryTimeInput(draft.endTime) ?? draft.endTime, breakMinutes: editing?.body.breakMinutes ?? 0 }, photoIds: photos.map(p => p.id) }
      request = attempt ?? (editing ? diaryRevisionRequest({ ...input, entryId: editing.id, expectedRevision: editing.revision ?? 0 }) : diaryPersonEntryRequest(input))
    }
    catch { setError('Kontrollera datum och arbetsbeskrivning. Tid är valfritt. Om tid anges behövs både från och till, med till-tiden efter från-tiden samma dag.'); return }
    running.current = true; latest.current.attempt = request; setBusy(true); setAttempt(request); setError(''); persist(draft, photos, request)
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: editing ? 'revision' : 'entry', ...request }) })
      const result = await response.json()
      if (!response.ok) {
        if (result.definite) { latest.current.attempt = null; setAttempt(null); persist(draft, photos, null) }
        throw new Error(result.error || 'Inskickningen kunde inte bekräftas.')
      }
      if (result.id !== request.requestId || !Number.isFinite(Date.parse(result.receivedAt)) || result.minutes !== diaryMinutes(request.body)) throw new Error('Kvittot kunde inte bekräftas. Försök igen med samma uppgifter.')
      if (editing && (result.entryId !== editing.id || !('expectedRevision' in request) || result.revision !== request.expectedRevision + 1)) throw new Error('Ändringen kunde inte bekräftas. Försök igen med samma uppgifter.')
      setReceipt(result); store(storageKey, null); onSaved?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Inskickningen kunde inte bekräftas. Försök igen.') }
    finally { running.current = false; setBusy(false) }
  }
  if (receipt) return <section className="diary-receipt" role="status"><CheckCircle2 size={28} /><h3>Anteckningen är mottagen</h3><p>{dateTime(receipt.receivedAt)}</p>{attempt && diaryTimeRange(attempt.body) && <p>Tid på plats {diaryTimeRange(attempt.body)}</p>}<p className="diary-muted">Kvitto {receipt.id}</p><button type="button" onClick={() => { baseline.current = initial(draft.name, draft.company); setReceipt(null); setAttempt(null); setDraft(baseline.current); setPhotos([]); setError(''); previews.current.forEach(url => URL.revokeObjectURL(url)); previews.current.clear() }}><Plus size={17} />Ny anteckning</button></section>
  return <form className="diary-entry-form" aria-label={editing ? 'Redigera dagboksanteckning' : 'Ny dagboksanteckning'} onSubmit={event => { event.preventDefault(); void submit() }}>
    <h3 ref={heading} tabIndex={-1}>{editing ? `${person.name} · ${person.company}` : 'Ny anteckning'}</h3>
    {editing?.editUntil && <p className="diary-muted">Redigerbar till {dateTime(editing.editUntil)}</p>}
    {expired && <p className="diary-notice" role="status">Redigeringstiden har gått ut. Lägg till en rättelse i stället.</p>}
    {snapshot && !dirty && <div className="diary-notice"><span>Det finns ett lokalt utkast på den här enheten.</span><button type="button" onClick={() => {
      try {
        const saved = JSON.parse(snapshot)
        if (editing && (saved.entryId !== editing.id || saved.revision !== (editing.revision ?? 0))) throw new Error()
        if (!saved.draft || !Array.isArray(saved.photos) || saved.photos.length > DIARY_MAX_PHOTOS || ['name','company','workDate','startTime','endTime','breakMinutes','text'].some(key => typeof saved.draft[key] !== 'string')) throw new Error()
        const restoredDraft: Draft = { name: saved.draft.name, company: saved.draft.company, workDate: saved.draft.workDate, startTime: saved.draft.startTime, endTime: saved.draft.endTime, breakMinutes: saved.draft.breakMinutes, text: saved.draft.text, itemId: saved.draft.itemId || null }
        const restoredPhotos: Photo[] = saved.photos.map((p: Photo) => ({ ...diaryPhotoRequest(p), status: 'ready', ...(editing?.photos.some(photo => photo.id === p.id) ? { preview: `${endpoint}/photos/${p.id}` } : {}) }))
        if (new Set(restoredPhotos.map(p => p.id)).size !== restoredPhotos.length) throw new Error()
        if (restoredDraft.name !== person.name || restoredDraft.company !== person.company) throw new Error()
        const restoredAttempt = saved.attempt ? editing ? diaryRevisionRequest(saved.attempt) : diaryPersonEntryRequest(saved.attempt) : null
        const input = { requestId: restoredAttempt?.requestId, personId: person.id, body: { ...restoredDraft, breakMinutes: Number(restoredDraft.breakMinutes) }, photoIds: restoredPhotos.map(p => p.id) }
        if (restoredAttempt && JSON.stringify(restoredAttempt) !== JSON.stringify(editing ? diaryRevisionRequest({ ...input, entryId: editing.id, expectedRevision: editing.revision ?? 0 }) : diaryPersonEntryRequest(input))) throw new Error()
        latest.current = { draft: restoredDraft, photos: restoredPhotos, attempt: restoredAttempt }
        setDraft(restoredDraft); setPhotos(restoredPhotos); setAttempt(restoredAttempt); setError(''); heading.current?.focus()
      }
      catch { setError('Utkastet kunde inte återställas.'); }
    }}><RotateCcw size={16} />Återställ utkast</button></div>}
    <fieldset disabled={busy || Boolean(attempt)}>
      <div className="diary-time-grid"><label>Arbetsdatum<input required type="date" max={emptyDiaryBody().workDate} value={draft.workDate} onChange={e => change({ workDate: e.target.value })} /></label><label>Från (ca, valfritt)<input type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="07:00" aria-describedby={timeHelp} value={draft.startTime} onChange={e => change({ startTime: e.target.value })} onBlur={e => { const time = diaryTimeInput(e.target.value); if (time) change({ startTime: time }) }} /></label><label>Till (ca, valfritt)<input type="text" inputMode="numeric" autoComplete="off" maxLength={5} placeholder="16:00" aria-describedby={timeHelp} value={draft.endTime} onChange={e => change({ endTime: e.target.value })} onBlur={e => { const time = diaryTimeInput(e.target.value); if (time) change({ endTime: time }) }} /></label></div>
      <p id={timeHelp} className="diary-muted diary-field-help">Tid på plats är frivillig. Ange både från och till om du anger tid. Skriv till exempel 0700 för 07:00.</p>
      <label>Moment (valfritt)<select value={draft.itemId || ''} onChange={e => change({ itemId: e.target.value || null })}><option value="">Hela projektet</option>{items.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>Utfört arbete<textarea required rows={4} maxLength={6000} value={draft.text} onChange={e => change({ text: e.target.value })} /></label>
      <div className="diary-photo-tools"><div className="diary-photo-caption"><span>Bilder · {photos.length}/{DIARY_MAX_PHOTOS}</span><p id={photoHelp}>Högst {DIARY_MAX_PHOTOS} bilder per anteckning, 8 MB per bild. JPG, PNG eller WebP.</p></div><div><button type="button" aria-describedby={photoHelp} disabled={photos.length >= DIARY_MAX_PHOTOS} onClick={() => camera.current?.click()}><Camera size={18} />Ta bild</button><button type="button" aria-describedby={photoHelp} disabled={photos.length >= DIARY_MAX_PHOTOS} onClick={() => input.current?.click()}><ImagePlus size={18} />Välj bilder</button></div></div>
      <input ref={camera} type="file" capture="environment" accept={DIARY_IMAGE_TYPES.join(',')} hidden onChange={e => { addFiles(Array.from(e.currentTarget.files || [])); e.currentTarget.value = '' }} />
      <input ref={input} type="file" multiple accept={DIARY_IMAGE_TYPES.join(',')} hidden onChange={e => { addFiles(Array.from(e.currentTarget.files || [])); e.currentTarget.value = '' }} />
    </fieldset>
    {photos.length > 0 && <ul className="diary-upload-list">{photos.map(photo => <li key={photo.id}><div className="diary-upload-image">{photo.preview ? <img src={photo.preview} alt={photo.name} /> : <ImagePlus size={22} />}</div><div><strong>{photo.name}</strong><span>{photo.status === 'queued' ? 'Väntar på uppladdning…' : photo.status === 'uploading' ? photo.progress || 'Laddar upp…' : photo.status === 'ready' ? 'Bilden är sparad' : photo.error}</span>{photo.status === 'error' && photo.file && <button type="button" disabled={busy || Boolean(attempt)} onClick={() => queueUploads([photo])}><RotateCcw size={15} />Försök igen</button>}</div><button type="button" className="diary-icon" aria-label={`Ta bort ${photo.name} från anteckningen`} title="Ta bort från anteckningen" disabled={busy || Boolean(attempt) || photo.status === 'queued' || photo.status === 'uploading'} onClick={() => { if (photo.preview) { URL.revokeObjectURL(photo.preview); previews.current.delete(photo.preview) } const next = latest.current.photos.filter(p => p.id !== photo.id); latest.current.photos = next; setPhotos(next); persist(latest.current.draft, next, latest.current.attempt) }}><Trash2 size={17} /></button></li>)}</ul>}
    {failedPhotos.length > 0 && <div className="diary-notice" role="status"><p>{failedPhotos.length} {failedPhotos.length === 1 ? 'bild är inte sparad' : 'bilder är inte sparade'}. Anteckningen är ännu inte inskickad. Försök igen, eller ta bort de bilderna för att skicka utan dem.</p>{failedPhotos.length > 1 && <button type="button" disabled={busy || Boolean(attempt)} onClick={() => queueUploads(failedPhotos)}><RotateCcw size={16} />Försök igen med alla bilder</button>}</div>}
    {error && <p role="alert" className="diary-error">{error}</p>}
    {attempt && !busy && <p className="diary-notice" role="status">{editing ? 'Ändringen' : 'Inskickningen'} är inte bekräftad. Försök igen med samma uppgifter.</p>}
    <div className="diary-form-footer">{editing && onCancel && <button type="button" disabled={working} onClick={onCancel}><X size={18} />Stäng</button>}<button type="submit" className="diary-primary" disabled={busy || photos.some(p => p.status !== 'ready') || Boolean(editing && !dirty) || expired && !attempt}>{busy ? <Loader2 size={18} className="animate-spin" /> : attempt ? <RotateCcw size={18} /> : editing ? <Save size={18} /> : <Send size={18} />}{busy ? editing ? 'Sparar…' : 'Skickar…' : attempt ? 'Försök igen' : editing ? 'Spara ändring' : 'Skicka anteckning'}</button></div>
  </form>
}
