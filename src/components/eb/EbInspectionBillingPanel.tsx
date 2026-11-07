'use client'

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { parseEbInspectionBilling, type EbInspectionBilling } from '@/lib/eb/billing'

export type EbInspectionBillingPanelHandle = { flush: () => Promise<boolean> }

type Props = {
  projectId: string
  inspectionId: string
  initialBilling?: EbInspectionBilling
  onChanged: (billing: EbInspectionBilling) => void
  onBusyChange?: (busy: boolean) => void
}

function formatUpdated(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('sv-SE', {
    timeZone: 'Europe/Stockholm', dateStyle: 'short', timeStyle: 'short',
  })
}

const EbInspectionBillingPanel = forwardRef<EbInspectionBillingPanelHandle, Props>(function EbInspectionBillingPanel({ projectId, inspectionId, initialBilling, onChanged, onBusyChange }, ref) {
  const inputId = useId()
  const [billing, setBilling] = useState<EbInspectionBilling | null>(initialBilling ?? null)
  const [invoiceNumber, setInvoiceNumber] = useState(initialBilling?.invoiceNumber ?? '')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [retry, setRetry] = useState<{ isInvoiced: boolean; invoiceNumber: string | null } | null>(null)
  const billingRef = useRef<EbInspectionBilling | null>(initialBilling ?? null)
  const draftRef = useRef(initialBilling?.invoiceNumber ?? '')
  const lastSavedNumber = useRef(initialBilling?.invoiceNumber ?? '')
  const inFlight = useRef<Promise<boolean> | null>(null)
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
  const url = `/api/eb/projects/${encodeURIComponent(projectId)}/inspections/${encodeURIComponent(inspectionId)}/billing`

  const load = useCallback(async () => {
    setLoading(true); setError(null); setSaved(false)
    try {
      const response = await fetch(url, { cache: 'no-store' })
      const payload = await response.json().catch(() => ({}))
      const current = parseEbInspectionBilling(payload.billing)
      if (!response.ok || !current) throw new Error(payload.error || 'Fakturamarkeringen är inte tillgänglig just nu. Inget kan sparas.')
      if (!mounted.current) return
      billingRef.current = current; draftRef.current = current.invoiceNumber ?? ''
      lastSavedNumber.current = draftRef.current
      setBilling(current); setInvoiceNumber(draftRef.current); setRetry(null)
    } catch (caught) {
      if (mounted.current) { billingRef.current = null; setBilling(null); setError(caught instanceof Error ? caught.message : 'Fakturamarkeringen kunde inte hämtas.') }
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
    if (!current || current.status === 'unavailable') return false
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
      const updated = parseEbInspectionBilling(payload.billing)
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
      setSaved(true); setRetry(null); onChangedRef.current(updated)
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

  useImperativeHandle(ref, () => ({ flush: async () => {
    if (inFlight.current && !(await inFlight.current)) return false
    const current = billingRef.current
    const number = draftRef.current.trim() || null
    if (number === (lastSavedNumber.current.trim() || null)) return true
    if (!current || current.status === 'unavailable') return false
    return save({ isInvoiced: current.status === 'invoiced', invoiceNumber: number })
  } }), [save])

  const available = !loading && billing && billing.status !== 'unavailable'
  const numberDirty = invoiceNumber.trim() !== (billing?.invoiceNumber ?? '')
  return (
    <section aria-label="Intern fakturamarkering" className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/40 p-4">
      <div>
        <h3 className="text-sm font-semibold text-gray-950">Fakturamarkering</h3>
        <p className="mt-1 text-sm text-gray-600">Intern markering för denna besiktning. Skapar ingen faktura och betyder inte att kunden har betalat.</p>
      </div>
      <label onPointerDown={() => { checkboxPointerIntent.current = true }}
        onPointerCancel={() => { checkboxPointerIntent.current = false }}
        className="flex min-h-11 items-center gap-3 text-sm font-medium text-gray-900">
        <input ref={checkboxRef} type="checkbox" checked={billing?.status === 'invoiced'} disabled={!available || saving}
          onChange={event => { checkboxPointerIntent.current = false; void save({ isInvoiced: event.target.checked, invoiceNumber: invoiceNumber.trim() || null }) }}
          className="h-5 w-5 rounded border-emerald-300 accent-emerald-700 disabled:opacity-50" />
        Fakturerad
      </label>
      <div>
        <label htmlFor={inputId} className="mb-1 block text-sm font-medium text-gray-700">Fakturanummer (valfritt)</label>
        <input ref={numberRef} id={inputId} value={invoiceNumber} maxLength={100} disabled={!available || saving}
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
          : saved ? <span className="inline-flex items-center gap-2 text-emerald-800"><CheckCircle2 size={16} />Faktureringen är sparad.</span>
            : available ? <span className="text-gray-700">{billing.status === 'invoiced' ? 'Fakturerad' : 'Ej fakturerad'}</span> : null}
      </div>
      {billing?.updatedAt && <p className="text-xs text-gray-600">Senast ändrad {formatUpdated(billing.updatedAt)}{billing.updatedByName ? ` av ${billing.updatedByName}` : ''}.</p>}
      {error && <div role="alert" className="space-y-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
        <p>{error}</p>
        <div className="flex flex-wrap gap-3">
          {retry && available && <button type="button" disabled={saving} onClick={() => void save(retry)} className="min-h-11 font-semibold underline">Försök spara igen</button>}
          <button type="button" disabled={saving || loading} onClick={() => void load()} className="min-h-11 font-semibold underline">Hämta aktuell status</button>
        </div>
      </div>}
    </section>
  )
})

export default EbInspectionBillingPanel
