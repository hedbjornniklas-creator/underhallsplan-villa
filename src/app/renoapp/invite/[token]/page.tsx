'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CheckCircle2, Mail, Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import {
  RENOAPP_BRF_TERMS_DOWNLOAD_URL,
  RENOAPP_BRF_TERMS_SUMMARY,
  RENOAPP_BRF_TERMS_TITLE,
  RENOAPP_BRF_TERMS_VERSION,
} from '@/lib/renoapp/brfTerms'

type InvitePreview = {
  mode: 'brf_onboarding' | 'member_invite'
  state: 'open' | 'expired' | 'revoked' | 'accepted'
  invite: {
    email: string
    fullName: string | null
    role: 'board'
    kind: 'brf_activation' | 'member_access'
    expiresAt: string
    acceptedAt: string | null
    revokedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
    orgNumber: string | null
    propertyDesignation: string | null
    address: string | null
    addressLine2: string | null
    postalCode: string | null
    city: string | null
    invoiceAddress: string | null
    invoiceEmail: string | null
    invoiceReference: string | null
    primaryContactName: string | null
    primaryContactEmail: string | null
    primaryContactPhone: string | null
    unitCount: number | null
    generalEmail: string | null
    brfPhone: string | null
    technicalContact: string | null
    onboardingComment: string | null
    onboardingCompletedAt: string | null
    isPublicApplyEnabled: boolean
    isPublicApplyListed: boolean
  }
  currentUser: { email: string | null; matchesInvite: boolean }
}

type UserState = { name: string; email: string }
type PortalInviteResult = { email: string; emailSent: boolean; emailError: string | null }
type FormState = {
  name: string
  orgNumber: string
  propertyDesignation: string
  address: string
  addressLine2: string
  postalCode: string
  city: string
  invoiceAddress: string
  invoiceEmail: string
  invoiceReference: string
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string
  unitCount: string
  generalEmail: string
  brfPhone: string
  technicalContact: string
  publicApplyMode: 'listed' | 'direct_link'
}

type InputFieldProps = {
  label: string
  required?: boolean
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  type?: string
  readOnly?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  autoComplete?: string
  helperText?: string
  className?: string
}

const EMPTY_FORM: FormState = {
  name: '', orgNumber: '', propertyDesignation: '', address: '', addressLine2: '', postalCode: '', city: '',
  invoiceAddress: '', invoiceEmail: '', invoiceReference: '', primaryContactName: '', primaryContactEmail: '',
  primaryContactPhone: '', unitCount: '', generalEmail: '', brfPhone: '', technicalContact: '', publicApplyMode: 'direct_link',
}
const EMPTY_USER: UserState = { name: '', email: '' }
const MAX_ADDITIONAL_USERS = 3
const INPUT_CLASS = 'w-full rounded-md border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-950 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100'

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('sv-SE')
}

function toFormState(payload: InvitePreview): FormState {
  const generalEmail = payload.brf.generalEmail && payload.brf.generalEmail !== payload.invite.email ? payload.brf.generalEmail : ''
  return {
    name: payload.brf.name ?? '', orgNumber: payload.brf.orgNumber ?? '',
    propertyDesignation: payload.brf.propertyDesignation ?? '', address: payload.brf.address ?? '',
    addressLine2: payload.brf.addressLine2 ?? '', postalCode: payload.brf.postalCode ?? '', city: payload.brf.city ?? '',
    invoiceAddress: payload.brf.invoiceAddress ?? payload.brf.address ?? '', invoiceEmail: payload.brf.invoiceEmail ?? '',
    invoiceReference: payload.brf.invoiceReference ?? '', primaryContactName: payload.brf.primaryContactName ?? '',
    primaryContactEmail: payload.brf.primaryContactEmail ?? payload.invite.email,
    primaryContactPhone: payload.brf.primaryContactPhone ?? '', unitCount: payload.brf.unitCount ? String(payload.brf.unitCount) : '',
    generalEmail, brfPhone: payload.brf.brfPhone ?? '', technicalContact: payload.brf.technicalContact ?? '',
    publicApplyMode: payload.brf.isPublicApplyListed ? 'listed' : 'direct_link',
  }
}

function FieldLabel({ label, required = false }: { label: string; required?: boolean }) {
  return <span className="mb-1.5 block text-sm font-semibold text-stone-800">{label}{required ? ' *' : ''}</span>
}

function InputField({ label, required = false, value, onChange, placeholder, type = 'text', readOnly = false,
  inputMode, autoComplete, helperText, className = '' }: InputFieldProps) {
  return (
    <label className={`block min-w-0 ${className}`.trim()}>
      <FieldLabel label={label} required={required} />
      <input value={value} onChange={onChange ? event => onChange(event.target.value) : undefined}
        className={`${INPUT_CLASS} ${readOnly ? 'bg-stone-100 text-stone-600' : ''}`} placeholder={placeholder}
        type={type} required={required} readOnly={readOnly} inputMode={inputMode} autoComplete={autoComplete} />
      {helperText ? <span className="mt-1.5 block text-xs leading-5 text-stone-600">{helperText}</span> : null}
    </label>
  )
}

function StepHeading({ number, title, description }: { number: number; title: string; description: string }) {
  return <div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800">Steg {number}</p>
    <h2 className="mt-2 text-xl font-semibold text-stone-950 sm:text-2xl">{title}</h2>
    <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{description}</p></div>
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 border-l-2 border-stone-200 pl-3">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">{label}</p>
    <p className="mt-1 break-words text-sm text-stone-800">{value}</p></div>
}

export default function RenoAppInvitePage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [payload, setPayload] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [firstUser, setFirstUser] = useState<UserState>(EMPTY_USER)
  const [additionalUsers, setAdditionalUsers] = useState<UserState[]>([])
  const [password, setPassword] = useState('')
  const [signatoryName, setSignatoryName] = useState('')
  const [signatoryRole, setSignatoryRole] = useState('')
  const [signatoryAuthorityConfirmed, setSignatoryAuthorityConfirmed] = useState(false)
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [requiresManualLogin, setRequiresManualLogin] = useState(false)
  const [completionWarnings, setCompletionWarnings] = useState<string[]>([])
  const [portalInviteResults, setPortalInviteResults] = useState<PortalInviteResult[]>([])
  const loginHref = `/renoapp/login?next=${encodeURIComponent(`/renoapp/invite/${token}`)}`

  useEffect(() => {
    let active = true
    const loadInvite = async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/renoapp/invites/${token}`, { cache: 'no-store' })
        const data = (await response.json().catch(() => ({}))) as InvitePreview & { error?: string }
        if (!response.ok) throw new Error(data.error ?? 'Kunde inte läsa inbjudan.')
        if (!active) return
        setPayload(data)
        setForm(toFormState(data))
        setFirstUser({ name: data.invite.fullName ?? data.brf.primaryContactName ?? '', email: data.invite.email })
        setSignatoryName(data.brf.primaryContactName ?? data.invite.fullName ?? '')
        setAdditionalUsers([])
        setPassword('')
        setTermsAccepted(false)
        setSignatoryAuthorityConfirmed(false)
        if (data.mode === 'member_invite') {
          try {
            const saved = JSON.parse(sessionStorage.getItem(`renoapp-invite-user:${token}`) ?? 'null')
            if (data.state === 'open' && saved?.email === data.invite.email && Date.now() - saved.savedAt < 30 * 60 * 1000) {
              if (typeof saved.name === 'string') setFirstUser({ name: saved.name, email: data.invite.email })
            } else sessionStorage.removeItem(`renoapp-invite-user:${token}`)
          } catch { /* Session storage may be unavailable in private browsing. */ }
        }
      } catch (fetchError) {
        if (active) setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa inbjudan.')
      } finally { if (active) setLoading(false) }
    }
    if (token) void loadInvite()
    else { setLoading(false); setError('Ogiltig inbjudningslänk.') }
    return () => { active = false }
  }, [token])

  const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => setForm(current => ({ ...current, [field]: value }))
  const updateAdditionalUser = (index: number, field: keyof UserState, value: string) => setAdditionalUsers(current =>
    current.map((user, currentIndex) => currentIndex === index ? { ...user, [field]: value } : user))
  const saveBeforeLogin = () => {
    try { sessionStorage.setItem(`renoapp-invite-user:${token}`, JSON.stringify({ name: firstUser.name, email: payload?.invite.email, savedAt: Date.now() })) }
    catch { /* The login flow still works without session storage. */ }
  }
  const handleSignOut = async (redirectToLogin = false) => {
    setSigningOut(true)
    if (redirectToLogin) saveBeforeLogin()
    try {
      await supabase.auth.signOut()
      if (redirectToLogin) router.replace(loginHref)
      else window.location.reload()
    } finally { setSigningOut(false) }
  }
  const openBrf = async () => {
    if (!payload) return
    const response = await fetch('/api/renoapp/app/active-brf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ brfId: payload.brf.id }) })
    if (response.status === 401) { router.replace(loginHref); return }
    if (!response.ok) { setCompletionWarnings(['Ditt konto har inte åtkomst till föreningen. Kontakta HusHub för hjälp.']); return }
    router.replace('/renoapp/app')
    router.refresh()
  }
  const handleAccept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!payload) return
    if (payload.mode === 'brf_onboarding' && !termsAccepted) {
      setActionError(`Du måste godkänna villkoren (version ${RENOAPP_BRF_TERMS_VERSION}) för att fortsätta.`); return
    }
    if (payload.mode === 'brf_onboarding' && !signatoryAuthorityConfirmed) {
      setActionError('Bekräfta att du har rätt att aktivera RenoApp för föreningen.'); return
    }
    setSubmitting(true); setActionError(null); setRequiresManualLogin(false); setCompletionWarnings([])
    try {
      const response = await fetch(`/api/renoapp/invites/${token}/accept`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, inviteUserName: firstUser.name, inviteUserEmail: firstUser.email,
          additionalUsers, password, signatoryName, signatoryRole, signatoryAuthorityConfirmed,
          termsAccepted, termsVersion: RENOAPP_BRF_TERMS_VERSION }),
      })
      const result = (await response.json().catch(() => ({}))) as { createdUser?: boolean; signInEmail?: string; error?: string;
        additionalInviteWarnings?: string[]; portalInvites?: PortalInviteResult[] }
      if (!response.ok) {
        const message = result.error ?? (payload.mode === 'member_invite' ? 'Kunde inte acceptera inbjudan.' : 'Kunde inte aktivera föreningen.')
        if (response.status === 409 && message.includes('Logga in först')) setRequiresManualLogin(true)
        throw new Error(message)
      }
      try { sessionStorage.removeItem(`renoapp-invite-user:${token}`) } catch {}
      setPayload(current => current ? { ...current, state: 'accepted' } : current)
      setPassword('')
      if (payload.mode === 'brf_onboarding') {
        setPortalInviteResults(result.portalInvites ?? [])
        setCompletionWarnings(result.additionalInviteWarnings ?? [])
        return
      }
      if (result.createdUser && result.signInEmail) {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: result.signInEmail, password })
        if (signInError) {
          setCompletionWarnings(['Kontot och åtkomsten är klara, men automatisk inloggning misslyckades. Logga in för att öppna RenoApp.'])
          return
        }
        setPayload(current => current ? { ...current, currentUser: { email: result.signInEmail ?? null, matchesInvite: true } } : current)
      }
      await openBrf().catch(() => setCompletionWarnings(['Åtkomsten är klar, men föreningen kunde inte öppnas. Försök igen.']))
    } catch (submitError) { setActionError(submitError instanceof Error ? submitError.message : 'Kunde inte slutföra åtgärden.') }
    finally { setSubmitting(false) }
  }

  if (loading) return <main className="mx-auto min-h-screen max-w-6xl px-6 py-14">Laddar inbjudan...</main>
  if (error || !payload) return <main className="mx-auto min-h-screen max-w-5xl px-6 py-14"><div className="rounded-md border border-rose-200 bg-rose-50 p-6 text-rose-900">{error ?? 'Inbjudan hittades inte.'}</div></main>

  const isActivation = payload.mode === 'brf_onboarding'
  const wrongMemberAccount = !isActivation && payload.currentUser.email !== null && !payload.currentUser.matchesInvite
  const needsPassword = !isActivation && !payload.currentUser.matchesInvite

  return <main className="min-h-screen bg-stone-50 px-4 py-8 text-stone-950 sm:px-6 sm:py-10"><div className="mx-auto max-w-5xl">
    <header className="border-b border-stone-200 bg-white px-5 py-6 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-4"><div>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-stone-500">RenoApp</p>
        <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{isActivation ? `Aktivera ${payload.brf.name} i RenoApp` : `Tillgång till ${payload.brf.name}`}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">{isActivation
          ? 'Aktiveringslänken gäller föreningen. Du behöver inte vara inloggad för att slutföra uppgifterna och välja användare.'
          : 'Den här personliga inbjudan ger dig tillgång till föreningens styrelseportal.'}</p>
      </div>{!isActivation && payload.currentUser.email ? <button type="button" onClick={() => void handleSignOut(false)} disabled={signingOut}
        className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-50 disabled:opacity-50">{signingOut ? 'Loggar ut...' : 'Logga ut'}</button> : null}</div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3"><SummaryItem label="Förening" value={payload.brf.name} />
        <SummaryItem label={isActivation ? 'Aktiveringslänk skickad till' : 'Personlig e-post'} value={payload.invite.email} />
        <SummaryItem label="Giltig till" value={formatDateTime(payload.invite.expiresAt)} /></div>
    </header>

    <section className="bg-white px-5 py-7 sm:px-8 sm:py-9">
      {payload.state === 'expired' || payload.state === 'revoked' ?
        <div className="rounded-md border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">Den här länken är inte längre aktiv. Kontakta HusHub eller föreningens administratör för att få en ny länk.</div>
      : payload.state === 'accepted' && isActivation ?
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
          <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 shrink-0" size={21} /><div><h2 className="font-semibold">Föreningen är aktiverad</h2>
            <p className="mt-1 text-sm leading-6">De valda användarna får var sin personlig inbjudan. Där loggar de in med ett befintligt HusHub-konto eller skapar en ny inloggning.</p></div></div>
          {portalInviteResults.length > 0 ? <ul className="mt-5 divide-y divide-emerald-200 border-y border-emerald-200">{portalInviteResults.map(invite =>
            <li key={invite.email} className="flex items-center justify-between gap-4 py-3 text-sm"><span className="min-w-0 break-all">{invite.email}</span>
              <span className={`inline-flex shrink-0 items-center gap-1.5 font-medium ${invite.emailSent ? 'text-emerald-900' : 'text-amber-900'}`}><Mail size={15} />{invite.emailSent ? 'Inbjudan skickad' : 'Behöver skickas om'}</span></li>)}</ul> : null}
          <p className="mt-4 text-sm leading-6">Fler användare kan läggas till och tas bort senare under Användare i styrelseportalen.</p>
          {completionWarnings.length > 0 ? <div role="status" className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{completionWarnings.join(' ')} Kontakta HusHub om inbjudan behöver skickas om.</div> : null}
        </div>
      : wrongMemberAccount ?
        <div className="rounded-md border border-amber-300 bg-amber-50 p-5 text-sm text-amber-950"><p className="font-semibold">Du är inloggad med fel konto</p>
          <p className="mt-2 leading-6">Inbjudan gäller {payload.invite.email}, men du är inloggad som {payload.currentUser.email}.</p>
          <button type="button" onClick={() => void handleSignOut(true)} disabled={signingOut} className="mt-4 rounded-md bg-stone-950 px-4 py-2.5 font-semibold text-white hover:bg-stone-800 disabled:opacity-50">{signingOut ? 'Byter konto...' : 'Byt konto'}</button></div>
      : payload.state === 'accepted' ?
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-950"><p className="font-semibold">Inbjudan har accepterats</p>
          <p className="mt-1 leading-6">Ditt konto är kopplat till {payload.brf.name}.</p><div className="mt-4">{payload.currentUser.matchesInvite
            ? <button type="button" onClick={() => void openBrf()} className="rounded-md bg-stone-950 px-4 py-2.5 font-semibold text-white hover:bg-stone-800">Öppna RenoApp</button>
            : <Link href={loginHref} className="rounded-md bg-stone-950 px-4 py-2.5 font-semibold text-white hover:bg-stone-800">Logga in</Link>}</div>
          {completionWarnings.length > 0 ? <p role="status" className="mt-4 text-amber-950">{completionWarnings.join(' ')}</p> : null}</div>
      : <form onSubmit={handleAccept} className="space-y-10">
        {isActivation ? <>
          <section className="space-y-6"><StepHeading number={1} title="Föreningens uppgifter" description="Kontrollera uppgifterna som ska användas i RenoApp och vid fakturering." />
            <div className="grid gap-4 sm:grid-cols-2">
              <InputField label="Föreningens namn" required value={form.name} onChange={value => updateField('name', value)} />
              <InputField label="Organisationsnummer" required value={form.orgNumber} onChange={value => updateField('orgNumber', value)} placeholder="XXXXXX-XXXX" />
              <InputField label="Fastighetsbeteckning" required value={form.propertyDesignation} onChange={value => updateField('propertyDesignation', value)} className="sm:col-span-2" />
              <InputField label="Gatuadress" required value={form.address} onChange={value => updateField('address', value)} className="sm:col-span-2" />
              <InputField label="Adressrad 2" value={form.addressLine2} onChange={value => updateField('addressLine2', value)} className="sm:col-span-2" />
              <InputField label="Postnummer" required value={form.postalCode} onChange={value => updateField('postalCode', value)} inputMode="numeric" placeholder="123 45" />
              <InputField label="Ort" required value={form.city} onChange={value => updateField('city', value)} />
            </div>
            <div><h3 className="text-sm font-semibold">Kontakt och fakturering</h3><div className="mt-4 grid gap-4 sm:grid-cols-2">
              <InputField label="Kontaktperson" required value={form.primaryContactName} onChange={value => updateField('primaryContactName', value)} autoComplete="name" />
              <InputField label="Kontaktpersonens e-post" required value={form.primaryContactEmail} onChange={value => updateField('primaryContactEmail', value)} type="email" autoComplete="email" />
              <InputField label="Kontaktpersonens telefon" required value={form.primaryContactPhone} onChange={value => updateField('primaryContactPhone', value)} type="tel" autoComplete="tel" />
              <InputField label="Faktura-e-post" required value={form.invoiceEmail} onChange={value => updateField('invoiceEmail', value)} type="email" />
              <InputField label="Fakturaadress" required value={form.invoiceAddress} onChange={value => updateField('invoiceAddress', value)} className="sm:col-span-2" />
            </div></div>
            <details className="rounded-md border border-stone-200 px-4 py-3"><summary className="cursor-pointer text-sm font-semibold text-stone-800">Fler föreningsuppgifter</summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2"><InputField label="Föreningens allmänna e-post" value={form.generalEmail} onChange={value => updateField('generalEmail', value)} type="email" />
                <InputField label="Föreningens telefon" value={form.brfPhone} onChange={value => updateField('brfPhone', value)} type="tel" />
                <InputField label="Fakturareferens" value={form.invoiceReference} onChange={value => updateField('invoiceReference', value)} />
                <InputField label="Antal lägenheter" value={form.unitCount} onChange={value => updateField('unitCount', value)} inputMode="numeric" />
                <InputField label="Teknisk förvaltare eller extern kontakt" value={form.technicalContact} onChange={value => updateField('technicalContact', value)} className="sm:col-span-2" /></div>
            </details>
          </section>

          <section className="border-t border-stone-200 pt-9"><StepHeading number={2} title="Ansökningssida för boende" description="Välj hur boende ska hitta föreningens renoveringsansökan." />
            <fieldset className="mt-5 grid gap-3 sm:grid-cols-2"><legend className="sr-only">Tillgång till ansökningssidan</legend>{([
              ['listed', 'Publikt sökbar', 'Föreningen visas när boende söker på RenoApps ansökningssida.'],
              ['direct_link', 'Endast direktlänk', 'Föreningen visas inte i sökningen. Styrelsen delar ansökningslänken med boende.'],
            ] as const).map(([value, title, description]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${form.publicApplyMode === value ? 'border-emerald-700 bg-emerald-50' : 'border-stone-300'}`}>
              <input type="radio" name="publicApplyMode" checked={form.publicApplyMode === value} onChange={() => updateField('publicApplyMode', value)} className="mt-1 h-4 w-4 accent-emerald-800" />
              <span><span className="block text-sm font-semibold">{title}</span><span className="mt-1 block text-sm leading-6 text-stone-600">{description}</span></span></label>)}</fieldset>
          </section>

          <section className="border-t border-stone-200 pt-9"><StepHeading number={3} title="Användare i styrelseportalen" description="Lägg till minst en person. Varje person får en egen länk och ska använda ett personligt konto." />
            <div className="mt-5 rounded-md border border-sky-200 bg-sky-50 p-4 text-sm leading-6 text-sky-950">Ett befintligt HusHub-konto återanvänds. Den som saknar konto skapar sin inloggning via den personliga länken. Användare kan läggas till och tas bort senare i styrelseportalen.</div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><InputField label="Första användarens namn" required value={firstUser.name} onChange={value => setFirstUser(current => ({ ...current, name: value }))} autoComplete="name" />
              <InputField label="Första användarens e-post" required value={firstUser.email} onChange={value => setFirstUser(current => ({ ...current, email: value }))} type="email" autoComplete="email" /></div>
            <div className="mt-4 space-y-4">{additionalUsers.map((user, index) => <div key={`additional-user-${index}`} className="grid gap-4 rounded-md border border-stone-200 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <InputField label={`Användare ${index + 2}, namn`} required value={user.name} onChange={value => updateAdditionalUser(index, 'name', value)} />
              <InputField label={`Användare ${index + 2}, e-post`} required value={user.email} onChange={value => updateAdditionalUser(index, 'email', value)} type="email" />
              <div className="flex items-end"><button type="button" onClick={() => setAdditionalUsers(current => current.filter((_, currentIndex) => currentIndex !== index))}
                className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100" title="Ta bort användare" aria-label={`Ta bort användare ${index + 2}`}><Trash2 size={17} /></button></div></div>)}</div>
            <button type="button" onClick={() => setAdditionalUsers(current => current.length < MAX_ADDITIONAL_USERS ? [...current, { ...EMPTY_USER }] : current)} disabled={additionalUsers.length >= MAX_ADDITIONAL_USERS}
              className="mt-4 inline-flex items-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={16} /> Lägg till användare</button>
          </section>

          <section className="border-t border-stone-200 pt-9"><StepHeading number={4} title="Villkor och aktivering" description="Föreningens behöriga företrädare ska läsa villkoren och godkänna aktiveringen." />
            <div className="mt-5 rounded-md border border-stone-200 p-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-semibold">{RENOAPP_BRF_TERMS_TITLE}</p><p className="mt-1 text-xs text-stone-600">Version {RENOAPP_BRF_TERMS_VERSION}</p></div>
              <a href={RENOAPP_BRF_TERMS_DOWNLOAD_URL} target="_blank" rel="noreferrer" className="rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold hover:bg-stone-50">Läs fullständiga villkor</a></div>
              <ul className="mt-4 space-y-2 text-sm leading-6 text-stone-700">{RENOAPP_BRF_TERMS_SUMMARY.map(item => <li key={item} className="flex gap-2"><span aria-hidden="true">•</span><span>{item}</span></li>)}</ul></div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><InputField label="Namn på föreningens företrädare" required value={signatoryName} onChange={setSignatoryName} autoComplete="name" />
              <InputField label="Roll i föreningen" required value={signatoryRole} onChange={setSignatoryRole} placeholder="Exempel: styrelseordförande" /></div>
            <div className="mt-5 space-y-3"><label className="flex items-start gap-3 rounded-md border border-stone-200 p-4 text-sm leading-6"><input type="checkbox" checked={signatoryAuthorityConfirmed} onChange={event => setSignatoryAuthorityConfirmed(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-800" />
              <span>Jag bekräftar att jag har rätt att företräda föreningen eller har fått uppdrag att aktivera RenoApp för föreningens räkning.</span></label>
              <label className="flex items-start gap-3 rounded-md border border-stone-200 p-4 text-sm leading-6"><input type="checkbox" checked={termsAccepted} onChange={event => setTermsAccepted(event.target.checked)} className="mt-1 h-4 w-4 accent-emerald-800" />
                <span>Jag har läst och godkänner villkoren för RenoApp, version {RENOAPP_BRF_TERMS_VERSION}, för föreningens räkning.</span></label></div>
          </section>
        </> : <section><h2 className="text-xl font-semibold sm:text-2xl">{needsPassword ? 'Skapa din inloggning' : 'Bekräfta din åtkomst'}</h2>
          {needsPassword ? <><p className="mt-2 text-sm leading-6 text-stone-600">Inloggningen kopplas till {payload.invite.email}.</p>
            <p className="mt-4 text-sm text-stone-700">Har du redan ett HusHub-konto med denna e-postadress? <Link href={loginHref} onClick={saveBeforeLogin} className="font-semibold underline">Logga in</Link>.</p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2"><InputField label="Namn" required value={firstUser.name} onChange={value => setFirstUser(current => ({ ...current, name: value }))} autoComplete="name" />
              <InputField label="Lösenord" required value={password} onChange={setPassword} placeholder="Välj lösenord" type="password" autoComplete="new-password" helperText="Lösenordet måste innehålla minst 8 tecken." /></div></>
          : <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">Du är inloggad med {payload.currentUser.email}. Bekräfta för att lägga till föreningen i din styrelseportal.</p>}</section>}

        {actionError ? <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{actionError}</div> : null}
        <div className="border-t border-stone-200 pt-6"><button type="submit" disabled={submitting || (isActivation && (!termsAccepted || !signatoryAuthorityConfirmed))}
          className="rounded-md bg-stone-950 px-5 py-3 text-sm font-semibold text-white hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-50">{submitting ? (isActivation ? 'Aktiverar...' : 'Bekräftar...') : (isActivation ? 'Aktivera föreningen' : 'Bekräfta och öppna RenoApp')}</button>
          {requiresManualLogin ? <Link href={loginHref} onClick={saveBeforeLogin} className="ml-3 inline-flex rounded-md border border-stone-300 px-5 py-3 text-sm font-semibold hover:bg-stone-50">Logga in med befintligt konto</Link> : null}</div>
      </form>}
    </section>
  </div></main>
}
