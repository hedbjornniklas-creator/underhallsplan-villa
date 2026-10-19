'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ExternalLink, Loader2, RefreshCw, Save, Send } from 'lucide-react'
import type { QuestionDialogue as Dialogue } from '@/lib/action-cases/questionDialogue'
import type { QuestionAssignee } from '@/lib/action-cases/projectQuestions'
import { formatTaskDateTime } from '@/lib/tasks/dateTime'
import type { ActionCaseAttachmentView } from '@/lib/action-cases/contracts'
import './project-questions.css'

const refKey = (p: { kind: string; id: string }) => `${p.kind}:${p.id}`
export default function QuestionDialogue({ endpoint, fileBase, initial, mode = 'dialogue', publicView = false, people = [], files = [], responsible, preview, onBusy, onDirty, onChanged }: {
  endpoint: string; fileBase: string; initial?: Dialogue; mode?: 'dialogue' | 'participants'; publicView?: boolean;
  people?: QuestionAssignee[]; files?: ActionCaseAttachmentView[]; responsible?: QuestionAssignee | null; preview?: { title: string; description: string };
  onBusy?: (busy: boolean) => void; onDirty?: (dirty: boolean) => void; onChanged?: () => void
}) {
  const [data, setData] = useState<Dialogue | null>(initial || null), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [text, setText] = useState(''), [selected, setSelected] = useState<string[]>([]), [fileIds, setFileIds] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [selectionVersion, setSelectionVersion] = useState(0)
  const running = useRef(false), pending = useRef<{ key: string; id: string } | null>(null), selectionDirty = useRef(false)
  const seeded = useRef(false), bodyInput = useRef<HTMLTextAreaElement>(null)
  const load = useCallback(async (signal?: AbortSignal) => {
    const r = await fetch(endpoint, { cache: 'no-store', signal }), result = await r.json()
    if (!r.ok) { if (r.status === 404 || r.status === 403) { setData(null); onChanged?.() } throw new Error(result.error || 'Dialogen kunde inte hämtas.') }
    setData(result)
    if (!selectionDirty.current) {
      setSelected(result.participants.map((p: { kind: string; personId: string }) => `${p.kind}:${p.personId}`)); setSelectionVersion(result.version)
    }
    seeded.current = true
    return result as Dialogue
  }, [endpoint, onChanged])
  useEffect(() => {
    const controller = new AbortController()
    if (initial && !seeded.current) { seeded.current = true; setSelected(initial.participants.map(p => `${p.kind}:${p.personId}`)); setSelectionVersion(initial.version) }
    else void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Dialogen kunde inte hämtas.') })
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !running.current && !selectionDirty.current) void load(controller.signal).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Dialogen kunde inte hämtas.') })
    }, 20000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [initial, load])
  const dirty = Boolean(text || fileIds.length || confirmed || selectionDirty.current)
  useEffect(() => {
    if (!dirty && !busy) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, busy])
  useEffect(() => { onDirty?.(dirty) }, [onDirty, dirty])
  useEffect(() => () => { onDirty?.(false); onBusy?.(false) }, [onDirty, onBusy])
  const candidates = [...new Map([...people.map(p => [refKey(p), p] as const), ...(data?.participants || []).map(p => [`${p.kind}:${p.personId}`, { id: p.personId, kind: p.kind, name: p.name, email: p.email }] as const)].map(([k, p]) => [k, p])).values()]
  const required = (p: QuestionAssignee) => (p.kind === 'profile' && p.id === data?.managerId) || (p.kind === responsible?.kind && p.id === responsible.id)
  const chosen = candidates.filter(p => selected.includes(refKey(p)) || required(p))
  function select(p: QuestionAssignee, checked: boolean) {
    if (!selectionDirty.current && data) setSelectionVersion(data.version)
    selectionDirty.current = true; setConfirmed(false); setNotice('')
    setSelected(current => checked ? [...current, refKey(p)] : current.filter(key => key !== refKey(p)))
  }
  async function write(operation: 'participants' | 'share' | 'reply') {
    if (running.current || !data) return
    const payload = { operation, version: operation === 'participants' ? selectionVersion : data.version, text, participants: operation === 'participants' ? chosen.map(p => ({ id: p.id, kind: p.kind })) : [], fileIds: operation === 'participants' ? [] : fileIds, confirmed }
    const key = JSON.stringify(payload)
    if (!pending.current || pending.current.key !== key) pending.current = { key, id: crypto.randomUUID() }
    const requestId = pending.current.id
    running.current = true; setBusy(true); onBusy?.(true); setError(''); setNotice('')
    try {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, requestId }) }), result = await r.json()
      if (!r.ok) throw new Error(result.error || 'Sparningen kunde inte bekräftas.')
      if (result.messageId !== requestId || result.questionId !== data.questionId) throw new Error('Svaret kunde inte bekräftas. Dina uppgifter är kvar.')
      pending.current = null; selectionDirty.current = false; setText(''); setFileIds([]); setConfirmed(false)
      setNotice(operation === 'participants' ? 'Deltagarna är sparade.' : operation === 'share' ? 'Frågan är delad. Notifieringar ligger i utskickskön.' : 'Svaret är sparat. Frågans status är oförändrad.')
      onChanged?.()
      await load()
      if (operation === 'reply') bodyInput.current?.focus()
    } catch (e) { setError(e instanceof Error ? e.message : 'Sparningen misslyckades. Dina uppgifter är kvar.') }
    finally { running.current = false; setBusy(false); onBusy?.(false) }
  }
  const btn = 'gizmo-button', closed = data?.status === 'closed'
  const sharedFiles = files.filter(f => !f.isQuoteDocument)
  return <section className="gizmo-question-dialogue" aria-label={mode === 'participants' ? 'Deltagare i frågan' : 'Frågans dialog'}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3>{mode === 'participants' ? 'Deltagare' : 'Dialog'}</h3><button type="button" className={`${btn} gizmo-icon-button`} aria-label="Hämta dialog och deltagare" title="Hämta dialog och deltagare" disabled={busy || selectionDirty.current} onClick={() => void load().then(() => setError('')).catch(e => setError(e.message))}><RefreshCw size={16} /></button></div>
    {error && <p className="gizmo-question-error" role="alert">{error}</p>}{notice && <p className="gizmo-question-notice" role="status">{notice}</p>}
    {!data ? <p>{error ? 'Dialogen är inte tillgänglig.' : 'Hämtar…'}</p> : <>
      {mode === 'participants' ? <>
        {!data.managerId && <p className="gizmo-question-notice" role="status">Projektansvarig är inte utsedd.</p>}
        {data.canManage ? <fieldset disabled={busy} className="gizmo-question-participant-options"><legend className="sr-only">Välj deltagare i denna fråga</legend>{candidates.map(p => <label key={refKey(p)}><input type="checkbox" checked={selected.includes(refKey(p)) || required(p)} disabled={required(p)} onChange={e => select(p, e.target.checked)} /><span><strong>{p.name}</strong><small>{p.kind === 'customer' ? 'Beställare' : p.kind === 'profile' ? p.id === data.managerId ? 'Projektansvarig' : 'Intern' : 'Kontakt'}{p.email ? ` · ${p.email}` : ''}</small></span></label>)}</fieldset> : <ul className="gizmo-question-roster">{data.participants.map(p => <li key={p.id}>{p.name}</li>)}</ul>}
        {data.canManage && <div className="gizmo-question-commands"><button type="button" className={btn} disabled={busy || !selectionDirty.current} onClick={() => void write('participants')}><Save size={16} />Spara deltagare</button></div>}
        {data.canManage && <section className="gizmo-question-share"><h3>{data.sharedAt ? 'Uppdatera delad fråga' : 'Dela frågan'}</h3><h4>{preview?.title}</h4><p className="whitespace-pre-wrap">{preview?.description}</p>
          <p className="gizmo-secondary">Deltagare: {data.participants.map(p => p.name).join(', ')}</p>
          <fieldset disabled={busy || closed || selectionDirty.current}>
            <legend>Bilagor att dela</legend>{sharedFiles.map(f => <label key={f.id} className="gizmo-question-confirm"><input type="checkbox" checked={fileIds.includes(f.id)} disabled={!fileIds.includes(f.id) && fileIds.length >= 20} onChange={e => { setFileIds(current => e.target.checked ? [...current, f.id] : current.filter(id => id !== f.id)); setConfirmed(false) }} />{f.fileName}</label>)}
            <label className="gizmo-question-confirm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Jag har granskat frågan, bilagorna och deltagarna. Alla deltagare får läsa den delade dialogens historik.</label>
          </fieldset>
          <button type="button" className={`${btn} gizmo-question-primary`} disabled={busy || closed || selectionDirty.current || !confirmed} onClick={() => void write('share')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}{data.sharedAt ? 'Uppdatera och meddela deltagare' : 'Dela med deltagarna'}</button>
        </section>}
      </> : <>
        {data.snapshot && <section className="gizmo-question-shared-body"><h3>{data.snapshot.title}</h3><p className="whitespace-pre-wrap">{data.snapshot.description}</p></section>}
        <p className="gizmo-secondary">Deltagare: {data.participants.filter(p => p.shared || !publicView).map(p => p.name).join(', ')}</p>
        {!data.sharedAt && <p>Frågan är inte delad ännu.</p>}
        <ol className="gizmo-question-messages">{data.messages.map(m => <li key={m.id}><div className="gizmo-question-message-meta"><strong>{m.actorName}</strong><time dateTime={m.createdAt}>{formatTaskDateTime(m.createdAt, 'Europe/Stockholm', 'compact')}</time><span>{m.actorMethod === 'personal_link' ? 'Personlig länk' : 'Inloggad medarbetare'}</span></div>
          {m.operation === 'share' ? <details><summary>Frågan delades / uppdaterades</summary><strong>{m.snapshot?.title}</strong><p className="whitespace-pre-wrap">{m.snapshot?.description}</p></details> : <p className="whitespace-pre-wrap">{m.text}</p>}
          {m.files.map(f => <a key={f.id} className="gizmo-question-file-link" href={`${fileBase}/${f.id}`} target="_blank" rel="noreferrer"><ExternalLink size={16} />{f.name}</a>)}
        </li>)}</ol>
        {data.sharedAt && !closed && <fieldset disabled={busy}><label className="gizmo-question-answer-label">Svar till frågans deltagare<textarea ref={bodyInput} className="gizmo-question-field" rows={4} maxLength={12000} value={text} onChange={e => setText(e.target.value)} /></label>
          {!publicView && sharedFiles.length > 0 && <details className="gizmo-question-reply-files"><summary>Bifoga projektfil</summary>{sharedFiles.map(f => <label key={f.id} className="gizmo-question-confirm"><input type="checkbox" checked={fileIds.includes(f.id)} disabled={!fileIds.includes(f.id) && fileIds.length >= 20} onChange={e => setFileIds(current => e.target.checked ? [...current, f.id] : current.filter(id => id !== f.id))} />{f.fileName}</label>)}</details>}
          <div className="gizmo-question-commands"><button type="button" className={`${btn} gizmo-question-primary`} disabled={busy || !text.trim()} onClick={() => void write('reply')}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}Skicka svar</button></div>
        </fieldset>}
        {closed && <p className="gizmo-question-notice">Frågan är avslutad.</p>}
      </>}
      {!publicView && data.deliveries.some(d => ['failed', 'sending', 'pending'].includes(d.status)) && <details className="gizmo-question-delivery-status"><summary>Notifieringsstatus</summary><ul>{data.deliveries.map(d => <li key={d.id}>{d.name}: {({ sent: 'E-posttjänsten har tagit emot utskicket', pending: 'I kö', sending: 'Skickas', failed: 'Utskicket misslyckades', cancelled: 'Återkallad' } as Record<string, string>)[d.status] || d.status}</li>)}</ul></details>}
    </>}
  </section>
}
