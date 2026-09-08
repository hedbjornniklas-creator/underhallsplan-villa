'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Camera, Check, CheckCheck, ChevronDown, LoaderCircle, Mail, ShieldCheck, X } from 'lucide-react'
import type { EbFollowUpOffer } from '@/lib/eb/followUp'

type OrderFields = {
  email: string
  code: string
  name: string
  invoiceName: string
  invoiceOrgNo: string
  invoiceAddress: string
  invoicePostalCode: string
  invoiceCity: string
  acceptTerms: boolean
  requestImmediateStart: boolean
  acceptInvoice: boolean
}

const emptyFields: OrderFields = {
  email: '', code: '', name: '', invoiceName: '', invoiceOrgNo: '', invoiceAddress: '',
  invoicePostalCode: '', invoiceCity: '', acceptTerms: false, requestImmediateStart: false, acceptInvoice: false,
}
const inputClass = 'min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal text-slate-950 focus:border-emerald-700 focus:outline-2 focus:outline-emerald-700 disabled:bg-slate-50'
const buttonClass = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60'

function money(ore: number) {
  return `${(ore / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 })} kr`
}

function safePortalUrl(value: unknown) {
  return typeof value === 'string' && /^\/atgarder\/[A-Za-z0-9_-]{20,}$/.test(value) ? value : null
}

type FollowUpProps = { endpoint: string; autoOpen?: boolean }

export default function EbFollowUpOrder(props: FollowUpProps) {
  // Client navigation between reports must discard the previous report's
  // verified view and draft before loading the new report's session.
  return <CustomerFollowUpOrder key={props.endpoint} {...props} />
}

function CustomerFollowUpOrder({ endpoint, autoOpen = false }: FollowUpProps) {
  const [verified, setVerified] = useState(false)
  const [accessAvailable, setAccessAvailable] = useState(false)
  const [offer, setOffer] = useState<EbFollowUpOffer | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [fields, setFields] = useState<OrderFields>(emptyFields)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [challengeEmail, setChallengeEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'code' | 'verify' | 'order' | 'access' | null>(null)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const autoOpened = useRef(false)
  const busyRef = useRef(false)
  const retryRef = useRef(false)
  const mounted = useRef(true)
  const dialog = useRef<HTMLDialogElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const codeInput = useRef<HTMLInputElement>(null)
  const dialogTitle = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<'email' | 'code' | 'title' | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const requireVerification = useCallback(() => {
    setVerified(false)
    setOffer(null)
    setPortalUrl(null)
    setAccessAvailable(true)
    setChallengeId(null)
    setChallengeEmail('')
    setMessage('')
    // Keep the draft only in this component, hidden until re-verification.
    // A renewed checkout requires renewed consent; no draft is persisted.
    setFields(current => ({ ...current, code: '', acceptTerms: false, requestImmediateStart: false, acceptInvoice: false }))
    pendingFocus.current = 'email'
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    const controller = new AbortController()
    const abort = () => controller.abort()
    const timeout = setTimeout(abort, 15_000)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal, credentials: 'same-origin' })
      if (response.status === 401) {
        if (!signal?.aborted && mounted.current) { requireVerification(); setLoadError(false) }
        return
      }
      const payload = await response.json()
      if (!response.ok) throw new Error('ACCESS_UNAVAILABLE')
      if (!signal?.aborted && mounted.current) {
        // Only the server session may unlock customer information. A public
        // response never becomes an offer, even if it accidentally includes one.
        const isVerified = payload.verified === true
        setVerified(isVerified)
        setOffer(isVerified ? payload.offer ?? null : null)
        setAccessAvailable(isVerified || payload.accessAvailable === true)
        setLoadError(payload.retryable === true || (isVerified && payload.offer?.retryable === true))
        if (!isVerified) setPortalUrl(null)
      }
    } catch {
      if (!signal?.aborted && mounted.current) setLoadError(true)
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
    }
  }, [endpoint, requireVerification])

  useEffect(() => {
    mounted.current = true
    const controller = new AbortController()
    void load(controller.signal)
    return () => { mounted.current = false; controller.abort() }
  }, [load])

  useEffect(() => {
    if (!autoOpen || autoOpened.current || !accessAvailable || !dialog.current) return
    autoOpened.current = true
    dialog.current.showModal()
    if (!verified) emailInput.current?.focus()
  }, [autoOpen, accessAvailable, verified])

  useEffect(() => {
    if (busy || !dialog.current?.open || !pendingFocus.current) return
    const target = pendingFocus.current === 'email' ? emailInput.current : pendingFocus.current === 'code' ? codeInput.current : dialogTitle.current
    target?.focus()
    pendingFocus.current = null
  }, [busy, challengeId, verified])

  async function retry() {
    if (retryRef.current) return
    retryRef.current = true
    setRetrying(true)
    try { await load() }
    finally {
      retryRef.current = false
      if (mounted.current) setRetrying(false)
    }
  }

  function change<K extends keyof OrderFields>(key: K, value: OrderFields[K]) {
    setFields(current => ({ ...current, [key]: value }))
    if (key === 'email') {
      setChallengeId(null); setChallengeEmail(''); setMessage(''); setError(null)
      setFields(current => ({ ...current, code: '' }))
    }
  }

  function open() {
    if (!accessAvailable) return
    setError(null)
    dialog.current?.showModal()
    if (!verified) emailInput.current?.focus()
    else dialogTitle.current?.focus()
  }

  async function send(action: 'request_code' | 'verify_code' | 'order' | 'access') {
    if (busyRef.current || !accessAvailable) return
    if ((action === 'order' || action === 'access') && (!verified || !offer)) return
    if (action === 'order' && (!offer?.available || offer.alreadyActive)) return
    if (action === 'access' && !offer?.alreadyActive) return
    if (action === 'verify_code' && (!challengeId || challengeEmail !== fields.email.trim().toLowerCase())) {
      setError('Begär först en kod till din e-postadress.')
      return
    }
    busyRef.current = true
    setBusy(action === 'request_code' ? 'code' : action === 'verify_code' ? 'verify' : action)
    setError(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(action === 'request_code' ? { action, email: fields.email.trim() }
          : action === 'verify_code' ? { action, challengeId, code: fields.code.trim() }
          : action === 'access' ? { action }
          : {
            action, name: fields.name, invoiceName: fields.invoiceName, invoiceOrgNo: fields.invoiceOrgNo,
            invoiceAddress: fields.invoiceAddress, invoicePostalCode: fields.invoicePostalCode, invoiceCity: fields.invoiceCity,
            acceptTerms: fields.acceptTerms, requestImmediateStart: fields.requestImmediateStart, acceptInvoice: fields.acceptInvoice,
            termsVersion: offer!.termsVersion, confirmedPriceOre: offer!.priceOre,
          }),
      })
      if (!mounted.current) return
      // Fail closed on an expired session even if a proxy returns a non-JSON
      // error page. Unverified code errors keep the code form available.
      if (response.status === 401 && (action === 'order' || action === 'access')) {
        requireVerification()
        throw new Error('Din verifiering har gått ut. Bekräfta e-postadressen igen för att fortsätta.')
      }
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Begäran kunde inte slutföras. Försök igen.')
      }
      if (action === 'request_code') {
        if (typeof payload.challengeId !== 'string') throw new Error('Koden kunde inte begäras. Försök igen.')
        setChallengeId(payload.challengeId)
        setChallengeEmail(fields.email.trim().toLowerCase())
        setFields(current => ({ ...current, code: '' }))
        setMessage(payload.message || 'Om adressen stämmer med beställarens uppgifter skickas en engångskod. Kontrollera även skräpposten.')
        pendingFocus.current = 'code'
      } else if (action === 'verify_code') {
        if (payload.verified !== true) throw new Error('Koden kunde inte verifieras. Försök igen.')
        setVerified(true)
        setOffer(payload.offer ?? null)
        setLoadError(payload.retryable === true || payload.offer?.retryable === true)
        setChallengeId(null)
        setFields(current => ({ ...current, code: '' }))
        setMessage('')
        pendingFocus.current = 'title'
      } else {
        const nextUrl = safePortalUrl(payload.portalUrl)
        if (!nextUrl) throw new Error('Begäran har tagits emot, men åtkomstlänken kunde inte visas. Försök igen eller kontrollera din e-post.')
        setPortalUrl(nextUrl)
        setMessage(payload.message || (action === 'access' ? 'Din privata åtgärdsuppföljning är öppnad.' : 'Beställningen är sparad och åtgärdsuppföljningen är aktiverad.'))
        setOffer(current => current ? { ...current, alreadyActive: true } : current)
        dialog.current?.close()
      }
    } catch (cause) {
      if (mounted.current) setError(controller.signal.aborted
        ? action === 'order'
          ? 'Svaret tog för lång tid. Försök igen. En upprepad beställning av samma tjänst skapar ingen extra kostnad.'
          : 'Svaret tog för lång tid. Försök igen.'
        : cause instanceof Error ? cause.message : 'Begäran kunde inte slutföras. Försök igen.')
    } finally {
      clearTimeout(timeout)
      busyRef.current = false
      if (mounted.current) setBusy(null)
    }
  }

  const retryControl = loadError ? <div id="digital-follow-up-retry" role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 print:hidden">
      Beställaråtkomsten kunde inte laddas.
      <button type="button" disabled={retrying} onClick={() => void retry()} className="inline-flex min-h-10 items-center gap-1.5 font-semibold text-emerald-800 underline disabled:cursor-wait disabled:opacity-60">
        {retrying ? <><LoaderCircle size={14} className="animate-spin" aria-hidden />Försöker igen…</> : 'Försök igen'}
      </button>
    </div> : null
  if (!accessAvailable && !verified) return retryControl
  const customerOffer = verified && offer && (offer.available || offer.alreadyActive) ? offer : null
  const accessOnly = customerOffer?.alreadyActive === true
  const priceLabel = customerOffer ? `${money(customerOffer.priceOre)} inkl. moms` : ''
  const codeRequested = challengeId !== null && challengeEmail === fields.email.trim().toLowerCase()

  return (
    <section id="digital-follow-up" aria-label={customerOffer ? 'Digital åtgärdsuppföljning' : 'För beställaren'} className={customerOffer ? 'overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm print:hidden' : 'print:hidden'}>
      {!customerOffer ? <>
        <button type="button" onClick={open} className="inline-flex min-h-11 items-center gap-1.5 text-xs font-medium text-slate-600 underline underline-offset-4 hover:text-slate-900"><ShieldCheck size={15} aria-hidden />För beställaren</button>
        {retryControl}
      </> : <>
      <div className="flex flex-col gap-5 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"><CheckCheck size={25} aria-hidden /></span>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.13em] text-emerald-700">Tillval efter besiktningen</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">Digital åtgärdsuppföljning</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Skicka felen till entreprenören och följ vilka som anmälts åtgärdade. Samla kommentarer, före- och åtgärdsbilder.</p>
          </div>
        </div>
        <div className="shrink-0 lg:text-right">
          {!accessOnly ? <><p className="text-xl font-semibold text-slate-950">{priceLabel}</p><p className="mb-3 mt-1 text-xs text-slate-500">Engångspris för denna besiktning.</p></> : null}
          {portalUrl ? <a href={portalUrl} rel="noreferrer" className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>Öppna åtgärdsuppföljningen<ArrowRight size={17} aria-hidden /></a>
            : <button type="button" onClick={open} className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>
              {accessOnly ? 'Öppna åtgärdsuppföljningen' : 'Köp åtgärdsuppföljning'}<ArrowRight size={17} aria-hidden />
            </button>}
        </div>
      </div>
      {portalUrl ? <div role="status" className="flex items-start gap-2 border-t border-emerald-100 bg-emerald-50 px-5 py-4 text-sm text-emerald-950"><Check size={18} className="mt-0.5 shrink-0" aria-hidden /><span>{message} Din personliga länk ska inte delas med entreprenören; skicka en separat entreprenörslänk från portalen.</span></div> : null}
      {!portalUrl ? <div className="border-t border-slate-100 px-5 py-3 text-xs leading-5 text-slate-500 sm:px-6">Utlåtandet är tillgängligt även utan tillvalet. Entreprenörens avbockning är inte ett godkännande av besiktningsmannen.</div> : null}
      </>}

      <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { if (busyRef.current) event.preventDefault() }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/50">
        <form className="min-w-0 p-5 sm:p-7" onSubmit={event => {
          event.preventDefault()
          if (!verified) void send(codeRequested ? 'verify_code' : 'request_code')
          else if (customerOffer) void send(accessOnly ? 'access' : 'order')
        }}>
          <div className="flex items-start justify-between gap-4">
            <h2 ref={dialogTitle} id={titleId} tabIndex={-1} className="text-xl font-semibold focus:outline-none">{!customerOffer ? 'För beställaren' : accessOnly ? 'Öppna din åtgärdsuppföljning' : 'Digital åtgärdsuppföljning'}</h2>
            <button type="button" disabled={!!busy} aria-label="Stäng" onClick={() => dialog.current?.close()} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"><X size={19} aria-hidden /></button>
          </div>
          <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-600">{!verified ? 'Bekräfta din e-postadress för att öppna beställarens vy. Utlåtandet kan läsas och delas utan verifiering.' : !customerOffer ? 'Din e-postadress är verifierad. Åtgärdsuppföljning är inte tillgänglig för den här rapporten just nu.' : accessOnly ? 'Din e-postadress är verifierad. Öppna din privata åtgärdsuppföljning. Ingen ny beställning görs.' : 'Ett tillval för den här besiktningen. Du får en egen översikt och kan bjuda in entreprenörer via personliga länkar.'}</p>
          {customerOffer && !accessOnly ? <>
            <div className="my-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-2xl font-semibold text-emerald-950">{priceLabel}</p>
              <p className="mt-1 text-xs text-emerald-900">{money(customerOffer.netPriceOre)} + {money(customerOffer.vatOre)} moms ({customerOffer.vatRate} %). Betalas mot faktura.</p>
              <details className="group mt-4 text-sm">
                <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-semibold text-emerald-950 focus-visible:outline-2 focus-visible:outline-emerald-700 [&::-webkit-details-marker]:hidden">Vad ingår i priset?<ChevronDown size={17} className="transition-transform group-open:rotate-180" aria-hidden /></summary>
                <ul className="mt-2 space-y-3 text-emerald-950">
                  <li className="flex items-start gap-2"><CheckCheck size={18} className="mt-0.5 shrink-0" aria-hidden /><span>En gemensam lista med besiktningens fel, med tilldelning till rätt entreprenör.</span></li>
                  <li className="flex items-start gap-2"><Camera size={18} className="mt-0.5 shrink-0" aria-hidden /><span>Entreprenören rapporterar åtgärder med bilder och kommentarer direkt från mobilen.</span></li>
                  <li className="flex items-start gap-2"><Mail size={18} className="mt-0.5 shrink-0" aria-hidden /><span>Översikt, historik och mejl när uppföljningen uppdateras.</span></li>
                </ul>
                <p className="mt-3 leading-6">Ingen manuell kontroll av besiktningsman eller efterbesiktning ingår. ”Anmält åtgärdat” är entreprenörens uppgift, inte ett besiktningsgodkännande.</p>
              </details>
            </div>
          </> : null}

          {!verified ? <fieldset disabled={!!busy} className="mt-5 min-w-0 space-y-4 disabled:opacity-70">
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} className="text-emerald-700" aria-hidden />Bekräfta din e-postadress</legend>
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Beställarens e-postadress
              <input ref={emailInput} name="email" type="email" autoComplete="email" maxLength={254} required value={fields.email} onChange={event => change('email', event.target.value)} className={inputClass} />
            </label>
            <p className="text-xs leading-5 text-slate-500">Ange adressen som besiktningsmannen har registrerat för beställaren. Kontakt- och fakturauppgifter visas inte för andra som har rapportlänken.</p>
            {codeRequested ? <>
              <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{message}</p>
              <label className="grid gap-1.5 text-sm font-semibold">Engångskod från mejlet
                <input ref={codeInput} name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={fields.code} onChange={event => change('code', event.target.value.replace(/\D/g, ''))} className={`${inputClass} tracking-[0.25em]`} />
              </label>
              <button type="button" onClick={() => void send('request_code')} className="min-h-10 text-sm font-semibold text-emerald-800 underline">Skicka en ny kod</button>
            </> : null}
          </fieldset> : null}

          {customerOffer && !accessOnly ? <fieldset disabled={!!busy} className="mt-5 min-w-0 space-y-4 border-t border-slate-200 pt-5 disabled:opacity-70">
            <legend className="px-1 text-sm font-semibold">Beställning och faktura</legend>
            <label className="grid gap-1.5 text-sm font-semibold">Ditt namn<input name="name" autoComplete="name" maxLength={150} required value={fields.name} onChange={event => change('name', event.target.value)} className={inputClass} /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Fakturamottagarens namn<input name="invoiceName" autoComplete="billing organization" maxLength={160} required value={fields.invoiceName} onChange={event => change('invoiceName', event.target.value)} className={inputClass} /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Organisationsnummer <span className="font-normal text-slate-500">Frivilligt, för företag eller förening</span><input name="invoiceOrgNo" maxLength={32} value={fields.invoiceOrgNo} onChange={event => change('invoiceOrgNo', event.target.value)} className={inputClass} /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Fakturaadress<input name="invoiceAddress" autoComplete="billing street-address" maxLength={200} required value={fields.invoiceAddress} onChange={event => change('invoiceAddress', event.target.value)} className={inputClass} /></label>
            <div className="grid min-w-0 grid-cols-[1fr_2fr] gap-3">
              <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Postnummer<input name="invoicePostalCode" autoComplete="billing postal-code" maxLength={20} required value={fields.invoicePostalCode} onChange={event => change('invoicePostalCode', event.target.value)} className={inputClass} /></label>
              <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Ort<input name="invoiceCity" autoComplete="billing address-level2" maxLength={100} required value={fields.invoiceCity} onChange={event => change('invoiceCity', event.target.value)} className={inputClass} /></label>
            </div>
            <p className="break-words text-xs leading-5 text-slate-500">Bekräftelsen och uppgifter om faktureringen skickas till beställarens verifierade e-postadress.</p>
            <details className="rounded-lg border border-slate-200 p-3 text-sm">
              <summary className="min-h-10 cursor-pointer font-semibold">Tjänstens omfattning och köpvillkor</summary>
              <div className="mt-2 space-y-3 leading-6 text-slate-700">
                <p className="whitespace-pre-wrap">{customerOffer.serviceDescription}</p>
                <p>Priset är {priceLabel} för denna besiktning. Det är ett engångsköp utan prenumeration. Ursprungliga utlåtanden och bilder ändras inte av uppföljningen.</p>
                <p>Som privatkund har du som huvudregel 14 dagars ångerrätt. Begäran om omedelbar aktivering tar inte i sig bort ångerrätten. Du kan meddela att du ångrar beställningen från din privata åtgärdsportal eller kontakta säljaren.</p>
                {customerOffer.seller ? <div className="border-t border-slate-200 pt-3"><p className="font-semibold">Säljare: {customerOffer.seller.name}</p><p>Org.nr {customerOffer.seller.orgNumber}</p><p className="whitespace-pre-wrap">{customerOffer.seller.address}</p><a className="break-all text-emerald-800 underline" href={`mailto:${customerOffer.seller.email}`}>{customerOffer.seller.email}</a>{customerOffer.seller.phone ? <p>{customerOffer.seller.phone}</p> : null}</div> : null}
                <p className="text-xs text-slate-500">Villkorsversion: {customerOffer.termsVersion}</p>
              </div>
            </details>
            <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={fields.acceptTerms} onChange={event => change('acceptTerms', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>Jag har läst och godkänner tjänstens omfattning och köpvillkor.</span></label>
            <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={fields.requestImmediateStart} onChange={event => change('requestImmediateStart', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>Jag begär att den digitala åtgärdsuppföljningen aktiveras direkt.</span></label>
            <label className="flex items-start gap-3 text-sm leading-6"><input type="checkbox" required checked={fields.acceptInvoice} onChange={event => change('acceptInvoice', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>Jag godkänner betalningsskyldigheten på {priceLabel} mot faktura och har rätt att beställa för angiven fakturamottagare.</span></label>
          </fieldset> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900">{error}</p> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" disabled={!!busy} onClick={() => dialog.current?.close()} className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>{verified && !customerOffer ? 'Stäng' : 'Avbryt'}</button>
            {verified && !customerOffer && loadError ? <button type="button" disabled={retrying} onClick={() => void retry()} className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>{retrying ? 'Försöker igen…' : 'Försök igen'}</button> : null}
            {!verified || customerOffer ? <button type="submit" disabled={!!busy} className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>
              {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : verified || codeRequested ? <Check size={18} aria-hidden /> : <Mail size={18} aria-hidden />}
              {busy === 'code' ? 'Skickar kod …' : busy === 'verify' ? 'Verifierar …' : busy === 'order' ? 'Sparar beställning …' : busy === 'access' ? 'Öppnar …' : !verified ? codeRequested ? 'Verifiera kod' : 'Skicka engångskod' : accessOnly ? 'Öppna utan ny beställning' : `Beställ för ${priceLabel}`}
            </button> : null}
          </div>
        </form>
      </dialog>
    </section>
  )
}
