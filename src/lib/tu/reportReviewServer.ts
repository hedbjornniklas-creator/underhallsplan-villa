import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { TuGeneratedGroundedSection } from '@/lib/tu/grounding'
import { validateTuReportSections } from '@/lib/tu/reportGroundingServer'
import {
  type TuReportReviewInstruction,
  type TuReportReviewSection,
  type TuReportReviewState,
  type TuReportReviewStatus,
} from '@/lib/tu/reportReview'
import { buildTuReportSnapshot } from '@/lib/tu/reportDraftServer'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_REPORT_REVIEW_MODEL = process.env.OPENAI_TU_REPORT_MODEL?.trim() || 'gpt-5.6'
const RULESET_KEY = 'tu_report_review_v1'
const RULESET_VERSION = 1

type JsonRecord = Record<string, unknown>

type ReviewRow = {
  id: string
  scope: string
  target_section_id: string | null
  target_section_title: string | null
  instruction: string
  status: string
  result_run_id: string | null
  impact_summary: string | null
  affected_section_ids: unknown
  before_sections: unknown
  after_sections: unknown
  warnings: unknown
  error_message: string | null
  created_at: string | null
  applied_at: string | null
  reverted_at: string | null
}

type RunRow = {
  id: string
  status: string
  progress_message: string | null
  error_message: string | null
}

type SuggestionRow = {
  id: string
  target_section_id: string
  target_section_key: string
  target_section_title: string
  proposed_text: string
  source_observation_ids: unknown
  source_analysis_item_ids: unknown
  source_field_keys: unknown
  warnings: unknown
  grounding_status: string | null
}

type OpenAiResponse = {
  output_text?: string
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}

type GeneratedReviewSection = TuGeneratedGroundedSection & {
  changeReason: string
}

type GeneratedReview = {
  impactSummary: string
  warnings: string[]
  sections: GeneratedReviewSection[]
}

const REVIEW_COLUMNS = [
  'id',
  'scope',
  'target_section_id',
  'target_section_title',
  'instruction',
  'status',
  'result_run_id',
  'impact_summary',
  'affected_section_ids',
  'before_sections',
  'after_sections',
  'warnings',
  'error_message',
  'created_at',
  'applied_at',
  'reverted_at',
].join(',')

const SUGGESTION_COLUMNS = [
  'id',
  'target_section_id',
  'target_section_key',
  'target_section_title',
  'proposed_text',
  'source_observation_ids',
  'source_analysis_item_ids',
  'source_field_keys',
  'warnings',
  'grounding_status',
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

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function reviewStatus(value: unknown): TuReportReviewStatus {
  if (
    value === 'queued'
    || value === 'processing'
    || value === 'completed'
    || value === 'applied'
    || value === 'rejected'
    || value === 'failed'
    || value === 'reverted'
  ) return value
  return 'failed'
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

function parseGeneratedReview(payload: OpenAiResponse): GeneratedReview {
  const text = responseText(payload)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  const parsed = record(JSON.parse(text))
  const sections = records(parsed.affectedSections).map((section) => ({
    sectionId: cleanText(section.sectionId),
    changeReason: cleanText(section.changeReason),
    paragraphs: records(section.paragraphs)
      .map((paragraph) => ({
        text: cleanText(paragraph.text),
        sourceAnalysisItemIds: stringArray(paragraph.sourceAnalysisItemIds),
        sourceObservationIds: stringArray(paragraph.sourceObservationIds),
        sourceFieldKeys: stringArray(paragraph.sourceFieldKeys),
        warnings: stringArray(paragraph.warnings),
      }))
      .filter((paragraph) => paragraph.text),
    warnings: stringArray(section.warnings),
  })).filter((section) => section.sectionId)
  return {
    impactSummary: cleanText(parsed.impactSummary),
    warnings: stringArray(parsed.warnings),
    sections,
  }
}

async function generateReview(input: { apiKey: string; snapshot: JsonRecord }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TU_REPORT_REVIEW_MODEL,
      store: false,
      reasoning: { effort: 'high' },
      instructions: [
        'Du reviderar ett svenskt tekniskt utlåtande efter en uttrycklig instruktion från ansvarig besiktningsman.',
        'Instruktionen är ett auktoritativt granskningsbeslut men ändrar inte det ursprungliga fältunderlaget.',
        'Ställ inga frågor. Om underlaget inte räcker ska du använda en saklig reservation eller lämna en varning.',
        'Läs alltid samtliga rapportdelar och kontrollera följdverkningar, motsägelser, terminologi, slutsatser, rekommendationer och upprepningar.',
        'Ändra endast de rapportdelar som faktiskt påverkas. Returnera inga oförändrade rapportdelar.',
        'Vid en sektionsinstruktion måste målsektionen ingå bland affectedSections.',
        'Vid en terminologiändring ska samma olämpliga uttryck kontrolleras i hela utlåtandet.',
        'Vid en ändrad teknisk bedömning ska även sammanfattning, riskbedömning, slutsats och rekommendation kontrolleras där de finns.',
        'Använd endast fältunderlag, godkänd analys, registrerade uppgifter och reviewInstruction i JSON-underlaget.',
        'Hitta aldrig på observationer, mätvärden, metoder, orsaker, ansvar, fel eller utförda kontroller.',
        'Varje stycke måste ange minst en verklig källa via sourceAnalysisItemIds, sourceObservationIds eller sourceFieldKeys.',
        'Granskarens instruktion finns som en sourceField och får användas som källa för granskarens aktuella bedömning eller språkbeslut.',
        'Skriv inte rubriken i texten. Skriv sakligt, sammanhållet och proportionerligt på svenska utan utfyllnad.',
        'Returnera en kort impactSummary som beskriver vilka delar som behöver ändras och varför.',
      ].join('\n'),
      input: JSON.stringify(input.snapshot, null, 2),
      text: {
        format: {
          type: 'json_schema',
          name: 'tu_report_holistic_review',
          strict: true,
          schema: {
            type: 'object',
            properties: {
              impactSummary: { type: 'string' },
              warnings: { type: 'array', items: { type: 'string' } },
              affectedSections: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    sectionId: { type: 'string' },
                    changeReason: { type: 'string' },
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
                  required: ['sectionId', 'changeReason', 'paragraphs', 'warnings'],
                  additionalProperties: false,
                },
              },
            },
            required: ['impactSummary', 'warnings', 'affectedSections'],
            additionalProperties: false,
          },
        },
      },
      max_output_tokens: 16000,
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    console.error('[tu.report-review] OpenAI request failed', {
      status: response.status,
      detail: detail.slice(0, 800),
    })
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}`)
  }
  return parseGeneratedReview(await response.json() as OpenAiResponse)
}

function sectionSnapshot(value: unknown) {
  return records(value).map((section) => ({
    sectionId: cleanText(section.sectionId),
    sectionKey: cleanText(section.sectionKey),
    sectionTitle: cleanText(section.sectionTitle),
    text: cleanText(section.text),
    changeReason: cleanText(section.changeReason),
  })).filter((section) => section.sectionId)
}

function mapReview(input: {
  row: ReviewRow
  run: RunRow | null
  suggestions: SuggestionRow[]
}): TuReportReviewInstruction {
  const beforeById = new Map(
    sectionSnapshot(input.row.before_sections).map((section) => [section.sectionId, section])
  )
  const afterById = new Map(
    sectionSnapshot(input.row.after_sections).map((section) => [section.sectionId, section])
  )
  const sections: TuReportReviewSection[] = input.suggestions.map((suggestion) => {
    const before = beforeById.get(suggestion.target_section_id)
    const after = afterById.get(suggestion.target_section_id)
    const groundingStatus = suggestion.grounding_status === 'grounded'
      || suggestion.grounding_status === 'needs_source'
      || suggestion.grounding_status === 'blocked'
      || suggestion.grounding_status === 'manually_edited'
      ? suggestion.grounding_status
      : 'blocked'
    return {
      sectionId: suggestion.target_section_id,
      sectionKey: suggestion.target_section_key,
      sectionTitle: suggestion.target_section_title,
      beforeText: before?.text ?? '',
      proposedText: suggestion.proposed_text,
      changeReason: after?.changeReason ?? '',
      sourceObservationIds: stringArray(suggestion.source_observation_ids),
      sourceAnalysisItemIds: stringArray(suggestion.source_analysis_item_ids),
      sourceFieldKeys: stringArray(suggestion.source_field_keys),
      warnings: stringArray(suggestion.warnings),
      groundingStatus,
    }
  })
  return {
    id: input.row.id,
    scope: input.row.scope === 'report' ? 'report' : 'section',
    targetSectionId: input.row.target_section_id,
    targetSectionTitle: input.row.target_section_title,
    instruction: input.row.instruction,
    status: reviewStatus(input.row.status),
    impactSummary: input.row.impact_summary,
    warnings: stringArray(input.row.warnings),
    errorMessage: input.row.error_message ?? input.run?.error_message ?? null,
    progressMessage: input.run?.progress_message ?? null,
    sections,
    createdAt: input.row.created_at ?? new Date().toISOString(),
    appliedAt: input.row.applied_at,
    revertedAt: input.row.reverted_at,
  }
}

export async function getTuReportReviewState(input: {
  orgId: string
  inspectionId: string
}): Promise<TuReportReviewState> {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('tu_report_review_instructions')
    .select(REVIEW_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as unknown as ReviewRow[]
  const currentRow = rows[0] ?? null
  const latestAppliedRow = rows.find((row) => row.status === 'applied') ?? null
  const selectedRows = [currentRow, latestAppliedRow].filter((row): row is ReviewRow => Boolean(row))
  const runIds = [...new Set(selectedRows.map((row) => row.result_run_id).filter((id): id is string => Boolean(id)))]
  const [{ data: runData, error: runError }, { data: suggestionData, error: suggestionError }] = await Promise.all([
    runIds.length > 0
      ? admin.from('tu_ai_runs').select('id,status,progress_message,error_message').in('id', runIds)
      : Promise.resolve({ data: [], error: null }),
    runIds.length > 0
      ? admin.from('tu_ai_suggestions').select(`${SUGGESTION_COLUMNS},run_id`).in('run_id', runIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (runError) throw new Error(runError.message)
  if (suggestionError) throw new Error(suggestionError.message)
  const runs = new Map(((runData ?? []) as unknown as RunRow[]).map((run) => [run.id, run]))
  const suggestions = (suggestionData ?? []) as unknown as Array<SuggestionRow & { run_id: string }>
  const mapRow = (row: ReviewRow | null) => row
    ? mapReview({
        row,
        run: row.result_run_id ? runs.get(row.result_run_id) ?? null : null,
        suggestions: row.result_run_id
          ? suggestions.filter((suggestion) => suggestion.run_id === row.result_run_id)
          : [],
      })
    : null
  return {
    current: mapRow(currentRow),
    latestApplied: mapRow(latestAppliedRow),
  }
}

export async function createTuReportReviewRun(input: {
  orgId: string
  inspectionId: string
  userId: string
  scope: 'section' | 'report'
  targetSectionId: string | null
  instruction: string
}) {
  const admin = createSupabaseAdminClient()
  const { data: active, error: activeError } = await admin
    .from('tu_report_review_instructions')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .in('status', ['queued', 'processing'])
    .maybeSingle()
  if (activeError) throw new Error(activeError.message)
  if (active) throw new Error('TU_REPORT_REVIEW_BUSY')

  const { snapshot: baseSnapshot } = await buildTuReportSnapshot(input)
  const snapshot = record(baseSnapshot)
  const sections = records(snapshot.sections)
  const target = input.targetSectionId
    ? sections.find((section) => cleanText(section.id) === input.targetSectionId)
    : null
  if (input.scope === 'section' && !target) throw new Error('TU_REPORT_SECTION_NOT_FOUND')

  const beforeSections = sections.map((section) => ({
    sectionId: cleanText(section.id),
    sectionKey: cleanText(section.key),
    sectionTitle: cleanText(section.title),
    text: cleanText(section.currentText),
  }))
  const { data: baseRun } = await admin
    .from('tu_ai_runs')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'report_draft')
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: reviewData, error: reviewError } = await admin
    .from('tu_report_review_instructions')
    .insert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      base_run_id: (baseRun as { id?: string } | null)?.id ?? null,
      scope: input.scope,
      target_section_id: input.scope === 'section' ? input.targetSectionId : null,
      target_section_title: input.scope === 'section' ? cleanText(target?.title) : null,
      instruction: input.instruction,
      status: 'queued',
      before_sections: beforeSections,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (reviewError || !reviewData) throw new Error(reviewError?.message ?? 'TU_REPORT_REVIEW_CREATE_FAILED')
  const reviewId = String((reviewData as { id: string }).id)
  const instructionFieldKey = `reviewInstruction.${reviewId}`
  const sourceFields = records(snapshot.sourceFields)
  const reviewSnapshot = {
    ...snapshot,
    sourceFields: [
      ...sourceFields,
      {
        key: instructionFieldKey,
        label: 'Ansvarig besiktningsmans granskningsinstruktion',
        value: input.instruction,
      },
    ],
    reviewInstruction: {
      id: reviewId,
      sourceFieldKey: instructionFieldKey,
      scope: input.scope,
      targetSectionId: input.scope === 'section' ? input.targetSectionId : null,
      targetSectionTitle: input.scope === 'section' ? cleanText(target?.title) : null,
      instruction: input.instruction,
    },
  }
  const inputHash = createHash('sha256').update(JSON.stringify(reviewSnapshot)).digest('hex')
  const now = new Date().toISOString()
  const { data: runData, error: runError } = await admin
    .from('tu_ai_runs')
    .insert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      operation: 'report_review',
      status: 'queued',
      model: TU_REPORT_REVIEW_MODEL,
      ruleset_key: RULESET_KEY,
      ruleset_version: RULESET_VERSION,
      target_section_id: input.scope === 'section' ? input.targetSectionId : null,
      input_snapshot: reviewSnapshot,
      input_hash: inputHash,
      attempt_count: 0,
      progress_stage: 'queued',
      progress_current: 0,
      progress_total: sections.length,
      progress_message: 'Instruktionen väntar på helhetsgranskning.',
      heartbeat_at: now,
      created_by: input.userId,
    })
    .select('id')
    .single()
  if (runError || !runData) {
    await admin.from('tu_report_review_instructions').update({
      status: 'failed',
      error_message: runError?.message ?? 'TU_REPORT_REVIEW_RUN_CREATE_FAILED',
    }).eq('id', reviewId)
    throw new Error(runError?.message ?? 'TU_REPORT_REVIEW_RUN_CREATE_FAILED')
  }
  const runId = String((runData as { id: string }).id)
  const { error: linkError } = await admin
    .from('tu_report_review_instructions')
    .update({ result_run_id: runId })
    .eq('id', reviewId)
  if (linkError) throw new Error(linkError.message)
  return { reviewId, runId }
}

export async function runTuReportReview(input: {
  orgId: string
  inspectionId: string
  reviewId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const apiKey = process.env.OPENAI_API_KEY
  const startedAt = new Date().toISOString()
  if (!apiKey) {
    await Promise.all([
      admin.from('tu_ai_runs').update({
        status: 'failed',
        error_message: 'OPENAI_API_KEY_MISSING',
        progress_stage: 'failed',
        progress_message: 'AI-konfigurationen saknas.',
        completed_at: startedAt,
      }).eq('id', input.runId),
      admin.from('tu_report_review_instructions').update({
        status: 'failed',
        error_message: 'OPENAI_API_KEY_MISSING',
      }).eq('id', input.reviewId),
    ])
    return
  }

  const [{ data: claimedRun, error: runError }, { data: claimedReview, error: reviewError }] = await Promise.all([
    admin.from('tu_ai_runs').update({
      status: 'processing',
      started_at: startedAt,
      progress_stage: 'synthesizing',
      progress_message: 'Granskar instruktionen mot hela utlåtandet.',
      heartbeat_at: startedAt,
    })
      .eq('id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .eq('operation', 'report_review')
      .eq('status', 'queued')
      .select('id,input_snapshot,attempt_count,progress_total')
      .maybeSingle(),
    admin.from('tu_report_review_instructions').update({ status: 'processing' })
      .eq('id', input.reviewId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
      .eq('status', 'queued')
      .select('id,scope,target_section_id')
      .maybeSingle(),
  ])
  if (runError) throw new Error(runError.message)
  if (reviewError) throw new Error(reviewError.message)
  if (!claimedRun || !claimedReview) return
  const run = claimedRun as {
    input_snapshot: unknown
    attempt_count: number | null
    progress_total: number | null
  }
  const review = claimedReview as { scope: string; target_section_id: string | null }

  try {
    await admin.from('tu_ai_runs').update({
      attempt_count: (run.attempt_count ?? 0) + 1,
    }).eq('id', input.runId)
    const snapshot = record(run.input_snapshot)
    const generated = await generateReview({ apiKey, snapshot })
    const reportSections = records(snapshot.sections)
    const sectionById = new Map(reportSections.map((section) => [cleanText(section.id), section]))
    const generatedIds = generated.sections.map((section) => section.sectionId)
    if (
      new Set(generatedIds).size !== generatedIds.length
      || generatedIds.some((id) => !sectionById.has(id))
      || (review.scope === 'section' && !generatedIds.includes(review.target_section_id ?? ''))
    ) throw new Error('OPENAI_INVALID_REPORT_REVIEW')

    const validatedSections = validateTuReportSections({
      snapshot,
      expectedSectionIds: generatedIds,
      generatedSections: generated.sections,
    })
    const validatedById = new Map(validatedSections.map((section) => [section.sectionId, section]))
    const generatedById = new Map(generated.sections.map((section) => [section.sectionId, section]))
    const rows = generatedIds.map((sectionId) => {
      const section = sectionById.get(sectionId)
      const validated = validatedById.get(sectionId)
      if (!section || !validated) throw new Error('OPENAI_INVALID_REPORT_REVIEW')
      return {
        org_id: input.orgId,
        inspection_id: input.inspectionId,
        run_id: input.runId,
        target_section_id: sectionId,
        target_section_key: cleanText(section.key),
        target_section_title: cleanText(section.title),
        proposed_text: validated.text,
        status: 'pending',
        source_observation_ids: validated.sourceObservationIds,
        source_analysis_item_ids: validated.sourceAnalysisItemIds,
        source_field_keys: validated.sourceFieldKeys,
        warnings: validated.warnings,
        grounding_status: validated.groundingStatus,
        application_mode: null,
      }
    })
    const afterSections = rows.map((row) => ({
      sectionId: row.target_section_id,
      sectionKey: row.target_section_key,
      sectionTitle: row.target_section_title,
      text: row.proposed_text,
      changeReason: generatedById.get(row.target_section_id)?.changeReason ?? '',
    }))
    const combinedWarnings = [
      ...generated.warnings,
      ...validatedSections.flatMap((section) => section.warnings),
    ].filter(Boolean)

    const { error: insertError } = await admin.from('tu_ai_suggestions').insert(rows)
    if (insertError) throw new Error(insertError.message)
    const completedAt = new Date().toISOString()
    const blockedCount = validatedSections.filter((section) => (
      section.groundingStatus === 'blocked' || section.groundingStatus === 'needs_source'
    )).length
    const progressMessage = blockedCount > 0
      ? `Helhetsgranskningen är klar. ${blockedCount} ändringar behöver källkontroll.`
      : `Helhetsgranskningen är klar. ${rows.length} rapportdelar påverkas.`
    const [{ error: completeRunError }, { error: completeReviewError }] = await Promise.all([
      admin.from('tu_ai_runs').update({
        status: 'completed',
        output_payload: {
          impactSummary: generated.impactSummary,
          warnings: [...new Set(combinedWarnings)],
          affectedSectionIds: generatedIds,
          reviewInstructionId: input.reviewId,
        },
        completed_at: completedAt,
        progress_stage: 'completed',
        progress_current: run.progress_total ?? reportSections.length,
        progress_message: progressMessage,
        heartbeat_at: completedAt,
        error_message: null,
      }).eq('id', input.runId).eq('status', 'processing'),
      admin.from('tu_report_review_instructions').update({
        status: 'completed',
        impact_summary: generated.impactSummary,
        affected_section_ids: generatedIds,
        after_sections: afterSections,
        warnings: [...new Set(combinedWarnings)],
        error_message: null,
      }).eq('id', input.reviewId).eq('status', 'processing'),
    ])
    if (completeRunError) throw new Error(completeRunError.message)
    if (completeReviewError) throw new Error(completeReviewError.message)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1200) : 'TU_REPORT_REVIEW_FAILED'
    const now = new Date().toISOString()
    await Promise.all([
      admin.from('tu_ai_runs').update({
        status: 'failed',
        error_message: message,
        progress_stage: 'failed',
        progress_message: 'Utlåtandet kunde inte omarbetas. Försök igen.',
        heartbeat_at: now,
        completed_at: now,
      }).eq('id', input.runId).in('status', ['queued', 'processing']),
      admin.from('tu_report_review_instructions').update({
        status: 'failed',
        error_message: message,
      }).eq('id', input.reviewId).in('status', ['queued', 'processing']),
    ])
    console.error('[tu.report-review] Review failed', {
      inspectionId: input.inspectionId,
      reviewId: input.reviewId,
      runId: input.runId,
      error,
    })
  }
}
