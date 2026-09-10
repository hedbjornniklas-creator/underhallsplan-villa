import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  isTuAnalysisProgressStage,
  isTuAnalysisRunStatus,
} from '@/lib/tu/analysis'
import { usesTuAiAssistedWorkflow } from '@/lib/tu/authoring'
import { getApprovedTuControlPlanSnapshot } from '@/lib/tu/controlPlanServer'
import { tuDocumentAnalysisSourceRoleLabel } from '@/lib/tu/documents'
import { isTuAnalysisSourceImage } from '@/lib/tu/evidence'
import { listTuObservations } from '@/lib/tu/evidenceServer'
import {
  sortTuEvidenceChronologically,
  type TuGeneratedGroundedSection,
  type TuGroundingStatus,
} from '@/lib/tu/grounding'
import {
  buildTuReportWriterSnapshot,
  parseTuReportEditorialPlan,
  type TuReportEditorialPlan,
} from '@/lib/tu/reportEditorial'
import {
  normalizeTuReportProviderResponse,
  parseTuReportBackgroundState,
  tuReportBackgroundPayload,
  tuReportProviderFailureMessage,
  type TuReportBackgroundState,
} from '@/lib/tu/reportDraftBackground'
import {
  ensureTuPostDamageDisclaimer,
  isTuPostDamageReport,
  resolveTuReportSectionPolicy,
  TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY,
  TU_POST_DAMAGE_REPORT_DISCLAIMER,
  TU_POST_DAMAGE_SOURCE_POLICY,
} from '@/lib/tu/reportTemplates'
import { validateTuReportSections } from '@/lib/tu/reportGroundingServer'
import type {
  TuWholeReportDraftRun,
  TuWholeReportDraftSection,
  TuWholeReportDraftState,
} from '@/lib/tu/reportDraft'
import { getTuInvestigationById, listTuInvestigationImages } from '@/lib/tu/server'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_REPORT_MODEL =
  process.env.OPENAI_TU_REPORT_MODEL?.trim()
  || 'gpt-5.6'
const RULESET_KEY = 'tu_ai_assisted_report_v1'
const RULESET_VERSION = 1
const STALE_RUN_MINUTES = 12
const PROVIDER_CREATE_TIMEOUT_MS = 30_000
const PROVIDER_RETRIEVE_TIMEOUT_MS = 20_000
const PROVIDER_MAX_JOB_AGE_MS = 8 * 60 * 1_000
const EDITORIAL_MAX_OUTPUT_TOKENS = 24_000
const REPORT_MAX_OUTPUT_TOKENS = 32_000
const NON_EDITABLE_SECTION_KEYS = new Set(['assignment_parties', 'signature'])

type JsonRecord = Record<string, unknown>

type RunRow = {
  id: string
  status: string
  model: string
  error_message: string | null
  progress_stage: string | null
  progress_current: number | null
  progress_total: number | null
  progress_message: string | null
  heartbeat_at: string | null
  input_snapshot: unknown
  output_payload: unknown
  created_at: string | null
  started_at: string | null
  completed_at: string | null
}

type SuggestionRow = {
  id: string
  run_id: string
  target_section_id: string
  target_section_key: string
  target_section_title: string
  proposed_text: string
  status: string
  source_observation_ids: unknown
  source_analysis_item_ids: unknown
  source_field_keys: unknown
  warnings: unknown
  grounding_status: string | null
  application_mode: string | null
  created_at: string | null
  updated_at: string | null
}

type OpenAiResponse = {
  id?: string
  status?: string
  incomplete_details?: unknown
  error?: unknown
  output_text?: string
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}

type GeneratedReport = {
  overview: string
  warnings: string[]
  sections: TuGeneratedGroundedSection[]
}

const RUN_COLUMNS = [
  'id',
  'status',
  'model',
  'error_message',
  'progress_stage',
  'progress_current',
  'progress_total',
  'progress_message',
  'heartbeat_at',
  'input_snapshot',
  'output_payload',
  'created_at',
  'started_at',
  'completed_at',
].join(',')

const SUGGESTION_COLUMNS = [
  'id',
  'run_id',
  'target_section_id',
  'target_section_key',
  'target_section_title',
  'proposed_text',
  'status',
  'source_observation_ids',
  'source_analysis_item_ids',
  'source_field_keys',
  'warnings',
  'grounding_status',
  'application_mode',
  'created_at',
  'updated_at',
].join(',')

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function isoOrNow(value: string | null | undefined) {
  return value && !Number.isNaN(Date.parse(value)) ? value : new Date().toISOString()
}

function isGroundingStatus(value: unknown): value is TuGroundingStatus {
  return value === 'grounded'
    || value === 'needs_source'
    || value === 'blocked'
    || value === 'manually_edited'
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

function mapRun(row: RunRow): TuWholeReportDraftRun {
  const output = record(row.output_payload)
  const status = isTuAnalysisRunStatus(row.status) ? row.status : 'failed'
  const fallbackStage = status === 'processing' ? 'synthesizing' : status
  return {
    id: row.id,
    status,
    model: row.model,
    errorMessage: row.error_message,
    progressStage: isTuAnalysisProgressStage(row.progress_stage)
      ? row.progress_stage
      : fallbackStage,
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

function mapSection(row: SuggestionRow): TuWholeReportDraftSection {
  return {
    id: row.id,
    runId: row.run_id,
    targetSectionId: row.target_section_id,
    targetSectionKey: row.target_section_key,
    targetSectionTitle: row.target_section_title,
    proposedText: row.proposed_text,
    status: row.status === 'accepted' || row.status === 'rejected' ? row.status : 'pending',
    sourceObservationIds: stringArray(row.source_observation_ids),
    sourceAnalysisItemIds: stringArray(row.source_analysis_item_ids),
    sourceFieldKeys: stringArray(row.source_field_keys),
    warnings: stringArray(row.warnings),
    groundingStatus: isGroundingStatus(row.grounding_status)
      ? row.grounding_status
      : 'grounded',
    applicationMode: row.application_mode === 'replace' || row.application_mode === 'append'
      ? row.application_mode
      : null,
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at ?? row.created_at),
  }
}

async function markStaleRunFailed(run: TuWholeReportDraftRun) {
  const lastActivity = run.heartbeatAt ?? run.startedAt ?? run.createdAt
  const staleBefore = Date.now() - STALE_RUN_MINUTES * 60 * 1000
  if (
    (run.status !== 'queued' && run.status !== 'processing')
    || new Date(lastActivity).getTime() >= staleBefore
  ) return run

  const message = 'Rapportutkastet avbröts eller överskred tillåten körtid. Försök igen.'
  const now = new Date().toISOString()
  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('tu_ai_runs')
    .update({
      status: 'failed',
      error_message: message,
      progress_stage: 'failed',
      progress_message: message,
      heartbeat_at: now,
      completed_at: now,
    })
    .eq('id', run.id)
    .in('status', ['queued', 'processing'])
  if (error) throw new Error(error.message)
  return {
    ...run,
    status: 'failed' as const,
    errorMessage: message,
    progressStage: 'failed' as const,
    progressMessage: message,
    heartbeatAt: now,
    completedAt: now,
  }
}

export async function getTuWholeReportDraftState(input: {
  orgId: string
  inspectionId: string
}): Promise<TuWholeReportDraftState> {
  const admin = createSupabaseAdminClient()
  const [{ data: runData, error: runError }, { data: workflowData, error: workflowError }] =
    await Promise.all([
      admin
        .from('tu_ai_runs')
        .select(RUN_COLUMNS)
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .eq('operation', 'report_draft')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin
        .from('tu_analysis_workflows')
        .select('status,current_analysis_run_id,analysis_approved_at')
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .maybeSingle(),
    ])
  if (runError) throw new Error(runError.message)
  if (workflowError) throw new Error(workflowError.message)
  if (!runData) return { run: null, sections: [] }

  const runRow = runData as unknown as RunRow
  const snapshot = record(runRow.input_snapshot)
  const approvedAnalysis = record(snapshot.approvedAnalysis)
  const workflow = workflowData as {
    status?: string
    current_analysis_run_id?: string | null
    analysis_approved_at?: string | null
  } | null
  if (
    workflow?.status !== 'analysis_approved'
    || cleanText(approvedAnalysis.runId) !== workflow.current_analysis_run_id
    || cleanText(approvedAnalysis.approvedAt) !== workflow.analysis_approved_at
  ) {
    return { run: null, sections: [] }
  }

  let run = mapRun(runRow)
  run = await markStaleRunFailed(run)
  const { data: sectionData, error: sectionError } = await admin
    .from('tu_ai_suggestions')
    .select(SUGGESTION_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('run_id', run.id)
    .order('created_at', { ascending: true })
  if (sectionError) throw new Error(sectionError.message)
  return {
    run,
    sections: ((sectionData ?? []) as unknown as SuggestionRow[]).map(mapSection),
  }
}

export async function buildTuReportSnapshot(input: { orgId: string; inspectionId: string }) {
  const [investigation, observations, images] = await Promise.all([
    getTuInvestigationById(input),
    listTuObservations(input),
    listTuInvestigationImages(input),
  ])
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
  if (!usesTuAiAssistedWorkflow(investigation.reportAuthoringMode, investigation.reportTemplateKey)) {
    throw new Error('TU_REPORT_DRAFT_TEMPLATE_NOT_SUPPORTED')
  }
  const controlPlan = investigation.reportWorkflowProfile === 'post_damage_review'
    ? await getApprovedTuControlPlanSnapshot(input)
    : null
  if (investigation.reportWorkflowProfile === 'post_damage_review' && !controlPlan) {
    throw new Error('TU_CONTROL_PLAN_NOT_APPROVED')
  }
  const sourceImages = images.filter(isTuAnalysisSourceImage)
  const sourceImageIds = new Set(sourceImages.map((image) => image.id))

  const sections = investigation.reportDraft.sections
    .filter((section) => !NON_EDITABLE_SECTION_KEYS.has(section.key))
    .map((section, index) => {
      const policy = resolveTuReportSectionPolicy(investigation.reportTemplateKey, section.key)
      return {
        id: section.id || section.key,
        key: section.key,
        title: policy?.title ?? section.title,
        currentText: section.text,
        aiInstruction: policy?.aiInstruction ?? section.aiInstruction ?? null,
        isRequired: section.isRequired === true,
        order: index + 1,
      }
    })
  if (sections.length === 0) throw new Error('TU_REPORT_DRAFT_NO_SECTIONS')

  const sourceFields: Array<{
    key: string
    label: string
    value: string
    sourceRole: 'assignment_context' | 'current_evidence' | 'historic_context' | 'report_policy'
  }> = []
  const addSourceField = (
    key: string,
    label: string,
    value: unknown,
    sourceRole: 'assignment_context' | 'current_evidence' | 'historic_context' | 'report_policy' = 'assignment_context'
  ) => {
    const normalized = cleanText(value)
    if (normalized) sourceFields.push({ key, label, value: normalized, sourceRole })
  }
  addSourceField('assignment.title', 'Uppdragets titel', investigation.title)
  addSourceField('assignment.assignmentNumber', 'Arbetsnummer', investigation.assignmentNumber)
  addSourceField('assignment.scopeDescription', 'Uppdragets omfattning', investigation.scopeDescription)
  addSourceField('assignment.inspectionDate', 'Besiktningsdatum', investigation.date)
  addSourceField('assignment.inspectionTime', 'Besiktningstid', investigation.inspectionTime)
  addSourceField('assignment.background', 'Bakgrund', investigation.background)
  addSourceField('assignment.basis', 'Underlag', investigation.basis)
  addSourceField('assignment.accessibility', 'Åtkomlighet', investigation.accessibility)
  addSourceField('object.objectType', 'Objekttyp', investigation.objectType)
  addSourceField('object.address', 'Objektadress', investigation.propertyAddress)
  addSourceField('object.city', 'Ort', investigation.propertyCity)
  addSourceField('object.cadastralId', 'Fastighetsbeteckning', investigation.cadastralId)
  addSourceField('object.brfName', 'Bostadsrättsförening', investigation.brfName)
  addSourceField('object.apartmentNumber', 'Lägenhetsnummer', investigation.apartmentNumber)
  if (isTuPostDamageReport(investigation.reportTemplateKey)) {
    addSourceField(
      TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY,
      'Uppdragets karaktär',
      TU_POST_DAMAGE_REPORT_DISCLAIMER,
      'report_policy'
    )
  }
  if (controlPlan) {
    addSourceField('controlPlan.mainQuestion', 'Kontrollens huvudfråga', controlPlan.mainQuestion)
    for (const document of controlPlan.documents) {
      addSourceField(
        `controlPlan.document.${document.id}`,
        'Tidigare underlag',
        [
          document.title || document.fileName,
          document.documentDate,
          document.sourceParty,
          tuDocumentAnalysisSourceRoleLabel(document.sourceRole),
        ].filter(Boolean).join(' · '),
        'historic_context'
      )
    }
  }
  for (const image of sourceImages) {
    addSourceField(`image.${image.id}.caption`, 'Bildtext', image.caption, 'current_evidence')
  }

  const chronologicalObservations = sortTuEvidenceChronologically(observations)
  const imageById = new Map(sourceImages.map((image) => [image.id, image]))
  const evidence = {
    chronologyInstruction:
      'Fältposterna är sorterade äldst till nyast. Godkända aktuella bedömningar och konfliktlösningar styr hur preliminära uppgifter får användas.',
    observations: chronologicalObservations.map((observation, index) => ({
      id: observation.id,
      sequence: index + 1,
      observedAt: observation.observedAt,
      sourceType: observation.sourceType,
      location: observation.location,
      buildingComponent: observation.buildingComponent,
      noteText: observation.noteText.slice(0, 8000),
      transcriptText: observation.transcriptText?.slice(0, 12000) ?? null,
      riskNote: observation.riskNote,
      suggestedFollowUp: observation.suggestedFollowUp,
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
        note: measurement.note,
        measuredAt: measurement.measuredAt,
      })),
    })),
    images: sourceImages.map((image) => ({
      id: image.id,
      sectionKey: image.sectionKey,
      caption: image.caption,
      captionSourceFieldKey: image.caption ? `image.${image.id}.caption` : null,
      createdAt: image.createdAt,
    })),
  }

  const admin = createSupabaseAdminClient()
  const { data: workflowData, error: workflowError } = await admin
    .from('tu_analysis_workflows')
    .select('status,current_analysis_run_id,analysis_approved_at,analysis_stale_at')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()
  if (workflowError) throw new Error(workflowError.message)
  const workflow = workflowData as {
    status?: string
    current_analysis_run_id?: string | null
    analysis_approved_at?: string | null
    analysis_stale_at?: string | null
  } | null
  if (workflow?.analysis_stale_at) throw new Error('TU_ANALYSIS_STALE')
  if (workflow?.status !== 'analysis_approved' || !workflow.current_analysis_run_id) {
    throw new Error('TU_ANALYSIS_NOT_APPROVED')
  }

  const [{ data: analysisRun, error: analysisRunError }, { data: analysisItems, error: itemsError }] =
    await Promise.all([
      admin
        .from('tu_ai_runs')
        .select('output_payload')
        .eq('id', workflow.current_analysis_run_id)
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .eq('operation', 'inspection_analysis')
        .eq('status', 'completed')
        .maybeSingle(),
      admin
        .from('tu_ai_analysis_items')
        .select([
          'id',
          'item_type',
          'title',
          'summary',
          'certainty',
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
        ].join(','))
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .eq('run_id', workflow.current_analysis_run_id)
        .eq('review_status', 'accepted')
        .order('sort_order', { ascending: true }),
    ])
  if (analysisRunError) throw new Error(analysisRunError.message)
  if (itemsError) throw new Error(itemsError.message)
  if (!analysisRun) throw new Error('TU_ANALYSIS_NOT_APPROVED')
  const acceptedItems = (analysisItems ?? []) as unknown as Array<Record<string, unknown>>
  const reportItems = acceptedItems.filter((item) => (
    item.item_type !== 'report_image'
    && (item.include_in_report === true || item.item_type === 'current_assessment')
  ))
  const resolvedConflicts = acceptedItems.filter((item) => item.item_type === 'evidence_conflict')
  if (reportItems.length === 0) throw new Error('TU_ANALYSIS_HAS_NO_ACCEPTED_ITEMS')

  const analysisOutput = record((analysisRun as { output_payload?: unknown }).output_payload)
  return {
    sectionCount: sections.length,
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
      sections,
      sourceFields,
      sourcePolicy: isTuPostDamageReport(investigation.reportTemplateKey)
        ? TU_POST_DAMAGE_SOURCE_POLICY
        : null,
      controlPlan,
      evidence,
      approvedAnalysis: {
        runId: workflow.current_analysis_run_id,
        approvedAt: workflow.analysis_approved_at,
        overview: cleanText(analysisOutput.overview),
        timelineSummary: cleanText(analysisOutput.timelineSummary),
        warnings: stringArray(analysisOutput.warnings),
        items: reportItems,
        resolvedConflicts,
      },
    },
  }
}

export async function createTuWholeReportDraftRun(input: {
  orgId: string
  inspectionId: string
  userId: string
}) {
  const admin = createSupabaseAdminClient()
  const { snapshot, sectionCount } = await buildTuReportSnapshot(input)
  const inputHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
  const now = new Date().toISOString()
  const { data: activeData, error: activeError } = await admin
    .from('tu_ai_runs')
    .select(`${RUN_COLUMNS},input_hash`)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'report_draft')
    .in('status', ['queued', 'processing'])
    .maybeSingle()
  if (activeError) throw new Error(activeError.message)
  if (activeData) {
    const active = await markStaleRunFailed(mapRun(activeData as unknown as RunRow))
    const activeInputHash = cleanText((activeData as { input_hash?: unknown }).input_hash)
    if (
      (active.status === 'queued' || active.status === 'processing')
      && activeInputHash === inputHash
    ) return active.id
    if (active.status === 'queued' || active.status === 'processing') {
      const { error: cancelError } = await admin
        .from('tu_ai_runs')
        .update({
          status: 'cancelled',
          error_message: 'Den godkända analysen ändrades innan rapportutkastet blev klart.',
          progress_stage: 'cancelled',
          progress_message: 'Rapportutkastet avbröts eftersom analysunderlaget ändrades.',
          heartbeat_at: now,
          completed_at: now,
        })
        .eq('id', active.id)
        .in('status', ['queued', 'processing'])
      if (cancelError) throw new Error(cancelError.message)
    }
  }

  const { data, error } = await admin
    .from('tu_ai_runs')
    .insert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      operation: 'report_draft',
      status: 'queued',
      model: TU_REPORT_MODEL,
      ruleset_key: RULESET_KEY,
      ruleset_version: RULESET_VERSION,
      input_snapshot: snapshot,
      input_hash: inputHash,
      attempt_count: 0,
      progress_stage: 'queued',
      progress_current: 0,
      progress_total: sectionCount,
      progress_message: 'Rapportutkastet väntar på att starta.',
      heartbeat_at: now,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'TU_REPORT_DRAFT_RUN_CREATE_FAILED')
  return String((data as { id: string }).id)
}

function parseGeneratedReport(payload: OpenAiResponse): GeneratedReport {
  const text = responseText(payload)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  let parsed: JsonRecord
  try {
    parsed = JSON.parse(text) as JsonRecord
  } catch {
    throw new Error('OPENAI_INCOMPLETE_REPORT_DRAFT')
  }
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map(record).map((section) => ({
        sectionId: cleanText(section.sectionId),
        paragraphs: (Array.isArray(section.paragraphs) ? section.paragraphs : [])
          .map(record)
          .map((paragraph) => ({
            text: cleanText(paragraph.text),
            sourceAnalysisItemIds: stringArray(paragraph.sourceAnalysisItemIds),
            sourceObservationIds: stringArray(paragraph.sourceObservationIds),
            sourceFieldKeys: stringArray(paragraph.sourceFieldKeys),
            warnings: stringArray(paragraph.warnings),
          }))
          .filter((paragraph) => paragraph.text),
        warnings: stringArray(section.warnings),
      }))
    : []
  return {
    overview: cleanText(parsed.overview),
    warnings: stringArray(parsed.warnings),
    sections,
  }
}

function editorialRequestBody(snapshot: JsonRecord) {
  return {
      model: TU_REPORT_MODEL,
      background: true,
      store: false,
      reasoning: { effort: 'high' },
      instructions: [
        'Du är redaktör för ett svenskt tekniskt utlåtande och planerar innehållet innan någon rapporttext skrivs.',
        'Identifiera uppdragets huvudsakliga tekniska fråga och avgränsa rapporten till det som behövs för att besvara den.',
        'Välj endast källor som behövs för uppdraget, genomförandet, avgörande iakttagelser, den samlade tekniska bedömningen eller en proportionerlig rekommendation.',
        'En uppgift kan vara korrekt men ändå sakna betydelse för den aktuella frågan. Sådana sidospår ska inte väljas.',
        'Den godkända current_assessment och godkända konfliktlösningar styr vilka slutsatser och benämningar som är aktuella.',
        'Besiktningsmannens observationer och egna bilder är dokumentation av den genomförda undersökningen, inte externt bildmaterial.',
        'Systemfält och deras etiketter är intern metadata. Välj ett fältvärde endast när själva sakuppgiften behövs i rapporten.',
        'Bristande metadata om en mätning är i första hand en intern granskningsvarning. Välj inte en uppräkning av saknade fält som rapportinnehåll.',
        'Om en faktisk begränsning påverkar möjligheten att besvara huvudfrågan får begränsningen väljas, men den ska beskrivas proportionerligt och utan intern kontrolljargong.',
        'Placera varje sakuppgift i en primär rapportdel. Undvik att planera samma resonemang i flera delar.',
        'En rapportdel får utelämnas när den endast skulle upprepa en annan del eller när relevant källstöd saknas.',
        'En rapportdel med isRequired true ska planeras med relevant källstöd när sådant finns. Om stöd verkligen saknas ska den utelämnas och få en tydlig internalWarning.',
        'Följ sourcePolicy. Källor märkta historic_context får endast identifiera kontrollunderlaget och förklara uppdragets inriktning; de får inte bära rapportens aktuella resultat, tekniska bedömning eller rekommendationer.',
        'Om en controlPlan finns är den endast ett internt orienteringsstöd för kontrollens huvudfråga. Planera inte en rapportdel per kontrollpunkt och använd inte kontrollplanen som rapportdisposition.',
        'Aktuella resultat och bedömningar ska i första hand väljas direkt från dagens observationer, bilder och kvalificerade mätningar. En tidigare rekommendation eller uppgift om utförd åtgärd är kontext, inte ett verifierat kontrollresultat.',
        'Kontrollstatus not_verifiable betyder att kontrollpunkten inte kunde verifieras. reported_not_verifiable betyder att utförandet uppges vara gjort men inte kunde verifieras. Skriv aldrig om någon av dessa statusar till en verifierad åtgärd.',
        `Fältet ${TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY}, när det finns, ska väljas till rapportdelen assignment_scope och får inte användas i någon annan rapportdel.`,
        'Returnera varje sectionId exakt en gång och i samma ordning som underlaget. Använd endast id:n och field keys som finns i JSON-underlaget.',
        'internalWarnings är för besiktningsmannens granskning och ska aldrig bli rapporttext.',
      ].join('\n'),
      input: JSON.stringify(snapshot, null, 2),
      text: {
        format: {
          type: 'json_schema',
          name: 'tu_report_editorial_plan',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              focus: { type: 'string' },
              scopeBoundary: { type: 'string' },
              internalWarnings: { type: 'array', items: { type: 'string' } },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sectionId: { type: 'string' },
                    include: { type: 'boolean' },
                    purpose: { type: 'string' },
                    selectedAnalysisItemIds: { type: 'array', items: { type: 'string' } },
                    selectedObservationIds: { type: 'array', items: { type: 'string' } },
                    selectedFieldKeys: { type: 'array', items: { type: 'string' } },
                    internalWarnings: { type: 'array', items: { type: 'string' } },
                  },
                  required: [
                    'sectionId',
                    'include',
                    'purpose',
                    'selectedAnalysisItemIds',
                    'selectedObservationIds',
                    'selectedFieldKeys',
                    'internalWarnings',
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ['focus', 'scopeBoundary', 'internalWarnings', 'sections'],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: EDITORIAL_MAX_OUTPUT_TOKENS,
  }
}

function parseEditorialPlan(payload: OpenAiResponse, snapshot: JsonRecord): TuReportEditorialPlan {
  const text = responseText(payload)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new Error('OPENAI_INCOMPLETE_REPORT_DRAFT')
  }
  return parseTuReportEditorialPlan({
    value,
    snapshot,
  })
}

function reportRequestBody(snapshot: JsonRecord) {
  return {
      model: TU_REPORT_MODEL,
      background: true,
      store: false,
      reasoning: { effort: 'high' },
      instructions: [
        'Du skriver ansvarig besiktningsmans svenska tekniska utlåtande utifrån ett redan redaktionellt gallrat underlag.',
        'Skriv som den besiktningsman som har utfört undersökningen, inte som ett system eller en extern granskare av källmaterial.',
        'Rapporten ska besvara editorialFocus och hålla sig inom scopeBoundary. Använd endast selectedSources i respektive rapportdel.',
        'Interna id:n, fältnamn, etiketter, transkriberingar, fältanteckningar, AI-analyser och granskningsprocessen får aldrig omnämnas i rapporttexten.',
        'Egna fotografier är dokumentation av iakttagelser. Beskriv sakförhållandet direkt och kalla dem inte bildmaterial eller underlag.',
        'Skilj sakligt mellan egna iakttagelser, uttryckligt angivna partsuppgifter och tekniska bedömningar utan att beskriva den interna datakällan.',
        'Följ den godkända aktuella bedömningen och återinför inte en preliminär benämning eller slutsats som senare har ersatts.',
        'Utelämna osäkra mätpåståenden när mätunderlaget inte räcker. Räkna inte upp vilka metadatafält som saknas i rapporten.',
        'Ta bara med begränsningar som har faktisk betydelse för slutsatsen och formulera dem i besiktningsmannens direkta fackspråk.',
        'Undvik sidospår, utfyllnad, onödiga negativa konstateranden och upprepning av plats, tid eller samma slutsats i flera delar.',
        'Hitta aldrig på observationer, mätvärden, metoder, orsaker, ansvar, fel eller utförda kontroller.',
        'Bevara relevanta manuella texter när de stöds av de valda källorna, men redigera helheten till konsekvent språk och disposition.',
        'Följ sourcePolicy. Tidigare handlingar får endast beskrivas kort i uppdragets bakgrund och får aldrig framställas som bevis för dagens förhållanden eller för att åtgärder har utförts.',
        'När rapportmallen gäller kontroll efter skadeåtgärd ska texten byggas runt den aktuella kontrollens observationer och grupperas efter område eller förhållande, inte efter kontrollplanens punkter.',
        'Använd vid behov formuleringarna verifierad i kontrollerbar del, avvikelse noterad, kan inte verifieras, inte åtkomlig eller inte kontrollerad. Använd inte godkänd eller underkänd.',
        'Ett förhållande som inte kunde verifieras får inte beskrivas som en utebliven eller felaktigt utförd åtgärd.',
        'Skriv endast rapportdelar där include är true. För övriga sectionId ska paragraphs vara en tom array.',
        'Följ varje rapportsdels aiInstruction och editorialPurpose. Skriv inte rubriken i texten.',
        'Returnera varje sectionId exakt en gång och i samma ordning som underlaget.',
        'Varje stycke måste ange minst en verklig källa via sourceAnalysisItemIds, sourceObservationIds eller sourceFieldKeys.',
        'Käll-id:n får bara hämtas från selectedSources i den aktuella rapportdelen.',
        'Ett stycke utan källor får inte skapas. Skriv i stället en varning på rapportdelen och lämna paragraphs tom.',
        'Skriv koncist, precist och proportionerligt. Textens omfattning ska styras av huvudfrågan och underlaget, inte av antalet tillgängliga fakta.',
      ].join('\n'),
      input: JSON.stringify(snapshot, null, 2),
      text: {
        format: {
          type: 'json_schema',
          name: 'tu_coherent_whole_report_draft',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              overview: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
              sections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sectionId: { type: 'string' },
                    paragraphs: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          text: { type: 'string' },
                          sourceAnalysisItemIds: { type: 'array', items: { type: 'string' } },
                          sourceObservationIds: { type: 'array', items: { type: 'string' } },
                          sourceFieldKeys: { type: 'array', items: { type: 'string' } },
                          warnings: { type: 'array', items: { type: 'string' } },
                        },
                        required: [
                          'text',
                          'sourceAnalysisItemIds',
                          'sourceObservationIds',
                          'sourceFieldKeys',
                          'warnings',
                        ],
                        additionalProperties: false,
                      },
                    },
                    warnings: { type: 'array', items: { type: 'string' } },
                  },
                  required: [
                    'sectionId',
                    'paragraphs',
                    'warnings',
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ['overview', 'warnings', 'sections'],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: REPORT_MAX_OUTPUT_TOKENS,
  }
}

async function startBackgroundResponse(input: {
  apiKey: string
  body: JsonRecord
  operation: 'editorial' | 'writer'
}) {
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
    console.error(`[tu.report-draft] OpenAI ${input.operation} start failed`, {
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

async function retrieveBackgroundResponse(input: { apiKey: string; responseId: string }) {
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
    console.error('[tu.report-draft] OpenAI status retrieval failed', { status: response.status })
    throw new Error(response.status === 404 ? 'OPENAI_RESPONSE_NOT_FOUND' : 'OPENAI_RETRIEVE_FAILED')
  }
  const payload = await response.json() as OpenAiResponse
  const envelope = normalizeTuReportProviderResponse(payload)
  if (envelope.responseId !== input.responseId) throw new Error('OPENAI_INVALID_RESPONSE')
  return { payload, envelope }
}

function publicRunFailureMessage(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  if (code === 'OPENAI_EMPTY_RESPONSE' || code === 'OPENAI_INCOMPLETE_REPORT_DRAFT') {
    return 'AI-svaret blev ofullständigt. Försök igen.'
  }
  if (code === 'OPENAI_RESPONSE_NOT_FOUND') {
    return 'AI-körningen kunde inte återupptas. Försök igen.'
  }
  if (code === 'OPENAI_REQUEST_TIMEOUT') {
    return 'AI-körningen kunde inte startas inom tidsgränsen. Försök igen.'
  }
  if (code === 'OPENAI_API_KEY_MISSING') {
    return 'AI-funktionen är inte tillgänglig just nu. Kontakta systemadministratören.'
  }
  if (code.startsWith('AI-')) return code
  return 'Utlåtandet kunde inte skapas just nu. Försök igen.'
}

async function failReportDraftRun(input: {
  runId: string
  error: unknown
  source: string
}) {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const message = publicRunFailureMessage(input.error)
  await admin.from('tu_ai_runs').update({
    status: 'failed',
    error_message: message,
    progress_stage: 'failed',
    progress_message: message,
    heartbeat_at: now,
    completed_at: now,
  }).eq('id', input.runId).in('status', ['queued', 'processing'])
  console.error(`[tu.report-draft] ${input.source}`, { runId: input.runId, error: input.error })
}

async function finalizeTuWholeReportDraft(input: {
  orgId: string
  inspectionId: string
  runId: string
  snapshot: JsonRecord
  editorialPlan: TuReportEditorialPlan
  generated: GeneratedReport
  progressTotal: number | null
}) {
  const admin = createSupabaseAdminClient()
  const { snapshot, editorialPlan, generated } = input
  try {
    const expectedSections = Array.isArray(snapshot.sections) ? snapshot.sections.map(record) : []
    const expectedIds = expectedSections.map((section) => cleanText(section.id)).filter(Boolean)
    const generatedIds = generated.sections.map((section) => section.sectionId)
    if (
      generated.sections.some((section) => !section.sectionId)
      || generatedIds.length !== expectedIds.length
      || new Set(generatedIds).size !== generatedIds.length
      || expectedIds.some((id) => !generatedIds.includes(id))
      || generatedIds.some((id) => !expectedIds.includes(id))
    ) {
      throw new Error('OPENAI_INCOMPLETE_REPORT_DRAFT')
    }

    const reportTemplate = record(snapshot.reportTemplate)
    const assignmentSectionId = expectedSections
      .find((section) => cleanText(section.key) === 'assignment_scope')
    const generatedSections = ensureTuPostDamageDisclaimer({
      templateKey: cleanText(reportTemplate.key),
      assignmentSectionId: assignmentSectionId ? cleanText(assignmentSectionId.id) : null,
      sections: generated.sections,
    })
    const validatedSections = validateTuReportSections({
      snapshot,
      expectedSectionIds: expectedIds,
      generatedSections,
    })
    const validatedById = new Map(
      validatedSections.map((section) => [section.sectionId, section])
    )
    const rows = expectedSections.map((section) => {
      const sectionId = cleanText(section.id)
      const validatedSection = validatedById.get(sectionId)
      if (!validatedSection) throw new Error('OPENAI_INCOMPLETE_REPORT_DRAFT')
      return {
        org_id: input.orgId,
        inspection_id: input.inspectionId,
        run_id: input.runId,
        target_section_id: sectionId,
        target_section_key: cleanText(section.key),
        target_section_title: cleanText(section.title),
        proposed_text: validatedSection.text,
        status: 'pending',
        source_observation_ids: validatedSection.sourceObservationIds,
        source_analysis_item_ids: validatedSection.sourceAnalysisItemIds,
        source_field_keys: validatedSection.sourceFieldKeys,
        warnings: validatedSection.warnings,
        grounding_status: validatedSection.groundingStatus,
        application_mode: null,
      }
    })

    const savingAt = new Date().toISOString()
    const { error: progressError } = await admin.from('tu_ai_runs').update({
      progress_stage: 'saving',
      progress_message: 'Sparar hela rapportutkastet för din granskning.',
      heartbeat_at: savingAt,
    }).eq('id', input.runId).eq('status', 'processing')
    if (progressError) throw new Error(progressError.message)
    const { error: deleteError } = await admin.from('tu_ai_suggestions')
      .delete()
      .eq('run_id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
    if (deleteError) throw new Error(deleteError.message)
    const { error: insertError } = await admin.from('tu_ai_suggestions').insert(rows)
    if (insertError) throw new Error(insertError.message)

    const completedAt = new Date().toISOString()
    const total = input.progressTotal ?? rows.length
    const blockedSectionCount = validatedSections
      .filter((section) => section.groundingStatus === 'blocked').length
    const needsSourceSectionCount = validatedSections
      .filter((section) => section.groundingStatus === 'needs_source').length
    const groundingWarnings = [
      blockedSectionCount > 0
        ? `${blockedSectionCount} rapportdelar innehöll AI-stycken som stoppades av källkontrollen.`
        : '',
      needsSourceSectionCount > 0
        ? `${needsSourceSectionCount} rapportdelar lämnades tomma eftersom verifierbart underlag saknas.`
        : '',
    ].filter(Boolean)
    const editorialWarnings = [
      ...editorialPlan.internalWarnings,
      ...editorialPlan.sections.flatMap((section) => section.internalWarnings),
    ]
    const { error: completeError } = await admin.from('tu_ai_runs').update({
      status: 'completed',
      output_payload: {
        overview: generated.overview,
        warnings: [...new Set([
          ...editorialWarnings,
          ...generated.warnings,
          ...groundingWarnings,
        ])],
        editorialFocus: editorialPlan.focus,
        scopeBoundary: editorialPlan.scopeBoundary,
        editorialPlan,
        sectionCount: rows.length,
        blockedSectionCount,
        needsSourceSectionCount,
      },
      completed_at: completedAt,
      error_message: null,
      progress_stage: 'completed',
      progress_current: total,
      progress_total: total,
      progress_message: blockedSectionCount || needsSourceSectionCount
        ? `Rapportutkastet är klart. ${blockedSectionCount + needsSourceSectionCount} rapportdelar behöver din kontroll.`
        : 'Hela rapportutkastet är klart för granskning.',
      heartbeat_at: completedAt,
    }).eq('id', input.runId).eq('status', 'processing')
    if (completeError) throw new Error(completeError.message)
  } catch (error) {
    await failReportDraftRun({ runId: input.runId, error, source: 'Report finalization failed' })
  }
}

async function savePendingProviderRun(input: {
  runId: string
  stage: 'editorial_pending' | 'writer_pending'
  envelope: { responseId: string }
  editorialPlan: TuReportEditorialPlan | null
}) {
  const admin = createSupabaseAdminClient()
  const now = new Date().toISOString()
  const isEditorial = input.stage === 'editorial_pending'
  const { error } = await admin.from('tu_ai_runs').update({
    status: 'processing',
    output_payload: tuReportBackgroundPayload({
      stage: input.stage,
      responseId: input.envelope.responseId,
      submittedAt: now,
      editorialPlan: input.editorialPlan,
      generatedReport: null,
    }),
    progress_stage: isEditorial ? 'preparing' : 'synthesizing',
    progress_message: isEditorial
      ? 'AI:n planerar rapportens innehåll och avgränsning.'
      : 'AI:n skriver rapportens delar som en sammanhängande helhet.',
    heartbeat_at: now,
  }).eq('id', input.runId).eq('status', 'processing')
  if (error) throw new Error(error.message)
}

export async function runTuWholeReportDraft(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    await failReportDraftRun({
      runId: input.runId,
      error: new Error('OPENAI_API_KEY_MISSING'),
      source: 'AI configuration missing',
    })
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
      progress_message: 'Förbereder nästa steg i rapportskrivningen.',
      heartbeat_at: startedAt,
    })
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'report_draft')
    .eq('status', 'queued')
    .select('id,input_snapshot,output_payload,attempt_count,progress_total')
    .maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return
  const run = claimed as {
    input_snapshot: unknown
    output_payload: unknown
    attempt_count: number | null
    progress_total: number | null
  }

  try {
    await admin.from('tu_ai_runs').update({
      attempt_count: (run.attempt_count ?? 0) + 1,
    }).eq('id', input.runId)
    const snapshot = record(run.input_snapshot)
    const workflow = parseTuReportBackgroundState(run.output_payload)

    if (!workflow) {
      const envelope = await startBackgroundResponse({
        apiKey,
        body: editorialRequestBody(snapshot),
        operation: 'editorial',
      })
      await savePendingProviderRun({
        runId: input.runId,
        stage: 'editorial_pending',
        envelope,
        editorialPlan: null,
      })
      return
    }

    if (workflow.stage === 'editorial_ready') {
      const editorialPlan = parseTuReportEditorialPlan({
        value: workflow.editorialPlan,
        snapshot,
      })
      const writerSnapshot = buildTuReportWriterSnapshot({ snapshot, plan: editorialPlan })
      const envelope = await startBackgroundResponse({
        apiKey,
        body: reportRequestBody(writerSnapshot),
        operation: 'writer',
      })
      await savePendingProviderRun({
        runId: input.runId,
        stage: 'writer_pending',
        envelope,
        editorialPlan,
      })
      return
    }

    if (workflow.stage === 'writer_ready') {
      const editorialPlan = parseTuReportEditorialPlan({
        value: workflow.editorialPlan,
        snapshot,
      })
      const generated = workflow.generatedReport as GeneratedReport
      await finalizeTuWholeReportDraft({
        ...input,
        snapshot,
        editorialPlan,
        generated,
        progressTotal: run.progress_total,
      })
      return
    }

    throw new Error('TU_REPORT_DRAFT_INVALID_BACKGROUND_STATE')
  } catch (error) {
    await failReportDraftRun({ runId: input.runId, error, source: 'Background stage start failed' })
  }
}

function pendingProgressMessage(workflow: TuReportBackgroundState) {
  return workflow.stage === 'editorial_pending'
    ? 'AI:n planerar rapportens innehåll och avgränsning.'
    : 'AI:n skriver rapportens delar som en sammanhängande helhet.'
}

export async function pollTuWholeReportDraft(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.from('tu_ai_runs')
    .select('id,status,input_snapshot,output_payload,heartbeat_at')
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'report_draft')
    .eq('status', 'processing')
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return

  const workflow = parseTuReportBackgroundState((data as { output_payload: unknown }).output_payload)
  const expectedHeartbeat = cleanText((data as { heartbeat_at?: unknown }).heartbeat_at)
  if (
    !workflow
    || (workflow.stage !== 'editorial_pending' && workflow.stage !== 'writer_pending')
    || !workflow.responseId
    || !workflow.submittedAt
  ) return

  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) {
    await failReportDraftRun({
      runId: input.runId,
      error: new Error('OPENAI_API_KEY_MISSING'),
      source: 'AI configuration missing while polling',
    })
    return
  }
  if (Date.now() - Date.parse(workflow.submittedAt) > PROVIDER_MAX_JOB_AGE_MS) {
    await failReportDraftRun({
      runId: input.runId,
      error: new Error('AI-körningen tog för lång tid. Försök igen.'),
      source: 'Provider deadline exceeded',
    })
    return
  }

  let provider: Awaited<ReturnType<typeof retrieveBackgroundResponse>>
  try {
    provider = await retrieveBackgroundResponse({ apiKey, responseId: workflow.responseId })
  } catch (pollError) {
    if (pollError instanceof Error && pollError.message === 'OPENAI_RESPONSE_NOT_FOUND') {
      await failReportDraftRun({ runId: input.runId, error: pollError, source: 'Provider response missing' })
      return
    }
    console.error('[tu.report-draft] Provider status temporarily unavailable', {
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
      progress_message: pendingProgressMessage(workflow),
      heartbeat_at: new Date().toISOString(),
    }).eq('id', input.runId).eq('status', 'processing')
    return
  }
  if (
    provider.envelope.status === 'failed'
    || provider.envelope.status === 'incomplete'
    || provider.envelope.status === 'cancelled'
  ) {
    await failReportDraftRun({
      runId: input.runId,
      error: new Error(tuReportProviderFailureMessage(provider.payload)),
      source: `Provider ended with ${provider.envelope.status}`,
    })
    return
  }

  try {
    const snapshot = record((data as { input_snapshot: unknown }).input_snapshot)
    const now = new Date().toISOString()
    if (workflow.stage === 'editorial_pending') {
      const editorialPlan = parseEditorialPlan(provider.payload, snapshot)
      const { data: readyData, error: readyError } = await admin.from('tu_ai_runs').update({
        status: 'queued',
        output_payload: tuReportBackgroundPayload({
          stage: 'editorial_ready',
          responseId: null,
          submittedAt: null,
          editorialPlan,
          generatedReport: null,
        }),
        progress_stage: 'queued',
        progress_message: 'Dispositionen är klar. Rapporttexten förbereds.',
        heartbeat_at: now,
      })
        .eq('id', input.runId)
        .eq('status', 'processing')
        .eq('heartbeat_at', expectedHeartbeat)
        .select('id')
        .maybeSingle()
      if (readyError) throw new Error(readyError.message)
      if (!readyData) return
      await runTuWholeReportDraft(input)
      return
    }

    const generated = parseGeneratedReport(provider.payload)
    const { data: readyData, error: readyError } = await admin.from('tu_ai_runs').update({
      status: 'queued',
      output_payload: tuReportBackgroundPayload({
        stage: 'writer_ready',
        responseId: null,
        submittedAt: null,
        editorialPlan: workflow.editorialPlan,
        generatedReport: generated,
      }),
      progress_stage: 'queued',
      progress_message: 'Rapporttexten är klar och kvalitetskontrolleras.',
      heartbeat_at: now,
    })
      .eq('id', input.runId)
      .eq('status', 'processing')
      .eq('heartbeat_at', expectedHeartbeat)
      .select('id')
      .maybeSingle()
    if (readyError) throw new Error(readyError.message)
    if (!readyData) return
    await runTuWholeReportDraft(input)
  } catch (parseError) {
    await failReportDraftRun({ runId: input.runId, error: parseError, source: 'Provider result parsing failed' })
  }
}

export async function advanceTuWholeReportDraft(input: {
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
    .eq('operation', 'report_draft')
    .maybeSingle()
  if (error) throw new Error(error.message)
  const status = cleanText((data as { status?: unknown } | null)?.status)
  if (status === 'queued') return runTuWholeReportDraft(input)
  if (status === 'processing') return pollTuWholeReportDraft(input)
}
