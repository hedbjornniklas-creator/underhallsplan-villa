'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BrainCircuit,
  Check,
  CheckCircle2,
  Clock3,
  Image as ImageIcon,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  X,
} from 'lucide-react'
import {
  getTuAnalysisProgressMessage,
  getTuAnalysisProgressStep,
  TU_ANALYSIS_UPDATED_EVENT,
  type TuAnalysisItem,
  type TuAnalysisResponse,
  type TuAnalysisValidation,
  type TuAnalysisWorkflow,
} from '@/lib/tu/analysis'
import type { TuReportSection } from '@/lib/tu/server'
import TuWholeReportDraftPanel from '@/components/tu/TuWholeReportDraftPanel'

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

const TYPE_LABELS: Record<TuAnalysisItem['itemType'], string> = {
  current_assessment: 'Aktuell samlad bedömning',
  evidence_conflict: 'Motsägelse att lösa',
  verified_observation: 'Verifierad iakttagelse',
  party_statement: 'Uppgift från part',
  measurement: 'Mätvärde',
  image_observation: 'Synligt i bild',
  technical_hypothesis: 'Teknisk hypotes',
  information_gap: 'Informationslucka',
  recommended_follow_up: 'Fortsatt kontroll',
  report_image: 'Föreslagen rapportbild',
}

const CERTAINTY_LABELS: Record<TuAnalysisItem['certainty'], string> = {
  confirmed: 'Bekräftat',
  probable: 'Sannolikt',
  uncertain: 'Osäkert',
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

async function responseError(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown }
  return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
}

function elapsedText(value: string | null | undefined, now: number) {
  if (!value) return 'Startar snart'
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000))
  if (elapsedSeconds < 60) return `${elapsedSeconds} sek`
  const minutes = Math.floor(elapsedSeconds / 60)
  const seconds = elapsedSeconds % 60
  if (minutes < 60) return `${minutes} min ${seconds} sek`
  const hours = Math.floor(minutes / 60)
  return `${hours} tim ${minutes % 60} min`
}

function clockText(value: string | null | undefined) {
  if (!value) return 'Inte startad'
  return new Intl.DateTimeFormat('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function sourceTimeText(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Tid saknas'
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function TuAnalysisWorkspace({
  inspectionId,
  refreshToken,
  locked,
  sections,
  images,
  queueCounts,
  onPreviewImage,
  onOpenField,
  onOpenEvidence,
  onApplyReportDraft,
  onOpenReport,
}: Props) {
  const [workflow, setWorkflow] = useState<TuAnalysisWorkflow | null>(null)
  const [validation, setValidation] = useState<TuAnalysisValidation | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [itemBusyId, setItemBusyId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editSummary, setEditSummary] = useState('')
  const [editCertainty, setEditCertainty] = useState<TuAnalysisItem['certainty']>('uncertain')
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const imageById = useMemo(() => new Map(images.map((image) => [image.id, image])), [images])
  const editableSections = useMemo(
    () => sections.filter((section) => section.key !== 'assignment_parties' && section.key !== 'signature'),
    [sections]
  )

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

  const shouldPoll = workflow?.run?.status === 'queued'
    || workflow?.run?.status === 'processing'
    || (workflow?.status === 'analysis_processing' && !workflow.run)

  useEffect(() => {
    if (!shouldPoll) return
    const timer = window.setInterval(() => void loadState(true), 3500)
    return () => window.clearInterval(timer)
  }, [loadState, shouldPoll])

  useEffect(() => {
    if (!shouldPoll) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [shouldPoll])

  const runAction = useCallback(async (action: 'complete' | 'retry' | 'reopen' | 'approve') => {
    setActionBusy(action)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, pendingQueueCount: queueCounts.total }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte uppdatera analysen.'))
      applyResponse(await response.json() as TuAnalysisResponse)
    } catch (actionError) {
      setError(errorText(actionError, 'Kunde inte uppdatera analysen.'))
    } finally {
      setActionBusy(null)
    }
  }, [applyResponse, inspectionId, queueCounts.total])

  const updateItem = useCallback(async (itemId: string, patch: Record<string, unknown>) => {
    setItemBusyId(itemId)
    setError(null)
    try {
      const response = await fetch(`/api/tu/investigations/${inspectionId}/analysis`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, ...patch }),
      })
      if (!response.ok) throw new Error(await responseError(response, 'Kunde inte spara granskningen.'))
      applyResponse(await response.json() as TuAnalysisResponse)
      return true
    } catch (saveError) {
      setError(errorText(saveError, 'Kunde inte spara granskningen.'))
      return false
    } finally {
      setItemBusyId(null)
    }
  }, [applyResponse, inspectionId])

  const startEditingItem = (item: TuAnalysisItem) => {
    setEditingItemId(item.id)
    setEditTitle(item.title)
    setEditSummary(item.summary)
    setEditCertainty(item.certainty)
  }

  const saveEditedItem = async (itemId: string) => {
    const saved = await updateItem(itemId, {
      title: editTitle,
      summary: editSummary,
      certainty: editCertainty,
    })
    if (saved) setEditingItemId(null)
  }

  const pendingCount = workflow?.items.filter((item) => item.reviewStatus === 'pending').length ?? 0
  const acceptedCount = workflow?.items.filter((item) => item.reviewStatus === 'accepted').length ?? 0
  const rejectedCount = workflow?.items.filter((item) => item.reviewStatus === 'rejected').length ?? 0
  const currentAssessmentRequired = (workflow?.run?.rulesetVersion ?? 0) >= 3
  const acceptedCurrentAssessment = workflow?.items.some((item) => (
    item.itemType === 'current_assessment' && item.reviewStatus === 'accepted'
  )) ?? false
  const processing = shouldPoll
  const failed = workflow?.run?.status === 'failed'
  const queuePending = queueCounts.total > 0
  const progressStep = getTuAnalysisProgressStep(workflow?.run)
  const progressMessage = getTuAnalysisProgressMessage(workflow?.run)

  if (loading) {
    return (
      <section className="rounded-lg border border-violet-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <Loader2 size={18} className="animate-spin text-violet-700" aria-hidden />
          Hämtar analysläge...
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
            <BrainCircuit size={21} aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-950">Bedöm och komplettera</h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-600">
              Hela fältunderlaget och bilderna analyseras tillsammans. Resultatet används först när du har granskat det.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void loadState()}
          disabled={Boolean(actionBusy)}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={15} className={processing ? 'animate-spin' : ''} aria-hidden />
          Uppdatera
        </button>
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
                <div className="text-sm text-gray-600">Observationer</div>
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
                <span>
                  {queueCounts.total} fältposter väntar, laddas upp eller behöver åtgärdas. Analysen kan startas när kön är tom.
                </span>
              </div>
            ) : null}
            {validation?.warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <span>{warning}</span>
              </div>
            ))}

            <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4">
              <button
                type="button"
                onClick={() => void runAction('complete')}
                disabled={locked || queuePending || !validation?.canComplete || Boolean(actionBusy)}
                className="inline-flex h-11 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {actionBusy === 'complete' ? <Loader2 size={17} className="animate-spin" aria-hidden /> : <BrainCircuit size={17} aria-hidden />}
                Starta samlad analys
              </button>
              <button
                type="button"
                onClick={onOpenField}
                className="inline-flex h-11 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Tillbaka till fältloggen
              </button>
            </div>
          </div>
        ) : null}

        {processing ? (
          <div className="space-y-5 py-2">
            <div className="flex items-start gap-3">
              <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-700">
                <Loader2 size={22} className="animate-spin" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-700">
                      Steg {progressStep.current} av {progressStep.total} · {progressStep.label}
                    </p>
                    <h3 className="mt-1 text-base font-semibold text-gray-950">Analysen pågår i bakgrunden</h3>
                  </div>
                </div>
                <p className="mt-2 text-sm leading-5 text-gray-700" aria-live="polite">
                  {progressMessage}
                </p>
              </div>
            </div>

            <div>
              {workflow?.run?.progressStage === 'analyzing_images' && workflow.run.progressTotal > 0 ? (
                <p className="text-sm font-medium text-violet-800" aria-live="polite">
                  Bild {Math.min(workflow.run.progressCurrent, workflow.run.progressTotal)} av {workflow.run.progressTotal} analyseras
                </p>
              ) : (
                <div className="h-1.5 overflow-hidden rounded-full bg-violet-100" aria-hidden>
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-violet-700" />
                </div>
              )}
              <div className="mt-3 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 size={14} className="text-violet-700" aria-hidden />
                  Startad {clockText(workflow?.run?.startedAt ?? workflow?.run?.createdAt)}
                </span>
                <span className="tabular-nums">Pågått {elapsedText(workflow?.run?.startedAt ?? workflow?.run?.createdAt, now)}</span>
                <span className="tabular-nums sm:text-right">
                  Senast aktivitet {elapsedText(workflow?.run?.heartbeatAt, now)} sedan
                </span>
              </div>
            </div>

            <div className="rounded-md border border-violet-100 bg-violet-50/60 px-4 py-3">
              <p className="text-sm font-semibold text-gray-950">Du behöver inte göra något medan analysen arbetar.</p>
              <p className="mt-1 text-sm leading-5 text-gray-700">
                Du kan lämna sidan och återkomma senare. Undvik att ändra observationer eller bilder tills analysen är klar, eftersom en sådan ändring avbryter den aktuella körningen.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenField}
                className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Visa fältloggen
              </button>
              <button
                type="button"
                onClick={onOpenEvidence}
                className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
              >
                Visa underlaget
              </button>
            </div>
          </div>
        ) : null}

        {failed ? (
          <div className="space-y-4">
            <div className="flex gap-3 rounded-md border border-rose-200 bg-rose-50 p-4">
              <AlertTriangle size={20} className="shrink-0 text-rose-700" aria-hidden />
              <div>
                <h3 className="font-semibold text-rose-950">Analysen kunde inte slutföras</h3>
                <p className="mt-1 text-sm text-rose-800">
                  {workflow?.run?.errorMessage ?? 'Ett oväntat fel inträffade.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void runAction('retry')}
                disabled={locked || queuePending || Boolean(actionBusy)}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:bg-gray-300"
              >
                {actionBusy === 'retry' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
                Försök igen
              </button>
              <button
                type="button"
                onClick={onOpenField}
                className="inline-flex h-10 items-center rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 hover:bg-gray-50"
              >
                Öppna fältloggen
              </button>
            </div>
          </div>
        ) : null}

        {!processing && !failed && workflow && workflow.status !== 'in_progress' ? (
          <div className="space-y-5">
            {workflow.status === 'analysis_ready' ? (
              <div className="flex gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-4">
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden />
                <div>
                  <h3 className="font-semibold text-emerald-950">Analysen är klar</h3>
                  <p className="mt-1 text-sm leading-5 text-emerald-900">
                    Nästa steg är att granska förslagen nedan. Godkänn, avvisa eller justera varje punkt innan analysen förs över till utlåtandet.
                  </p>
                </div>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="border-b border-gray-200 pb-3">
                <div className="text-2xl font-semibold text-amber-700">{pendingCount}</div>
                <div className="text-sm text-gray-600">Att granska</div>
              </div>
              <div className="border-b border-gray-200 pb-3">
                <div className="text-2xl font-semibold text-emerald-700">{acceptedCount}</div>
                <div className="text-sm text-gray-600">Godkända</div>
              </div>
              <div className="border-b border-gray-200 pb-3">
                <div className="text-2xl font-semibold text-gray-500">{rejectedCount}</div>
                <div className="text-sm text-gray-600">Avvisade</div>
              </div>
            </div>

            {workflow.run?.overview ? (
              <div>
                <h3 className="text-sm font-semibold text-gray-950">Översikt</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-gray-700">{workflow.run.overview}</p>
              </div>
            ) : null}
            {workflow.run?.timelineSummary ? (
              <div className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
                <h3 className="text-sm font-semibold text-blue-950">Hur bedömningen utvecklades</h3>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-blue-900">
                  {workflow.run.timelineSummary}
                </p>
              </div>
            ) : null}
            {workflow.run?.warnings.map((warning) => (
              <div key={warning} className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                <span>{warning}</span>
              </div>
            ))}

            <div className="space-y-3">
              {workflow.items.map((item) => {
                const itemImages = item.sourceImageIds
                  .map((id) => imageById.get(id))
                  .filter((image): image is AnalysisImage => Boolean(image))
                const busy = itemBusyId === item.id
                const editing = editingItemId === item.id
                const currentAssessment = item.itemType === 'current_assessment'
                const evidenceConflict = item.itemType === 'evidence_conflict'
                return (
                  <article
                    key={item.id}
                    className={`rounded-md border p-4 transition ${
                      item.reviewStatus === 'accepted'
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : item.reviewStatus === 'rejected'
                          ? 'border-gray-200 bg-gray-50 opacity-75'
                          : evidenceConflict
                            ? 'border-amber-300 bg-amber-50/30'
                            : currentAssessment
                              ? 'border-violet-400 bg-violet-50/30'
                              : 'border-violet-200 bg-white'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                          <span className={`rounded px-2 py-1 ${
                            evidenceConflict
                              ? 'bg-amber-100 text-amber-900'
                              : currentAssessment
                                ? 'bg-violet-700 text-white'
                                : 'bg-violet-50 text-violet-800'
                          }`}>{TYPE_LABELS[item.itemType]}</span>
                          <span className="rounded bg-gray-100 px-2 py-1 text-gray-700">{CERTAINTY_LABELS[item.certainty]}</span>
                        </div>
                        {editing ? (
                          <div className="mt-3 space-y-3">
                            <label className="block text-xs font-semibold text-gray-700">
                              Rubrik
                              <input
                                value={editTitle}
                                onChange={(event) => setEditTitle(event.target.value)}
                                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm font-normal text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                              />
                            </label>
                            <label className="block text-xs font-semibold text-gray-700">
                              Bedömning
                              <textarea
                                value={editSummary}
                                onChange={(event) => setEditSummary(event.target.value)}
                                rows={5}
                                className="mt-1 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-normal leading-6 text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                              />
                            </label>
                            <label className="block text-xs font-semibold text-gray-700">
                              Bedömningssäkerhet
                              <select
                                value={editCertainty}
                                onChange={(event) => setEditCertainty(event.target.value as TuAnalysisItem['certainty'])}
                                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm font-normal text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                              >
                                <option value="confirmed">Bekräftat</option>
                                <option value="probable">Sannolikt</option>
                                <option value="uncertain">Osäkert</option>
                              </select>
                            </label>
                          </div>
                        ) : (
                          <>
                            <h3 className="mt-2 text-sm font-semibold text-gray-950">{item.title}</h3>
                            <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-700">{item.summary}</p>
                          </>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {busy ? <Loader2 size={17} className="animate-spin text-violet-700" aria-label="Sparar" /> : null}
                        {!editing ? (
                          <button
                            type="button"
                            onClick={() => startEditingItem(item)}
                            disabled={locked || busy}
                            title="Justera AI-förslaget"
                            className="inline-flex size-9 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
                          >
                            <Pencil size={15} aria-hidden />
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {editing ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void saveEditedItem(item.id)}
                          disabled={busy || !editTitle.trim() || !editSummary.trim()}
                          className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:bg-gray-300"
                        >
                          <Save size={15} aria-hidden /> Spara justering
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingItemId(null)}
                          disabled={busy}
                          className="inline-flex h-9 items-center rounded-md border border-gray-300 bg-white px-3 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                        >
                          Avbryt
                        </button>
                      </div>
                    ) : null}

                    {item.supportingReasons.length > 0 ? (
                      <div className="mt-3 text-xs leading-5 text-gray-600">
                        <span className="font-semibold text-gray-800">Stöd:</span> {item.supportingReasons.join(' ')}
                      </div>
                    ) : null}
                    {item.contradictingReasons.length > 0 ? (
                      <div className="mt-1 text-xs leading-5 text-amber-800">
                        <span className="font-semibold">Motsäger/begränsar:</span> {item.contradictingReasons.join(' ')}
                      </div>
                    ) : null}
                    {item.warnings.length > 0 ? (
                      <div className="mt-1 text-xs leading-5 text-rose-700">{item.warnings.join(' ')}</div>
                    ) : null}

                    {item.sourceObservations.length > 0 ? (
                      <details className="mt-3 rounded-md border border-gray-200 bg-white" open={currentAssessment || evidenceConflict ? true : undefined}>
                        <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-gray-800">
                          Källförlopp ({item.sourceObservations.length})
                        </summary>
                        <div className="space-y-2 border-t border-gray-200 p-3">
                          {item.sourceObservations.map((source) => {
                            const sourceRole = item.earlierSourceObservationIds.includes(source.id)
                              ? 'Tidigare uppgift'
                              : item.laterSourceObservationIds.includes(source.id)
                                ? 'Senare uppgift'
                                : 'Källa'
                            return (
                              <div key={source.id} className="grid gap-1 border-l-2 border-violet-200 pl-3 text-xs">
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-600">
                                  <span className="font-semibold text-violet-800">{sourceRole}</span>
                                  <span>#{source.sequence}</span>
                                  <span>{sourceTimeText(source.observedAt)}</span>
                                  {source.location ? <span>{source.location}</span> : null}
                                </div>
                                <p className="whitespace-pre-wrap leading-5 text-gray-800">{source.text}</p>
                              </div>
                            )
                          })}
                        </div>
                      </details>
                    ) : null}

                    {itemImages.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {itemImages.map((image) => (
                          <button
                            key={image.id}
                            type="button"
                            onClick={() => onPreviewImage(image.id)}
                            className="group relative size-20 overflow-hidden rounded border border-gray-200 bg-gray-100"
                            title={image.caption ?? 'Öppna källbild'}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.publicUrl} alt={image.caption ?? 'Källbild'} className="size-full object-cover transition group-hover:scale-105" />
                          </button>
                        ))}
                      </div>
                    ) : item.sourceImageIds.length > 0 ? (
                      <div className="mt-3 inline-flex items-center gap-2 text-xs text-gray-500">
                        <ImageIcon size={14} aria-hidden /> {item.sourceImageIds.length} källbilder
                      </div>
                    ) : null}

                    {evidenceConflict ? (
                      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                        Den här punkten används för att lösa motstridiga fältuppgifter. Den förs inte direkt in i utlåtandet; din godkända aktuella bedömning styr rapporttexten.
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3 border-t border-gray-200 pt-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <label className="text-xs font-medium text-gray-700">
                          Rapportdel
                          <select
                            value={item.targetSectionId ?? ''}
                            disabled={locked || busy}
                            onChange={(event) => void updateItem(item.id, { targetSectionId: event.target.value || null })}
                            className="mt-1 h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                          >
                            <option value="">Inte tilldelad</option>
                            {editableSections.map((section) => (
                              <option key={section.id} value={section.id}>{section.title}</option>
                            ))}
                          </select>
                        </label>
                        {currentAssessment ? (
                          <span className="inline-flex h-9 items-center gap-2 text-sm font-medium text-violet-800">
                            <CheckCircle2 size={16} aria-hidden /> Styr rapportutkastet
                          </span>
                        ) : (
                          <label className="inline-flex h-9 items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={item.includeInReport}
                              disabled={locked || busy}
                              onChange={(event) => void updateItem(item.id, { includeInReport: event.target.checked })}
                              className="size-4 accent-violet-700"
                            />
                            Underlag för utlåtande
                          </label>
                        )}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={locked || busy}
                        onClick={() => void updateItem(item.id, { reviewStatus: 'accepted' })}
                        className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition disabled:opacity-50 ${
                          item.reviewStatus === 'accepted'
                            ? 'bg-emerald-700 text-white'
                            : 'border border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-50'
                        }`}
                      >
                        <Check size={15} aria-hidden /> {
                          currentAssessment
                            ? 'Bekräfta aktuell bedömning'
                            : evidenceConflict
                              ? 'Bekräfta konfliktlösning'
                              : 'Godkänn'
                        }
                      </button>
                      <button
                        type="button"
                        disabled={locked || busy}
                        onClick={() => void updateItem(item.id, { reviewStatus: 'rejected' })}
                        className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition disabled:opacity-50 ${
                          item.reviewStatus === 'rejected'
                            ? 'bg-gray-700 text-white'
                            : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <X size={15} aria-hidden /> Avvisa
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>

            {workflow.items.length === 0 ? (
              <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                Analysen gav inga granskningsbara resultat. Kör om analysen eller komplettera underlaget.
              </div>
            ) : null}

            {workflow.status === 'analysis_approved' ? (
              <TuWholeReportDraftPanel
                inspectionId={inspectionId}
                locked={locked}
                onApplyDraft={onApplyReportDraft}
                onOpenReport={onOpenReport}
                onOpenSectionWriter={onOpenEvidence}
              />
            ) : null}

            {workflow.status !== 'analysis_approved'
              && currentAssessmentRequired
              && !acceptedCurrentAssessment ? (
                <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                  <span>Bekräfta den aktuella samlade bedömningen innan hela analysen godkänns.</span>
                </div>
              ) : null}

            <div className="flex flex-wrap gap-2 border-t border-gray-200 pt-4">
              {workflow.status !== 'analysis_approved' ? (
                <button
                  type="button"
                  onClick={() => void runAction('approve')}
                  disabled={
                    locked
                    || pendingCount > 0
                    || acceptedCount === 0
                    || (currentAssessmentRequired && !acceptedCurrentAssessment)
                    || Boolean(actionBusy)
                  }
                  className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                >
                  {actionBusy === 'approve' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
                  Godkänn analysen
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void runAction('reopen')}
                disabled={locked || Boolean(actionBusy)}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-gray-300 bg-white px-4 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
              >
                <RotateCcw size={16} aria-hidden /> Komplettera fältunderlaget
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
