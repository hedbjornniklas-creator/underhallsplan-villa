'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Download, ExternalLink, LockKeyhole, LockOpen, RefreshCw, Send } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'

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
  revisionNumber?: number | null
  revisionStatus?: 'finalized' | 'published' | null
  qualityIssues?: Array<{
    id: string
    severity: 'blocker' | 'warning'
    message: string
  }>
  improvementReview?: {
    disclaimer: string
    overallScore: number
    totalSuggestions: number
    categories: Array<{
      id: string
      label: string
      score: 1 | 2 | 3 | 4 | 5 | null
      weight: number
      applicable: boolean
      summary: string
      suggestions: Array<{
        id: string
        message: string
        destination: 'evidence' | 'report'
        requiredBeforeFinalization: boolean
      }>
    }>
  } | null
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
  inspectionId,
  finalizationBlockedReason = null,
  stageLabel = 'Steg 5',
  onStatusChange,
  onOpenEvidence,
  onOpenReport,
}: {
  inspectionId: string
  finalizationBlockedReason?: string | null
  stageLabel?: string
  onStatusChange?: (state: { reportLockedAt: string | null }) => void
  onOpenEvidence?: () => void
  onOpenReport?: () => void
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
  const [result, setResult] = useState<string | null>(null)
  const [improvementOpen, setImprovementOpen] = useState(false)
  const { error: showErrorToast } = useToast()

  const showDeliveryError = useCallback((value: unknown, fallback: string) => {
    showErrorToast(value, fallback, {
      appearance: 'dark',
      dedupeKey: 'tu-report-delivery-error',
    })
  }, [showErrorToast])

  const loadMeta = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
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
      onStatusChange?.({ reportLockedAt: payload.reportLockedAt ?? null })
    } catch (loadError) {
      showDeliveryError(loadError, 'Kunde inte hämta leveransstatus.')
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [inspectionId, onStatusChange, showDeliveryError])

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

  const runDelivery = async (action: DeliveryAction) => {
    const normalizedRecipient = recipient.trim().toLowerCase()
    if (action !== 'lock_only' && !isValidEmail(normalizedRecipient)) {
      showDeliveryError('Ange en giltig huvudmottagare.', 'Ange en giltig huvudmottagare.')
      setResult(null)
      return
    }

    setBusyAction(action)
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
        const revisionLabel = payload.revisionNumber ? `Revision ${payload.revisionNumber}` : 'Utlåtandet'
        setResult(`${revisionLabel} är fastställd. PDF skapas i bakgrunden och kan därefter skickas.`)
      } else {
        const sentCount = payload.sentRecipients?.length ?? 0
        const lockText = action === 'send_and_lock' ? ' Utlåtandet är låst.' : ' Utlåtandet är fortsatt upplåst.'
        setResult(`Digitalt utlåtande skickades till ${sentCount} mottagare.${failedText}${lockText}`)
      }
      onStatusChange?.({ reportLockedAt: payload.reportLockedAt ?? null })
    } catch (deliveryError) {
      showDeliveryError(deliveryError, 'Kunde inte hantera utlåtandet.')
    } finally {
      setBusyAction(null)
    }
  }

  const runUnlock = async () => {
    const reason = unlockReason.trim()
    if (reason.length < 10) {
      showDeliveryError('Ange en anledning på minst 10 tecken.', 'Ange en anledning på minst 10 tecken.')
      setResult(null)
      return
    }

    setUnlockBusy(true)
    setResult(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/unlock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      const payload = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte låsa upp utlåtandet.')

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
      onStatusChange?.({ reportLockedAt: null })
    } catch (unlockError) {
      showDeliveryError(unlockError, 'Kunde inte låsa upp utlåtandet.')
    } finally {
      setUnlockBusy(false)
    }
  }

  const runRegeneratePdf = async () => {
    setRegeneratingPdf(true)
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
      onStatusChange?.({ reportLockedAt: payload.reportLockedAt ?? meta?.reportLockedAt ?? null })
    } catch (pdfError) {
      showDeliveryError(pdfError, 'Kunde inte starta om PDF-genereringen.')
    } finally {
      setRegeneratingPdf(false)
    }
  }

  const locked = Boolean(meta?.reportLockedAt)
  const hasPublishedVersion = Boolean(meta?.hasActiveLink)
  const unlockedWithPublishedVersion = !locked && hasPublishedVersion
  const downloadUrl = meta?.downloadUrl ?? null
  const digitalReportUrl = meta?.publicLink ?? meta?.digitalUrl ?? null
  const canSend = locked && !busyAction && !unlockBusy && !regeneratingPdf && isValidEmail(recipient)
  const serverQualityBlocker = meta?.qualityIssues?.find((issue) => issue.severity === 'blocker') ?? null
  const canFinalize = !locked
    && !finalizationBlockedReason
    && !serverQualityBlocker
    && !busyAction
    && !unlockBusy
    && !regeneratingPdf
  const unlockEvents = meta?.activityLog?.filter((item) => item.type === 'report_unlocked') ?? []
  const statusText = loading
    ? 'Hämtar leveransstatus...'
    : result ?? pdfStatusMessage(meta)
  const statusClassName = result
      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
      : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <div className="w-full space-y-3 print:hidden">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
              {stageLabel}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-gray-950">Fastställ och leverera</h2>
            <p className="mt-1 text-sm leading-6 text-gray-600">
              Fastställ först en fryst revision. Välj därefter mottagare och skicka exakt den versionen.
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
            {meta?.revisionNumber ? (
              <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 font-medium text-violet-800">
                Revision {meta.revisionNumber} · {meta.revisionStatus === 'published' ? 'skickad' : 'fastställd'}
              </span>
            ) : null}
          </div>
        </div>

        <div className="mt-4 grid overflow-hidden rounded-lg border border-slate-200 sm:grid-cols-2">
          <div className={`flex items-start gap-3 p-3 ${locked ? 'bg-emerald-50' : 'bg-violet-50'}`}>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${locked ? 'bg-emerald-700 text-white' : 'bg-violet-700 text-white'}`}>
              {locked ? '✓' : '1'}
            </span>
            <div>
              <p className="text-sm font-semibold text-gray-950">Fastställ version</p>
              <p className="mt-0.5 text-xs leading-5 text-gray-600">
                {locked ? 'En oföränderlig revision är skapad.' : 'Lås rapporten och skapa den version som ska skickas.'}
              </p>
            </div>
          </div>
          <div className={`flex items-start gap-3 border-t border-slate-200 p-3 sm:border-l sm:border-t-0 ${locked ? 'bg-violet-50' : 'bg-slate-50'}`}>
            <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${locked ? 'bg-violet-700 text-white' : 'border border-slate-300 bg-white text-slate-400'}`}>
              2
            </span>
            <div>
              <p className={`text-sm font-semibold ${locked ? 'text-gray-950' : 'text-slate-500'}`}>Välj mottagare och skicka</p>
              <p className="mt-0.5 text-xs leading-5 text-gray-600">
                {locked ? 'Ange mottagare och skicka den fastställda revisionen.' : 'Blir tillgängligt direkt efter fastställandet.'}
              </p>
            </div>
          </div>
        </div>

        {!locked && finalizationBlockedReason ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
            Innan utlåtandet kan fastställas: {finalizationBlockedReason}
          </p>
        ) : null}

        {!locked && !meta?.improvementReview && meta?.qualityIssues?.length ? (
          <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
            <h3 className="text-sm font-semibold text-amber-950">Teknisk slutkontroll</h3>
            <ul className="mt-2 space-y-1.5 text-sm leading-5 text-amber-950">
              {meta.qualityIssues.map((issue) => (
                <li key={issue.id} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${issue.severity === 'blocker' ? 'bg-rose-600' : 'bg-amber-500'}`}
                    aria-hidden
                  />
                  <span>
                    {issue.message}
                    {issue.severity === 'blocker' ? ' Detta måste rättas innan utlåtandet kan fastställas.' : ''}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {meta?.improvementReview ? (
          <div className="mt-4 overflow-hidden rounded-lg border border-violet-200 bg-white">
            <button
              type="button"
              onClick={() => setImprovementOpen((current) => !current)}
              aria-expanded={improvementOpen}
              className="flex w-full items-center gap-4 p-4 text-left transition hover:bg-violet-50/50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold text-gray-950">Förbättringskontroll</h3>
                  <span className="text-lg font-bold text-violet-900">
                    {meta.improvementReview.overallScore.toLocaleString('sv-SE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/5
                  </span>
                  <span className="text-xs text-gray-500">
                    {meta.improvementReview.totalSuggestions} förbättringsförslag
                  </span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-100" aria-hidden>
                  <div
                    className="h-full rounded-full bg-violet-700 transition-[width]"
                    style={{ width: `${Math.max(0, Math.min(100, meta.improvementReview.overallScore * 20))}%` }}
                  />
                </div>
              </div>
              {improvementOpen ? <ChevronUp size={18} className="shrink-0 text-violet-700" aria-hidden /> : <ChevronDown size={18} className="shrink-0 text-violet-700" aria-hidden />}
            </button>

            {improvementOpen ? (
              <div className="border-t border-violet-100 bg-violet-50/30 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <p className="max-w-3xl text-xs leading-5 text-gray-600">
                    {meta.improvementReview.disclaimer}
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadMeta()}
                    disabled={loading}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50 disabled:text-gray-400"
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} aria-hidden />
                    Uppdatera kontrollen
                  </button>
                </div>
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  {meta.improvementReview.categories.map((category) => (
                    <article key={category.id} className="rounded-md border border-violet-100 bg-white p-3">
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold text-gray-950">{category.label}</h4>
                        <span
                          className="inline-flex min-w-12 items-center justify-center rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-900"
                          aria-label={category.applicable && category.score !== null ? `${category.score} av 5` : 'Inte tillämplig'}
                        >
                          {category.applicable && category.score !== null ? `${category.score}/5` : 'Ej tillämplig'}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100" aria-hidden>
                        <div
                          className="h-full rounded-full bg-violet-600"
                          style={{ width: `${category.applicable && category.score !== null ? category.score * 20 : 0}%` }}
                        />
                      </div>
                      <p className="mt-2 text-sm leading-5 text-gray-600">{category.summary}</p>
                      {category.suggestions.length > 0 ? (
                        <ul className="mt-3 space-y-2 border-t border-gray-100 pt-3 text-sm leading-5 text-gray-800">
                          {category.suggestions.map((suggestion) => (
                            <li key={suggestion.id} className="flex items-start gap-2">
                              <span
                                className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${suggestion.requiredBeforeFinalization ? 'bg-rose-600' : 'bg-amber-500'}`}
                                aria-hidden
                              />
                              <span>
                                {suggestion.message}
                                {suggestion.requiredBeforeFinalization ? (
                                  <strong className="ml-1 font-semibold text-rose-700">
                                    Behöver rättas före fastställande.
                                  </strong>
                                ) : null}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-3 border-t border-gray-100 pt-3 text-xs font-medium text-emerald-700">
                          Inget konkret förbättringsförslag i denna kontroll.
                        </p>
                      )}
                    </article>
                  ))}
                </div>
                {meta.improvementReview.categories.some((category) => category.suggestions.length > 0) ? (
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-violet-100 pt-4">
                    {meta.improvementReview.categories.some((category) =>
                      category.suggestions.some((suggestion) => suggestion.destination === 'evidence')
                    ) && onOpenEvidence ? (
                      <button
                        type="button"
                        onClick={onOpenEvidence}
                        className="inline-flex h-9 items-center rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50"
                      >
                        Komplettera underlaget
                      </button>
                    ) : null}
                    {meta.improvementReview.categories.some((category) =>
                      category.suggestions.some((suggestion) => suggestion.destination === 'report')
                    ) && onOpenReport ? (
                      <button
                        type="button"
                        onClick={onOpenReport}
                        className="inline-flex h-9 items-center rounded-md border border-violet-200 bg-white px-3 text-xs font-semibold text-violet-800 transition hover:bg-violet-50"
                      >
                        Justera utlåtandet
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {locked ? (
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
        ) : null}

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
              <h3 className="text-sm font-semibold text-slate-950">Nästa handling</h3>
              <p className="text-xs leading-5 text-slate-500">
                {locked
                  ? 'Den fastställda revisionen ändras inte när den skickas.'
                  : 'Fastställandet låser utlåtandet och skapar en oföränderlig revision.'}
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
          {locked ? (
            <button
              type="button"
              onClick={() => void runDelivery('send_and_lock')}
              disabled={!canSend}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {busyAction === 'send_and_lock' ? <RefreshCw size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
              {busyAction === 'send_and_lock' ? 'Skickar utlåtandet...' : 'Skicka utlåtandet'}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void runDelivery('lock_only')}
              disabled={!canFinalize}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {busyAction === 'lock_only' ? <RefreshCw size={16} className="animate-spin" aria-hidden /> : <LockKeyhole size={16} aria-hidden />}
              {busyAction === 'lock_only' ? 'Fastställer revision...' : 'Fastställ utlåtandet'}
            </button>
          )}
          {locked ? (
          <button
            type="button"
            onClick={() => setUnlockOpen(true)}
            disabled={Boolean(busyAction) || unlockBusy || regeneratingPdf}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <LockOpen size={16} aria-hidden />
            {unlockBusy ? 'Låser upp...' : 'Lås upp'}
          </button>
          ) : null}
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
