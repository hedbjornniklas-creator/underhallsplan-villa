import { NextResponse, after } from 'next/server'
import {
  approveTuControlPlan,
  createTuControlPlanRun,
  getTuControlPlanState,
  reopenTuControlPlan,
  runTuControlPlan,
  saveTuPostDamageCase,
  setTuVerificationItemObservations,
  updateTuVerificationItem,
} from '@/lib/tu/controlPlanServer'
import {
  isTuDamageType,
  isTuRemediationStage,
  isTuVerificationPriority,
  isTuVerificationReviewStatus,
  isTuVerificationStatus,
  type TuControlPlanResponse,
} from '@/lib/tu/controlPlan'
import { requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

type RouteContext = { params: Promise<{ inspectionId: string }> }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(value: unknown) {
  return cleanText(value) || null
}

function uuidArray(value: unknown) {
  if (!Array.isArray(value)) return null
  const ids = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim().toLowerCase())
  if (ids.some((id) => !UUID_PATTERN.test(id))) return null
  return [...new Set(ids)]
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error } satisfies TuControlPlanResponse, { status })
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_CONTROL_PLAN_NOT_SUPPORTED') {
    return jsonError('Kontrollplanen används endast för mallen Teknisk kontroll efter skadeåtgärd.', 409)
  }
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_CONTROL_PLAN_DOCUMENTS_REQUIRED') {
    return jsonError('Lägg till minst ett PDF- eller textdokument som analysunderlag.', 400)
  }
  if (message === 'TU_CONTROL_PLAN_TOO_MANY_DOCUMENTS') {
    return jsonError('Högst 12 dokument kan analyseras samtidigt.', 400)
  }
  if (message === 'TU_CONTROL_PLAN_UNSUPPORTED_DOCUMENTS') {
    return jsonError('AI kan läsa PDF och textfiler. Ändra markeringen på Word- eller Excelfiler.', 400)
  }
  if (message === 'TU_CONTROL_PLAN_DOCUMENTS_TOO_LARGE') {
    return jsonError('Analysunderlaget är för stort. Den sammanlagda gränsen är 50 MB.', 400)
  }
  if (message === 'TU_CONTROL_PLAN_NOT_READY') {
    return jsonError('Kontrollplanen måste vara färdig innan den kan godkännas.', 409)
  }
  if (message === 'TU_CONTROL_PLAN_ITEMS_PENDING') {
    return jsonError('Granska varje kontrollpunkt och välj Behåll eller Ta bort innan planen godkänns.', 409)
  }
  if (message === 'TU_CONTROL_PLAN_HAS_NO_ACCEPTED_ITEMS') {
    return jsonError('Behåll minst en kontrollpunkt innan planen godkänns.', 409)
  }
  if (message === 'TU_CONTROL_PLAN_TITLE_REQUIRED') return jsonError('Kontrollpunkten måste ha en rubrik.', 400)
  if (message === 'TU_CONTROL_PLAN_DESCRIPTION_REQUIRED') return jsonError('Kontrollpunkten måste ha en beskrivning.', 400)
  if (message === 'TU_CONTROL_PLAN_ITEM_NOT_FOUND') return jsonError('Kontrollpunkten hittades inte.', 404)
  if (message === 'TU_CONTROL_PLAN_OBSERVATION_INVALID') {
    return jsonError('En vald fältpost tillhör inte den här utredningen.', 400)
  }
  if (
    normalized.includes('tu_post_damage_cases')
    || normalized.includes('tu_verification_items')
    || normalized.includes('control_plan')
    || normalized.includes('report_workflow_profile')
    || normalized.includes('42p01')
    || normalized.includes('42703')
  ) {
    return jsonError('Förberedelseflödet är inte aktiverat i databasen ännu.', 409)
  }
  if (normalized.includes('locked') || normalized.includes('låst')) {
    return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  }
  return null
}

async function stateResponse(orgId: string, inspectionId: string, status = 200) {
  const preparation = await getTuControlPlanState({ orgId, inspectionId })
  return NextResponse.json({ preparation } satisfies TuControlPlanResponse, { status })
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    return stateResponse(orgContext.orgId, inspectionId)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.preparation] GET failed', error)
    return jsonError('Kunde inte hämta förberedelsen.', 500)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const action = cleanText(body.action)

    if (action === 'generate' || action === 'retry') {
      const runId = await createTuControlPlanRun({
        orgId: orgContext.orgId,
        inspectionId,
        userId: orgContext.userId,
      })
      after(async () => {
        await runTuControlPlan({ orgId: orgContext.orgId, inspectionId, runId })
      })
      return stateResponse(orgContext.orgId, inspectionId, 202)
    }

    if (action === 'approve') {
      const preparation = await approveTuControlPlan({
        orgId: orgContext.orgId,
        inspectionId,
        userId: orgContext.userId,
      })
      return NextResponse.json({ preparation } satisfies TuControlPlanResponse)
    }

    if (action === 'reopen') {
      const preparation = await reopenTuControlPlan({
        orgId: orgContext.orgId,
        inspectionId,
        userId: orgContext.userId,
      })
      return NextResponse.json({ preparation } satisfies TuControlPlanResponse)
    }

    return jsonError('Okänd åtgärd för kontrollplanen.', 400)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.preparation] POST failed', error)
    return jsonError('Kunde inte uppdatera kontrollplanen.', 500)
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const target = cleanText(body.target)

    if (target === 'case') {
      const damageTypes = Array.isArray(body.damageTypes)
        ? body.damageTypes.filter(isTuDamageType)
        : []
      const remediationStage = body.remediationStage == null || body.remediationStage === ''
        ? null
        : isTuRemediationStage(body.remediationStage)
          ? body.remediationStage
          : undefined
      if (remediationStage === undefined) return jsonError('Ogiltigt kontrollskede.', 400)
      const remediationStageOther = remediationStage === 'other'
        ? nullableText(body.remediationStageOther)
        : null
      if (remediationStage === 'other' && !remediationStageOther) {
        return jsonError('Beskriv det andra kontrollskedet.', 400)
      }
      if (remediationStageOther && remediationStageOther.length > 200) {
        return jsonError('Beskrivningen av kontrollskedet får vara högst 200 tecken.', 400)
      }
      const preparation = await saveTuPostDamageCase({
        orgId: orgContext.orgId,
        inspectionId,
        userId: orgContext.userId,
        damageTypes,
        remediationStage,
        remediationStageOther,
        mainQuestion: nullableText(body.mainQuestion),
      })
      return NextResponse.json({ preparation } satisfies TuControlPlanResponse)
    }

    if (target === 'item') {
      const itemId = cleanText(body.itemId)
      if (!itemId) return jsonError('Kontrollpunkt saknas.', 400)
      const patch: Parameters<typeof updateTuVerificationItem>[0]['patch'] = {}
      if ('title' in body) patch.title = cleanText(body.title)
      if ('description' in body) patch.description = cleanText(body.description)
      if ('verificationMethod' in body) patch.verificationMethod = nullableText(body.verificationMethod)
      if ('inspectorNote' in body) patch.inspectorNote = nullableText(body.inspectorNote)
      if ('needsFollowUp' in body && typeof body.needsFollowUp === 'boolean') {
        patch.needsFollowUp = body.needsFollowUp
      }
      if ('priority' in body) {
        if (!isTuVerificationPriority(body.priority)) return jsonError('Ogiltig prioritet.', 400)
        patch.priority = body.priority
      }
      if ('reviewStatus' in body) {
        if (!isTuVerificationReviewStatus(body.reviewStatus)) return jsonError('Ogiltig granskningsstatus.', 400)
        patch.reviewStatus = body.reviewStatus
      }
      if ('verificationStatus' in body) {
        if (!isTuVerificationStatus(body.verificationStatus)) return jsonError('Ogiltigt kontrollresultat.', 400)
        const noteRequired = [
          'partially_verified',
          'remaining_condition',
          'not_verifiable',
          'reported_not_verifiable',
          'inaccessible',
        ].includes(body.verificationStatus)
        if (noteRequired && !nullableText(body.inspectorNote)) {
          return jsonError('Beskriv kontrollresultatet i noteringen.', 400)
        }
        patch.verificationStatus = body.verificationStatus
      }
      const item = await updateTuVerificationItem({
        orgId: orgContext.orgId,
        inspectionId,
        itemId,
        userId: orgContext.userId,
        patch,
      })
      return NextResponse.json({ item } satisfies TuControlPlanResponse)
    }

    if (target === 'links') {
      const itemId = cleanText(body.itemId)
      const observationIds = uuidArray(body.observationIds)
      if (!itemId) return jsonError('Kontrollpunkt saknas.', 400)
      if (!observationIds) return jsonError('En eller flera fältposter är ogiltiga.', 400)
      const item = await setTuVerificationItemObservations({
        orgId: orgContext.orgId,
        inspectionId,
        itemId,
        userId: orgContext.userId,
        observationIds,
      })
      return NextResponse.json({ item } satisfies TuControlPlanResponse)
    }

    return jsonError('Okänd ändring för kontrollplanen.', 400)
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.preparation] PATCH failed', error)
    return jsonError('Kunde inte spara ändringen.', 500)
  }
}
