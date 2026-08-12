import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  isTuObservationCertainty,
  isTuObservationReviewStatus,
  isTuObservationSourceType,
  type TuMeasurement,
  type TuObservation,
  type TuObservationCertainty,
  type TuObservationReviewStatus,
  type TuObservationSourceType,
} from '@/lib/tu/evidence'

type TuObservationRow = {
  id: string
  org_id: string
  inspection_id: string
  source_type: string
  location: string | null
  building_component: string | null
  note_text: string | null
  transcript_text: string | null
  risk_note: string | null
  suggested_follow_up: string | null
  certainty: string
  review_status: string
  target_section_id: string | null
  include_in_report: boolean | null
  audio_storage_bucket: string | null
  audio_storage_path: string | null
  audio_content_type: string | null
  audio_duration_seconds: number | null
  observed_at: string | null
  created_at: string | null
  updated_at: string | null
}

type TuObservationImageRow = {
  observation_id: string
  image_id: string
  sort_order: number | null
}

type TuMeasurementRow = {
  id: string
  observation_id: string | null
  location: string | null
  measurement_type: string
  value_text: string
  unit: string | null
  method: string | null
  instrument: string | null
  note: string | null
  measured_at: string | null
  created_at: string | null
  updated_at: string | null
}

export type TuObservationWriteInput = {
  sourceType?: TuObservationSourceType
  location?: string | null
  buildingComponent?: string | null
  noteText?: string
  transcriptText?: string | null
  riskNote?: string | null
  suggestedFollowUp?: string | null
  certainty?: TuObservationCertainty
  reviewStatus?: TuObservationReviewStatus
  targetSectionId?: string | null
  includeInReport?: boolean
  audioStorageBucket?: string | null
  audioStoragePath?: string | null
  audioContentType?: string | null
  audioDurationSeconds?: number | null
  observedAt?: string | null
}

export type TuMeasurementWriteInput = {
  observationId?: string | null
  location?: string | null
  measurementType: string
  valueText: string
  unit?: string | null
  method?: string | null
  instrument?: string | null
  note?: string | null
  measuredAt?: string | null
}

const OBSERVATION_COLUMNS = [
  'id',
  'org_id',
  'inspection_id',
  'source_type',
  'location',
  'building_component',
  'note_text',
  'transcript_text',
  'risk_note',
  'suggested_follow_up',
  'certainty',
  'review_status',
  'target_section_id',
  'include_in_report',
  'audio_storage_bucket',
  'audio_storage_path',
  'audio_content_type',
  'audio_duration_seconds',
  'observed_at',
  'created_at',
  'updated_at',
].join(',')

const MEASUREMENT_COLUMNS = [
  'id',
  'observation_id',
  'location',
  'measurement_type',
  'value_text',
  'unit',
  'method',
  'instrument',
  'note',
  'measured_at',
  'created_at',
  'updated_at',
].join(',')

function nullableText(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized : null
}

function requiredText(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function isoOrNow(value: string | null | undefined) {
  if (value && !Number.isNaN(Date.parse(value))) return value
  return new Date().toISOString()
}

function mapMeasurement(row: TuMeasurementRow): TuMeasurement {
  return {
    id: row.id,
    observationId: row.observation_id,
    location: nullableText(row.location),
    measurementType: row.measurement_type,
    valueText: row.value_text,
    unit: nullableText(row.unit),
    method: nullableText(row.method),
    instrument: nullableText(row.instrument),
    note: nullableText(row.note),
    measuredAt: isoOrNow(row.measured_at),
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at),
  }
}

function mapObservation(
  row: TuObservationRow,
  imageIds: string[],
  measurements: TuMeasurement[]
): TuObservation {
  return {
    id: row.id,
    sourceType: isTuObservationSourceType(row.source_type) ? row.source_type : 'typed',
    location: nullableText(row.location),
    buildingComponent: nullableText(row.building_component),
    noteText: row.note_text ?? '',
    transcriptText: nullableText(row.transcript_text),
    riskNote: nullableText(row.risk_note),
    suggestedFollowUp: nullableText(row.suggested_follow_up),
    certainty: isTuObservationCertainty(row.certainty) ? row.certainty : 'confirmed',
    reviewStatus: isTuObservationReviewStatus(row.review_status) ? row.review_status : 'draft',
    targetSectionId: nullableText(row.target_section_id),
    includeInReport: row.include_in_report !== false,
    imageIds,
    measurements,
    audioStorageBucket: nullableText(row.audio_storage_bucket),
    audioStoragePath: nullableText(row.audio_storage_path),
    audioContentType: nullableText(row.audio_content_type),
    audioDurationSeconds:
      typeof row.audio_duration_seconds === 'number' && row.audio_duration_seconds >= 0
        ? row.audio_duration_seconds
        : null,
    observedAt: isoOrNow(row.observed_at),
    createdAt: isoOrNow(row.created_at),
    updatedAt: isoOrNow(row.updated_at),
  }
}

function observationPayload(input: TuObservationWriteInput, userId: string) {
  const payload = {
    source_type: isTuObservationSourceType(input.sourceType) ? input.sourceType : 'typed',
    location: nullableText(input.location),
    building_component: nullableText(input.buildingComponent),
    note_text: requiredText(input.noteText),
    transcript_text: nullableText(input.transcriptText),
    risk_note: nullableText(input.riskNote),
    suggested_follow_up: nullableText(input.suggestedFollowUp),
    certainty: isTuObservationCertainty(input.certainty) ? input.certainty : 'confirmed',
    review_status: isTuObservationReviewStatus(input.reviewStatus) ? input.reviewStatus : 'draft',
    target_section_id: nullableText(input.targetSectionId),
    include_in_report: input.includeInReport !== false,
    audio_storage_bucket: nullableText(input.audioStorageBucket),
    audio_storage_path: nullableText(input.audioStoragePath),
    audio_content_type: nullableText(input.audioContentType),
    audio_duration_seconds:
      typeof input.audioDurationSeconds === 'number' && input.audioDurationSeconds >= 0
        ? Math.round(input.audioDurationSeconds)
        : null,
    updated_by: userId,
  }
  return input.observedAt
    ? { ...payload, observed_at: isoOrNow(input.observedAt) }
    : payload
}

async function assertObservationOwnership(input: {
  orgId: string
  inspectionId: string
  observationId: string | null | undefined
}) {
  if (!input.observationId) return
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('tu_observations')
    .select('id')
    .eq('id', input.observationId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()
  if (error) throw new Error(error.message ?? 'Kunde inte verifiera observationen.')
  if (!data) throw new Error('TU_OBSERVATION_NOT_FOUND')
}

export async function listTuObservations(input: {
  orgId: string
  inspectionId: string
}): Promise<TuObservation[]> {
  const admin = createSupabaseAdminClient()
  const { data: observationData, error: observationError } = await admin
    .from('tu_observations')
    .select(OBSERVATION_COLUMNS)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .order('observed_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (observationError) {
    throw new Error(observationError.message ?? 'Kunde inte hämta besiktningsunderlag.')
  }

  const rows = (observationData ?? []) as unknown as TuObservationRow[]
  if (rows.length === 0) return []
  const observationIds = rows.map((row) => row.id)

  const [{ data: imageData, error: imageError }, { data: measurementData, error: measurementError }] =
    await Promise.all([
      admin
        .from('tu_observation_images')
        .select('observation_id,image_id,sort_order')
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .in('observation_id', observationIds)
        .order('sort_order', { ascending: true }),
      admin
        .from('tu_measurements')
        .select(MEASUREMENT_COLUMNS)
        .eq('org_id', input.orgId)
        .eq('inspection_id', input.inspectionId)
        .in('observation_id', observationIds)
        .order('measured_at', { ascending: true }),
    ])

  if (imageError) throw new Error(imageError.message ?? 'Kunde inte hämta bildkopplingar.')
  if (measurementError) throw new Error(measurementError.message ?? 'Kunde inte hämta mätvärden.')

  const imageIdsByObservation = new Map<string, string[]>()
  for (const link of (imageData ?? []) as unknown as TuObservationImageRow[]) {
    const imageIds = imageIdsByObservation.get(link.observation_id) ?? []
    imageIds.push(link.image_id)
    imageIdsByObservation.set(link.observation_id, imageIds)
  }

  const measurementsByObservation = new Map<string, TuMeasurement[]>()
  for (const row of (measurementData ?? []) as unknown as TuMeasurementRow[]) {
    if (!row.observation_id) continue
    const measurements = measurementsByObservation.get(row.observation_id) ?? []
    measurements.push(mapMeasurement(row))
    measurementsByObservation.set(row.observation_id, measurements)
  }

  return rows.map((row) =>
    mapObservation(
      row,
      imageIdsByObservation.get(row.id) ?? [],
      measurementsByObservation.get(row.id) ?? []
    )
  )
}

export async function getTuObservation(input: {
  orgId: string
  inspectionId: string
  observationId: string
}) {
  const observations = await listTuObservations(input)
  return observations.find((observation) => observation.id === input.observationId) ?? null
}

export async function createTuObservation(input: {
  orgId: string
  inspectionId: string
  userId: string
  observationId?: string | null
  values: TuObservationWriteInput
  imageIds?: string[]
}) {
  const admin = createSupabaseAdminClient()
  if (input.observationId) {
    const { data: existing, error: existingError } = await admin
      .from('tu_observations')
      .select('id,org_id,inspection_id')
      .eq('id', input.observationId)
      .maybeSingle()
    if (existingError) {
      throw new Error(existingError.message ?? 'Kunde inte verifiera fältanteckningen.')
    }
    if (existing) {
      const existingRow = existing as { id: string; org_id: string; inspection_id: string }
      if (existingRow.org_id !== input.orgId || existingRow.inspection_id !== input.inspectionId) {
        throw new Error('TU_OBSERVATION_ID_CONFLICT')
      }
      return updateTuObservation({
        ...input,
        observationId: input.observationId,
      })
    }
  }

  const { data, error } = await admin
    .from('tu_observations')
    .insert({
      ...(input.observationId ? { id: input.observationId } : {}),
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      created_by: input.userId,
      ...observationPayload(input.values, input.userId),
    })
    .select('id')
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte spara observationen.')
  const observationId = String((data as { id: string }).id)
  try {
    await replaceTuObservationImages({ ...input, observationId, imageIds: input.imageIds ?? [] })
  } catch (imageError) {
    await admin
      .from('tu_observations')
      .delete()
      .eq('id', observationId)
      .eq('org_id', input.orgId)
      .eq('inspection_id', input.inspectionId)
    throw imageError
  }
  return getTuObservation({ ...input, observationId })
}

export async function updateTuObservation(input: {
  orgId: string
  inspectionId: string
  observationId: string
  userId: string
  values: TuObservationWriteInput
  imageIds?: string[]
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('tu_observations')
    .update(observationPayload(input.values, input.userId))
    .eq('id', input.observationId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte uppdatera observationen.')
  if (!data) throw new Error('TU_OBSERVATION_NOT_FOUND')
  if (input.imageIds) await replaceTuObservationImages({ ...input, imageIds: input.imageIds })
  return getTuObservation(input)
}

export async function replaceTuObservationImages(input: {
  orgId: string
  inspectionId: string
  observationId: string
  userId: string
  imageIds: string[]
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('replace_tu_observation_images', {
    p_org_id: input.orgId,
    p_inspection_id: input.inspectionId,
    p_observation_id: input.observationId,
    p_image_ids: [...new Set(input.imageIds)],
    p_created_by: input.userId,
  })
  if (error) throw new Error(error.message ?? 'Kunde inte koppla bilder till observationen.')
}

export async function deleteTuObservation(input: {
  orgId: string
  inspectionId: string
  observationId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data: existing, error: readError } = await admin
    .from('tu_observations')
    .select('id,audio_storage_bucket,audio_storage_path')
    .eq('id', input.observationId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .maybeSingle()
  if (readError) throw new Error(readError.message ?? 'Kunde inte läsa observationen.')
  if (!existing) throw new Error('TU_OBSERVATION_NOT_FOUND')

  const { error } = await admin
    .from('tu_observations')
    .delete()
    .eq('id', input.observationId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
  if (error) throw new Error(error.message ?? 'Kunde inte ta bort observationen.')

  const audioRow = existing as unknown as {
    audio_storage_bucket: string | null
    audio_storage_path: string | null
  }
  if (audioRow.audio_storage_bucket && audioRow.audio_storage_path) {
    const { error: storageError } = await admin.storage
      .from(audioRow.audio_storage_bucket)
      .remove([audioRow.audio_storage_path])
    if (storageError) {
      console.error('[tu.evidence] failed to remove observation audio', {
        observationId: input.observationId,
        error: storageError.message,
      })
    }
  }
}

export async function createTuMeasurement(input: {
  orgId: string
  inspectionId: string
  userId: string
  values: TuMeasurementWriteInput
}) {
  await assertObservationOwnership({
    orgId: input.orgId,
    inspectionId: input.inspectionId,
    observationId: input.values.observationId,
  })
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('tu_measurements')
    .insert({
      org_id: input.orgId,
      inspection_id: input.inspectionId,
      observation_id: nullableText(input.values.observationId),
      location: nullableText(input.values.location),
      measurement_type: input.values.measurementType.trim(),
      value_text: input.values.valueText.trim(),
      unit: nullableText(input.values.unit),
      method: nullableText(input.values.method),
      instrument: nullableText(input.values.instrument),
      note: nullableText(input.values.note),
      measured_at: isoOrNow(input.values.measuredAt),
      created_by: input.userId,
      updated_by: input.userId,
    })
    .select(MEASUREMENT_COLUMNS)
    .single()

  if (error || !data) throw new Error(error?.message ?? 'Kunde inte spara mätvärdet.')
  return mapMeasurement(data as unknown as TuMeasurementRow)
}

export async function updateTuMeasurement(input: {
  orgId: string
  inspectionId: string
  measurementId: string
  userId: string
  values: TuMeasurementWriteInput
}) {
  await assertObservationOwnership({
    orgId: input.orgId,
    inspectionId: input.inspectionId,
    observationId: input.values.observationId,
  })
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('tu_measurements')
    .update({
      observation_id: nullableText(input.values.observationId),
      location: nullableText(input.values.location),
      measurement_type: input.values.measurementType.trim(),
      value_text: input.values.valueText.trim(),
      unit: nullableText(input.values.unit),
      method: nullableText(input.values.method),
      instrument: nullableText(input.values.instrument),
      note: nullableText(input.values.note),
      measured_at: isoOrNow(input.values.measuredAt),
      updated_by: input.userId,
    })
    .eq('id', input.measurementId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
    .select(MEASUREMENT_COLUMNS)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte uppdatera mätvärdet.')
  if (!data) throw new Error('TU_MEASUREMENT_NOT_FOUND')
  return mapMeasurement(data as unknown as TuMeasurementRow)
}

export async function deleteTuMeasurement(input: {
  orgId: string
  inspectionId: string
  measurementId: string
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin
    .from('tu_measurements')
    .delete()
    .eq('id', input.measurementId)
    .eq('org_id', input.orgId)
    .eq('inspection_id', input.inspectionId)
  if (error) throw new Error(error.message ?? 'Kunde inte ta bort mätvärdet.')
}
