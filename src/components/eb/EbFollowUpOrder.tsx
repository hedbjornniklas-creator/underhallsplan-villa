'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { ArrowRight, Camera, Check, CheckCheck, ChevronDown, LoaderCircle, Mail, ShieldCheck, X } from 'lucide-react'
import { EB_FOLLOW_UP_TERMS_VERSION, type EbFollowUpOffer } from '@/lib/eb/followUp'
import { EB_FOLLOW_UP_WITHDRAWAL_FORM_URL, getEbFollowUpConsentTexts, getEbFollowUpTermsText, getEbFollowUpWithdrawalFormText } from '@/lib/eb/followUpTerms'

type OrderFields = {
  email: string
  customerType: '' | 'consumer' | 'business'
  name: string
  invoiceName: string
  invoiceOrgNo: string
  invoiceAddress: string
  invoicePostalCode: string
  invoiceCity: string
  acceptTerms: boolean
  consumerWithdrawalAcknowledged: boolean
  requestImmediateStart: boolean
  acceptInvoice: boolean
}

const emptyFields: OrderFields = {
  email: '', customerType: '', name: '', invoiceName: '', invoiceOrgNo: '', invoiceAddress: '',
  invoicePostalCode: '', invoiceCity: '', acceptTerms: false, consumerWithdrawalAcknowledged: false,
  requestImmediateStart: false, acceptInvoice: false,
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
  // private view and draft before loading the new report's session.
  return <CustomerFollowUpOrder key={props.endpoint} {...props} />
}

function CustomerFollowUpOrder({ endpoint, autoOpen = false }: FollowUpProps) {
  const [verified, setVerified] = useState(false)
  const [accessAvailable, setAccessAvailable] = useState(false)
  const [offer, setOffer] = useState<EbFollowUpOffer | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [fields, setFields] = useState<OrderFields>(emptyFields)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'link' | 'order' | 'access' | null>(null)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)
  const autoOpened = useRef(false)
  const busyRef = useRef(false)
  const retryRef = useRef(false)
  const offerFingerprint = useRef('')
  const mounted = useRef(true)
  const dialog = useRef<HTMLDialogElement>(null)
  const emailInput = useRef<HTMLInputElement>(null)
  const dialogTitle = useRef<HTMLHeadingElement>(null)
  const pendingFocus = useRef<'email' | 'title' | null>(null)
  const titleId = useId()
  const descriptionId = useId()

  const requireBuyerAccess = useCallback(() => {
    setVerified(false)
    setOffer(null)
    offerFingerprint.current = ''
    setPortalUrl(null)
    setAccessAvailable(true)
    setMessage('')
    // Keep the draft only in this component, hidden until private access returns.
    // A renewed checkout requires renewed consent; no draft is persisted.
    setFields(current => ({ ...current, acceptTerms: false, consumerWithdrawalAcknowledged: false, requestImmediateStart: false, acceptInvoice: false }))
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
        if (!signal?.aborted && mounted.current) { requireBuyerAccess(); setLoadError(false) }
        return
      }
      const payload = await response.json()
      if (!response.ok) throw new Error('ACCESS_UNAVAILABLE')
      if (!signal?.aborted && mounted.current) {
        // Only the server session may unlock customer information. A public
        // response never becomes an offer, even if it accidentally includes one.
        const isVerified = payload.verified === true
        const nextOffer = isVerified ? payload.offer ?? null : null
        const nextFingerprint = nextOffer ? JSON.stringify({
          termsVersion: nextOffer.termsVersion, serviceDescription: nextOffer.serviceDescription,
          priceOre: nextOffer.priceOre, netPriceOre: nextOffer.netPriceOre, vatOre: nextOffer.vatOre,
          vatRate: nextOffer.vatRate, seller: nextOffer.seller,
        }) : ''
        if (offerFingerprint.current && nextFingerprint !== offerFingerprint.current) {
          setFields(current => ({ ...current, acceptTerms: false, consumerWithdrawalAcknowledged: false, requestImmediateStart: false, acceptInvoice: false }))
        }
        offerFingerprint.current = nextFingerprint
        setVerified(isVerified)
        setOffer(nextOffer)
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
  }, [endpoint, requireBuyerAccess])

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
    else dialogTitle.current?.focus()
  }, [autoOpen, accessAvailable, verified])

  useEffect(() => {
    if (busy || !dialog.current?.open || !pendingFocus.current) return
    const target = pendingFocus.current === 'email' ? emailInput.current : dialogTitle.current
    target?.focus()
    pendingFocus.current = null
  }, [busy, verified])

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
      setMessage(''); setError(null)
    }
    if (key === 'customerType') {
      setFields(current => ({ ...current, acceptTerms: false, consumerWithdrawalAcknowledged: false, requestImmediateStart: false, acceptInvoice: false, invoiceOrgNo: '' }))
      setError(null)
    }
  }

  function open() {
    if (!accessAvailable) return
    setError(null)
    dialog.current?.showModal()
    if (!verified) emailInput.current?.focus()
    else dialogTitle.current?.focus()
  }

  async function send(action: 'request_link' | 'order' | 'access') {
    if (busyRef.current || !accessAvailable) return
    if ((action === 'order' || action === 'access') && (!verified || !offer)) return
    if (action === 'order' && (!offer?.available || offer.alreadyActive || !offer.seller)) return
    if (action === 'order' && offer?.termsVersion !== EB_FOLLOW_UP_TERMS_VERSION) return
    if (action === 'access' && !offer?.alreadyActive) return
    if (action === 'order' && (!fields.customerType || !fields.acceptTerms || !fields.requestImmediateStart || !fields.acceptInvoice || (fields.customerType === 'consumer' && !fields.consumerWithdrawalAcknowledged))) {
      setError('Välj kundtyp och lämna de separata godkännandena innan du beställer.')
      return
    }
    busyRef.current = true
    setBusy(action === 'request_link' ? 'link' : action)
    setError(null)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 45_000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
        body: JSON.stringify(action === 'request_link' ? { action, email: fields.email.trim() }
          : action === 'access' ? { action }
          : {
            action, customerType: fields.customerType, name: fields.name, invoiceName: fields.invoiceName, invoiceOrgNo: fields.customerType === 'business' ? fields.invoiceOrgNo : null,
            invoiceAddress: fields.invoiceAddress, invoicePostalCode: fields.invoicePostalCode, invoiceCity: fields.invoiceCity,
            acceptTerms: fields.acceptTerms, requestImmediateStart: fields.requestImmediateStart, acceptInvoice: fields.acceptInvoice,
            consumerWithdrawalAcknowledged: fields.customerType === 'consumer' && fields.consumerWithdrawalAcknowledged,
            termsVersion: offer!.termsVersion, confirmedPriceOre: offer!.priceOre,
          }),
      })
      if (!mounted.current) return
      // Fail closed on an expired session even if a proxy returns a non-JSON
      // error page. Requesting a personal link never unlocks customer data.
      if (response.status === 401 && (action === 'order' || action === 'access')) {
        requireBuyerAccess()
        throw new Error('Din beställaråtkomst har gått ut. Öppna din personliga beställarlänk igen eller begär en ny.')
      }
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Begäran kunde inte slutföras. Försök igen.')
      }
      if (action === 'request_link') {
        setMessage(payload.message || 'Om adressen stämmer med beställarens uppgifter skickas en personlig beställarlänk. Kontrollera även skräpposten. Ingen beställning görs när länken begärs.')
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
        : cause instanceof TypeError ? 'Anslutningen avbröts. Försök igen. Dina uppgifter finns kvar i formuläret.'
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
  const termsChanged = verified && offer?.available && !offer.alreadyActive && offer.termsVersion !== EB_FOLLOW_UP_TERMS_VERSION
  const customerOffer = verified && offer && ((offer.available && offer.seller && !termsChanged) || offer.alreadyActive) ? offer : null
  const accessOnly = customerOffer?.alreadyActive === true
  const priceLabel = customerOffer ? `${money(customerOffer.priceOre)} inkl. moms` : ''
  const isConsumer = fields.customerType === 'consumer'
  const consentComplete = Boolean(fields.customerType && fields.acceptTerms && fields.requestImmediateStart && fields.acceptInvoice && (!isConsumer || fields.consumerWithdrawalAcknowledged))
  const termsText = customerOffer?.seller && fields.customerType ? getEbFollowUpTermsText({ seller: customerOffer.seller, customerType: fields.customerType, priceOre: customerOffer.priceOre }) : null
  const consentTexts = fields.customerType && customerOffer ? getEbFollowUpConsentTexts(fields.customerType, customerOffer.priceOre) : null

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
      {retryControl ? <div className="px-5 pb-3 sm:px-6">{retryControl}</div> : null}
      </>}

      <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { if (busyRef.current) event.preventDefault() }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-0 text-slate-950 shadow-2xl backdrop:bg-slate-950/50">
        <form className="min-w-0 p-5 sm:p-7" onSubmit={event => {
          event.preventDefault()
          if (!verified) void send('request_link')
          else if (customerOffer) void send(accessOnly ? 'access' : 'order')
        }}>
          <div className="flex items-start justify-between gap-4">
            <h2 ref={dialogTitle} id={titleId} tabIndex={-1} className="text-xl font-semibold focus:outline-none">{!customerOffer ? 'För beställaren' : accessOnly ? 'Öppna din åtgärdsuppföljning' : 'Digital åtgärdsuppföljning'}</h2>
            <button type="button" disabled={!!busy} aria-label="Stäng" onClick={() => dialog.current?.close()} className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-50"><X size={19} aria-hidden /></button>
          </div>
          <p id={descriptionId} className="mt-3 text-sm leading-6 text-slate-600">{!verified ? 'Öppna din personliga beställarlänk från besiktningsföretaget för att beställa. Saknar du länken kan du begära den här. Utlåtandet kan alltid läsas och delas utan att beställa.' : termsChanged ? 'Köpvillkoren har uppdaterats sedan den här sidan laddades. Ladda om sidan för att läsa och godkänna rätt villkor innan du beställer.' : !customerOffer ? 'Åtgärdsuppföljning är inte tillgänglig för den här rapporten just nu.' : accessOnly ? 'Öppna din privata åtgärdsuppföljning. Ingen ny beställning eller kostnad tillkommer.' : 'Ett tillval för den här besiktningen. Kontrollera beställningen och godkänn omfattning, villkor och betalning. Inga godkännanden är förvalda.'}</p>
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
            <legend className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldCheck size={18} className="text-emerald-700" aria-hidden />Personlig beställarlänk</legend>
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Beställarens e-postadress
              <input ref={emailInput} name="email" type="email" autoComplete="email" maxLength={254} required value={fields.email} onChange={event => change('email', event.target.value)} className={inputClass} />
            </label>
            <p className="text-xs leading-5 text-slate-500">Ange adressen som besiktningsmannen har registrerat för beställaren. Kontakt- och fakturauppgifter visas inte för andra som har rapportlänken.</p>
            {message ? <p role="status" className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-700">{message}</p> : null}
          </fieldset> : null}

          {customerOffer && !accessOnly ? <fieldset disabled={!!busy} className="mt-5 min-w-0 space-y-4 border-t border-slate-200 pt-5 disabled:opacity-70">
            <legend className="px-1 text-sm font-semibold">Beställning och faktura</legend>
            <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Jag beställer som
              <select name="customerType" required value={fields.customerType} onChange={event => change('customerType', event.target.value as OrderFields['customerType'])} className={inputClass}>
                <option value="" disabled>Välj privatperson eller företag</option>
                <option value="consumer">Privatperson (konsument)</option>
                <option value="business">Företag eller förening</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-semibold">Ditt namn<input name="name" autoComplete="name" maxLength={150} required value={fields.name} onChange={event => change('name', event.target.value)} className={inputClass} /></label>
            <label className="grid gap-1.5 text-sm font-semibold">Fakturamottagarens namn<input name="invoiceName" autoComplete="billing organization" maxLength={160} required value={fields.invoiceName} onChange={event => change('invoiceName', event.target.value)} className={inputClass} /></label>
            {fields.customerType === 'business' ? <label className="grid gap-1.5 text-sm font-semibold">Organisationsnummer <span className="font-normal text-slate-500">Frivilligt</span><input name="invoiceOrgNo" maxLength={32} value={fields.invoiceOrgNo} onChange={event => change('invoiceOrgNo', event.target.value)} className={inputClass} /></label> : null}
            <label className="grid gap-1.5 text-sm font-semibold">Fakturaadress<input name="invoiceAddress" autoComplete="billing street-address" maxLength={200} required value={fields.invoiceAddress} onChange={event => change('invoiceAddress', event.target.value)} className={inputClass} /></label>
            <div className="grid min-w-0 grid-cols-[1fr_2fr] gap-3">
              <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Postnummer<input name="invoicePostalCode" autoComplete="billing postal-code" maxLength={20} required value={fields.invoicePostalCode} onChange={event => change('invoicePostalCode', event.target.value)} className={inputClass} /></label>
              <label className="grid min-w-0 gap-1.5 text-sm font-semibold">Ort<input name="invoiceCity" autoComplete="billing address-level2" maxLength={100} required value={fields.invoiceCity} onChange={event => change('invoiceCity', event.target.value)} className={inputClass} /></label>
            </div>
            <p className="break-words text-xs leading-5 text-slate-500">Bekräftelsen med beställning och villkor samt uppgifter om faktureringen skickas till beställarens registrerade e-postadress.</p>
            {termsText ? <section aria-label="Tjänstens omfattning och köpvillkor" className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
              <h3 className="font-semibold">Tjänstens omfattning och köpvillkor</h3>
              <p className="mt-1 text-xs text-slate-500">Villkorsversion: {customerOffer.termsVersion}</p>
              <p data-testid="follow-up-terms" className="mt-3 whitespace-pre-wrap break-words leading-6 text-slate-700">{termsText}</p>
              {isConsumer && customerOffer.seller ? <details className="mt-3 border-t border-slate-200 pt-3">
                <summary className="flex min-h-11 cursor-pointer items-center font-semibold">Ångerblankett – för dig som vill ångra ett köp</summary>
                <p data-testid="withdrawal-form" className="mt-2 whitespace-pre-wrap break-words leading-6">{getEbFollowUpWithdrawalFormText(customerOffer.seller)}</p>
                <a href={EB_FOLLOW_UP_WITHDRAWAL_FORM_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex min-h-11 items-center text-emerald-800 underline underline-offset-2">Konsumentverkets standardblankett för ångerrätt (ny flik)</a>
              </details> : null}
            </section> : <p className="rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">Välj kundtyp ovan för att läsa de köpvillkor som gäller för beställningen.</p>}
            {consentTexts ? <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-4">
              <legend className="px-1 text-sm font-semibold">Dina godkännanden</legend>
              <label className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm leading-6"><input name="acceptTerms" type="checkbox" required checked={fields.acceptTerms} onChange={event => change('acceptTerms', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>{consentTexts.acceptTerms}</span></label>
              {isConsumer ? <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-6 text-amber-950">
                <p>Som konsument har du normalt 14 dagars ångerrätt. Du kan ångra beställningen i din privata åtgärdsportal eller lämna ett tydligt meddelande till säljaren. Omedelbar start innebär inte i sig att ångerrätten upphör.</p>
                <label className="flex min-h-11 items-start gap-3"><input name="consumerWithdrawalAcknowledged" type="checkbox" required checked={fields.consumerWithdrawalAcknowledged} onChange={event => change('consumerWithdrawalAcknowledged', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>{consentTexts.consumerWithdrawalAcknowledged}</span></label>
                <label className="flex min-h-11 items-start gap-3"><input name="requestImmediateStart" type="checkbox" required checked={fields.requestImmediateStart} onChange={event => change('requestImmediateStart', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>{consentTexts.requestImmediateStart}</span></label>
              </div> : <label className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm leading-6"><input name="requestImmediateStart" type="checkbox" required checked={fields.requestImmediateStart} onChange={event => change('requestImmediateStart', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>{consentTexts.requestImmediateStart}</span></label>}
              <label className="flex min-h-11 items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm leading-6"><input name="acceptInvoice" type="checkbox" required checked={fields.acceptInvoice} onChange={event => change('acceptInvoice', event.target.checked)} className="mt-1 size-4 shrink-0 accent-emerald-800" /><span>{consentTexts.acceptInvoice}</span></label>
            </fieldset> : null}
          </fieldset> : null}
          {error ? <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm leading-6 text-rose-900">{error}</p> : null}
          <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-slate-200 pt-4">
            <button type="button" disabled={!!busy} onClick={() => dialog.current?.close()} className={`${buttonClass} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>{verified && !customerOffer ? 'Stäng' : 'Avbryt'}</button>
            {termsChanged ? <button type="button" onClick={() => window.location.reload()} className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>Ladda om sidan</button> : verified && !customerOffer && loadError ? <button type="button" disabled={retrying} onClick={() => void retry()} className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>{retrying ? 'Försöker igen…' : 'Försök igen'}</button> : null}
            {!verified || customerOffer ? <button type="submit" disabled={!!busy || (verified && !accessOnly && !consentComplete)} className={`${buttonClass} bg-emerald-800 text-white hover:bg-emerald-900`}>
              {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden /> : verified ? <Check size={18} aria-hidden /> : <Mail size={18} aria-hidden />}
              {busy === 'link' ? 'Skickar länk …' : busy === 'order' ? 'Sparar beställning …' : busy === 'access' ? 'Öppnar …' : !verified ? 'Skicka min beställarlänk' : accessOnly ? 'Öppna utan ny beställning' : `Beställ med betalningsskyldighet – ${priceLabel}`}
            </button> : null}
          </div>
        </form>
      </dialog>
    </section>
  )
}
