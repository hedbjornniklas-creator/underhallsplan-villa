import 'server-only'

import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  isTuAnalysisProgressStage,
  isTuAnalysisRunStatus,
} from '@/lib/tu/analysis'
import { TU_MOISTURE_DAMAGE_TEMPLATE_KEY } from '@/lib/tu/evidence'
import type {
  TuWholeReportDraftRun,
  TuWholeReportDraftSection,
  TuWholeReportDraftState,
} from '@/lib/tu/reportDraft'
import { getTuInvestigationById } from '@/lib/tu/server'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_REPORT_MODEL =
  process.env.OPENAI_TU_REPORT_MODEL?.trim()
  || process.env.OPENAI_TU_TEXT_MODEL?.trim()
  || 'gpt-4o-mini'
const RULESET_KEY = 'tu_moisture_report_v1'
const RULESET_VERSION = 1
const STALE_RUN_MINUTES = 12
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
  warnings: unknown
  application_mode: string | null
  created_at: string | null
  updated_at: string | null
}

type OpenAiResponse = {
  output_text?: string
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
}

type GeneratedSection = {
  sectionId: string
  text: string
  sourceAnalysisItemIds: string[]
  sourceObservationIds: string[]
  warnings: string[]
}

type GeneratedReport = {
  overview: string
  warnings: string[]
  sections: GeneratedSection[]
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
  'warnings',
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
    warnings: stringArray(row.warnings),
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

async function buildReportSnapshot(input: { orgId: string; inspectionId: string }) {
  const investigation = await getTuInvestigationById(input)
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
  if (investigation.reportTemplateKey !== TU_MOISTURE_DAMAGE_TEMPLATE_KEY) {
    throw new Error('TU_REPORT_DRAFT_TEMPLATE_NOT_SUPPORTED')
  }

  const sections = investigation.reportDraft.sections
    .filter((section) => !NON_EDITABLE_SECTION_KEYS.has(section.key))
    .map((section, index) => ({
      id: section.id || section.key,
      key: section.key,
      title: section.title,
      currentText: section.text,
      aiInstruction: section.aiInstruction ?? null,
      order: index + 1,
    }))
  if (sections.length === 0) throw new Error('TU_REPORT_DRAFT_NO_SECTIONS')

  const admin = createSupabaseAdminClient()
  const { data: workflowData, error: workflowError } = await admin
    .from('tu_analysis_workflows')
    .select('status,current_analysis_run_id,analysis_approved_at')
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()
  if (workflowError) throw new Error(workflowError.message)
  const workflow = workflowData as {
    status?: string
    current_analysis_run_id?: string | null
    analysis_approved_at?: string | null
  } | null
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
          'source_observation_ids',
          'source_image_ids',
          'source_measurement_ids',
          'supporting_reasons',
          'contradicting_reasons',
          'warnings',
          'sort_order',
        ].join(','))
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .eq('run_id', workflow.current_analysis_run_id)
        .eq('review_status', 'accepted')
        .eq('include_in_report', true)
        .order('sort_order', { ascending: true }),
    ])
  if (analysisRunError) throw new Error(analysisRunError.message)
  if (itemsError) throw new Error(itemsError.message)
  if (!analysisRun) throw new Error('TU_ANALYSIS_NOT_APPROVED')
  if (!analysisItems?.length) throw new Error('TU_ANALYSIS_HAS_NO_ACCEPTED_ITEMS')

  const analysisOutput = record((analysisRun as { output_payload?: unknown }).output_payload)
  return {
    sectionCount: sections.length,
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
      sections,
      approvedAnalysis: {
        runId: workflow.current_analysis_run_id,
        approvedAt: workflow.analysis_approved_at,
        overview: cleanText(analysisOutput.overview),
        warnings: stringArray(analysisOutput.warnings),
        items: analysisItems,
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
  const { snapshot, sectionCount } = await buildReportSnapshot(input)
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
  const parsed = JSON.parse(text) as JsonRecord
  const sections = Array.isArray(parsed.sections)
    ? parsed.sections.map(record).map((section) => ({
        sectionId: cleanText(section.sectionId),
        text: cleanText(section.text),
        sourceAnalysisItemIds: stringArray(section.sourceAnalysisItemIds),
        sourceObservationIds: stringArray(section.sourceObservationIds),
        warnings: stringArray(section.warnings),
      }))
    : []
  return {
    overview: cleanText(parsed.overview),
    warnings: stringArray(parsed.warnings),
    sections,
  }
}

async function generateReport(input: { apiKey: string; snapshot: JsonRecord }) {
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: TU_REPORT_MODEL,
      store: false,
      instructions: [
        'Du skriver ett komplett, sammanhållet och granskningsbart utkast till en svensk fuktskadeutredning.',
        'Skriv samtliga angivna rapportdelar i en gemensam disposition så att resonemanget hänger ihop och onödiga upprepningar undviks.',
        'Använd endast uppgifter i JSON-underlaget. Hitta aldrig på observationer, mätvärden, datum, orsaker, ansvar eller utförda kontroller.',
        'Skilj tydligt mellan verifierade iakttagelser, uppgifter från part, tekniska bedömningar, hypoteser och sådant som inte kunnat fastställas.',
        'Formulera osäkerheter och begränsningar uttryckligen. Utse inte juridiskt ansvarig part och lämna inga juridiska slutsatser.',
        'Fakta redovisas primärt i en rapportdel. En sammanfattning får återge slutsatser kort men inte kopiera hela stycken.',
        'Iakttagelser beskriver vad som konstaterats. Teknisk bedömning förklarar betydelsen. Rekommendationer beskriver nästa kontroll eller åtgärdsinriktning.',
        'Bevara relevanta befintliga texter men redigera dem till en konsekvent helhet och ta bort dubbleringar.',
        'Följ varje rapportsdels aiInstruction. Skriv inte rubriken i texten eftersom gränssnittet lägger till den.',
        'Returnera varje sectionId exakt en gång och i samma ordning som underlaget. Ingen rapportdel får utelämnas.',
        'sourceAnalysisItemIds och sourceObservationIds får bara innehålla id:n som finns i underlaget.',
        'Skriv sakligt, precist och proportionerligt på svenska. Textens omfattning ska motiveras av underlaget, inte av utfyllnad.',
      ].join('\n'),
      input: JSON.stringify(input.snapshot, null, 2),
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
                    text: { type: 'string' },
                    sourceAnalysisItemIds: { type: 'array', items: { type: 'string' } },
                    sourceObservationIds: { type: 'array', items: { type: 'string' } },
                    warnings: { type: 'array', items: { type: 'string' } },
                  },
                  required: [
                    'sectionId',
                    'text',
                    'sourceAnalysisItemIds',
                    'sourceObservationIds',
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
      max_output_tokens: 16000,
    }),
  })
  if (!response.ok) {
    const detail = await response.text()
    console.error('[tu.report-draft] OpenAI request failed', {
      status: response.status,
      detail: detail.slice(0, 800),
    })
    throw new Error(`OPENAI_REQUEST_FAILED:${response.status}`)
  }
  return parseGeneratedReport(await response.json() as OpenAiResponse)
}

export async function runTuWholeReportDraft(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  const admin = createSupabaseAdminClient()
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    const now = new Date().toISOString()
    await admin.from('tu_ai_runs').update({
      status: 'failed',
      error_message: 'OPENAI_API_KEY_MISSING',
      progress_stage: 'failed',
      progress_message: 'Rapportutkastet kunde inte starta eftersom AI-konfigurationen saknas.',
      heartbeat_at: now,
      completed_at: now,
    }).eq('id', input.runId).in('status', ['queued', 'processing'])
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
      progress_message: 'Förbereder godkänd analys och rapportens disposition.',
      heartbeat_at: startedAt,
    })
    .eq('id', input.runId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .eq('operation', 'report_draft')
    .eq('status', 'queued')
    .select('id,input_snapshot,attempt_count,progress_total')
    .maybeSingle()
  if (claimError) throw new Error(claimError.message)
  if (!claimed) return
  const run = claimed as {
    input_snapshot: unknown
    attempt_count: number | null
    progress_total: number | null
  }

  const updateProgress = async (stage: 'synthesizing' | 'saving', message: string) => {
    const { error } = await admin.from('tu_ai_runs').update({
      progress_stage: stage,
      progress_message: message,
      heartbeat_at: new Date().toISOString(),
    }).eq('id', input.runId).eq('status', 'processing')
    if (error) throw new Error(error.message)
  }

  try {
    await admin.from('tu_ai_runs').update({
      attempt_count: (run.attempt_count ?? 0) + 1,
    }).eq('id', input.runId)
    await updateProgress('synthesizing', 'Skriver alla rapportdelar som en sammanhållen helhet.')
    const snapshot = record(run.input_snapshot)
    const generated = await generateReport({ apiKey, snapshot })
    const expectedSections = Array.isArray(snapshot.sections) ? snapshot.sections.map(record) : []
    const expectedIds = expectedSections.map((section) => cleanText(section.id)).filter(Boolean)
    const generatedIds = generated.sections.map((section) => section.sectionId)
    if (
      generated.sections.some((section) => !section.sectionId || !section.text)
      || generatedIds.length !== expectedIds.length
      || new Set(generatedIds).size !== generatedIds.length
      || expectedIds.some((id) => !generatedIds.includes(id))
      || generatedIds.some((id) => !expectedIds.includes(id))
    ) {
      throw new Error('OPENAI_INCOMPLETE_REPORT_DRAFT')
    }

    const approvedAnalysis = record(snapshot.approvedAnalysis)
    const analysisItems = Array.isArray(approvedAnalysis.items)
      ? approvedAnalysis.items.map(record)
      : []
    const validAnalysisIds = new Set(analysisItems.map((item) => cleanText(item.id)).filter(Boolean))
    const validObservationIds = new Set(
      analysisItems.flatMap((item) => stringArray(item.source_observation_ids))
    )
    const generatedById = new Map(generated.sections.map((section) => [section.sectionId, section]))
    const rows = expectedSections.map((section) => {
      const sectionId = cleanText(section.id)
      const generatedSection = generatedById.get(sectionId)
      if (!generatedSection) throw new Error('OPENAI_INCOMPLETE_REPORT_DRAFT')
      return {
        org_id: input.orgId,
        inspection_id: input.inspectionId,
        run_id: input.runId,
        target_section_id: sectionId,
        target_section_key: cleanText(section.key),
        target_section_title: cleanText(section.title),
        proposed_text: generatedSection.text,
        status: 'pending',
        source_observation_ids: generatedSection.sourceObservationIds.filter((id) => validObservationIds.has(id)),
        source_analysis_item_ids: generatedSection.sourceAnalysisItemIds.filter((id) => validAnalysisIds.has(id)),
        warnings: generatedSection.warnings,
        application_mode: null,
      }
    })

    await updateProgress('saving', 'Sparar hela rapportutkastet för din granskning.')
    const { error: deleteError } = await admin.from('tu_ai_suggestions')
      .delete()
      .eq('run_id', input.runId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
    if (deleteError) throw new Error(deleteError.message)
    const { error: insertError } = await admin.from('tu_ai_suggestions').insert(rows)
    if (insertError) throw new Error(insertError.message)

    const completedAt = new Date().toISOString()
    const total = run.progress_total ?? rows.length
    const { error: completeError } = await admin.from('tu_ai_runs').update({
      status: 'completed',
      output_payload: {
        overview: generated.overview,
        warnings: generated.warnings,
        sectionCount: rows.length,
      },
      completed_at: completedAt,
      error_message: null,
      progress_stage: 'completed',
      progress_current: total,
      progress_total: total,
      progress_message: 'Hela rapportutkastet är klart för granskning.',
      heartbeat_at: completedAt,
    }).eq('id', input.runId).eq('status', 'processing')
    if (completeError) throw new Error(completeError.message)
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1200) : 'TU_REPORT_DRAFT_FAILED'
    const now = new Date().toISOString()
    await admin.from('tu_ai_runs').update({
      status: 'failed',
      error_message: message,
      progress_stage: 'failed',
      progress_message: 'Rapportutkastet kunde inte slutföras. Försök igen.',
      heartbeat_at: now,
      completed_at: now,
    }).eq('id', input.runId).in('status', ['queued', 'processing'])
    console.error('[tu.report-draft] Whole report generation failed', {
      inspectionId: input.inspectionId,
      runId: input.runId,
      error,
    })
  }
}
