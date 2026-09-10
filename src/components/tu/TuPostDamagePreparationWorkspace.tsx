'use client'

import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  FileText,
  Files,
  Loader2,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import {
  TU_CONTROL_PLAN_UPDATED_EVENT,
  TU_DAMAGE_TYPE_OPTIONS,
  TU_REMEDIATION_STAGE_OPTIONS,
  summarizeTuControlPlanReview,
  type TuControlPlanResponse,
  type TuControlPlanState,
  type TuDamageType,
  type TuRemediationStage,
  type TuVerificationItem,
} from '@/lib/tu/controlPlan'
import {
  TU_DOCUMENT_SOURCE_ROLE_OPTIONS,
  isTuDocumentAiReadable,
  type TuDocumentAnalysisSourceRole,
  type TuInvestigationDocument,
} from '@/lib/tu/documents'

const AI_DOCUMENT_ACCEPT = '.pdf,.txt,application/pdf,text/plain'

type DocumentActionTarget = 'include' | 'analysis' | 'metadata' | 'delete'

type Props = {
  inspectionId: string
  scopeDescription: string | null
  locked: boolean
  preparation: TuControlPlanState | null
  loading: boolean
  documents: TuInvestigationDocument[]
  documentsLoading: boolean
  documentBusy: boolean
  documentError: string | null
  documentActionTargets: Record<string, DocumentActionTarget>
  onUploadDocument: (
    file: File,
    options: {
      useInAnalysis: boolean
      analysisSourceRole: TuDocumentAnalysisSourceRole
    }
  ) => Promise<TuInvestigationDocument | null>
  onPatchDocument: (
    documentId: string,
    patch: Record<string, unknown>,
    target: DocumentActionTarget
  ) => Promise<TuInvestigationDocument | null>
  onDeleteDocument: (documentId: string) => Promise<boolean>
  onOpenField: () => void
}

type ItemDraft = {
  title: string
  description: string
}

type CaseSavePayload = {
  target: 'case'
  damageTypes: TuDamageType[]
  remediationStage: TuRemediationStage | null
  remediationStageOther: string | null
  mainQuestion: string
}

function caseSaveKey(payload: CaseSavePayload) {
  return JSON.stringify(payload)
}

function itemDraft(item: TuVerificationItem): ItemDraft {
  return {
    title: item.title,
    description: item.description,
  }
}

async function responsePayload(response: Response, fallback: string) {
  const payload = await response.json().catch(() => ({})) as TuControlPlanResponse
  if (!response.ok) throw new Error(payload.error || fallback)
  return payload
}

function formatDocumentDate(value: string | null) {
  if (!value) return null
  const date = new Date(`${value}T00:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('sv-SE')
}

function ControlDirectionItem({
  item,
  documentById,
  locked,
  planApproved,
  busy,
  onSave,
}: {
  item: TuVerificationItem
  documentById: Map<string, TuInvestigationDocument>
  locked: boolean
  planApproved: boolean
  busy: boolean
  onSave: (patch: Record<string, unknown>) => Promise<void>
}) {
  const [draft, setDraft] = useState(() => itemDraft(item))
  const [open, setOpen] = useState(false)
  const included = item.reviewStatus !== 'rejected'

  const save = async () => {
    await onSave({
      ...draft,
      reviewStatus: included ? item.reviewStatus : 'rejected',
    })
  }

  return (
    <article className={`rounded-md border transition ${
      !included
        ? 'border-gray-200 bg-gray-50 opacity-70'
        : 'border-violet-200 bg-white'
    }`}>
      <div className="flex items-start gap-2 px-3 py-3 sm:px-4">
        <label className="mt-0.5 inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md bg-violet-50">
          <input
            type="checkbox"
            checked={included}
            onChange={() => void onSave({ reviewStatus: included ? 'rejected' : 'accepted' })}
            disabled={locked || planApproved || busy}
            aria-label={`${included ? 'Ta bort' : 'Ta med'} ${item.title}`}
            className="size-4 rounded border-gray-300 text-violet-700 focus:ring-violet-500 disabled:cursor-not-allowed"
          />
        </label>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          aria-expanded={open}
        >
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold leading-5 text-gray-950">{item.title}</span>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${included
                ? 'bg-violet-50 text-violet-800'
                : 'bg-gray-100 text-gray-500'}`}
              >
                {included ? 'Ingår' : 'Bortvald'}
              </span>
            </span>
            <span className="mt-1 line-clamp-2 block text-xs leading-5 text-gray-600">
              {item.description}
            </span>
          </span>
          <ChevronDown size={17} className={`mt-1 shrink-0 text-gray-500 transition ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-gray-100 px-3 py-4 sm:px-4">
          {!planApproved ? (
            <div className="grid gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Uppmärksamhetsområde</span>
                <input
                  value={draft.title}
                  onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
                  disabled={locked || busy}
                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Att vara uppmärksam på</span>
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  disabled={locked || busy}
                  rows={3}
                  className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              </label>
            </div>
          ) : null}

          {item.verificationMethod ? (
            <details className="rounded-md bg-violet-50/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-semibold text-violet-900">Visa praktiskt stöd</summary>
              <p className="mt-2 text-xs leading-5 text-gray-700">{item.verificationMethod}</p>
            </details>
          ) : null}

          <details className="rounded-md bg-gray-50 px-3 py-2">
            <summary className="cursor-pointer text-xs font-semibold text-gray-700">Visa källstöd ({item.sourceReferences.length})</summary>
            <div className="mt-2 space-y-2">
              {item.sourceReferences.map((reference, index) => {
                const document = documentById.get(reference.documentId)
                return (
                  <blockquote key={`${reference.documentId}:${reference.page ?? 'x'}:${index}`} className="border-l-2 border-violet-300 pl-3 text-xs leading-5 text-gray-600">
                    <p className="font-semibold text-gray-800">
                      {document?.title || document?.fileName || 'Källdokument'}{reference.page ? `, sida ${reference.page}` : ''}
                    </p>
                    <p>”{reference.excerpt}”</p>
                  </blockquote>
                )
              })}
            </div>
          </details>

          {planApproved ? (
            <p className="border-t border-gray-100 pt-3 text-xs leading-5 text-gray-600">
              Detta är ett internt minnesstöd. Dokumentera det du faktiskt ser som observation, mätning eller bild.
            </p>
          ) : (
            <div className="flex justify-end border-t border-gray-100 pt-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={locked || busy || !draft.title.trim() || !draft.description.trim()}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Save size={15} aria-hidden />}
                Spara område
              </button>
            </div>
          )}
        </div>
      ) : null}
    </article>
  )
}

export default function TuPostDamagePreparationWorkspace({
  inspectionId,
  scopeDescription,
  locked,
  preparation: externalPreparation,
  loading,
  documents,
  documentsLoading,
  documentBusy,
  documentError,
  documentActionTargets,
  onUploadDocument,
  onPatchDocument,
  onDeleteDocument,
  onOpenField,
}: Props) {
  const toast = useToast()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [preparation, setPreparation] = useState<TuControlPlanState | null>(externalPreparation)
  const [damageTypes, setDamageTypes] = useState<TuDamageType[]>([])
  const [remediationStage, setRemediationStage] = useState<TuRemediationStage | ''>('')
  const [remediationStageOther, setRemediationStageOther] = useState('')
  const [mainQuestion, setMainQuestion] = useState(scopeDescription ?? '')
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [documentDropActive, setDocumentDropActive] = useState(false)
  const lastSavedCaseKeyRef = useRef<string | null>(null)

  useEffect(() => {
    setPreparation(externalPreparation)
    if (!externalPreparation) return
    const nextDamageTypes = externalPreparation.case.damageTypes
    const nextRemediationStage = externalPreparation.case.remediationStage ?? ''
    const nextRemediationStageOther = externalPreparation.case.remediationStageOther ?? ''
    const nextMainQuestion = externalPreparation.case.mainQuestion ?? scopeDescription ?? ''
    setDamageTypes(nextDamageTypes)
    setRemediationStage(nextRemediationStage)
    setRemediationStageOther(nextRemediationStageOther)
    setMainQuestion(nextMainQuestion)
    lastSavedCaseKeyRef.current = caseSaveKey({
      target: 'case',
      damageTypes: nextDamageTypes,
      remediationStage: nextRemediationStage || null,
      remediationStageOther: nextRemediationStage === 'other' ? nextRemediationStageOther.trim() || null : null,
      mainQuestion: nextMainQuestion,
    })
  }, [externalPreparation, scopeDescription])

  const sourceDocuments = useMemo(
    () => documents.filter((document) => document.useInAnalysis),
    [documents]
  )
  const unreadableSourceCount = useMemo(
    () => sourceDocuments.filter((document) => !isTuDocumentAiReadable(document)).length,
    [sourceDocuments]
  )
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents]
  )
  const processing = actionBusy === 'generate'
    || preparation?.run?.status === 'queued'
    || preparation?.run?.status === 'processing'
  const approved = preparation?.case.status === 'plan_approved' && !preparation.case.planStaleAt
  const planReady = preparation?.run?.status === 'completed' && preparation.items.length > 0
  const reviewSummary = summarizeTuControlPlanReview(preparation?.items ?? [])

  const publishState = (next: TuControlPlanState | null) => {
    if (next) setPreparation(next)
    window.dispatchEvent(new CustomEvent(TU_CONTROL_PLAN_UPDATED_EVENT, {
      detail: { inspectionId, preparation: next },
    }))
  }

  const callPreparation = async (method: 'POST' | 'PATCH', body: Record<string, unknown>, fallback: string) => {
    const response = await fetch(`/api/tu/investigations/${inspectionId}/preparation`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return responsePayload(response, fallback)
  }

  const caseDraftPayload = useMemo<CaseSavePayload>(() => ({
    target: 'case',
    damageTypes,
    remediationStage: remediationStage || null,
    remediationStageOther: remediationStage === 'other' ? remediationStageOther.trim() || null : null,
    mainQuestion,
  }), [damageTypes, mainQuestion, remediationStage, remediationStageOther])
  const caseDraftKey = useMemo(() => caseSaveKey(caseDraftPayload), [caseDraftPayload])
  const caseAutosave = useAutosaveQueue<CaseSavePayload, TuControlPlanResponse>({
    save: (payload) => callPreparation(
      'PATCH',
      payload,
      'Kunde inte autospara kontrollens förutsättningar.'
    ),
    mergePayload: (_previous, next) => next,
    onSaved: (payload, savedPayload) => {
      lastSavedCaseKeyRef.current = caseSaveKey(savedPayload)
      publishState(payload.preparation ?? null)
    },
    onError: (error) => {
      toast.error(error, 'Kunde inte autospara kontrollens förutsättningar.')
    },
  })
  const caseDescriptionMissing = remediationStage === 'other' && !remediationStageOther.trim()
  const caseHasUnsavedChanges = caseDraftKey !== lastSavedCaseKeyRef.current
  const enqueueCaseSave = caseAutosave.enqueue

  useEffect(() => {
    if (locked || loading || processing || caseDescriptionMissing || !caseHasUnsavedChanges) return
    const timer = window.setTimeout(() => {
      void enqueueCaseSave(caseDraftPayload).catch(() => undefined)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [
    caseDescriptionMissing,
    caseDraftKey,
    caseDraftPayload,
    caseHasUnsavedChanges,
    enqueueCaseSave,
    loading,
    locked,
    processing,
  ])

  const startPlan = async () => {
    setActionBusy('generate')
    try {
      const casePayload = await enqueueCaseSave(caseDraftPayload)
      if (!casePayload) throw new Error('Kunde inte spara kontrollens förutsättningar.')
      lastSavedCaseKeyRef.current = caseDraftKey
      publishState(casePayload.preparation ?? null)

      const payload = await callPreparation('POST', {
        action: preparation?.run?.status === 'failed' ? 'retry' : 'generate',
      }, 'Kunde inte skapa kontrollinriktningen.')
      publishState(payload.preparation ?? null)
      toast.info('AI läser underlagen i bakgrunden. Du kan lämna sidan under tiden.')
    } catch (error) {
      toast.error(error, 'Kunde inte skapa kontrollinriktningen.')
    } finally {
      setActionBusy(null)
    }
  }

  const saveItem = async (itemId: string, patch: Record<string, unknown>) => {
    setActionBusy(`item:${itemId}`)
    try {
      const payload = await callPreparation('PATCH', { target: 'item', itemId, ...patch }, 'Kunde inte spara uppmärksamhetsområdet.')
      if (payload.item) {
        const next = preparation
          ? {
              ...preparation,
              case: preparation.case.status === 'plan_approved'
                ? { ...preparation.case, status: 'plan_ready' as const, planApprovedAt: null }
                : preparation.case,
              items: preparation.items.map((item) => item.id === payload.item?.id
                ? { ...payload.item, observationIds: item.observationIds }
                : item),
            }
          : null
        publishState(next)
      }
      toast.success('Uppmärksamhetsområdet har sparats.')
    } catch (error) {
      toast.error(error, 'Kunde inte spara uppmärksamhetsområdet.')
    } finally {
      setActionBusy(null)
    }
  }

  const approvePlan = async () => {
    setActionBusy('approve')
    try {
      const payload = await callPreparation('POST', { action: 'approve' }, 'Kunde inte godkänna kontrollinriktningen.')
      publishState(payload.preparation ?? null)
      toast.success('Kontrollinriktningen är klar som minnesstöd på plats.')
      onOpenField()
    } catch (error) {
      toast.error(error, 'Kunde inte godkänna kontrollinriktningen.')
    } finally {
      setActionBusy(null)
    }
  }

  const reopenPlan = async () => {
    setActionBusy('reopen')
    try {
      const payload = await callPreparation('POST', { action: 'reopen' }, 'Kunde inte öppna kontrollinriktningen.')
      publishState(payload.preparation ?? null)
    } catch (error) {
      toast.error(error, 'Kunde inte öppna kontrollinriktningen.')
    } finally {
      setActionBusy(null)
    }
  }

  const uploadSourceDocuments = async (files: File[]) => {
    const acceptedFiles = files.filter((file) => {
      const name = file.name.toLowerCase()
      return file.type === 'application/pdf'
        || file.type === 'text/plain'
        || name.endsWith('.pdf')
        || name.endsWith('.txt')
    })
    if (acceptedFiles.length === 0) {
      toast.error('Välj dokument i PDF- eller textformat.')
      return
    }

    let uploadedCount = 0
    for (const file of acceptedFiles) {
      const uploaded = await onUploadDocument(file, {
        useInAnalysis: true,
        analysisSourceRole: 'prior_report',
      })
      if (uploaded) uploadedCount += 1
    }
    if (uploadedCount > 0) {
      publishState(preparation)
      toast.success(uploadedCount === 1
        ? 'Underlaget har laddats upp och valts för analys.'
        : `${uploadedCount} underlag har laddats upp och valts för analys.`)
    }
    if (acceptedFiles.length < files.length) {
      toast.info('Filer som inte var PDF eller text hoppades över.')
    }
  }

  const handleDocumentDragOver = (event: DragEvent<HTMLElement>) => {
    if (locked || documentBusy || processing || !event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDocumentDropActive(true)
  }

  const handleDocumentDragLeave = (event: DragEvent<HTMLElement>) => {
    const nextTarget = event.relatedTarget
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
    setDocumentDropActive(false)
  }

  const handleDocumentDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    setDocumentDropActive(false)
    if (locked || documentBusy || processing) return
    void uploadSourceDocuments(Array.from(event.dataTransfer.files))
  }

  if (loading && !preparation) {
    return (
      <section className="rounded-lg border border-violet-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <Loader2 size={18} className="animate-spin text-violet-700" aria-hidden />
          Hämtar förberedelsen...
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border border-violet-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
            <Files size={21} aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-gray-950">Förbered kontrollen</h2>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-gray-600">
              Lägg in tidigare underlag. AI sammanfattar ett fåtal områden att ha i åtanke under besöket.
            </p>
          </div>
        </div>
        {approved ? (
          <span className="inline-flex h-8 items-center gap-2 rounded-md bg-emerald-50 px-3 text-xs font-semibold text-emerald-800">
            <CheckCircle2 size={15} aria-hidden />
            Inriktning klar
          </span>
        ) : null}
      </header>

      <div className="divide-y divide-gray-200">
        <div className="space-y-4 px-4 py-5 sm:px-5">
          <div>
            <h3 className="text-sm font-semibold text-gray-950">1. Kontrollens inriktning</h3>
            <p className="mt-1 text-sm text-gray-600">Välj det som är känt. Alla val kan lämnas tomma och kompletteras senare.</p>
          </div>
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-gray-700">Skadetyp <span className="font-normal text-gray-500">(valfritt)</span></legend>
            <div className="flex flex-wrap gap-2">
              {TU_DAMAGE_TYPE_OPTIONS.map((option) => {
                const selected = damageTypes.includes(option.value)
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setDamageTypes((current) => selected
                      ? current.filter((value) => value !== option.value)
                      : [...current, option.value])}
                    disabled={locked || processing}
                    aria-pressed={selected}
                    className={`h-9 rounded-md border px-3 text-sm font-medium transition ${selected
                      ? 'border-violet-600 bg-violet-50 text-violet-900'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-violet-200 hover:bg-violet-50/50'} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
          <div className="grid items-start gap-3 md:grid-cols-[minmax(210px,0.35fr)_minmax(0,1fr)]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Skede vid kontroll <span className="font-normal text-gray-500">(valfritt)</span></span>
              <select
                value={remediationStage}
                onChange={(event) => {
                  const nextStage = event.target.value as TuRemediationStage | ''
                  setRemediationStage(nextStage)
                  if (nextStage !== 'other') setRemediationStageOther('')
                }}
                disabled={locked || processing}
                className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
              >
                <option value="">Välj skede</option>
                {TU_REMEDIATION_STAGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              {remediationStage === 'other' ? (
                <input
                  value={remediationStageOther}
                  onChange={(event) => setRemediationStageOther(event.target.value)}
                  disabled={locked || processing}
                  maxLength={200}
                  required
                  placeholder="Beskriv skedet"
                  className="mt-2 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                />
              ) : null}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-700">Vad ska kontrolleras?</span>
              <textarea
                value={mainQuestion}
                onChange={(event) => setMainQuestion(event.target.value)}
                disabled={locked || processing}
                placeholder="Exempel: Bedöm om dokumenterade åtgärder kan verifieras före återställning."
                rows={4}
                className="min-h-24 w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-5 text-gray-950 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
              />
              <span className="mt-1 block text-xs text-gray-500">Förifylls från uppdragets omfattning och kan anpassas inför kontrollen.</span>
            </label>
          </div>
          <div className="flex min-h-6 items-center justify-end gap-2 text-xs font-medium" aria-live="polite">
            {caseDescriptionMissing ? (
              <span className="text-amber-800">Beskriv skedet för att spara.</span>
            ) : caseAutosave.status === 'saving' ? (
              <span className="inline-flex items-center gap-1.5 text-gray-600"><Loader2 size={14} className="animate-spin" aria-hidden /> Sparar...</span>
            ) : caseAutosave.status === 'error' ? (
              <>
                <span className="text-rose-700">Kunde inte spara.</span>
                <button
                  type="button"
                  onClick={() => void enqueueCaseSave(caseDraftPayload).catch(() => undefined)}
                  className="font-semibold text-violet-800 underline decoration-violet-300 underline-offset-2"
                >
                  Försök igen
                </button>
              </>
            ) : caseHasUnsavedChanges ? (
              <span className="text-gray-500">Osparade ändringar</span>
            ) : (
              <span className="inline-flex items-center gap-1.5 text-emerald-700"><Check size={14} aria-hidden /> Sparat automatiskt</span>
            )}
          </div>
        </div>

        <div className="space-y-4 px-4 py-5 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">2. Underlag för inriktningen</h3>
              <p className="mt-1 text-sm text-gray-600">PDF och text kan läsas av AI. Leveransbilagor hanteras senare i utlåtandet.</p>
            </div>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={locked || documentBusy || processing}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {documentBusy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Upload size={16} aria-hidden />}
              Lägg till underlag
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept={AI_DOCUMENT_ACCEPT}
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? [])
                event.target.value = ''
                void uploadSourceDocuments(files)
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={handleDocumentDragOver}
            onDragOver={handleDocumentDragOver}
            onDragLeave={handleDocumentDragLeave}
            onDrop={handleDocumentDrop}
            disabled={locked || documentBusy || processing}
            className={`flex min-h-24 w-full flex-col items-center justify-center rounded-md border border-dashed px-4 text-center text-sm transition disabled:cursor-not-allowed disabled:opacity-60 ${documentDropActive
              ? 'border-violet-600 bg-violet-100 text-violet-950 ring-2 ring-violet-200'
              : 'border-violet-200 bg-violet-50/40 text-gray-600 hover:border-violet-400 hover:bg-violet-50'}`}
          >
            {documentBusy ? <Loader2 size={22} className="mb-2 animate-spin text-violet-700" aria-hidden /> : <Upload size={22} className="mb-2 text-violet-600" aria-hidden />}
            <span className="font-semibold">{documentDropActive ? 'Släpp dokumenten här' : 'Dra dokument hit eller välj filer'}</span>
            <span className="mt-1 text-xs text-gray-500">PDF och textfiler</span>
          </button>

          {documentsLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-gray-600">
              <Loader2 size={16} className="animate-spin text-violet-700" aria-hidden /> Hämtar dokument...
            </div>
          ) : documents.length > 0 ? (
            <div className="divide-y divide-gray-100 rounded-md border border-gray-200">
              {documents.map((document) => {
                const pendingTarget = documentActionTargets[document.id]
                const readable = isTuDocumentAiReadable(document)
                return (
                  <div key={document.id} className={`grid gap-3 px-3 py-3 transition md:grid-cols-[minmax(0,1fr)_190px_150px_auto] md:items-center ${pendingTarget ? 'bg-violet-50/50' : ''}`}>
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-700">
                        {pendingTarget ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <FileText size={16} aria-hidden />}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-950">{document.title || document.fileName || 'Dokument'}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {document.documentDate ? formatDocumentDate(document.documentDate) : 'Datum saknas'}
                          {!readable ? ' · kan inte läsas av AI' : ''}
                        </p>
                      </div>
                    </div>
                    <select
                      value={document.analysisSourceRole}
                      onChange={(event) => void onPatchDocument(document.id, {
                        analysisSourceRole: event.target.value,
                      }, 'metadata').then(() => publishState(preparation))}
                      disabled={locked || processing || Boolean(pendingTarget)}
                      aria-label="Dokumentets roll"
                      className="h-9 w-full rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-800 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                    >
                      {TU_DOCUMENT_SOURCE_ROLE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <label className="inline-flex min-h-9 items-center gap-2 text-xs font-semibold text-gray-700">
                      <input
                        type="checkbox"
                        checked={document.useInAnalysis}
                        onChange={(event) => void onPatchDocument(document.id, {
                          useInAnalysis: event.target.checked,
                        }, 'analysis').then(() => publishState(preparation))}
                        disabled={locked || processing || Boolean(pendingTarget) || (!readable && !document.useInAnalysis)}
                        className="size-4 rounded border-gray-300 text-violet-700 focus:ring-violet-500"
                      />
                      Använd i analysen
                    </label>
                    <div className="flex justify-end gap-1">
                      {document.signedUrl ? (
                        <a
                          href={document.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="Öppna dokument"
                          title="Öppna dokument"
                          className="inline-flex size-9 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50"
                        >
                          <ExternalLink size={15} aria-hidden />
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void onDeleteDocument(document.id).then((deleted) => {
                          if (deleted) publishState(preparation)
                        })}
                        disabled={locked || processing || Boolean(pendingTarget)}
                        aria-label="Ta bort dokument"
                        title="Ta bort dokument"
                        className="inline-flex size-9 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:text-gray-300"
                      >
                        <Trash2 size={15} aria-hidden />
                      </button>
                    </div>
                    <details className="md:col-span-4 md:ml-11">
                      <summary className="cursor-pointer text-xs font-semibold text-violet-800">
                        Källuppgifter
                      </summary>
                      <div className="mt-3 grid gap-3 rounded-md bg-gray-50 p-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-gray-700">Uppgiftslämnare <span className="font-normal text-gray-500">(valfritt)</span></span>
                          <input
                            key={`${document.id}:party:${document.sourceParty ?? ''}`}
                            defaultValue={document.sourceParty ?? ''}
                            onBlur={(event) => {
                              const sourceParty = event.currentTarget.value.trim()
                              if (sourceParty === (document.sourceParty ?? '')) return
                              void onPatchDocument(document.id, { sourceParty }, 'metadata')
                                .then(() => publishState(preparation))
                            }}
                            disabled={locked || processing || Boolean(pendingTarget)}
                            placeholder="Exempel: fastighetsägaren eller entreprenören"
                            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-gray-700">Dokumentdatum <span className="font-normal text-gray-500">(valfritt)</span></span>
                          <input
                            key={`${document.id}:date:${document.documentDate ?? ''}`}
                            type="date"
                            defaultValue={document.documentDate ?? ''}
                            onBlur={(event) => {
                              const documentDate = event.currentTarget.value || null
                              if (documentDate === document.documentDate) return
                              void onPatchDocument(document.id, { documentDate }, 'metadata')
                                .then(() => publishState(preparation))
                            }}
                            disabled={locked || processing || Boolean(pendingTarget)}
                            className="h-9 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-gray-100"
                          />
                        </label>
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
          ) : null}

          {documentError ? (
            <div role="alert" className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
              {documentError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <p className="text-sm text-gray-600">
              {sourceDocuments.length === 0
                ? 'Välj minst ett läsbart dokument.'
                : unreadableSourceCount > 0
                  ? `${unreadableSourceCount} valt dokument kan inte läsas av AI.`
                  : `${sourceDocuments.length} dokument valda för gemensam analys.`}
            </p>
            <button
              type="button"
              onClick={() => void startPlan()}
              disabled={locked || processing || documentBusy || caseDescriptionMissing || sourceDocuments.length === 0 || unreadableSourceCount > 0 || actionBusy === 'generate'}
              className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              {processing || actionBusy === 'generate'
                ? <Loader2 size={16} className="animate-spin" aria-hidden />
                : planReady ? <RefreshCw size={16} aria-hidden /> : <Sparkles size={16} aria-hidden />}
              {processing ? 'Skapar inriktning...' : planReady ? 'Skapa om inriktningen' : 'Skapa kontrollinriktning'}
            </button>
          </div>

          {processing ? (
            <div role="status" className="flex gap-3 rounded-md border border-violet-200 bg-violet-50 px-3 py-3 text-sm text-violet-950">
              <Loader2 size={18} className="mt-0.5 shrink-0 animate-spin" aria-hidden />
              <div>
                <p className="font-semibold">AI arbetar i bakgrunden</p>
                <p className="mt-0.5 text-violet-800">{preparation?.run?.progressMessage || 'Läser samtliga dokument tillsammans.'}</p>
              </div>
            </div>
          ) : preparation?.run?.status === 'failed' ? (
            <div className="flex gap-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-800">
              <AlertTriangle size={18} className="mt-0.5 shrink-0" aria-hidden />
              <span>Kontrollinriktningen kunde inte skapas. Försök igen.</span>
            </div>
          ) : null}
        </div>

        {planReady ? (
          <div className="space-y-5 px-4 py-5 sm:px-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-950">3. Granska kontrollinriktningen</h3>
              <p className="mt-1 text-sm text-gray-600">Kontrollera att de föreslagna områdena är relevanta. De är ett minnesstöd, inte en checklista som måste bockas av.</p>
            </div>

            {preparation?.case.planStaleAt ? (
              <div className="flex gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <AlertTriangle size={17} className="mt-0.5 shrink-0" aria-hidden />
                Underlaget har ändrats. Skapa om inriktningen innan den används.
              </div>
            ) : null}

            {preparation?.case.conflicts.length ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-950">
                  <AlertTriangle size={17} aria-hidden /> Motstridiga uppgifter
                </p>
                <ul className="mt-2 space-y-1 text-sm leading-5 text-amber-900">
                  {preparation.case.conflicts.map((conflict) => <li key={conflict}>• {conflict}</li>)}
                </ul>
              </div>
            ) : null}

            {preparation?.case.essentialQuestions.length ? (
              <div className="rounded-md border border-sky-200 bg-sky-50 px-3 py-3">
                <p className="text-sm font-semibold text-sky-950">Oklarheter att ha i åtanke</p>
                <ol className="mt-2 space-y-1 text-sm leading-5 text-sky-900">
                  {preparation.case.essentialQuestions.map((question, index) => <li key={question}>{index + 1}. {question}</li>)}
                </ol>
              </div>
            ) : null}

            {preparation?.case.overview ? (
              <p className="border-l-2 border-violet-300 pl-3 text-sm leading-6 text-gray-700">{preparation.case.overview}</p>
            ) : null}

            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium text-gray-500">
              <span>{reviewSummary.included} valda områden</span>
              {reviewSummary.rejected > 0 ? <span>{reviewSummary.rejected} bortvalda</span> : null}
            </div>

            <div className="space-y-2">
              {preparation?.items.map((item) => (
                <ControlDirectionItem
                  key={`${item.id}:${item.updatedAt ?? ''}:${item.reviewStatus}`}
                  item={item}
                  documentById={documentById}
                  locked={locked}
                  planApproved={approved}
                  busy={actionBusy === `item:${item.id}`}
                  onSave={(patch) => saveItem(item.id, patch)}
                />
              ))}
            </div>

            <div className="flex flex-col gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="max-w-xl text-sm text-gray-600">
                {approved
                  ? 'Inriktningen visas som ett frivilligt minnesstöd. Observationer, mätningar och bilder är det faktiska resultatunderlaget.'
                  : reviewSummary.included === 0
                    ? 'Välj minst ett uppmärksamhetsområde för att kunna fortsätta.'
                    : 'Godkänn inriktningen när områdena ger en tillräcklig överblick inför besöket.'}
              </p>
              <div className="flex shrink-0 flex-wrap gap-2">
                {approved ? (
                  <button
                    type="button"
                    onClick={() => void reopenPlan()}
                    disabled={locked || actionBusy === 'reopen'}
                    className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    {actionBusy === 'reopen' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <RefreshCw size={16} aria-hidden />}
                    Ändra inriktningen
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void approvePlan()}
                    disabled={locked || actionBusy === 'approve' || Boolean(preparation?.case.planStaleAt) || !reviewSummary.canApprove}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    {actionBusy === 'approve' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CheckCircle2 size={16} aria-hidden />}
                    Godkänn och börja dokumentera
                  </button>
                )}
                {approved ? (
                  <button
                    type="button"
                    onClick={onOpenField}
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
                  >
                    Fortsätt dokumentera
                    <ArrowRight size={16} aria-hidden />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}
