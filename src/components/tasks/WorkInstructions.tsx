'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { History, Loader2, RefreshCw, X } from 'lucide-react'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import { INSTRUCTION_MAX_FILES, INSTRUCTION_MAX_TEXT, instructionFileKey, normalizeInstructionBody, type InstructionBody, type InstructionFile, type InstructionFileRef, type InstructionVersion, type InstructionWorkspace } from '@/lib/action-cases/workInstructions'
import WorkInstructionFiles, { WorkInstructionFileList } from './WorkInstructionFiles'
import { useQuestionAutosave } from './useQuestionAutosave'
import './work-instructions.css'
import { useProjectSaveProtection } from './ProjectSaveProtection'

export type WorkInstructionsHandle = { flush: () => Promise<boolean>; isBusy: () => boolean; canRecover?: () => boolean }
type Props = { caseId: string; itemId: string; projectFiles: ActionCaseAttachmentView[]; onDirty: (dirty: boolean) => void; onWorking: (working: boolean) => void }
type Upload = { id: string; file: File; status: 'queued' | 'uploading' | 'error'; error?: string; signed?: { bucket: string; filePath: string; token: string; contentType: string }; uploaded?: boolean }
const empty = (): InstructionBody => ({ text: '', files: [] })
const stamp = (value: string) => new Intl.DateTimeFormat('sv-SE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(value))
async function request(endpoint: string, data?: unknown) {
  const response = await fetch(endpoint, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Instruktionerna kunde inte hämtas eller sparas.')
  return result
}

function InstructionHistory({ caseId, endpoint, revision }: { caseId: string; endpoint: string; revision: number }) {
  const [versions, setVersions] = useState<InstructionVersion[]>([]), [before, setBefore] = useState<number | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const running = useRef(false)
  async function load(cursor?: number) {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      const result = await request(`${endpoint}?history=1${cursor ? `&before=${cursor}` : ''}`)
      if (!Array.isArray(result.versions)) throw new Error('Historiken kunde inte hämtas.')
      setVersions(old => cursor ? [...old, ...result.versions.filter((version: InstructionVersion) => !old.some(previous => previous.revision === version.revision))] : result.versions)
      setBefore(result.nextBeforeRevision)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Historiken kunde inte hämtas.') }
    finally { running.current = false; setBusy(false) }
  }
  return <details className="work-instruction-history" onToggle={event => { if (event.currentTarget.open && !versions.length && !error) void load() }}>
    <summary><History size={16} />Historik ({revision})</summary>
    {versions.map(version => <details key={version.revision} className="work-instruction-version"><summary>Version {version.revision} · {stamp(version.createdAt)} · {version.actorName}</summary><p className="work-instruction-text">{version.body.text}</p><WorkInstructionFileList caseId={caseId} refs={version.body.files} files={version.files} /></details>)}
    {busy && <p role="status"><Loader2 size={16} className="inline animate-spin" />Hämtar historik…</p>}
    {error && <div role="alert"><p>{error}</p><button type="button" className="gizmo-button" disabled={busy} onClick={() => void load(versions.length && before ? before : undefined)}><RefreshCw size={16} />Försök igen</button></div>}
    {before && !error && <button type="button" className="gizmo-button" disabled={busy} onClick={() => void load(before)}><History size={16} />Visa äldre versioner</button>}
  </details>
}

const WorkInstructions = forwardRef<WorkInstructionsHandle, Props>(function WorkInstructions({ caseId, itemId, projectFiles, onDirty, onWorking }, ref) {
  const endpoint = `/api/action-cases/${caseId}/items/${itemId}/instructions`
  const [workspace, setWorkspace] = useState<InstructionWorkspace | null>(null), [body, setBody] = useState<InstructionBody>(empty), [knownFiles, setKnownFiles] = useState<InstructionFile[]>([])
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [uploads, setUploads] = useState<Upload[]>([]), [uploadBusy, setUploadBusy] = useState(false)
  const currentBody = useRef(body), fileInput = useRef<HTMLInputElement>(null), uploadQueue = useRef<Upload[]>([]), transferring = useRef(false), mounted = useRef(true)
  currentBody.current = body
  const callbacks = useRef({ onDirty, onWorking }); callbacks.current = { onDirty, onWorking }
  const rememberFiles = (files: InstructionFile[]) => setKnownFiles(old => [...new Map([...old, ...files].map(file => [file.id, file])).values()])
  const autosave = useQuestionAutosave<InstructionBody>({
    valid: value => { try { normalizeInstructionBody(value); return workspace?.readOnly === false } catch { return false } },
    staleMessage: 'Det lokala utkastet gäller en äldre version av instruktionerna. Din text finns kvar. Hämta den sparade versionen innan du fortsätter.',
    save: async attempt => {
      const result = await request(endpoint, { requestId: attempt.requestId, revision: attempt.revision, body: normalizeInstructionBody(attempt.value) })
      if (result.requestId !== attempt.requestId || result.revision !== attempt.revision + 1 || !Number.isFinite(Date.parse(result.createdAt)) || !Array.isArray(result.files) || JSON.stringify(result.files.map((file: InstructionFile) => ({ source: file.source, id: file.sourceId }))) !== JSON.stringify(attempt.value.files)) throw new Error('Sparningen kunde inte bekräftas. Försök igen med samma uppgifter.')
      rememberFiles(result.files)
      setWorkspace(old => old ? { ...old, revision: result.revision, updatedAt: result.createdAt, updatedBy: result.actorName } : old)
    },
    onSaved: () => undefined,
  })
  const auto = useRef(autosave); auto.current = autosave
  const load = useCallback(async (discard = false) => {
    setLoading(true); setError('')
    try {
      const data = await request(endpoint) as InstructionWorkspace
      normalizeInstructionBody(data.body)
      if (!mounted.current) return
      const restored = auto.current.seed(`gizmo:work-instructions:${data.cacheScope}:${caseId}:${itemId}`, data.body, data.revision, discard)
      const next = normalizeInstructionBody(restored || data.body)
      setWorkspace(data); setBody(next); setKnownFiles(data.files)
    } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'Instruktionerna kunde inte hämtas.') }
    finally { if (mounted.current) setLoading(false) }
  }, [caseId, itemId, endpoint])
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false } }, [load])
  const dirty = autosave.dirty || uploads.length > 0
  useEffect(() => { callbacks.current.onDirty(dirty); return () => callbacks.current.onDirty(false) }, [dirty])
  useEffect(() => { callbacks.current.onWorking(uploadBusy || loading); return () => callbacks.current.onWorking(false) }, [uploadBusy, loading])
  useProjectSaveProtection({ label: 'Projektarbete · Instruktioner', pending: dirty, lossRisk: uploads.length > 0 || !autosave.local,
    detail: uploads.length ? `${uploads.length} filer är inte färdiguppladdade.` : autosave.error || (autosave.local ? 'Textutkastet finns på den här enheten.' : 'Texten kunde inte sparas på den här enheten.'), view: 'work',
    flush: async () => !transferring.current && !uploadQueue.current.length && await auto.current.flush() })
  useImperativeHandle(ref, () => ({ flush: async () => !transferring.current && !uploadQueue.current.length && await auto.current.flush(), isBusy: () => transferring.current || auto.current.isBusy(), canRecover: () => !uploadQueue.current.length && auto.current.isLocal() }), [])
  function change(next: InstructionBody) {
    if (!workspace || workspace.readOnly) return
    currentBody.current = next; setBody(next); auto.current.change(next)
  }
  function attach(file: InstructionFile) {
    rememberFiles([file])
    const next = currentBody.current
    if (next.files.some(existing => instructionFileKey(existing) === file.id)) return
    if (next.files.length >= INSTRUCTION_MAX_FILES) { setError('Högst 50 filer kan bifogas. Filen finns kvar i projektet.'); return }
    change({ ...next, files: [...next.files, { source: file.source, id: file.sourceId }] })
  }
  const publishUploads = () => { if (mounted.current) setUploads([...uploadQueue.current]) }
  async function processUploads() {
    if (transferring.current) return
    transferring.current = true; setUploadBusy(true)
    try {
      for (const upload of uploadQueue.current.filter(file => file.status === 'queued')) {
        upload.status = 'uploading'; upload.error = ''; publishUploads()
        try {
          const metadata = { fileName: upload.file.name, fileSize: upload.file.size, contentType: upload.file.type }
          upload.signed ??= (await request(endpoint, { operation: 'prepare', ...metadata })).upload
          if (!upload.signed) throw new Error('Uppladdningen kunde inte förberedas.')
          if (!upload.uploaded) {
            const { supabase } = await import('@/lib/supabaseClient')
            const result = await supabase.storage.from(upload.signed.bucket).uploadToSignedUrl(upload.signed.filePath, upload.signed.token, upload.file, { contentType: upload.signed.contentType })
            if (result.error) {
              // The object may have arrived even when the upload acknowledgement was lost.
              const completed = await request(endpoint, { operation: 'complete', ...metadata, filePath: upload.signed.filePath }).catch(() => null)
              if (!completed?.file?.id) throw new Error('Filen kunde inte laddas upp. Försök igen.')
              attach(completed.file); uploadQueue.current = uploadQueue.current.filter(file => file.id !== upload.id); publishUploads(); continue
            }
            upload.uploaded = true
          }
          const result = await request(endpoint, { operation: 'complete', ...metadata, filePath: upload.signed.filePath })
          if (!result.file?.id) throw new Error('Filen kunde inte registreras. Försök igen.')
          attach(result.file); uploadQueue.current = uploadQueue.current.filter(file => file.id !== upload.id)
        } catch (failure) { upload.status = 'error'; upload.error = failure instanceof Error ? failure.message : 'Filen kunde inte laddas upp.' }
        publishUploads()
      }
    } finally { transferring.current = false; if (mounted.current) setUploadBusy(false) }
  }
  function addFiles(selected: File[]) {
    if (!workspace || workspace.readOnly || transferring.current || !selected.length) return
    if (body.files.length + uploads.length + selected.length > INSTRUCTION_MAX_FILES) { setError('Högst 50 filer kan bifogas.'); return }
    if (selected.some(file => file.size <= 0 || file.size > 25 * 1024 * 1024)) { setError('Välj filer som är högst 25 MB styck.'); return }
    setError(''); uploadQueue.current.push(...selected.map(file => ({ id: crypto.randomUUID(), file, status: 'queued' as const }))); publishUploads(); void processUploads()
  }
  const projectLibrary = [...new Map([...projectFiles, ...(workspace?.projectFiles || [])].map(file => [file.id, file])).values()]
  const availableFiles = [...new Map([...projectLibrary.map(file => ({ ...file, source: 'project' as const, sourceId: file.id, url: `/api/action-cases/${caseId}/attachments/${file.id}` })), ...knownFiles].map(file => [file.id, file])).values()]
  if (loading && !workspace) return <p className="work-instruction-muted" role="status"><Loader2 size={17} className="inline animate-spin" />Hämtar instruktioner…</p>
  return <section className="work-instructions" aria-label="Momentets instruktioner">
    <header className="work-instruction-heading"><h3>Instruktioner</h3><span className="work-instruction-muted">Internt</span><span className="work-instruction-save" role="status">{autosave.busy ? 'Sparar…' : autosave.error ? 'Inte sparat' : autosave.dirty ? 'Ändringar väntar' : workspace ? 'Sparat' : ''}</span></header>
    {(error || autosave.error) && <div className="work-instruction-error" role="alert"><p>{error || autosave.error}</p><div className="work-instruction-tools">
      <button type="button" className="gizmo-button" disabled={autosave.busy || loading || uploadBusy} onClick={() => { if (workspace) void autosave.retry(); else void load() }}><RefreshCw size={16} />Försök igen</button>
      {workspace && <button type="button" className="gizmo-button" disabled={autosave.busy || loading || uploadBusy} onClick={() => { if (!dirty || window.confirm('Hämta de sparade instruktionerna? Lokala osparade ändringar ersätts.')) void load(true) }}>Hämta sparat</button>}
    </div></div>}
    {workspace && <>
      {workspace.readOnly && <p className="work-instruction-muted">Projektet är avslutat · Skrivskyddat</p>}
      <label className="work-instruction-label">Instruktion för utförandet<textarea rows={5} maxLength={INSTRUCTION_MAX_TEXT} value={body.text} readOnly={workspace.readOnly} onChange={event => change({ ...currentBody.current, text: event.target.value })} /></label>
      <WorkInstructionFiles caseId={caseId} refs={body.files} files={availableFiles} projectFiles={projectLibrary} disabled={uploadBusy || loading} readOnly={workspace.readOnly} onAdd={attach} onRemove={(file: InstructionFileRef) => change({ ...currentBody.current, files: currentBody.current.files.filter(ref => instructionFileKey(ref) !== instructionFileKey(file)) })} onUpload={() => fileInput.current?.click()} />
      <input ref={fileInput} type="file" multiple hidden accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={event => { addFiles(Array.from(event.target.files || [])); event.target.value = '' }} />
      {uploads.length > 0 && <ul className="work-instruction-uploads">{uploads.map(upload => <li key={upload.id}><div><strong>{upload.file.name}</strong><span>{upload.status === 'error' ? upload.error : upload.status === 'uploading' ? 'Laddar upp…' : 'Väntar…'}</span></div>{upload.status === 'error' && <><button type="button" className="gizmo-button" disabled={uploadBusy} onClick={() => { upload.status = 'queued'; publishUploads(); void processUploads() }}><RefreshCw size={16} />Försök igen</button><button type="button" className="work-instruction-icon" title={`Ta bort uppladdningen av ${upload.file.name}`} aria-label={`Ta bort uppladdningen av ${upload.file.name}`} disabled={uploadBusy} onClick={() => { uploadQueue.current = uploadQueue.current.filter(file => file.id !== upload.id); publishUploads() }}><X size={17} /></button></>}</li>)}</ul>}
      {workspace.updatedAt && <p className="work-instruction-muted">Senast ändrad {stamp(workspace.updatedAt)} · {workspace.updatedBy}</p>}
      {workspace.revision > 0 && <InstructionHistory key={workspace.revision} caseId={caseId} endpoint={endpoint} revision={workspace.revision} />}
    </>}
  </section>
})
export default WorkInstructions
