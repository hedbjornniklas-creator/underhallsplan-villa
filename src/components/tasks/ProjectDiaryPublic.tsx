'use client'
import { useRef, useState } from 'react'
import { Loader2, LogOut, Mail, RotateCcw } from 'lucide-react'
import UppdragBrand from './UppdragBrand'
import DiaryEntryForm from './DiaryEntryForm'
import type { DiaryPublicState } from '@/lib/action-cases/projectDiary'
import './project-diary.css'

export default function ProjectDiaryPublic({ token, initial }: { token: string; initial: DiaryPublicState }) {
  const [data, setData] = useState(initial), [phase, setPhase] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState(''), [code, setCode] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false)
  const [retryAt, setRetryAt] = useState(0), [remaining, setRemaining] = useState<number | null>(null)
  const running = useRef(false), codeInput = useRef<HTMLInputElement>(null)
  const endpoint = `/api/dagbok/${token}`
  async function authenticate(operation: 'request_code' | 'verify_code') {
    if (running.current) return
    if (operation === 'request_code' && Date.now() < retryAt) { setError('Vänta en minut mellan kodutskicken.'); return }
    running.current = true; setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(operation === 'request_code' ? { operation, email } : { operation, code }) })
      const result = await response.json()
      if (!response.ok) { if (typeof result.attemptsRemaining === 'number') setRemaining(result.attemptsRemaining); throw new Error(result.error || 'Mejladressen kunde inte verifieras.') }
      if (operation === 'request_code') { setPhase('code'); setRetryAt(Date.now() + 60000); setRemaining(5); setCode(''); requestAnimationFrame(() => codeInput.current?.focus()) }
      else { if (!result.session?.email || result.project?.id !== data.project.id) throw new Error('Verifieringen kunde inte bekräftas.'); setData(result); setCode('') }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Verifieringen kunde inte bekräftas. Försök igen.') }
    finally { running.current = false; setBusy(false) }
  }
  async function logout() {
    if (running.current || (dirty && !window.confirm('Logga ut med ett påbörjat utkast? Utkastet ligger kvar på denna enhet tills det skickas.'))) return
    running.current = true; setBusy(true); setError('')
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'logout' }) })
      if (!response.ok) throw new Error('Utloggningen kunde inte bekräftas. Försök igen.')
      setData(current => ({ ...current, session: null, items: [] })); setPhase('email'); setEmail(''); setCode(''); setDirty(false)
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Utloggningen kunde inte bekräftas.') }
    finally { running.current = false; setBusy(false) }
  }
  return <main className="uppdrag-scope diary-public"><header className="diary-public-header"><UppdragBrand /><div><p className="diary-eyebrow">Dagbok</p><h1>{data.project.title}</h1></div></header>
    {data.session ? <><div className="diary-identity"><span>Verifierad mejl · {data.session.email}</span><button type="button" disabled={busy} onClick={() => void logout()}><LogOut size={17} />Logga ut</button></div><DiaryEntryForm key={`${data.project.id}:${data.session.email}`} endpoint={endpoint} storageKey={`hh-diary:${data.project.id}:${data.session.email}`} authorName={data.session.name} company={data.session.company} items={data.items} onDirty={setDirty} onSessionExpired={() => { setData(current => ({ ...current, session: null, items: [] })); setPhase('email'); setEmail(data.session?.email || '') }} /></>
      : <section className="diary-auth"><h2>{phase === 'email' ? 'Verifiera din mejladress' : 'Ange koden från mejlet'}</h2><form onSubmit={event => { event.preventDefault(); void authenticate(phase === 'email' ? 'request_code' : 'verify_code') }}>
        <label>Mejladress<input type="email" required autoComplete="email" maxLength={254} value={email} disabled={busy || phase === 'code'} onChange={e => setEmail(e.target.value)} /></label>
        {phase === 'code' && <><label>Engångskod<input ref={codeInput} required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} disabled={busy} onChange={e => setCode(e.target.value.replace(/\D/g, ''))} /></label>{remaining !== null && <p className="diary-muted">{remaining} försök kvar · Koden gäller i 10 minuter</p>}</>}
        <button className="diary-primary" type="submit" disabled={busy}>{busy ? <Loader2 size={18} className="animate-spin" /> : <Mail size={18} />}{phase === 'email' ? 'Skicka mejlkod' : 'Verifiera kod'}</button>
        {phase === 'code' && <div className="diary-auth-actions"><button type="button" disabled={busy} onClick={() => void authenticate('request_code')}><RotateCcw size={16} />Skicka ny kod</button><button type="button" disabled={busy} onClick={() => { setPhase('email'); setCode(''); setError('') }}>Byt mejladress</button></div>}
      </form></section>}
    {error && <p role="alert" className="diary-error">{error}</p>}
  </main>
}
