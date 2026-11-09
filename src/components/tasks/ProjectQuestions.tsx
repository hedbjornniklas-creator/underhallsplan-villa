'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, ExternalLink, History, Loader2, MessageSquare, Plus, RefreshCw, Save, Search, Send, Upload, Users, X } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { taskDateTimeInputToIso, formatTaskDateTime } from '@/lib/tasks/dateTime'
import { emptyQuestion, questionAssigneeOptions, questionStatuses, questionSendRequirements, questionTaskEventText, questionDeliveryLabels, type ProjectQuestion, type QuestionBody, type QuestionWorkspace } from '@/lib/action-cases/projectQuestions'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import './project-questions.css'
import QuestionDialogue from './QuestionDialogue'
import { useQuestionAutosave } from './useQuestionAutosave'

const labels: Record<string, string> = { create: 'Fråga registrerad', update: 'Fråga / tilldelning ändrad', answer: 'Svar registrerat', note: 'Intern anteckning', close: 'Fråga avslutad', reopen: 'Fråga återöppnad', send: 'Skickad som uppgift' }
const taskLabels: Record<string, string> = { draft: 'Utkast', assigned: 'Tilldelad', in_progress: 'Pågår', waiting: 'Väntar', ready_for_review: 'Svar inväntar granskning', returned: 'Återlämnad', approved: 'Hantering klar', cancelled: 'Avbruten' }
const button = 'gizmo-button', field = 'gizmo-question-field'
const stamp = (value: string) => formatTaskDateTime(value, 'Europe/Stockholm', 'compact')
export type QuestionOpenRequest = { id: string | null; token: number }

export default function ProjectQuestions({ caseId, active, refreshKey = 0, openRequest, files, onDirty, projectClosed = false }: {
  caseId: string; active: boolean; refreshKey?: number; openRequest?: QuestionOpenRequest | null; files: ActionCaseAttachmentView[]; onFiles: (files: ActionCaseAttachmentView[]) => void; onDirty: (dirty: boolean) => void
  projectClosed?: boolean
}) {
  const [data, setData] = useState<QuestionWorkspace | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const [selected, setSelected] = useState<string | null>(null), [search, setSearch] = useState(''), [filter, setFilter] = useState('active')
  const [draft, setDraft] = useState<QuestionBody>(emptyQuestion), [fileIds, setFileIds] = useState<string[]>([])
  const [mode, setMode] = useState('details'), [message, setMessage] = useState(''), [reportedBy, setReportedBy] = useState('')
  const [due, setDue] = useState(''), [followup, setFollowup] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [dueTime, setDueTime] = useState('16:00'), [followupTime, setFollowupTime] = useState('09:00')
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [dialogueDirty, setDialogueDirty] = useState(false)
  const [dialogueSaveStatus, setDialogueSaveStatus] = useState('')
  const [dialogueFooter, setDialogueFooter] = useState<HTMLDivElement | null>(null)
  const [localError, setLocalError] = useState('')
  const compositionEdited = useRef(false)
  const dialogueFlush = useRef<(() => Promise<boolean>) | null>(null)
  const registerDialogueFlush = useCallback((flush: (() => Promise<boolean>) | null) => { dialogueFlush.current = flush }, [])
  const running = useRef(false), dialog = useRef<HTMLDivElement>(null), uploadInput = useRef<HTMLInputElement>(null), pending = useRef<{ key: string; id: string } | null>(null)
  const backdrop = useRef(false)
  const titleInput = useRef<HTMLInputElement>(null)
  const headingId = useId(), focusBefore = useRef<HTMLElement | null>(null), initialized = useRef(false)
  const loadedKey = useRef<number | null>(null)
  const handledOpen = useRef<number | null>(null)
  const readSequence = useRef(0), canBackgroundRefresh = useRef(false)
  const question = data?.questions.find(q => q.id === selected)
  const openSaved = useRef<string | null>(null)
  openSaved.current = question?.id || null
  const autosave = useQuestionAutosave<{ questionId: string; body: QuestionBody; fileIds: string[] }>({
    valid: value => Boolean(value.body.title.trim() && value.body.description.trim()),
    save: async attempt => {
      const response = await fetch(`/api/action-cases/${caseId}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...attempt.value, requestId: attempt.requestId, revision: attempt.revision, operation: attempt.revision ? 'update' : 'create', text: '', reportedBy: '' }) })
      const result = await response.json()
      if (!response.ok || result.questionId !== attempt.value.questionId) throw new Error(result.error || 'Sparningen kunde inte bekräftas. Utkastet finns kvar.')
    },
    onSaved: (value, revision) => {
      try { if (localStorage.getItem(draftKey('new', 'identity')) === value.questionId) localStorage.removeItem(draftKey('new', 'identity')) } catch { /* Server acknowledgement is authoritative. */ }
      setData(current => {
        if (!current) return current
        const existing = current.questions.find(q => q.id === value.questionId)
        const saved = { ...(existing || { id: value.questionId, number: Math.max(0, ...current.questions.map(q => q.number)) + 1, createdAt: new Date().toISOString(), events: [], tasks: [], participants: [] }), body: value.body, revision, updatedAt: new Date().toISOString() }
        return { ...current, questions: existing ? current.questions.map(q => q.id === saved.id ? saved : q) : [...current.questions, saved] }
      })
      void refresh()
    },
  })
  canBackgroundRefresh.current = active && !busy && !autosave.busy
  const dirty = Boolean(selected && (dialogueDirty || autosave.dirty || localError))
  const refresh = useCallback(async (signal?: AbortSignal, background = false) => {
    const sequence = ++readSequence.current
    if (!background) setLoading(true)
    try {
      const r = await fetch(`/api/action-cases/${caseId}/questions`, { signal, cache: 'no-store' }), next = await r.json()
      if (!r.ok) throw new Error(next.error || 'Frågorna kunde inte hämtas.')
      if (signal?.aborted || sequence !== readSequence.current) return
      if (openSaved.current && !next.questions.some((q: ProjectQuestion) => q.id === openSaved.current)) { setSelected(null); setDraft(emptyQuestion()); setMessage(''); setFileIds([]); setDialogueDirty(false) }
      setData(current => ({ ...next, questions: next.questions.map((q: ProjectQuestion) => { const old = current?.questions.find(p => p.id === q.id); return old && old.revision > q.revision ? old : q }) })); setRefreshError(''); initialized.current = true
      return next as QuestionWorkspace
    } catch (e) { if (!signal?.aborted && sequence === readSequence.current) setRefreshError(e instanceof Error ? e.message : 'Frågorna kunde inte hämtas.') }
    finally { if (sequence === readSequence.current) setLoading(false) }
  }, [caseId])
  const dialogueChanged = useCallback(() => { void refresh() }, [refresh])
  const refreshLinkedTasks = useCallback(async () => { await refresh(undefined, true) }, [refresh])
  useEffect(() => { if (!active || (openRequest && handledOpen.current !== openRequest.token) || (initialized.current && loadedKey.current === refreshKey)) return; loadedKey.current = refreshKey; const c = new AbortController(); void refresh(c.signal); return () => c.abort() }, [active, refresh, refreshKey, openRequest])
  useEffect(() => {
    if (!active || !selected) return
    const controller = new AbortController()
    let reading = false
    const update = async () => {
      if (reading || document.visibilityState !== 'visible' || !canBackgroundRefresh.current) return
      reading = true
      try { await refresh(controller.signal, true) } finally { reading = false }
    }
    const timer = window.setInterval(() => void update(), 20000)
    window.addEventListener('focus', update)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', update) }
  }, [active, selected, refresh])
  useEffect(() => { onDirty(busy || Boolean(localError) || dialogueDirty || (autosave.dirty && !autosave.local)) }, [busy, localError, dialogueDirty, autosave.dirty, autosave.local, onDirty])
  useEffect(() => {
    if ((!dirty || (autosave.local && !localError && !dialogueDirty)) && !busy && !autosave.busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy, autosave.busy, autosave.local, localError, dialogueDirty])
  useEffect(() => {
    if (!selected || !active) return
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'; dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; focusBefore.current?.focus() }
  }, [selected, active])
  useEffect(() => {
    if (selected && active && !dialog.current?.contains(document.activeElement)) dialog.current?.focus()
  }, [busy, selected, active])
  useEffect(() => { if (selected && active && !question && !busy) titleInput.current?.focus() }, [selected, active, question, busy])
  function reset(next: QuestionBody) { compositionEdited.current = false; setDraft(next); setFileIds([]); setMessage(''); setReportedBy(''); setDue(''); setFollowup(''); setDueTime('16:00'); setFollowupTime('09:00'); setConfirmed(false); setMode('details'); setDialogueDirty(false); pending.current = null }
  const draftKey = (id: string, section: string) => `gizmo-question:${data?.userId}:${caseId}:${id}:${section}`
  function rememberMode() {
    if (!selected || ['details', 'history', 'dialogue', 'participants'].includes(mode)) return true
    if (!compositionEdited.current && !pending.current) return true
    try { localStorage.setItem(draftKey(selected, mode), JSON.stringify({ message, reportedBy, due, followup, dueTime, followupTime, fileIds, pending: pending.current })); setLocalError(''); return true }
    catch { setLocalError('Utkastet kan inte sparas på den här enheten. Lämna inte vyn innan texten är omhändertagen.'); return false }
  }
  function restoreMode(id: string, section: string) {
    compositionEdited.current = false
    setFileIds([]); setMessage(''); setReportedBy(''); setDue(''); setFollowup(''); setDueTime('16:00'); setFollowupTime('09:00'); setConfirmed(false); pending.current = null; setLocalError('')
    if (['details', 'history', 'dialogue', 'participants'].includes(section)) return
    try {
      const stored = JSON.parse(localStorage.getItem(draftKey(id, section)) || 'null')
      if (!stored) return
      if (typeof stored.message === 'string') setMessage(stored.message)
      if (typeof stored.reportedBy === 'string') setReportedBy(stored.reportedBy)
      if (typeof stored.due === 'string') setDue(stored.due)
      if (typeof stored.followup === 'string') setFollowup(stored.followup)
      if (typeof stored.dueTime === 'string') setDueTime(stored.dueTime)
      if (typeof stored.followupTime === 'string') setFollowupTime(stored.followupTime)
      if (Array.isArray(stored.fileIds)) setFileIds(stored.fileIds.filter((v: unknown) => typeof v === 'string'))
      if (stored.pending && typeof stored.pending.id === 'string' && typeof stored.pending.key === 'string') pending.current = stored.pending
    } catch { setLocalError('Det lokala utkastet kunde inte läsas.') }
  }
  useEffect(() => { rememberMode() }, [selected, mode, message, reportedBy, due, followup, dueTime, followupTime, fileIds]) // eslint-disable-line react-hooks/exhaustive-deps
  function open(q?: ProjectQuestion) {
    if (!q && projectClosed) { setError('Projektet är avslutat. Återöppna projektet innan du skapar en fråga.'); return }
    if (autosave.busy) return
    focusBefore.current = document.activeElement as HTMLElement
    let id = q?.id || crypto.randomUUID()
    if (!q) try { const previous = localStorage.getItem(draftKey('new', 'identity')); if (previous && /^[0-9a-f-]{36}$/i.test(previous)) id = previous; localStorage.setItem(draftKey('new', 'identity'), id) } catch { /* The autosave hook reports storage failures for the draft. */ }
    const body = q ? structuredClone(q.body) : emptyQuestion()
    reset(body); setSelected(id); setNotice(''); setError('')
    const restored = autosave.seed(draftKey(id, 'details'), { questionId: id, body, fileIds: [] }, q?.revision || 0)
    if (restored) { setDraft(restored.body); setFileIds(restored.fileIds) }
  }
  const openContext = useRef({ open, dirty, busy })
  openContext.current = { open, dirty, busy }
  useEffect(() => {
    if (!active || !openRequest || handledOpen.current === openRequest.token) return
    if (openContext.current.dirty || openContext.current.busy) {
      handledOpen.current = openRequest.token
      setError('Stäng eller spara den öppna frågan innan du öppnar en annan.')
      return
    }
    const controller = new AbortController()
    // Recheck membership before opening a question reached from the overview.
    void refresh(controller.signal).then(next => {
      if (!next || controller.signal.aborted) return
      handledOpen.current = openRequest.token
      if (openContext.current.dirty || openContext.current.busy) return
      const requested = next.questions.find(q => q.id === openRequest.id)
      if (openRequest.id && !requested) { setError('Frågan är inte längre tillgänglig för dig.'); return }
      openContext.current.open(requested)
    })
    return () => controller.abort()
  }, [active, openRequest, refresh])
  async function close() { if (running.current || busy || !rememberMode()) return; if (dialogueFlush.current && !await dialogueFlush.current()) return; await autosave.flush(); if (!autosave.isLocal()) return; setSelected(null); setError(''); void refresh() }
  function patch(value: Partial<QuestionBody>) { const next = { ...draft, ...value }; setDraft(next); if (selected) autosave.change({ questionId: selected, body: next, fileIds: mode === 'details' ? fileIds : autosave.value()?.fileIds || [] }) }
  function changeFiles(next: string[]) { if (mode !== 'details') compositionEdited.current = true; setFileIds(next); if (mode === 'details' && selected) autosave.change({ questionId: selected, body: draft, fileIds: next }) }
  function compose(set: (value: string) => void, value: string) { compositionEdited.current = true; set(value) }
  async function switchMode(next: string) {
    if (running.current || busy) return
    if (!rememberMode()) return
    if (dialogueFlush.current && !await dialogueFlush.current()) return
    if (mode === 'details') { await autosave.flush(); if (!autosave.isLocal()) return }
    if (selected) restoreMode(selected, next)
    if (next === 'details') { const current = autosave.value(); if (current) { setDraft(current.body); setFileIds(current.fileIds) } }
    setMode(next); setError(''); setNotice('')
  }
  async function write(operation: string, createNext = false) {
    if (running.current || autosave.isBusy() || !selected) return
    if (['create', 'update'].includes(operation)) {
      if (!await (autosave.error ? autosave.retry() : autosave.flush())) { setError('Komplettera rubrik och fråga, eller återförsök sparningen.'); return }
      if (createNext) { open(); setNotice('Frågan är sparad. Nästa fråga är tom.'); await refresh() }
      else { setNotice('Frågan är sparad internt. Inget utskick har gjorts.'); await refresh() }
      return
    }
    if (!await autosave.flush()) { setError('Frågans uppgifter behöver sparas innan du fortsätter.'); return }
    const dueAt = mode === 'send' ? taskDateTimeInputToIso(due, dueTime, 'Europe/Stockholm') : null
    const followupAt = mode === 'send' ? taskDateTimeInputToIso(followup, followupTime, 'Europe/Stockholm') : null
    if (operation === 'send' && !pending.current && (!confirmed || !dueAt || !followupAt || followupAt > dueAt)) { setError('Ange svarsdatum och uppföljning, och bekräfta utskicket.'); return }
    const body = pending.current ? JSON.parse(pending.current.key) : { questionId: selected, revision: autosave.revision(), operation, body: draft, text: message, reportedBy: mode === 'answer' ? reportedBy : '', fileIds, dueAt, followupAt, confirmed }
    const key = JSON.stringify(body)
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() }
    if (!rememberMode()) return
    running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const r = await fetch(`/api/action-cases/${caseId}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, requestId: pending.current.id }) }), result = await r.json()
      if (!r.ok) throw new Error(result.error || 'Åtgärden kunde inte bekräftas.')
      if (result.questionId !== selected) throw new Error('Sparningen kunde inte bekräftas. Din text är kvar.')
      try { localStorage.removeItem(draftKey(selected, mode)) } catch { /* The acknowledged action remains authoritative. */ }
      // The mutation result is authoritative even if the following refresh fails.
      setNotice(createNext ? 'Frågan är sparad. Nästa fråga är tom.' : operation === 'send' ? 'Uppgiften är sparad i utskickskön. Leveransstatus finns i Gizmo.' : 'Sparat i historiken.')
      if (createNext) { reset(emptyQuestion()); setSelected(crypto.randomUUID()) }
      else { reset({ ...draft, status: operation === 'close' ? 'closed' : operation === 'reopen' ? 'open' : draft.status }); setSelected(null) }
      await refresh()
      if (!createNext) requestAnimationFrame(() => focusBefore.current?.focus())
    } catch (e) { setError(e instanceof Error ? e.message : 'Åtgärden kunde inte bekräftas. Din text är kvar.') }
    finally { running.current = false; setBusy(false) }
  }
  async function upload(file?: File) {
    if (!file || running.current) return
    if (!file.size || file.size > 25 * 1024 * 1024) { setError('Välj en fil, högst 25 MB.'); return }
    running.current = true; setBusy(true); setError('')
    try {
      const post = async (action: string, payload: Record<string, unknown>) => {
        const r = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, payload: { ...payload, caseId, questionId: selected } }) }), v = await r.json()
        if (!r.ok) throw new Error(v.error || 'Uppladdningen kunde inte bekräftas.'); return v
      }
      const signed = await post('create_signed_upload', { fileName: file.name, contentType: file.type, fileSize: file.size })
      const r = await supabase.storage.from(signed.upload.bucket).uploadToSignedUrl(signed.upload.filePath, signed.upload.token, file, { contentType: signed.upload.contentType })
      if (r.error) { await post('abort_upload', { filePath: signed.upload.filePath }).catch(() => undefined); throw new Error('Uppladdningen misslyckades.') }
      await post('complete_upload', { filePath: signed.upload.filePath, fileName: file.name, contentType: file.type, fileSize: file.size, participantIds: [] })
      const next = (await refresh())?.privateFiles?.filter(f => f.questionId === selected) || []
      const name = file.name.replace(/[\u0000-\u001f\u007f/\\]+/g, '_').trim().slice(0, 180) || 'bilaga'
      const added = next.filter(f => !data?.privateFiles?.some(old => old.id === f.id) && f.fileName === name && f.fileSizeBytes === file.size)
      if (added.length !== 1) throw new Error('Filen finns i projektet men kunde inte kopplas automatiskt. Välj filen i listan.')
      changeFiles([...fileIds, added[0].id])
    } catch (e) { setError(e instanceof Error ? e.message : 'Filen kunde inte laddas upp.') }
    finally { running.current = false; setBusy(false); if (uploadInput.current) uploadInput.current.value = '' }
  }
  const rows = (data?.questions || []).filter(q => (filter === 'all' || (filter === 'closed' ? q.body.status === 'closed' : q.body.status !== 'closed')) && `${q.number} ${q.body.title} ${q.body.description} ${q.body.assignee?.name || ''}`.toLocaleLowerCase('sv').includes(search.toLocaleLowerCase('sv')))
  const historicalFiles = [...new Map((question?.events.flatMap(e => e.files) || []).map(f => [f.id, f])).values()]
  const questionFiles = [...files, ...(data?.privateFiles || []).filter(f => f.questionId === selected)]
  const availableFiles = mode === 'send' ? questionFiles.filter(f => !f.isQuoteDocument) : questionFiles
  const sendFiles = mode === 'send' ? historicalFiles.filter(f => availableFiles.some(a => a.id === f.id)) : []
  const choices = [...new Map([...sendFiles.map(f => ({ id: f.id, fileName: f.name })), ...availableFiles].map(f => [f.id, f])).values()]
  const closed = question?.body.status === 'closed'
  const taskOpen = Boolean(question?.tasks.some(t => t.active ?? !['approved', 'cancelled'].includes(t.status)))
  const taskReply = (question?.tasks.find(t => t.active && t.replyTarget) || question?.tasks.filter(t => t.replyTarget).at(-1))?.replyTarget || undefined
  const detailsDisabled = busy || autosave.busy || !draft.title.trim() || !draft.description.trim()
  const sendRequirements = questionSendRequirements({ assignee: draft.assignee, dueAt: taskDateTimeInputToIso(due, dueTime, 'Europe/Stockholm'), followupAt: taskDateTimeInputToIso(followup, followupTime, 'Europe/Stockholm'), confirmed })
  const history = [...question?.events || [], ...question?.dialogueHistory || []].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  const availablePeople = (data?.assignees || []).filter(p => data?.canManageParticipants || (p.kind === 'profile' && [data?.userId, data?.managerId].includes(p.id)) || question?.participants?.some(m => m.kind === p.kind && m.personId === p.id))
  const assignees = questionAssigneeOptions(availablePeople, draft.assignee)
  const selectedTab = ['send', 'close', 'reopen'].includes(mode) ? 'details' : mode
  const tabs = [['details', 'Fråga', ClipboardList], ['dialogue', 'Kommunikation', MessageSquare], ['participants', 'Deltagare', Users], ['history', 'Historik', History]] as const
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
      {question && <div className="gizmo-register-tabs gizmo-question-tabs" role="tablist" aria-label="Frågans innehåll" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)')), index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length
        buttons[next]?.focus(); buttons[next]?.click()
      }}>{tabs.map(([key, label, Icon]) => <button type="button" role="tab" className="gizmo-register-tab" key={key} id={`${headingId}-${key}`} aria-controls={`${headingId}-panel`} aria-selected={selectedTab === key} tabIndex={selectedTab === key ? 0 : -1} disabled={busy} onClick={() => void switchMode(key)}><Icon size={17} aria-hidden="true" />{label}</button>)}</div>}
      <div className="gizmo-question-panel-body" role={question ? 'tabpanel' : undefined} id={`${headingId}-panel`} aria-labelledby={question ? `${headingId}-${selectedTab}` : undefined}>
        {error && <p role="alert" className="gizmo-question-error">{error}</p>}
        {refreshError && <p role="alert" className="gizmo-question-error">{refreshError}</p>}
        {autosave.error && <div role="alert" className="gizmo-question-error"><p>{autosave.error}</p><button type="button" className={button} disabled={autosave.busy} onClick={() => void autosave.retry()}><RefreshCw size={16} />Försök spara igen</button><button type="button" className={button} disabled={autosave.busy} onClick={() => { if (!selected || !window.confirm('Ersätt det lokala frågeutkastet med den sparade frågan?')) return; const body = question?.body || emptyQuestion(); autosave.seed(draftKey(selected, 'details'), { questionId: selected, body, fileIds: [] }, question?.revision || 0, true); setDraft(body); setFileIds([]) }}>Hämta sparad fråga</button></div>}
        {localError && <p role="alert" className="gizmo-question-error">{localError}</p>}
        {notice && <p role="status">{notice}</p>}
        <fieldset className="gizmo-question-form" disabled={busy || Boolean(pending.current)}>
          {['details', 'send'].includes(mode) && <>
            <label>Rubrik<input ref={titleInput} className={field} value={draft.title} maxLength={250} readOnly={closed} onChange={e => patch({ title: e.target.value })} /></label>
            <label>Fråga<textarea className={field} rows={5} value={draft.description} maxLength={12000} readOnly={closed} onChange={e => patch({ description: e.target.value })} /></label>
            <div className="gizmo-question-pair"><label>Sammanhang / möte<input className={field} value={draft.source} maxLength={500} readOnly={closed} onChange={e => patch({ source: e.target.value })} /></label><label>Mötesdatum (valfritt)<input className={field} type="date" min="0001-01-01" max="9999-12-31" value={draft.meetingDate} readOnly={closed} onChange={e => patch({ meetingDate: e.target.value })} /></label></div>
            <label>Ansvarig<select className={field} disabled={closed || taskOpen} title={taskOpen ? 'Hantera den aktiva uppgiften i Gizmo innan ansvarig byts' : undefined} value={draft.assignee ? `${draft.assignee.kind}:${draft.assignee.id}` : ''} onChange={e => patch({ assignee: assignees.find(a => `${a.kind}:${a.id}` === e.target.value) || null })}><option value="">Ej tilldelad</option>{draft.assignee && !assignees.some(a => a.id === draft.assignee?.id && a.kind === draft.assignee.kind) && <option value={`${draft.assignee.kind}:${draft.assignee.id}`}>{draft.assignee.name} (inte tillgänglig)</option>}{assignees.map(a => <option value={`${a.kind}:${a.id}`} key={`${a.kind}:${a.id}`}>{a.name}{a.email ? ` (${a.email})` : ''}{a.kind === 'customer' ? ' · Beställare' : a.kind === 'profile' ? ' · Intern' : ' · Kontakt'}</option>)}</select></label>
            {data?.customersAvailable === false && <p role="status" className="gizmo-secondary">Beställare i ansvariglistan behöver aktiveras i databasen.</p>}
            {!closed && <label>Status<select className={field} value={draft.status} onChange={e => patch({ status: e.target.value as QuestionBody['status'] })}>{Object.entries(questionStatuses).filter(([key]) => key !== 'closed').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>}
          </>}
          {['answer', 'note', 'close', 'reopen'].includes(mode) && <>
            {mode === 'answer' && <label>Återgivet svar från (lämnas tomt för eget svar)<input className={field} maxLength={250} value={reportedBy} onChange={e => compose(setReportedBy, e.target.value)} /></label>}
            <label>{mode === 'answer' ? 'Svar' : mode === 'note' ? 'Intern anteckning' : mode === 'close' ? 'Avslutningsanteckning' : 'Skäl till återöppning'}<textarea className={field} rows={6} maxLength={12000} value={message} onChange={e => compose(setMessage, e.target.value)} /></label>
          </>}
          {question && ['details', 'send'].includes(mode) && data?.canManageParticipants && !closed && <details className="gizmo-question-dispatch" open={mode === 'send'}><summary onClick={event => { event.preventDefault(); void switchMode(mode === 'send' ? 'details' : 'send') }}>Skicka till ansvarig{taskOpen ? ' · Redan skickad' : ''}</summary>{taskOpen ? <p>Frågan har redan en aktiv uppgift. Status och länk till uppgiften visas nedan. Ett nytt utskick skapas inte.</p> : <>
            <section className="gizmo-question-callout"><h3>{draft.assignee ? `Skickas till ${draft.assignee.name}` : 'Ingen ansvarig vald'}</h3>{!draft.assignee && <p>Välj ansvarig ovan under Fråga → Ansvarig. Valet sparas automatiskt.</p>}{draft.assignee?.email && <p>{draft.assignee.email}</p>}</section>
            <div className="gizmo-question-pair"><label>Svar senast<input className={field} type="date" min="0001-01-01" max="9999-12-31" value={due} onChange={e => compose(setDue, e.target.value)} required /></label><label>Klockslag för svar (Stockholm)<input className={field} type="time" value={dueTime} onChange={e => compose(setDueTime, e.target.value)} required /></label><label>Första uppföljning<input className={field} type="date" min="0001-01-01" max={due || '9999-12-31'} value={followup} onChange={e => compose(setFollowup, e.target.value)} required /></label><label>Klockslag för uppföljning (Stockholm)<input className={field} type="time" value={followupTime} onChange={e => compose(setFollowupTime, e.target.value)} required /></label></div>
          </>}</details>}
          {!['history', 'dialogue', 'participants'].includes(mode) && !closed && <section className="gizmo-question-files"><h3>{mode === 'send' ? 'Bilagor till mottagaren' : 'Bilagor till denna historikpost'}</h3><ul>{choices.map(f => <li key={f.id}><label><input type="checkbox" checked={fileIds.includes(f.id)} disabled={!fileIds.includes(f.id) && fileIds.length >= 20} onChange={e => changeFiles(e.target.checked ? [...fileIds, f.id] : fileIds.filter(id => id !== f.id))} />{f.fileName}</label><a href={`/api/action-cases/${caseId}/attachments/${f.id}`} target="_blank" rel="noreferrer" aria-label={`Öppna ${f.fileName}`} title="Öppna i ny flik"><ExternalLink size={16} /></a></li>)}</ul>{mode !== 'send' && <><button className={button} type="button" onClick={() => uploadInput.current?.click()} disabled={!question || fileIds.length >= 20} title={question ? 'Ladda upp bilaga' : 'Spara frågan före uppladdning'}><Upload size={16} /> Ladda upp bilaga</button><input className="hidden" ref={uploadInput} type="file" accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" aria-label="Ladda upp bilaga till frågan" onChange={e => void upload(e.target.files?.[0])} /></>}</section>}
          {mode === 'send' && <label className="gizmo-question-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Jag har granskat mottagaren, frågetexten och de valda bilagorna inför utskick.</label>}
          {mode === 'send' && !taskOpen && !pending.current && sendRequirements.length > 0 && <section className="gizmo-question-callout" aria-label="Kvar inför utskick" id={`${headingId}-send-requirements`}><h3>Kvar inför utskick</h3><ul className="gizmo-question-requirements">{sendRequirements.map(item => <li key={item.field}>{item.message}</li>)}</ul></section>}
        </fieldset>
        {question && ['dialogue', 'participants'].includes(mode) && <QuestionDialogue key={`${question.id}:${mode}`}
          endpoint={`/api/action-cases/${caseId}/questions/${question.id}/dialogue`} fileBase={`/api/action-cases/${caseId}/questions/${question.id}/files`}
          mode={mode as 'dialogue' | 'participants'} footerTarget={mode === 'participants' ? dialogueFooter : undefined}
          storageKey={draftKey(question.id, 'dialogue')} onFlush={registerDialogueFlush} onRefresh={refreshLinkedTasks}
          taskReply={taskReply} hasSharedDialogue={question.dialogueHistory?.some(e => e.operation === 'share')}
          people={questionAssigneeOptions(data?.assignees || [], question.body.assignee)} files={questionFiles} responsible={question.body.assignee}
          preview={{ title: question.body.title, description: question.body.description }} internalEvents={[
            ...question.events.filter(e => e.operation === 'note').map(e => ({ id: e.id, actorName: e.actorName, text: e.text, createdAt: e.createdAt, label: 'Intern anteckning', files: e.files.map(f => ({ ...f, href: `/api/action-cases/${caseId}/attachments/${f.id}` })) })),
            ...question.tasks.flatMap(task => task.events.map(e => ({ id: e.id, actorName: e.actorName, text: questionTaskEventText(e), createdAt: e.createdAt, label: 'Enskild uppdragsdialog · inte delad med övriga deltagare', files: [] }))),
          ]} noteRevision={question.revision} onNote={async attempt => {
          if (!await autosave.flush()) throw new Error('Frågan behöver sparas före anteckningen.')
          const response = await fetch(`/api/action-cases/${caseId}/questions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'note', questionId: question.id, requestId: attempt.requestId, revision: attempt.revision, text: attempt.text, fileIds: attempt.fileIds, reportedBy: '' }) })
          const result = await response.json()
          if (!response.ok || result.questionId !== question.id) throw new Error(result.error || 'Anteckningen kunde inte bekräftas sparad.')
          autosave.acknowledge(attempt.revision + 1)
          await refresh()
        }} onBusy={setBusy} onDirty={setDialogueDirty} onChanged={dialogueChanged} onStatus={setDialogueSaveStatus} />}
        {mode === 'history' && <>
          {question?.dialogueHistory?.some(e => e.operation === 'participants') && <p className="gizmo-secondary gizmo-question-notice">Äldre deltagarurval sparades med personreferenser. Namnen visas enligt kontaktregistret.</p>}
          <ol className="gizmo-question-history">{history.map(e => 'revision' in e ? <li key={e.id}><h3>{labels[e.operation] || e.operation}</h3><p className="gizmo-secondary">{e.actorName} · {stamp(e.createdAt)}</p>{e.reportedBy && <p>Återgivet svar från {e.reportedBy}, registrerat av {e.actorName}</p>}{e.text && <p className="whitespace-pre-wrap">{e.text}</p>}<details><summary>Frågans version {e.revision}</summary><p><strong>{e.body.title}</strong></p><p className="whitespace-pre-wrap">{e.body.description}</p><p>{e.body.source} {e.body.meetingDate}</p><p>Ansvarig: {e.body.assignee?.name || 'Ej tilldelad'} · {questionStatuses[e.body.status]}</p></details>{e.files.map(f => <a key={f.id} className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/attachments/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}{e.taskId && <a className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/uppdrag?task=${e.taskId}`}><ExternalLink size={16} />Öppna uppgiften</a>}</li> : <li key={e.id}>
            <h3>{e.operation === 'participants' ? 'Deltagarurval sparat' : 'Frågan delad med deltagarna'}</h3><p className="gizmo-secondary">{e.actorName} · {stamp(e.createdAt)}</p>
            {e.operation === 'participants' ? <>
              {e.added === null || e.removed === null ? <p>Tidigare urval saknas som jämförelseunderlag.</p> : <>{e.added.length > 0 && <p>Tillagda i urvalet: {e.added.map(p => p.name).join(', ')}</p>}{e.removed.length > 0 && <p>Borttagna ur urvalet: {e.removed.map(p => p.name).join(', ')}</p>}{!e.added.length && !e.removed.length && <p>Oförändrat urval.</p>}</>}
              <details><summary>Sparat deltagarurval</summary><ul>{e.selected.map(p => <li key={p.key}>{p.name}</li>)}</ul></details>
            </> : <>
              {e.snapshot && <details><summary>Underlaget som delades</summary><strong>{e.snapshot.title}</strong><p className="whitespace-pre-wrap">{e.snapshot.description}</p></details>}
              {e.files.map(f => <a key={f.id} className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/questions/${question?.id}/files/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}
              <ul className="gizmo-question-deliveries">{e.deliveries.map(d => <li key={d.id}><strong>{d.name}</strong>: {questionDeliveryLabels[d.status] || d.status}{d.sentAt && <> · {stamp(d.sentAt)}</>}</li>)}</ul>
              {!e.deliveries.length && <p>Inga mejlutskick registrerade för delningen.</p>}
            </>}
          </li>)}</ol>
        </>}
        {question && historicalFiles.length > 0 && mode === 'details' && <section className="gizmo-question-files"><h3>Sparade bilagor</h3>{historicalFiles.map(f => <a className="gizmo-question-file-link" key={f.id} target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/attachments/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}</section>}
        {['details', 'send'].includes(mode) && question?.tasks.map(task => <section className="gizmo-question-task" key={task.id}><div className="flex flex-wrap justify-between gap-2"><h3>Uppgift till {task.assigneeName}</h3><a className="gizmo-question-file-link" target="_blank" rel="noreferrer" href={`/uppdrag?task=${task.id}`}><ExternalLink size={16} />Öppna uppgiften</a></div><p>{taskLabels[task.status] || task.status} · Svar senast {stamp(task.dueAt)}</p>{task.files.map(f => f.text !== null ? <div className="gizmo-question-task-event" key={f.id}><h4>{f.name}</h4><p className="whitespace-pre-wrap">{f.text}</p></div> : <a className="gizmo-question-file-link" key={f.id} target="_blank" rel="noreferrer" href={`/api/action-cases/${caseId}/questions/tasks/${task.id}/files/${f.id}`}><ExternalLink size={16} />{f.name}</a>)}</section>)}
      </div>
      <footer>
        <span role="status">{busy ? 'Arbetar…' : autosave.busy ? 'Sparar…' : autosave.error || localError ? 'Sparfel · utkastet finns kvar' : ['dialogue', 'participants'].includes(mode) && dialogueSaveStatus ? dialogueSaveStatus : mode === 'send' ? pending.current ? 'Utskicket kunde inte bekräftas' : 'Inte skickat · utkast på den här enheten' : autosave.dirty || !['details', 'history', 'participants', 'dialogue'].includes(mode) ? 'Utkast sparat på den här enheten' : question ? 'Sparat internt' : 'Ny fråga'}</span>
        <div className="flex flex-wrap gap-2">
          {question && mode === 'details' && <button className={button} disabled={busy || dirty || (closed && projectClosed) || (!closed && taskOpen)} title={projectClosed ? 'Återöppna projektet först' : taskOpen ? 'Hantera den aktiva uppgiften i Gizmo först' : undefined} onClick={() => switchMode(closed ? 'reopen' : 'close')}>{closed ? 'Återöppna' : 'Avsluta fråga'}</button>}
          <button className={button} onClick={close} disabled={busy}>Stäng</button>
          {mode === 'participants' && <div ref={setDialogueFooter} className="gizmo-question-footer-actions" />}
          {mode === 'details' && !question && <button className={`${button} gizmo-question-primary`} disabled={detailsDisabled} onClick={() => void write('create')}><Save size={16} />{autosave.busy ? 'Skapar…' : autosave.error ? 'Försök skapa igen' : 'Skapa fråga'}</button>}
          {mode === 'details' && !closed && <button className={button} disabled={detailsDisabled} onClick={() => void write(question ? 'update' : 'create', true)}><Plus size={16} />Spara och skapa nästa</button>}
          {mode === 'send' && !taskOpen && !pending.current && sendRequirements.length > 0 && <span className="gizmo-secondary">{sendRequirements.length} {sendRequirements.length === 1 ? 'uppgift' : 'uppgifter'} kvar inför utskick</span>}
          {!['details', 'history', 'dialogue', 'participants'].includes(mode) && !(mode === 'send' && taskOpen) && <button className={`${button} gizmo-question-primary`} aria-describedby={mode === 'send' && sendRequirements.length && !pending.current ? `${headingId}-send-requirements` : undefined} disabled={busy || autosave.busy || (!pending.current && (mode === 'send' ? sendRequirements.length > 0 : !message.trim()))} onClick={() => void write(mode)}>{busy ? <Loader2 size={16} className="animate-spin" /> : mode === 'send' ? <Send size={16} /> : <Save size={16} />}{busy ? mode === 'send' ? 'Skickar…' : 'Sparar…' : pending.current ? 'Försök igen' : mode === 'send' ? 'Skicka uppgift' : mode === 'note' ? 'Publicera intern anteckning' : mode === 'close' ? 'Avsluta fråga' : mode === 'reopen' ? 'Återöppna fråga' : 'Skicka svar'}</button>}
        </div>
      </footer>
    </div>
  </div>, document.body) : null
  return <section className="gizmo-questions" aria-label="Frågor och beslut" hidden={!active}>
    <div className="gizmo-section-heading"><h2>Frågor och beslut</h2><div className="flex gap-2"><button className={`${button} gizmo-icon-button`} disabled={loading || busy} title="Hämta sparade frågor och svar" aria-label="Hämta sparade frågor och svar" onClick={() => void refresh()}><RefreshCw size={17} /></button><button className={button} disabled={!data || loading || projectClosed} title={projectClosed ? 'Återöppna projektet först' : undefined} onClick={() => open()}><Plus size={17} />Ny fråga</button></div></div>
    {!selected && error && <p role="alert" className="gizmo-question-error">{error}</p>}{!selected && notice && <p role="status">{notice}</p>}
    {!selected && refreshError && <p role="alert" className="gizmo-question-error">{refreshError}</p>}
    <div className="gizmo-question-toolbar"><label className="gizmo-question-search"><Search size={17} /><input className={field} placeholder="Sök frågor" aria-label="Sök frågor" value={search} onChange={e => setSearch(e.target.value)} /></label><label>Visa<select className={field} aria-label="Filtrera frågor" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">Aktiva</option><option value="all">Alla</option><option value="closed">Avslutade</option></select></label><span className="gizmo-secondary" role="status">{loading ? 'Hämtar…' : `${rows.length} ${rows.length === 1 ? 'fråga' : 'frågor'}`}</span></div>
    <div className="gizmo-question-table" role="table" aria-label="Projektfrågor">
      <div role="row" className="gizmo-question-table-head"><span role="columnheader">Nr / Fråga</span><span role="columnheader">Ansvarig</span><span role="columnheader">Status</span><span role="columnheader">Skapad</span><span role="columnheader">Uppdaterad</span></div>
      {rows.map(q => <div role="row" key={q.id} className="gizmo-question-table-row" onClick={event => { if (!(event.target as HTMLElement).closest('button,a,input,select,textarea')) open(q) }}>
        <div role="cell"><button className="gizmo-question-open" onClick={() => open(q)}><span className="gizmo-secondary">F-{String(q.number).padStart(3, '0')}</span><strong>{q.body.title}</strong></button></div>
        <span role="cell">{q.body.assignee?.name || 'Ej tilldelad'}</span><span role="cell">{questionStatuses[q.body.status]}</span>
        <span role="cell" className="gizmo-secondary gizmo-question-date"><span className="gizmo-question-date-label">Skapad: </span>{q.createdAt ? <time dateTime={q.createdAt}>{stamp(q.createdAt)}</time> : '-'}</span>
        <span role="cell" className="gizmo-secondary gizmo-question-date"><span className="gizmo-question-date-label">Uppdaterad: </span><time dateTime={q.updatedAt}>{stamp(q.updatedAt)}</time></span>
      </div>)}
    </div>
    {data && !rows.length && <div className="gizmo-question-empty"><MessageSquare size={22} /><p>{search || filter === 'closed' ? 'Inga frågor matchar urvalet.' : 'Inga öppna projektfrågor.'}</p></div>}{panel}
  </section>
}
