'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FilePenLine,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
  Sparkles,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import {
  TU_REPORT_DRAFT_UPDATED_EVENT,
  type TuWholeReportDraftResponse,
  type TuWholeReportDraftState,
} from '@/lib/tu/reportDraft'

type Props = {
  inspectionId: string
  locked: boolean
  autoStart?: boolean
  onApplyDraft: (sections: Array<{ sectionId: string; text: string }>) => Promise<void>
  onOpenReport: () => void
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

export default function TuWholeReportDraftPanel({
  inspectionId,
  locked,
  autoStart = false,
  onApplyDraft,
  onOpenReport,
}: Props) {
  const [draft, setDraft] = useState<TuWholeReportDraftState | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoStartAttemptedRef = useRef(false)
  const { success: showSuccessToast } = useToast()

  const applyPayload = useCallback((payload: TuWholeReportDraftResponse) => {
    if (!payload.draft) return
    setDraft(payload.draft)
    window.dispatchEvent(new CustomEvent(TU_REPORT_DRAFT_UPDATED_EVENT, {
      detail: { inspectionId, draft: payload.draft },
    }))
  }, [inspectionId])

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte hämta utlåtandeförslaget.'))
      applyPayload(await response.json() as TuWholeReportDraftResponse)
      setError(null)
    } catch (loadError) {
      setError(errorText(loadError, 'Kunde inte hämta utlåtandeförslaget.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applyPayload, inspectionId])

  useEffect(() => {
    void loadState()
  }, [loadState])

  const processing = draft?.run?.status === 'queued' || draft?.run?.status === 'processing'
  useEffect(() => {
    if (!processing) return
    const timer = window.setInterval(() => void loadState(true), 3500)
    return () => window.clearInterval(timer)
  }, [loadState, processing])

  const start = useCallback(async (action: 'start' | 'retry') => {
    setActionBusy(action)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte skapa utlåtandet.'))
      applyPayload(await response.json() as TuWholeReportDraftResponse)
    } catch (startError) {
      autoStartAttemptedRef.current = false
      setError(errorText(startError, 'Kunde inte skapa utlåtandet.'))
    } finally {
      setActionBusy(null)
    }
  }, [applyPayload, inspectionId])

  useEffect(() => {
    if (
      !autoStart
      || loading
      || locked
      || draft?.run
      || actionBusy
      || autoStartAttemptedRef.current
    ) return
    autoStartAttemptedRef.current = true
    void start('start')
  }, [actionBusy, autoStart, draft?.run, loading, locked, start])

  const applicableSections = useMemo(
    () => draft?.sections.filter((section) => (
      section.status !== 'rejected'
      && Boolean(section.proposedText.trim())
      && (section.groundingStatus === 'grounded' || section.groundingStatus === 'manually_edited')
    )) ?? [],
    [draft?.sections]
  )
  const blockedSections = useMemo(
    () => draft?.sections.filter((section) => !applicableSections.some((candidate) => candidate.id === section.id)) ?? [],
    [applicableSections, draft?.sections]
  )
  const alreadyApplied = applicableSections.length > 0
    && applicableSections.every((section) => section.status === 'accepted')

  const applyWholeDraft = async () => {
    if (!draft?.run) return
    if (alreadyApplied || applicableSections.length === 0) {
      onOpenReport()
      return
    }
    setActionBusy('apply')
    setError(null)
    try {
      await onApplyDraft(applicableSections.map((section) => ({
        sectionId: section.targetSectionId,
        text: section.proposedText.trim(),
      })))
      const acceptedIds = applicableSections.map((section) => section.id)
      const rejectedIds = draft.sections
        .filter((section) => !acceptedIds.includes(section.id))
        .map((section) => section.id)
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_applied', acceptedIds, rejectedIds }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Texten sparades, men statusen kunde inte uppdateras.'))
      applyPayload(await response.json() as TuWholeReportDraftResponse)
      showSuccessToast('Utlåtandeförslaget har förts över och är klart för din slutgranskning.', {
        appearance: 'dark',
      })
      onOpenReport()
    } catch (applyError) {
      setError(errorText(applyError, 'Kunde inte föra över utlåtandeförslaget.'))
    } finally {
      setActionBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50/50 px-4 py-4 text-sm text-gray-700">
        <Loader2 size={17} className="animate-spin text-violet-700" aria-hidden />
        Hämtar utlåtandeförslag...
      </div>
    )
  }

  const failed = draft?.run?.status === 'failed' || draft?.run?.status === 'cancelled'
  const completed = draft?.run?.status === 'completed'

  return (
    <section className="overflow-hidden rounded-lg border border-violet-200 bg-violet-50/30">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 bg-white px-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
            <FilePenLine size={20} aria-hidden />
          </span>
          <div>
            <h3 className="text-base font-semibold text-gray-950">Utlåtandeförslag</h3>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-600">
              Alla rapportdelar skrivs samtidigt för att språk, bedömningar och rekommendationer ska hänga ihop.
            </p>
          </div>
        </div>
        {draft?.run ? (
          <button
            type="button"
            onClick={() => void loadState()}
            disabled={Boolean(actionBusy)}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <RefreshCw size={15} className={processing ? 'animate-spin' : ''} aria-hidden />
            Uppdatera
          </button>
        ) : null}
      </header>

      <div className="space-y-4 p-4">
        {error ? (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {!draft?.run ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-gray-700">
              Den samlade analysen är klar. Nästa steg skriver utlåtandet enligt den valda mallen.
            </p>
            <button
              type="button"
              onClick={() => void start('start')}
              disabled={locked || Boolean(actionBusy)}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {actionBusy === 'start' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
              Skapa hela utlåtandet
            </button>
          </div>
        ) : null}

        {processing ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <Loader2 size={22} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
              <div>
                <h4 className="font-semibold text-gray-950">Utlåtandet skrivs i bakgrunden</h4>
                <p className="mt-1 text-sm text-gray-700" aria-live="polite">
                  {draft.run?.progressMessage ?? 'Förbereder rapportens delar.'}
                </p>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-violet-100" aria-hidden>
              <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-700" />
            </div>
            <p className="text-sm text-gray-600">Du kan lämna sidan. Förslaget sparas och finns kvar när du återkommer.</p>
          </div>
        ) : null}

        {failed ? (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
              <span>{draft.run?.progressMessage ?? 'Utlåtandet kunde inte skapas.'}</span>
            </div>
            <button
              type="button"
              onClick={() => void start('retry')}
              disabled={locked || Boolean(actionBusy)}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:bg-gray-300"
            >
              {actionBusy === 'retry' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RotateCcw size={16} aria-hidden />}
              Försök igen
            </button>
          </div>
        ) : null}

        {completed ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
              <div>
                <h4 className="font-semibold text-emerald-950">Utlåtandet är skapat</h4>
                <p className="mt-1 text-sm text-emerald-900">
                  {applicableSections.length} rapportdelar är klara att föras över till utlåtandet.
                </p>
              </div>
            </div>

            {blockedSections.length > 0 ? (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <span>
                  {blockedSections.length} rapportdelar saknar tillräckligt källstöd och lämnas oförändrade. De visas i utlåtandet för manuell kontroll.
                </span>
              </div>
            ) : null}

            {draft.run?.warnings.map((warning) => (
              <div key={warning} className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
                {warning}
              </div>
            ))}

            {draft.run?.overview ? (
              <details className="rounded-md border border-gray-200 bg-white px-4 py-3 text-sm text-gray-700">
                <summary className="cursor-pointer font-semibold text-gray-800">Visa AI:ns disposition</summary>
                <p className="mt-3 whitespace-pre-wrap leading-6">{draft.run.overview}</p>
              </details>
            ) : null}

            <div className="flex flex-wrap gap-2 border-t border-violet-100 pt-4">
              <button
                type="button"
                onClick={() => void applyWholeDraft()}
                disabled={locked || Boolean(actionBusy)}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {actionBusy === 'apply' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <FileText size={17} aria-hidden />}
                {alreadyApplied ? 'Öppna och granska utlåtandet' : 'Använd förslaget och granska'}
              </button>
              <button
                type="button"
                onClick={() => void start('retry')}
                disabled={locked || Boolean(actionBusy)}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-violet-300 bg-white px-4 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:opacity-50"
              >
                <RotateCcw size={16} aria-hidden />
                Skapa om hela utlåtandet
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
