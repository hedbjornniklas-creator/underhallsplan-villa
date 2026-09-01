'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  BrainCircuit,
  Clock3,
  FileText,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import TuWholeReportDraftPanel from '@/components/tu/TuWholeReportDraftPanel'
import {
  getTuAnalysisProgressMessage,
  getTuAnalysisProgressStep,
  TU_ANALYSIS_UPDATED_EVENT,
  type TuAnalysisResponse,
  type TuAnalysisValidation,
  type TuAnalysisWorkflow,
} from '@/lib/tu/analysis'
import type { TuReportSection } from '@/lib/tu/server'

type AnalysisImage = {
  id: string
  publicUrl: string
  caption: string | null
}

type QueueCounts = {
  total: number
  uploading: number
  transcribing: number
  saving: number
  failed: number
  waiting: number
}

type Props = {
  inspectionId: string
  refreshToken: number
  locked: boolean
  sections: TuReportSection[]
  images: AnalysisImage[]
  queueCounts: QueueCounts
  onPreviewImage: (imageId: string) => void
  onOpenField: () => void
  onOpenEvidence: () => void
  onApplyReportDraft: (sections: Array<{ sectionId: string; text: string }>) => Promise<void>
  onOpenReport: () => void
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function clockText(value: string | null | undefined) {
  if (!value) return 'Inte startad'
  return new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default function TuAnalysisWorkspace({
  inspectionId,
  refreshToken,
  locked,
  queueCounts,
  onOpenField,
  onOpenEvidence,
  onApplyReportDraft,
  onOpenReport,
}: Props) {
  const [workflow, setWorkflow] = useState<TuAnalysisWorkflow | null>(null)
  const [validation, setValidation] = useState<TuAnalysisValidation | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const autoApprovedRunRef = useRef<string | null>(null)

  const applyResponse = useCallback((payload: TuAnalysisResponse) => {
    if (payload.workflow) setWorkflow(payload.workflow)
    if (payload.validation) setValidation(payload.validation)
    window.dispatchEvent(new CustomEvent(TU_ANALYSIS_UPDATED_EVENT, {
      detail: { inspectionId, workflow: payload.workflow },
    }))
  }, [inspectionId])

  const loadState = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
        cache: 'no-store',
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte hämta analysen.'))
      applyResponse(await response.json() as TuAnalysisResponse)
      setError(null)
    } catch (loadError) {
      setError(errorText(loadError, 'Kunde inte hämta analysen.'))
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applyResponse, inspectionId])

  useEffect(() => {
    void loadState()
  }, [loadState, refreshToken])

  const analysisProcessing = workflow?.run?.status === 'queued'
    || workflow?.run?.status === 'processing'
    || (workflow?.status === 'analysis_processing' && !workflow.run)

  useEffect(() => {
    if (!analysisProcessing) return
    const timer = window.setInterval(() => void loadState(true), 3500)
    return () => window.clearInterval(timer)
  }, [analysisProcessing, loadState])

  const runAnalysis = useCallback(async (action: 'complete' | 'retry') => {
    setActionBusy(action)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, pendingQueueCount: queueCounts.total }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte starta analysen.'))
      applyResponse(await response.json() as TuAnalysisResponse)
    } catch (actionError) {
      setError(errorText(actionError, 'Kunde inte starta analysen.'))
    } finally {
      setActionBusy(null)
    }
  }, [applyResponse, inspectionId, queueCounts.total])

  const approveGenerated = useCallback(async () => {
    setActionBusy('approve-generated')
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve_generated' }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte förbereda utlåtandet.'))
      applyResponse(await response.json() as TuAnalysisResponse)
    } catch (approveError) {
      setError(errorText(approveError, 'Kunde inte förbereda utlåtandet.'))
    } finally {
      setActionBusy(null)
    }
  }, [applyResponse, inspectionId])

  useEffect(() => {
    const runId = workflow?.run?.id
    if (
      locked
      || workflow?.status !== 'analysis_ready'
      || workflow.run?.status !== 'completed'
      || !runId
      || autoApprovedRunRef.current === runId
    ) return
    autoApprovedRunRef.current = runId
    void approveGenerated()
  }, [approveGenerated, locked, workflow])

  if (loading) {
    return (
      <section className="rounded-lg border border-violet-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <Loader2 size={18} className="animate-spin text-violet-700" aria-hidden />
          Hämtar arbetsläget...
        </div>
      </section>
    )
  }

  const failed = workflow?.run?.status === 'failed'
  const queuePending = queueCounts.total > 0
  const progressStep = getTuAnalysisProgressStep(workflow?.run)
  const progressMessage = getTuAnalysisProgressMessage(workflow?.run)

  return (
    <section className="overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
            <BrainCircuit size={21} aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-950">Skapa utlåtandet</h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-600">
              Hela underlaget analyseras tillsammans. Därefter skrivs alla rapportdelar som en sammanhängande helhet.
            </p>
          </div>
        </div>
      </header>

      <div className="space-y-5 p-4 sm:p-5">
        {error ? (
          <div role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {workflow?.status === 'in_progress' ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border-b border-gray-200 pb-3">
                <div className="text-2xl font-semibold text-gray-950">{validation?.observationCount ?? 0}</div>
                <div className="text-sm text-gray-600">Fältposter</div>
              </div>
              <div className="border-b border-gray-200 pb-3">
                <div className="text-2xl font-semibold text-gray-950">{validation?.imageCount ?? 0}</div>
                <div className="text-sm text-gray-600">Bilder</div>
              </div>
              <div className="border-b border-gray-200 pb-3">
                <div className="text-2xl font-semibold text-gray-950">{validation?.measurementCount ?? 0}</div>
                <div className="text-sm text-gray-600">Mätvärden</div>
              </div>
            </div>

            {queuePending ? (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <Loader2 size={17} className="mt-0.5 shrink-0 animate-spin" aria-hidden />
                <span>{queueCounts.total} uppladdningar eller transkriberingar måste bli klara innan analysen startar.</span>
              </div>
            ) : null}
            {validation?.warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <span>{warning}</span>
              </div>
            ))}

            <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => void runAnalysis('complete')}
                disabled={locked || queuePending || !validation?.canComplete || Boolean(actionBusy)}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {actionBusy === 'complete' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <FileText size={17} aria-hidden />}
                Skapa hela utlåtandet
              </button>
              <button
                type="button"
                onClick={onOpenEvidence}
                className="inline-flex h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Tillbaka till underlaget
              </button>
            </div>
          </div>
        ) : null}

        {analysisProcessing ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3">
              <Loader2 size={22} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
              <div>
                <p className="text-xs font-semibold uppercase text-violet-700">
                  Steg {progressStep.current} av {progressStep.total} · {progressStep.label}
                </p>
                <h3 className="mt-1 font-semibold text-gray-950">Underlaget analyseras i bakgrunden</h3>
                <p className="mt-1 text-sm leading-5 text-gray-700" aria-live="polite">{progressMessage}</p>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-violet-100" aria-hidden>
              <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-700" />
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-600">
              <span className="inline-flex items-center gap-1.5">
                <Clock3 size={14} className="text-violet-700" aria-hidden />
                Startad {clockText(workflow?.run?.startedAt ?? workflow?.run?.createdAt)}
              </span>
              <span>Du kan lämna sidan. Resultatet sparas automatiskt.</span>
            </div>
          </div>
        ) : null}

        {failed ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-rose-200 bg-rose-50 p-4">
              <AlertTriangle size={20} className="shrink-0 text-rose-700" aria-hidden />
              <div>
                <h3 className="font-semibold text-rose-950">Utlåtandet kunde inte förberedas</h3>
                <p className="mt-1 text-sm text-rose-800">{workflow?.run?.errorMessage ?? 'Ett oväntat fel inträffade.'}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAnalysis('retry')}
                disabled={locked || queuePending || Boolean(actionBusy)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:bg-gray-300"
              >
                {actionBusy === 'retry' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RotateCcw size={16} aria-hidden />}
                Försök igen
              </button>
              <button type="button" onClick={onOpenField} className="h-10 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50">
                Öppna fältloggen
              </button>
            </div>
          </div>
        ) : null}

        {!analysisProcessing && !failed && workflow?.status === 'analysis_ready' ? (
          <div className="flex items-start gap-3 rounded-md border border-violet-200 bg-violet-50 p-4">
            <Loader2 size={20} className="mt-0.5 shrink-0 animate-spin text-violet-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-gray-950">Förbereder rapportens delar</h3>
              <p className="mt-1 text-sm text-gray-700">Helhetsanalysen är klar. Rapportutkastet startas automatiskt.</p>
              {error ? (
                <button type="button" onClick={() => void approveGenerated()} className="mt-3 inline-flex h-9 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white hover:bg-violet-800">
                  <RefreshCw size={15} aria-hidden /> Försök fortsätta
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {workflow?.status === 'analysis_approved' ? (
          <TuWholeReportDraftPanel
            inspectionId={inspectionId}
            locked={locked}
            autoStart
            analysisOverview={workflow.run?.overview}
            analysisWarnings={workflow.run?.warnings ?? []}
            onApplyDraft={onApplyReportDraft}
            onOpenReport={onOpenReport}
          />
        ) : null}
      </div>
    </section>
  )
}
