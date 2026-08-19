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
  type TuAnalysisRun,
  type TuAnalysisValidation,
  type TuAnalysisWorkflow,
} from '@/lib/tu/analysis'
import { TU_MOISTURE_DAMAGE_TEMPLATE_KEY } from '@/lib/tu/evidence'
import { listTuObservations } from '@/lib/tu/evidenceServer'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  type TuInvestigationImage,
} from '@/lib/tu/server'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_ANALYSIS_MODEL =
  process.env.OPENAI_TU_ANALYSIS_MODEL?.trim()
  || process.env.OPENAI_TU_TEXT_MODEL?.trim()
  || 'gpt-4o-mini'
const RULESET_KEY = 'tu_moisture_inspection_v1'
const RULESET_VERSION = 1
const IMAGE_BATCH_SIZE = 8
const DEFAULT_MAX_IMAGES = 80
const STALE_RUN_MINUTES = 12

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
  supporting_reasons: unknown
  contradicting_reasons: unknown
  warnings: unknown
  sort_order: number | null
  created_at: string | null
  updated_at: string | null
}

type OpenAiResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>
  }>
}

type ImageAnalysis = {
  imageId: string
  visibleFacts: string[]
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
  supportingReasons: string[]
  contradictingReasons: string[]
  warnings: string[]
}

type AnalysisDraft = {
  overview: string
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
    warnings: stringArray(output.warnings),
    createdAt: isoOrNow(row.created_at),
    startedAt: row.started_at,
    completedAt: row.completed_at,
  }
}

function mapItem(row: ItemRow): TuAnalysisItem {
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
    sourceObservationIds: stringArray(row.source_observation_ids),
    sourceImageIds: stringArray(row.source_image_ids),
    sourceMeasurementIds: stringArray(row.source_measurement_ids),
    supportingReasons: stringArray(row.supporting_reasons),
    contradictingReasons: stringArray(row.contradicting_reasons),
    warnings: stringArray(row.warnings),
    sortOrder: row.sort_order ?? 100,
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
  }
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

async function structuredOpenAiRequest(input: {
  apiKey: string
  instructions: string
  content: unknown
  schemaName: string
  schema: JsonRecord
  maxOutputTokens: number
}) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TU_ANALYSIS_MODEL,
      store: false,
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
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    console.error('[tu.analysis] OpenAI request failed', {
      status: response.status,
      detail: detail.slice(0, 800),
    })
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}`)
  }
  const payload = await response.json() as OpenAiResponse
  const text = responseText(payload)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  return JSON.parse(text) as JsonRecord
}

export async function getTuAnalysisValidation(input: {
  orgId: string
  inspectionId: string
}): Promise<TuAnalysisValidation> {
  const [observations, images] = await Promise.all([
    listTuObservations(input),
    listTuInvestigationImages(input),
  ])
  const linkedImageIds = new Set(observations.flatMap((observation) => observation.imageIds))
  const measurementCount = observations.reduce(
    (sum, observation) => sum + observation.measurements.length,
    0
  )
  const emptyObservationCount = observations.filter((observation) => (
    !observation.noteText.trim()
    && !observation.transcriptText?.trim()
    && observation.imageIds.length === 0
    && observation.measurements.length === 0
  )).length
  const unlinkedImageCount = images.filter((image) => !linkedImageIds.has(image.id)).length
  const warnings: string[] = []
  if (emptyObservationCount > 0) {
    warnings.push(`${emptyObservationCount} observationer saknar text, bild och mätvärde.`)
  }
  if (unlinkedImageCount > 0) {
    warnings.push(`${unlinkedImageCount} bilder är inte kopplade till någon observation. De analyseras ändå som bildbank.`)
  }
  if (observations.length === 0 && images.length > 0) {
    warnings.push('Det finns bilder men inga fältobservationer. Analysen får begränsad kontext.')
  }
  return {
    observationCount: observations.length,
    imageCount: images.length,
    measurementCount,
    unlinkedImageCount,
    emptyObservationCount,
    warnings,
    canComplete: observations.length > 0 || images.length > 0,
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
      run = mapRun(runData as unknown as RunRow)
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
    items = ((itemData ?? []) as unknown as ItemRow[]).map(mapItem)
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
  if (investigation.reportTemplateKey !== TU_MOISTURE_DAMAGE_TEMPLATE_KEY) {
    throw new Error('TU_ANALYSIS_TEMPLATE_NOT_SUPPORTED')
  }
  const imageById = new Map(images.map((image) => [image.id, image]))
  return {
    investigation,
    images,
    snapshot: {
      ruleset: RULESET_KEY,
      reportTemplate: {
        key: investigation.reportTemplateKey,
        title: investigation.reportTemplateTitle,
        version: investigation.reportTemplateVersion,
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
      observations: observations.map((observation) => ({
        id: observation.id,
        sourceType: observation.sourceType,
        location: observation.location,
        buildingComponent: observation.buildingComponent,
        noteText: observation.noteText.slice(0, 8000),
        transcriptText: observation.transcriptText?.slice(0, 12000) ?? null,
        riskNote: observation.riskNote,
        suggestedFollowUp: observation.suggestedFollowUp,
        certainty: observation.certainty,
        reviewStatus: observation.reviewStatus,
        imageIds: observation.imageIds,
        imageCaptions: observation.imageIds.map((id) => ({
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
          note: measurement.note,
          measuredAt: measurement.measuredAt,
        })),
        observedAt: observation.observedAt,
      })),
      images: images.map((image) => ({
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

async function imageDataUrl(image: TuInvestigationImage) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.storage.from(image.storageBucket).download(image.filePath)
  if (error || !data) throw new Error(error?.message ?? 'TU_IMAGE_DOWNLOAD_FAILED')
  const source = Buffer.from(await data.arrayBuffer())
  const optimized = await sharp(source)
    .rotate()
    .resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78, mozjpeg: true })
    .toBuffer()
  return `data:image/jpeg;base64,${optimized.toString('base64')}`
}

async function analyzeImageBatch(input: {
  apiKey: string
  images: TuInvestigationImage[]
}) {
  const loaded = await Promise.all(input.images.map(async (image) => {
    try {
      return { image, dataUrl: await imageDataUrl(image), error: null }
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
      quality: 'unusable',
      relevance: 'low',
      possibleDuplicateImageIds: [],
      warnings: [`Bilden kunde inte analyseras: ${item.error}`],
    }))
  if (available.length === 0) return failed

  const content: Array<JsonRecord> = [{
    type: 'input_text',
    text: [
      'Analysera endast vad som faktiskt är synligt i bilderna.',
      'Identifiera inte personer och dra inga slutsatser om orsak, ansvar eller dolda förhållanden.',
      'Skriv neutrala svenska bildiakttagelser. Markera osäker bildkvalitet uttryckligen.',
      `Bilder i denna batch: ${available.map((item) => `${item.image.id} (${item.image.caption ?? 'utan bildtext'})`).join(', ')}`,
    ].join('\n'),
  }]
  for (const item of available) {
    content.push({ type: 'input_text', text: `imageId: ${item.image.id}` })
    content.push({ type: 'input_image', image_url: item.dataUrl, detail: 'low' })
  }
  const parsed = await structuredOpenAiRequest({
    apiKey: input.apiKey,
    instructions: 'Du är ett visuellt dokumentationsstöd för en svensk fuktskadeutredning. Du beskriver synliga fakta, inte diagnoser.',
    content: [{ role: 'user', content }],
    schemaName: 'tu_moisture_image_analysis',
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
              quality: { type: 'string', enum: ['good', 'limited', 'unusable'] },
              relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
              possibleDuplicateImageIds: { type: 'array', items: { type: 'string' } },
              warnings: { type: 'array', items: { type: 'string' } },
            },
            required: [
              'imageId',
              'visibleFacts',
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
    maxOutputTokens: 2400,
  })
  const allowedIds = new Set(available.map((item) => item.image.id))
  const results = Array.isArray(parsed.images) ? parsed.images : []
  const mapped: ImageAnalysis[] = results
    .map(record)
    .filter((item) => allowedIds.has(cleanText(item.imageId)))
    .map((item) => ({
      imageId: cleanText(item.imageId),
      visibleFacts: stringArray(item.visibleFacts).slice(0, 12),
      quality: item.quality === 'good' || item.quality === 'limited' ? item.quality : 'unusable',
      relevance: item.relevance === 'high' || item.relevance === 'medium' ? item.relevance : 'low',
      possibleDuplicateImageIds: stringArray(item.possibleDuplicateImageIds)
        .filter((id) => allowedIds.has(id)),
      warnings: stringArray(item.warnings),
    }))
  const returnedIds = new Set(mapped.map((item) => item.imageId))
  for (const item of available) {
    if (!returnedIds.has(item.image.id)) {
      mapped.push({
        imageId: item.image.id,
        visibleFacts: [],
        quality: 'unusable',
        relevance: 'low',
        possibleDuplicateImageIds: [],
        warnings: ['AI-analysen returnerade inget resultat för bilden.'],
      })
    }
  }
  return [...mapped, ...failed]
}

function parseAnalysisDraft(value: JsonRecord): AnalysisDraft {
  return {
    overview: cleanText(value.overview),
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
      supportingReasons: stringArray(item.supportingReasons),
      contradictingReasons: stringArray(item.contradictingReasons),
      warnings: stringArray(item.warnings),
    })).filter((item) => item.title && item.summary),
  }
}

async function synthesizeInspection(input: {
  apiKey: string
  snapshot: JsonRecord
  imageAnalyses: ImageAnalysis[]
}) {
  const parsed = await structuredOpenAiRequest({
    apiKey: input.apiKey,
    instructions: [
      'Du analyserar ett samlat besiktningsunderlag för en svensk fuktskadeutredning.',
      'AI-resultatet är ett granskningsunderlag, aldrig ett färdigt utlåtande.',
      'Använd endast fakta och käll-id i underlaget. Hitta inte på mätvärden, datum, händelser, orsaker eller ansvar.',
      'Håll beställaruppgifter åtskilda från besiktningsmannens verifierade iakttagelser.',
      'En teknisk hypotes ska ha certainty probable eller uncertain och redovisa både stöd och motsägelser.',
      'En bildanalys visar endast synliga bildfakta och får inte ensam bevisa dolda förhållanden eller skadeorsak.',
      'Identifiera informationsluckor och rekommenderade fortsatta kontroller när underlaget inte räcker.',
      'Välj targetSectionId endast bland rapportsektionerna i underlaget. Använd null om ingen sektion passar.',
      'Skriv koncist, sakligt och granskningsbart på svenska utan juridiska slutsatser.',
    ].join('\n'),
    content: JSON.stringify({
      inspection: input.snapshot,
      imageAnalyses: input.imageAnalyses,
    }),
    schemaName: 'tu_moisture_inspection_analysis',
    schema: {
      type: 'object',
      properties: {
        overview: { type: 'string' },
        warnings: { type: 'array', items: { type: 'string' } },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              itemType: {
                type: 'string',
                enum: [
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
              'supportingReasons',
              'contradictingReasons',
              'warnings',
            ],
            additionalProperties: false,
          },
        },
      },
      required: ['overview', 'warnings', 'items'],
      additionalProperties: false,
    },
    maxOutputTokens: 9000,
  })
  return parseAnalysisDraft(parsed)
}

export async function runTuInspectionAnalysis(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const apiKey = process.env.OPENAI_API_KEY
  const admin = createSupabaseAdminClient()
  if (!apiKey) {
    const now = new Date().toISOString()
    const message = 'OPENAI_API_KEY_MISSING'
    const { error } = await admin
      .from('tu_ai_runs')
      .update({
        status: 'failed',
        error_message: message,
        progress_stage: 'failed',
        progress_message: 'Analysen kunde inte starta eftersom AI-konfigurationen saknas.',
        heartbeat_at: now,
        completed_at: now,
      })
      .eq('id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .in('status', ['queued', 'processing'])
    if (error) throw new Error(error.message)
    return
  }
  const startedAt = new Date().toISOString()
  const { data: claimed, error: claimError } = await admin
    .from('tu_ai_runs')
    .update({
      status: 'processing',
      started_at: startedAt,
      completed_at: null,
      error_message: null,
      progress_stage: 'preparing',
      progress_current: 0,
      progress_message: 'Förbereder observationer, mätvärden och bilder.',
      heartbeat_at: startedAt,
    })
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'inspection_analysis')
    .eq('status', 'queued')
    .select('id,input_snapshot,attempt_count')
    .maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return
  const claimedRun = claimed as { id: string; input_snapshot: unknown; attempt_count: number | null }
  const runStillProcessing = async () => {
    const { data, error } = await admin
      .from('tu_ai_runs')
      .select('status')
      .eq('id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as { status?: string } | null)?.status === 'processing'
  }
  const updateProgress = async (progress: {
    stage: 'preparing' | 'analyzing_images' | 'synthesizing' | 'saving'
    current?: number
    total?: number
    message: string
  }) => {
    const { error } = await admin
      .from('tu_ai_runs')
      .update({
        progress_stage: progress.stage,
        progress_current: progress.current,
        progress_total: progress.total,
        progress_message: progress.message,
        heartbeat_at: new Date().toISOString(),
      })
      .eq('id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .eq('status', 'processing')
    if (error) throw new Error(error.message)
  }
  const { error: attemptError } = await admin
    .from('tu_ai_runs')
    .update({ attempt_count: (claimedRun.attempt_count ?? 0) + 1 })
    .eq('id', input.runId)
  if (attemptError) throw new Error(attemptError.message)

  try {
    const snapshot = record(claimedRun.input_snapshot)
    const images = await listTuInvestigationImages({ orgId: input.orgId, inspectionId: input.inspectionId })
    const maxImages = configuredMaxImages()
    const selectedImages = images.slice(0, maxImages)
    const imageAnalyses: ImageAnalysis[] = []
    if (selectedImages.length > 0) {
      await updateProgress({
        stage: 'analyzing_images',
        current: 0,
        total: selectedImages.length,
        message: `Analyserar bilder 0 av ${selectedImages.length}.`,
      })
    }
    for (let index = 0; index < selectedImages.length; index += IMAGE_BATCH_SIZE) {
      if (!await runStillProcessing()) return
      const batch = selectedImages.slice(index, index + IMAGE_BATCH_SIZE)
      imageAnalyses.push(...await analyzeImageBatch({
        apiKey,
        images: batch,
      }))
      const completedImages = Math.min(index + batch.length, selectedImages.length)
      await updateProgress({
        stage: 'analyzing_images',
        current: completedImages,
        total: selectedImages.length,
        message: `Analyserar bilder ${completedImages} av ${selectedImages.length}.`,
      })
    }
    if (!await runStillProcessing()) return
    await updateProgress({
      stage: 'synthesizing',
      current: selectedImages.length,
      total: selectedImages.length,
      message: 'Sammanställer observationer, mätvärden och bildiakttagelser.',
    })
    const analysis = await synthesizeInspection({ apiKey, snapshot, imageAnalyses })
    if (images.length > selectedImages.length) {
      analysis.warnings.push(
        `${images.length - selectedImages.length} bilder analyserades inte eftersom bildgränsen är ${maxImages}.`
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
    const itemRows = analysis.items
      .filter((item) => isTuAnalysisItemType(item.itemType))
      .map((item, index) => ({
        org_id: input.orgId,
        inspection_id: input.inspectionId,
        run_id: input.runId,
        item_type: item.itemType,
        title: item.title,
        summary: item.summary,
        certainty: isTuAnalysisCertainty(item.certainty) ? item.certainty : 'uncertain',
        review_status: 'pending',
        target_section_id:
          item.targetSectionId && validSectionIds.has(item.targetSectionId)
            ? item.targetSectionId
            : null,
        include_in_report: item.includeInReport,
        source_observation_ids: item.sourceObservationIds.filter((id) => validObservationIds.has(id)),
        source_image_ids: item.sourceImageIds.filter((id) => validImageIds.has(id)),
        source_measurement_ids: item.sourceMeasurementIds.filter((id) => validMeasurementIds.has(id)),
        supporting_reasons: item.supportingReasons,
        contradicting_reasons: item.contradictingReasons,
        warnings: item.warnings,
        sort_order: (index + 1) * 10,
      }))

    if (!await runStillProcessing()) return
    await updateProgress({
      stage: 'saving',
      current: selectedImages.length,
      total: selectedImages.length,
      message: 'Sparar analysresultatet för granskning.',
    })

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
      warnings: analysis.warnings,
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
    const message = error instanceof Error ? error.message.slice(0, 1200) : 'TU_ANALYSIS_FAILED'
    await admin
      .from('tu_ai_runs')
      .update({
        status: 'failed',
        error_message: message,
        progress_stage: 'failed',
        progress_message: 'Analysen kunde inte slutföras. Öppna Analys och försök igen.',
        heartbeat_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
      })
      .eq('id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .in('status', ['queued', 'processing'])
    console.error('[tu.analysis] Inspection analysis failed', {
      inspectionId: input.inspectionId,
      runId: input.runId,
      error,
    })
  }
}
