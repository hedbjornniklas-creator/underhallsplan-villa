'use client'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { BESIKT_INVITE_MODULES, isInviteToken, type BesiktInviteModule } from '@/lib/besiktapp/invitationContracts'
import { PUBLIC_BESIKTAPP_CONTACT_EMAIL } from '@/lib/publicCompanyInfo'

type Preview = { email: string; fullName: string; organization: string; modules: BesiktInviteModule[]; accepted: boolean }
export default function BesiktInvitationAccept() {
  const [token, setToken] = useState('')
  const [preview, setPreview] = useState<Preview | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const inFlight = useRef(false)
  useEffect(() => {
    // A different invitation opened in the same tab must not retain the previous preview.
    const reloadInvitation = () => window.location.reload()
    window.addEventListener('hashchange', reloadInvitation)
    return () => window.removeEventListener('hashchange', reloadInvitation)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const value = new URLSearchParams(window.location.hash.slice(1)).get('invite')
      if (!isInviteToken(value)) { setError('Inbjudningslänken saknas eller är ogiltig. Öppna hela länken i mejlet.'); setLoading(false); return }
      setToken(value)
      try {
        const response = await fetch('/api/besiktapp/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'preview', token: value }), signal: controller.signal })
        const data = await response.json()
        if (!response.ok) throw new Error(data.error)
        const { data: auth } = await supabase.auth.getUser()
        if (!controller.signal.aborted) { setPreview(data); setEmail(auth.user?.email ?? null) }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Kunde inte läsa inbjudan.') }
      finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load(); return () => controller.abort()
  }, [])
  async function accept(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || !preview) return
    if (!email && mode === 'new' && password !== confirmPassword) { setError('Lösenorden matchar inte.'); return }
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (!email && mode === 'existing') {
        const auth = await supabase.auth.signInWithPassword({ email: preview.email, password })
        if (auth.error) throw new Error('Kunde inte logga in. Kontrollera lösenordet eller använd Glömt lösenordet.')
        setEmail(auth.data.user.email)
      }
      const response = await fetch('/api/besiktapp/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', token, ...(!email && mode === 'new' ? { password } : {}) }) })
      const result = await response.json()
      if (!response.ok) {
        if (['EXISTING_USER_LOGIN_REQUIRED', 'INVITE_ACCOUNT_CREATED'].includes(result.code)) setMode('existing')
        throw new Error(result.error)
      }
      if (result.createdUser) {
        const auth = await supabase.auth.signInWithPassword({ email: result.email, password })
        if (auth.error) { setMode('existing'); throw new Error('Tillgången är aktiverad. Logga in med ditt nya lösenord för att fortsätta.') }
        setEmail(auth.data.user.email)
      }
      setPassword(''); setConfirmPassword(''); setDone(true)
      window.history.replaceState(null, '', window.location.pathname)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Kunde inte aktivera tillgången.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  async function signOut() {
    if (inFlight.current) return
    const result = await supabase.auth.signOut()
    if (result.error) setError('Kunde inte logga ut. Försök igen.')
    else { setEmail(null); setPassword(''); setConfirmPassword(''); setError('') }
  }
  const mismatch = email && preview && email.toLowerCase() !== preview.email.toLowerCase()
  const destinations = { inspections: '/ob', construction_inspections: '/eb', technical_investigations: '/tu' }
  const destination = preview?.modules.length === 1 ? destinations[preview.modules[0]] : '/dashboard-v1'
  return (
    <section className="public-auth public-invitation">
      <span className="public-eyebrow">Inbjudan till BesiktApp</span>
      <h1>{done ? 'Din tillgång är aktiverad.' : 'Välkommen till BesiktApp'}</h1>
      {loading && <p role="status">Kontrollerar din inbjudan…</p>}
      {error && <p role="alert" className="public-notice public-notice-error">{error}</p>}
      {preview && !done && <>
        <p className="public-auth-intro">{preview.fullName}, du är inbjuden för {preview.organization}.</p>
        <ul>{preview.modules.map(key => <li key={key}>{BESIKT_INVITE_MODULES[key]}</li>)}</ul>
        <p className="public-field-hint">Inbjudan gäller {preview.email}. Du får inga administratörsbehörigheter.</p>
        {mismatch ? <div className="public-notice"><p>Du är inloggad som {email}. Byt till kontot som inbjudan gäller.</p><button type="button" className="public-text-link" onClick={() => void signOut()}>Logga ut och byt konto</button></div> : <form onSubmit={accept} className="public-form">
          {!email && <>
            <label>Välj hur du vill fortsätta<select disabled={busy} value={mode} onChange={event => { setMode(event.target.value as 'existing' | 'new'); setPassword(''); setConfirmPassword(''); setError('') }}><option value="existing">Jag har ett HusHub-konto</option><option value="new">Jag behöver ett nytt konto</option></select></label>
            <label>{mode === 'new' ? 'Välj lösenord (minst 12 tecken)' : 'Ditt lösenord'}<input type="password" required minLength={mode === 'new' ? 12 : 1} maxLength={128} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password} onChange={event => setPassword(event.target.value)} disabled={busy} /></label>
            {mode === 'new' && <label>Upprepa lösenordet<input type="password" required autoComplete="new-password" value={confirmPassword} onChange={event => setConfirmPassword(event.target.value)} disabled={busy} /></label>}
            {mode === 'existing' && <Link href="/login?next=%2Fdashboard-v1" target="_blank" rel="noopener noreferrer" className="public-text-link">Glömt lösenordet? Öppna inloggningssidan i en ny flik.</Link>}
          </>}
          {email && <p>Inloggad som {email}.</p>}
          <button disabled={busy} className="public-button">{busy ? 'Aktiverar…' : preview.accepted ? 'Öppna min tillgång' : 'Aktivera min tillgång'}</button>
        </form>}
      </>}
      {done && <><p className="public-auth-intro">Kontrollera dina profiluppgifter innan du skickar ditt första uppdrag eller utlåtande.</p><Link href={destination} className="public-button">Öppna BesiktApp</Link></>}
      <p className="public-field-hint">Behöver du hjälp? <a className="public-text-link" href={`mailto:${PUBLIC_BESIKTAPP_CONTACT_EMAIL}`}>{PUBLIC_BESIKTAPP_CONTACT_EMAIL}</a></p>
    </section>
  )
}
