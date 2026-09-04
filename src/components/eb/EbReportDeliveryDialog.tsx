'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  LockKeyhole,
  LockOpen,
  RefreshCw,
  Send,
  X,
} from 'lucide-react'
import { useEbToast } from '@/components/eb/EbToastProvider'
import type { EbInspectionSummary, EbProjectListItem } from '@/lib/eb/server'

type DeliveryAction = 'lock_only' | 'send_and_lock' | 'regenerate_pdf'

type DeliveryHistoryItem = {
  id?: string | null
  recipientEmail?: string | null
  recipient_email?: string | null
  status?: string | null
  sentAt?: string | null
  sent_at?: string | null
  createdAt?: string | null
  created_at?: string | null
  errorMessage?: string | null
  error_message?: string | null
  subject?: string | null
}

type DeliveryActivityItem = {
  id?: string | null
  type?: string | null
  title?: string | null
  subtitle?: string | null
  occurredAt?: string | null
  occurred_at?: string | null
}

type DeliveryResponse = {
  error?: string
  project?: EbProjectListItem
  reportLockedAt?: string | null
  hasActiveLink?: boolean
  pdfStatus?: string | null
  pdfError?: string | null
  downloadUrl?: string | null
  digitalUrl?: string | null
  publicLink?: string | null
  defaultRecipientEmail?: string | null
  defaultExtraRecipients?: string[]
  ordererEmail?: string | null
  hasBeenSent?: boolean
  deliveryStatus?: 'draft' | 'finalized' | 'sending' | 'sent' | 'failed'
  history?: DeliveryHistoryItem[]
  activityLog?: DeliveryActivityItem[]
  sentRecipients?: string[]
  failedRecipients?: Array<{ email: string; error?: string | null }>
}

type DeliveryMeta = {
  reportLockedAt: string | null
  hasActiveLink: boolean
  pdfStatus: string | null
  pdfError: string | null
  downloadUrl: string | null
  digitalUrl: string | null
  defaultRecipientEmail: string | null
  ordererEmail: string | null
  hasBeenSent: boolean
  deliveryStatus: 'draft' | 'finalized' | 'sending' | 'sent' | 'failed'
  history: DeliveryHistoryItem[]
  activityLog: DeliveryActivityItem[]
}

function initialMeta(inspection: EbInspectionSummary): DeliveryMeta {
  return {
    reportLockedAt: inspection.reportLockedAt,
    hasActiveLink: Boolean(inspection.reportPdfCreatedAt || inspection.reportPdfDownloadUrl),
    pdfStatus: inspection.reportPdfStatus,
    pdfError: inspection.reportPdfError,
    downloadUrl: inspection.reportPdfDownloadUrl,
    digitalUrl: null,
    defaultRecipientEmail: null,
    ordererEmail: null,
    hasBeenSent: inspection.reportDeliveryStatus === 'sent',
    deliveryStatus:
      inspection.reportDeliveryStatus === 'sent'
        ? 'sent'
        : inspection.reportDeliveryStatus === 'failed'
          ? 'failed'
          : inspection.reportLockedAt
            ? 'finalized'
            : 'draft',
    history: [],
    activityLog: [],
  }
}

function mergeMeta(current: DeliveryMeta, payload: DeliveryResponse): DeliveryMeta {
  return {
    reportLockedAt: payload.reportLockedAt !== undefined ? payload.reportLockedAt : current.reportLockedAt,
    hasActiveLink: payload.hasActiveLink ?? current.hasActiveLink,
    pdfStatus: payload.pdfStatus !== undefined ? payload.pdfStatus : current.pdfStatus,
    pdfError: payload.pdfError !== undefined ? payload.pdfError : current.pdfError,
    downloadUrl: payload.downloadUrl !== undefined ? payload.downloadUrl : current.downloadUrl,
    digitalUrl: payload.digitalUrl ?? payload.publicLink ?? current.digitalUrl,
    defaultRecipientEmail:
      payload.defaultRecipientEmail !== undefined
        ? payload.defaultRecipientEmail
        : current.defaultRecipientEmail,
    ordererEmail: payload.ordererEmail !== undefined ? payload.ordererEmail : current.ordererEmail,
    hasBeenSent: payload.hasBeenSent ?? current.hasBeenSent,
    deliveryStatus: payload.deliveryStatus ?? current.deliveryStatus,
    history: payload.history ?? current.history,
    activityLog: payload.activityLog ?? current.activityLog,
  }
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

function parseExtraRecipients(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item, index, values) => item && isValidEmail(item) && values.indexOf(item) === index)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Tid saknas'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('sv-SE', { dateStyle: 'medium', timeStyle: 'short' })
}

function historyRecipient(item: DeliveryHistoryItem) {
  return item.recipientEmail ?? item.recipient_email ?? 'Mottagare saknas'
}

function historyTime(item: DeliveryHistoryItem) {
  return item.sentAt ?? item.sent_at ?? item.createdAt ?? item.created_at
}

function historyError(item: DeliveryHistoryItem) {
  return item.errorMessage ?? item.error_message ?? null
}

function deliveryStatusLabel(value: string | null | undefined) {
  const status = value?.trim().toLowerCase()
  if (status === 'sent') return 'Skickad'
  if (status === 'failed') return 'Misslyckad'
  if (status === 'pending' || status === 'queued') return 'Väntar'
  return value || 'Okänd status'
}

function pdfStatusLabel(value: string | null | undefined) {
  if (value === 'ready') return 'PDF klar'
  if (value === 'processing') return 'PDF skapas'
  if (value === 'pending') return 'PDF väntar'
  if (value === 'failed') return 'PDF misslyckades'
  return 'Ingen PDF'
}

function pdfStatusClasses(value: string | null | undefined) {
  if (value === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-800'
  if (value === 'failed') return 'border-rose-200 bg-rose-50 text-rose-800'
  if (value === 'processing' || value === 'pending') {
    return 'border-amber-200 bg-amber-50 text-amber-900'
  }
  return 'border-gray-200 bg-gray-50 text-gray-600'
}

export default function EbReportDeliveryDialog({
  open,
  projectId,
  inspection,
  onClose,
  onProjectUpdated,
  onChanged,
}: {
  open: boolean
  projectId: string
  inspection: EbInspectionSummary | null
  onClose: () => void
  onProjectUpdated: (project: EbProjectListItem) => void
  onChanged: () => void
}) {
  const { showError } = useEbToast()
  const [meta, setMeta] = useState<DeliveryMeta | null>(null)
  const [recipientEmail, setRecipientEmail] = useState('')
  const [extraRecipients, setExtraRecipients] = useState('')
  const [loading, setLoading] = useState(false)
  const [busyAction, setBusyAction] = useState<DeliveryAction | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const recipientsInitializedRef = useRef(false)
  const closeRef = useRef(onClose)
  const mutationBusyRef = useRef(false)

  useEffect(() => {
    closeRef.current = onClose
  }, [onClose])

  useEffect(() => {
    mutationBusyRef.current = Boolean(busyAction) || unlockBusy
  }, [busyAction, unlockBusy])

  const endpoint = inspection
    ? `/api/eb/projects/${projectId}/inspections/${inspection.inspectionId}/report-delivery`
    : null

  const applyResponse = useCallback(
    (payload: DeliveryResponse) => {
      setMeta((current) => mergeMeta(current ?? initialMeta(inspection!), payload))
      if (payload.project) onProjectUpdated(payload.project)
    },
    [inspection, onProjectUpdated]
  )

  const loadMeta = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!endpoint || !inspection) return
      if (!options?.silent) setLoading(true)
      try {
        const response = await fetch(endpoint, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as DeliveryResponse
        if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta leveransstatus.')
        applyResponse(payload)
        if (!recipientsInitializedRef.current) {
          setRecipientEmail(payload.defaultRecipientEmail ?? payload.ordererEmail ?? '')
          setExtraRecipients((payload.defaultExtraRecipients ?? []).join('\n'))
          recipientsInitializedRef.current = true
        }
      } catch (error) {
        showError(error, 'Kunde inte hämta leveransstatus.')
      } finally {
        if (!options?.silent) setLoading(false)
      }
    },
    [applyResponse, endpoint, inspection, showError]
  )

  useEffect(() => {
    if (!open || !inspection) return
    recipientsInitializedRef.current = false
    setMeta(initialMeta(inspection))
    setRecipientEmail('')
    setExtraRecipients('')
    setResult(null)
    setUnlockOpen(false)
    setUnlockReason('')
    void loadMeta()
  }, [inspection, loadMeta, open])

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !mutationBusyRef.current) {
        event.preventDefault()
        closeRef.current()
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => !element.hasAttribute('hidden'))
      if (focusable.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      previousFocus?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open || (meta?.pdfStatus !== 'pending' && meta?.pdfStatus !== 'processing')) return
    const timer = window.setInterval(() => void loadMeta({ silent: true }), 3000)
    return () => window.clearInterval(timer)
  }, [loadMeta, meta?.pdfStatus, open])

  const runDelivery = async (action: DeliveryAction) => {
    if (!endpoint || busyAction || unlockBusy) return
    const primary = recipientEmail.trim().toLowerCase()
    const extras = parseExtraRecipients(extraRecipients)
    if (action === 'send_and_lock' && !isValidEmail(primary)) {
      showError('Ange en giltig e-postadress för huvudmottagaren.')
      return
    }

    setBusyAction(action)
    setResult(null)
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          recipientEmail: primary,
          extraRecipients: extras,
          primary_recipient: primary,
          extra_recipients: extras,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as DeliveryResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hantera utlåtandet.')
      applyResponse(payload)
      if (action === 'lock_only') {
        setResult('Utlåtandet är fastställt. Den digitala versionen och PDF-filen skapas nu.')
      } else if (action === 'regenerate_pdf') {
        setResult('PDF-genereringen har startats om. Statusen uppdateras automatiskt.')
      } else {
        const sent = payload.sentRecipients?.length
        const failed = payload.failedRecipients?.length ?? 0
        setResult(
          sent === undefined
            ? 'Utlåtandet har skickats.'
            : `Utlåtandet skickades till ${sent} mottagare${failed ? `. ${failed} utskick misslyckades` : ''}.`
        )
      }
      onChanged()
    } catch (error) {
      showError(error, 'Kunde inte hantera utlåtandet.')
    } finally {
      setBusyAction(null)
    }
  }

  const runUnlock = async () => {
    if (!inspection || unlockBusy || busyAction) return
    const reason = unlockReason.trim()
    if (reason.length < 10) {
      showError('Ange en anledning på minst 10 tecken.')
      return
    }

    setUnlockBusy(true)
    setResult(null)
    try {
      const response = await fetch(
        `/api/eb/projects/${projectId}/inspections/${inspection.inspectionId}/unlock`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        }
      )
      const payload = (await response.json().catch(() => ({}))) as DeliveryResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte låsa upp utlåtandet.')
      applyResponse({ ...payload, reportLockedAt: null })
      setUnlockOpen(false)
      setUnlockReason('')
      setResult(
        'Utlåtandet är upplåst. Den senast publicerade versionen ligger kvar tills du fastställer en ny.'
      )
      await loadMeta({ silent: true })
      onChanged()
    } catch (error) {
      showError(error, 'Kunde inte låsa upp utlåtandet.')
    } finally {
      setUnlockBusy(false)
    }
  }

  const locked = Boolean(meta?.reportLockedAt)
  const hasSentDelivery = meta?.hasBeenSent ?? false
  const busy = loading || Boolean(busyAction) || unlockBusy
  const canSend = locked && isValidEmail(recipientEmail) && !busy

  if (!open || !inspection) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-slate-950/45 px-4 py-6 backdrop-blur-[1px] sm:py-10"
      role="dialog"
      aria-modal="true"
      aria-labelledby="eb-report-delivery-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyAction && !unlockBusy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-3xl overflow-hidden rounded-xl border border-emerald-100 bg-white shadow-2xl outline-none"
      >
        <header className="flex items-start justify-between gap-4 border-b border-emerald-100 px-5 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-700">
              {inspection.variantLabel}
            </p>
            <h2 id="eb-report-delivery-title" className="mt-1 text-xl font-semibold text-gray-950">
              Fastställ och leverera
            </h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Fastställ en fryst version, välj mottagare och skicka samma version digitalt.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busyAction) || unlockBusy}
            aria-label="Stäng"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-gray-200 text-gray-600 transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-5 px-5 py-5 sm:px-6">
          <div className="flex flex-wrap gap-2" aria-live="polite">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                locked
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {locked ? <CheckCircle2 size={13} aria-hidden="true" /> : null}
              {locked ? 'Fastställt och låst' : 'Utkast'}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                meta?.hasActiveLink
                  ? 'border-blue-200 bg-blue-50 text-blue-800'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
              }`}
            >
              {meta?.hasActiveLink ? 'Digital version fastställd' : 'Ingen fastställd version'}
            </span>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${pdfStatusClasses(meta?.pdfStatus)}`}>
              {meta?.pdfStatus === 'processing' || meta?.pdfStatus === 'pending' ? (
                <Loader2 size={12} className="mr-1 inline animate-spin" aria-hidden="true" />
              ) : null}
              {pdfStatusLabel(meta?.pdfStatus)}
            </span>
            <span
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                hasSentDelivery
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-gray-200 bg-gray-50 text-gray-600'
              }`}
            >
              {hasSentDelivery
                ? locked
                  ? 'Fastställd version skickad'
                  : 'Tidigare version skickad'
                : 'Inte skickat'}
            </span>
          </div>

          <div className="grid overflow-hidden rounded-lg border border-gray-200 sm:grid-cols-2">
            <div className={`flex gap-3 p-4 ${locked ? 'bg-emerald-50' : 'bg-emerald-50/60'}`}>
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-700 text-xs font-bold text-white">
                {locked ? '✓' : '1'}
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-950">Fastställ utlåtandet</p>
                <p className="mt-1 text-xs leading-5 text-gray-600">
                  {locked
                    ? `Fastställt ${formatDateTime(meta?.reportLockedAt)}.`
                    : 'Skapar en oföränderlig version med digital länk och PDF.'}
                </p>
              </div>
            </div>
            <div className={`flex gap-3 border-t border-gray-200 p-4 sm:border-l sm:border-t-0 ${locked ? 'bg-blue-50/70' : 'bg-gray-50'}`}>
              <span
                className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  locked ? 'bg-blue-700 text-white' : 'border border-gray-300 bg-white text-gray-400'
                }`}
              >
                2
              </span>
              <div>
                <p className={`text-sm font-semibold ${locked ? 'text-gray-950' : 'text-gray-500'}`}>
                  Välj mottagare och skicka
                </p>
                <p className="mt-1 text-xs leading-5 text-gray-600">
                  {locked
                    ? 'Skicka länken till den fastställda versionen.'
                    : 'Mottagarvalet öppnas efter fastställandet.'}
                </p>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="flex min-h-28 items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-sm font-medium text-gray-600">
              <Loader2 size={18} className="mr-2 animate-spin" aria-hidden="true" />
              Hämtar leveransstatus...
            </div>
          ) : null}

          {!loading && !locked ? (
            <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
              <h3 className="text-sm font-semibold text-gray-950">Steg 1 · Fastställ versionen</h3>
              <p className="mt-1 text-sm leading-6 text-gray-600">
                När utlåtandet fastställs låses redigeringen och den version som ska levereras sparas.
              </p>
              <button
                type="button"
                onClick={() => void runDelivery('lock_only')}
                disabled={busy}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-800 disabled:cursor-wait disabled:bg-emerald-300"
              >
                {busyAction === 'lock_only' ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <LockKeyhole size={16} aria-hidden="true" />
                )}
                {busyAction === 'lock_only' ? 'Fastställer utlåtandet...' : 'Fastställ utlåtandet'}
              </button>
            </section>
          ) : null}

          {!loading && locked ? (
            <section className="rounded-lg border border-blue-200 bg-blue-50/40 p-4">
              <h3 className="text-sm font-semibold text-gray-950">Steg 2 · Välj mottagare och skicka</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">Huvudmottagare</span>
                  <input
                    type="email"
                    value={recipientEmail}
                    onChange={(event) => setRecipientEmail(event.target.value)}
                    disabled={busy}
                    placeholder="namn@epost.se"
                    className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100"
                  />
                  <p className="text-[11px] text-gray-500">
                    Föreslagen: {meta?.ordererEmail ?? meta?.defaultRecipientEmail ?? 'E-postadress saknas'}
                  </p>
                </label>
                <label className="space-y-1">
                  <span className="text-xs font-semibold text-gray-700">Extra mottagare</span>
                  <textarea
                    value={extraRecipients}
                    onChange={(event) => setExtraRecipients(event.target.value)}
                    disabled={busy}
                    rows={3}
                    placeholder="En eller flera adresser, separerade med komma"
                    className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-gray-100"
                  />
                </label>
              </div>
              <button
                type="button"
                onClick={() => void runDelivery('send_and_lock')}
                disabled={!canSend}
                className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {busyAction === 'send_and_lock' ? (
                  <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                ) : (
                  <Send size={16} aria-hidden="true" />
                )}
                {busyAction === 'send_and_lock' ? 'Skickar utlåtandet...' : 'Skicka utlåtandet'}
              </button>
            </section>
          ) : null}

          {result ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800" role="status">
              {result}
            </p>
          ) : null}

          {meta?.pdfStatus === 'failed' ? (
            <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">
              {meta.pdfError || 'PDF-filen kunde inte skapas. Starta om genereringen nedan.'}
            </p>
          ) : null}

          {meta?.hasActiveLink ? (
            <section className="rounded-lg border border-gray-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-950">Publicerad version</h3>
                  <p className="mt-1 text-xs leading-5 text-gray-500">
                    Denna version ligger kvar för mottagarna tills en ny version fastställs.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadMeta()}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-200 bg-white px-3 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden="true" />
                  Uppdatera status
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {meta.digitalUrl ? (
                  <a
                    href={meta.digitalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-700 bg-white px-3 text-sm font-semibold text-emerald-800 transition hover:bg-emerald-50"
                  >
                    <ExternalLink size={15} aria-hidden="true" />
                    Öppna digitalt utlåtande
                  </a>
                ) : null}
                {meta.downloadUrl ? (
                  <a
                    href={meta.downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
                  >
                    <Download size={15} aria-hidden="true" />
                    Ladda ner PDF
                  </a>
                ) : (
                  <span className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-500">
                    <FileText size={15} aria-hidden="true" />
                    {pdfStatusLabel(meta.pdfStatus)}
                  </span>
                )}
                {meta.pdfStatus !== 'pending' && meta.pdfStatus !== 'processing' ? (
                  <button
                    type="button"
                    onClick={() => void runDelivery('regenerate_pdf')}
                    disabled={busy}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-wait disabled:opacity-50"
                  >
                    {busyAction === 'regenerate_pdf' ? (
                      <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                    ) : (
                      <RefreshCw size={15} aria-hidden="true" />
                    )}
                    {busyAction === 'regenerate_pdf' ? 'Startar om...' : 'Skapa PDF igen'}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          {meta?.history.length ? (
            <section className="rounded-lg border border-gray-200 bg-gray-50 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-600">
                Leveranshistorik
              </h3>
              <div className="mt-3 divide-y divide-gray-200">
                {meta.history.slice(0, 8).map((item, index) => {
                  const failed = item.status?.toLowerCase() === 'failed'
                  return (
                    <div key={item.id ?? `${historyRecipient(item)}-${index}`} className="flex flex-wrap items-start justify-between gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900">{historyRecipient(item)}</p>
                        {historyError(item) ? <p className="mt-0.5 text-xs text-rose-700">{historyError(item)}</p> : null}
                      </div>
                      <span className={`text-xs font-semibold ${failed ? 'text-rose-700' : 'text-gray-600'}`}>
                        {deliveryStatusLabel(item.status)} · {formatDateTime(historyTime(item))}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          ) : null}

          {meta?.activityLog.length ? (
            <section className="rounded-lg border border-gray-200 bg-white p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-gray-600">
                Händelser
              </h3>
              <div className="mt-3 space-y-2">
                {meta.activityLog.slice(0, 6).map((item, index) => (
                  <div key={item.id ?? `${item.type}-${index}`} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                    <div>
                      <p className="font-medium text-gray-900">{item.title || 'Utlåtandet uppdaterades'}</p>
                      {item.subtitle ? <p className="text-xs text-gray-500">{item.subtitle}</p> : null}
                    </div>
                    <span className="text-xs text-gray-500">{formatDateTime(item.occurredAt ?? item.occurred_at)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {locked ? (
            <section className="border-t border-gray-200 pt-4">
              {!unlockOpen ? (
                <button
                  type="button"
                  onClick={() => setUnlockOpen(true)}
                  disabled={busy}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                >
                  <LockOpen size={14} aria-hidden="true" />
                  Lås upp för redigering
                </button>
              ) : (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                  <h3 className="text-sm font-semibold text-rose-950">Lås upp utlåtandet</h3>
                  <p className="mt-1 text-xs leading-5 text-rose-800">
                    Ange varför utlåtandet öppnas igen. Den publicerade versionen ligger kvar tills en ny fastställs.
                  </p>
                  <textarea
                    value={unlockReason}
                    onChange={(event) => setUnlockReason(event.target.value)}
                    disabled={unlockBusy}
                    rows={3}
                    placeholder="Anledning, minst 10 tecken"
                    className="mt-3 w-full resize-y rounded-md border border-rose-200 bg-white px-3 py-2 text-sm outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-100 disabled:bg-gray-100"
                  />
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUnlockOpen(false)
                        setUnlockReason('')
                      }}
                      disabled={unlockBusy}
                      className="h-9 rounded-md border border-gray-300 bg-white px-3 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                      Avbryt
                    </button>
                    <button
                      type="button"
                      onClick={() => void runUnlock()}
                      disabled={unlockBusy || unlockReason.trim().length < 10}
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-rose-700 px-3 text-xs font-semibold text-white hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-200 disabled:text-rose-700"
                    >
                      {unlockBusy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <LockOpen size={14} aria-hidden="true" />}
                      {unlockBusy ? 'Låser upp...' : 'Lås upp utlåtandet'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  )
}
