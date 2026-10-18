'use client'

import Link from 'next/link'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Building2, Plus, ShieldCheck } from 'lucide-react'

type CreateRequest = { requestId: string; name: string; organizationNumber: string }
const inputClass = 'mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-950 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-600'
const definitiveErrors: Record<string, number> = {
  UNAUTHORIZED: 401,
  ORG_EMAIL_UNVERIFIED: 403,
  ORG_ORIGIN_FORBIDDEN: 403,
  ORG_INPUT_INVALID: 400,
  ORG_REQUEST_INVALID: 400,
  ORG_REQUEST_TOO_LARGE: 413,
  ORG_CONTENT_TYPE_INVALID: 415,
  ORG_NUMBER_EXISTS: 409,
  ORG_CREATE_LIMIT: 429,
  ORG_LEGACY_ACCESS_REVIEW_REQUIRED: 409,
  ORG_PROFILE_NOT_FOUND: 404,
}

export function isDefinitiveOrganizationCreateFailure(status: number, code: unknown) {
  return typeof code === 'string' && Object.hasOwn(definitiveErrors, code) && definitiveErrors[code] === status
}

export function createdOrganizationDestination(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const result = payload as { saved?: unknown; organizationId?: unknown }
  if (result.saved !== true || typeof result.organizationId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(result.organizationId)) return null
  return `/settings/organisation?orgId=${encodeURIComponent(result.organizationId)}`
}

export default function OrganizationCreateForm() {
  const [name, setName] = useState('')
  const [organizationNumber, setOrganizationNumber] = useState('')
  const [pending, setPending] = useState<CreateRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  const completed = useRef(false)
  const dirty = Boolean(name || organizationNumber || pending)

  useEffect(() => {
    if (!dirty) return
    const onUnload = (event: BeforeUnloadEvent) => {
      if (completed.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const onNavigate = (event: Event) => {
      if (completed.current || event.defaultPrevented) return
      if (inFlight.current) { event.preventDefault(); return }
      const detail = (event as CustomEvent<{ confirmed?: boolean }>).detail
      if (detail?.confirmed) return
      const message = pending
        ? 'Resultatet av skapandet är inte bekräftat. Stanna gärna och försök igen för att kontrollera samma begäran. Vill du ändå lämna sidan?'
        : 'Du har osparade uppgifter för en ny organisation. Vill du lämna sidan?'
      if (!window.confirm(message)) event.preventDefault()
      else if (detail) detail.confirmed = true
    }
    window.addEventListener('beforeunload', onUnload)
    window.addEventListener('hushub:before-organization-switch', onNavigate)
    return () => {
      window.removeEventListener('beforeunload', onUnload)
      window.removeEventListener('hushub:before-organization-switch', onNavigate)
    }
  }, [dirty, pending])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current || completed.current) return
    const values = pending ?? { requestId: crypto.randomUUID(), name: name.trim(), organizationNumber: organizationNumber.trim() }
    if (!values.name || !values.organizationNumber) return
    if (!pending && !window.confirm(`Skapa ${values.name} (${values.organizationNumber})?\n\nDu blir administratör för den nya organisationen med ditt befintliga konto. Befintliga organisationer, uppdrag och din standardorganisation ändras inte. Arbetsområden aktiveras senare av HusHub-administratören.`)) return

    inFlight.current = true
    setBusy(true)
    setError('')
    setPending(values)
    try {
      const response = await fetch('/api/organizations', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok && isDefinitiveOrganizationCreateFailure(response.status, payload?.code)) {
        setPending(null)
        setError(typeof payload?.error === 'string' ? payload.error : 'Organisationen kunde inte skapas. Kontrollera uppgifterna och försök igen.')
        return
      }
      const destination = response.ok ? createdOrganizationDestination(payload) : null
      if (!destination) throw new Error('UNCONFIRMED')
      // A full navigation obtains fresh membership/context after the write.
      // The explicit orgId selects this organization without changing a default.
      completed.current = true
      window.location.assign(destination)
    } catch {
      completed.current = false
      setError('Vi kunde inte bekräfta resultatet. Uppgifterna är låsta så att nästa försök kontrollerar samma begäran och inte skapar en extra organisation.')
    } finally {
      inFlight.current = false
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
      <Link href="/settings/organisation" onClick={event => {
        if (!window.dispatchEvent(new CustomEvent('hushub:before-organization-switch', { cancelable: true, detail: {} }))) event.preventDefault()
      }} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-indigo-700 hover:underline"><ArrowLeft size={16} aria-hidden />Till organisation</Link>
      <div className="mt-4 flex items-start gap-3">
        <span className="rounded-xl bg-indigo-50 p-3 text-indigo-600"><Building2 size={24} aria-hidden /></span>
        <div><h1 className="text-2xl font-semibold tracking-tight text-slate-950">Skapa organisation</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Lägg till ett nytt företag på ditt befintliga HusHub-konto. Du behöver inte skapa ett nytt användarkonto.</p></div>
      </div>
      <div className="mt-6 max-w-3xl rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950"><strong>Finns företaget redan i HusHub?</strong> Be organisationens administratör bjuda in dig till din befintliga inloggningsmejl. Skapa inte en ny organisation för att ansluta till ett befintligt företag.</div>
      <form onSubmit={submit} className="mt-6 max-w-3xl space-y-6">
        <fieldset disabled={busy || Boolean(pending)} className="grid gap-5 sm:grid-cols-2">
          <legend className="sr-only">Den nya organisationens uppgifter</legend>
          <label className="text-sm font-medium text-slate-700">Företagsnamn<input name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={240} autoComplete="organization" className={inputClass} /></label>
          <label className="text-sm font-medium text-slate-700">Organisationsnummer<input name="organizationNumber" value={organizationNumber} onChange={event => setOrganizationNumber(event.target.value)} required maxLength={13} placeholder="XXXXXX-XXXX" inputMode="numeric" autoComplete="off" aria-describedby="organization-number-help" className={inputClass} /><span id="organization-number-help" className="mt-1.5 block text-xs font-normal leading-5 text-slate-500">Ange företagets svenska organisationsnummer.</span></label>
        </fieldset>
        <div className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">
          <p className="flex items-center gap-2 font-semibold text-slate-900"><ShieldCheck size={18} aria-hidden />Du blir administratör för den nya organisationen</p>
          <p className="mt-2">Du kan fylla i företagsuppgifter och hantera medlemmar. Du får inte HusHubs övergripande administratörsbehörighet.</p>
          <p className="mt-2">Inga arbetsområden aktiveras automatiskt. HusHub-administratören aktiverar dem i ett senare steg. Dina befintliga organisationer, uppdrag, behörigheter och din standardorganisation lämnas oförändrade.</p>
        </div>
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-800">{error}</p>}
        {busy && <p role="status" className="text-sm text-slate-600">Skapar organisationen och kontrollerar resultatet…</p>}
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-slate-100 pt-5">
          <p className="max-w-md text-xs leading-5 text-slate-500">Efter skapandet öppnas företagsprofilen för den nya organisationen.</p>
          <button type="submit" disabled={busy || !name.trim() || !organizationNumber.trim()} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"><Plus size={17} aria-hidden />{busy ? 'Skapar…' : pending ? 'Kontrollera och försök igen' : 'Skapa organisation'}</button>
        </div>
      </form>
    </section>
  )
}
