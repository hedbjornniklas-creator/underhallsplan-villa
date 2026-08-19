'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, BrainCircuit, CheckCircle2, Loader2 } from 'lucide-react'
import {
  getTuAnalysisProgressMessage,
  getTuAnalysisProgressPercent,
  TU_ANALYSIS_UPDATED_EVENT,
  type TuAnalysisResponse,
  type TuAnalysisWorkflow,
} from '@/lib/tu/analysis'

type Props = {
  inspectionId: string
  enabled: boolean
  onOpenAnalysis: () => void
}

type AnalysisEventDetail = {
  inspectionId?: string
  workflow?: TuAnalysisWorkflow
}

function elapsedText(value: string | null | undefined, now: number) {
  if (!value) return 'startar snart'
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (seconds < 60) return `${seconds} sek`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} tim ${minutes % 60} min`
}

export default function TuAnalysisActivityBanner({ inspectionId, enabled, onOpenAnalysis }: Props) {
  const [workflow, setWorkflow] = useState<TuAnalysisWorkflow | null>(null)
  const [now, setNow] = useState(() => Date.now())

  const loadState = useCallback(async () => {
    if (!enabled) return
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
        cache: 'no-store',
      })
      if (!response.ok) return
      const payload = await response.json() as TuAnalysisResponse
      if (payload.workflow) setWorkflow(payload.workflow)
    } catch {
      // The full analysis view handles request errors. This banner stays unobtrusive.
    }
  }, [enabled, inspectionId])

  useEffect(() => {
    if (!enabled) return
    const timer = window.setTimeout(() => void loadState(), 0)
    return () => window.clearTimeout(timer)
  }, [enabled, loadState])

  useEffect(() => {
    if (!enabled) return
    const handleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<AnalysisEventDetail>).detail
      if (detail?.inspectionId !== inspectionId || !detail.workflow) return
      setWorkflow(detail.workflow)
    }
    window.addEventListener(TU_ANALYSIS_UPDATED_EVENT, handleUpdate)
    return () => window.removeEventListener(TU_ANALYSIS_UPDATED_EVENT, handleUpdate)
  }, [enabled, inspectionId])

  const processing = workflow?.run?.status === 'queued'
    || workflow?.run?.status === 'processing'
    || (workflow?.status === 'analysis_processing' && !workflow.run)

  useEffect(() => {
    if (!processing) return
    const pollTimer = window.setInterval(() => void loadState(), 3500)
    const clockTimer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => {
      window.clearInterval(pollTimer)
      window.clearInterval(clockTimer)
    }
  }, [loadState, processing])

  if (!enabled || !workflow) return null

  if (processing) {
    const percent = getTuAnalysisProgressPercent(workflow.run)
    return (
      <aside className="rounded-md border border-violet-200 bg-white px-4 py-3 shadow-sm" aria-live="polite">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-700">
            <Loader2 size={18} className="animate-spin" aria-hidden />
          </span>
          <div className="min-w-[220px] flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-gray-950">AI-analysen arbetar i bakgrunden</p>
              <span className="text-xs font-semibold tabular-nums text-violet-800">{percent}%</span>
            </div>
            <p className="mt-0.5 text-xs text-gray-600">
              {getTuAnalysisProgressMessage(workflow.run)} Pågått {elapsedText(workflow.run?.startedAt ?? workflow.run?.createdAt, now)}.
            </p>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-violet-100">
              <div
                className="h-full rounded-full bg-violet-700 transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={onOpenAnalysis}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50"
          >
            <BrainCircuit size={16} aria-hidden />
            Visa analys
          </button>
        </div>
      </aside>
    )
  }

  if (workflow.status === 'analysis_ready') {
    return (
      <aside className="flex flex-wrap items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
        <CheckCircle2 size={19} className="shrink-0 text-emerald-700" aria-hidden />
        <p className="min-w-[220px] flex-1 text-sm font-medium text-emerald-950">
          AI-analysen är klar. Granska förslagen innan de förs över till utlåtandet.
        </p>
        <button
          type="button"
          onClick={onOpenAnalysis}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-emerald-300 bg-white px-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
        >
          Visa resultat
        </button>
      </aside>
    )
  }

  if (workflow.run?.status === 'failed') {
    return (
      <aside className="flex flex-wrap items-center gap-3 rounded-md border border-rose-200 bg-rose-50 px-4 py-3">
        <AlertTriangle size={19} className="shrink-0 text-rose-700" aria-hidden />
        <p className="min-w-[220px] flex-1 text-sm font-medium text-rose-950">
          AI-analysen misslyckades. Öppna Analys för att se felet och försöka igen.
        </p>
        <button
          type="button"
          onClick={onOpenAnalysis}
          className="inline-flex h-9 items-center rounded-md border border-rose-300 bg-white px-3 text-sm font-semibold text-rose-900 transition hover:bg-rose-100"
        >
          Öppna analys
        </button>
      </aside>
    )
  }

  return null
}
