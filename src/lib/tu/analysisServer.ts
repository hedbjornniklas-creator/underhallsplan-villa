import 'server-only'

import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  isTuAnalysisCertainty,
  isTuAnalysisItemType,
  isTuAnalysisProgressStage,
  isTuAnalysisReviewStatus,
  isTuAnalysisRunStatus,
  isTuAnalysisWorkflowStatus,
  type TuAnalysisItem,
  type TuAnalysisSourceObservation,
  type TuAnalysisRun,
  type TuAnalysisValidation,
  type TuAnalysisWorkflow,
} from '@/lib/tu/analysis'
import {
  parseTuAnalysisBackgroundState,
  tuImageBatchMaxOutputTokens,
  tuAnalysisFailureMessage,
  tuAnalysisBackgroundPayload,
  type TuAnalysisBackgroundState,
} from '@/lib/tu/analysisBackground'
import { usesTuAiAssistedWorkflow } from '@/lib/tu/authoring'
import { getApprovedTuControlPlanSnapshot } from '@/lib/tu/controlPlanServer'
import {
  isTuPostDamageReport,
  TU_POST_DAMAGE_SOURCE_POLICY,
} from '@/lib/tu/reportTemplates'
import { isTuAnalysisSourceImage } from '@/lib/tu/evidence'
import { listTuObservations } from '@/lib/tu/evidenceServer'
import { sortTuEvidenceChronologically } from '@/lib/tu/grounding'
import { formatTuMeasurementAssessment } from '@/lib/tu/measurementConfig'
import {
  deriveTuMeasurementImageVerifications,
  getTuMeasurementImageIds,
  parseTuMeasurementImageVerifications,
} from '@/lib/tu/measurementVerification'
import {
  normalizeTuReportProviderResponse,
  tuReportProviderFailureMessage,
} from '@/lib/tu/reportDraftBackground'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  type TuInvestigationImage,
} from '@/lib/tu/server'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_ANALYSIS_MODEL =
  process.env.OPENAI_TU_ANALYSIS_MODEL?.trim()
  || 'gpt-5.6'
const RULESET_KEY = 'tu_ai_assisted_inspection_v1'
const RULESET_VERSION = 3
const IMAGE_BATCH_SIZE = 8
const DEFAULT_MAX_IMAGES = 80
const STALE_RUN_MINUTES = 12
const PROVIDER_CREATE_TIMEOUT_MS = 30_000
const PROVIDER_RETRIEVE_TIMEOUT_MS = 20_000
const PROVIDER_MAX_JOB_AGE_MS = 8 * 60 * 1_000
const SYNTHESIS_MAX_OUTPUT_TOKENS = 24_000

type JsonRecord = Record<string, unknown>

type WorkflowRow = {
  status: string
  fieldwork_completed_at: string | null
  analysis_approved_at: string | null
  analysis_stale_at: string | null
  current_analysis_run_id: string | null
}

type RunRow = {
  id: string
  status: string
  model: string
  ruleset_key: string
  ruleset_version: number
  attempt_count: number | null
  error_message: string | null
  progress_stage: string | null
  progress_current: number | null
  progress_total: number | null
  progress_message: string | null
  heartbeat_at: string | null
  output_payload: unknown
  input_snapshot: unknown
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}

type ItemRow = {
  id: string
  run_id: string
  item_type: string
  title: string
  summary: string
  certainty: string
  review_status: string
  target_section_id: string | null
  include_in_report: boolean | null
  source_observation_ids: unknown
  source_image_ids: unknown
  source_measurement_ids: unknown
  earlier_source_observation_ids: unknown
  later_source_observation_ids: unknown
  supporting_reasons: unknown
  contradicting_reasons: unknown
  warnings: unknown
  sort_order: number | null
  created_at: string | null
  updated_at: string | null
}

type OpenAiResponse = {
  id?: string
  status?: string
  incomplete_details?: unknown
  error?: unknown
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}

type ImageAnalysis = {
  imageId: string
  visibleFacts: string[]
  displayReadings: string[]
  quality: 'good' | 'limited' | 'unusable'
  relevance: 'high' | 'medium' | 'low'
  possibleDuplicateImageIds: string[]
  warnings: string[]
}

type AnalysisDraftItem = {
  itemType: string
  title: string
  summary: string
  certainty: string
  targetSectionId: string | null
  includeInReport: boolean
  sourceObservationIds: string[]
  sourceImageIds: string[]
  sourceMeasurementIds: string[]
  earlierSourceObservationIds: string[]
  laterSourceObservationIds: string[]
  supportingReasons: string[]
  contradictingReasons: string[]
  warnings: string[]
}

type AnalysisDraft = {
  overview: string
  timelineSummary: string
  warnings: string[]
  items: AnalysisDraftItem[]
}

const WORKFLOW_COLUMNS = [
  'status',
  'fieldwork_completed_at',
  'analysis_approved_at',
  'analysis_stale_at',
  'current_analysis_run_id',
].join(',')

const RUN_COLUMNS = [
  'id',
  'status',
  'model',
  'ruleset_key',
  'ruleset_version',
  'attempt_count',
  'error_message',
  'progress_stage',
  'progress_current',
  'progress_total',
  'progress_message',
  'heartbeat_at',
  'output_payload',
  'input_snapshot',
  'created_at',
  'started_at',
  'completed_at',
].join(',')

const ITEM_COLUMNS = [
  'id',
  'run_id',
  'item_type',
  'title',
  'summary',
  'certainty',
  'review_status',
  'target_section_id',
  'include_in_report',
  'source_observation_ids',
  'source_image_ids',
  'source_measurement_ids',
  'earlier_source_observation_ids',
  'later_source_observation_ids',
  'supporting_reasons',
  'contradicting_reasons',
  'warnings',
  'sort_order',
  'created_at',
  'updated_at',
].join(',')

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function isoOrNow(value: string | null | undefined) {
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString()
}

function mapRun(row: RunRow): TuAnalysisRun {
  const output = record(row.output_payload)
  const status = isTuAnalysisRunStatus(row.status) ? row.status : 'failed'
  const fallbackProgressStage = status === 'processing'
    ? 'preparing'
    : status
  return {
    id: row.id,
    status,
    model: row.model,
    rulesetKey: row.ruleset_key,
    rulesetVersion: row.ruleset_version,
    attemptCount: row.attempt_count ?? 0,
    errorMessage: row.error_message,
    progressStage: isTuAnalysisProgressStage(row.progress_stage)
      ? row.progress_stage
      : fallbackProgressStage,
    progressCurrent: Math.max(0, row.progress_current ?? 0),
    progressTotal: Math.max(0, row.progress_total ?? 0),
    progressMessage: cleanText(row.progress_message) || null,
    heartbeatAt: row.heartbeat_at,
    overview: cleanText(output.overview) || null,
    timelineSummary: cleanText(output.timelineSummary) || null,
    warnings: stringArray(output.warnings),
    measurementVerifications: parseTuMeasurementImageVerifications(output.measurementVerifications),
    createdAt: isoOrNow(row.created_at),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

function mapItem(
  row: ItemRow,
  sourceObservationById: Map<string, TuAnalysisSourceObservation> = new Map()
): TuAnalysisItem {
  const sourceObservationIds = stringArray(row.source_observation_ids)
  return {
    id: row.id,
    runId: row.run_id,
    itemType: isTuAnalysisItemType(row.item_type) ? row.item_type : 'information_gap',
    title: row.title,
    summary: row.summary,
    certainty: isTuAnalysisCertainty(row.certainty) ? row.certainty : 'uncertain',
    reviewStatus: isTuAnalysisReviewStatus(row.review_status) ? row.review_status : 'pending',
    targetSectionId: row.target_section_id,
    includeInReport: row.include_in_report !== false,
    sourceObservationIds,
    sourceImageIds: stringArray(row.source_image_ids),
    sourceMeasurementIds: stringArray(row.source_measurement_ids),
    earlierSourceObservationIds: stringArray(row.earlier_source_observation_ids),
    laterSourceObservationIds: stringArray(row.later_source_observation_ids),
    sourceObservations: sourceObservationIds
      .map((id) => sourceObservationById.get(id))
      .filter((item): item is TuAnalysisSourceObservation => Boolean(item)),
    supportingReasons: stringArray(row.supporting_reasons),
    contradictingReasons: stringArray(row.contradicting_reasons),
    warnings: stringArray(row.warnings),
    sortOrder: row.sort_order ?? 100,
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
  }
}

function mapSnapshotSourceObservations(snapshotValue: unknown) {
  const snapshot = record(snapshotValue)
  const rows = Array.isArray(snapshot.observations) ? snapshot.observations.map(record) : []
  const chronological = sortTuEvidenceChronologically(rows.map((row) => ({
    id: cleanText(row.id),
    observedAt: cleanText(row.observedAt),
    sourceType: cleanText(row.sourceType),
    location: cleanText(row.location) || null,
    buildingComponent: cleanText(row.buildingComponent) || null,
    noteText: cleanText(row.noteText),
    transcriptText: cleanText(row.transcriptText),
    riskNote: cleanText(row.riskNote),
    suggestedFollowUp: cleanText(row.suggestedFollowUp),
    measurements: Array.isArray(row.measurements) ? row.measurements.map(record) : [],
  })).filter((row) => row.id))

  return new Map(chronological.map((row, index) => {
    const textParts = [
      row.noteText ? `Anteckning: ${row.noteText}` : '',
      row.transcriptText ? `Transkribering: ${row.transcriptText}` : '',
      row.riskNote ? `Risknotering: ${row.riskNote}` : '',
      row.suggestedFollowUp ? `Föreslagen kontroll: ${row.suggestedFollowUp}` : '',
      ...row.measurements.map((measurement) => {
        const parts = [
          cleanText(measurement.measurementType),
          cleanText(measurement.valueText),
          cleanText(measurement.unit),
          cleanText(measurement.location),
          cleanText(measurement.method),
          cleanText(measurement.assessmentLabel),
        ].filter(Boolean)
        return parts.length > 0 ? `Mätvärde: ${parts.join(' · ')}` : ''
      }),
    ].filter(Boolean)
    return [row.id, {
      id: row.id,
      sequence: index + 1,
      observedAt: row.observedAt,
      sourceType: row.sourceType,
      location: row.location,
      buildingComponent: row.buildingComponent,
      text: textParts.join('\n').slice(0, 3000),
    } satisfies TuAnalysisSourceObservation]
  }))
}

function responseText(payload: OpenAiResponse) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }
  return payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === 'output_text' && typeof item.text === 'string')
    ?.text?.trim() ?? ''
}

function structuredOpenAiRequestBody(input: {
  instructions: string
  content: unknown
  schemaName: string
  schema: JsonRecord
  maxOutputTokens: number
  reasoningEffort?: 'medium' | 'high'
}) {
  return {
      model: TU_ANALYSIS_MODEL,
      background: true,
      store: false,
      reasoning: { effort: input.reasoningEffort ?? 'high' },
      instructions: input.instructions,
      input: input.content,
      text: {
        format: {
          type: 'json_schema',
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
      max_output_tokens: input.maxOutputTokens,
  }
}

function parseStructuredResponse(payload: OpenAiResponse) {
  const text = responseText(payload)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  try {
    return JSON.parse(text) as JsonRecord
  } catch {
    throw new Error('OPENAI_INCOMPLETE_RESPONSE')
  }
}

async function startStructuredOpenAiRequest(input: { apiKey: string; body: JsonRecord }) {
  let response: Response
  try {
    response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(PROVIDER_CREATE_TIMEOUT_MS),
      body: JSON.stringify(input.body),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('OPENAI_REQUEST_TIMEOUT')
    }
    throw new Error('OPENAI_REQUEST_FAILED')
  }
  if (!response.ok) {
    const detail = await response.text()
    console.error('[tu.analysis] OpenAI background start failed', {
      status: response.status,
      detail: detail.slice(0, 800),
    })
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}`)
  }
  const payload = await response.json() as OpenAiResponse
  const envelope = normalizeTuReportProviderResponse(payload)
  if (envelope.status === 'failed' || envelope.status === 'incomplete' || envelope.status === 'cancelled') {
    throw new Error(tuReportProviderFailureMessage(payload))
  }
  return envelope
}

async function retrieveStructuredOpenAiResponse(input: { apiKey: string; responseId: string }) {
  let response: Response
  try {
    response = await fetch(`${OPENAI_RESPONSES_URL}/${encodeURIComponent(input.responseId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${input.apiKey}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(PROVIDER_RETRIEVE_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new Error('OPENAI_RETRIEVE_TIMEOUT')
    }
    throw new Error('OPENAI_RETRIEVE_FAILED')
  }
  if (!response.ok) {
    console.error('[tu.analysis] OpenAI status retrieval failed', { status: response.status })
    throw new Error(response.status === 404 ? 'OPENAI_RESPONSE_NOT_FOUND' : 'OPENAI_RETRIEVE_FAILED')
  }
  const payload = await response.json() as OpenAiResponse
  const envelope = normalizeTuReportProviderResponse(payload)
  if (envelope.responseId !== input.responseId) throw new Error('OPENAI_INVALID_RESPONSE')
  return { payload, envelope }
}

export async function getTuAnalysisValidation(input: {
  orgId: string
  inspectionId: string
}): Promise<TuAnalysisValidation> {
  const [observations, images] = await Promise.all([
    listTuObservations(input),
    listTuInvestigationImages(input),
  ])
  const sourceImages = images.filter(isTuAnalysisSourceImage)
  const linkedImageIds = new Set(observations.flatMap((observation) => observation.imageIds))
  const measurementCount = observations.reduce(
    (sum, observation) => sum + observation.measurements.length,
    0
  )
  const unreviewedObservationCount = observations.filter(
    (observation) => observation.reviewStatus !== 'reviewed'
  ).length
  const emptyObservationCount = observations.filter((observation) => (
    !observation.noteText.trim()
    && !observation.transcriptText?.trim()
    && observation.imageIds.length === 0
    && observation.measurements.length === 0
  )).length
  const unlinkedImageCount = sourceImages.filter((image) => !linkedImageIds.has(image.id)).length
  const warnings: string[] = []
  if (unreviewedObservationCount > 0) {
    warnings.push(`${unreviewedObservationCount} fältposter är inte kontrollerade.`)
  }
  if (emptyObservationCount > 0) {
    warnings.push(`${emptyObservationCount} observationer saknar text, bild och mätvärde.`)
  }
  if (unlinkedImageCount > 0) {
    warnings.push(`${unlinkedImageCount} bilder är inte kopplade till någon observation. De analyseras ändå som bildbank.`)
  }
  if (observations.length === 0 && sourceImages.length > 0) {
    warnings.push('Det finns bilder men inga fältobservationer. Analysen får begränsad kontext.')
  }
  return {
    observationCount: observations.length,
    unreviewedObservationCount,
    imageCount: sourceImages.length,
    measurementCount,
    unlinkedImageCount,
    emptyObservationCount,
    warnings,
    canComplete:
      (observations.length > 0 || sourceImages.length > 0)
      && unreviewedObservationCount === 0
      && emptyObservationCount === 0,
  }
}

export async function getTuAnalysisWorkflow(input: {
  orgId: string
  inspectionId: string
}): Promise<TuAnalysisWorkflow> {
  const admin = createSupabaseAdminClient()
  const { data: workflowData, error: workflowError } = await admin
    .from('tu_analysis_workflows')
    .select(WORKFLOW_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()
  if (workflowError) throw new Error(workflowError.message)
  if (!workflowData) {
    return {
      status: 'in_progress',
      fieldworkCompletedAt: null,
      analysisApprovedAt: null,
      analysisStaleAt: null,
      run: null,
      items: [],
    }
  }

  const workflow = workflowData as unknown as WorkflowRow
  let run: TuAnalysisRun | null = null
  let items: TuAnalysisItem[] = []
  let sourceObservationById = new Map<string, TuAnalysisSourceObservation>()
  if (workflow.current_analysis_run_id) {
    const [{ data: runData, error: runError }, { data: itemData, error: itemError }] =
      await Promise.all([
        admin
          .from('tu_ai_runs')
          .select(RUN_COLUMNS)
          .eq('id', workflow.current_analysis_run_id)
          .eq('org_id', input.orgId)
          .eq('inspection_id', input.inspectionId)
          .maybeSingle(),
        admin
          .from('tu_ai_analysis_items')
          .select(ITEM_COLUMNS)
          .eq('run_id', workflow.current_analysis_run_id)
          .eq('org_id', input.orgId)
          .eq('inspection_id', input.inspectionId)
          .order('sort_order', { ascending: true }),
      ])
    if (runError) throw new Error(runError.message)
    if (itemError) throw new Error(itemError.message)
    if (runData) {
      const runRow = runData as unknown as RunRow
      run = mapRun(runRow)
      sourceObservationById = mapSnapshotSourceObservations(runRow.input_snapshot)
      const lastHeartbeatAt = run.heartbeatAt ?? run.startedAt ?? run.createdAt
      const staleBefore = Date.now() - STALE_RUN_MINUTES * 60 * 1000
      if (
        (run.status === 'queued' || run.status === 'processing')
        && new Date(lastHeartbeatAt).getTime() < staleBefore
      ) {
        const staleMessage = 'Analysjobbet avbröts eller överskred tillåten körtid. Försök igen.'
        const { error: staleError } = await admin
          .from('tu_ai_runs')
          .update({
            status: 'failed',
            error_message: staleMessage,
            progress_stage: 'failed',
            progress_message: staleMessage,
            heartbeat_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
          })
          .eq('id', run.id)
          .in('status', ['queued', 'processing'])
        if (staleError) throw new Error(staleError.message)
        run = {
          ...run,
          status: 'failed',
          errorMessage: staleMessage,
          progressStage: 'failed',
          progressMessage: staleMessage,
          heartbeatAt: new Date().toISOString(),
        }
      }
    }
    items = ((itemData ?? []) as unknown as ItemRow[])
      .map((row) => mapItem(row, sourceObservationById))
  }

  return {
    status: isTuAnalysisWorkflowStatus(workflow.status) ? workflow.status : 'in_progress',
    fieldworkCompletedAt: workflow.fieldwork_completed_at,
    analysisApprovedAt: workflow.analysis_approved_at,
    analysisStaleAt: workflow.analysis_stale_at,
    run,
    items,
  }
}

async function buildAnalysisSnapshot(input: { orgId: string; inspectionId: string }) {
  const [investigation, observations, images] = await Promise.all([
    getTuInvestigationById(input),
    listTuObservations(input),
    listTuInvestigationImages(input),
  ])
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
  if (!usesTuAiAssistedWorkflow(investigation.reportAuthoringMode, investigation.reportTemplateKey)) {
    throw new Error('TU_ANALYSIS_TEMPLATE_NOT_SUPPORTED')
  }
  const controlPlan = investigation.reportWorkflowProfile === 'post_damage_review'
    ? await getApprovedTuControlPlanSnapshot(input)
    : null
  if (investigation.reportWorkflowProfile === 'post_damage_review' && !controlPlan) {
    throw new Error('TU_CONTROL_PLAN_NOT_APPROVED')
  }
  const sourceImages = images.filter(isTuAnalysisSourceImage)
  const sourceImageIds = new Set(sourceImages.map((image) => image.id))
  const imageById = new Map(sourceImages.map((image) => [image.id, image]))
  const chronologicalObservations = sortTuEvidenceChronologically(observations)
  return {
    investigation,
    images: sourceImages,
    snapshot: {
      ruleset: RULESET_KEY,
      reportTemplate: {
        key: investigation.reportTemplateKey,
        title: investigation.reportTemplateTitle,
        version: investigation.reportTemplateVersion,
        authoringMode: investigation.reportAuthoringMode,
        workflowProfile: investigation.reportWorkflowProfile,
      },
      assignment: {
        title: investigation.title,
        assignmentNumber: investigation.assignmentNumber,
        scopeDescription: investigation.scopeDescription,
        inspectionDate: investigation.date,
        inspectionTime: investigation.inspectionTime,
        background: investigation.background,
        basis: investigation.basis,
        accessibility: investigation.accessibility,
      },
      object: {
        objectType: investigation.objectType,
        address: investigation.propertyAddress,
        city: investigation.propertyCity,
        cadastralId: investigation.cadastralId,
        brfName: investigation.brfName,
        apartmentNumber: investigation.apartmentNumber,
      },
      reportSections: investigation.reportDraft.sections.map((section) => ({
        id: section.id,
        key: section.key,
        title: section.title,
        aiInstruction: section.aiInstruction ?? null,
      })),
      chronologyInstruction:
        'Observationerna är sorterade äldst till nyast. En senare uppgift kan komplettera eller ersätta en preliminär uppfattning, men är inte automatiskt mer tillförlitlig.',
      sourcePolicy: isTuPostDamageReport(investigation.reportTemplateKey)
        ? TU_POST_DAMAGE_SOURCE_POLICY
        : null,
      controlPlan,
      observations: chronologicalObservations.map((observation, index) => ({
        id: observation.id,
        sequence: index + 1,
        sourceType: observation.sourceType,
        location: observation.location,
        buildingComponent: observation.buildingComponent,
        noteText: observation.noteText.slice(0, 8000),
        transcriptText: observation.transcriptText?.slice(0, 12000) ?? null,
        riskNote: observation.riskNote,
        suggestedFollowUp: observation.suggestedFollowUp,
        reviewStatus: observation.reviewStatus,
        imageIds: observation.imageIds.filter((id) => sourceImageIds.has(id)),
        imageCaptions: observation.imageIds.filter((id) => sourceImageIds.has(id)).map((id) => ({
          imageId: id,
          caption: imageById.get(id)?.caption ?? null,
        })),
        measurements: observation.measurements.map((measurement) => ({
          id: measurement.id,
          location: measurement.location,
          type: measurement.measurementType,
          value: measurement.valueText,
          unit: measurement.unit,
          method: measurement.method,
          instrument: measurement.instrument,
          assessment: measurement.assessment,
          assessmentLabel: formatTuMeasurementAssessment(measurement),
          note: measurement.note,
          measuredAt: measurement.measuredAt,
        })),
        observedAt: observation.observedAt,
      })),
      images: sourceImages.map((image) => ({
        id: image.id,
        sectionKey: image.sectionKey,
        caption: image.caption,
        sortOrder: image.sortOrder,
        createdAt: image.createdAt,
      })),
    },
  }
}

export async function createTuInspectionAnalysisRun(input: {
  orgId: string
  inspectionId: string
  userId: string
}) {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const { data: activeRun, error: activeError } = await admin
    .from('tu_ai_runs')
    .select('id,status,heartbeat_at,started_at,created_at')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'inspection_analysis')
    .in('status', ['queued', 'processing'])
    .maybeSingle()
  if (activeError) throw new Error(activeError.message)
  const active = activeRun as {
    id: string
    status: string
    heartbeat_at: string | null
    started_at: string | null
    created_at: string | null
  } | null
  let runId = active ? String(active.id) : ''
  if (active) {
    const lastActivity = active.heartbeat_at ?? active.started_at ?? active.created_at
    const staleBefore = Date.now() - STALE_RUN_MINUTES * 60 * 1000
    if (lastActivity && new Date(lastActivity).getTime() < staleBefore) {
      const staleMessage = 'En tidigare analysstart avbröts innan arbetsflödet skapades. En ny körning startas.'
      const { error: staleError } = await admin
        .from('tu_ai_runs')
        .update({
          status: 'failed',
          error_message: staleMessage,
          progress_stage: 'failed',
          progress_message: staleMessage,
          heartbeat_at: now,
          completed_at: now,
        })
        .eq('id', active.id)
        .in('status', ['queued', 'processing'])
      if (staleError) throw new Error(staleError.message)
      runId = ''
    }
  }

  if (!runId) {
    const { snapshot } = await buildAnalysisSnapshot(input)
    const inputHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
    const imageCount = Array.isArray(snapshot.images)
      ? Math.min(snapshot.images.length, configuredMaxImages())
      : 0
    const { data: runData, error: runError } = await admin
      .from('tu_ai_runs')
      .insert({
        org_id: input.orgId,
        inspection_id: input.inspectionId,
        operation: 'inspection_analysis',
        status: 'queued',
        model: TU_ANALYSIS_MODEL,
        ruleset_key: RULESET_KEY,
        ruleset_version: RULESET_VERSION,
        input_snapshot: snapshot,
        input_hash: inputHash,
        attempt_count: 0,
        progress_stage: 'queued',
        progress_current: 0,
        progress_total: imageCount,
        progress_message: 'Analysen väntar på att starta.',
        heartbeat_at: now,
        created_by: input.userId,
      })
      .select('id')
      .single()
    if (runError || !runData) throw new Error(runError?.message ?? 'TU_ANALYSIS_RUN_CREATE_FAILED')
    runId = String((runData as { id: string }).id)
  }

  const { data: existingWorkflow, error: workflowReadError } = await admin
    .from('tu_analysis_workflows')
    .select('fieldwork_completed_at,fieldwork_completed_by')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()
  if (workflowReadError) throw new Error(workflowReadError.message)
  const existing = existingWorkflow as {
    fieldwork_completed_at?: string | null
    fieldwork_completed_by?: string | null
  } | null
  const { error: workflowError } = await admin
    .from('tu_analysis_workflows')
    .upsert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      status: 'analysis_processing',
      fieldwork_completed_at: existing?.fieldwork_completed_at ?? now,
      fieldwork_completed_by: existing?.fieldwork_completed_by ?? input.userId,
      current_analysis_run_id: runId,
      analysis_approved_at: null,
      analysis_approved_by: null,
      analysis_stale_at: null,
    }, { onConflict: 'inspection_id' })
  if (workflowError) throw new Error(workflowError.message)
  return runId
}

function configuredMaxImages() {
  const parsed = Number.parseInt(process.env.OPENAI_TU_ANALYSIS_MAX_IMAGES ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_IMAGES
}

async function imageDataUrl(image: TuInvestigationImage, highDetail: boolean) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.storage.from(image.storageBucket).download(image.filePath)
  if (error || !data) throw new Error(error?.message ?? 'TU_IMAGE_DOWNLOAD_FAILED')
  const source = Buffer.from(await data.arrayBuffer())
  const optimized = await sharp(source)
    .rotate()
    .resize({
      width: highDetail ? 2000 : 1280,
      height: highDetail ? 2000 : 1280,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({ quality: highDetail ? 88 : 78, mozjpeg: true })
    .toBuffer()
  return `data:image/jpeg;base64,${optimized.toString('base64')}`
}

async function prepareImageBatch(images: TuInvestigationImage[], highDetailImageIds: Set<string>) {
  const loaded = await Promise.all(images.map(async (image) => {
    try {
      return { image, dataUrl: await imageDataUrl(image, highDetailImageIds.has(image.id)), error: null }
    } catch (error) {
      return {
        image,
        dataUrl: null,
        error: error instanceof Error ? error.message : 'Bilden kunde inte läsas.',
      }
    }
  }))
  const available = loaded.filter(
    (item): item is { image: TuInvestigationImage; dataUrl: string; error: null } => Boolean(item.dataUrl)
  )
  const failed: ImageAnalysis[] = loaded
    .filter((item) => !item.dataUrl)
    .map((item) => ({
      imageId: item.image.id,
      visibleFacts: [],
      displayReadings: [],
      quality: 'unusable',
      relevance: 'low',
      possibleDuplicateImageIds: [],
      warnings: ['Bilden kunde inte läsas och analyserades därför inte.'],
    }))
  if (available.length === 0) {
    return { body: null, availableImageIds: [] as string[], failed }
  }

  const content: Array<JsonRecord> = [{
    type: 'input_text',
    text: [
      'Analysera endast vad som faktiskt är synligt i bilderna.',
      'Identifiera inte personer och dra inga slutsatser om orsak, ansvar eller dolda förhållanden.',
      'Skriv neutrala svenska bildiakttagelser. Markera osäker bildkvalitet uttryckligen.',
      'Håll resultatet kort: högst fyra korta synliga fakta och högst två korta varningar per bild.',
      'Om en instrumentskärm är tydligt läsbar: återge varje avläst displayvärde exakt, inklusive synlig enhet, i displayReadings. Gissa aldrig ett värde och lämna listan tom när displayen inte kan läsas säkert.',
      `Bilder i denna batch: ${available.map((item) => `${item.image.id} (${item.image.caption ?? 'utan bildtext'})`).join(', ')}`,
    ].join('\n'),
  }]
  for (const item of available) {
    content.push({ type: 'input_text', text: `imageId: ${item.image.id}` })
    content.push({
      type: 'input_image',
      image_url: item.dataUrl,
      detail: highDetailImageIds.has(item.image.id) ? 'high' : 'low',
    })
  }
  const body = structuredOpenAiRequestBody({
    instructions: 'Du är ett visuellt dokumentationsstöd för en svensk teknisk utredning. Du beskriver synliga fakta, inte diagnoser.',
    content: [{ role: 'user', content }],
    schemaName: 'tu_inspection_image_analysis',
    schema: {
      type: 'object',
      properties: {
        images: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              imageId: { type: 'string' },
              visibleFacts: { type: 'array', items: { type: 'string' } },
              displayReadings: { type: 'array', items: { type: 'string' } },
              quality: { type: 'string', enum: ['good', 'limited', 'unusable'] },
              relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
              possibleDuplicateImageIds: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'imageId',
              'visibleFacts',
              'displayReadings',
              'quality',
              'relevance',
              'possibleDuplicateImageIds',
              'warnings',
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['images'],
      additionalProperties: false,
    },
    maxOutputTokens: tuImageBatchMaxOutputTokens(available.length),
    reasoningEffort: 'medium',
  })
  return {
    body,
    availableImageIds: available.map((item) => item.image.id),
    failed,
  }
}

function parseImageBatch(parsed: JsonRecord, availableImageIds: string[]) {
  const allowedIds = new Set(availableImageIds)
  const results = Array.isArray(parsed.images) ? parsed.images : []
  const mapped: ImageAnalysis[] = results
    .map(record)
    .filter((item) => allowedIds.has(cleanText(item.imageId)))
    .map((item) => ({
      imageId: cleanText(item.imageId),
      visibleFacts: stringArray(item.visibleFacts).slice(0, 12),
      displayReadings: stringArray(item.displayReadings).slice(0, 8),
      quality: item.quality === 'good' || item.quality === 'limited' ? item.quality : 'unusable',
      relevance: item.relevance === 'high' || item.relevance === 'medium' ? item.relevance : 'low',
      possibleDuplicateImageIds: stringArray(item.possibleDuplicateImageIds)
        .filter((id) => allowedIds.has(id)),
      warnings: stringArray(item.warnings),
    }))
  const returnedIds = new Set(mapped.map((item) => item.imageId))
  for (const imageId of availableImageIds) {
    if (!returnedIds.has(imageId)) {
      mapped.push({
        imageId,
        visibleFacts: [],
        displayReadings: [],
        quality: 'unusable',
        relevance: 'low',
        possibleDuplicateImageIds: [],
        warnings: ['AI-analysen returnerade inget resultat för bilden.'],
      })
    }
  }
  return mapped
}

function parseAnalysisDraft(value: JsonRecord): AnalysisDraft {
  return {
    overview: cleanText(value.overview),
    timelineSummary: cleanText(value.timelineSummary),
    warnings: stringArray(value.warnings),
    items: (Array.isArray(value.items) ? value.items : []).map(record).map((item) => ({
      itemType: cleanText(item.itemType),
      title: cleanText(item.title),
      summary: cleanText(item.summary),
      certainty: cleanText(item.certainty),
      targetSectionId: cleanText(item.targetSectionId) || null,
      includeInReport: item.includeInReport !== false,
      sourceObservationIds: stringArray(item.sourceObservationIds),
      sourceImageIds: stringArray(item.sourceImageIds),
      sourceMeasurementIds: stringArray(item.sourceMeasurementIds),
      earlierSourceObservationIds: stringArray(item.earlierSourceObservationIds),
      laterSourceObservationIds: stringArray(item.laterSourceObservationIds),
      supportingReasons: stringArray(item.supportingReasons),
      contradictingReasons: stringArray(item.contradictingReasons),
      warnings: stringArray(item.warnings),
    })).filter((item) => item.title && item.summary),
  }
}

function synthesisRequestBody(input: {
  snapshot: JsonRecord
  imageAnalyses: ImageAnalysis[]
}) {
  return structuredOpenAiRequestBody({
    instructions: [
      'Du analyserar ett samlat besiktningsunderlag för en svensk teknisk utredning. Rapportmallens titel, projekttyp och sektionsinstruktioner anger utredningens fackliga inriktning.',
      'AI-resultatet är ett granskningsunderlag, aldrig ett färdigt utlåtande.',
      'Använd endast fakta och käll-id i underlaget. Hitta inte på mätvärden, datum, händelser, orsaker eller ansvar.',
      'Identifiera först uppdragets huvudsakliga tekniska fråga. Bedöm därefter all information i relation till den frågan, inte som fristående poster.',
      'Sätt includeInReport true endast när resultatet behövs för att beskriva uppdraget, en avgörande iakttagelse, den samlade bedömningen eller en proportionerlig rekommendation.',
      'En korrekt bakgrundsuppgift kan vara irrelevant för huvudfrågan. Behåll den då för intern spårbarhet men sätt includeInReport false.',
      'Saknade mätuppgifter och andra informationsluckor är i första hand interna granskningsvarningar. De ska bara ingå i rapportunderlaget när begränsningen faktiskt påverkar möjligheten att besvara huvudfrågan.',
      'Observationerna är ordnade äldst till nyast. Rekonstruera först hur uppfattningen utvecklas över tid.',
      'En senare uppgift är inte automatiskt sannare. Väg källa, kontrollmetod, mätresultat, åtkomlighet och om den senare uppgiften uttryckligen korrigerar eller ersätter en tidigare preliminär uppfattning.',
      'Skapa evidence_conflict när två uppgifter om samma plats och förhållande inte kan användas samtidigt utan förklaring. Ange tidigare källor i earlierSourceObservationIds och senare källor i laterSourceObservationIds.',
      'Skapa current_assessment för den nu gällande samlade bedömningen. Den ska beskriva både slutsats och kontrollens begränsning och länka till samtliga avgörande källor.',
      'Använd neutral terminologi tills ett förhållande är verifierat. Vid fuktfrågor ska fläck eller missfärgning användas i stället för fuktfläck när fukt inte har konstaterats.',
      'Vid fuktkontroller får du inte skriva att en konstruktion saknar fukt när underlaget endast visar att inga fuktindikationer noterats i en begränsad kontrollerad del.',
      'Vid fuktmätning ska du skilja mellan indikativ mätning och kvantitativ mätning. Ett indikativt utslag är inte en uppmätt fukthalt.',
      'Ett granskat indikationsvärde får återges exakt som "indikationsvärde X" med instrument, metod och mätpunkt när dessa finns. Avsaknad av jämförelsegrund hindrar inte redovisning av avläsningen, men hindrar klassificering och slutsats om fukthalt.',
      'Klassificera aldrig ett mätresultat utifrån siffervärdet på egen hand. measurement.assessment är besiktningsmannens uttryckliga bedömning och får användas när den finns; saknas den ska resultatet inte klassificeras.',
      'Vid fuktindikering betyder no_deviation endast att ingen avvikande indikation noterades i den dokumenterade mätpunkten. deviation betyder avvikande/förhöjd indikation i mätpunkten. Inget av alternativen är i sig en uppmätt fukthalt eller bevis för skada.',
      'Om assessment är not_assessable ska endast den verifierade avläsningen och relevanta begränsningar återges utan klassificering.',
      'Avgränsa varje mätresultat till den dokumenterade mätpunkten och tidpunkten. Generalisera inte till hela konstruktionen.',
      'Rubriken, rapportmallen och uppdragstypen är kontext, inte teknisk bevisning.',
      'En kontrollerad fältpost betyder att källmaterialet är korrekt återgivet, inte att varje teknisk slutsats i fritexten är bekräftad.',
      'Håll beställaruppgifter åtskilda från besiktningsmannens verifierade iakttagelser.',
      'En teknisk hypotes ska ha certainty probable eller uncertain och redovisa både stöd och motsägelser.',
      'En bildanalys visar endast synliga bildfakta och får inte ensam bevisa dolda förhållanden eller skadeorsak.',
      'Besiktningsmannens egna bilder dokumenterar observationerna och ska inte behandlas som ett fristående externt bildmaterial.',
      'Skapa efter helhetsanalysen ett begränsat urval av report_image-poster för bilder som tydligt stödjer utlåtandets centrala observationer. Välj inte bilder enbart för att fylla bilagan.',
      'Varje report_image ska innehålla exakt ett sourceImageId, ha includeInReport true och använda bildanalysens kvalitet, relevans och möjliga dubbletter. Uteslut oanvändbara, lågrelevanta och överflödigt likartade bilder.',
      'För report_image ska title ange en kort plats- eller observationsgrupp och summary vara en saklig kundanpassad bildtext. Beskriv endast synliga förhållanden samt plats eller byggnadsdel som stöds av källorna.',
      'Sortera report_image-poster i en begriplig bilageordning grupperad efter plats och observation, inte efter den ordning bilderna togs.',
      'Följ sourcePolicy när den finns. Aktuellt skick och aktuell teknisk bedömning ska då grundas på observationer, egna bilder och kvalificerade mätningar från den aktuella kontrollen.',
      'Om underlaget innehåller en godkänd controlPlan är den endast en intern kontrollinriktning. Skilj dess tidigare uppgifter, rekommendationer, åtgärdspåståenden och uppmärksamhetsområden från besiktningsmannens egna resultat.',
      'Skapa inte ett analysresultat per uppmärksamhetsområde och återge inte kontrollinriktningen som en checklista. Gruppera i stället dagens observationer efter faktiskt område eller förhållande.',
      'Tidigare rapporter och skadebeskrivningar får förklara varför ett område kontrollerades men får inte ensamma stödja ett påstående om dagens skick, utförd åtgärd eller kvarstående avvikelse.',
      'Äldre ärenden kan innehålla verificationStatus i controlPlan. not_checked är inte bevisning. not_verifiable och reported_not_verifiable får aldrig skrivas om till en verifierad åtgärd.',
      'Använd kontrollinriktningens sakfrågor endast för att förstå sammanhanget. Dra inte en slutsats enbart för att en tidigare rapport eller åtgärdsredovisning påstår något.',
      'Beskriv inte ett utförande som felaktigt, otillåtet eller inte fackmässigt utan dokumenterad iakttagelse och angiven bedömningsgrund.',
      'Informationsluckor beskriver saknad information. Rekommenderade fortsatta kontroller beskriver nästa handling. Blanda inte ihop dessa kategorier.',
      'Varje analysresultat måste ha minst ett giltigt sourceObservationId, sourceImageId eller sourceMeasurementId. Saknas källa ska resultatet inte skapas.',
      'Evidence_conflict används för granskning och ska ha includeInReport false. Den godkända current_assessment används som rapportunderlag.',
      'Välj targetSectionId endast bland rapportsektionerna i underlaget. Använd null om ingen sektion passar.',
      'Skriv koncist, sakligt och granskningsbart på svenska utan juridiska slutsatser.',
    ].join('\n'),
    content: JSON.stringify({
      inspection: input.snapshot,
      imageAnalyses: input.imageAnalyses,
    }),
    schemaName: 'tu_inspection_analysis',
    schema: {
      type: 'object',
      properties: {
        overview: { type: 'string' },
        timelineSummary: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemType: {
                type: 'string',
                enum: [
                  'current_assessment',
                  'evidence_conflict',
                  'verified_observation',
                  'party_statement',
                  'measurement',
                  'image_observation',
                  'technical_hypothesis',
                  'information_gap',
                  'recommended_follow_up',
                  'report_image',
                ],
              },
              title: { type: 'string' },
              summary: { type: 'string' },
              certainty: { type: 'string', enum: ['confirmed', 'probable', 'uncertain'] },
              targetSectionId: { type: ['string', 'null'] },
              includeInReport: { type: 'boolean' },
              sourceObservationIds: { type: 'array', items: { type: 'string' } },
              sourceImageIds: { type: 'array', items: { type: 'string' } },
              sourceMeasurementIds: { type: 'array', items: { type: 'string' } },
              earlierSourceObservationIds: { type: 'array', items: { type: 'string' } },
              laterSourceObservationIds: { type: 'array', items: { type: 'string' } },
              supportingReasons: { type: 'array', items: { type: 'string' } },
              contradictingReasons: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'itemType',
              'title',
              'summary',
              'certainty',
              'targetSectionId',
              'includeInReport',
              'sourceObservationIds',
              'sourceImageIds',
              'sourceMeasurementIds',
              'earlierSourceObservationIds',
              'laterSourceObservationIds',
              'supportingReasons',
              'contradictingReasons',
              'warnings',
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['overview', 'timelineSummary', 'warnings', 'items'],
      additionalProperties: false,
    },
    maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
  })
}

async function failInspectionAnalysis(input: { runId: string; error: unknown; source: string }) {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const message = tuAnalysisFailureMessage(input.error)
  await admin.from('tu_ai_runs').update({
    status: 'failed',
    error_message: message,
    progress_stage: 'failed',
    progress_message: message,
    heartbeat_at: now,
    completed_at: now,
  }).eq('id', input.runId).in('status', ['queued', 'processing'])
  console.error(`[tu.analysis] ${input.source}`, { runId: input.runId, error: input.error })
}

function storedImageAnalyses(value: unknown): ImageAnalysis[] {
  return (Array.isArray(value) ? value : []).map(record).map((item): ImageAnalysis => ({
    imageId: cleanText(item.imageId),
    visibleFacts: stringArray(item.visibleFacts),
    displayReadings: stringArray(item.displayReadings),
    quality: item.quality === 'good' || item.quality === 'limited' ? item.quality : 'unusable',
    relevance: item.relevance === 'high' || item.relevance === 'medium' ? item.relevance : 'low',
    possibleDuplicateImageIds: stringArray(item.possibleDuplicateImageIds),
    warnings: stringArray(item.warnings),
  })).filter((item) => item.imageId)
}

async function finalizeTuInspectionAnalysis(input: {
  orgId: string
  inspectionId: string
  runId: string
  snapshot: JsonRecord
  images: TuInvestigationImage[]
  selectedImages: TuInvestigationImage[]
  imageAnalyses: ImageAnalysis[]
  analysis: AnalysisDraft
}) {
  const admin = createSupabaseAdminClient()
  const { snapshot, images, selectedImages, imageAnalyses, analysis } = input
  try {
    if (images.length > selectedImages.length) {
      analysis.warnings.push(
        `${images.length - selectedImages.length} bilder analyserades inte eftersom bildgränsen är ${configuredMaxImages()}.`
      )
    }

    const snapshotObservations = Array.isArray(snapshot.observations) ? snapshot.observations.map(record) : []
    const snapshotSections = Array.isArray(snapshot.reportSections) ? snapshot.reportSections.map(record) : []
    const validObservationIds = new Set(snapshotObservations.map((item) => cleanText(item.id)).filter(Boolean))
    const validMeasurementIds = new Set(
      snapshotObservations.flatMap((item) => (
        Array.isArray(item.measurements) ? item.measurements.map(record).map((row) => cleanText(row.id)) : []
      )).filter(Boolean)
    )
    const validImageIds = new Set(images.map((image) => image.id))
    const validSectionIds = new Set(snapshotSections.map((item) => cleanText(item.id)).filter(Boolean))
    const itemPriority = (itemType: string) => (
      itemType === 'current_assessment' ? 0
        : itemType === 'evidence_conflict' ? 1
          : 2
    )
    const itemRows = analysis.items
      .filter((item) => isTuAnalysisItemType(item.itemType))
      .map((item, originalIndex) => ({ item, originalIndex }))
      .sort((left, right) => (
        itemPriority(left.item.itemType) - itemPriority(right.item.itemType)
        || left.originalIndex - right.originalIndex
      ))
      .map(({ item }, index) => {
        const earlierSourceObservationIds = item.earlierSourceObservationIds
          .filter((id) => validObservationIds.has(id))
        const laterSourceObservationIds = item.laterSourceObservationIds
          .filter((id) => validObservationIds.has(id))
        const sourceObservationIds = [...new Set([
          ...item.sourceObservationIds.filter((id) => validObservationIds.has(id)),
          ...earlierSourceObservationIds,
          ...laterSourceObservationIds,
        ])]
        const sourceImageIds = item.sourceImageIds.filter((id) => validImageIds.has(id))
        const sourceMeasurementIds = item.sourceMeasurementIds
          .filter((id) => validMeasurementIds.has(id))
        const hasSource = sourceObservationIds.length > 0
          || sourceImageIds.length > 0
          || sourceMeasurementIds.length > 0
        const conflictIsIncomplete = item.itemType === 'evidence_conflict'
          && (earlierSourceObservationIds.length === 0 || laterSourceObservationIds.length === 0)
        const warnings = [...item.warnings]
        if (!hasSource) warnings.push('Analysresultatet saknar verifierbar källkoppling och kan inte användas i utlåtandet.')
        if (conflictIsIncomplete) warnings.push('Konflikten saknar tydlig koppling till både tidigare och senare fältuppgift.')
        return {
          org_id: input.orgId,
          inspection_id: input.inspectionId,
          run_id: input.runId,
          item_type: item.itemType,
          title: item.title,
          summary: item.summary,
          certainty: isTuAnalysisCertainty(item.certainty) ? item.certainty : 'uncertain',
          review_status: 'pending',
          target_section_id:
            item.itemType !== 'evidence_conflict'
            && item.targetSectionId
            && validSectionIds.has(item.targetSectionId)
              ? item.targetSectionId
              : null,
          include_in_report: item.itemType === 'current_assessment'
            ? hasSource
            : item.itemType !== 'evidence_conflict' && hasSource && item.includeInReport,
          source_observation_ids: sourceObservationIds,
          source_image_ids: sourceImageIds,
          source_measurement_ids: sourceMeasurementIds,
          earlier_source_observation_ids: earlierSourceObservationIds,
          later_source_observation_ids: laterSourceObservationIds,
          supporting_reasons: item.supportingReasons,
          contradicting_reasons: item.contradictingReasons,
          warnings,
          sort_order: (index + 1) * 10,
        }
      })

    const currentAssessmentRows = itemRows.filter((item) => item.item_type === 'current_assessment')
    if (currentAssessmentRows.length === 0) {
      throw new Error('OPENAI_ANALYSIS_MISSING_CURRENT_ASSESSMENT')
    }
    if (currentAssessmentRows.every((item) => (
      item.source_observation_ids.length === 0
      && item.source_image_ids.length === 0
      && item.source_measurement_ids.length === 0
    ))) {
      throw new Error('OPENAI_ANALYSIS_UNGROUNDED_CURRENT_ASSESSMENT')
    }

    const savingAt = new Date().toISOString()
    const { error: progressError } = await admin.from('tu_ai_runs').update({
      progress_stage: 'saving',
      progress_current: selectedImages.length,
      progress_total: selectedImages.length,
      progress_message: 'Sparar analysresultatet för granskning.',
      heartbeat_at: savingAt,
    }).eq('id', input.runId).eq('status', 'processing')
    if (progressError) throw new Error(progressError.message)

    const { error: deleteError } = await admin
      .from('tu_ai_analysis_items')
      .delete()
      .eq('run_id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
    if (deleteError) throw new Error(deleteError.message)
    if (itemRows.length > 0) {
      const { error: itemError } = await admin.from('tu_ai_analysis_items').insert(itemRows)
      if (itemError) throw new Error(itemError.message)
    }
    const completedAt = new Date().toISOString()
    const outputPayload = {
      overview: analysis.overview,
      timelineSummary: analysis.timelineSummary,
      warnings: analysis.warnings,
      imageAnalyses,
      measurementVerifications: deriveTuMeasurementImageVerifications(snapshot, imageAnalyses),
      imageAnalysisCount: imageAnalyses.length,
      itemCount: itemRows.length,
    }
    const { error: completeError } = await admin
      .from('tu_ai_runs')
      .update({
        status: 'completed',
        output_payload: outputPayload,
        completed_at: completedAt,
        error_message: null,
        progress_stage: 'completed',
        progress_current: selectedImages.length,
        progress_total: selectedImages.length,
        progress_message: 'Analysen är klar för granskning.',
        heartbeat_at: completedAt,
      })
      .eq('id', input.runId)
      .eq('status', 'processing')
    if (completeError) throw new Error(completeError.message)
    const { error: workflowError } = await admin
      .from('tu_analysis_workflows')
      .update({ status: 'analysis_ready' })
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .eq('current_analysis_run_id', input.runId)
      .eq('status', 'analysis_processing')
    if (workflowError) throw new Error(workflowError.message)
  } catch (error) {
    await failInspectionAnalysis({ runId: input.runId, error, source: 'Analysis finalization failed' })
  }
}

async function persistAnalysisBackgroundState(input: {
  runId: string
  state: Omit<TuAnalysisBackgroundState, 'version'>
  progressStage: 'queued' | 'analyzing_images' | 'synthesizing'
  progressCurrent: number
  progressTotal: number
  progressMessage: string
  status: 'queued' | 'processing'
}) {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const { error } = await admin.from('tu_ai_runs').update({
    status: input.status,
    output_payload: tuAnalysisBackgroundPayload(input.state),
    progress_stage: input.progressStage,
    progress_current: input.progressCurrent,
    progress_total: input.progressTotal,
    progress_message: input.progressMessage,
    heartbeat_at: now,
  }).eq('id', input.runId).eq('status', 'processing')
  if (error) throw new Error(error.message)
}

export async function runTuInspectionAnalysis(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    await failInspectionAnalysis({
      runId: input.runId,
      error: new Error('OPENAI_API_KEY_MISSING'),
      source: 'AI configuration missing',
    })
    return
  }

  const startedAt = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin.from('tu_ai_runs').update({
    status: 'processing',
    started_at: startedAt,
    completed_at: null,
    error_message: null,
    progress_stage: 'preparing',
    progress_message: 'Förbereder nästa steg i analysen.',
    heartbeat_at: startedAt,
  })
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'inspection_analysis')
    .eq('status', 'queued')
    .select('id,input_snapshot,output_payload,attempt_count')
    .maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return
  const run = claimed as {
    input_snapshot: unknown
    output_payload: unknown
    attempt_count: number | null
  }

  try {
    await admin.from('tu_ai_runs').update({
      attempt_count: (run.attempt_count ?? 0) + 1,
    }).eq('id', input.runId)
    const snapshot = record(run.input_snapshot)
    const images = (await listTuInvestigationImages(input)).filter(isTuAnalysisSourceImage)
    const selectedImages = images.slice(0, configuredMaxImages())
    const workflow = parseTuAnalysisBackgroundState(run.output_payload)
    const imageAnalyses = storedImageAnalyses(workflow?.imageAnalyses)
    const measurementImageIds = getTuMeasurementImageIds(snapshot)

    if (workflow?.stage === 'synthesis_ready') {
      await finalizeTuInspectionAnalysis({
        ...input,
        snapshot,
        images,
        selectedImages,
        imageAnalyses,
        analysis: parseAnalysisDraft(record(workflow.analysisDraft)),
      })
      return
    }

    const nextImageIndex = workflow?.stage === 'image_batch_ready'
      ? workflow.nextImageIndex
      : 0
    if (nextImageIndex < selectedImages.length) {
      const batch = selectedImages.slice(nextImageIndex, nextImageIndex + IMAGE_BATCH_SIZE)
      const prepared = await prepareImageBatch(batch, measurementImageIds)
      const completedIndex = Math.min(nextImageIndex + batch.length, selectedImages.length)
      const accumulated = [...imageAnalyses, ...prepared.failed]
      if (!prepared.body) {
        await persistAnalysisBackgroundState({
          runId: input.runId,
          state: {
            stage: 'image_batch_ready',
            responseId: null,
            submittedAt: null,
            nextImageIndex: completedIndex,
            batchImageIds: [],
            imageAnalyses: accumulated,
            analysisDraft: null,
          },
          status: 'queued',
          progressStage: 'queued',
          progressCurrent: completedIndex,
          progressTotal: selectedImages.length,
          progressMessage: `Förbereder nästa bilder, ${completedIndex} av ${selectedImages.length} hanterade.`,
        })
        return
      }
      const envelope = await startStructuredOpenAiRequest({ apiKey, body: prepared.body })
      await persistAnalysisBackgroundState({
        runId: input.runId,
        state: {
          stage: 'image_batch_pending',
          responseId: envelope.responseId,
          submittedAt: new Date().toISOString(),
          nextImageIndex: completedIndex,
          batchImageIds: prepared.availableImageIds,
          imageAnalyses: accumulated,
          analysisDraft: null,
        },
        status: 'processing',
        progressStage: 'analyzing_images',
        progressCurrent: nextImageIndex,
        progressTotal: selectedImages.length,
        progressMessage: `Analyserar bilder ${nextImageIndex + 1}-${completedIndex} av ${selectedImages.length}.`,
      })
      return
    }

    const envelope = await startStructuredOpenAiRequest({
      apiKey,
      body: synthesisRequestBody({ snapshot, imageAnalyses }),
    })
    await persistAnalysisBackgroundState({
      runId: input.runId,
      state: {
        stage: 'synthesis_pending',
        responseId: envelope.responseId,
        submittedAt: new Date().toISOString(),
        nextImageIndex: selectedImages.length,
        batchImageIds: [],
        imageAnalyses,
        analysisDraft: null,
      },
      status: 'processing',
      progressStage: 'synthesizing',
      progressCurrent: selectedImages.length,
      progressTotal: selectedImages.length,
      progressMessage: 'Sammanställer observationer, mätvärden och bildiakttagelser.',
    })
  } catch (error) {
    await failInspectionAnalysis({ runId: input.runId, error, source: 'Background stage start failed' })
  }
}

export async function pollTuInspectionAnalysis(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('tu_ai_runs')
    .select('status,input_snapshot,output_payload,heartbeat_at,progress_total')
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'inspection_analysis')
    .eq('status', 'processing')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return

  const row = data as {
    input_snapshot: unknown
    output_payload: unknown
    heartbeat_at: string | null
    progress_total: number | null
  }
  const workflow = parseTuAnalysisBackgroundState(row.output_payload)
  if (
    !workflow
    || (workflow.stage !== 'image_batch_pending' && workflow.stage !== 'synthesis_pending')
    || !workflow.responseId
    || !workflow.submittedAt
  ) return

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    await failInspectionAnalysis({
      runId: input.runId,
      error: new Error('OPENAI_API_KEY_MISSING'),
      source: 'AI configuration missing while polling',
    })
    return
  }
  if (Date.now() - Date.parse(workflow.submittedAt) > PROVIDER_MAX_JOB_AGE_MS) {
    await failInspectionAnalysis({
      runId: input.runId,
      error: new Error('AI-körningen tog för lång tid. Försök igen.'),
      source: 'Provider deadline exceeded',
    })
    return
  }

  let provider: Awaited<ReturnType<typeof retrieveStructuredOpenAiResponse>>
  try {
    provider = await retrieveStructuredOpenAiResponse({ apiKey, responseId: workflow.responseId })
  } catch (pollError) {
    if (pollError instanceof Error && pollError.message === 'OPENAI_RESPONSE_NOT_FOUND') {
      await failInspectionAnalysis({ runId: input.runId, error: pollError, source: 'Provider response missing' })
      return
    }
    console.error('[tu.analysis] Provider status temporarily unavailable', {
      runId: input.runId,
      error: pollError,
    })
    await admin.from('tu_ai_runs').update({
      progress_message: 'AI:n arbetar vidare. Status kontrolleras automatiskt igen.',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', input.runId).eq('status', 'processing')
    return
  }

  if (provider.envelope.status === 'queued' || provider.envelope.status === 'in_progress') {
    await admin.from('tu_ai_runs').update({
      progress_message: workflow.stage === 'image_batch_pending'
        ? `Analyserar bilder upp till ${workflow.nextImageIndex} av ${row.progress_total ?? workflow.nextImageIndex}.`
        : 'Sammanställer observationer, mätvärden och bildiakttagelser.',
      heartbeat_at: new Date().toISOString(),
    }).eq('id', input.runId).eq('status', 'processing')
    return
  }
  if (
    provider.envelope.status === 'failed'
    || provider.envelope.status === 'incomplete'
    || provider.envelope.status === 'cancelled'
  ) {
    await failInspectionAnalysis({
      runId: input.runId,
      error: new Error(tuReportProviderFailureMessage(provider.payload)),
      source: `Provider ended with ${provider.envelope.status}`,
    })
    return
  }

  try {
    const expectedHeartbeat = cleanText(row.heartbeat_at)
    const now = new Date().toISOString()
    const imageAnalyses = storedImageAnalyses(workflow.imageAnalyses)
    const parsed = parseStructuredResponse(provider.payload)
    const nextState: Omit<TuAnalysisBackgroundState, 'version'> = workflow.stage === 'image_batch_pending'
      ? {
          stage: 'image_batch_ready',
          responseId: null,
          submittedAt: null,
          nextImageIndex: workflow.nextImageIndex,
          batchImageIds: [],
          imageAnalyses: [
            ...imageAnalyses,
            ...parseImageBatch(parsed, workflow.batchImageIds),
          ],
          analysisDraft: null,
        }
      : {
          stage: 'synthesis_ready',
          responseId: null,
          submittedAt: null,
          nextImageIndex: workflow.nextImageIndex,
          batchImageIds: [],
          imageAnalyses,
          analysisDraft: parseAnalysisDraft(parsed),
        }
    const progressCurrent = nextState.nextImageIndex
    const { data: readyData, error: readyError } = await admin.from('tu_ai_runs').update({
      status: 'queued',
      output_payload: tuAnalysisBackgroundPayload(nextState),
      progress_stage: 'queued',
      progress_current: progressCurrent,
      progress_message: nextState.stage === 'image_batch_ready'
        ? `${progressCurrent} av ${row.progress_total ?? progressCurrent} bilder analyserade.`
        : 'Helhetsanalysen är klar och kvalitetskontrolleras.',
      heartbeat_at: now,
    })
      .eq('id', input.runId)
      .eq('status', 'processing')
      .eq('heartbeat_at', expectedHeartbeat)
      .select('id')
      .maybeSingle()
    if (readyError) throw new Error(readyError.message)
    if (!readyData) return
    await runTuInspectionAnalysis(input)
  } catch (parseError) {
    await failInspectionAnalysis({ runId: input.runId, error: parseError, source: 'Provider result parsing failed' })
  }
}

export async function advanceTuInspectionAnalysis(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('tu_ai_runs')
    .select('status')
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'inspection_analysis')
    .maybeSingle()
  if (error) throw new Error(error.message)
  const status = cleanText((data as { status?: unknown } | null)?.status)
  if (status === 'queued') return runTuInspectionAnalysis(input)
  if (status === 'processing') return pollTuInspectionAnalysis(input)
}
