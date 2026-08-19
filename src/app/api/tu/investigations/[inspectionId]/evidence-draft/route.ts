import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { listTuObservations } from '@/lib/tu/evidenceServer'
import {
  isTuAiSuggestionStatus,
  type TuEvidenceAiSuggestion,
} from '@/lib/tu/evidence'
import {
  getTuInvestigationById,
  listTuInvestigationImages,
  requireTuContext,
} from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses'
const TU_AI_MODEL = process.env.OPENAI_TU_TEXT_MODEL?.trim() || 'gpt-4o-mini'
const NON_EDITABLE_SECTION_KEYS = new Set(['assignment_parties', 'signature'])
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type OpenAiResponse = {
  output_text?: string
  output?: Array<{
    content?: Array<{
      type?: string
      text?: string
      refusal?: string
    }>
  }>
}

type StructuredDraft = {
  text: string
  sourceObservationIds: string[]
  warnings: string[]
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
  warnings: unknown
  application_mode: string | null
  created_at: string | null
  updated_at: string | null
}

const SUGGESTION_COLUMNS = [
  'id',
  'run_id',
  'target_section_id',
  'target_section_key',
  'target_section_title',
  'proposed_text',
  'status',
  'source_observation_ids',
  'warnings',
  'application_mode',
  'created_at',
  'updated_at',
].join(',')

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function uuid(value: unknown) {
  const normalized = cleanText(value).toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function extractResponseText(payload: OpenAiResponse) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text.trim()
  }
  return (
    payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((content) => content.type === 'output_text' && typeof content.text === 'string')
      ?.text?.trim() ?? ''
  )
}

function mapSuggestion(row: SuggestionRow): TuEvidenceAiSuggestion {
  return {
    id: row.id,
    runId: row.run_id,
    targetSectionId: row.target_section_id,
    targetSectionKey: row.target_section_key,
    targetSectionTitle: row.target_section_title,
    proposedText: row.proposed_text,
    status: isTuAiSuggestionStatus(row.status) ? row.status : 'pending',
    sourceObservationIds: stringArray(row.source_observation_ids),
    warnings: stringArray(row.warnings),
    applicationMode: row.application_mode === 'append' || row.application_mode === 'replace'
      ? row.application_mode
      : null,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
  }
}

function parseStructuredDraft(payload: OpenAiResponse): StructuredDraft {
  const responseText = extractResponseText(payload)
  if (!responseText) throw new Error('OPENAI_EMPTY_RESPONSE')
  const parsed = JSON.parse(responseText) as Record<string, unknown>
  const text = cleanText(parsed.text)
  if (!text) throw new Error('OPENAI_EMPTY_RESPONSE')
  return {
    text,
    sourceObservationIds: stringArray(parsed.sourceObservationIds),
    warnings: stringArray(parsed.warnings),
  }
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_AI_SUGGESTION_NOT_FOUND') return jsonError('AI-förslaget hittades inte.', 404)
  if (message === 'OPENAI_EMPTY_RESPONSE') return jsonError('AI:n returnerade inget användbart textförslag.', 502)
  if (normalized.includes('tu_ai_') || normalized.includes('tu_observations') || normalized.includes('42p01')) {
    return jsonError('AI-arbetsflödet är inte aktiverat i databasen ännu.', 409)
  }
  if (normalized.includes('låst') || normalized.includes('locked')) {
    return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  }
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return jsonError('OPENAI_API_KEY saknas på servern.', 500)

  let runId: string | null = null
  let runOrgId: string | null = null
  let runInspectionId: string | null = null
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const investigation = await getTuInvestigationById({
      orgId: orgContext.orgId,
      inspectionId,
      inspectorProfileId: orgContext.userId,
    })
    if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const sectionId = cleanText(body.sectionId)
    const section = investigation.reportDraft.sections.find((item) => item.id === sectionId)
    if (!section || NON_EDITABLE_SECTION_KEYS.has(section.key)) {
      return jsonError('Välj en redigerbar del av utlåtandet.', 400)
    }

    const [observations, images] = await Promise.all([
      listTuObservations({ orgId: orgContext.orgId, inspectionId }),
      listTuInvestigationImages({ orgId: orgContext.orgId, inspectionId }),
    ])
    const admin = createSupabaseAdminClient()
    const reviewedEvidence = observations.filter(
      (observation) => observation.reviewStatus === 'reviewed' && observation.includeInReport
    )
    const imageById = new Map(images.map((image) => [image.id, image]))
    const sourceIds = new Set(reviewedEvidence.map((observation) => observation.id))

    const evidencePayload = reviewedEvidence.map((observation) => ({
      observationId: observation.id,
      location: observation.location,
      buildingComponent: observation.buildingComponent,
      observation: observation.noteText || observation.transcriptText,
      voiceTranscript: observation.transcriptText,
      riskNote: observation.riskNote,
      suggestedFollowUp: observation.suggestedFollowUp,
      certainty: observation.certainty,
      assignedSectionId: observation.targetSectionId,
      measurements: observation.measurements.map((measurement) => ({
        location: measurement.location,
        type: measurement.measurementType,
        value: measurement.valueText,
        unit: measurement.unit,
        method: measurement.method,
        instrument: measurement.instrument,
        note: measurement.note,
      })),
      images: observation.imageIds.map((imageId) => ({
        imageId,
        caption: imageById.get(imageId)?.caption ?? null,
      })),
    }))

    let approvedAnalysis: Array<Record<string, unknown>> = []
    const { data: workflowData, error: workflowError } = await admin
      .from('tu_analysis_workflows')
      .select('status,current_analysis_run_id')
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .maybeSingle()
    if (workflowError && workflowError.code !== '42P01') throw new Error(workflowError.message)
    const workflow = workflowData as {
      status?: string
      current_analysis_run_id?: string | null
    } | null
    if (workflow?.status === 'analysis_approved' && workflow.current_analysis_run_id) {
      const { data: analysisData, error: analysisError } = await admin
        .from('tu_ai_analysis_items')
        .select(
          'item_type,title,summary,certainty,target_section_id,source_observation_ids,source_image_ids,source_measurement_ids,supporting_reasons,contradicting_reasons,warnings'
        )
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
        .eq('run_id', workflow.current_analysis_run_id)
        .eq('review_status', 'accepted')
        .eq('include_in_report', true)
        .order('sort_order', { ascending: true })
      if (analysisError) throw new Error(analysisError.message)
      approvedAnalysis = (analysisData ?? []) as Array<Record<string, unknown>>
    }

    const inputSnapshot = {
      ruleset: 'tu_moisture_v1',
      reportTemplateKey: investigation.reportTemplateKey,
      targetSection: {
        id: section.id,
        key: section.key,
        title: section.title,
        currentText: section.text,
        aiInstruction: section.aiInstruction ?? null,
      },
      assignment: {
        title: investigation.title,
        assignmentNumber: investigation.assignmentNumber,
        scopeDescription: investigation.scopeDescription,
        inspectionDate: investigation.date,
        inspectionTime: investigation.inspectionTime,
      },
      object: {
        objectType: investigation.objectType,
        address: investigation.propertyAddress,
        city: investigation.propertyCity,
        cadastralId: investigation.cadastralId,
        brfName: investigation.brfName,
        apartmentNumber: investigation.apartmentNumber,
      },
      evidence: evidencePayload,
      approvedAnalysis,
    }

    const { data: runData, error: runError } = await admin
      .from('tu_ai_runs')
      .insert({
        org_id: orgContext.orgId,
        inspection_id: inspectionId,
        operation: 'section_draft',
        status: 'processing',
        model: TU_AI_MODEL,
        ruleset_key: 'tu_moisture_v1',
        ruleset_version: 1,
        target_section_id: section.id,
        input_snapshot: inputSnapshot,
        created_by: orgContext.userId,
      })
      .select('id')
      .single()
    if (runError || !runData) throw new Error(runError?.message ?? 'Kunde inte starta AI-körningen.')
    runId = String((runData as { id: string }).id)
    runOrgId = orgContext.orgId
    runInspectionId = inspectionId

    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TU_AI_MODEL,
        instructions: [
          'Du skriver ett granskningsbart textförslag till en svensk fuktskadeutredning.',
          'Använd endast fakta i JSON-underlaget. Hitta aldrig på observationer, mätvärden, datum, orsaker, ansvar eller åtgärder.',
          'Skilj verifierade fakta från sannolika tekniska bedömningar och från sådant som inte har kunnat fastställas.',
          'Formulera osäkerheter uttryckligen. Utse inte juridiskt ansvarig part och lämna inga juridiska slutsatser.',
          'Skriv sakligt, precist och proportionerligt på svenska. Undvik upprepning och utfyllnad.',
          'Följ sektionens aiInstruction när den finns.',
          'approvedAnalysis innehåller endast besiktningsmannens godkända helhetsanalys. Använd den som strukturerat underlag och behåll redovisade osäkerheter.',
          'Om approvedAnalysis finns ska du prioritera poster som är tilldelade targetSection.id men använda övriga poster för sammanhang och för att undvika motsägelser.',
          'sourceObservationIds får endast innehålla observationId som faktiskt finns i underlaget.',
          'Om underlaget inte räcker ska texten säga det och warnings förklara vad som saknas.',
        ].join('\n'),
        input: JSON.stringify(inputSnapshot, null, 2),
        text: {
          format: {
            type: 'json_schema',
            name: 'tu_moisture_section_draft',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                sourceObservationIds: {
                  type: 'array',
                  items: { type: 'string' },
                },
                warnings: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['text', 'sourceObservationIds', 'warnings'],
              additionalProperties: false,
            },
          },
        },
        max_output_tokens: 2200,
      }),
    })

    if (!response.ok) {
      const detail = await response.text()
      console.error('[tu.evidence-draft] OpenAI request failed', {
        status: response.status,
        detail: detail.slice(0, 600),
      })
      throw new Error('OPENAI_REQUEST_FAILED')
    }

    const openAiPayload = (await response.json()) as OpenAiResponse
    const draft = parseStructuredDraft(openAiPayload)
    const validSourceObservationIds = draft.sourceObservationIds.filter((id) => sourceIds.has(id))
    const warnings = [...draft.warnings]
    if (reviewedEvidence.length === 0) {
      warnings.unshift('Textförslaget saknar granskade fältobservationer och bygger endast på ärendets grunduppgifter.')
    }
    if (validSourceObservationIds.length !== draft.sourceObservationIds.length) {
      warnings.push('Ett eller flera okända käll-id:n från AI-svaret filtrerades bort.')
    }

    const outputPayload = {
      text: draft.text,
      sourceObservationIds: validSourceObservationIds,
      warnings,
    }
    const { error: completeError } = await admin
      .from('tu_ai_runs')
      .update({
        status: 'completed',
        output_payload: outputPayload,
        completed_at: new Date().toISOString(),
      })
      .eq('id', runId)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
    if (completeError) throw new Error(completeError.message ?? 'Kunde inte slutföra AI-körningen.')

    const { data: suggestionData, error: suggestionError } = await admin
      .from('tu_ai_suggestions')
      .insert({
        org_id: orgContext.orgId,
        inspection_id: inspectionId,
        run_id: runId,
        target_section_id: section.id,
        target_section_key: section.key,
        target_section_title: section.title,
        proposed_text: draft.text,
        status: 'pending',
        source_observation_ids: validSourceObservationIds,
        warnings,
      })
      .select(SUGGESTION_COLUMNS)
      .single()
    if (suggestionError || !suggestionData) {
      throw new Error(suggestionError?.message ?? 'Kunde inte spara AI-förslaget.')
    }

    return NextResponse.json({
      model: TU_AI_MODEL,
      suggestion: mapSuggestion(suggestionData as unknown as SuggestionRow),
    })
  } catch (error) {
    if (runId && runOrgId && runInspectionId) {
      try {
        const admin = createSupabaseAdminClient()
        await admin
          .from('tu_ai_runs')
          .update({
            status: 'failed',
            error_message: error instanceof Error ? error.message.slice(0, 1000) : 'UNKNOWN_ERROR',
            completed_at: new Date().toISOString(),
          })
          .eq('id', runId)
          .eq('org_id', runOrgId)
          .eq('inspection_id', runInspectionId)
      } catch (runUpdateError) {
        console.error('[tu.evidence-draft] failed to mark run as failed', runUpdateError)
      }
    }
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.evidence-draft.POST] failed', error)
    return jsonError('Kunde inte skapa textförslaget.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const investigation = await getTuInvestigationById({ orgId: orgContext.orgId, inspectionId })
    if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const suggestionId = uuid(body.suggestionId)
    const status = body.status
    const applicationMode = body.mode === 'append' || body.mode === 'replace' ? body.mode : null
    if (!suggestionId) return jsonError('Ogiltigt förslags-id.', 400)
    if (!isTuAiSuggestionStatus(status) || status === 'pending') {
      return jsonError('Välj om förslaget ska godkännas eller avvisas.', 400)
    }
    if (status === 'accepted' && !applicationMode) {
      return jsonError('Välj hur textförslaget ska infogas.', 400)
    }

    const now = new Date().toISOString()
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('tu_ai_suggestions')
      .update({
        status,
        reviewed_by: orgContext.userId,
        reviewed_at: now,
        applied_at: status === 'accepted' ? now : null,
        application_mode: status === 'accepted' ? applicationMode : null,
      })
      .eq('id', suggestionId)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .select(SUGGESTION_COLUMNS)
      .maybeSingle()
    if (error) throw new Error(error.message ?? 'Kunde inte uppdatera AI-förslaget.')
    if (!data) throw new Error('TU_AI_SUGGESTION_NOT_FOUND')
    return NextResponse.json({ suggestion: mapSuggestion(data as unknown as SuggestionRow) })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.evidence-draft.PATCH] failed', error)
    return jsonError('Kunde inte uppdatera AI-förslaget.', 500)
  }
}
