'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Loader2,
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
  analysisOverview?: string | null
  analysisWarnings?: string[]
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

function sectionCountText(count: number) {
  return count === 1 ? '1 rapportdel' : `${count} rapportdelar`
}

export default function TuWholeReportDraftPanel({
  inspectionId,
  locked,
  autoStart = false,
  analysisOverview = null,
  analysisWarnings = [],
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
  const technicalWarnings = useMemo(
    () => [...new Set([
      ...analysisWarnings,
      ...(draft?.run?.warnings ?? []),
    ].map((warning) => warning.trim()).filter(Boolean))],
    [analysisWarnings, draft?.run?.warnings]
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
      showSuccessToast(
        blockedSections.length > 0
          ? `Utkastet har förts över. ${sectionCountText(blockedSections.length)} behöver kompletteras.`
          : 'Utkastet har förts över och är klart för slutgranskning.',
        { appearance: 'dark' }
      )
      onOpenReport()
    } catch (applyError) {
      setError(errorText(applyError, 'Kunde inte föra över utlåtandeförslaget.'))
    } finally {
      setActionBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-violet-200 bg-violet-50 px-4 py-4 text-sm text-gray-700">
        <Loader2 size={18} className="shrink-0 animate-spin text-violet-700" aria-hidden />
        Hämtar status för utlåtandet...
      </div>
    )
  }

  const failed = draft?.run?.status === 'failed' || draft?.run?.status === 'cancelled'
  const completed = draft?.run?.status === 'completed'
  const missingCount = blockedSections.length
  const totalCount = draft?.sections.length ?? 0
  const primaryLabel = missingCount > 0
    ? `Öppna utkastet och komplettera ${sectionCountText(missingCount)}`
    : 'Öppna utkastet och slutgranska'

  return (
    <div className="space-y-5">
      {error && draft?.run && !failed ? (
        <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      {!draft?.run ? (
        <div className={`flex items-start gap-3 rounded-md border px-4 py-4 ${error ? 'border-rose-200 bg-rose-50' : 'border-violet-200 bg-violet-50'}`}>
          {actionBusy === 'start' ? (
            <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
          ) : error ? (
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-rose-700" aria-hidden />
          ) : (
            <Sparkles size={20} className="mt-0.5 shrink-0 text-violet-700" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <h3 className={`font-semibold ${error ? 'text-rose-950' : 'text-gray-950'}`}>
              {error ? 'Utlåtandet kunde inte startas' : 'Förbereder utlåtandet'}
            </h3>
            <p className={`mt-1 text-sm leading-6 ${error ? 'text-rose-800' : 'text-gray-700'}`}>
              {error ?? 'Alla rapportdelar skrivs tillsammans utifrån det granskade underlaget.'}
            </p>
            {error || !autoStart ? (
              <button
                type="button"
                onClick={() => void start('start')}
                disabled={locked || Boolean(actionBusy)}
                className="mt-3 inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {actionBusy === 'start' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Sparkles size={16} aria-hidden />}
                {error ? 'Försök igen' : 'Skapa utlåtandet'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {processing ? (
        <div className="space-y-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-4">
          <div className="flex items-start gap-3">
            <Loader2 size={22} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
            <div>
              <h3 className="font-semibold text-gray-950">Utlåtandet skrivs</h3>
              <p className="mt-1 text-sm leading-6 text-gray-700" aria-live="polite">
                {draft.run?.progressMessage ?? 'AI:n sammanställer rapportens delar.'}
              </p>
            </div>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-violet-100" aria-hidden>
            <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-700" />
          </div>
          <p className="text-xs text-gray-600">Arbetet fortsätter i bakgrunden även om du lämnar sidan.</p>
        </div>
      ) : null}

      {failed ? (
        <div className="space-y-3">
          <div className="flex gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-4">
            <AlertTriangle size={20} className="mt-0.5 shrink-0 text-rose-700" aria-hidden />
            <div>
              <h3 className="font-semibold text-rose-950">Utlåtandet kunde inte skapas</h3>
              <p className="mt-1 text-sm text-rose-800">{error ?? draft.run?.progressMessage ?? 'Ett oväntat fel inträffade.'}</p>
            </div>
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
        <div className="space-y-5">
          <div className={`flex gap-3 rounded-md border px-4 py-4 ${
            missingCount > 0
              ? 'border-amber-200 bg-amber-50'
              : 'border-emerald-200 bg-emerald-50'
          }`}>
            {missingCount > 0 ? (
              <AlertTriangle size={21} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
            ) : (
              <CheckCircle2 size={21} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
            )}
            <div>
              <h3 className={`font-semibold ${missingCount > 0 ? 'text-amber-950' : 'text-emerald-950'}`}>
                {missingCount > 0 ? 'Utkastet behöver kompletteras' : 'Utkastet är klart för slutgranskning'}
              </h3>
              <p className={`mt-1 text-sm leading-6 ${missingCount > 0 ? 'text-amber-900' : 'text-emerald-900'}`}>
                {missingCount > 0
                  ? `${applicableSections.length} av ${totalCount} rapportdelar har fått verifierbar text. ${sectionCountText(missingCount)} behöver din bedömning.`
                  : `Samtliga ${totalCount} rapportdelar har fått verifierbar text.`}
              </p>
            </div>
          </div>

          {missingCount > 0 ? (
            <section aria-labelledby="tu-missing-report-sections-title" className="overflow-hidden rounded-md border border-gray-200 bg-white">
              <div className="border-b border-gray-200 px-4 py-3">
                <h4 id="tu-missing-report-sections-title" className="font-semibold text-gray-950">
                  Komplettera dessa rapportdelar
                </h4>
                <p className="mt-1 text-sm text-gray-600">
                  De lämnas oförändrade när utkastet förs över.
                </p>
              </div>
              <div className="divide-y divide-gray-200">
                {blockedSections.map((section) => (
                  <div key={section.id} className="px-4 py-3">
                    <p className="text-sm font-semibold text-gray-950">{section.targetSectionTitle}</p>
                    <p className="mt-1 text-xs leading-5 text-gray-600">
                      {section.warnings[0] ?? 'Verifierbart underlag saknas för att skriva rapportdelen automatiskt.'}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <div className="space-y-2 border-t border-gray-200 pt-4">
            <p className="text-sm leading-6 text-gray-700">
              {missingCount > 0
                ? 'Nästa steg öppnar rapporten med de färdiga texterna och tar dig vidare till de delar som behöver kompletteras.'
                : 'Nästa steg öppnar rapporten för din slutliga kontroll innan den fastställs och skickas.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void applyWholeDraft()}
                disabled={locked || Boolean(actionBusy)}
                className="inline-flex min-h-11 items-center gap-2 rounded-md bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {actionBusy === 'apply' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <FileText size={17} aria-hidden />}
                {primaryLabel}
              </button>
              <button
                type="button"
                onClick={() => void start('retry')}
                disabled={locked || Boolean(actionBusy)}
                title="Använd efter att fältunderlaget eller bedömningen har ändrats."
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw size={16} aria-hidden />
                Skapa om efter ändrat underlag
              </button>
            </div>
          </div>

          {draft.run?.overview || analysisOverview || technicalWarnings.length > 0 ? (
            <details className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
              <summary className="cursor-pointer font-semibold text-gray-800">Visa tekniska detaljer</summary>
              {draft.run?.overview ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase text-gray-500">Rapportens disposition</p>
                  <p className="mt-2 whitespace-pre-wrap leading-6">{draft.run.overview}</p>
                </div>
              ) : null}
              {analysisOverview ? (
                <div className="mt-4">
                  <p className="text-xs font-semibold uppercase text-gray-500">Helhetsanalys</p>
                  <p className="mt-2 whitespace-pre-wrap leading-6">{analysisOverview}</p>
                </div>
              ) : null}
              {technicalWarnings.length > 0 ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase text-gray-500">Tekniska varningar</p>
                  {technicalWarnings.map((warning) => (
                    <p key={warning} className="leading-6 text-amber-900">{warning}</p>
                  ))}
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
