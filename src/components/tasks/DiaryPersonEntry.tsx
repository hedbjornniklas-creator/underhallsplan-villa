'use client'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowLeftRight, Check, Loader2, Plus, X } from 'lucide-react'
import DiaryEntryForm from './DiaryEntryForm'
import { diaryPersonInput, diaryUuid, type DiaryPerson } from '@/lib/action-cases/projectDiary'

const subscribe = (listener: () => void) => { window.addEventListener('diary-person', listener); window.addEventListener('storage', listener); return () => { window.removeEventListener('diary-person', listener); window.removeEventListener('storage', listener) } }
function remembered(key: string) { try { const value = localStorage.getItem(key); return diaryUuid(value) ? value : null } catch { return null } }
function remember(key: string, id: string | null) { try { if (id) localStorage.setItem(key, id); else localStorage.removeItem(key); window.dispatchEvent(new Event('diary-person')) } catch { /* Selection also works without device storage. */ } }
const noSubscription = () => () => {}
const inBrowser = () => true
const onServer = () => false

export default function DiaryPersonEntry({ endpoint, projectId, people, items, cacheScope = 'qr', onSaved, onDirty }: {
  endpoint: string; projectId: string; people: DiaryPerson[]; items: { id: string; title: string }[]; cacheScope?: string
  onSaved?: () => void; onDirty?: (dirty: boolean) => void
}) {
  const key = `hh-diary-person:${projectId}:${cacheScope}`
  const saved = useSyncExternalStore(subscribe, useCallback(() => remembered(key), [key]), () => null)
  const hydrated = useSyncExternalStore(noSubscription, inBrowser, onServer)
  const firstSelection = useRef<{ id: string | null } | null>(null)
  if (hydrated && firstSelection.current === null) firstSelection.current = { id: saved }
  const [choice, setChoice] = useState<string | null | undefined>(), [added, setAdded] = useState<DiaryPerson[]>([])
  const [adding, setAdding] = useState(false), [name, setName] = useState(''), [company, setCompany] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [entryDirty, setEntryDirty] = useState(false), [entryWorking, setEntryWorking] = useState(false), [confirmSwitch, setConfirmSwitch] = useState(false)
  const running = useRef(false), selector = useRef<HTMLSelectElement>(null), nameInput = useRef<HTMLInputElement>(null)
  const all = [...new Map([...people, ...added].map(person => [person.id, person])).values()].sort((a,b) => a.name.localeCompare(b.name, 'sv') || a.company.localeCompare(b.company, 'sv'))
  const person = all.find(p => p.id === (choice === undefined ? firstSelection.current?.id : choice))
  const dirty = entryDirty || busy || (adding && Boolean(name || company))
  useEffect(() => { onDirty?.(dirty); return () => onDirty?.(false) }, [dirty, onDirty])
  useEffect(() => { if (adding) nameInput.current?.focus() }, [adding])
  function select(id: string) { setChoice(id); remember(key, id); setAdding(false); setName(''); setCompany(''); setError('') }
  function switchPerson() { setChoice(null); remember(key, null); setConfirmSwitch(false); setEntryDirty(false); requestAnimationFrame(() => selector.current?.focus()) }
  async function create() {
    if (running.current) return
    let payload
    try { payload = diaryPersonInput({ name, company }) } catch { setError('Ange namn och företag.'); return }
    running.current = true; setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'person', ...payload }) }), result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Personen kunde inte sparas. Försök igen med samma uppgifter.')
      if (!diaryUuid(result.id) || !result.name || !result.company) throw new Error('Personen kunde inte bekräftas. Försök igen med samma uppgifter.')
      setAdded(current => [...current.filter(p => p.id !== result.id), { id: result.id, name: result.name, company: result.company }]); select(result.id)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Personen kunde inte sparas.') }
    finally { running.current = false; setBusy(false) }
  }
  return <div className="diary-person-entry">
    {person ? <><div className="diary-identity"><div><strong>{person.name}</strong><span className="diary-person-company">{person.company}</span></div><button type="button" disabled={entryWorking} onClick={() => entryDirty ? setConfirmSwitch(true) : switchPerson()}><ArrowLeftRight size={17} />Byt person</button></div>
      {confirmSwitch && <div className="diary-notice" role="region" aria-label="Bekräfta personbyte"><p>Byt person med en påbörjad anteckning? Utkastet finns kvar för {person.name} på den här enheten.</p><div className="diary-confirm-actions"><button type="button" onClick={() => setConfirmSwitch(false)}><X size={16} />Avbryt</button><button type="button" onClick={switchPerson}><ArrowLeftRight size={16} />Byt person</button></div></div>}
      <DiaryEntryForm key={person.id} endpoint={endpoint} storageKey={`hh-diary-entry:${projectId}:${cacheScope}:${person.id}`} items={items} person={person} onDirty={setEntryDirty} onWorking={setEntryWorking} onSaved={onSaved} />
    </> : <section className="diary-person-picker" aria-label="Välj person"><h2>Vem skriver?</h2>
      <label>Person<select ref={selector} value="" disabled={busy} onChange={event => select(event.target.value)}><option value="" disabled>Välj person</option>{all.map(p => <option value={p.id} key={p.id}>{p.name} – {p.company}</option>)}</select></label>
      {!adding ? <button type="button" onClick={() => setAdding(true)}><Plus size={17} />Lägg till person</button> : <form aria-label="Lägg till person" onSubmit={event => { event.preventDefault(); void create() }}><div className="diary-form-grid"><label>Namn<input ref={nameInput} required maxLength={160} autoComplete="name" value={name} disabled={busy} onChange={e => setName(e.target.value)} /></label><label>Företag<input required maxLength={160} autoComplete="organization" value={company} disabled={busy} onChange={e => setCompany(e.target.value)} /></label></div>{error && <p className="diary-error" role="alert">{error}</p>}<div className="diary-confirm-actions"><button type="button" disabled={busy} onClick={() => { setAdding(false); setName(''); setCompany(''); setError('') }}><X size={16} />Avbryt</button><button type="submit" className="diary-primary" disabled={busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Check size={17} />}Spara och välj</button></div></form>}
    </section>}
  </div>
}
