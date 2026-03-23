import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AreaMeasurementRowInput = {
  floor_or_part: string
  boarea_m2: number | null
  biarea_m2: number | null
  sort_order: number
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function isMissingTableError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('inspection_area_measurements') ||
    normalized.includes('inspection_area_measurement_rows') ||
    normalized.includes('42p01') ||
    normalized.includes('does not exist')
  )
}

async function loadProfileSnapshot(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  userId: string
) {
  const baseSelect = 'full_name,company_name,membership_number'
  const selectWithAreaFlag = `${baseSelect},is_sbr_diplomerad_areamatning`

  const withFlag = await admin
    .from('profiles')
    .select(selectWithAreaFlag)
    .eq('id', userId)
    .maybeSingle()

  if (!withFlag.error) {
    return {
      full_name: (withFlag.data?.full_name as string | null) ?? null,
      company_name: (withFlag.data?.company_name as string | null) ?? null,
      membership_number: (withFlag.data?.membership_number as string | null) ?? null,
      is_sbr_diplomerad_areamatning:
        (withFlag.data?.is_sbr_diplomerad_areamatning as boolean | null) ?? false,
    }
  }

  const missingColumn = String(withFlag.error.message ?? '')
    .toLowerCase()
    .includes('is_sbr_diplomerad_areamatning')

  if (!missingColumn) {
    throw new Error(withFlag.error.message ?? 'Kunde inte läsa profil.')
  }

  const fallback = await admin
    .from('profiles')
    .select(baseSelect)
    .eq('id', userId)
    .maybeSingle()

  if (fallback.error) {
    throw new Error(fallback.error.message ?? 'Kunde inte läsa profil.')
  }

  return {
    full_name: (fallback.data?.full_name as string | null) ?? null,
    company_name: (fallback.data?.company_name as string | null) ?? null,
    membership_number: (fallback.data?.membership_number as string | null) ?? null,
    is_sbr_diplomerad_areamatning: false,
  }
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed =
    typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Number(parsed.toFixed(2))
}

function normalizeInteger(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(parsed)) return null
  return Math.round(parsed)
}

function normalizeDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return null
  return normalized
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized.length > 0 ? normalized : null
}

function normalizeRows(input: unknown): AreaMeasurementRowInput[] {
  if (!Array.isArray(input)) return []
  const rows: AreaMeasurementRowInput[] = []

  input.forEach((rawRow, index) => {
    if (!rawRow || typeof rawRow !== 'object') return
    const row = rawRow as Record<string, unknown>
    const floorOrPart = normalizeText(row.floor_or_part)
    if (!floorOrPart) return

    rows.push({
      floor_or_part: floorOrPart,
      boarea_m2: normalizeNumber(row.boarea_m2),
      biarea_m2: normalizeNumber(row.biarea_m2),
      sort_order: index + 1,
    })
  })

  return rows
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    const profile = await loadProfileSnapshot(admin, org.userId)

    const { data: measurement, error: measurementError } = await admin
      .from('inspection_area_measurements')
      .select(
        'id,inspection_id,org_id,building_type,building_year,extension_note,object_other,measurement_instrument,comment,other_notes,place_name,signed_date,created_at,updated_at'
      )
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)
      .maybeSingle()

    if (measurementError) {
      const message = measurementError.message ?? ''
      if (isMissingTableError(message)) {
        return NextResponse.json({
          unsupported: true,
          measurement: null,
          rows: [],
          profile,
        })
      }
      throw new Error(message || 'Kunde inte läsa areamätning.')
    }

    if (!measurement) {
      return NextResponse.json({
        unsupported: false,
        measurement: null,
        rows: [],
        profile,
      })
    }

    const { data: rows, error: rowsError } = await admin
      .from('inspection_area_measurement_rows')
      .select('id,area_measurement_id,inspection_id,org_id,floor_or_part,boarea_m2,biarea_m2,sort_order')
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)
      .order('sort_order', { ascending: true })

    if (rowsError) {
      const message = rowsError.message ?? ''
      if (isMissingTableError(message)) {
        return NextResponse.json({
          unsupported: true,
          measurement: null,
          rows: [],
          profile,
        })
      }
      throw new Error(message || 'Kunde inte läsa areamätningsrader.')
    }

    return NextResponse.json({
      unsupported: false,
      measurement,
      rows: Array.isArray(rows) ? rows : [],
      profile,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte läsa areamätning.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return jsonError('Ogiltig payload.', 400)

    const payload = {
      inspection_id: id,
      org_id: org.orgId,
      building_type: normalizeText(body.building_type),
      building_year: normalizeInteger(body.building_year),
      extension_note: normalizeText(body.extension_note),
      object_other: normalizeText(body.object_other),
      measurement_instrument: normalizeText(body.measurement_instrument),
      comment: normalizeText(body.comment),
      other_notes: normalizeText(body.other_notes),
      place_name: normalizeText(body.place_name),
      signed_date: normalizeDate(body.signed_date),
      updated_at: new Date().toISOString(),
    }

    const { data: upserted, error: upsertError } = await admin
      .from('inspection_area_measurements')
      .upsert(payload, { onConflict: 'inspection_id' })
      .select('id')
      .single()

    if (upsertError || !upserted?.id) {
      const message = upsertError?.message ?? 'Kunde inte spara areamätning.'
      if (isMissingTableError(message)) {
        return jsonError('Areamätning är inte aktiverad i databasen ännu.', 409)
      }
      throw new Error(message)
    }

    const rows = normalizeRows(body.rows)
    const areaMeasurementId = String(upserted.id)

    const { error: deleteError } = await admin
      .from('inspection_area_measurement_rows')
      .delete()
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)

    if (deleteError) {
      const message = deleteError.message ?? 'Kunde inte uppdatera rader.'
      if (isMissingTableError(message)) {
        return jsonError('Areamätning är inte aktiverad i databasen ännu.', 409)
      }
      throw new Error(message)
    }

    if (rows.length > 0) {
      const insertRows = rows.map((row) => ({
        area_measurement_id: areaMeasurementId,
        inspection_id: id,
        org_id: org.orgId,
        floor_or_part: row.floor_or_part,
        boarea_m2: row.boarea_m2,
        biarea_m2: row.biarea_m2,
        sort_order: row.sort_order,
      }))

      const { error: insertError } = await admin
        .from('inspection_area_measurement_rows')
        .insert(insertRows)

      if (insertError) {
        const message = insertError.message ?? 'Kunde inte spara areamätningsrader.'
        if (isMissingTableError(message)) {
          return jsonError('Areamätning är inte aktiverad i databasen ännu.', 409)
        }
        throw new Error(message)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte spara areamätning.', 500)
  }
}
