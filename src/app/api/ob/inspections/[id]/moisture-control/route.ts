import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type MoistureControlRowInput = {
  location_label: string
  building_part: string | null
  measurement_type: 'rf' | 'fk' | 'other'
  measurement_value: number | null
  temperature_c: number | null
  note: string | null
  critical_level: 'under' | 'over'
  sort_order: number
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function isMissingTableError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('inspection_moisture_controls') ||
    normalized.includes('inspection_moisture_control_rows') ||
    normalized.includes('42p01') ||
    normalized.includes('does not exist')
  )
}

function isMissingLockColumnError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('locked_at') || normalized.includes('42703') || normalized.includes('column')
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
    throw new Error(profileResult.error.message ?? 'Kunde inte läsa profil.')
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
    certification_items: summary.all_selected_items,
  }
}

function normalizeLookupKey(value: string) {
  return value.trim().toLowerCase()
}

function normalizeSearchKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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
  const resolveOverviewItemId = async (
    preferredKeys: string[],
    fuzzyTokens: string[]
  ): Promise<string | null> => {
    const { data, error } = await admin
      .from('settings_overview_items')
      .select('id,key,label,sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })

    if (error || !Array.isArray(data)) return null
    const rows = data as Array<{ id: string; key: string; label: string | null; sort_order: number | null }>
    if (rows.length === 0) return null

    const preferredLookup = new Set(preferredKeys.map((key) => normalizeSearchKey(key)))
    const fuzzyLookup = fuzzyTokens.map((token) => normalizeSearchKey(token)).filter(Boolean)

    const exact = rows.find((row) => preferredLookup.has(normalizeSearchKey(String(row.key ?? ''))))
    if (exact) return exact.id

    const keyContainsPreferred = rows.find((row) => {
      const key = normalizeSearchKey(String(row.key ?? ''))
      return Array.from(preferredLookup).some((needle) => key.includes(needle))
    })
    if (keyContainsPreferred) return keyContainsPreferred.id

    const keyOrLabelContainsFuzzy = rows.find((row) => {
      const key = normalizeSearchKey(String(row.key ?? ''))
      const label = normalizeSearchKey(String(row.label ?? ''))
      return fuzzyLookup.some((needle) => key.includes(needle) || label.includes(needle))
    })
    if (keyOrLabelContainsFuzzy) return keyOrLabelContainsFuzzy.id

    return null
  }

  const pickByKnownKey = (key: string) => {
    const normalized = normalizeSearchKey(key)
    if (normalized === 'building_type') {
      return resolveOverviewItemId(
        ['building_type', 'building_form'],
        ['byggnadstyp', 'byggnad', 'typ', 'building type']
      )
    }
    if (normalized === 'building_year') {
      return resolveOverviewItemId(
        ['building_year', 'year_built', 'byggar', 'byggnadsar'],
        ['byggar', 'byggnadsar', 'byggar', 'year']
      )
    }
    if (normalized === 'heating') {
      return resolveOverviewItemId(['heating'], ['uppvarmning', 'varme', 'heating'])
    }
    if (normalized === 'ventilation') {
      return resolveOverviewItemId(['ventilation'], ['ventilation', 'vent'])
    }
    return resolveOverviewItemId([key], [key])
  }

  const overviewItemId = await pickByKnownKey(itemKey)
  if (!overviewItemId) return null

  const itemResult = await admin
    .from('settings_overview_items')
    .select('id')
    .eq('id', overviewItemId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (itemResult.error || !itemResult.data?.id) return null

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

  if (selectionResult.error || groupsResult.error || !selectionResult.data?.values) return null

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

async function loadBuildingYearSummaryFromForutsattningar(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string
) {
  const candidateKeys = ['building_year', 'year_built', 'byggar', 'byggnadsar']
  const { data: allItems, error: allItemsError } = await admin
    .from('settings_overview_items')
    .select('id,key,label,sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (allItemsError || !Array.isArray(allItems)) return null

  const candidates = (allItems as Array<{ id: string; key: string; label: string | null }>)
    .map((row) => ({
      id: row.id,
      key: normalizeSearchKey(String(row.key ?? '')),
      label: normalizeSearchKey(String(row.label ?? '')),
    }))

  const exact = candidates.find((row) =>
    candidateKeys.some((key) => row.key === normalizeSearchKey(key))
  )
  const fuzzy =
    exact ??
    candidates.find(
      (row) =>
        row.key.includes('bygg') ||
        row.key.includes('year') ||
        row.label.includes('bygg') ||
        row.label.includes('year')
    )

  const itemResult = fuzzy ? { data: { id: fuzzy.id }, error: null } : { data: null, error: null }

  if (itemResult.error || !itemResult.data?.id) return null
  const overviewItemId = String(itemResult.data.id)

  const [selectionResult, groupsResult] = await Promise.all([
    admin
      .from('inspection_overview_selections')
      .select('values,set_index')
      .eq('inspection_id', inspectionId)
      .eq('overview_item_id', overviewItemId)
      .order('set_index', { ascending: true }),
    admin
      .from('settings_overview_groups')
      .select('id,key,sort_order')
      .eq('overview_item_id', overviewItemId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (selectionResult.error || groupsResult.error) return null
  const selections = Array.isArray(selectionResult.data)
    ? (selectionResult.data as Array<{ values: unknown; set_index: number }>)
    : []
  if (selections.length === 0) return null

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

  const partGroup = groups.find((group) => normalizeLookupKey(group.key) === 'part') ?? null
  const yearGroup =
    groups.find((group) => normalizeLookupKey(group.key).includes('year')) ??
    groups.find((group) => normalizeLookupKey(group.key).includes('ar')) ??
    null

  const resolveFirstForGroup = (
    valuesRecord: Record<string, unknown>,
    group: { id: string; key: string } | null
  ) => {
    if (!group) return null
    const tokens = normalizeToTokenArray(valuesRecord[group.key])
    if (tokens.length === 0) return null
    const lookup = labelsByGroup.get(group.id)
    const first = tokens[0]
    const label = lookup?.get(normalizeLookupKey(first)) ?? first
    const normalized = String(label ?? '').trim()
    return normalized.length > 0 ? normalized : null
  }

  const lines: string[] = []
  for (const selection of selections) {
    const values = selection.values
    if (!values || typeof values !== 'object' || Array.isArray(values)) continue
    const valuesRecord = values as Record<string, unknown>

    const partLabel = resolveFirstForGroup(valuesRecord, partGroup)
    let yearLabel = resolveFirstForGroup(valuesRecord, yearGroup)
    if (!yearLabel) {
      for (const group of groups) {
        if (partGroup && group.id === partGroup.id) continue
        yearLabel = resolveFirstForGroup(valuesRecord, group)
        if (yearLabel) break
      }
    }

    if (!partLabel && !yearLabel) continue
    if (partLabel && yearLabel) {
      lines.push(`${partLabel}: ${yearLabel}`)
    } else {
      lines.push(partLabel ?? yearLabel ?? '')
    }
  }

  const cleaned = lines.map((line) => line.trim()).filter((line) => line.length > 0)
  return cleaned.length > 0 ? cleaned.join(', ') : null
}

function normalizeNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return Number(parsed.toFixed(2))
}

function normalizeSignedNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(parsed)) return null
  return Number(parsed.toFixed(2))
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

function normalizeMeasurementType(value: unknown): 'rf' | 'fk' | 'other' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'rf') return 'rf'
  if (normalized === 'fk') return 'fk'
  return 'other'
}

function normalizeCriticalLevel(value: unknown): 'under' | 'over' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'over') return 'over'
  return 'under'
}

function normalizeRows(input: unknown): MoistureControlRowInput[] {
  if (!Array.isArray(input)) return []
  const rows: MoistureControlRowInput[] = []

  input.forEach((rawRow, index) => {
    if (!rawRow || typeof rawRow !== 'object') return
    const row = rawRow as Record<string, unknown>
    const locationLabel = normalizeText(row.location_label)
    if (!locationLabel) return

    rows.push({
      location_label: locationLabel,
      building_part: normalizeText(row.building_part),
      measurement_type: normalizeMeasurementType(row.measurement_type),
      measurement_value: normalizeNumber(row.measurement_value),
      temperature_c: normalizeSignedNumber(row.temperature_c),
      note: normalizeText(row.note),
      critical_level: normalizeCriticalLevel(row.critical_level),
      sort_order: index + 1,
    })
  })

  return rows
}

async function loadInspectionStructureDefaults(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string
) {
  const [
    { data: inspection },
    buildingType,
    buildingYearSummary,
    heatingFromOverview,
    ventilationFromOverview,
    { data: conditions },
  ] = await Promise.all([
    admin.from('inspections').select('property_id').eq('id', inspectionId).maybeSingle(),
    loadOverviewItemFirstLabel(admin, inspectionId, 'building_type'),
    loadBuildingYearSummaryFromForutsattningar(admin, inspectionId),
    loadOverviewItemFirstLabel(admin, inspectionId, 'heating'),
    loadOverviewItemFirstLabel(admin, inspectionId, 'ventilation'),
    admin
      .from('inspection_conditions')
      .select('building_type,building_form,building_year,heating,ventilation')
      .eq('inspection_id', inspectionId)
      .maybeSingle(),
  ])

  const propertyId = String(inspection?.property_id ?? '').trim()
  let snapshotHeating: string | null = null
  let snapshotVentilation: string | null = null
  let propertyYearBuilt: string | null = null

  const normalizeTextValue = (value: unknown) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const normalizeYearValue = (value: unknown) => {
    if (value === null || value === undefined) return null
    if (typeof value === 'number' && Number.isFinite(value)) return String(Math.round(value))
    const text = String(value).trim()
    return text.length > 0 ? text : null
  }

  if (propertyId) {
    const [{ data: snapshot }, { data: property }] = await Promise.all([
      admin
        .from('ob_property_snapshot')
        .select('heating,ventilation')
        .eq('inspection_id', inspectionId)
        .maybeSingle(),
      admin
        .from('properties')
        .select('heating,ventilation,year_built')
        .eq('id', propertyId)
        .maybeSingle(),
    ])

    snapshotHeating = (snapshot?.heating as string | null) ?? (property?.heating as string | null) ?? null
    snapshotVentilation =
      (snapshot?.ventilation as string | null) ?? (property?.ventilation as string | null) ?? null
    propertyYearBuilt = normalizeYearValue((property as { year_built?: unknown } | null)?.year_built)
  }

  const conditionBuildingType =
    normalizeTextValue(conditions?.building_type) ??
    normalizeTextValue(conditions?.building_form) ??
    null
  const conditionBuildingYear = normalizeYearValue(conditions?.building_year)
  const conditionHeating = normalizeTextValue(conditions?.heating)
  const conditionVentilation = normalizeTextValue(conditions?.ventilation)

  const parseBuildingYearDefaults = (summary: string | null) => {
    const raw = String(summary ?? '').trim()
    if (!raw) return { buildingYear: null as string | null, extensionNote: null as string | null }
    const parts = raw
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)

    if (parts.length === 0) {
      return { buildingYear: null as string | null, extensionNote: null as string | null }
    }

    const huvudbyggnadPart = parts.find((part) =>
      part.toLowerCase().startsWith('huvudbyggnad')
    )
    const mainPart = huvudbyggnadPart ?? parts[0]
    const buildingYear =
      mainPart.includes(':') ? mainPart.split(':').slice(1).join(':').trim() || mainPart : mainPart
    const extensionParts = parts.filter((part) => part !== mainPart)
    const extensionNote = extensionParts.length > 0 ? extensionParts.join(', ') : null

    return { buildingYear, extensionNote }
  }

  const parsedBuildingYear = parseBuildingYearDefaults(buildingYearSummary)

  return {
    building_type: buildingType ?? conditionBuildingType,
    building_year: parsedBuildingYear.buildingYear ?? conditionBuildingYear ?? propertyYearBuilt,
    extension_note: parsedBuildingYear.extensionNote,
    heating: heatingFromOverview ?? conditionHeating ?? snapshotHeating,
    ventilation: ventilationFromOverview ?? conditionVentilation ?? snapshotVentilation,
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    const [profile, defaults] = await Promise.all([
      loadProfileSnapshot(admin, org.orgId, org.userId),
      loadInspectionStructureDefaults(admin, id),
    ])

    const { data: control, error: controlError } = await admin
      .from('inspection_moisture_controls')
      .select(
        'id,inspection_id,org_id,building_type,building_year,extension_note,heating,ventilation,object_other,measurement_instrument,comment,place_name,signed_date,created_at,updated_at'
      )
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)
      .maybeSingle()

    if (controlError) {
      const message = controlError.message ?? ''
      if (isMissingTableError(message)) {
        return NextResponse.json({
          unsupported: true,
          control: null,
          rows: [],
          profile,
          defaults,
        })
      }
      throw new Error(message || 'Kunde inte läsa fuktkontroll.')
    }

    if (!control) {
      return NextResponse.json({
        unsupported: false,
        control: null,
        rows: [],
        profile,
        defaults,
      })
    }

    const { data: rows, error: rowsError } = await admin
      .from('inspection_moisture_control_rows')
      .select(
        'id,moisture_control_id,inspection_id,org_id,location_label,building_part,measurement_type,measurement_value,temperature_c,note,critical_level,sort_order'
      )
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)
      .order('sort_order', { ascending: true })

    if (rowsError) {
      const message = rowsError.message ?? ''
      if (isMissingTableError(message)) {
        return NextResponse.json({
          unsupported: true,
          control: null,
          rows: [],
          profile,
          defaults,
        })
      }
      throw new Error(message || 'Kunde inte läsa fuktkontrollrader.')
    }

    return NextResponse.json({
      unsupported: false,
      control,
      rows: Array.isArray(rows) ? rows : [],
      profile,
      defaults,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte läsa fuktkontroll.', 500)
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
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
        throw new Error(message || 'Kunde inte läsa besiktning.')
      }
    } else if (!inspectionRow) {
      return jsonError('Besiktningen hittades inte.', 404)
    } else if (inspectionRow.locked_at) {
      return jsonError('Besiktningen är låst och kan inte uppdateras.', 409)
    }

    const payload = {
      inspection_id: id,
      org_id: org.orgId,
      building_type: normalizeText(body.building_type),
      building_year: normalizeText(body.building_year),
      extension_note: normalizeText(body.extension_note),
      heating: normalizeText(body.heating),
      ventilation: normalizeText(body.ventilation),
      object_other: normalizeText(body.object_other),
      measurement_instrument: normalizeText(body.measurement_instrument),
      comment: normalizeText(body.comment),
      place_name: normalizeText(body.place_name),
      signed_date: normalizeDate(body.signed_date),
      updated_at: new Date().toISOString(),
    }

    const { data: upserted, error: upsertError } = await admin
      .from('inspection_moisture_controls')
      .upsert(payload, { onConflict: 'inspection_id' })
      .select('id')
      .single()

    if (upsertError || !upserted?.id) {
      const message = upsertError?.message ?? 'Kunde inte spara fuktkontroll.'
      if (isMissingTableError(message)) {
        return jsonError('Fuktkontroll är inte aktiverad i databasen ännu.', 409)
      }
      throw new Error(message)
    }

    const rows = normalizeRows(body.rows)
    const moistureControlId = String(upserted.id)

    const { error: deleteError } = await admin
      .from('inspection_moisture_control_rows')
      .delete()
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)

    if (deleteError) {
      const message = deleteError.message ?? 'Kunde inte uppdatera rader.'
      if (isMissingTableError(message)) {
        return jsonError('Fuktkontroll är inte aktiverad i databasen ännu.', 409)
      }
      throw new Error(message)
    }

    if (rows.length > 0) {
      const insertRows = rows.map((row) => ({
        moisture_control_id: moistureControlId,
        inspection_id: id,
        org_id: org.orgId,
        location_label: row.location_label,
        building_part: row.building_part,
        measurement_type: row.measurement_type,
        measurement_value: row.measurement_value,
        temperature_c: row.temperature_c,
        note: row.note,
        critical_level: row.critical_level,
        sort_order: row.sort_order,
      }))

      const { error: insertError } = await admin.from('inspection_moisture_control_rows').insert(insertRows)

      if (insertError) {
        const message = insertError.message ?? 'Kunde inte spara fuktkontrollrader.'
        if (isMissingTableError(message)) {
          return jsonError('Fuktkontroll är inte aktiverad i databasen ännu.', 409)
        }
        throw new Error(message)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte spara fuktkontroll.', 500)
  }
}
