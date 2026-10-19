'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, MessageSquare, Plus, RefreshCw, Save, Search, Send, Upload, X } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { taskDateTimeInputToIso, formatTaskDateTime } from '@/lib/tasks/dateTime'
import { emptyQuestion, questionStatuses, type ProjectQuestion, type QuestionBody, type QuestionWorkspace } from '@/lib/action-cases/projectQuestions'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import './project-questions.css'

const labels: Record<string, string> = { create: 'Fråga registrerad', update: 'Fråga / tilldelning ändrad', answer: 'Svar registrerat', note: 'Intern anteckning', conclusion: 'Intern slutsats', close: 'Fråga avslutad', reopen: 'Fråga återöppnad', send: 'Skickad som uppgift' }
const taskLabels: Record<string, string> = { draft: 'Utkast', assigned: 'Tilldelad', in_progress: 'Pågår', waiting: 'Väntar', ready_for_review: 'Svar inväntar granskning', returned: 'Återlämnad', approved: 'Hantering klar', cancelled: 'Avbruten' }
const button = 'gizmo-button', field = 'gizmo-question-field'
const stamp = (value: string) => formatTaskDateTime(value, 'Europe/Stockholm', 'compact')

export default function ProjectQuestions({ caseId, active, files, onFiles, onDirty }: {
  caseId: string; active: boolean; files: ActionCaseAttachmentView[]; onFiles: (files: ActionCaseAttachmentView[]) => void; onDirty: (dirty: boolean) => void
}) {
  const [data, setData] = useState<QuestionWorkspace | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<string | null>(null), [search, setSearch] = useState(''), [filter, setFilter] = useState('active')
  const [draft, setDraft] = useState<QuestionBody>(emptyQuestion), [fileIds, setFileIds] = useState<string[]>([])
  const [mode, setMode] = useState('details'), [message, setMessage] = useState(''), [reportedBy, setReportedBy] = useState('')
  const [due, setDue] = useState(''), [followup, setFollowup] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [dueTime, setDueTime] = useState('16:00'), [followupTime, setFollowupTime] = useState('09:00')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [baseline, setBaseline] = useState('')
  const running = useRef(false), dialog = useRef<HTMLDivElement>(null), uploadInput = useRef<HTMLInputElement>(null), pending = useRef<{ key: string; id: string } | null>(null)
  const backdrop = useRef(false)
  const headingId = useId(), focusBefore = useRef<HTMLElement | null>(null), initialized = useRef(false)
  const question = data?.questions.find(q => q.id === selected)
  const dirty = Boolean(selected && (JSON.stringify(draft) !== baseline || fileIds.length || message || reportedBy || due || followup || (mode === 'send' && (dueTime !== '16:00' || followupTime !== '09:00'))))
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    try {
      const r = await fetch(`/api/action-cases/${caseId}/questions`, { signal, cache: 'no-store' }), next = await r.json()
      if (!r.ok) throw new Error(next.error || 'Frågorna kunde inte hämtas.')
      setData(next); setError(''); initialized.current = true
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : 'Frågorna kunde inte hämtas.') }
    finally { if (!signal?.aborted) setLoading(false) }
  }, [caseId])
  useEffect(() => { if (!active || initialized.current) return; const c = new AbortController(); void refresh(c.signal); return () => c.abort() }, [active, refresh])
  useEffect(() => { onDirty(dirty || busy) }, [dirty, busy, onDirty])
  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  useEffect(() => {
    if (!selected || !active) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; focusBefore.current?.focus() }
  }, [selected, active])
  useEffect(() => {
    if (selected && active && !dialog.current?.contains(document.activeElement)) dialog.current?.focus()
  }, [busy, selected, active])
  function reset(next: QuestionBody) { setDraft(next); setBaseline(JSON.stringify(next)); setFileIds([]); setMessage(''); setReportedBy(''); setDue(''); setFollowup(''); setDueTime('16:00'); setFollowupTime('09:00'); setConfirmed(false); setMode('details'); pending.current = null }
  function open(q?: ProjectQuestion) { focusBefore.current = document.activeElement as HTMLElement; reset(q ? structuredClone(q.body) : emptyQuestion()); setSelected(q?.id || crypto.randomUUID()); setNotice(''); setError('') }
  function close() { if (running.current || (dirty && !window.confirm('Stäng frågan med osparade ändringar?'))) return; setSelected(null); setError('') }
  function patch(value: Partial<QuestionBody>) { setDraft(d => ({ ...d, ...value })) }
  function switchMode(next: string) {
    if (running.current) return
    if (dirty && !window.confirm('Byt vy och kasta osparade ändringar?')) return
    reset(question ? structuredClone(question.body) : emptyQuestion()); setMode(next); setError(''); setNotice('')
  }
  async function write(operation: string) {
    if (running.current || !selected) return
    const dueAt = mode === 'send' ? taskDateTimeInputToIso(due, dueTime, 'Europe/Stockholm') : null
    const followupAt = mode === 'send' ? taskDateTimeInputToIso(followup, followupTime, 'Europe/Stockholm') : null
    if (operation === 'send' && (!confirmed || !dueAt || !followupAt || followupAt > dueAt)) { setError('Ange svarsdatum och uppföljning, och bekräfta utskicket.'); return }
    const body = { questionId: selected, revision: question?.revision || 0, operation, body: draft, text: message, reportedBy: mode === 'answer' ? reportedBy : '', fileIds, dueAt, followupAt, confirmed }
    const key = JSON.stringify(body)
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() }
    running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/action-cases/${caseId}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestId: pending.current.id }) }), result = await r.json()
      if (!r.ok) throw new Error(result.error || 'Åtgärden kunde inte bekräftas.')
      // The mutation result is authoritative even if the following refresh fails.
      setNotice(operation === 'send' ? 'Uppgiften är sparad i utskickskön. Leveransstatus finns i Uppdrag.' : 'Sparat i historiken.')
      reset({ ...draft, status: operation === 'close' ? 'closed' : operation === 'reopen' ? 'open' : draft.status }); setSelected(null)
      await refresh()
      requestAnimationFrame(() => focusBefore.current?.focus())
    } catch (e) { setError(e instanceof Error ? e.message : 'Åtgärden kunde inte bekräftas. Din text är kvar.') }
    finally { running.current = false; setBusy(false) }
  }
  async function upload(file?: File) {
    if (!file || running.current) return
    if (!file.size || file.size > 25 * 1024 * 1024) { setError('Välj en fil, högst 25 MB.'); return }
    running.current = true; setBusy(true); setError('')
    try {
      const post = async (action: string, payload: Record<string, unknown>) => {
        const r = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload: { ...payload, caseId } }) }), v = await r.json()
        if (!r.ok) throw new Error(v.error || 'Uppladdningen kunde inte bekräftas.'); return v
      }
      const signed = await post('create_signed_upload', { fileName: file.name, contentType: file.type, fileSize: file.size })
      const r = await supabase.storage.from(signed.upload.bucket).uploadToSignedUrl(signed.upload.filePath, signed.upload.token, file, { contentType: signed.upload.contentType })
      if (r.error) { await post('abort_upload', { filePath: signed.upload.filePath }).catch(() => undefined); throw new Error('Uppladdningen misslyckades.') }
      const completed = await post('complete_upload', { filePath: signed.upload.filePath, fileName: file.name, contentType: file.type, fileSize: file.size, participantIds: [] })
      const next: ActionCaseAttachmentView[] = completed.workspace.cases.find((c: { id: string }) => c.id === caseId)?.attachments || []
      const name = file.name.replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim().slice(0, 180) || 'bilaga'
      const added = next.filter(f => !files.some(old => old.id === f.id) && f.fileName === name && f.fileSizeBytes === file.size)
      onFiles(next)
      if (added.length !== 1) throw new Error('Filen finns i projektet men kunde inte kopplas automatiskt. Välj filen i listan.')
      setFileIds(ids => [...ids, added[0].id])
    } catch (e) { setError(e instanceof Error ? e.message : 'Filen kunde inte laddas upp.') }
    finally { running.current = false; setBusy(false); if (uploadInput.current) uploadInput.current.value = '' }
  }
  const rows = (data?.questions || []).filter(q => (filter === 'all' || (filter === 'closed' ? q.body.status === 'closed' : q.body.status !== 'closed')) && `${q.number} ${q.body.title} ${q.body.description} ${q.body.assignee?.name || ''}`.toLocaleLowerCase('sv').includes(search.toLocaleLowerCase('sv')))
  const historicalFiles = [...new Map((question?.events.flatMap(e => e.files) || []).map(f => [f.id, f])).values()]
  const availableFiles = mode === 'send' ? files.filter(f => !f.isQuoteDocument) : files
  const sendFiles = mode === 'send' ? historicalFiles.filter(f => availableFiles.some(a => a.id === f.id)) : []
  const choices = [...new Map([...sendFiles.map(f => ({ id: f.id, fileName: f.name })), ...availableFiles].map(f => [f.id, f])).values()]
  const closed = question?.body.status === 'closed'
  const taskOpen = Boolean(question?.tasks.some(t => t.active ?? !['approved', 'cancelled'].includes(t.status)))
  const panel = selected && active && typeof document !== 'undefined' ? createPortal(<div className="uppdrag-scope gizmo-dialog-scope gizmo-questions-overlay" onPointerDown={e => { backdrop.current = e.target === e.currentTarget }} onClick={e => { if (e.target === e.currentTarget && backdrop.current) close(); backdrop.current = false }}>
    <div ref={dialog} className="gizmo-question-panel" role="dialog" aria-modal="true" aria-labelledby={headingId} aria-busy={busy} tabIndex={-1} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); close() }
      if (e.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary') || []).filter(n => n.tabIndex >= 0 && n.getClientRects().length)
      if (!controls.length) { e.preventDefault(); return }
      if (e.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) { e.preventDefault(); controls.at(-1)?.focus() }
      else if (!e.shiftKey && document.activeElement === controls.at(-1)) { e.preventDefault(); controls[0]?.focus() }
    }}>
      <header><div className="min-w-0"><p className="gizmo-secondary">{question ? `F-${String(question.number).padStart(3, '0')} · ${questionStatuses[question.body.status]}` : 'Ny fråga · Intern'}</p><h2 id={headingId}>{question?.body.title || 'Ny fråga'}</h2></div><button className={`${button} gizmo-icon-button`} title="Stäng" aria-label="Stäng fråga" disabled={busy} onClick={close}><X size={18} /></button></header>
      <div className="gizmo-question-panel-body">
        {error && <p role="alert" className="gizmo-question-error">{error}</p>}
        {question && <div className="gizmo-question-modes">{[['details', 'Fråga'], ['answer', 'Registrera svar'], ['note', 'Anteckning'], ['conclusion', 'Slutsats'], ['send', 'Skicka till ansvarig'], ['history', 'Historik']].filter(([key]) => !closed || ['details', 'history'].includes(key)).map(([key, label]) => <button type="button" className={button} key={key} aria-pressed={mode === key} disabled={busy || (key === 'send' && taskOpen)} title={key === 'send' && taskOpen ? 'Frågan har redan en aktiv uppgift i Uppdrag' : undefined} onClick={() => switchMode(key)}>{label}</button>)}</div>}
        <fieldset className="gizmo-question-form" disabled={busy}>
          {mode === 'details' && <>
            <label>Rubrik<input className={field} value={draft.title} maxLength={250} readOnly={closed} onChange={e => patch({ title: e.target.value })} /></label>
            <label>Fråga<textarea className={field} rows={5} value={draft.description} maxLength={12000} readOnly={closed} onChange={e => patch({ description: e.target.value })} /></label>
            <div className="gizmo-question-pair"><label>Sammanhang / möte<input className={field} value={draft.source} maxLength={500} readOnly={closed} onChange={e => patch({ source: e.target.value })} /></label><label>Mötesdatum (valfritt)<input className={field} type="date" min="0001-01-01" max="9999-12-31" value={draft.meetingDate} readOnly={closed} onChange={e => patch({ meetingDate: e.target.value })} /></label></div>
            <label>Ansvarig<select className={field} disabled={closed || taskOpen} title={taskOpen ? 'Hantera den aktiva uppgiften i Uppdrag innan ansvarig byts' : undefined} value={draft.assignee ? `${draft.assignee.kind}:${draft.assignee.id}` : ''} onChange={e => patch({ assignee: data?.assignees.find(a => `${a.kind}:${a.id}` === e.target.value) || null })}><option value="">Ej tilldelad</option>{draft.assignee && !data?.assignees.some(a => a.id === draft.assignee?.id && a.kind === draft.assignee.kind) && <option value={`${draft.assignee.kind}:${draft.assignee.id}`}>{draft.assignee.name} (inte tillgänglig)</option>}{data?.assignees.map(a => <option value={`${a.kind}:${a.id}`} key={`${a.kind}:${a.id}`}>{a.name}{a.email ? ` (${a.email})` : ''}{a.kind === 'profile' ? ' · Intern' : ' · Kontakt'}</option>)}</select></label>
            {!closed && <label>Status<select className={field} value={draft.status} onChange={e => patch({ status: e.target.value as QuestionBody['status'] })}>{Object.entries(questionStatuses).filter(([key]) => key !== 'closed').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
            {draft.conclusion && <section className="gizmo-question-conclusion"><h3>Intern slutsats</h3><p>{draft.conclusion}</p></section>}
          </>}
          {['answer', 'note', 'conclusion', 'close', 'reopen'].includes(mode) && <>
            {mode === 'answer' && <label>Återgivet svar från (lämnas tomt för eget svar)<input className={field} maxLength={250} value={reportedBy} onChange={e => setReportedBy(e.target.value)} /></label>}
            <label>{mode === 'answer' ? 'Svar' : mode === 'note' ? 'Intern anteckning' : mode === 'conclusion' ? 'Intern slutsats' : mode === 'close' ? 'Avslutningsanteckning' : 'Skäl till återöppning'}<textarea className={field} rows={6} maxLength={12000} value={message} onChange={e => setMessage(e.target.value)} /></label>
          </>}
          {mode === 'send' && <>
            <section className="gizmo-question-conclusion"><h3>Skickas till {question?.body.assignee?.name || 'Ingen ansvarig vald'}</h3>{question?.body.assignee?.email && <p>{question.body.assignee.email}</p>}<p>{question?.body.description}</p>{question?.body.source && <p>{question.body.source}</p>}{question?.body.meetingDate && <p>Mötesdatum: {question.body.meetingDate}</p>}</section>
            <div className="gizmo-question-pair"><label>Svar senast<input className={field} type="date" min="0001-01-01" max="9999-12-31" value={due} onChange={e => setDue(e.target.value)} required /></label><label>Klockslag för svar (Stockholm)<input className={field} type="time" value={dueTime} onChange={e => setDueTime(e.target.value)} required /></label><label>Första uppföljning<input className={field} type="date" min="0001-01-01" max={due || '9999-12-31'} value={followup} onChange={e => setFollowup(e.target.value)} required /></label><label>Klockslag för uppföljning (Stockholm)<input className={field} type="time" value={followupTime} onChange={e => setFollowupTime(e.target.value)} required /></label></div>
          </>}
          {mode !== 'history' && !closed && <section className="gizmo-question-files"><h3>{mode === 'send' ? 'Bilagor till mottagaren' : 'Bilagor till denna historikpost'}</h3><ul>{choices.map(f => <li key={f.id}><label><input type="checkbox" checked={fileIds.includes(f.id)} disabled={!fileIds.includes(f.id) && fileIds.length >= 20} onChange={e => setFileIds(ids => e.target.checked ? [...ids, f.id] : ids.filter(id => id !== f.id))} />{f.fileName}</label><a href={`/api/action-cases/${caseId}/attachments/${f.id}`} target="_blank" rel="noreferrer" aria-label={`Öppna ${f.fileName}`} title="Öppna i ny flik"><ExternalLink size={16} /></a></li>)}</ul>{mode !== 'send' && <><button className={button} type="button" onClick={() => uploadInput.current?.click()} disabled={fileIds.length >= 20}><Upload size={16} /> Ladda upp bilaga</button><input className="hidden" ref={uploadInput} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" aria-label="Ladda upp bilaga till frågan" onChange={e => void upload(e.target.files?.[0])} /></>}</section>}
          {mode === 'send' && <label className="gizmo-question-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Jag har granskat mottagaren, frågetexten och de valda bilagorna inför utskick.</label>}
        </fieldset>
        {mode === 'history' && <ol className="gizmo-question-history">{question?.events.map(e => <li key={e.id}><h3>{labels[e.operation] || e.operation}</h3><p className="gizmo-secondary">{e.actorName} · {stamp(e.createdAt)}</p>{e.reportedBy && <p>Återgivet svar från {e.reportedBy}, registrerat av {e.actorName}</p>}{e.text && <p className="whitespace-pre-wrap">{e.text}</p>}<details><summary>Frågans version {e.revision}</summary><p><strong>{e.body.title}</strong></p><p className="whitespace-pre-wrap">{e.body.description}</p><p>{e.body.source} {e.body.meetingDate}</p><p>Ansvarig: {e.body.assignee?.name || 'Ej tilldelad'} · {questionStatuses[e.body.status]}</p>{e.body.conclusion && <p className="whitespace-pre-wrap">{e.body.conclusion}</p>}</details>{e.files.map(f => <a key={f.id} className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/attachments/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}{e.taskId && <a className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/uppdrag?task=${e.taskId}`}><ExternalLink size={16} />Öppna uppgiften</a>}</li>)}</ol>}
        {question && historicalFiles.length > 0 && mode === 'details' && <section className="gizmo-question-files"><h3>Sparade bilagor</h3>{historicalFiles.map(f => <a className="gizmo-question-file-link" key={f.id} target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/attachments/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}</section>}
        {question?.tasks.map(task => <section className="gizmo-question-task" key={task.id}><div className="flex flex-wrap justify-between gap-2"><h3>Uppgift till {task.assigneeName}</h3><a className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/uppdrag?task=${task.id}`}><ExternalLink size={16} />Öppna Uppdrag</a></div><p>{taskLabels[task.status] || task.status} · Svar senast {stamp(task.dueAt)}</p>{task.events.map(e => <div className="gizmo-question-task-event" key={e.id}><p className="gizmo-secondary">{e.actorName} · {stamp(e.createdAt)}</p><p className="whitespace-pre-wrap">{e.text}</p></div>)}{task.files.map(f => f.text !== null ? <div className="gizmo-question-task-event" key={f.id}><h4>{f.name}</h4><p className="whitespace-pre-wrap">{f.text}</p></div> : <a className="gizmo-question-file-link" key={f.id} target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/questions/tasks/${task.id}/files/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}</section>)}
      </div>
      <footer><span role="status">{busy ? 'Arbetar…' : dirty ? 'Osparade ändringar' : question ? 'Sparat internt' : 'Inte sparad'}</span><div className="flex flex-wrap gap-2">{question && mode === 'details' && <button className={button} disabled={busy || dirty || (!closed && taskOpen)} title={taskOpen ? 'Hantera den aktiva uppgiften i Uppdrag först' : undefined} onClick={() => switchMode(closed ? 'reopen' : 'close')}>{closed ? 'Återöppna' : 'Avsluta fråga'}</button>}<button className={button} onClick={close} disabled={busy}>Stäng</button>{mode !== 'history' && !(mode === 'details' && closed) && <button className={`${button} gizmo-question-primary`} disabled={busy || (mode === 'details' ? !draft.title.trim() || !draft.description.trim() || (Boolean(question) && !dirty) : mode === 'send' ? !question?.body.assignee || !due || !followup || !confirmed : !message.trim())} onClick={() => void write(mode === 'details' ? question ? 'update' : 'create' : mode)}>{busy ? <Loader2 size={16} className="animate-spin" /> : mode === 'send' ? <Send size={16} /> : <Save size={16} />}{mode === 'send' ? 'Skicka uppgift' : 'Spara'}</button>}</div></footer>
    </div>
  </div>, document.body) : null
  return <section className="gizmo-questions" aria-label="Frågor och beslut" hidden={!active}>
    <div className="gizmo-section-heading"><h2>Frågor och beslut</h2><div className="flex gap-2"><button className={`${button} gizmo-icon-button`} disabled={loading || busy} title="Hämta sparade frågor och svar" aria-label="Hämta sparade frågor och svar" onClick={() => void refresh()}><RefreshCw size={17} /></button><button className={button} disabled={!data || loading} onClick={() => open()}><Plus size={17} />Ny fråga</button></div></div>
    {!selected && error && <p role="alert" className="gizmo-question-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="gizmo-question-toolbar"><label className="gizmo-question-search"><Search size={17} /><input className={field} placeholder="Sök frågor" aria-label="Sök frågor" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Visa<select className={field} aria-label="Filtrera frågor" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Aktiva</option><option value="all">Alla</option><option value="closed">Avslutade</option></select></label><span className="gizmo-secondary" role="status">{loading ? 'Hämtar…' : `${rows.length} ${rows.length === 1 ? 'fråga' : 'frågor'}`}</span></div>
    <div className="gizmo-question-table" role="table" aria-label="Projektfrågor"><div role="row" className="gizmo-question-table-head"><span role="columnheader">Nr / Fråga</span><span role="columnheader">Ansvarig</span><span role="columnheader">Status</span><span role="columnheader">Uppdaterad</span></div>{rows.map(q => <div role="row" key={q.id} className="gizmo-question-table-row"><div role="cell"><button className="gizmo-question-open" onClick={() => open(q)}><span className="gizmo-secondary">F-{String(q.number).padStart(3, '0')}</span><strong>{q.body.title}</strong></button></div><span role="cell">{q.body.assignee?.name || 'Ej tilldelad'}</span><span role="cell">{questionStatuses[q.body.status]}</span><span role="cell" className="gizmo-secondary">{stamp(q.updatedAt)}</span></div>)}</div>
    {data && !rows.length && <div className="gizmo-question-empty"><MessageSquare size={22} /><p>{search || filter === 'closed' ? 'Inga frågor matchar urvalet.' : 'Inga öppna projektfrågor.'}</p></div>}{panel}
  </section>
}
