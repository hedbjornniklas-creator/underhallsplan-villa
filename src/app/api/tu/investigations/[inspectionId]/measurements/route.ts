import { NextResponse } from 'next/server'
import {
  createTuObservation,
  createTuMeasurement,
  deleteTuMeasurement,
  getTuObservation,
  updateTuMeasurement,
  type TuMeasurementWriteInput,
} from '@/lib/tu/evidenceServer'
import { isTuMeasurementAssessment } from '@/lib/tu/evidence'
import { getTuInvestigationById, requireTuRequestContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function uuid(value: unknown) {
  const normalized = text(value).toLowerCase()
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
  if (message === 'ORG_SELECTION_INVALID') return jsonError('Den valda organisationen är ogiltig.', 400)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'TU_OBSERVATION_NOT_FOUND') return jsonError('Observationen hittades inte.', 404)
  if (message === 'TU_MEASUREMENT_NOT_FOUND') return jsonError('Mätvärdet hittades inte.', 404)
  if (message === 'TU_MEASUREMENT_ASSESSMENT_INVALID') return jsonError('Välj en giltig bedömning.', 400)
  if (message === 'TU_OBSERVATION_IMAGE_INVALID') return jsonError('En vald bild tillhör inte utredningen.', 400)
  if (message === 'TU_OBSERVATION_ID_CONFLICT' || message === 'TU_MEASUREMENT_ID_CONFLICT') {
    return jsonError('Det lokala fältunderlaget kunde inte identifieras säkert.', 409)
  }
  if (normalized.includes('tu_measurements') || normalized.includes('42p01')) {
    return jsonError('Besiktningsunderlag är inte aktiverat i databasen ännu.', 409)
  }
  if (normalized.includes('låst') || normalized.includes('locked')) {
    return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  }
  return null
}

async function requireEditableInvestigation(orgId: string, inspectionId: string) {
  const investigation = await getTuInvestigationById({ orgId, inspectionId })
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
}

function measurementValues(body: Record<string, unknown>): TuMeasurementWriteInput | null {
  const measurementType = text(body.measurementType)
  const valueText = text(body.valueText)
  const assessmentValue = text(body.assessment)
  if (!measurementType || !valueText) return null
  if (assessmentValue && !isTuMeasurementAssessment(assessmentValue)) {
    throw new Error('TU_MEASUREMENT_ASSESSMENT_INVALID')
  }
  const assessment = assessmentValue && isTuMeasurementAssessment(assessmentValue)
    ? assessmentValue
    : null
  return {
    observationId: uuid(body.observationId),
    location: text(body.location) || null,
    measurementType,
    valueText,
    unit: text(body.unit) || null,
    method: text(body.method) || null,
    instrument: text(body.instrument) || null,
    assessment,
    note: text(body.note) || null,
    measuredAt: text(body.measuredAt) || null,
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuRequestContext(request)
    await requireEditableInvestigation(orgContext.orgId, inspectionId)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const values = measurementValues(body)
    if (!values) return jsonError('Ange typ och mätvärde.', 400)
    const linkedImageIds = imageIds(body.imageIds)

    const createFieldEntry = body.createFieldEntry === true
    const clientObservationId = uuid(body.clientObservationId)
    const clientMeasurementId = uuid(body.clientMeasurementId)
    let observation = null

    if (createFieldEntry) {
      if (!clientObservationId || !clientMeasurementId) {
        return jsonError('Det lokala mätunderlaget saknar ett giltigt id.', 400)
      }
      observation = await getTuObservation({
        orgId: orgContext.orgId,
        inspectionId,
        observationId: clientObservationId,
      })
      if (observation && observation.sourceType !== 'measurement') {
        return jsonError('Det lokala fältunderlaget kunde inte identifieras säkert.', 409)
      }
      if (!observation) {
        observation = await createTuObservation({
          orgId: orgContext.orgId,
          inspectionId,
          userId: orgContext.userId,
          observationId: clientObservationId,
          values: {
            sourceType: 'measurement',
            location: values.location,
            noteText: '',
            certainty: 'uncertain',
            reviewStatus: 'draft',
            includeInReport: true,
            observedAt: values.measuredAt,
          },
          imageIds: linkedImageIds,
        })
      }
      values.observationId = clientObservationId
    }

    const measurement = await createTuMeasurement({
      orgId: orgContext.orgId,
      inspectionId,
      userId: orgContext.userId,
      measurementId: clientMeasurementId,
      values,
    })
    if (createFieldEntry && clientObservationId) {
      observation = await getTuObservation({
        orgId: orgContext.orgId,
        inspectionId,
        observationId: clientObservationId,
      })
    }
    return NextResponse.json({ measurement, observation }, { status: 201 })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.measurements.POST] failed', error)
    return jsonError('Kunde inte spara mätvärdet.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuRequestContext(request)
    await requireEditableInvestigation(orgContext.orgId, inspectionId)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const measurementId = uuid(body.measurementId)
    const values = measurementValues(body)
    if (!measurementId) return jsonError('Ogiltigt mätvärdes-id.', 400)
    if (!values) return jsonError('Ange typ och mätvärde.', 400)

    const measurement = await updateTuMeasurement({
      orgId: orgContext.orgId,
      inspectionId,
      measurementId,
      userId: orgContext.userId,
      values,
    })
    return NextResponse.json({ measurement })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.measurements.PATCH] failed', error)
    return jsonError('Kunde inte uppdatera mätvärdet.', 500)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuRequestContext(request)
    await requireEditableInvestigation(orgContext.orgId, inspectionId)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const measurementId = uuid(body.measurementId)
    if (!measurementId) return jsonError('Ogiltigt mätvärdes-id.', 400)

    await deleteTuMeasurement({ orgId: orgContext.orgId, inspectionId, measurementId })
    return NextResponse.json({ ok: true, measurementId })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.measurements.DELETE] failed', error)
    return jsonError('Kunde inte ta bort mätvärdet.', 500)
  }
}
