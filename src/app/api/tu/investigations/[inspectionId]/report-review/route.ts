import { after, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { TuReportReviewResponse } from '@/lib/tu/reportReview'
import {
  createTuReportReviewRun,
  getTuReportReviewState,
  runTuReportReview,
} from '@/lib/tu/reportReviewServer'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RouteContext = { params: Promise<{ inspectionId: string }> }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error } satisfies TuReportReviewResponse, { status })
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_REPORT_SECTION_NOT_FOUND') return jsonError('Rapportdelen hittades inte.', 404)
  if (message === 'TU_REPORT_REVIEW_BUSY') return jsonError('En annan rapportändring bearbetas redan.', 409)
  if (message === 'TU_ANALYSIS_STALE') {
    return jsonError('Källunderlaget har ändrats efter analysen. Uppdatera analysen och skapa om utlåtandet innan AI-revidering.', 409)
  }
  if (message === 'TU_ANALYSIS_NOT_APPROVED') return jsonError('Skapa först ett sammanhållet utlåtande.', 409)
  if (normalized.includes('tu_report_review_instructions') || normalized.includes('42p01')) {
    return jsonError('Databasstödet för kommentarsstyrd rapportgranskning är inte aktiverat ännu.', 409)
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
  return { orgContext, investigation }
}

async function stateResponse(orgId: string, inspectionId: string, status = 200) {
  const review = await getTuReportReviewState({ orgId, inspectionId })
  return NextResponse.json({ review } satisfies TuReportReviewResponse, { status })
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext } = await requireInvestigation(inspectionId)
    return stateResponse(orgContext.orgId, inspectionId)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.report-review] GET failed', error)
    return jsonError('Kunde inte hämta rapportens ändringshistorik.', 500)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext, investigation } = await requireInvestigation(inspectionId)
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const scope = body.scope === 'report' ? 'report' : 'section'
    const targetSectionId = scope === 'section' ? cleanText(body.targetSectionId) : null
    const instruction = cleanText(body.instruction)
    if (scope === 'section' && !targetSectionId) return jsonError('Välj vilken rapportdel som ska justeras.', 400)
    if (instruction.length < 3) return jsonError('Beskriv kort vad som ska ändras.', 400)
    const { reviewId, runId } = await createTuReportReviewRun({
      orgId: orgContext.orgId,
      inspectionId,
      userId: orgContext.userId,
      scope,
      targetSectionId,
      instruction,
    })
    after(async () => {
      await runTuReportReview({
        orgId: orgContext.orgId,
        inspectionId,
        reviewId,
        runId,
      })
    })
    return stateResponse(orgContext.orgId, inspectionId, 202)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.report-review] POST failed', error)
    return jsonError('Kunde inte starta helhetsgranskningen.', 500)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext, investigation } = await requireInvestigation(inspectionId)
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanText(body.action)
    const instructionId = cleanText(body.instructionId)
    if (!instructionId) return jsonError('Rapportändringen saknas.', 400)
    const state = await getTuReportReviewState({ orgId: orgContext.orgId, inspectionId })
    const review = action === 'revert' ? state.latestApplied : state.current
    if (!review || review.id !== instructionId) return jsonError('Rapportändringen hittades inte.', 404)
    const admin = createSupabaseAdminClient()
    const now = new Date().toISOString()

    if (action === 'apply') {
      if (review.status !== 'completed') return jsonError('Rapportändringen är inte klar.', 409)
      if (review.sections.length === 0) return jsonError('AI:n föreslog ingen faktisk textändring.', 409)
      if (review.sections.some((section) => (
        !section.proposedText.trim()
        || section.groundingStatus === 'blocked'
        || section.groundingStatus === 'needs_source'
      ))) return jsonError('Kontrollera källvarningarna innan ändringarna används.', 409)
      const { data: row, error: rowError } = await admin
        .from('tu_report_review_instructions')
        .select('result_run_id')
        .eq('id', instructionId)
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
        .eq('status', 'completed')
        .maybeSingle()
      if (rowError) throw new Error(rowError.message)
      const runId = (row as { result_run_id?: string | null } | null)?.result_run_id
      if (!runId) return jsonError('AI-körningen för rapportändringen saknas.', 409)
      const [{ error: suggestionError }, { error: reviewError }] = await Promise.all([
        admin.from('tu_ai_suggestions').update({
          status: 'accepted',
          application_mode: 'replace',
          reviewed_by: orgContext.userId,
          reviewed_at: now,
          applied_at: now,
        }).eq('run_id', runId).eq('org_id', orgContext.orgId).eq('inspection_id', inspectionId),
        admin.from('tu_report_review_instructions').update({
          status: 'applied',
          applied_by: orgContext.userId,
          applied_at: now,
        }).eq('id', instructionId).eq('status', 'completed'),
      ])
      if (suggestionError) throw new Error(suggestionError.message)
      if (reviewError) throw new Error(reviewError.message)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    if (action === 'reject') {
      if (review.status !== 'completed') return jsonError('Rapportändringen är inte klar.', 409)
      const { data: row } = await admin
        .from('tu_report_review_instructions')
        .select('result_run_id')
        .eq('id', instructionId)
        .maybeSingle()
      const runId = (row as { result_run_id?: string | null } | null)?.result_run_id
      if (runId) {
        const { error } = await admin.from('tu_ai_suggestions').update({
          status: 'rejected',
          reviewed_by: orgContext.userId,
          reviewed_at: now,
        }).eq('run_id', runId).eq('org_id', orgContext.orgId).eq('inspection_id', inspectionId)
        if (error) throw new Error(error.message)
      }
      const { error } = await admin.from('tu_report_review_instructions').update({
        status: 'rejected',
      }).eq('id', instructionId).eq('status', 'completed')
      if (error) throw new Error(error.message)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    if (action === 'revert') {
      if (review.status !== 'applied') return jsonError('Rapportändringen kan inte ångras.', 409)
      const { error } = await admin.from('tu_report_review_instructions').update({
        status: 'reverted',
        reverted_by: orgContext.userId,
        reverted_at: now,
      }).eq('id', instructionId).eq('status', 'applied')
      if (error) throw new Error(error.message)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    return jsonError('Okänd rapportåtgärd.', 400)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.report-review] PATCH failed', error)
    return jsonError('Kunde inte uppdatera rapportändringen.', 500)
  }
}
