'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Loader2,
  MessageSquareText,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import {
  TU_REPORT_REVIEW_UPDATED_EVENT,
  type TuReportReviewInstruction,
  type TuReportReviewResponse,
  type TuReportReviewState,
} from '@/lib/tu/reportReview'

type ReviewTarget = {
  id: string
  title: string
} | null

type Props = {
  inspectionId: string
  locked: boolean
  target: ReviewTarget
  onClose: () => void
  onApplySections: (sections: Array<{ sectionId: string; text: string }>) => Promise<void>
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function isPending(review: TuReportReviewInstruction | null) {
  return review?.status === 'queued' || review?.status === 'processing'
}

export default function TuReportReviewDrawer({
  inspectionId,
  locked,
  target,
  onClose,
  onApplySections,
}: Props) {
  const [state, setState] = useState<TuReportReviewState | null>(null)
  const [instruction, setInstruction] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const currentStatus = state?.current?.status ?? null
  const {
    success: showSuccessToast,
    error: showErrorToast,
  } = useToast()

  const applyPayload = useCallback((payload: TuReportReviewResponse) => {
    if (!payload.review) return
    setState(payload.review)
    const sections = payload.review.current?.sections ?? []
    if (sections.length > 0) setExpandedIds(new Set(sections.map((section) => section.sectionId)))
    window.dispatchEvent(new CustomEvent(TU_REPORT_REVIEW_UPDATED_EVENT, {
      detail: { inspectionId, review: payload.review },
    }))
  }, [inspectionId])

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-review`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte hämta ändringshistoriken.'))
      applyPayload(await response.json() as TuReportReviewResponse)
      setError(null)
    } catch (loadError) {
      setError(errorText(loadError, 'Kunde inte hämta ändringshistoriken.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applyPayload, inspectionId])

  useEffect(() => {
    setInstruction('')
    void loadState()
  }, [loadState, target?.id])

  useEffect(() => {
    if (currentStatus !== 'queued' && currentStatus !== 'processing') return
    const timer = window.setInterval(() => void loadState(true), 3000)
    return () => window.clearInterval(timer)
  }, [currentStatus, loadState])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [busy, onClose])

  const current = state?.current ?? null
  const showCurrent = current
    && (current.status === 'queued'
      || current.status === 'processing'
      || current.status === 'completed'
      || current.status === 'failed')
  const canApply = current?.status === 'completed'
    && current.sections.length > 0
    && current.sections.every((section) => (
      Boolean(section.proposedText.trim())
      && section.groundingStatus !== 'blocked'
      && section.groundingStatus !== 'needs_source'
    ))
  const sectionChangeCount = current?.sections.length ?? 0
  const targetLabel = target ? target.title : 'hela utlåtandet'
  const exampleText = target
    ? 'Exempel: Skriv ”fläck” i stället för ”fuktfläck”. Min bedömning är att detta inte är ett fel.'
    : 'Exempel: Använd ”fläck” i hela utlåtandet och kontrollera att bedömningen och rekommendationerna fortfarande hänger ihop.'

  const submitInstruction = async () => {
    const normalized = instruction.trim()
    if (normalized.length < 3) {
      setError('Beskriv kort vad som ska ändras.')
      return
    }
    setBusy('start')
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/report-review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: target ? 'section' : 'report',
          targetSectionId: target?.id ?? null,
          instruction: normalized,
        }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte starta omarbetningen.'))
      applyPayload(await response.json() as TuReportReviewResponse)
    } catch (submitError) {
      const message = errorText(submitError, 'Kunde inte starta omarbetningen.')
      setError(message)
      showErrorToast(message)
    } finally {
      setBusy(null)
    }
  }

  const patchReview = async (action: 'apply' | 'reject' | 'revert', reviewId: string) => {
    const response = await fetch(`/api/tu/investigations/${inspectionId}/report-review`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, instructionId: reviewId }),
    })
    if (!response.ok) throw new Error(await responseError(response, 'Kunde inte uppdatera rapportändringen.'))
    applyPayload(await response.json() as TuReportReviewResponse)
  }

  const applyReview = async () => {
    if (!current || !canApply) return
    setBusy('apply')
    setError(null)
    try {
      await onApplySections(current.sections.map((section) => ({
        sectionId: section.sectionId,
        text: section.proposedText,
      })))
      await patchReview('apply', current.id)
      showSuccessToast(
        sectionChangeCount === 1
          ? 'Rapportdelen har uppdaterats efter din instruktion.'
          : `${sectionChangeCount} rapportdelar har uppdaterats efter din instruktion.`,
        { appearance: 'dark' }
      )
      onClose()
    } catch (applyError) {
      const message = errorText(applyError, 'Kunde inte använda ändringarna.')
      setError(message)
      showErrorToast(message)
    } finally {
      setBusy(null)
    }
  }

  const rejectReview = async () => {
    if (!current || current.status !== 'completed') return
    setBusy('reject')
    setError(null)
    try {
      await patchReview('reject', current.id)
      setInstruction('')
      showSuccessToast('Förslaget har avvisats.', { appearance: 'dark' })
    } catch (rejectError) {
      const message = errorText(rejectError, 'Kunde inte avvisa förslaget.')
      setError(message)
      showErrorToast(message)
    } finally {
      setBusy(null)
    }
  }

  const revertLatest = async () => {
    const applied = state?.latestApplied
    if (!applied) return
    setBusy('revert')
    setError(null)
    try {
      await onApplySections(applied.sections.map((section) => ({
        sectionId: section.sectionId,
        text: section.beforeText,
      })))
      await patchReview('revert', applied.id)
      showSuccessToast('Den senaste AI-ändringen har ångrats.', { appearance: 'dark' })
    } catch (revertError) {
      const message = errorText(revertError, 'Kunde inte ångra ändringen.')
      setError(message)
      showErrorToast(message)
    } finally {
      setBusy(null)
    }
  }

  const sourceWarningCount = useMemo(
    () => current?.sections.filter((section) => (
      section.groundingStatus === 'blocked' || section.groundingStatus === 'needs_source'
    )).length ?? 0,
    [current?.sections]
  )

  return (
    <div className="fixed inset-0 z-[90] flex justify-end bg-gray-950/30" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose()
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="tu-report-review-title"
        className="flex h-full w-full flex-col bg-white shadow-2xl sm:max-w-2xl sm:border-l sm:border-gray-200"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-100 text-violet-700">
              <MessageSquareText size={20} aria-hidden />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase text-violet-700">AI-assisterad revidering</p>
              <h2 id="tu-report-review-title" className="mt-1 text-lg font-semibold text-gray-950">
                Justera {targetLabel}
              </h2>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                AI:n läser alltid hela utlåtandet och föreslår även följdändringar i andra delar.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(busy)}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Stäng"
          >
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Loader2 size={17} className="animate-spin text-violet-700" aria-hidden />
              Hämtar ändringshistorik...
            </div>
          ) : (
            <div className="space-y-5">
              {error ? (
                <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}

              {!showCurrent ? (
                <div className="space-y-3">
                  <label htmlFor="tu-report-review-instruction" className="block text-sm font-semibold text-gray-950">
                    Vad ska ändras?
                  </label>
                  <textarea
                    id="tu-report-review-instruction"
                    value={instruction}
                    onChange={(event) => setInstruction(event.target.value)}
                    disabled={locked || Boolean(busy)}
                    rows={6}
                    placeholder={exampleText}
                    className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-3 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                  />
                  <p className="text-xs leading-5 text-gray-500">
                    Skriv ett beslut eller en språkregel. AI:n ställer inga följdfrågor utan markerar osäkerheter i förslaget.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void submitInstruction()}
                      disabled={locked || instruction.trim().length < 3 || Boolean(busy)}
                      className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                    >
                      {busy === 'start' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Sparkles size={17} aria-hidden />}
                      Granska följdändringar
                    </button>
                    {state?.latestApplied ? (
                      <button
                        type="button"
                        onClick={() => void revertLatest()}
                        disabled={Boolean(busy)}
                        className="inline-flex h-11 items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {busy === 'revert' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RotateCcw size={16} aria-hidden />}
                        Ångra senaste AI-ändringen
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {isPending(current) ? (
                <div className="space-y-4 rounded-md border border-violet-200 bg-violet-50 px-4 py-4">
                  <div className="flex items-start gap-3">
                    <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
                    <div>
                      <h3 className="font-semibold text-gray-950">Kontrollerar hela utlåtandet</h3>
                      <p className="mt-1 text-sm leading-5 text-gray-700" aria-live="polite">
                        {current?.progressMessage ?? 'Söker efter berörda rapportdelar och motsägelser.'}
                      </p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-600">Du kan stänga panelen. Arbetet fortsätter i bakgrunden.</p>
                </div>
              ) : null}

              {current?.status === 'failed' ? (
                <div className="space-y-3">
                  <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                    <span>{current.errorMessage ?? 'Förslaget kunde inte skapas.'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setState((previous) => previous ? { ...previous, current: null } : previous)
                      setInstruction(current.instruction)
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    <RotateCcw size={16} aria-hidden /> Försök med instruktionen igen
                  </button>
                </div>
              ) : null}

              {current?.status === 'completed' ? (
                <div className="space-y-5">
                  <div className="border-b border-gray-200 pb-4">
                    <p className="text-xs font-semibold uppercase text-violet-700">Din instruktion</p>
                    <p className="mt-2 text-sm leading-6 text-gray-900">{current.instruction}</p>
                  </div>

                  <div>
                    <div className="flex items-start gap-3">
                      <Check size={19} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
                      <div>
                        <h3 className="font-semibold text-gray-950">
                          {sectionChangeCount === 1 ? '1 rapportdel påverkas' : `${sectionChangeCount} rapportdelar påverkas`}
                        </h3>
                        <p className="mt-1 text-sm leading-6 text-gray-700">
                          {current.impactSummary || 'Ändringarna har kontrollerats mot utlåtandets övriga delar.'}
                        </p>
                      </div>
                    </div>
                    {current.warnings.map((warning) => (
                      <div key={warning} className="mt-3 flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden /> {warning}
                      </div>
                    ))}
                  </div>

                  <div className="divide-y divide-gray-200 border-y border-gray-200">
                    {current.sections.map((section) => {
                      const expanded = expandedIds.has(section.sectionId)
                      const sourceBlocked = section.groundingStatus === 'blocked' || section.groundingStatus === 'needs_source'
                      return (
                        <article key={section.sectionId} className="py-4">
                          <button
                            type="button"
                            onClick={() => setExpandedIds((previous) => {
                              const next = new Set(previous)
                              if (expanded) next.delete(section.sectionId)
                              else next.add(section.sectionId)
                              return next
                            })}
                            className="flex w-full items-start justify-between gap-3 text-left"
                          >
                            <div>
                              <h4 className="font-semibold text-gray-950">{section.sectionTitle}</h4>
                              <p className="mt-1 text-sm leading-5 text-gray-600">
                                {section.changeReason || 'Texten behöver justeras för att följa instruktionen.'}
                              </p>
                            </div>
                            {expanded ? <ChevronUp size={18} className="shrink-0 text-gray-500" aria-hidden /> : <ChevronDown size={18} className="shrink-0 text-gray-500" aria-hidden />}
                          </button>
                          {expanded ? (
                            <div className="mt-4 grid gap-4 lg:grid-cols-2">
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase text-gray-500">Nuvarande text</p>
                                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-3 text-sm leading-6 text-gray-700">
                                  {section.beforeText || 'Ingen text.'}
                                </div>
                              </div>
                              <div>
                                <p className="mb-2 text-xs font-semibold uppercase text-violet-700">Föreslagen text</p>
                                <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-violet-200 bg-violet-50/50 px-3 py-3 text-sm leading-6 text-gray-900">
                                  {section.proposedText || 'Ingen verifierbar text kunde skapas.'}
                                </div>
                              </div>
                              {section.warnings.length > 0 || sourceBlocked ? (
                                <div className="lg:col-span-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                                  {section.warnings.join(' ') || 'Källstödet behöver kontrolleras innan texten kan användas.'}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                        </article>
                      )
                    })}
                  </div>

                  {sourceWarningCount > 0 ? (
                    <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
                      <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                      <span>Kontrollera källvarningarna. Förslaget kan inte användas förrän alla berörda delar har verifierbart stöd.</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}
        </div>

        {current?.status === 'completed' ? (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-6">
            <button
              type="button"
              onClick={() => void rejectReview()}
              disabled={Boolean(busy)}
              className="inline-flex h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              Avvisa förslaget
            </button>
            <button
              type="button"
              onClick={() => void applyReview()}
              disabled={!canApply || Boolean(busy)}
              className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {busy === 'apply' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <Check size={17} aria-hidden />}
              Använd alla ändringar
            </button>
          </footer>
        ) : null}
      </section>
    </div>
  )
}
