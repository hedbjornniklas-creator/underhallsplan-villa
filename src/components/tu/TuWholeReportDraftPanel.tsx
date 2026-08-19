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
import type {
  TuWholeReportDraftResponse,
  TuWholeReportDraftState,
} from '@/lib/tu/reportDraft'

type Props = {
  inspectionId: string
  locked: boolean
  onApplyDraft: (sections: Array<{ sectionId: string; text: string }>) => Promise<void>
  onOpenReport: () => void
  onOpenSectionWriter: () => void
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function progressPercent(draft: TuWholeReportDraftState | null) {
  switch (draft?.run?.progressStage) {
    case 'queued': return 4
    case 'preparing': return 14
    case 'synthesizing': return 68
    case 'saving': return 92
    case 'completed': return 100
    case 'failed':
    case 'cancelled': return 100
    default: return 2
  }
}

export default function TuWholeReportDraftPanel({
  inspectionId,
  locked,
  onApplyDraft,
  onOpenReport,
  onOpenSectionWriter,
}: Props) {
  const [draft, setDraft] = useState<TuWholeReportDraftState | null>(null)
  const [texts, setTexts] = useState<Record<string, string>>({})
  const [includedIds, setIncludedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const initializedRunIdRef = useRef<string | null>(null)

  const applyPayload = useCallback((payload: TuWholeReportDraftResponse) => {
    if (!payload.draft) return
    setDraft(payload.draft)
    const runId = payload.draft.run?.id ?? null
    if (runId && runId !== initializedRunIdRef.current && payload.draft.run?.status === 'completed') {
      initializedRunIdRef.current = runId
      setTexts(Object.fromEntries(payload.draft.sections.map((section) => [section.id, section.proposedText])))
      setIncludedIds(new Set(
        payload.draft.sections
          .filter((section) => section.status !== 'rejected')
          .map((section) => section.id)
      ))
    }
  }, [])

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte hämta rapportutkastet.'))
      applyPayload(await response.json() as TuWholeReportDraftResponse)
      setError(null)
    } catch (loadError) {
      setError(errorText(loadError, 'Kunde inte hämta rapportutkastet.'))
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

  const start = async (action: 'start' | 'retry') => {
    setActionBusy(action)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte starta rapportutkastet.'))
      initializedRunIdRef.current = null
      applyPayload(await response.json() as TuWholeReportDraftResponse)
    } catch (startError) {
      setError(errorText(startError, 'Kunde inte starta rapportutkastet.'))
    } finally {
      setActionBusy(null)
    }
  }

  const saveSection = async (suggestionId: string, proposedText: string) => {
    const normalized = proposedText.trim()
    const current = draft?.sections.find((section) => section.id === suggestionId)
    if (!normalized || normalized === current?.proposedText) return
    setSavingId(suggestionId)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update_section', suggestionId, proposedText: normalized }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte spara rapportdelen.'))
      applyPayload(await response.json() as TuWholeReportDraftResponse)
    } catch (saveError) {
      setError(errorText(saveError, 'Kunde inte spara rapportdelen.'))
    } finally {
      setSavingId(null)
    }
  }

  const selectedSections = useMemo(
    () => draft?.sections.filter((section) => includedIds.has(section.id)) ?? [],
    [draft?.sections, includedIds]
  )

  const applyWholeDraft = async () => {
    if (!draft?.run || selectedSections.length === 0) return
    setActionBusy('apply')
    setError(null)
    setSuccess(null)
    try {
      const sections = selectedSections.map((section) => ({
        sectionId: section.targetSectionId,
        text: (texts[section.id] ?? section.proposedText).trim(),
      }))
      if (sections.some((section) => !section.text)) {
        throw new Error('Alla valda rapportdelar måste innehålla text.')
      }
      await onApplyDraft(sections)
      const acceptedIds = selectedSections.map((section) => section.id)
      const rejectedIds = draft.sections
        .filter((section) => !includedIds.has(section.id))
        .map((section) => section.id)
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-draft`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_applied', acceptedIds, rejectedIds }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Texten sparades, men granskningsstatus kunde inte uppdateras.'))
      applyPayload(await response.json() as TuWholeReportDraftResponse)
      setSuccess(`${acceptedIds.length} rapportdelar har förts över till utlåtandet.`)
      onOpenReport()
    } catch (applyError) {
      setError(errorText(applyError, 'Kunde inte föra över rapportutkastet.'))
    } finally {
      setActionBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-violet-200 bg-violet-50/50 px-4 py-4 text-sm text-gray-700">
        <Loader2 size={17} className="animate-spin text-violet-700" aria-hidden />
        Hämtar rapportutkast...
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
            <h3 className="text-base font-semibold text-gray-950">Sammanhållet rapportutkast</h3>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-600">
              AI:n skriver alla rapportdelar samtidigt för en gemensam disposition, konsekvent språk och färre upprepningar.
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
        {success ? (
          <div role="status" className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <CheckCircle2 size={17} aria-hidden /> {success}
          </div>
        ) : null}

        {!draft?.run ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-gray-700">
              Den godkända analysen används som källa. Förslaget ändrar inte utlåtandet förrän du har granskat och fört över det.
            </p>
            <button
              type="button"
              onClick={() => void start('start')}
              disabled={locked || Boolean(actionBusy)}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {actionBusy === 'start' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
              Skapa utkast till hela utlåtandet
            </button>
          </div>
        ) : null}

        {processing ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <Loader2 size={22} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
              <div>
                <h4 className="font-semibold text-gray-950">Hela utlåtandet skrivs i bakgrunden</h4>
                <p className="mt-1 text-sm text-gray-700" aria-live="polite">
                  {draft.run?.progressMessage ?? 'Förbereder rapportutkastet.'}
                </p>
              </div>
            </div>
            <div
              className="h-2.5 overflow-hidden rounded-full bg-violet-100"
              role="progressbar"
              aria-label="Rapportutkastets förlopp"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progressPercent(draft)}
            >
              <div
                className="h-full rounded-full bg-violet-700 transition-[width] duration-500"
                style={{ width: `${progressPercent(draft)}%` }}
              />
            </div>
            <p className="rounded-md border border-violet-100 bg-white px-3 py-2 text-sm text-gray-700">
              Du kan lämna sidan och återkomma senare. Resultatet sparas och visas här när det är klart.
            </p>
          </div>
        ) : null}

        {failed ? (
          <div className="space-y-3">
            <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
              <span>{draft.run?.progressMessage ?? 'Rapportutkastet kunde inte skapas.'}</span>
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
            {draft.run?.overview ? (
              <div className="rounded-md border border-violet-100 bg-white px-4 py-3">
                <h4 className="text-sm font-semibold text-gray-950">AI:ns disposition</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{draft.run.overview}</p>
              </div>
            ) : null}
            {draft.run?.warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden /> {warning}
              </div>
            ))}

            <div className="space-y-3">
              {draft.sections.map((section, index) => {
                const included = includedIds.has(section.id)
                return (
                  <article key={section.id} className={`rounded-md border bg-white p-4 ${included ? 'border-violet-200' : 'border-gray-200 opacity-70'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-[0.1em] text-violet-700">Del {index + 1}</div>
                        <h4 className="mt-1 font-semibold text-gray-950">{section.targetSectionTitle}</h4>
                      </div>
                      <label className="inline-flex items-center gap-2 text-sm font-medium text-gray-700">
                        <input
                          type="checkbox"
                          checked={included}
                          disabled={locked || Boolean(actionBusy)}
                          onChange={(event) => setIncludedIds((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(section.id)
                            else next.delete(section.id)
                            return next
                          })}
                          className="size-4 accent-violet-700"
                        />
                        Ta med
                      </label>
                    </div>
                    <textarea
                      value={texts[section.id] ?? section.proposedText}
                      disabled={locked || savingId === section.id}
                      onChange={(event) => setTexts((current) => ({ ...current, [section.id]: event.target.value }))}
                      onBlur={() => void saveSection(section.id, texts[section.id] ?? section.proposedText)}
                      rows={8}
                      className="mt-3 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-50"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
                      <span>
                        {section.sourceAnalysisItemIds.length} analysunderlag · {section.sourceObservationIds.length} observationer
                      </span>
                      {savingId === section.id ? (
                        <span className="inline-flex items-center gap-1 text-violet-700"><Loader2 size={13} className="animate-spin" aria-hidden /> Sparar</span>
                      ) : null}
                    </div>
                    {section.warnings.length > 0 ? (
                      <p className="mt-2 text-xs leading-5 text-amber-800">{section.warnings.join(' ')}</p>
                    ) : null}
                  </article>
                )
              })}
            </div>

            <div className="flex flex-wrap gap-2 border-t border-violet-100 pt-4">
              <button
                type="button"
                onClick={() => void applyWholeDraft()}
                disabled={locked || selectedSections.length === 0 || Boolean(actionBusy) || Boolean(savingId)}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {actionBusy === 'apply' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <FileText size={17} aria-hidden />}
                För över {selectedSections.length} delar till utlåtandet
              </button>
              <button
                type="button"
                onClick={() => void start('retry')}
                disabled={locked || Boolean(actionBusy)}
                className="inline-flex h-11 items-center gap-2 rounded-md border border-violet-300 bg-white px-4 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:opacity-50"
              >
                <RotateCcw size={16} aria-hidden /> Skapa om hela utkastet
              </button>
              <button
                type="button"
                onClick={onOpenSectionWriter}
                className="inline-flex h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Skriv om en enskild del
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
