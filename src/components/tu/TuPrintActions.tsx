'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, LockKeyhole, LockOpen, Printer, RefreshCw, Send } from 'lucide-react'

type DeliveryAction = 'send_and_lock' | 'send_open' | 'lock_only'

type DeliveryHistoryItem = {
  id: string
  recipient_email: string | null
  status: string | null
  sent_at: string | null
  created_at: string | null
  error_message: string | null
  subject: string | null
}

type DeliveryDocumentItem = {
  id: string
  title: string | null
  fileName: string | null
  fileSizeBytes: number | null
}

type DeliveryActivityLogEntry = {
  id: string
  type: 'report_sent' | 'report_unlocked'
  title: string
  subtitle: string | null
  occurred_at: string | null
}

type DeliveryResponse = {
  error?: string
  reportLockedAt: string | null
  inspectionStatus: string | null
  defaultRecipientEmail: string | null
  ordererEmail: string | null
  hasActiveLink: boolean
  pdfStatus: string | null
  pdfError: string | null
  downloadUrl: string | null
  publicLink: string | null
  digitalUrl: string | null
  sentRecipients?: string[]
  failedRecipients?: Array<{ email: string; error: string }>
  history: DeliveryHistoryItem[]
  activityLog?: DeliveryActivityLogEntry[]
  deliveryDocuments?: DeliveryDocumentItem[]
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase())
}

function parseExtraRecipients(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part, index, all) => part && isValidEmail(part) && all.indexOf(part) === index)
}

function formatSavedAt(value: string | null | undefined) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString('sv-SE', {
    dateStyle: 'short',
    timeStyle: 'short',
  })
}

function deliveryStatusLabel(value: string | null | undefined) {
  if (value === 'sent') return 'Skickad'
  if (value === 'failed') return 'Misslyckad'
  if (value === 'pending') return 'Väntar'
  return value ?? 'Okänd'
}

function pdfStatusLabel(value: string | null | undefined) {
  if (value === 'ready') return 'PDF klar'
  if (value === 'processing') return 'PDF skapas'
  if (value === 'failed') return 'PDF misslyckades'
  return 'PDF väntar'
}

function pdfStatusMessage(meta: DeliveryResponse | null) {
  if (!meta?.hasActiveLink) return 'Ingen digital version eller PDF har skapats ännu.'
  if (meta.pdfStatus === 'ready') return 'PDF är klar och kan laddas ner.'
  if (meta.pdfStatus === 'processing') return 'PDF skapas i bakgrunden. Uppdatera status om länken inte visas automatiskt.'
  if (meta.pdfStatus === 'failed') {
    return meta.pdfError ? `PDF-generering misslyckades: ${meta.pdfError}` : 'PDF-generering misslyckades.'
  }
  return 'PDF-jobbet väntar på att starta.'
}

function formatFileSize(value: number | null | undefined) {
  if (!value || value < 1) return null
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export default function TuPrintActions({
  backHref,
  inspectionId,
  printTitle = '',
}: {
  backHref: string
  inspectionId: string
  printTitle?: string
}) {
  const [meta, setMeta] = useState<DeliveryResponse | null>(null)
  const [recipient, setRecipient] = useState('')
  const [extraRecipients, setExtraRecipients] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<DeliveryAction | null>(null)
  const [regeneratingPdf, setRegeneratingPdf] = useState(false)
  const [unlockOpen, setUnlockOpen] = useState(false)
  const [unlockReason, setUnlockReason] = useState('')
  const [unlockBusy, setUnlockBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const loadMeta = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    if (!options?.silent) setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-delivery`, {
        cache: 'no-store',
      })
      const payload = (await response.json().catch(() => ({}))) as DeliveryResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hämta leveransstatus.')
      setMeta((current) => ({
        ...payload,
        publicLink: payload.publicLink ?? current?.publicLink ?? null,
      }))
      setRecipient((current) => current.trim() || payload.defaultRecipientEmail || '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta leveransstatus.')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [inspectionId])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    if (meta?.pdfStatus !== 'pending' && meta?.pdfStatus !== 'processing') return
    const timer = window.setInterval(() => {
      void loadMeta({ silent: true })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [loadMeta, meta?.pdfStatus])

  const waitForPrintLayout = useCallback(async () => {
    const root = document.querySelector('[data-tu-print-pagination-ready]')
    if (!root || root.getAttribute('data-tu-print-pagination-ready') === '1') return

    await new Promise<void>((resolve) => {
      let observer: MutationObserver | null = null
      const timeout = window.setTimeout(() => {
        observer?.disconnect()
        resolve()
      }, 5000)
      observer = new MutationObserver(() => {
        if (root.getAttribute('data-tu-print-pagination-ready') !== '1') return
        window.clearTimeout(timeout)
        observer?.disconnect()
        resolve()
      })
      observer.observe(root, { attributes: true, attributeFilter: ['data-tu-print-pagination-ready'] })
    })
  }, [])

  const printWithTitle = useCallback(() => {
    void (async () => {
      await waitForPrintLayout()

      const previousTitle = document.title
      document.title = printTitle.trim() ? printTitle : '\u200B'

      const restoreTitle = () => {
        document.title = previousTitle
        window.removeEventListener('afterprint', restoreTitle)
      }

      window.addEventListener('afterprint', restoreTitle)
      window.print()
      window.setTimeout(restoreTitle, 1000)
    })()
  }, [printTitle, waitForPrintLayout])

  const runDelivery = async (action: DeliveryAction) => {
    const normalizedRecipient = recipient.trim().toLowerCase()
    if (action !== 'lock_only' && !isValidEmail(normalizedRecipient)) {
      setError('Ange en giltig huvudmottagare.')
      setResult(null)
      return
    }

    setBusyAction(action)
    setError(null)
    setResult(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          primary_recipient: normalizedRecipient,
          extra_recipients: parseExtraRecipients(extraRecipients),
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as DeliveryResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte hantera utlåtandet.')

      setMeta((current) => ({
        ...payload,
        publicLink: payload.publicLink ?? current?.publicLink ?? null,
      }))
      const failedText =
        payload.failedRecipients && payload.failedRecipients.length > 0
          ? ` Misslyckade mottagare: ${payload.failedRecipients.map((item) => item.email).join(', ')}.`
          : ''
      if (action === 'lock_only') {
        setResult('PDF och digitalt utlåtande skapas. Utlåtandet är låst för manuell hantering.')
      } else {
        const sentCount = payload.sentRecipients?.length ?? 0
        const lockText = action === 'send_and_lock' ? ' Utlåtandet är låst.' : ' Utlåtandet är fortsatt upplåst.'
        setResult(`Digitalt utlåtande skickades till ${sentCount} mottagare.${failedText}${lockText}`)
      }
    } catch (deliveryError) {
      setError(deliveryError instanceof Error ? deliveryError.message : 'Kunde inte hantera utlåtandet.')
    } finally {
      setBusyAction(null)
    }
  }

  const runUnlock = async () => {
    const reason = unlockReason.trim()
    if (reason.length < 10) {
      setError('Ange en anledning pÃ¥ minst 10 tecken.')
      setResult(null)
      return
    }

    setUnlockBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte lÃ¥sa upp utlÃ¥tandet.')

      setMeta((current) =>
        current
          ? {
              ...current,
              reportLockedAt: null,
            }
          : current
      )
      setUnlockOpen(false)
      setUnlockReason('')
      setResult(
        'Utlåtandet är upplåst för redigering. Publicerad digital version och PDF ligger kvar tills en ny version publiceras.'
      )
      await loadMeta({ silent: true })
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : 'Kunde inte lÃ¥sa upp utlÃ¥tandet.')
    } finally {
      setUnlockBusy(false)
    }
  }

  const runRegeneratePdf = async () => {
    setRegeneratingPdf(true)
    setError(null)
    setResult(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-delivery`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate_pdf' }),
      })
      const payload = (await response.json().catch(() => ({}))) as DeliveryResponse
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte starta om PDF-genereringen.')

      setMeta((current) => ({
        ...payload,
        publicLink: payload.publicLink ?? current?.publicLink ?? null,
      }))
      setResult('PDF-genereringen har startats om. Statusen uppdateras automatiskt.')
    } catch (pdfError) {
      setError(pdfError instanceof Error ? pdfError.message : 'Kunde inte starta om PDF-genereringen.')
    } finally {
      setRegeneratingPdf(false)
    }
  }

  const locked = Boolean(meta?.reportLockedAt)
  const hasPublishedVersion = Boolean(meta?.hasActiveLink)
  const unlockedWithPublishedVersion = !locked && hasPublishedVersion
  const downloadUrl = meta?.downloadUrl ?? null
  const digitalReportUrl = meta?.publicLink ?? meta?.digitalUrl ?? null
  const canSend = !busyAction && !unlockBusy && !regeneratingPdf && isValidEmail(recipient)
  const unlockEvents = meta?.activityLog?.filter((item) => item.type === 'report_unlocked') ?? []
  const statusText = loading
    ? 'Hämtar leveransstatus...'
    : error
      ? error
      : result ?? pdfStatusMessage(meta)
  const statusClassName = error
    ? 'border-rose-200 bg-rose-50 text-rose-800'
    : result
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={backHref}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
        >
          <ArrowLeft size={16} aria-hidden />
          Till utlåtandet
        </Link>
        <button
          type="button"
          onClick={printWithTitle}
          className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
        >
          <Printer size={16} aria-hidden />
          Skriv ut / Spara PDF i webbläsaren
        </button>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Publicering
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950">Leverera TU-utlåtandet</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Skapa en fryst publicerad version, lås utlåtandet och generera PDF för nedladdning.
            </p>
            {unlockedWithPublishedVersion ? (
              <p className="mt-2 max-w-3xl rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-5 text-amber-900">
                Utlåtandet är upplåst för redigering. Mottagare ser fortfarande den publicerade versionen tills du publicerar en ny.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2 text-xs">
            <span className={`rounded-full border px-2.5 py-1 font-medium ${locked ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
              {locked ? 'Låst' : 'Upplåst'}
            </span>
            {hasPublishedVersion ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 font-medium text-slate-700">
                Publicerad version finns
              </span>
            ) : null}
            {meta?.pdfStatus ? (
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-700">
                {pdfStatusLabel(meta.pdfStatus)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Huvudmottagare</span>
            <input
              type="email"
              value={recipient}
              onChange={(event) => setRecipient(event.target.value)}
              placeholder="namn@epost.se"
              disabled={Boolean(busyAction) || unlockBusy}
              className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
            />
            <p className="text-[11px] text-gray-500">
              Föreslagen mottagare: {meta?.ordererEmail || meta?.defaultRecipientEmail || 'Saknas'}
            </p>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-medium text-gray-700">Extra mottagare</span>
            <textarea
              value={extraRecipients}
              onChange={(event) => setExtraRecipients(event.target.value)}
              rows={3}
              placeholder="namn@epost.se, annan@epost.se"
              disabled={Boolean(busyAction) || unlockBusy}
              className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </label>
        </div>

        {meta?.deliveryDocuments?.length ? (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-emerald-800">
              Underlag i digital leverans
            </h3>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {meta.deliveryDocuments.map((document) => {
                const label = document.title?.trim() || document.fileName?.trim() || 'Underlag'
                const size = formatFileSize(document.fileSizeBytes)
                return (
                  <div
                    key={document.id}
                    className="rounded-md border border-emerald-200 bg-white px-3 py-2 text-sm"
                  >
                    <span className="block truncate font-medium text-gray-950">{label}</span>
                    {size ? <span className="text-xs text-gray-500">{size}</span> : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        <p className={`mt-3 min-h-12 rounded-md border px-3 py-2 text-sm ${statusClassName}`}>
          {statusText}
        </p>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Publicera ny version</h3>
              <p className="text-xs leading-5 text-slate-500">
                En ny publicering ersätter tidigare aktiv länk först när den skapas.
              </p>
            </div>
            <button
              type="button"
            onClick={() => void loadMeta()}
              disabled={loading || Boolean(busyAction) || unlockBusy || regeneratingPdf}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={14} aria-hidden />
              Uppdatera
            </button>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runDelivery('send_and_lock')}
            disabled={!canSend}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-slate-950 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Send size={16} aria-hidden />
            {busyAction === 'send_and_lock' ? 'Skickar...' : locked ? 'Skicka låst version' : 'Skicka och lås'}
          </button>
          <button
            type="button"
            onClick={() => void runDelivery('send_open')}
            disabled={!canSend || locked}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Skicka utan låsning
          </button>
          <button
            type="button"
            onClick={() => void runDelivery('lock_only')}
            disabled={Boolean(busyAction) || unlockBusy || regeneratingPdf}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LockKeyhole size={16} aria-hidden />
            {busyAction === 'lock_only' ? 'Skapar PDF...' : 'Skapa PDF och lås'}
          </button>
          <button
            type="button"
            onClick={() => setUnlockOpen(true)}
            disabled={!locked || Boolean(busyAction) || unlockBusy || regeneratingPdf}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LockOpen size={16} aria-hidden />
            {unlockBusy ? 'Låser upp...' : 'Lås upp'}
          </button>
          </div>
        </div>

        <div className="mt-5 border-t border-slate-200 pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Publicerad version</h3>
              <p className="text-xs leading-5 text-slate-500">
                Det här är den version mottagaren ser tills en ny publicering ersätter den.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
            >
              <Download size={14} aria-hidden />
              {locked ? 'Ladda ner senaste låsta PDF' : 'Ladda ner senaste PDF'}
            </a>
          ) : (
            <span className="inline-flex min-h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs text-slate-600">
              {meta?.hasActiveLink ? pdfStatusMessage(meta) : 'Ingen skapad PDF att ladda ner ännu.'}
            </span>
          )}
          {meta?.hasActiveLink && meta.pdfStatus === 'failed' ? (
            <button
              type="button"
              onClick={() => void runRegeneratePdf()}
              disabled={regeneratingPdf || Boolean(busyAction) || unlockBusy}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-xs font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw size={14} aria-hidden />
              {regeneratingPdf ? 'Startar om PDF...' : 'Generera PDF igen'}
            </button>
          ) : null}
          {digitalReportUrl ? (
            <a
              href={digitalReportUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-900 bg-white px-3 text-xs font-semibold text-slate-900 shadow-sm transition hover:bg-slate-50"
            >
              <ExternalLink size={14} aria-hidden />
              Öppna digitalt utlåtande
            </a>
          ) : null}
            </div>
          </div>
        </div>

        {meta?.history?.length ? (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
              Leveranshistorik
            </h3>
            <div className="mt-2 space-y-2">
              {meta.history.slice(0, 4).map((item) => (
                <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-900">{item.recipient_email || '-'}</span>
                  <span className="text-xs text-gray-600">
                    {deliveryStatusLabel(item.status)} · {formatSavedAt(item.sent_at ?? item.created_at)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {unlockEvents.length ? (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-rose-700">
              Upplåsningshistorik
            </h3>
            <div className="mt-2 space-y-2">
              {unlockEvents.slice(0, 4).map((item) => (
                <div key={item.id} className="flex flex-wrap items-start justify-between gap-2 text-sm">
                  <span className="font-medium text-gray-900">{item.subtitle || 'Ingen anledning sparad'}</span>
                  <span className="text-xs text-gray-600">{formatSavedAt(item.occurred_at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>
      {unlockOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Lås upp TU-utlåtande</h2>
                <p className="mt-1 text-sm leading-6 text-gray-600">
                  Ange varför utlåtandet öppnas igen. Publicerad digital version och PDF ligger kvar tills en ny version publiceras.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setUnlockOpen(false)}
                disabled={unlockBusy}
                className="rounded-md border border-gray-200 px-2 py-1 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-60"
              >
                Stäng
              </button>
            </div>
            <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-gray-700">Anledning</span>
              <textarea
                value={unlockReason}
                onChange={(event) => setUnlockReason(event.target.value)}
                rows={4}
                disabled={unlockBusy}
                className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none transition focus:border-rose-500 focus:ring-2 focus:ring-rose-100 disabled:bg-gray-100 disabled:text-gray-500"
              />
            </label>
            <p className="mt-1 text-xs text-gray-500">{unlockReason.trim().length}/10 tecken</p>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setUnlockOpen(false)}
                disabled={unlockBusy}
                className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={() => void runUnlock()}
                disabled={unlockBusy || unlockReason.trim().length < 10}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-rose-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:bg-rose-100 disabled:text-rose-700"
              >
                <LockOpen size={16} aria-hidden />
                {unlockBusy ? 'Låser upp...' : 'Lås upp'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
