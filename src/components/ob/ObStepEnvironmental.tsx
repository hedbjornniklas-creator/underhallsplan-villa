'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Plus, RotateCw, Trash2, Upload } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { getObTextDraftStorageKey } from '@/lib/ob/localTextDrafts'
import { conclusionFields, emptyProtocol, isEnvironmentalDraft, parseEnvironmentalProtocol, protocolFields, protocolTitles, resultFields, protocolPublicationErrors,
  type EnvironmentalKind, type EnvironmentalProtocol, type EnvironmentalFile, type ProtocolField } from '@/lib/ob/environmentalProtocol'
import Sheet from './ObRoundSheet'
import './ob-environmental.css'

type State = { document: EnvironmentalProtocol | null; revision: number; files: EnvironmentalFile[] }
type Draft = { document: EnvironmentalProtocol; revision: number }
// A remount must await its previous save before comparing a recovered draft with the server.
const pending = new Map<string, Promise<void>>()
function Field({ field, value, onChange }: { field: ProtocolField; value: string; onChange: (value: string) => void }) {
  return <label className={`ob-form-field ${field.type === 'textarea' ? 'ob-env-wide' : ''}`}>
    <span className="ob-form-label">{field.label}</span>
    {field.options ? <select value={value} onChange={e => onChange(e.target.value)}>{field.options.map(option => <option key={option} value={option}>{option || 'Välj metod'}</option>)}</select>
      : field.type === 'textarea' ? <textarea rows={2} value={value} onChange={e => onChange(e.target.value)} />
      : <input type={field.type === 'number' ? 'text' : field.type || 'text'} inputMode={field.type === 'number' ? 'decimal' : undefined} value={value} onChange={e => onChange(e.target.value)} />}
  </label>
}

export default function ObStepEnvironmental({ kind, inspection, property }: {
  kind: EnvironmentalKind; inspection: { id: string; locked_at?: string | null; status?: string | null };
  property: { address?: string | null; city?: string | null }
}) {
  const toast = useToast()
  const endpoint = `/api/ob/inspections/${inspection.id}/environmental/${kind}`
  const storageKey = getObTextDraftStorageKey(`ob:${inspection.id}:environmental:${kind}`)!
  const locked = Boolean(inspection.locked_at) || ['completed', 'klar', 'done'].includes(inspection.status?.toLowerCase() || '')
  const [document, setDocument] = useState<EnvironmentalProtocol | null>(null)
  const [files, setFiles] = useState<EnvironmentalFile[]>([])
  const [status, setStatus] = useState('Läser protokoll…')
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<State | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const current = useRef<EnvironmentalProtocol | null>(null), revision = useRef(0), saved = useRef('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null), mounted = useRef(false), blocked = useRef(false)
  const uploadInput = useRef<HTMLInputElement>(null)
  const notify = useRef(toast)
  notify.current = toast

  function persist(doc: EnvironmentalProtocol) {
    try { localStorage.setItem(storageKey, JSON.stringify({ document: doc, revision: revision.current })) }
    catch { notify.current.error('Utkastet kunde inte sparas på denna enhet. Lämna inte sidan innan servern har sparat.') }
  }
  async function read(): Promise<State> {
    const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(20000) }), data = await response.json()
    if (!response.ok) throw Error(data.error || 'Kunde inte läsa protokollet.')
    return data
  }
  function acceptServer(state: State) {
    const doc = state.document || emptyProtocol()
    revision.current = state.revision; saved.current = JSON.stringify(doc); current.current = doc
    blocked.current = false
    setDocument(doc); setFiles(state.files); setError(''); setConflict(null); setStatus(locked ? 'Låst' : 'Sparat')
  }
  async function save() {
    if (blocked.current || locked || !current.current || saved.current === JSON.stringify(current.current)) return
    if (pending.has(storageKey)) return
    const work = (async () => {
      // Drain edits made while a previous request is in flight, without replacing typed text.
      while (!blocked.current && current.current && saved.current !== JSON.stringify(current.current)) {
        const doc = current.current, fingerprint = JSON.stringify(doc)
        if (mounted.current) { setStatus('Sparar…'); setError('') }
        try {
          const response = await fetch(endpoint, { method: 'PATCH', signal: AbortSignal.timeout(20000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ document: doc, revision: revision.current }) })
          const result = await response.json()
          if (!response.ok) {
            if (result.conflict) {
              blocked.current = true
              const remote = await read()
              if (mounted.current) setConflict(remote)
            }
            throw Error(result.error || 'Kunde inte spara protokollet.')
          }
          revision.current = result.revision; saved.current = fingerprint
          if (JSON.stringify(current.current) === fingerprint) {
            try { const raw = localStorage.getItem(storageKey); if (raw && JSON.stringify(JSON.parse(raw).document) === fingerprint) localStorage.removeItem(storageKey) } catch {}
          } else persist(current.current)
          if (mounted.current) setStatus('Sparat')
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Kunde inte spara protokollet.'
          if (mounted.current) { setError(message); setStatus('Ej sparat på servern') }
          notify.current.error(message, { dedupeKey: storageKey })
          break
        }
      }
    })()
    pending.set(storageKey, work)
    await work.finally(() => pending.delete(storageKey))
  }
  const saveRef = useRef(save); saveRef.current = save
  function update(doc: EnvironmentalProtocol) {
    current.current = doc; setDocument(doc); persist(doc); setStatus('Ändringar väntar')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { void saveRef.current() }, 700)
  }
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void (async () => {
      try {
        await pending.get(storageKey)
        const remote = await read()
        if (cancelled) return
        let draft: Draft | null = null
        try {
          draft = JSON.parse(localStorage.getItem(storageKey) || 'null')
          if (draft && (!isEnvironmentalDraft(draft.document) || !Number.isInteger(draft.revision))) throw Error('invalid')
        } catch { throw Error('Det lokala utkastet kunde inte läsas. Det har bevarats. Kontakta support innan du ändrar protokollet.') }
        acceptServer(remote)
        if (draft) {
          let fingerprint = JSON.stringify(draft.document)
          try { fingerprint = JSON.stringify(parseEnvironmentalProtocol(draft.document, kind)) } catch { /* Keep partially entered values. */ }
          if (fingerprint === saved.current) localStorage.removeItem(storageKey)
          else {
            current.current = draft.document; setDocument(draft.document)
            if (draft.revision !== remote.revision || locked) { blocked.current = true; setConflict(remote); setStatus('Lokalt utkast finns') }
            else { setStatus('Ändringar väntar'); timer.current = setTimeout(() => { void saveRef.current() }, 700) }
          }
        }
      } catch (error) {
        if (cancelled) return
        const message = error instanceof Error ? error.message : 'Kunde inte läsa protokollet.'
        setError(message); setStatus('Kunde inte läsa'); notify.current.error(message)
      }
    })()
    const flush = () => { if (documentHidden()) void saveRef.current() }
    const online = () => { void saveRef.current() }
    const leave = (event: BeforeUnloadEvent) => {
      if (current.current && saved.current !== JSON.stringify(current.current)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('online', online); window.addEventListener('beforeunload', leave)
    window.document.addEventListener('visibilitychange', flush)
    return () => {
      cancelled = true; mounted.current = false
      if (timer.current) clearTimeout(timer.current)
      void saveRef.current()
      window.removeEventListener('online', online); window.removeEventListener('beforeunload', leave)
      window.document.removeEventListener('visibilitychange', flush)
    }
    // The wizard keys this editor by inspection and kind; initialize exactly once per instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  async function upload(file: File) {
    setUploading(true)
    try {
      const form = new FormData(); form.set('file', file)
      const response = await fetch(`${endpoint}/files`, { method: 'POST', body: form, signal: AbortSignal.timeout(30000) }), result = await response.json()
      if (!response.ok) throw Error(result.error || 'Uppladdningen misslyckades.')
      setFiles(previous => [...previous, result.file])
      if (current.current) update({ ...current.current, attachments: [...current.current.attachments, result.file.id] })
    } catch (error) { toast.error(error) }
    finally { setUploading(false); if (uploadInput.current) uploadInput.current.value = '' }
  }
  if (!document) return <section className="ob-form-root ob-env"><h2>{protocolTitles[kind]}</h2><p role="status">{error || status}</p>{error && <button type="button" onClick={() => window.location.reload()}><RotateCw size={18} />Försök igen</button>}</section>
  const issues = document.include ? protocolPublicationErrors(document, kind) : []
  const setField = (key: string, value: string) => update({ ...document, fields: { ...document.fields, [key]: value } })
  return <div className="ob-form-root ob-form-compact ob-env">
    <header className="ob-env-header"><div><h2>{protocolTitles[kind]}</h2><p className="ob-form-muted">{[property.address, property.city].filter(Boolean).join(', ')}</p></div>
      <div className="ob-env-save"><span role="status" title={error || undefined}>{status}</span>{error && <button type="button" title="Försök spara igen" aria-label="Försök spara igen" onClick={() => void save()}><RotateCw size={18} /></button>}</div>
    </header>
    {conflict && <Sheet title="Välj protokollversion" onClose={() => setConflict(null)}>
      <p>Serverversionen och ditt lokala utkast skiljer sig. Ingen version har skrivits över.</p>
      <details><summary>Lokalt utkast</summary><pre className="ob-env-compare">{JSON.stringify(current.current, null, 2)}</pre></details>
      <details><summary>Serverns version</summary><pre className="ob-env-compare">{JSON.stringify(conflict.document, null, 2)}</pre></details>
      <div className="ob-env-actions"><button onClick={() => { localStorage.removeItem(storageKey); acceptServer(conflict) }}>Använd serverns version</button>
        {!locked && <button onClick={() => { revision.current = conflict.revision; blocked.current = false; setConflict(null); if (current.current) persist(current.current); void save() }}>Spara mitt utkast</button>}</div>
    </Sheet>}
    {blocked.current && !conflict && <button onClick={() => void read().then(setConflict).catch(error => toast.error(error))}>Jämför versioner</button>}
    <fieldset disabled={locked || blocked.current} className="ob-env-fields">
      <section className="ob-form-section"><div className="ob-env-grid">{protocolFields[kind].map(field => <Field key={field.key} field={field} value={document.fields[field.key] || ''} onChange={value => setField(field.key, value)} />)}</div></section>
      <section className="ob-form-section"><div className="ob-env-header"><h3>{kind === 'radon' ? 'Mätplatser' : 'Provplatser'}</h3>
        <button onClick={() => update({ ...document, rows: [...document.rows, { id: crypto.randomUUID(), fields: kind === 'mould' ? { status: 'Ej inskickat' } : {} }] })} disabled={document.rows.length >= 100}><Plus size={18} />Lägg till plats</button></div>
        {document.rows.map((row, index) => <section key={row.id} className="ob-env-row" aria-label={`Plats ${index + 1}`}><div className="ob-env-header"><h3>Plats {index + 1}</h3><button title={`Ta bort plats ${index + 1}`} aria-label={`Ta bort plats ${index + 1}`} className="ob-form-danger" onClick={() => setRemoveId(row.id)}><Trash2 size={18} /></button></div>
          <div className="ob-env-grid">{resultFields[kind].map(field => <Field key={field.key} field={field} value={row.fields[field.key] || ''} onChange={value => update({ ...document, rows: document.rows.map(item => item.id === row.id ? { ...item, fields: { ...item.fields, [field.key]: value } } : item) })} />)}</div>
        </section>)}
      </section>
      <section className="ob-form-section"><h3>{kind === 'mould' ? 'Laboratoriesvar' : 'Mätrapporter'}</h3>
        <input ref={uploadInput} type="file" accept="application/pdf" hidden aria-label="Ladda upp PDF" onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
        <button disabled={uploading || document.attachments.length >= 20} onClick={() => uploadInput.current?.click()}><Upload size={18} />{uploading ? 'Laddar upp…' : 'Bifoga PDF'}</button>
        <ul className="ob-env-files">{document.attachments.map(id => { const file = files.find(file => file.id === id); return file ? <li key={id}><a href={`${endpoint}/files?file=${encodeURIComponent(id)}`}><Download size={18} />{file.name}</a><button aria-label={`Koppla bort ${file.name}`} title="Koppla bort bilaga" onClick={() => update({ ...document, attachments: document.attachments.filter(item => item !== id) })}><Trash2 size={18} /></button></li> : null })}</ul>
        {files.some(file => !document.attachments.includes(file.id)) && <details><summary>Tidigare uppladdade bilagor</summary><ul className="ob-env-files">{files.filter(file => !document.attachments.includes(file.id)).map(file => <li key={file.id}><a href={`${endpoint}/files?file=${encodeURIComponent(file.id)}`}><Download size={18} />{file.name}</a><button disabled={document.attachments.length >= 20} title={`Bifoga ${file.name}`} aria-label={`Bifoga ${file.name}`} onClick={() => update({ ...document, attachments: [...document.attachments, file.id] })}><Plus size={18} /></button></li>)}</ul></details>}
      </section>
      <section className="ob-form-section"><h3>Bedömning</h3><div className="ob-env-grid">{conclusionFields.map(field => <Field key={field.key} field={field} value={document.fields[field.key] || ''} onChange={value => setField(field.key, value)} />)}</div></section>
      <section className="ob-form-section"><label className="ob-form-choice"><input type="checkbox" checked={document.include} onChange={event => update({ ...document, include: event.target.checked })} />Ta med i utlåtandet</label>
        {issues.length > 0 && <ul className="ob-form-muted">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
      </section>
    </fieldset>
    {removeId && <Sheet title="Ta bort plats" onClose={() => setRemoveId(null)} footer={<><button onClick={() => setRemoveId(null)}>Avbryt</button><button className="ob-form-danger" onClick={() => { update({ ...document, rows: document.rows.filter(row => row.id !== removeId) }); setRemoveId(null) }}>Ta bort plats</button></>}><p>Platsen och dess resultat tas bort från detta utkast. Publicerade utlåtanden ändras inte.</p></Sheet>}
  </div>
}
function documentHidden() { return window.document.visibilityState === 'hidden' }
