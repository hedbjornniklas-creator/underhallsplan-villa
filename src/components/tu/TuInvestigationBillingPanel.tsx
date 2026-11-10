'use client'

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { parseTuInvestigationBilling, parseTuInvestigationBillingStatus, type TuInvestigationBilling, type TuInvestigationBillingStatus } from '@/lib/tu/billing'

export type TuInvestigationBillingPanelHandle = { flush: () => Promise<boolean> }

type Props = {
  portalTarget?: HTMLElement | null
  inspectionId: string
  organizationId: string
  initialBilling?: TuInvestigationBilling
  onChanged?: (billing: TuInvestigationBilling) => void
  onBusyChange?: (busy: boolean) => void
}

function formatUpdated(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short',
  })
}

const TuInvestigationBillingPanel = forwardRef<TuInvestigationBillingPanelHandle, Props>(function TuInvestigationBillingPanel({ inspectionId, organizationId, initialBilling, onChanged, onBusyChange, portalTarget }, ref) {
  const inputId = useId()
  const toast = useToast()
  const [canEdit, setCanEdit] = useState(false)
  const [readonlyStatus, setReadonlyStatus] = useState<TuInvestigationBillingStatus | null>(null)
  const canEditRef = useRef(false)
  const [billing, setBilling] = useState<TuInvestigationBilling | null>(initialBilling ?? null)
  const [invoiceNumber, setInvoiceNumber] = useState(initialBilling?.invoiceNumber ?? '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState<{ isInvoiced: boolean; invoiceNumber: string | null } | null>(null)
  const billingRef = useRef<TuInvestigationBilling | null>(initialBilling ?? null)
  const draftRef = useRef(initialBilling?.invoiceNumber ?? '')
  const lastSavedNumber = useRef(initialBilling?.invoiceNumber ?? '')
  const inFlight = useRef<Promise<boolean> | null>(null)
  const navigationAttempt = useRef(0)
  const checkboxRef = useRef<HTMLInputElement>(null)
  const numberRef = useRef<HTMLInputElement>(null)
  const checkboxPointerIntent = useRef(false)
  const mounted = useRef(true)
  const onChangedRef = useRef(onChanged)
  const onBusyChangeRef = useRef(onBusyChange)
  useEffect(() => { onChangedRef.current = onChanged; onBusyChangeRef.current = onBusyChange }, [onChanged, onBusyChange])
  useLayoutEffect(() => {
    // The focused input was disabled while saving. Restore focus after the
    // enabled DOM has committed, so Escape/retry stays inside this dialog.
    if (error && !saving) numberRef.current?.focus({ preventScroll: true })
  }, [error, saving])
  const url = `/api/tu/investigations/${encodeURIComponent(inspectionId)}/billing?orgId=${encodeURIComponent(organizationId)}`

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSaved(false); setReadonlyStatus(null)
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Fakturamarkeringen är inte tillgänglig just nu. Inget kan sparas.')
      if (payload.canEdit === false) {
        const status = parseTuInvestigationBillingStatus(payload.billing)
        if (!status) throw new Error('Fakturastatus kunde inte hämtas.')
        if (!mounted.current) return
        canEditRef.current = false; setCanEdit(false); setReadonlyStatus(status)
        billingRef.current = null; draftRef.current = ''; lastSavedNumber.current = ''
        setBilling(null); setInvoiceNumber(''); setRetry(null)
        return
      }
      const current = parseTuInvestigationBilling(payload.billing)
      if (payload.canEdit !== true || !current) throw new Error(payload.error || 'Fakturamarkeringen är inte tillgänglig just nu. Inget kan sparas.')
      if (!mounted.current) return
      canEditRef.current = payload.canEdit === true; setCanEdit(canEditRef.current)
      billingRef.current = current; draftRef.current = current.invoiceNumber ?? ''
      lastSavedNumber.current = draftRef.current
      setBilling(current); setInvoiceNumber(draftRef.current); setRetry(null)
    } catch (caught) {
      if (mounted.current) { canEditRef.current = false; setCanEdit(false); billingRef.current = null; setBilling(null); setError(caught instanceof Error ? caught.message : 'Fakturamarkeringen kunde inte hämtas.') }
    } finally { if (mounted.current) setLoading(false) }
  }, [url])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => { mounted.current = false }
  }, [load])

  const save = useCallback(async (next: { isInvoiced: boolean; invoiceNumber: string | null }): Promise<boolean> => {
    if (inFlight.current && !(await inFlight.current)) return false
    const current = billingRef.current
    if (!current || current.status === 'unavailable' || !canEditRef.current) return false
    if (next.isInvoiced === (current.status === 'invoiced') && next.invoiceNumber === current.invoiceNumber) {
      draftRef.current = current.invoiceNumber ?? ''; setInvoiceNumber(draftRef.current)
      return true
    }
    setSaving(true); setSaved(false); setError(null); setRetry(next)
    onBusyChangeRef.current?.(true)
    const request = (async () => { try {
      const response = await fetch(url, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...next, expectedRevision: current.revision }),
      })
      const payload = await response.json().catch(() => ({}))
      const updated = parseTuInvestigationBilling(payload.billing)
      if (!response.ok || !updated) {
        if (response.status === 409) {
          setRetry(null)
          throw new Error('Faktureringen ändrades av någon annan. Hämta aktuell status innan du försöker igen.')
        }
        throw new Error(payload.error || 'Fakturamarkeringen kunde inte sparas. Ingen ändring är bekräftad.')
      }
      if (!mounted.current) return false
      billingRef.current = updated; draftRef.current = updated.invoiceNumber ?? ''
      lastSavedNumber.current = draftRef.current
      setBilling(updated); setInvoiceNumber(draftRef.current)
      setSaved(true); setRetry(null); onChangedRef.current?.(updated)
      window.dispatchEvent(new Event('tu-investigation-billing-updated'))
      return true
    } catch (caught) {
      if (mounted.current) {
        setError(caught instanceof Error ? caught.message : 'Fakturamarkeringen kunde inte sparas.')
      }
      return false
    } finally {
      if (mounted.current) setSaving(false)
      onBusyChangeRef.current?.(false)
    } })()
    inFlight.current = request
    try { return await request } finally { if (inFlight.current === request) inFlight.current = null }
  }, [url])

  const flush = useCallback(async () => {
    if (inFlight.current && !(await inFlight.current)) return false
    const current = billingRef.current
    const number = draftRef.current.trim() || null
    if (number === (lastSavedNumber.current.trim() || null)) return true
    if (!current || current.status === 'unavailable') return false
    return save({ isInvoiced: current.status === 'invoiced', invoiceNumber: number })
  }, [save])
  useImperativeHandle(ref, () => ({ flush }), [flush])
  useEffect(() => { if (portalTarget === null) void flush() }, [portalTarget, flush])
  useEffect(() => {
    let approved: HTMLAnchorElement | null = null
    const beforeLink = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null
      if (!anchor || anchor === approved || anchor.target === '_blank' || anchor.hasAttribute('download') || !canEditRef.current) return
      const destination = new URL(anchor.href, location.href)
      if (destination.origin !== location.origin || destination.pathname === location.pathname) return
      if (!inFlight.current && (draftRef.current.trim() || null) === (lastSavedNumber.current.trim() || null)) return
      event.preventDefault(); event.stopImmediatePropagation()
      const attempt = ++navigationAttempt.current
      void flush().then(ok => {
        if (!mounted.current || attempt !== navigationAttempt.current) return
        if (ok) { approved = anchor; anchor.click(); approved = null }
        else toast.error('Faktureringen kunde inte sparas. Öppna leveranssteget och försök igen innan du lämnar utredningen.')
      })
    }
    document.addEventListener('click', beforeLink, true)
    return () => document.removeEventListener('click', beforeLink, true)
  }, [flush, toast])

  const available = !loading && billing && billing.status !== 'unavailable'
  const numberDirty = invoiceNumber.trim() !== (billing?.invoiceNumber ?? '')
  useEffect(() => {
    const hasUnsaved = () => canEditRef.current && (Boolean(inFlight.current) ||
      (draftRef.current.trim() || null) !== (lastSavedNumber.current.trim() || null))
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return
      event.preventDefault(); event.returnValue = ''
    }
    const beforeOrganizationSwitch = (event: Event) => {
      if (!hasUnsaved()) return
      event.preventDefault()
      toast.error('Faktureringen sparas eller har osparade ändringar. Spara i leveranssteget innan du byter organisation.')
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('hushub:before-organization-switch', beforeOrganizationSwitch)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('hushub:before-organization-switch', beforeOrganizationSwitch)
    }
  }, [toast])
  const content = (
    <section aria-label="Intern fakturamarkering" className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-950">Fakturering – endast internt</h3>
        <p className="mt-1 text-sm text-gray-600">Intern markering för denna utredning. Skapar ingen faktura och betyder inte att kunden har betalat.</p>
      </div>
      {readonlyStatus ? <p className="text-sm text-gray-700"><strong>{readonlyStatus.status === 'invoiced' ? 'Fakturerad' : readonlyStatus.status === 'not_invoiced' ? 'Ej fakturerad' : 'Ej tillgänglig'}</strong> · Endast läsning.</p> : <>
      <label onPointerDown={() => { checkboxPointerIntent.current = true }}
        onPointerCancel={() => { checkboxPointerIntent.current = false }}
        className="flex min-h-11 items-center gap-3 text-sm font-medium text-gray-900">
        <input ref={checkboxRef} type="checkbox" checked={billing?.status === 'invoiced'} disabled={!available || !canEdit || saving}
          onChange={event => { checkboxPointerIntent.current = false; void save({ isInvoiced: event.target.checked, invoiceNumber: invoiceNumber.trim() || null }) }}
          className="h-5 w-5 rounded border-violet-300 accent-violet-700 disabled:opacity-50" />
        Fakturerad
      </label>
      <div>
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">Fakturanummer (valfritt)</label>
        <input ref={numberRef} id={inputId} value={invoiceNumber} maxLength={100} disabled={!available || !canEdit || saving}
          onChange={event => { draftRef.current = event.target.value; setInvoiceNumber(event.target.value); setSaved(false) }}
          onFocus={() => { checkboxPointerIntent.current = false }}
          onBlur={event => { if (!checkboxPointerIntent.current && event.relatedTarget !== checkboxRef.current && numberDirty && billing) void save({ isInvoiced: billing.status === 'invoiced', invoiceNumber: invoiceNumber.trim() || null }) }}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); if (billing) void save({ isInvoiced: billing.status === 'invoiced', invoiceNumber: invoiceNumber.trim() || null }) }
          }}
          placeholder="Exempel: 2026-1043" className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-base text-gray-950 disabled:bg-gray-50 disabled:text-gray-500 sm:text-sm" />
      </div>
      <p className="text-xs text-gray-600">Markeringen sparas direkt. Fakturanumret sparas när du lämnar fältet eller trycker Enter.</p>
      <div className="min-h-5 text-sm" role="status" aria-live="polite">
        {loading || saving ? <span className="inline-flex items-center gap-2 text-gray-600"><Loader2 size={16} className="animate-spin" />{loading ? 'Hämtar fakturastatus…' : 'Sparar fakturering…'}</span>
          : saved ? <span className="inline-flex items-center gap-2 text-violet-800"><CheckCircle2 size={16} />Faktureringen är sparad.</span>
            : available ? <span className="text-gray-700">{billing.status === 'invoiced' ? 'Fakturerad' : 'Ej fakturerad'}</span> : null}
      </div>
      {billing?.updatedAt && <p className="text-xs text-gray-600">Senast ändrad {formatUpdated(billing.updatedAt)}{billing.updatedByName ? ` av ${billing.updatedByName}` : ''}.</p>}
      {error && <div role="alert" className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <p>{error}</p>
        <div className="flex flex-wrap gap-3">
          {retry && available && canEdit && <button type="button" disabled={saving} onClick={() => void save(retry)} className="min-h-11 font-semibold underline">Försök spara igen</button>}
          <button type="button" disabled={saving || loading} onClick={() => void load()} className="min-h-11 font-semibold underline">Hämta aktuell status</button>
        </div>
      </div>}
      </>}
    </section>
  )
  return portalTarget === undefined ? content : portalTarget ? createPortal(content, portalTarget) : null
})

export default TuInvestigationBillingPanel
