import { NextResponse } from 'next/server'
import {
  createTuObservation,
  deleteTuObservation,
  listTuObservations,
  updateTuObservation,
  type TuObservationWriteInput,
} from '@/lib/tu/evidenceServer'
import {
  isTuObservationCertainty,
  isTuObservationReviewStatus,
  isTuObservationSourceType,
} from '@/lib/tu/evidence'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const AUDIO_BUCKET = 'tu-investigation-audio'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown) {
  const normalized = text(value).trim()
  return normalized || null
}

function uuid(value: unknown) {
  const normalized = text(value).trim().toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function imageIds(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map(uuid).filter((item): item is string => Boolean(item)))]
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const normalized = message.toLowerCase()
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_OBSERVATION_NOT_FOUND') return jsonError('Observationen hittades inte.', 404)
  if (message === 'TU_OBSERVATION_ID_CONFLICT') return jsonError('Fältanteckningens id används redan.', 409)
  if (message === 'TU_OBSERVATION_IMAGE_INVALID') return jsonError('En vald bild tillhör inte utredningen.', 400)
  if (message === 'TU_AUDIO_REFERENCE_INVALID') return jsonError('Röstanteckningens lagringsreferens är ogiltig.', 400)
  if (normalized.includes('tu_observations') || normalized.includes('42p01')) {
    return jsonError('Besiktningsunderlag är inte aktiverat i databasen ännu.', 409)
  }
  if (normalized.includes('låst') || normalized.includes('locked')) {
    return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  }
  return null
}

async function requireInvestigation(orgId: string, inspectionId: string, editable: boolean) {
  const investigation = await getTuInvestigationById({ orgId, inspectionId })
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (editable && investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
  return investigation
}

function observationValues(body: Record<string, unknown>, inspectionId: string): TuObservationWriteInput {
  const transcriptText = nullableText(body.transcriptText)
  const noteText = text(body.noteText)
  const requestedSourceType = body.sourceType
  const sourceType = isTuObservationSourceType(requestedSourceType)
    ? requestedSourceType
    : transcriptText && noteText.trim()
      ? 'mixed'
      : transcriptText
        ? 'voice'
        : 'typed'
  const audioStorageBucket = nullableText(body.audioStorageBucket)
  const audioStoragePath = nullableText(body.audioStoragePath)
  if (
    Boolean(audioStorageBucket) !== Boolean(audioStoragePath)
    || (audioStorageBucket && audioStorageBucket !== AUDIO_BUCKET)
    || (audioStoragePath && !audioStoragePath.startsWith(`${inspectionId}/voice/`))
  ) {
    throw new Error('TU_AUDIO_REFERENCE_INVALID')
  }

  return {
    sourceType,
    location: nullableText(body.location),
    buildingComponent: nullableText(body.buildingComponent),
    noteText,
    transcriptText,
    riskNote: nullableText(body.riskNote),
    suggestedFollowUp: nullableText(body.suggestedFollowUp),
    certainty: isTuObservationCertainty(body.certainty) ? body.certainty : 'confirmed',
    reviewStatus: isTuObservationReviewStatus(body.reviewStatus) ? body.reviewStatus : 'draft',
    targetSectionId: nullableText(body.targetSectionId),
    includeInReport: body.includeInReport !== false,
    audioStorageBucket,
    audioStoragePath,
    audioContentType: nullableText(body.audioContentType),
    audioDurationSeconds:
      typeof body.audioDurationSeconds === 'number' && Number.isFinite(body.audioDurationSeconds)
        ? Math.max(0, Math.round(body.audioDurationSeconds))
        : null,
    observedAt: nullableText(body.observedAt),
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    await requireInvestigation(orgContext.orgId, inspectionId, false)
    const observations = await listTuObservations({ orgId: orgContext.orgId, inspectionId })
    return NextResponse.json({ observations })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.observations.GET] failed', error)
    return jsonError('Kunde inte hämta besiktningsunderlaget.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    await requireInvestigation(orgContext.orgId, inspectionId, true)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const values = observationValues(body, inspectionId)
    const linkedImageIds = imageIds(body.imageIds)
    const clientObservationId = uuid(body.clientObservationId)

    if (!values.noteText?.trim() && !values.transcriptText && linkedImageIds.length === 0) {
      return jsonError('Lägg in en anteckning, en röstinmatning eller minst en bild.', 400)
    }

    const observation = await createTuObservation({
      orgId: orgContext.orgId,
      inspectionId,
      userId: orgContext.userId,
      observationId: clientObservationId,
      values,
      imageIds: linkedImageIds,
    })
    return NextResponse.json({ observation }, { status: 201 })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.observations.POST] failed', error)
    return jsonError('Kunde inte spara observationen.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    await requireInvestigation(orgContext.orgId, inspectionId, true)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const observationId = uuid(body.observationId)
    if (!observationId) return jsonError('Ogiltigt observations-id.', 400)

    const values = observationValues(body, inspectionId)
    const linkedImageIds = imageIds(body.imageIds)
    if (!values.noteText?.trim() && !values.transcriptText && linkedImageIds.length === 0) {
      return jsonError('Lägg in en anteckning, en röstinmatning eller minst en bild.', 400)
    }

    const observation = await updateTuObservation({
      orgId: orgContext.orgId,
      inspectionId,
      observationId,
      userId: orgContext.userId,
      values,
      imageIds: linkedImageIds,
    })
    return NextResponse.json({ observation })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.observations.PATCH] failed', error)
    return jsonError('Kunde inte uppdatera observationen.', 500)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    await requireInvestigation(orgContext.orgId, inspectionId, true)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const observationId = uuid(body.observationId)
    if (!observationId) return jsonError('Ogiltigt observations-id.', 400)

    await deleteTuObservation({ orgId: orgContext.orgId, inspectionId, observationId })
    return NextResponse.json({ ok: true, observationId })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.observations.DELETE] failed', error)
    return jsonError('Kunde inte ta bort observationen.', 500)
  }
}
