'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, Loader2, Plus, RefreshCw, Send, X } from 'lucide-react'
import type { QuestionDialogue as Dialogue } from '@/lib/action-cases/questionDialogue'
import type { QuestionAssignee, QuestionTaskReplyTarget } from '@/lib/action-cases/projectQuestions'
import { formatTaskDateTime } from '@/lib/tasks/dateTime'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import './project-questions.css'
import { useQuestionAutosave } from './useQuestionAutosave'
import TaskContactFields, { type TaskContactDraft } from './TaskContactFields'

const refKey = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`
export default function QuestionDialogue({ endpoint, fileBase, initial, mode = 'dialogue', publicView = false, people = [], files = [], responsible, taskReply, hasSharedDialogue = false, preview, footerTarget, storageKey, internalEvents = [], noteRevision = 0, onNote, onFlush, onBusy, onDirty, onChanged, onRefresh, onStatus }: {
  endpoint: string; fileBase: string; initial?: Dialogue; mode?: 'dialogue' | 'participants'; publicView?: boolean;
  people?: QuestionAssignee[]; files?: ActionCaseAttachmentView[]; responsible?: QuestionAssignee | null; preview?: { title: string; description: string };
  taskReply?: QuestionTaskReplyTarget; hasSharedDialogue?: boolean;
  footerTarget?: HTMLElement | null;
  storageKey?: string; onFlush?: (flush: (() => Promise<boolean>) | null) => void;
  internalEvents?: Array<{ id: string; actorName: string; text: string; createdAt: string; label: string; files: Array<{ id: string; name: string; href: string }> }>;
  noteRevision?: number; onNote?: (attempt: { requestId: string; revision: number; text: string; fileIds: string[] }) => Promise<void>;
  onBusy?: (busy: boolean) => void; onDirty?: (dirty: boolean) => void; onChanged?: () => void; onRefresh?: () => Promise<void>; onStatus?: (status: string) => void
}) {
  const [data, setData] = useState<Dialogue | null>(initial || null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [text, setText] = useState(''), [selected, setSelected] = useState<string[]>([]), [fileIds, setFileIds] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false)
  const running = useRef(false), pending = useRef<{ key: string; id: string } | null>(null), selectionDirty = useRef(false)
  const seeded = useRef(false), bodyInput = useRef<HTMLTextAreaElement>(null)
  const [composerReady, setComposerReady] = useState(false), [localError, setLocalError] = useState('')
  const [audience, setAudience] = useState<'shared' | 'internal' | 'responsible'>(taskReply && !hasSharedDialogue ? 'responsible' : 'shared')
  const [taskDraftTarget, setTaskDraftTarget] = useState(taskReply)
  const [extraPeople, setExtraPeople] = useState<QuestionAssignee[]>([]), [contactOpen, setContactOpen] = useState(false)
  const [contact, setContact] = useState<TaskContactDraft>({ name: '', companyName: '', email: '', phone: '' })
  const contactAttempt = useRef<{ requestId: string; contact: TaskContactDraft } | null>(null)
  const rosterSave = useQuestionAutosave<string[]>({
    valid: () => true,
    save: async attempt => {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'participants', version: attempt.revision, requestId: attempt.requestId, participants: attempt.value.map(key => { const [kind, id] = key.split(':'); return { kind, id } }), text: '', fileIds: [], confirmed: false }) })
      const result = await response.json()
      if (!response.ok || result.messageId !== attempt.requestId || result.questionId !== data?.questionId) throw new Error(result.error || 'Deltagarna kunde inte sparas. Dina val finns kvar.')
    },
    onSaved: (value, version) => {
      selectionDirty.current = JSON.stringify(rosterSave.value()) !== JSON.stringify(value)
      setData(current => current ? { ...current, version } : current)
      setNotice('Deltagarna är sparade.'); onChanged?.()
      void load().catch(e => setError(e instanceof Error ? e.message : 'Deltagarna kunde inte hämtas.'))
    },
  })
  const roster = useRef(rosterSave); roster.current = rosterSave
  const load = useCallback(async (signal?: AbortSignal, discardDraft = false) => {
    const r = await fetch(endpoint, { cache: 'no-store', signal }), result = await r.json()
    if (!r.ok) { if (r.status === 404 || r.status === 403) { setData(null); onChanged?.() } throw new Error(result.error || 'Dialogen kunde inte hämtas.') }
    setData(current => current && current.version > result.version ? current : result)
    if (result.version >= roster.current.revision() && !selectionDirty.current && !roster.current.isBusy()) {
      const saved = result.participants.map((p: { kind: string; personId: string }) => `${p.kind}:${p.personId}`).sort()
      const restored = result.canManage ? roster.current.seed(`${storageKey || endpoint}:participants`, saved, result.version, discardDraft) || saved : saved
      setSelected(restored)
      selectionDirty.current = JSON.stringify(restored) !== JSON.stringify(saved)
    }
    seeded.current = true
    return result as Dialogue
  }, [endpoint, onChanged, storageKey])
  useEffect(() => {
    const controller = new AbortController()
    if (initial && !seeded.current) { seeded.current = true; const saved = initial.participants.map(p => `${p.kind}:${p.personId}`).sort(); const restored = initial.canManage ? roster.current.seed(`${storageKey || endpoint}:participants`, saved, initial.version) || saved : saved; setSelected(restored); selectionDirty.current = JSON.stringify(restored) !== JSON.stringify(saved) }
    else void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Dialogen kunde inte hämtas.') })
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !running.current && !selectionDirty.current) void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Dialogen kunde inte hämtas.') })
    }, 20000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [initial, load, endpoint, storageKey])
  useEffect(() => {
    if (!storageKey || publicView) { setComposerReady(true); return }
    try {
      const stored = JSON.parse(localStorage.getItem(`${storageKey}:${mode}:${audience}:composer`) || 'null')
      setText(''); setFileIds([]); pending.current = null
      if (typeof stored?.text === 'string') setText(stored.text)
      if (Array.isArray(stored?.fileIds)) setFileIds(stored.fileIds.filter((value: unknown) => typeof value === 'string'))
      if (stored?.pending && typeof stored.pending.key === 'string' && typeof stored.pending.id === 'string') pending.current = stored.pending
      if (audience === 'responsible' && stored?.taskTarget?.taskId && stored.taskTarget.recipient?.id && ['contact', 'profile'].includes(stored.taskTarget.recipient.kind)) setTaskDraftTarget(stored.taskTarget)
      if (stored?.contact && ['name', 'email', 'companyName', 'phone'].every(key => typeof stored.contact[key] === 'string')) { setContact(stored.contact); setContactOpen(Boolean(stored.contact.name || stored.contact.email)) }
      if (stored?.contactAttempt?.requestId && stored.contactAttempt.contact) contactAttempt.current = stored.contactAttempt
    } catch { setLocalError('Utkastet kunde inte läsas på den här enheten.') }
    setComposerReady(true)
  }, [storageKey, mode, publicView, audience])
  const remember = useCallback(() => {
    if (!storageKey || publicView || !composerReady) return true
    if (!text && !fileIds.length && !pending.current && !Object.values(contact).some(Boolean) && !contactAttempt.current) {
      try { localStorage.removeItem(`${storageKey}:${mode}:${audience}:composer`) } catch { /* No unsent content needs local protection. */ }
      setLocalError(''); return true
    }
    try { localStorage.setItem(`${storageKey}:${mode}:${audience}:composer`, JSON.stringify({ text, fileIds, pending: pending.current, contact, contactAttempt: contactAttempt.current, ...(audience === 'responsible' ? { taskTarget: taskDraftTarget } : {}) })); setLocalError(''); return true }
    catch { setLocalError('Utkastet kan inte sparas på den här enheten. Behåll vyn öppen.'); return false }
  }, [storageKey, publicView, composerReady, mode, audience, text, fileIds, contact, taskDraftTarget])
  useEffect(() => { remember() }, [remember])
  const leave = useRef(async () => true)
  leave.current = async () => { await roster.current.flush(); return roster.current.isLocal() && remember() }
  useEffect(() => { onFlush?.(() => leave.current()); return () => onFlush?.(null) }, [onFlush])
  const dirty = Boolean(text || fileIds.length || confirmed || selectionDirty.current)
  const saveStatus = pending.current ? 'Åtgärden är inte bekräftad · utkastet finns kvar' : (text || fileIds.length || confirmed) ? mode === 'participants' ? 'Delning inte skickad' : 'Oskickat utkast på den här enheten' : ''
  useEffect(() => { onStatus?.(saveStatus) }, [onStatus, saveStatus])
  useEffect(() => () => onStatus?.(''), [onStatus])
  useEffect(() => {
    if ((!dirty || (!publicView && storageKey && !localError && rosterSave.local)) && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy, publicView, storageKey, localError, rosterSave.local])
  useEffect(() => { onDirty?.(Boolean(localError || (rosterSave.dirty && !rosterSave.local) || (publicView && dirty))) }, [onDirty, localError, rosterSave.dirty, rosterSave.local, publicView, dirty])
  useEffect(() => () => { onDirty?.(false); onBusy?.(false) }, [onDirty, onBusy])
  const candidates = [...new Map([...people, ...extraPeople].map(p => [refKey(p), p] as const).concat((data?.participants || []).map(p => [`${p.kind}:${p.personId}`, { id: p.personId, kind: p.kind, name: p.name, email: p.email }] as const))).values()]
  const required = (p: QuestionAssignee) => (p.kind === 'profile' && p.id === data?.managerId) || (p.kind === responsible?.kind && p.id === responsible.id)
  function select(p: QuestionAssignee, checked: boolean) {
    selectionDirty.current = true; setConfirmed(false); setNotice('')
    setSelected(current => checked ? [...current, refKey(p)] : current.filter(key => key !== refKey(p)))
    const next = new Set(selected)
    if (checked) next.add(refKey(p)); else next.delete(refKey(p))
    for (const person of candidates) if (required(person)) next.add(refKey(person))
    rosterSave.change([...next].sort())
  }
  async function refresh() {
    if (running.current || rosterSave.isBusy() || ((selectionDirty.current || rosterSave.error) && !window.confirm('Hämta sparade deltagare och kasta dina osparade deltagarval?'))) return
    selectionDirty.current = false; setConfirmed(false)
    try { await Promise.all([load(undefined, true), onRefresh?.()]); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Dialogen kunde inte hämtas.') }
  }
  async function addContact() {
    if (running.current || !data?.canManage) return
    contactAttempt.current ||= { requestId: crypto.randomUUID(), contact: structuredClone(contact) }
    if (!remember()) return
    running.current = true; setBusy(true); onBusy?.(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'contact', ...contactAttempt.current }) }), result = await response.json()
      if (!response.ok && response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status)) contactAttempt.current = null
      if (!response.ok || !result.person || result.person.id !== contactAttempt.current?.requestId || result.person.kind !== 'contact') throw new Error(result.error || 'Kontakten kunde inte bekräftas sparad.')
      setExtraPeople(current => [...current.filter(p => p.id !== result.person.id), result.person]); select(result.person, true)
      contactAttempt.current = null; setContact({ name: '', companyName: '', email: '', phone: '' }); setContactOpen(false); onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Kontakten kunde inte sparas.') }
    finally { running.current = false; setBusy(false); onBusy?.(false) }
  }
  async function write(operation: 'share' | 'reply' | 'note' | 'task_reply') {
    if (running.current || !data) return
    if (!await rosterSave.flush()) { setError('Deltagarna behöver sparas innan frågan delas.'); return }
    if (operation === 'task_reply' && !pending.current && (publicView || !taskDraftTarget || taskRecipientChanged)) return
    const payload = pending.current ? JSON.parse(pending.current.key) : { operation, version: operation === 'note' ? noteRevision : rosterSave.revision() || data.version, text, participants: [], fileIds, confirmed, ...(operation === 'task_reply' ? { taskId: taskDraftTarget?.taskId, recipient: taskDraftTarget?.recipient } : {}) }
    const key = JSON.stringify(payload)
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() }
    const requestId = pending.current.id
    if (!remember()) return
    running.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('')
    try {
      if (payload.operation === 'note') {
        if (publicView || !onNote) throw new Error('Intern anteckning är inte tillgänglig.')
        await onNote({ requestId, revision: payload.version, text: payload.text, fileIds: payload.fileIds })
      } else {
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId }) }), result = await r.json()
        if (!r.ok) {
          if (payload.operation === 'task_reply' && r.status === 409 && result.code === 'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED') {
            pending.current = null; remember()
            await onRefresh?.()
          }
          throw new Error(result.error || 'Sparningen kunde inte bekräftas.')
        }
        if (result.messageId !== requestId || result.questionId !== data.questionId) throw new Error('Svaret kunde inte bekräftas. Dina uppgifter är kvar.')
      }
      pending.current = null; selectionDirty.current = false; setText(''); setFileIds([]); setConfirmed(false)
      if (storageKey && !publicView) try { localStorage.removeItem(`${storageKey}:${mode}:${audience}:composer`) } catch { /* Keep the acknowledged result. */ }
      setNotice(operation === 'share' ? 'Frågan är delad. Notifieringar ligger i utskickskön.' : operation === 'note' ? 'Intern anteckning sparad. Inget mejl skickas.' : operation === 'task_reply' ? 'Meddelandet är sparat i den enskilda uppgiften. Notifieringen ligger i Uppdrags utskickskö.' : 'Svaret är sparat. Frågans status är oförändrad.')
      onChanged?.()
      if (operation === 'task_reply') await onRefresh?.()
      await load()
      if (operation === 'reply') bodyInput.current?.focus()
    } catch (e) { setError(e instanceof Error ? e.message : 'Sparningen misslyckades. Dina uppgifter är kvar.') }
    finally { running.current = false; setBusy(false); onBusy?.(false) }
  }
  const btn = 'gizmo-button', closed = data?.status === 'closed'
  const taskRecipientChanged = Boolean(taskDraftTarget && (taskDraftTarget.taskId !== taskReply?.taskId || JSON.stringify(taskDraftTarget.recipient) !== JSON.stringify(taskReply?.recipient)))
  const audiences: Array<['shared' | 'responsible' | 'internal', string]> = [
    ...(!taskReply || data?.sharedAt ? [['shared', 'Meddelande till deltagarna'] as ['shared', string]] : []),
    ...(taskReply || taskDraftTarget ? [['responsible', `Meddelande till ${taskDraftTarget?.name || taskReply?.name || 'ansvarig'} via Uppdrag`] as ['responsible', string]] : []),
    ['internal', 'Intern anteckning'],
  ]
  const composerLabel = audience === 'internal' ? 'Intern anteckning · delas inte och mejlaviseras inte' : audience === 'responsible' ? `Meddelande till ${taskDraftTarget?.name || 'ansvarig'} via Uppdrag` : 'Meddelande till frågans deltagare'
  const sharedFiles = files.filter(f => !f.isQuoteDocument)
  const timeline = data ? [...data.messages.map(m => ({ ...m, label: 'Delat med deltagarna', files: m.files.map(f => ({ ...f, href: `${fileBase}/${f.id}` })) })), ...(!publicView ? internalEvents.map(e => ({ ...e, operation: 'note', snapshot: null })) : [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)) : []
  const participantActions = mode === 'participants' && data?.canManage ? <>
    {rosterSave.error && <button type="button" className={btn} disabled={busy || rosterSave.busy} onClick={() => void rosterSave.retry()}><RefreshCw size={16} />Försök spara igen</button>}
    <button type="button" className={`${btn} gizmo-question-primary`} disabled={busy || closed || selectionDirty.current || (!confirmed && !pending.current)} onClick={() => void write('share')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{busy ? 'Delar…' : pending.current ? 'Försök dela igen' : data.sharedAt ? 'Uppdatera och meddela deltagare' : 'Dela med deltagarna'}</button>
  </> : null
  return <section className="gizmo-question-dialogue" aria-label={mode === 'participants' ? 'Deltagare i frågan' : 'Frågans dialog'}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3>{mode === 'participants' ? 'Deltagare' : 'Kommunikation'}</h3><button type="button" className={`${btn} gizmo-icon-button`} aria-label="Hämta dialog och deltagare" title="Hämta dialog och deltagare" disabled={busy || rosterSave.busy} onClick={() => void refresh()}><RefreshCw size={16} /></button></div>
    {error && <p className="gizmo-question-error" role="alert">{error}</p>}{notice && <p className="gizmo-question-notice" role="status">{notice}</p>}
    {rosterSave.error && <p className="gizmo-question-error" role="alert">{rosterSave.error}</p>}
    {localError && <p className="gizmo-question-error" role="alert">{localError}</p>}
    {!publicView && <p className="gizmo-secondary" role="status">{rosterSave.busy ? 'Sparar deltagare…' : rosterSave.error ? 'Deltagarvalet är inte bekräftat sparat' : selectionDirty.current ? 'Deltagarvalet är sparat som lokalt utkast' : 'Deltagarval sparas automatiskt'}{(text || fileIds.length) && !localError ? ' · Utkast sparat på den här enheten' : ''}</p>}
    {!data ? <p>{error ? 'Dialogen är inte tillgänglig.' : 'Hämtar…'}</p> : <>
      {mode === 'participants' ? <>
        {!data.managerId && <p className="gizmo-question-notice" role="status">Projektansvarig är inte utsedd.</p>}
        {data.canManage ? <fieldset disabled={busy || Boolean(pending.current)} className="gizmo-question-participant-options"><legend className="sr-only">Välj deltagare i denna fråga</legend>{candidates.map(p => <label key={refKey(p)}><input type="checkbox" checked={selected.includes(refKey(p)) || required(p)} disabled={required(p)} onChange={e => select(p, e.target.checked)} /><span><strong>{p.name}</strong><small>{p.kind === 'customer' ? 'Beställare' : p.kind === 'profile' ? p.id === data.managerId ? 'Projektansvarig' : 'Intern' : 'Kontakt'}{p.email ? ` · ${p.email}` : ''}</small></span></label>)}</fieldset> : <ul className="gizmo-question-roster">{data.participants.map(p => <li key={p.id}>{p.name}</li>)}</ul>}
        {data.canManage && (contactOpen ? <form className="gizmo-question-new-contact" onSubmit={event => { event.preventDefault(); void addContact() }}><h4>Ny extern kontakt</h4><fieldset disabled={busy || Boolean(contactAttempt.current)}><TaskContactFields value={contact} onChange={setContact} className="gizmo-question-field" /></fieldset><div className="gizmo-question-commands"><button type="button" className={btn} disabled={busy || Boolean(contactAttempt.current)} onClick={() => setContactOpen(false)}><X size={16} />Stäng</button><button type="submit" className={btn} disabled={busy || (!contactAttempt.current && (!contact.name.trim() || !contact.email.trim()))}><Plus size={16} />{contactAttempt.current ? 'Försök lägga till igen' : 'Lägg till deltagare'}</button></div></form> : <button type="button" className={btn} disabled={busy || Boolean(pending.current)} onClick={() => setContactOpen(true)}><Plus size={16} />Ny extern kontakt</button>)}
        {data.canManage && <section className="gizmo-question-share"><h3>{data.sharedAt ? 'Uppdatera delad fråga' : 'Dela frågan'}</h3><h4>{preview?.title}</h4><p className="whitespace-pre-wrap">{preview?.description}</p>
          <p className="gizmo-secondary">Deltagare: {data.participants.map(p => p.name).join(', ')}</p>
          <fieldset disabled={busy || closed || selectionDirty.current || Boolean(pending.current)}>
            <legend>Bilagor att dela</legend>{sharedFiles.map(f => <label key={f.id} className="gizmo-question-confirm"><input type="checkbox" checked={fileIds.includes(f.id)} disabled={!fileIds.includes(f.id) && fileIds.length >= 20} onChange={e => { setFileIds(current => e.target.checked ? [...current, f.id] : current.filter(id => id !== f.id)); setConfirmed(false) }} />{f.fileName}</label>)}
            <label className="gizmo-question-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Jag har granskat frågan, bilagorna och deltagarna. Alla deltagare får läsa den delade dialogens historik.</label>
          </fieldset>
        </section>}
        {participantActions && (footerTarget ? createPortal(participantActions, footerTarget) : footerTarget === undefined ? <div className="gizmo-question-commands">{participantActions}</div> : null)}
      </> : <>
        {data.snapshot && <section className="gizmo-question-shared-body"><h3>{data.snapshot.title}</h3><p className="whitespace-pre-wrap">{data.snapshot.description}</p></section>}
        <p className="gizmo-secondary">Deltagare: {data.participants.filter(p => p.shared || !publicView).map(p => p.name).join(', ')}</p>
        {!data.sharedAt && <p>{taskReply ? `Enskild dialog med ${taskReply.name} via Uppdrag. Inte delad med övriga frågedeltagare.` : 'Frågan är inte delad ännu.'}</p>}
        <ol className="gizmo-question-messages">{timeline.map(m => <li key={m.id}><div className="gizmo-question-message-meta"><strong>{m.actorName}</strong><time dateTime={m.createdAt}>{formatTaskDateTime(m.createdAt, 'Europe/Stockholm', 'compact')}</time><span>{m.label}</span></div>
          {m.operation === 'share' ? <details><summary>Frågan delades / uppdaterades</summary><strong>{m.snapshot?.title}</strong><p className="whitespace-pre-wrap">{m.snapshot?.description}</p></details> : <p className="whitespace-pre-wrap">{m.text}</p>}
          {m.files.map(f => <a key={f.id} className="gizmo-question-file-link" href={f.href} target="_blank" rel="noreferrer"><ExternalLink size={16} />{f.name}</a>)}
        </li>)}</ol>
        {!closed && <fieldset disabled={busy}>{!publicView && onNote && <fieldset className="gizmo-question-audience" disabled={Boolean(pending.current)}><legend>Synlighet och mottagare</legend>{audiences.map(([key, label]) => <label key={key}><input type="radio" name={`${storageKey}-audience`} checked={audience === key} onChange={() => { if (remember()) { setComposerReady(false); setText(''); setFileIds([]); setAudience(key); if (key === 'responsible') setTaskDraftTarget(taskReply) } }} />{label}</label>)}</fieldset>}
          {audience === 'responsible' && <p className="gizmo-secondary">Går endast till mottagaren i den enskilda uppgiften, inte till frågans övriga deltagare.</p>}
          {audience === 'shared' && data.sharedAt && <p className="gizmo-secondary">Mottagare: {data.participants.filter(p => p.shared && p.id !== data.viewerId).map(p => p.name).join(', ') || 'Inga andra delade deltagare'}</p>}
          {audience === 'responsible' && taskRecipientChanged && <div className="gizmo-question-error" role="alert"><p>Uppgiftens mottagare har ändrats. Ditt utkast har inte skickats.</p>{taskReply && !pending.current && <button type="button" className={btn} onClick={() => setTaskDraftTarget(taskReply)}>Använd aktuell mottagare: {taskReply.name}</button>}</div>}
          <label className="gizmo-question-answer-label">{composerLabel}<textarea ref={bodyInput} className="gizmo-question-field" rows={4} maxLength={12000} value={text} disabled={Boolean(pending.current) || (audience === 'shared' && !data.sharedAt)} onChange={e => setText(e.target.value)} /></label>
          {!publicView && audience !== 'responsible' && sharedFiles.length > 0 && <details className="gizmo-question-reply-files"><summary>Bifoga projektfil</summary>{sharedFiles.map(f => <label key={f.id} className="gizmo-question-confirm"><input type="checkbox" checked={fileIds.includes(f.id)} disabled={!fileIds.includes(f.id) && fileIds.length >= 20} onChange={e => setFileIds(current => e.target.checked ? [...current, f.id] : current.filter(id => id !== f.id))} />{f.fileName}</label>)}</details>}
          <div className="gizmo-question-commands"><button type="button" className={`${btn} gizmo-question-primary`} disabled={busy || !text.trim() || (audience === 'shared' && !data.sharedAt) || (audience === 'responsible' && !pending.current && (!taskDraftTarget || taskRecipientChanged))} onClick={() => void write(audience === 'internal' ? 'note' : audience === 'responsible' ? 'task_reply' : 'reply')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{busy ? audience === 'internal' ? 'Sparar anteckning…' : 'Skickar…' : pending.current ? 'Försök igen' : audience === 'internal' ? 'Publicera intern anteckning' : 'Skicka meddelande'}</button></div>
        </fieldset>}
        {closed && <p className="gizmo-question-notice">Frågan är avslutad.</p>}
      </>}
      {!publicView && data.deliveries.some(d => ['failed', 'sending', 'pending'].includes(d.status)) && <details className="gizmo-question-delivery-status"><summary>Notifieringsstatus</summary><ul>{data.deliveries.map(d => <li key={d.id}>{d.name}: {({ sent: 'E-posttjänsten har tagit emot utskicket', pending: 'I kö', sending: 'Skickas', failed: 'Utskicket misslyckades', cancelled: 'Återkallad' } as Record<string, string>)[d.status] || d.status}</li>)}</ul></details>}
    </>}
  </section>
}
