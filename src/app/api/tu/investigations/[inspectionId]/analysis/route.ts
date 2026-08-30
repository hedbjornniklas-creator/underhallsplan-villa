import { NextResponse, after } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  createTuInspectionAnalysisRun,
  getTuAnalysisValidation,
  getTuAnalysisWorkflow,
  runTuInspectionAnalysis,
} from '@/lib/tu/analysisServer'
import {
  isTuAnalysisCertainty,
  isTuAnalysisReviewStatus,
  type TuAnalysisResponse,
} from '@/lib/tu/analysis'
import { TU_MOISTURE_DAMAGE_TEMPLATE_KEY } from '@/lib/tu/evidence'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RouteContext = { params: Promise<{ inspectionId: string }> }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error } satisfies TuAnalysisResponse, { status })
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  const normalized = cleanText(value)
  return normalized || null
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_ANALYSIS_TEMPLATE_NOT_SUPPORTED') {
    return jsonError('Helhetsanalysen är ännu bara aktiverad för fuktskadeutredningar.', 409)
  }
  if (normalized.includes('tu_analysis_') || normalized.includes('tu_ai_analysis_items') || normalized.includes('42p01')) {
    return jsonError('Analysarbetsflödet är inte aktiverat i databasen ännu.', 409)
  }
  if (normalized.includes('locked') || normalized.includes('låst')) {
    return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  }
  return null
}

async function requireInvestigation(inspectionId: string) {
  const orgContext = await requireTuContext()
  const investigation = await getTuInvestigationById({
    orgId: orgContext.orgId,
    inspectionId,
    inspectorProfileId: orgContext.userId,
  })
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (investigation.reportTemplateKey !== TU_MOISTURE_DAMAGE_TEMPLATE_KEY) {
    throw new Error('TU_ANALYSIS_TEMPLATE_NOT_SUPPORTED')
  }
  return { orgContext, investigation }
}

async function stateResponse(orgId: string, inspectionId: string, status = 200) {
  const [workflow, validation] = await Promise.all([
    getTuAnalysisWorkflow({ orgId, inspectionId }),
    getTuAnalysisValidation({ orgId, inspectionId }),
  ])
  return NextResponse.json({ workflow, validation } satisfies TuAnalysisResponse, { status })
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext } = await requireInvestigation(inspectionId)
    return stateResponse(orgContext.orgId, inspectionId)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.analysis] GET failed', error)
    return jsonError('Kunde inte hämta analysläget.', 500)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext, investigation } = await requireInvestigation(inspectionId)
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanText(body.action)
    const pendingQueueCount = Number.isFinite(Number(body.pendingQueueCount))
      ? Math.max(0, Math.round(Number(body.pendingQueueCount)))
      : 0

    if (action === 'complete' || action === 'retry') {
      if (pendingQueueCount > 0) {
        return jsonError('Vänta tills alla bilder och inspelningar har laddats upp.', 409)
      }
      const validation = await getTuAnalysisValidation({ orgId: orgContext.orgId, inspectionId })
      if (!validation.canComplete) {
        if (validation.unreviewedObservationCount > 0) {
          return jsonError(
            `Faktagranska ${validation.unreviewedObservationCount} observationer innan analysen startas.`,
            409
          )
        }
        if (validation.emptyObservationCount > 0) {
          return jsonError(
            `Komplettera eller ta bort ${validation.emptyObservationCount} tomma observationer innan analysen startas.`,
            409
          )
        }
        return jsonError('Lägg till minst en observation eller bild innan analysen startas.', 400)
      }
      const runId = await createTuInspectionAnalysisRun({
        orgId: orgContext.orgId,
        inspectionId,
        userId: orgContext.userId,
      })
      after(async () => {
        await runTuInspectionAnalysis({
          orgId: orgContext.orgId,
          inspectionId,
          runId,
        })
      })
      return stateResponse(orgContext.orgId, inspectionId, 202)
    }

    const admin = createSupabaseAdminClient()
    if (action === 'reopen') {
      const { error } = await admin
        .from('tu_analysis_workflows')
        .update({
          status: 'in_progress',
          analysis_approved_at: null,
          analysis_approved_by: null,
          analysis_stale_at: new Date().toISOString(),
        })
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
      if (error) throw new Error(error.message)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    if (action === 'approve') {
      const workflow = await getTuAnalysisWorkflow({ orgId: orgContext.orgId, inspectionId })
      if (!workflow.run || workflow.run.status !== 'completed') {
        return jsonError('Analysen måste vara klar innan den kan godkännas.', 409)
      }
      if (workflow.items.some((item) => item.reviewStatus === 'pending')) {
        return jsonError('Granska alla analysresultat innan analysen godkänns.', 409)
      }
      if (!workflow.items.some((item) => item.reviewStatus === 'accepted')) {
        return jsonError('Godkänn minst ett analysresultat.', 409)
      }
      const now = new Date().toISOString()
      const { error } = await admin
        .from('tu_analysis_workflows')
        .update({
          status: 'analysis_approved',
          analysis_approved_at: now,
          analysis_approved_by: orgContext.userId,
          analysis_stale_at: null,
        })
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
        .eq('current_analysis_run_id', workflow.run.id)
      if (error) throw new Error(error.message)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    return jsonError('Okänd analysåtgärd.', 400)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.analysis] POST failed', error)
    return jsonError('Kunde inte uppdatera analysen.', 500)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext, investigation } = await requireInvestigation(inspectionId)
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const itemId = cleanText(body.itemId)
    if (!itemId) return jsonError('Analysresultat saknas.', 400)

    const admin = createSupabaseAdminClient()
    const { data: workflowData, error: workflowError } = await admin
      .from('tu_analysis_workflows')
      .select('current_analysis_run_id')
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .maybeSingle()
    if (workflowError) throw new Error(workflowError.message)
    const runId = (workflowData as { current_analysis_run_id?: string | null } | null)
      ?.current_analysis_run_id
    if (!runId) return jsonError('Det finns ingen aktuell analys.', 409)

    const patch: Record<string, unknown> = {}
    if ('title' in body) {
      const title = cleanText(body.title)
      if (!title) return jsonError('Rubriken får inte vara tom.', 400)
      patch.title = title
    }
    if ('summary' in body) {
      const summary = cleanText(body.summary)
      if (!summary) return jsonError('Sammanfattningen får inte vara tom.', 400)
      patch.summary = summary
    }
    if ('certainty' in body) {
      if (!isTuAnalysisCertainty(body.certainty)) return jsonError('Ogiltig säkerhetsnivå.', 400)
      patch.certainty = body.certainty
    }
    if ('reviewStatus' in body) {
      if (!isTuAnalysisReviewStatus(body.reviewStatus)) return jsonError('Ogiltig granskningsstatus.', 400)
      patch.review_status = body.reviewStatus
      patch.reviewed_by = body.reviewStatus === 'pending' ? null : orgContext.userId
      patch.reviewed_at = body.reviewStatus === 'pending' ? null : new Date().toISOString()
    }
    if ('includeInReport' in body) patch.include_in_report = body.includeInReport === true
    if ('targetSectionId' in body) {
      const targetSectionId = nullableText(body.targetSectionId)
      if (
        targetSectionId
        && !investigation.reportDraft.sections.some((section) => section.id === targetSectionId)
      ) {
        return jsonError('Den valda rapportdelen finns inte.', 400)
      }
      patch.target_section_id = targetSectionId
    }
    if (Object.keys(patch).length === 0) return jsonError('Ingen ändring angavs.', 400)

    const { data, error } = await admin
      .from('tu_ai_analysis_items')
      .update(patch)
      .eq('id', itemId)
      .eq('run_id', runId)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return jsonError('Analysresultatet hittades inte.', 404)

    const { error: resetError } = await admin
      .from('tu_analysis_workflows')
      .update({
        status: 'analysis_ready',
        analysis_approved_at: null,
        analysis_approved_by: null,
      })
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .eq('current_analysis_run_id', runId)
    if (resetError) throw new Error(resetError.message)
    return stateResponse(orgContext.orgId, inspectionId)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.analysis] PATCH failed', error)
    return jsonError('Kunde inte spara granskningen.', 500)
  }
}
