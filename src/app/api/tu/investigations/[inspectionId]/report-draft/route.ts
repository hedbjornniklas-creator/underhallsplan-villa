import { after, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { TuWholeReportDraftResponse } from '@/lib/tu/reportDraft'
import {
  advanceTuWholeReportDraft,
  createTuWholeReportDraftRun,
  getTuWholeReportDraftState,
} from '@/lib/tu/reportDraftServer'
import { getTuInvestigationById, requireTuRequestContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type RouteContext = { params: Promise<{ inspectionId: string }> }

function jsonError(error: string, status: number) {
  return NextResponse.json({ error } satisfies TuWholeReportDraftResponse, { status })
}

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

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_SELECTION_INVALID') return jsonError('Den valda organisationen är ogiltig.', 400)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_ANALYSIS_STALE') {
    return jsonError('Underlaget har ändrats efter analysen. Uppdatera analysen innan utlåtandet skapas om.', 409)
  }
  if (message === 'TU_ANALYSIS_NOT_APPROVED') return jsonError('Godkänn helhetsanalysen innan rapportutkastet skapas.', 409)
  if (message === 'TU_CONTROL_PLAN_NOT_APPROVED') {
    return jsonError('Godkänn kontrollinriktningen innan rapportutkastet skapas.', 409)
  }
  if (message === 'TU_ANALYSIS_HAS_NO_ACCEPTED_ITEMS') return jsonError('Analysen saknar godkända underlag för utlåtandet.', 409)
  if (message === 'TU_REPORT_DRAFT_TEMPLATE_NOT_SUPPORTED') {
    return jsonError('Sammanhållet rapportutkast är inte aktiverat för den här utredningens arbetssätt.', 409)
  }
  if (message === 'TU_REPORT_DRAFT_NO_SECTIONS') return jsonError('Utlåtandet saknar redigerbara rapportdelar.', 409)
  if (message === 'OPENAI_EMPTY_RESPONSE' || message === 'OPENAI_INCOMPLETE_REPORT_DRAFT') {
    return jsonError('AI:n returnerade inte ett komplett rapportutkast. Försök igen.', 502)
  }
  if (normalized.includes('tu_ai_') || normalized.includes('tu_analysis_') || normalized.includes('42p01')) {
    return jsonError('Databasstödet för sammanhållna rapportutkast är inte aktiverat ännu.', 409)
  }
  if (normalized.includes('locked') || normalized.includes('låst')) {
    return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  }
  return null
}

async function requireInvestigation(request: Request, inspectionId: string) {
  const orgContext = await requireTuRequestContext(request)
  const investigation = await getTuInvestigationById({
    orgId: orgContext.orgId,
    inspectionId,
  })
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  return { orgContext, investigation }
}

async function stateResponse(orgId: string, inspectionId: string, status = 200) {
  const draft = await getTuWholeReportDraftState({ orgId, inspectionId })
  return NextResponse.json({ draft } satisfies TuWholeReportDraftResponse, { status })
}

async function advanceInBackground(input: {
  orgId: string
  inspectionId: string
  runId: string
}) {
  try {
    await advanceTuWholeReportDraft(input)
  } catch (error) {
    console.error('[tu.report-draft] Background advancement failed', {
      inspectionId: input.inspectionId,
      runId: input.runId,
      error,
    })
  }
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext } = await requireInvestigation(request, inspectionId)
    const draft = await getTuWholeReportDraftState({
      orgId: orgContext.orgId,
      inspectionId,
    })
    const activeRun = draft.run
    if (activeRun?.status === 'queued' || activeRun?.status === 'processing') {
      after(async () => {
        await advanceInBackground({
          orgId: orgContext.orgId,
          inspectionId,
          runId: activeRun.id,
        })
      })
    }
    return NextResponse.json({ draft } satisfies TuWholeReportDraftResponse)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.report-draft] GET failed', error)
    return jsonError('Kunde inte hämta rapportutkastet.', 500)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext, investigation } = await requireInvestigation(request, inspectionId)
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanText(body.action)
    if (action !== 'start' && action !== 'retry') return jsonError('Okänd rapportåtgärd.', 400)

    const runId = await createTuWholeReportDraftRun({
      orgId: orgContext.orgId,
      inspectionId,
      userId: orgContext.userId,
    })
    after(async () => {
      await advanceInBackground({
        orgId: orgContext.orgId,
        inspectionId,
        runId,
      })
    })
    return stateResponse(orgContext.orgId, inspectionId, 202)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.report-draft] POST failed', error)
    return jsonError('Kunde inte starta rapportutkastet.', 500)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const { orgContext, investigation } = await requireInvestigation(request, inspectionId)
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanText(body.action)
    const admin = createSupabaseAdminClient()
    const state = await getTuWholeReportDraftState({
      orgId: orgContext.orgId,
      inspectionId,
    })
    if (!state.run || state.run.status !== 'completed') {
      return jsonError('Rapportutkastet är inte klart för granskning.', 409)
    }

    if (action === 'update_section') {
      const suggestionId = cleanText(body.suggestionId)
      const proposedText = cleanText(body.proposedText)
      if (!suggestionId || !proposedText) return jsonError('Rapporttexten får inte vara tom.', 400)
      const { data, error } = await admin
        .from('tu_ai_suggestions')
        .update({
          proposed_text: proposedText,
          grounding_status: 'manually_edited',
        })
        .eq('id', suggestionId)
        .eq('run_id', state.run.id)
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
        .select('id')
        .maybeSingle()
      if (error) throw new Error(error.message)
      if (!data) return jsonError('Rapportdelen hittades inte.', 404)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    if (action === 'confirm_section') {
      const suggestionId = cleanText(body.suggestionId)
      const section = state.sections.find((item) => item.id === suggestionId)
      if (!section) return jsonError('Rapportdelen hittades inte.', 404)
      if (!section.proposedText.trim()) {
        return jsonError('Rapportdelen behöver källförankrad text innan den kan godkännas.', 400)
      }
      const { error } = await admin
        .from('tu_ai_suggestions')
        .update({ grounding_status: 'manually_edited' })
        .eq('id', suggestionId)
        .eq('run_id', state.run.id)
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
      if (error) throw new Error(error.message)
      return stateResponse(orgContext.orgId, inspectionId)
    }

    if (action === 'mark_applied') {
      const acceptedIds = stringArray(body.acceptedIds)
      const rejectedIds = stringArray(body.rejectedIds)
      const validIds = new Set(state.sections.map((section) => section.id))
      if (
        acceptedIds.length === 0
        || acceptedIds.some((id) => !validIds.has(id))
        || rejectedIds.some((id) => !validIds.has(id))
      ) return jsonError('Ogiltigt urval av rapportdelar.', 400)
      const acceptedSections = state.sections.filter((section) => acceptedIds.includes(section.id))
      if (acceptedSections.some((section) => !section.proposedText.trim())) {
        return jsonError('En vald rapportdel saknar text och kan inte föras över.', 409)
      }
      if (acceptedSections.some((section) => section.groundingStatus === 'needs_source')) {
        return jsonError('Kontrollera källvarningarna i valda rapportdelar innan de förs över.', 409)
      }
      const now = new Date().toISOString()
      const { error: acceptedError } = await admin
        .from('tu_ai_suggestions')
        .update({
          status: 'accepted',
          application_mode: 'replace',
          reviewed_by: orgContext.userId,
          reviewed_at: now,
          applied_at: now,
        })
        .in('id', acceptedIds)
        .eq('run_id', state.run.id)
        .eq('org_id', orgContext.orgId)
        .eq('inspection_id', inspectionId)
      if (acceptedError) throw new Error(acceptedError.message)
      if (rejectedIds.length > 0) {
        const { error: rejectedError } = await admin
          .from('tu_ai_suggestions')
          .update({
            status: 'rejected',
            application_mode: null,
            reviewed_by: orgContext.userId,
            reviewed_at: now,
            applied_at: null,
          })
          .in('id', rejectedIds)
          .eq('run_id', state.run.id)
          .eq('org_id', orgContext.orgId)
          .eq('inspection_id', inspectionId)
        if (rejectedError) throw new Error(rejectedError.message)
      }
      return stateResponse(orgContext.orgId, inspectionId)
    }

    return jsonError('Okänd rapportåtgärd.', 400)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.report-draft] PATCH failed', error)
    return jsonError('Kunde inte spara rapportutkastet.', 500)
  }
}
