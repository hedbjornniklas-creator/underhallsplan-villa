'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Building2, CheckCircle2, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

type InvitationPreview = {
  organizationName: string
  email: string
  fullName: string
  role: 'admin' | 'inspector'
  modules: string[]
  accepted: boolean
}
type PreviewResponse = { invitation: InvitationPreview; hasSession: boolean; requiresSignIn: boolean }
const STORAGE_KEY = 'hushub:organization-invitation'
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const moduleLabel = (key: string) => ({ technical_investigations: 'TU – teknisk utredning', inspections: 'ÖB – överlåtelsebesiktning', construction_inspections: 'EB – entreprenadbesiktning' })[key] ?? key
const loginHref = '/login?next=%2Forganisation%2Finbjudan'

export function invitationWorkspaceLinks(modules: string[], organizationId: string) {
  const query = `?orgId=${encodeURIComponent(organizationId)}`
  return [
    ...(modules.includes('inspections') ? [{ href: `/ob${query}`, label: 'Gå till ÖB' }] : []),
    ...(modules.includes('technical_investigations') ? [{ href: `/tu${query}`, label: 'Gå till TU' }] : []),
  ]
}

export default function OrganizationInvitationAccept() {
  const [token, setToken] = useState('')
  const [preview, setPreview] = useState<InvitationPreview | null>(null)
  const [email, setEmail] = useState<string | null>(null)
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [password, setPassword] = useState('')
  const [repeatPassword, setRepeatPassword] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [organizationId, setOrganizationId] = useState<string | null>(null)
  const [storageAvailable, setStorageAvailable] = useState(true)
  const inFlight = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    const onHashChange = () => window.location.reload()
    window.addEventListener('hashchange', onHashChange)
    async function load() {
      const fragment = new URLSearchParams(window.location.hash.slice(1))
      const fragmentToken = fragment.get('invite')
      let value: string | null = fragmentToken
      try {
        if (fragment.has('invite')) {
          if (validToken(fragmentToken)) sessionStorage.setItem(STORAGE_KEY, fragmentToken)
          else sessionStorage.removeItem(STORAGE_KEY)
        } else value = sessionStorage.getItem(STORAGE_KEY)
        if (validToken(value)) window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
      } catch { setStorageAvailable(false) }
      if (!validToken(value)) {
        setError('Inbjudningslänken saknas eller är ogiltig. Öppna hela länken i mejlet.'); setLoading(false); return
      }
      setToken(value)
      try {
        const response = await fetch('/api/organizations/invitations/accept', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
          body: JSON.stringify({ action: 'preview', token: value }), signal: controller.signal,
        })
        const result = await response.json().catch(() => ({})) as PreviewResponse & { error?: string }
        if (!response.ok || !result.invitation) throw new Error(result.error || 'Inbjudan kunde inte hämtas.')
        const auth = await supabase.auth.getUser()
        if (!controller.signal.aborted) { setPreview(result.invitation); setEmail(auth.data.user?.email ?? null) }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Inbjudan kunde inte hämtas.')
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => { controller.abort(); window.removeEventListener('hashchange', onHashChange) }
  }, [])

  async function accept(event: FormEvent) {
    event.preventDefault()
    if (!preview || inFlight.current || !validToken(token)) return
    if (!email && mode === 'new' && password !== repeatPassword) { setError('Lösenorden stämmer inte överens.'); return }
    inFlight.current = true; setBusy(true); setError('')
    try {
      if (!email && mode === 'existing') {
        const auth = await supabase.auth.signInWithPassword({ email: preview.email, password })
        if (auth.error) throw new Error('Inloggningen misslyckades. Kontrollera lösenordet eller välj Glömt lösenordet.')
        setEmail(auth.data.user?.email ?? null)
      }
      const response = await fetch('/api/organizations/invitations/accept', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', cache: 'no-store',
        body: JSON.stringify({ action: 'accept', token, ...(!email && mode === 'new' ? { password } : {}) }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.accepted !== true || typeof result.organizationId !== 'string') {
        if (['EXISTING_USER_LOGIN_REQUIRED', 'INVITE_ACCOUNT_CREATED'].includes(result.code)) setMode('existing')
        throw new Error(result.error || 'Inbjudan kunde inte accepteras.')
      }
      if (result.createdUser) {
        const auth = await supabase.auth.signInWithPassword({ email: result.email, password })
        if (auth.error) { setMode('existing'); throw new Error('Ditt medlemskap är aktiverat. Logga in med ditt nya lösenord för att fortsätta.') }
        setEmail(auth.data.user?.email ?? null)
      }
      setOrganizationId(result.organizationId); setPassword(''); setRepeatPassword('')
      try { sessionStorage.removeItem(STORAGE_KEY) } catch { /* A successful acceptance does not depend on browser storage. */ }
      window.history.replaceState(window.history.state, '', window.location.pathname)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Inbjudan kunde inte accepteras.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  async function signOut() {
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError('')
    try {
      const result = await supabase.auth.signOut({ scope: 'local' })
      if (result.error) throw new Error('Du kunde inte loggas ut. Försök igen.')
      setEmail(null); setPassword(''); setRepeatPassword('')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Du kunde inte loggas ut.') }
    finally { inFlight.current = false; setBusy(false) }
  }

  const mismatch = email && preview && email.toLowerCase() !== preview.email.toLowerCase()
  const workspaceLinks = organizationId ? invitationWorkspaceLinks(preview?.modules ?? [], organizationId) : []
  return <section className="public-auth public-invitation">
    <span className="public-eyebrow">Inbjudan till en organisation</span>
    <h1>{organizationId ? 'Välkommen till organisationen' : 'Arbeta tillsammans i HusHub'}</h1>
    {loading && <p role="status">Kontrollerar din inbjudan…</p>}
    {error && <p role="alert" className="public-notice public-notice-error">{error}</p>}
    {preview && <div className="my-5 rounded-2xl border border-slate-200 bg-slate-50 p-5">
      <p className="flex items-center gap-2 text-lg font-semibold text-slate-950"><Building2 size={20} aria-hidden />{preview.organizationName}</p>
      <p className="mt-2 text-sm text-slate-600">Inbjudan gäller {preview.fullName}, {preview.email}.</p>
      <p className="mt-3 flex items-center gap-1.5 text-sm font-medium text-indigo-700"><ShieldCheck size={16} aria-hidden />{preview.role === 'admin' ? 'Organisationsadministratör' : 'Medlem / besiktningsman'}</p>
      <ul className="mt-2 text-sm text-slate-600">{preview.modules.map(module => <li key={module}>{moduleLabel(module)}</li>)}</ul>
    </div>}
    {preview && !organizationId && <>
      <p className="public-auth-intro">Ditt HusHub-konto kan användas i flera organisationer. Använd ditt befintliga konto om det har samma inloggningsmejl som inbjudan. Dina andra medlemskap och roller finns kvar.</p>
      {preview.role === 'admin' && <p className="public-field-hint">Som organisationsadministratör kan du ändra företagets uppgifter, hantera integrationer och administrera medlemmar här.</p>}
      {mismatch ? <div className="public-notice"><p>Du är inloggad som {email}. Inbjudan gäller {preview.email}.</p><button type="button" disabled={busy} onClick={() => void signOut()} className="public-text-link">Logga ut och byt konto</button></div> : <form onSubmit={accept} className="public-form">
        {!email && <>
          <label>Hur vill du fortsätta?<select value={mode} disabled={busy} onChange={event => { setMode(event.target.value as 'existing' | 'new'); setPassword(''); setRepeatPassword(''); setError('') }}><option value="existing">Jag har redan ett HusHub-konto</option><option value="new">Jag behöver ett nytt konto</option></select></label>
          <label>{mode === 'new' ? 'Välj lösenord (minst 12 tecken)' : 'Ditt lösenord'}<input type="password" required minLength={mode === 'new' ? 12 : 1} maxLength={128} autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
          {mode === 'new' && <label>Upprepa lösenordet<input type="password" required minLength={12} maxLength={128} autoComplete="new-password" value={repeatPassword} disabled={busy} onChange={event => setRepeatPassword(event.target.value)} /></label>}
          {mode === 'existing' && <><Link href={loginHref} className="public-text-link">Glömt lösenordet? Öppna inloggningssidan.</Link><p className="public-field-hint">Efter lösenordsåterställningen: öppna inbjudningslänken i mejlet igen.</p></>}
          {!storageAvailable && <p className="public-field-hint">Webbläsaren kan inte spara inbjudan mellan sidor. Öppna länken från mejlet igen efter inloggning.</p>}
        </>}
        {email && <p className="public-field-hint">Inloggad som {email}.</p>}
        <button type="submit" disabled={busy} className="public-button">{busy ? 'Aktiverar medlemskapet…' : preview.accepted ? 'Öppna mitt medlemskap' : 'Acceptera inbjudan'}</button>
      </form>}
    </>}
    {organizationId && <><p role="status" className="public-notice"><CheckCircle2 className="mb-2 text-emerald-700" size={24} aria-hidden />Ditt medlemskap i {preview?.organizationName} är aktivt. Fyll i dina kontaktuppgifter, profilbild och underskrift under Min profil.</p><Link href={`/settings/profil?orgId=${encodeURIComponent(organizationId)}`} className="public-button">Öppna min profil</Link>{workspaceLinks.map(link => <Link key={link.href} href={link.href} className="public-text-link">{link.label}</Link>)}{workspaceLinks.length === 0 && <Link href={`/settings/organisation?orgId=${encodeURIComponent(organizationId)}`} className="public-text-link">Öppna organisationen</Link>}</>}
  </section>
}
