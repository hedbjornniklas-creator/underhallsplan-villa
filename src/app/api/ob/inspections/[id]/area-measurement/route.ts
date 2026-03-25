import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'

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

function isMissingLockColumnError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('locked_at') ||
    normalized.includes('42703') ||
    normalized.includes('column')
  )
}

async function loadProfileSnapshot(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string,
  userId: string
) {
  const profileResult = await admin
    .from('profiles')
    .select(
      'full_name,company_name,company_orgno,company_address,company_postal_code,company_city,phone,email,avatar_path'
    )
    .eq('id', userId)
    .maybeSingle()

  if (profileResult.error) {
    throw new Error(profileResult.error.message ?? 'Kunde inte lasa profil.')
  }

  const { summary } = await resolveInspectorCertificationSummary(admin, {
    profileId: userId,
    orgId,
  })

  return {
    full_name: (profileResult.data?.full_name as string | null) ?? null,
    company_name: (profileResult.data?.company_name as string | null) ?? null,
    company_orgno: (profileResult.data?.company_orgno as string | null) ?? null,
    company_address: (profileResult.data?.company_address as string | null) ?? null,
    company_postal_code: (profileResult.data?.company_postal_code as string | null) ?? null,
    company_city: (profileResult.data?.company_city as string | null) ?? null,
    phone: (profileResult.data?.phone as string | null) ?? null,
    email: (profileResult.data?.email as string | null) ?? null,
    avatar_path: (profileResult.data?.avatar_path as string | null) ?? null,
    sbr_group: summary.sbr_group,
    membership_number: summary.membership_number,
    sbr_status: summary.sbr_status,
    certification_number: summary.certification_number,
    is_sbr_diplomerad_areamatning: summary.is_sbr_diplomerad_areamatning,
  }
}

function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase()
}

function normalizeToTokenArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? '').trim())
      .filter((item) => item.length > 0)
  }
  if (value === null || value === undefined) return []
  const token = String(value).trim()
  return token.length > 0 ? [token] : []
}

async function loadOverviewItemFirstLabel(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string,
  itemKey: string
) {
  const itemResult = await admin
    .from('settings_overview_items')
    .select('id')
    .eq('key', itemKey)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (itemResult.error || !itemResult.data?.id) return null
  const overviewItemId = String(itemResult.data.id)

  const [selectionResult, groupsResult] = await Promise.all([
    admin
      .from('inspection_overview_selections')
      .select('values')
      .eq('inspection_id', inspectionId)
      .eq('overview_item_id', overviewItemId)
      .order('set_index', { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from('settings_overview_groups')
      .select('id,key,sort_order')
      .eq('overview_item_id', overviewItemId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (selectionResult.error || groupsResult.error || !selectionResult.data?.values) {
    return null
  }

  const values = selectionResult.data.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null
  const valuesRecord = values as Record<string, unknown>
  const groups = Array.isArray(groupsResult.data)
    ? (groupsResult.data as Array<{ id: string; key: string; sort_order: number | null }>)
    : []
  if (groups.length === 0) return null

  const groupIds = groups.map((group) => group.id)
  const optionsResult =
    groupIds.length > 0
      ? await admin
          .from('settings_overview_options')
          .select('group_id,value,label,sort_order')
          .in('group_id', groupIds)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
      : { data: [], error: null as unknown }

  if (optionsResult.error) return null

  const labelsByGroup = new Map<string, Map<string, string>>()
  const options = Array.isArray(optionsResult.data)
    ? (optionsResult.data as Array<{ group_id: string; value: string; label: string }>)
    : []
  options.forEach((option) => {
    const lookup = normalizeLookupKey(option.value)
    if (!labelsByGroup.has(option.group_id)) {
      labelsByGroup.set(option.group_id, new Map())
    }
    labelsByGroup.get(option.group_id)!.set(lookup, option.label)
  })

  for (const group of groups) {
    const rawValue = valuesRecord[group.key]
    const tokens = normalizeToTokenArray(rawValue)
    if (tokens.length === 0) continue

    const labelLookup = labelsByGroup.get(group.id)
    const firstToken = tokens[0]
    const firstLabel = labelLookup?.get(normalizeLookupKey(firstToken)) ?? firstToken
    const normalized = String(firstLabel ?? '').trim()
    if (normalized.length > 0) return normalized
  }

  return null
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

    const [profile, buildingTypeDefault, buildingYearDefault] = await Promise.all([
      loadProfileSnapshot(admin, org.orgId, org.userId),
      loadOverviewItemFirstLabel(admin, id, 'building_type'),
      loadOverviewItemFirstLabel(admin, id, 'building_year'),
    ])

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
          defaults: {
            building_type: buildingTypeDefault,
            building_year: buildingYearDefault,
          },
        })
      }
      throw new Error(message || 'Kunde inte lasa areamatning.')
    }

    if (!measurement) {
      return NextResponse.json({
        unsupported: false,
        measurement: null,
        rows: [],
        profile,
        defaults: {
          building_type: buildingTypeDefault,
          building_year: buildingYearDefault,
        },
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
          defaults: {
            building_type: buildingTypeDefault,
            building_year: buildingYearDefault,
          },
        })
      }
      throw new Error(message || 'Kunde inte lasa areamatningsrader.')
    }

    return NextResponse.json({
      unsupported: false,
      measurement,
      rows: Array.isArray(rows) ? rows : [],
      profile,
      defaults: {
        building_type: buildingTypeDefault,
        building_year: buildingYearDefault,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte lasa areamatning.', 500)
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

    const { data: inspectionRow, error: inspectionError } = await admin
      .from('inspections')
      .select('id,locked_at')
      .eq('id', id)
      .maybeSingle()

    if (inspectionError) {
      const message = inspectionError.message ?? ''
      if (!isMissingLockColumnError(message)) {
        throw new Error(message || 'Kunde inte lasa besiktning.')
      }
    } else if (!inspectionRow) {
      return jsonError('Besiktningen hittades inte.', 404)
    } else if (inspectionRow.locked_at) {
      return jsonError('Besiktningen ar last och kan inte uppdateras.', 409)
    }

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
      const message = upsertError?.message ?? 'Kunde inte spara areamatning.'
      if (isMissingTableError(message)) {
        return jsonError('Areamatning ar inte aktiverad i databasen an.', 409)
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
        return jsonError('Areamatning ar inte aktiverad i databasen an.', 409)
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
        const message = insertError.message ?? 'Kunde inte spara areamatningsrader.'
        if (isMissingTableError(message)) {
          return jsonError('Areamatning ar inte aktiverad i databasen an.', 409)
        }
        throw new Error(message)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte spara areamatning.', 500)
  }
}
