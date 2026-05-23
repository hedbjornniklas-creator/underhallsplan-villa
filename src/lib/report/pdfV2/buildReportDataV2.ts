import { createSupabaseServerClient } from '@/lib/supabase/server'
import { buildBuildingDataMap, buildBuildingTypeParts, renderBuildingDataTextFromTemplate } from '@/lib/report/buildingData'
import { parseScopeCodes, renderScopeText } from '@/lib/report/scopeText'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'

type ExteriorItemRow = {
  id: string
  label: string
  sort_order: number | null
}

type ExteriorObservationRow = {
  id: string
  exterior_item_id: string
  part_label: string | null
  note: string | null
  risk_text: string | null
  ftu_text: string | null
  values: Record<string, any> | null
  is_free_note?: boolean | null
  created_at?: string | null
}

type ExteriorControlItemRow = {
  id: string
  exterior_observation_id: string | null
  control_point_id: string | null
  title: string
  note: string | null
  risk_text: string | null
  ftu_text: string | null
  sort_order: number | null
  selected_outcome_id: string | null
}

type ControlPointOutcomeRow = {
  id: string
  control_point_id: string
  label: string | null
  risk_template: string | null
  ftu_template: string | null
  sort_order: number | null
  is_active: boolean | null
}

type InteriorRoomRow = {
  id: string
  floor_label: string
  room_label: string
  room_type_key: string
  note: string | null
  order_index: number | null
}

type InteriorControlItemRow = {
  id: string
  interior_room_id: string | null
  control_point_id: string | null
  title: string
  note: string | null
  risk_text: string | null
  ftu_text: string | null
  sort_order: number | null
  selected_outcome_id: string | null
}

type InspectionImageRow = {
  id: string
  control_item_id: string | null
  file_path: string | null
  sort_order: number | null
  created_at?: string | null
}

type InspectionBlock = {
  title: string
  noteText: string
  riskText: string
  ftuText: string
  photoUrls: string[]
  hasDeviations: boolean
}

type AreaMeasurementHeaderRow = {
  building_type: string | null
  building_year: number | null
  object_other: string | null
  measurement_instrument: string | null
  comment: string | null
  other_notes: string | null
  place_name: string | null
  signed_date: string | null
}

type AreaMeasurementDataRow = {
  floor_or_part: string | null
  boarea_m2: number | null
  biarea_m2: number | null
  sort_order: number | null
}

type MoistureControlHeaderRow = {
  building_type: string | null
  building_year: string | null
  extension_note: string | null
  heating: string | null
  ventilation: string | null
  object_other: string | null
  measurement_instrument: string | null
  comment: string | null
  place_name: string | null
  signed_date: string | null
}

type MoistureControlDataRow = {
  id: string
  location_label: string | null
  building_part: string | null
  measurement_type: 'rf' | 'fk' | 'other' | string | null
  measurement_value: number | null
  temperature_c: number | null
  note: string | null
  critical_level: 'under' | 'over' | string | null
  sort_order: number | null
}

type MoistureControlImageRow = {
  id: string
  moisture_control_row_id: string | null
  file_path: string | null
  sort_order: number | null
}

export type ReportDataV2 = {
  mock: Record<string, any>
}

export async function buildReportDataV2(params: {
  propertyId?: string | null
  inspectionId: string
}): Promise<ReportDataV2> {
  const resolvedParams = params
const supabase: any = createSupabaseServerClient()

  const fallback = '--'
  const valueOrFallback = (value: string | null | undefined, alt = fallback) => {
    if (value === null || value === undefined) return alt
    const trimmed = String(value).trim()
    return trimmed.length > 0 ? trimmed : alt
  }
  const trimText = (value: string | null | undefined) => (value ?? '').trim()
  const formatDateOnly = (value: string | null | undefined) => {
    const raw = (value ?? '').trim()
    if (!raw) return ''
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw
    if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) return raw.slice(0, 10)
    const parsed = new Date(raw)
    if (Number.isNaN(parsed.getTime())) return raw
    return parsed.toISOString().slice(0, 10)
  }
  const composePlaceDate = (place: string, date: string) => {
    if (place !== fallback && date !== fallback) return `${place}, ${date}`
    if (place !== fallback) return place
    if (date !== fallback) return date
    return fallback
  }
  const isMissingRelationError = (error: unknown, relationNames: string[]) => {
    const message = String((error as { message?: unknown } | null)?.message ?? '').toLowerCase()
    return (
      message.includes('42p01') ||
      message.includes('does not exist') ||
      relationNames.some((relationName) => message.includes(relationName.toLowerCase()))
    )
  }
  const formatSquareMeters = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '--'
    return `${Number(value).toFixed(2)} m\u00b2`
  }
  const formatMeasurementValue = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '--'
    return Number(value).toFixed(2)
  }
  const measurementTypeLabel = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (normalized === 'rf') return 'RF'
    if (normalized === 'fk') return 'FK'
    if (normalized === 'indication') return 'Fuktindikering'
    return 'Annat'
  }
  const isMoistureIndicationType = (value: string | null | undefined) =>
    String(value ?? '').trim().toLowerCase() === 'indication'
  const criticalLevelLabel = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    return normalized === 'over' ? '\u00d6ver kritisk niv\u00e5' : 'Under kritisk niv\u00e5'
  }
  const moistureAssessmentLabel = (
    measurementType: string | null | undefined,
    criticalLevel: string | null | undefined
  ) => {
    if (isMoistureIndicationType(measurementType)) {
      return String(criticalLevel ?? '').trim().toLowerCase() === 'over'
        ? 'F\u00f6rh\u00f6jd/avvikande indikering'
        : 'Normal/ingen avvikande indikering'
    }
    return criticalLevelLabel(criticalLevel)
  }
  const normalizeSwedish = (value: string) =>
    String(value ?? '')
      // Double-encoded mojibake (UTF-8 -> Latin-1 -> UTF-8)
      .replace(/\u00c3\u0192\u00c2\u00a4/g, '\u00e4')
      .replace(/\u00c3\u0192\u00c2\u00a5/g, '\u00e5')
      .replace(/\u00c3\u0192\u00c2\u00b6/g, '\u00f6')
      .replace(/\u00c3\u0192\u00e2\u20ac\u017e/g, '\u00c4')
      .replace(/\u00c3\u0192\u00e2\u20ac\u00a6/g, '\u00c5')
      .replace(/\u00c3\u0192\u00e2\u20ac\u201c/g, '\u00d6')
      .replace(/\u00c3\u0192\u00c2\u00a9/g, '\u00e9')
      .replace(/\u00c3\u0192\u00e2\u20ac\u00b0/g, '\u00c9')
      // Single-encoded mojibake (UTF-8 bytes read as Latin-1/CP1252)
      .replace(/\u00c3\u00a4/g, '\u00e4')
      .replace(/\u00c3\u00a5/g, '\u00e5')
      .replace(/\u00c3\u00b6/g, '\u00f6')
      .replace(/\u00c3\u201e/g, '\u00c4')
      .replace(/\u00c3\u2026/g, '\u00c5')
      .replace(/\u00c3\u2013/g, '\u00d6')
      .replace(/\u00c3\u00a9/g, '\u00e9')
      .replace(/\u00c3\u2030/g, '\u00c9')

  const normalizeKey = (value: string | null | undefined) =>
    normalizeSwedish(String(value ?? '')).trim().toLowerCase()

  const isOtherKey = (value: string | null | undefined) => {
    const key = normalizeKey(value)
    return key === 'ovrigt' || key === '\u00f6vrigt'
  }

  const getInteriorRoomNameForReport = (room: InteriorRoomRow) => {
    const roomName = normalizeSwedish(String(room.room_label ?? '')).trim()
    if (!isOtherKey(room.room_type_key)) return roomName
    return normalizeKey(roomName) === 'allm\u00e4nt' ? '' : roomName
  }

  const normalizeInteriorFloorKey = (value: string | null | undefined) => {
    const key = normalizeKey(value)
    if (key === 'entr\u00e9plan') return 'plan1'
    return key
  }

  const getInteriorFloorRank = (value: string | null | undefined) => {
    const key = normalizeInteriorFloorKey(value)
    if (key === 'ovrigt' || key === '\u00f6vrigt') return 0
    if (key === 'k\u00e4llare') return 10
    if (key === 'k\u00e4llare_delvis') return 20
    if (key === 'suterr\u00e4ng' || key === 'souterr\u00e4ng') return 25
    if (key === 'plan1') return 30
    if (key === 'plan2') return 40
    if (key === 'plan3') return 50
    if (key === 'vind' || key.includes('vind')) return 900
    if (key.startsWith('plan')) {
      const floorNumber = Number(key.replace('plan', ''))
      if (Number.isFinite(floorNumber)) return 20 + floorNumber * 10
    }
    return 800
  }

  const floorLabelFromKey = (value: string) => {
    const key = normalizeKey(value)
    if (key === 'k\u00e4llare') return 'K\u00e4llare'
    if (key === 'k\u00e4llare_delvis') return 'K\u00e4llare'
    if (key === 'suterr\u00e4ng' || key === 'souterr\u00e4ng') return 'Suterr\u00e4ng'
    if (key === 'entr\u00e9plan' || key === 'plan1') return 'Plan 1'
    if (key === 'plan2') return 'Plan 2'
    if (key === 'plan3') return 'Plan 3'
    if (key.startsWith('plan')) return `Plan ${key.replace('plan', '')}`
    if (key === 'vind') return 'Vind'
    if (key === 'ovrigt' || key === '\u00f6vrigt') return 'Allm\u00e4nt'
    return normalizeSwedish(String(value ?? '')).trim()
  }
  const buildInspectionImageUrl = (path: string | null | undefined) => {
    if (!path) return null
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      return path
    }
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) return null
    return `${base}/storage/v1/object/public/inspection-images/${path}`
  }

  const { data: inspectionData, error: inspectionError } = await supabase
    .from('inspections')
    .select(
      'id, property_id, date, inspection_time, assignment_number, client_name, client_contact, defect_disclosures, scope, attendees, attendees_other, assignment_confirmation_delivered_date, inspection_side, cover_path, locked_at'
    )
    .eq('id', resolvedParams.inspectionId)
    .maybeSingle()
  const inspection = (inspectionData as any) ?? null

  if (inspectionError) {
    console.error('Kunde inte hÃ¤mta besiktning', inspectionError)
  }

  const resolvedPropertyId =
    resolvedParams.propertyId && resolvedParams.propertyId.trim().length > 0
      ? resolvedParams.propertyId
      : inspection?.property_id ?? null

  const { data: propertyData, error: propertyError } = resolvedPropertyId
    ? await supabase
        .from('properties')
        .select('id, name, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path')
        .eq('id', resolvedPropertyId)
        .maybeSingle()
    : { data: null, error: null }

  if (propertyError) {
    console.error('Kunde inte hÃ¤mta fastighet', propertyError)
  }

  const { data: snapshotData, error: snapshotError } = await (supabase as any)
    .from('ob_property_snapshot')
    .select(
      'inspection_id, source_property_id, name, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .maybeSingle()

  if (snapshotError) {
    console.error('Kunde inte hÃ¤mta OB-snapshot', snapshotError)
  }

  const property = {
    ...(propertyData ?? {}),
    ...(snapshotData ?? {}),
    id: (propertyData as any)?.id ?? resolvedPropertyId ?? null,
  }

  const { data: assignmentData, error: assignmentError } = await supabase
    .from('assignments')
    .select('id, brf_name, apartment_number, apartment_holder_name, accepted_at, booked_at')
    .eq('inspection_id', resolvedParams.inspectionId)
    .limit(1)
    .maybeSingle()

  if (assignmentError) {
    console.error('Kunde inte hämta uppdragsbekräftelse för lägenhetsfält', assignmentError)
  }

  const assignment = (assignmentData as any) ?? null

  if (inspection && resolvedPropertyId && inspection.property_id !== resolvedPropertyId) {
    console.error('Besiktning tillhÃ¶r inte fastighet', {
      inspectionPropertyId: inspection.property_id,
      propertyId: resolvedPropertyId,
    })
  }

  const { data: authData } = await supabase.auth.getUser()
  const userId = authData.user?.id ?? null

  const { data: profile, error: profileError } = userId
    ? await supabase
        .from('profiles')
        .select(
          'full_name, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, logo_path'
        )
        .eq('id', userId)
        .maybeSingle()
    : { data: null, error: null }

  if (profileError) {
    console.error('Kunde inte hÃ¤mta profil', profileError)
  }

  const { summary: profileCertificationSummary } = await resolveInspectorCertificationSummary(
    supabase,
    {
      profileId: userId,
    }
  )

  let frozenProfileFromSnapshot: Record<string, unknown> | null = null
  let frozenCompanyFromSnapshot: Record<string, unknown> | null = null
  if (inspection?.locked_at) {
    const { data: reportLinks, error: reportLinksError } = await (supabase as any)
      .from('inspection_report_links')
      .select('snapshot_payload,created_at')
      .eq('inspection_id', resolvedParams.inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(5)

    if (reportLinksError) {
      const message = String(reportLinksError.message ?? '')
      const normalized = message.toLowerCase()
      const schemaMissing =
        normalized.includes('snapshot_payload') ||
        normalized.includes('inspection_report_links') ||
        normalized.includes('42703') ||
        normalized.includes('42p01') ||
        normalized.includes('does not exist')
      if (!schemaMissing) {
        console.error('Kunde inte hämta låst rapportsnapshot för profil', reportLinksError)
      }
    } else if (Array.isArray(reportLinks)) {
      for (const row of reportLinks) {
        const payload = (row as Record<string, unknown>).snapshot_payload as
          | Record<string, unknown>
          | null
          | undefined
        const reportData = payload?.reportData as Record<string, unknown> | undefined
        const mock = reportData?.mock as Record<string, unknown> | undefined
        const profileFromSnapshot = mock?.profile as Record<string, unknown> | undefined
        const companyFromSnapshot = mock?.company as Record<string, unknown> | undefined
        if (profileFromSnapshot && typeof profileFromSnapshot === 'object') {
          frozenProfileFromSnapshot = profileFromSnapshot
        }
        if (companyFromSnapshot && typeof companyFromSnapshot === 'object') {
          frozenCompanyFromSnapshot = companyFromSnapshot
        }
        if (frozenProfileFromSnapshot || frozenCompanyFromSnapshot) break
      }
    }
  }

  const { data: documentRows, error: documentError } = await supabase
    .from('inspection_documents')
    .select('title, status, note')
    .eq('inspection_id', resolvedParams.inspectionId)

  if (documentError) {
    console.error('Kunde inte hÃ¤mta handlingar', documentError)
  }

  const providedDocuments =
    (documentRows as any[] | null)
      ?.filter((doc: any) => doc.status === 'present')
      .map((doc: any) => {
        const title = valueOrFallback(doc.title, 'Handling')
        const note = (doc.note ?? '').trim()
        return note ? `${title}: ${note}` : title
      })
      .filter(Boolean) ?? []

  const { data: disclosureRow, error: disclosureError } = await supabase
    .from('inspection_disclosures')
    .select('note')
    .eq('inspection_id', resolvedParams.inspectionId)
    .is('disclosure_item_id', null)
    .maybeSingle()

  if (disclosureError) {
    console.error('Kunde inte hÃ¤mta upplysningar', disclosureError)
  }

  const { data: inspectionConditions, error: conditionsError } = await supabase
    .from('inspection_conditions')
    .select(
      'furnishing_level, weather, weather_note, building_type, building_form, building_year, foundation, frame, joists, facade, windows, roof, heating, ventilation, water, sewer'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .maybeSingle()

  if (conditionsError) {
    console.error('Kunde inte hÃ¤mta fÃ¶rutsÃ¤ttningar', conditionsError)
  }

  
  const overviewItemKeys = [
    'weather',
    'building_type',
    'building_form',
    'building_year',
    'foundation',
    'structure',
    'frame',
    'joist',
    'joists',
    'facade',
    'windows',
    'roof',
    'heating',
    'ventilation',
    'water',
    'sewage',
    'sewer',
  ]

  const { data: overviewSelections, error: overviewSelectionsError } = await supabase
    .from('inspection_overview_selections')
    .select('overview_item_id, floor_key, set_index, values, note')
    .eq('inspection_id', resolvedParams.inspectionId)

  if (overviewSelectionsError) {
    console.error('Kunde inte hamta byggnadsdata-val', overviewSelectionsError)
  }

  const { data: overviewItems, error: overviewItemsError } = await supabase
    .from('settings_overview_items')
    .select('id, key, label, sort_order')
    .in('key', overviewItemKeys)
    .eq('is_active', true)

  if (overviewItemsError) {
    console.error('Kunde inte hamta byggnadsdata-installningar', overviewItemsError)
  }

  const overviewItemsRows = (overviewItems ?? []) as Array<{
    id: string
    key: string
    label: string
    sort_order: number | null
  }>
  const overviewItemIds = overviewItemsRows.map((item) => item.id)
  const { data: overviewGroups, error: overviewGroupsError } = overviewItemIds.length
    ? await supabase
        .from('settings_overview_groups')
        .select('id, overview_item_id, key, label, sort_order')
        .in('overview_item_id', overviewItemIds)
        .eq('is_active', true)
    : { data: [], error: null }

  if (overviewGroupsError) {
    console.error('Kunde inte hamta byggnadsdata-grupper', overviewGroupsError)
  }

  const overviewGroupsRows = (overviewGroups ?? []) as Array<{
    id: string
    overview_item_id: string
    key: string
    label: string
    sort_order: number | null
  }>
  const overviewGroupIds = overviewGroupsRows.map((group) => group.id)
  const { data: overviewOptions, error: overviewOptionsError } = overviewGroupIds.length
    ? await supabase
        .from('settings_overview_options')
        .select('group_id, value, label')
        .in('group_id', overviewGroupIds)
        .eq('is_active', true)
    : { data: [], error: null }

  if (overviewOptionsError) {
    console.error('Kunde inte hamta byggnadsdata-alternativ', overviewOptionsError)
  }
  const overviewOptionsRows = (overviewOptions ?? []) as Array<{
    group_id: string
    value: string
    label: string
  }>

  const propertyFaultsText = valueOrFallback(
    inspection?.defect_disclosures ?? null,
    ''
  )

  const addressParts = [
    property?.address ?? null,
    property?.postal_code ?? null,
    property?.city ?? null,
  ].filter((part) => part && String(part).trim().length > 0)

  const coverImageUrl = buildInspectionImageUrl(inspection?.cover_path ?? null)

  let fullAddress = fallback
  if (addressParts.length > 0) {
    const [street, ...rest] = addressParts
    const restLine = rest.join(' ')
    fullAddress = restLine ? `${street}, ${restLine}` : String(street)
  }

  const inspectionDate = valueOrFallback(inspection?.date ?? null)
  const inspectionTime = valueOrFallback(inspection?.inspection_time ?? null, '')
  const inspectionDateTime = inspectionTime
    ? `${inspectionDate} klockan ${inspectionTime}`
    : inspectionDate
  const scopeCodes = parseScopeCodes(inspection?.scope ?? '')
  const scopeTextRaw = renderScopeText(scopeCodes)
  const scopeText =
    inspection?.inspection_side === 'apartment' && (scopeTextRaw === '--' || !scopeTextRaw.trim())
      ? 'Invändig besiktning av lägenhet/bostadsrätt'
      : scopeTextRaw
  const assignmentDeliveredDateRaw =
    formatDateOnly(inspection?.assignment_confirmation_delivered_date ?? null) ||
    formatDateOnly((assignment as any)?.accepted_at ?? null) ||
    formatDateOnly((assignment as any)?.booked_at ?? null)
  const assignmentDeliveredDate = valueOrFallback(assignmentDeliveredDateRaw, '--')
  const assignmentConfirmationText = `En uppdragsbekräftelse med bifogad villkorsbilaga överlämnades till uppdragsgivaren den ${assignmentDeliveredDate}.`

  const parseSemicolonList = (raw: string | null | undefined) => {
    if (!raw) return []
    return raw
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
  }

  const attendeesList = parseSemicolonList(inspection?.attendees ?? null)
  const attendeesOtherList = (inspection?.attendees_other ?? '')
    .split(/\r?\n/)
    .map((line: string) => line.trim())
    .filter(Boolean)

  const attendeesLines = [...attendeesList, ...attendeesOtherList]
  const attendeesText = attendeesLines.length > 0 ? attendeesLines.join('\n') : '-'

  const buildingDataMap = buildBuildingDataMap({
    selections: overviewSelections ?? [],
    items: overviewItemsRows,
    groups: overviewGroupsRows,
    options: overviewOptionsRows,
    conditions: inspectionConditions ?? null,
  })

  const buildingTypeParts = buildBuildingTypeParts({
    selections: overviewSelections ?? [],
    items: overviewItemsRows,
    groups: overviewGroupsRows,
    options: overviewOptionsRows,
    conditions: inspectionConditions ?? null,
  })
  const buildingDataText = renderBuildingDataTextFromTemplate(
    buildingDataMap,
    undefined,
    buildingTypeParts
  )

  let areaMeasurementHeader: AreaMeasurementHeaderRow | null = null
  let areaMeasurementRows: AreaMeasurementDataRow[] = []
  const { data: areaMeasurementHeaderData, error: areaMeasurementHeaderError } = await supabase
    .from('inspection_area_measurements')
    .select(
      'building_type,building_year,object_other,measurement_instrument,comment,other_notes,place_name,signed_date'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .maybeSingle()

  if (areaMeasurementHeaderError) {
    if (
      !isMissingRelationError(areaMeasurementHeaderError, [
        'inspection_area_measurements',
        'inspection_area_measurement_rows',
      ])
    ) {
      console.error('Kunde inte hämta areamätning (header)', areaMeasurementHeaderError)
    }
  } else {
    areaMeasurementHeader = (areaMeasurementHeaderData as AreaMeasurementHeaderRow | null) ?? null
  }

  const { data: areaMeasurementRowsData, error: areaMeasurementRowsError } = await supabase
    .from('inspection_area_measurement_rows')
    .select('floor_or_part,boarea_m2,biarea_m2,sort_order')
    .eq('inspection_id', resolvedParams.inspectionId)
    .order('sort_order', { ascending: true })

  if (areaMeasurementRowsError) {
    if (
      !isMissingRelationError(areaMeasurementRowsError, [
        'inspection_area_measurements',
        'inspection_area_measurement_rows',
      ])
    ) {
      console.error('Kunde inte hämta areamätning (rader)', areaMeasurementRowsError)
    }
  } else {
    areaMeasurementRows = (areaMeasurementRowsData ?? []) as AreaMeasurementDataRow[]
  }

  const areaMeasurementBlocks: InspectionBlock[] = areaMeasurementRows.map((row, index) => {
    const title = trimText(row.floor_or_part ?? '') || `Del ${index + 1}`
    const boarea = formatSquareMeters(row.boarea_m2)
    const biarea = formatSquareMeters(row.biarea_m2)
    const hasValues = boarea !== '--' || biarea !== '--'
    return {
      title,
      noteText: `Boarea: ${boarea}\nBiarea: ${biarea}`,
      riskText: '',
      ftuText: '',
      photoUrls: [],
      hasDeviations: hasValues,
    }
  })
  const areaMeasurementTotals = areaMeasurementRows.reduce(
    (acc, row) => ({
      boarea: acc.boarea + (row.boarea_m2 ?? 0),
      biarea: acc.biarea + (row.biarea_m2 ?? 0),
    }),
    { boarea: 0, biarea: 0 }
  )
  const areaMeasurementEnabled =
    areaMeasurementHeader !== null || areaMeasurementRows.length > 0
  const areaMeasurementRowsForReport = areaMeasurementRows.map((row, index) => {
    const floorOrPart = trimText(row.floor_or_part ?? '') || `Del ${index + 1}`
    const boarea = formatSquareMeters(row.boarea_m2)
    const biarea = formatSquareMeters(row.biarea_m2)
    return {
      floor_or_part: floorOrPart,
      boarea_display: boarea === '--' ? '--' : `${boarea} +/-2 %`,
      biarea_display: biarea === '--' ? '--' : `${biarea} +/-2 %`,
    }
  })
  const buildingYearFromConditions =
    inspectionConditions?.building_year === null || inspectionConditions?.building_year === undefined
      ? null
      : String(inspectionConditions.building_year)
  const buildingYearFromBuildingData = trimText(buildingDataMap['Byggnadsår:'] ?? '')
  const areaMeasurementBuildingYear = valueOrFallback(
    areaMeasurementHeader?.building_year === null || areaMeasurementHeader?.building_year === undefined
      ? buildingYearFromBuildingData || buildingYearFromConditions
      : String(areaMeasurementHeader.building_year)
  )

  let moistureControlHeader: MoistureControlHeaderRow | null = null
  let moistureControlRows: MoistureControlDataRow[] = []
  let moistureControlImages: MoistureControlImageRow[] = []
  const { data: moistureControlHeaderData, error: moistureControlHeaderError } = await supabase
    .from('inspection_moisture_controls')
    .select(
      'building_type,building_year,extension_note,heating,ventilation,object_other,measurement_instrument,comment,place_name,signed_date'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .maybeSingle()

  if (moistureControlHeaderError) {
    if (
      !isMissingRelationError(moistureControlHeaderError, [
        'inspection_moisture_controls',
        'inspection_moisture_control_rows',
      ])
    ) {
      console.error('Kunde inte hämta fuktkontroll (header)', moistureControlHeaderError)
    }
  } else {
    moistureControlHeader = (moistureControlHeaderData as MoistureControlHeaderRow | null) ?? null
  }

  const { data: moistureControlRowsData, error: moistureControlRowsError } = await supabase
    .from('inspection_moisture_control_rows')
    .select(
      'id,location_label,building_part,measurement_type,measurement_value,temperature_c,note,critical_level,sort_order'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .order('sort_order', { ascending: true })

  if (moistureControlRowsError) {
    if (
      !isMissingRelationError(moistureControlRowsError, [
        'inspection_moisture_controls',
        'inspection_moisture_control_rows',
      ])
    ) {
      console.error('Kunde inte hämta fuktkontroll (rader)', moistureControlRowsError)
    }
  } else {
    moistureControlRows = (moistureControlRowsData ?? []) as MoistureControlDataRow[]
  }

  const { data: moistureControlImagesData, error: moistureControlImagesError } = await supabase
    .from('inspection_moisture_control_images')
    .select('id,moisture_control_row_id,file_path,sort_order')
    .eq('inspection_id', resolvedParams.inspectionId)
    .order('sort_order', { ascending: true })

  if (moistureControlImagesError) {
    if (
      !isMissingRelationError(moistureControlImagesError, [
        'inspection_moisture_control_images',
      ])
    ) {
      console.error('Kunde inte hämta bilder för fuktkontroll', moistureControlImagesError)
    }
  } else {
    moistureControlImages = (moistureControlImagesData ?? []) as MoistureControlImageRow[]
  }

  const moistureImagesByRowId = new Map<string, string[]>()
  for (const rowImage of moistureControlImages) {
    const rowId = trimText(rowImage.moisture_control_row_id ?? '')
    if (!rowId) continue
    const url = buildInspectionImageUrl(rowImage.file_path)
    if (!url) continue
    const bucket = moistureImagesByRowId.get(rowId) ?? []
    bucket.push(url)
    moistureImagesByRowId.set(rowId, bucket)
  }

  const formatMoistureResultText = (row: MoistureControlDataRow) => {
    const method = measurementTypeLabel(row.measurement_type)
    const value = formatMeasurementValue(row.measurement_value)
    if (isMoistureIndicationType(row.measurement_type)) {
      const assessment = moistureAssessmentLabel(row.measurement_type, row.critical_level)
      return value === '--'
        ? assessment
        : `Indikationsvärde: ${value}\nBedömning: ${assessment}`
    }

    const temperature =
      row.temperature_c !== null && row.temperature_c !== undefined && Number.isFinite(row.temperature_c)
        ? ` vid ${Number(row.temperature_c).toFixed(2)} °C`
        : ''
    return value === '--' ? `${method}: --` : `${value} % ${method}${method === 'RF' ? temperature : ''}`
  }

  const moistureControlBlocks: InspectionBlock[] = moistureControlRows.map((row, index) => {
    const title = trimText(row.location_label ?? '') || `Kontrollplats ${index + 1}`
    const lines: string[] = []
    const buildingPart = trimText(row.building_part ?? '')
    if (buildingPart) lines.push(`Byggdel/kontrollpunkt: ${buildingPart}`)
    lines.push(`Kontrollmetod: ${measurementTypeLabel(row.measurement_type)}`)
    lines.push(`Resultat: ${formatMoistureResultText(row)}`)
    if (row.temperature_c !== null && row.temperature_c !== undefined && Number.isFinite(row.temperature_c)) {
      if (row.measurement_type === 'rf') {
        lines.push(`Temperatur: ${Number(row.temperature_c).toFixed(2)} °C`)
      }
    }
    lines.push(
      `${isMoistureIndicationType(row.measurement_type) ? 'Indikeringsbedömning' : 'Kritisk nivå'}: ${moistureAssessmentLabel(row.measurement_type, row.critical_level)}`
    )
    const note = trimText(row.note ?? '')
    if (note) lines.push(`Anteckning: ${note}`)

    const photoUrls = moistureImagesByRowId.get(row.id) ?? []

    return {
      title,
      noteText: lines.length > 0 ? lines.join('\n') : '--',
      riskText: '',
      ftuText: '',
      photoUrls,
      hasDeviations:
        String(row.critical_level ?? '')
          .trim()
          .toLowerCase() === 'over' || note.length > 0 || photoUrls.length > 0,
    }
  })
  const moistureControlEnabled = moistureControlHeader !== null || moistureControlRows.length > 0
  const moistureControlRowsForReport = moistureControlRows.map((row, index) => {
    const locationLabel = trimText(row.location_label ?? '') || `Kontrollplats ${index + 1}`
    const buildingPart = trimText(row.building_part ?? '')
    const method = measurementTypeLabel(row.measurement_type)
    const resultText = formatMoistureResultText(row)
    const note = trimText(row.note ?? '')
    return {
      location_display: buildingPart ? `${locationLabel}\n${buildingPart}` : locationLabel,
      method_display: method,
      result_display: resultText,
      comment_display: note || '--',
      critical_display: note
        ? `${moistureAssessmentLabel(row.measurement_type, row.critical_level)}\n${note}`
        : moistureAssessmentLabel(row.measurement_type, row.critical_level),
      result_with_note_display: note ? `${resultText}\nAnteckning: ${note}` : resultText,
      section_kind: isMoistureIndicationType(row.measurement_type) ? 'indication' : 'measurement',
    }
  })
  const moistureIndicationRowsForReport = moistureControlRowsForReport.filter(
    row => row.section_kind === 'indication'
  )
  const moistureMeasurementRowsForReport = moistureControlRowsForReport.filter(
    row => row.section_kind === 'measurement'
  )

  const inspectorNameForSigning = valueOrFallback(
    (frozenProfileFromSnapshot?.full_name as string | null | undefined) ?? profile?.full_name ?? null
  )
  const companyNameForSigning = valueOrFallback(
    (frozenProfileFromSnapshot?.company_name as string | null | undefined) ?? profile?.company_name ?? null
  )
  const inspectorStatusForSigning = valueOrFallback(
    (frozenProfileFromSnapshot?.sbr_status as string | null | undefined) ??
      profileCertificationSummary.sbr_status ??
      null
  )
  const inspectorMembershipNumberForSigning = valueOrFallback(
    (frozenProfileFromSnapshot?.membership_number as string | null | undefined) ??
      profileCertificationSummary.membership_number ??
      null,
    ''
  )
  const inspectorMembershipLineForSigning =
    inspectorMembershipNumberForSigning.trim().length > 0
      ? `Medlemsnummer: ${inspectorMembershipNumberForSigning}`
      : fallback
  const areaSigningPlace = valueOrFallback(
    areaMeasurementHeader?.place_name ?? null,
    valueOrFallback(property?.city ?? null)
  )
  const areaSigningDate = valueOrFallback(
    formatDateOnly(areaMeasurementHeader?.signed_date ?? inspection?.date ?? null)
  )
  const moistureSigningPlace = valueOrFallback(
    moistureControlHeader?.place_name ?? null,
    valueOrFallback(property?.city ?? null)
  )
  const moistureSigningDate = valueOrFallback(
    formatDateOnly(moistureControlHeader?.signed_date ?? inspection?.date ?? null)
  )
  const moistureInstrument = valueOrFallback(moistureControlHeader?.measurement_instrument ?? null)
  const moistureInstrumentSentence =
    moistureInstrument === fallback
      ? 'Fuktkontroll/fuktindikering har utförts med instrument (märke och modell). Kontrollens omfattning och metod framgår av resultatredovisningen nedan.'
      : `Fuktkontroll/fuktindikering har utförts med ${moistureInstrument}. Kontrollens omfattning och metod framgår av resultatredovisningen nedan.`

  const { data: exteriorItems, error: exteriorItemsError } = await supabase
    .from('settings_exterior_items')
    .select('id, label, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (exteriorItemsError) {
    console.error('Kunde inte hamta utsida-komponenter', exteriorItemsError)
  }

  const { data: exteriorObservations, error: exteriorObservationsError } = await supabase
    .from('inspection_exterior_observations')
    .select('id, exterior_item_id, part_label, note, risk_text, ftu_text, values, created_at')
    .eq('inspection_id', resolvedParams.inspectionId)
    .order('created_at', { ascending: true })

  if (exteriorObservationsError) {
    console.error('Kunde inte hamta utsida-observationer', exteriorObservationsError)
  }

  const { data: exteriorControlItems, error: exteriorControlItemsError } = await supabase
    .from('inspection_control_items')
    .select(
      'id, exterior_observation_id, control_point_id, title, note, risk_text, ftu_text, sort_order, selected_outcome_id'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .not('exterior_observation_id', 'is', null)
    .order('sort_order', { ascending: true })

  if (exteriorControlItemsError) {
    console.error('Kunde inte hamta utsida-kontrollpunkter', exteriorControlItemsError)
  }

  const exteriorControlItemsForIds =
    (exteriorControlItems ?? []) as ExteriorControlItemRow[]

  const controlPointIds = Array.from(
    new Set(
      exteriorControlItemsForIds
        .map((item) => item.control_point_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  const { data: outcomeRows, error: outcomesError } = controlPointIds.length
    ? await supabase
        .from('settings_control_point_outcomes')
        .select(
          'id, control_point_id, label, risk_template, ftu_template, sort_order, is_active'
        )
        .in('control_point_id', controlPointIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
    : { data: [], error: null }

  if (outcomesError) {
    console.error('Kunde inte hamta utfall (utsida)', outcomesError)
  }

  const { data: interiorRooms, error: interiorRoomsError } = await supabase
    .from('inspection_interior_rooms')
    .select('id, floor_label, room_label, room_type_key, note, order_index')
    .eq('inspection_id', resolvedParams.inspectionId)

  if (interiorRoomsError) {
    console.error('Kunde inte hamta insida-rum', interiorRoomsError)
  }

  const interiorRoomRows = (interiorRooms ?? []) as InteriorRoomRow[]

  const sortedInteriorRooms = [...interiorRoomRows].sort((a, b) => {
    const aRank = getInteriorFloorRank(a.floor_label)
    const bRank = getInteriorFloorRank(b.floor_label)
    if (aRank !== bRank) return aRank - bRank

    const aOrder = a.order_index ?? 0
    const bOrder = b.order_index ?? 0
    if (aOrder !== bOrder) return aOrder - bOrder

    return normalizeSwedish(a.room_label ?? '').localeCompare(
      normalizeSwedish(b.room_label ?? ''),
      'sv'
    )
  })
  const interiorRoomIds = sortedInteriorRooms.map((room) => room.id)

  const { data: interiorControlItems, error: interiorControlItemsError } =
    interiorRoomIds.length > 0
      ? await supabase
          .from('inspection_control_items')
          .select(
            'id, interior_room_id, control_point_id, title, note, risk_text, ftu_text, sort_order, selected_outcome_id'
          )
          .eq('inspection_id', resolvedParams.inspectionId)
          .in('interior_room_id', interiorRoomIds)
          .order('sort_order', { ascending: true })
      : { data: [], error: null }

  if (interiorControlItemsError) {
    console.error('Kunde inte hamta insida-kontrollpunkter', interiorControlItemsError)
  }

  const interiorControlItemsRows =
    (interiorControlItems ?? []) as InteriorControlItemRow[]
  const interiorControlPointIds = Array.from(
    new Set(
      interiorControlItemsRows
        .map((item) => item.control_point_id)
        .filter((id): id is string => Boolean(id))
    )
  )

  const { data: interiorOutcomeRows, error: interiorOutcomesError } =
    interiorControlPointIds.length > 0
      ? await supabase
          .from('settings_control_point_outcomes')
          .select(
            'id, control_point_id, label, risk_template, ftu_template, sort_order, is_active'
          )
          .in('control_point_id', interiorControlPointIds)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
      : { data: [], error: null }

  if (interiorOutcomesError) {
    console.error('Kunde inte hamta utfall (insida)', interiorOutcomesError)
  }

  const { data: exteriorImages, error: exteriorImagesError } = await supabase
    .from('inspection_images')
    .select('id, control_item_id, file_path, sort_order, created_at')
    .eq('inspection_id', resolvedParams.inspectionId)
    .not('control_item_id', 'is', null)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (exteriorImagesError) {
    console.error('Kunde inte hamta utsida-bilder', exteriorImagesError)
  }

  const baseOutcomeRows = (outcomeRows ?? []) as ControlPointOutcomeRow[]
  const interiorOutcomeRowsTyped = (interiorOutcomeRows ?? []) as ControlPointOutcomeRow[]
  const outcomeById = new Map<string, ControlPointOutcomeRow>(
    baseOutcomeRows.map((row) => [row.id, row])
  )
  for (const row of interiorOutcomeRowsTyped) {
    outcomeById.set(row.id, row)
  }

  const exteriorItemsSorted = (exteriorItems ?? []) as ExteriorItemRow[]
  const exteriorObservationsRows = (exteriorObservations ?? []) as ExteriorObservationRow[]
  const exteriorControlItemsRows =
    (exteriorControlItems ?? []) as ExteriorControlItemRow[]
  const exteriorImageRows = (exteriorImages ?? []) as InspectionImageRow[]

  const controlItemsByObservationId = new Map<string, ExteriorControlItemRow[]>()
  for (const controlItem of exteriorControlItemsRows) {
    const key = controlItem.exterior_observation_id
    if (!key) continue
    const bucket = controlItemsByObservationId.get(key) ?? []
    bucket.push(controlItem)
    controlItemsByObservationId.set(key, bucket)
  }

  const observationsByItemId = new Map<string, ExteriorObservationRow[]>()
  for (const row of exteriorObservationsRows) {
    const bucket = observationsByItemId.get(row.exterior_item_id) ?? []
    bucket.push({
      ...row,
      values: (row.values as Record<string, any>) || {},
    })
    observationsByItemId.set(row.exterior_item_id, bucket)
  }

  const imagesByControlItemId = new Map<string, InspectionImageRow[]>()
  for (const image of exteriorImageRows) {
    if (!image.control_item_id) continue
    const bucket = imagesByControlItemId.get(image.control_item_id) ?? []
    bucket.push(image)
    imagesByControlItemId.set(image.control_item_id, bucket)
  }

  const exteriorLines: string[] = []
  const riskLines: string[] = []
  const ftuLines: string[] = []
  const exteriorBlocks: InspectionBlock[] = []

  for (const item of exteriorItemsSorted) {
    const rows = observationsByItemId.get(item.id) ?? []
    const isFreeNote = (row: ExteriorObservationRow) =>
      row.is_free_note === true || row.values?._free_note === true

    const mainRows = rows.filter((row) => !isFreeNote(row))
    const freeNoteRows = rows.filter((row) => isFreeNote(row))

    const controlItemsForItem: ExteriorControlItemRow[] = []
    for (const row of mainRows) {
      const rowItems = controlItemsByObservationId.get(row.id) ?? []
      controlItemsForItem.push(...rowItems)
    }

    controlItemsForItem.sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )

    const itemLines: string[] = []
    const blocksForItem: InspectionBlock[] = []

    controlItemsForItem.forEach((controlItem) => {
      const note = trimText(controlItem.note)
      const outcome = controlItem.selected_outcome_id
        ? outcomeById.get(controlItem.selected_outcome_id) ?? null
        : null
      const hasOutcome = Boolean(controlItem.selected_outcome_id)
      const isFreeControlItem = controlItem.control_point_id === null

      const controlItemImages =
        controlItem.id ? imagesByControlItemId.get(controlItem.id) ?? [] : []
      const photoUrls = controlItemImages
        .map((image) => buildInspectionImageUrl(image.file_path))
        .filter((url): url is string => Boolean(url))

      const riskText = trimText(controlItem.risk_text ?? outcome?.risk_template ?? '')
      const ftuText = trimText(controlItem.ftu_text ?? outcome?.ftu_template ?? '')

      if (isFreeControlItem) {
        if (!note && riskText.length === 0 && ftuText.length === 0) return
        if (riskText.length > 0) {
          riskLines.push(item.label)
          riskLines.push(riskText)
          riskLines.push('')
        }
        if (ftuText.length > 0) {
          ftuLines.push(item.label)
          ftuLines.push(ftuText)
          ftuLines.push('')
        }

        const line = note || '--'
        itemLines.push(line)
        blocksForItem.push({
          title: item.label,
          noteText: line,
          riskText,
          ftuText,
          photoUrls,
          hasDeviations: true,
        })
        return
      }

      if (riskText.length > 0) {
        riskLines.push(item.label)
        riskLines.push(riskText)
        riskLines.push('')
      }

      if (ftuText.length > 0) {
        ftuLines.push(item.label)
        ftuLines.push(ftuText)
        ftuLines.push('')
      }

      if (!hasOutcome && note.length === 0) return
      if (note.length === 0) return

      const line = note
      itemLines.push(line)

      blocksForItem.push({
        title: item.label,
        noteText: line,
        riskText,
        ftuText,
        photoUrls,
        hasDeviations: true,
      })
    })

    freeNoteRows.forEach((row) => {
      const note = trimText(row.note)
      const label = trimText(row.part_label) || 'Fri notering'
      const freeRiskText = trimText(row.risk_text ?? '')
      const freeFtuText = trimText(row.ftu_text ?? '')
      if (!note && freeRiskText.length === 0 && freeFtuText.length === 0) return
      const line = note || '--'
      if (freeRiskText.length > 0) {
        riskLines.push(label)
        riskLines.push(freeRiskText)
        riskLines.push('')
      }
      if (freeFtuText.length > 0) {
        ftuLines.push(label)
        ftuLines.push(freeFtuText)
        ftuLines.push('')
      }
      itemLines.push(line)
      blocksForItem.push({
        title: item.label,
        noteText: line,
        riskText: freeRiskText,
        ftuText: freeFtuText,
        photoUrls: [],
        hasDeviations: true,
      })
    })

    if (blocksForItem.length === 0) {
      blocksForItem.push({
        title: item.label,
        noteText: '--',
        riskText: '',
        ftuText: '',
        photoUrls: [],
        hasDeviations: false,
      })
    }

    exteriorBlocks.push(...blocksForItem)

    exteriorLines.push(item.label)
    if (itemLines.length > 0) {
      itemLines.forEach((line) => exteriorLines.push(`- ${line}`))
    } else {
      exteriorLines.push('--')
    }
    exteriorLines.push('')
  }

  const interiorBlocks: InspectionBlock[] = []
  const interiorLines: string[] = []

  const interiorControlItemsByRoomId = new Map<string, InteriorControlItemRow[]>()
  for (const controlItem of interiorControlItemsRows) {
    const key = controlItem.interior_room_id
    if (!key) continue
    const bucket = interiorControlItemsByRoomId.get(key) ?? []
    bucket.push(controlItem)
    interiorControlItemsByRoomId.set(key, bucket)
  }

  for (const room of sortedInteriorRooms) {
    const floorLabel = floorLabelFromKey(room.floor_label)
    const roomName = getInteriorRoomNameForReport(room)
    const roomTitle = [floorLabel, roomName]
      .filter(Boolean)
      .join(' - ')
    const roomBlocks: InspectionBlock[] = []
    const roomLines: string[] = []

    const roomNote = trimText(room.note ?? '')
    if (roomNote.length > 0) {
      roomLines.push(roomNote)
      roomBlocks.push({
        title: roomTitle,
        noteText: roomNote,
        riskText: '',
        ftuText: '',
        photoUrls: [],
        hasDeviations: true,
      })
    }

    const roomControlItems = interiorControlItemsByRoomId.get(room.id) ?? []
    roomControlItems.sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )

    roomControlItems.forEach((controlItem) => {
      const note = trimText(controlItem.note)
      const outcome = controlItem.selected_outcome_id
        ? outcomeById.get(controlItem.selected_outcome_id) ?? null
        : null
      const hasOutcome = Boolean(controlItem.selected_outcome_id)

      const controlItemImages =
        controlItem.id ? imagesByControlItemId.get(controlItem.id) ?? [] : []
      const photoUrls = controlItemImages
        .map((image) => buildInspectionImageUrl(image.file_path))
        .filter((url): url is string => Boolean(url))

      const riskText = trimText(controlItem.risk_text ?? outcome?.risk_template ?? '')
      if (riskText.length > 0) {
        riskLines.push(roomTitle)
        riskLines.push(riskText)
        riskLines.push('')
      }

      const ftuText = trimText(controlItem.ftu_text ?? outcome?.ftu_template ?? '')
      if (ftuText.length > 0) {
        ftuLines.push(roomTitle)
        ftuLines.push(ftuText)
        ftuLines.push('')
      }

      if (!hasOutcome && note.length === 0) return
      if (note.length === 0) return

      const line = note
      roomLines.push(line)

      roomBlocks.push({
        title: roomTitle,
        noteText: line,
        riskText,
        ftuText,
        photoUrls,
        hasDeviations: true,
      })
    })

    if (roomBlocks.length === 0) {
      roomBlocks.push({
        title: roomTitle,
        noteText: '--',
        riskText: '',
        ftuText: '',
        photoUrls: [],
        hasDeviations: false,
      })
    }

    interiorBlocks.push(...roomBlocks)

    interiorLines.push(roomTitle)
    if (roomLines.length > 0) {
      roomLines.forEach((line) => interiorLines.push(`- ${line}`))
    } else {
      interiorLines.push('--')
    }
    interiorLines.push('')
  }

  const exteriorText = trimText(exteriorLines.join('\n'))
  const interiorText = trimText(interiorLines.join('\n'))
  const riskText = trimText(riskLines.join('\n'))
  const ftuText = trimText(ftuLines.join('\n'))

  const mockData = {
    mock: {
      company: {
        logo_url:
          (frozenCompanyFromSnapshot?.logo_url as string | null | undefined) ??
          profile?.logo_path ??
          null,
      },
      profile: {
        full_name: valueOrFallback(
          (frozenProfileFromSnapshot?.full_name as string | null | undefined) ?? profile?.full_name ?? null
        ),
        sbr_group: valueOrFallback(
          (frozenProfileFromSnapshot?.sbr_group as string | null | undefined) ??
            profileCertificationSummary.sbr_group ??
            null
        ),
        sbr_status: valueOrFallback(
          (frozenProfileFromSnapshot?.sbr_status as string | null | undefined) ??
            profileCertificationSummary.sbr_status ??
            null
        ),
        membership_number: valueOrFallback(
          (frozenProfileFromSnapshot?.membership_number as string | null | undefined) ??
            profileCertificationSummary.membership_number ??
            null
        ),
        certification_number: valueOrFallback(
          (frozenProfileFromSnapshot?.certification_number as string | null | undefined) ??
            profileCertificationSummary.certification_number ??
            null,
          ''
        ),
        certification_items: Array.isArray(frozenProfileFromSnapshot?.certification_items)
          ? frozenProfileFromSnapshot.certification_items
          : profileCertificationSummary.all_selected_items,
        phone: valueOrFallback(
          (frozenProfileFromSnapshot?.phone as string | null | undefined) ?? profile?.phone ?? null
        ),
        email: valueOrFallback(
          (frozenProfileFromSnapshot?.email as string | null | undefined) ?? profile?.email ?? null
        ),
        company_name: valueOrFallback(
          (frozenProfileFromSnapshot?.company_name as string | null | undefined) ?? profile?.company_name ?? null
        ),
        company_orgno: valueOrFallback(
          (frozenProfileFromSnapshot?.company_orgno as string | null | undefined) ?? profile?.company_orgno ?? null
        ),
        company_address: valueOrFallback(
          (frozenProfileFromSnapshot?.company_address as string | null | undefined) ??
            profile?.company_address ??
            null
        ),
        company_postal_code: valueOrFallback(
          (frozenProfileFromSnapshot?.company_postal_code as string | null | undefined) ??
            profile?.company_postal_code ??
            null
        ),
        company_city: valueOrFallback(
          (frozenProfileFromSnapshot?.company_city as string | null | undefined) ?? profile?.company_city ?? null
        ),
      },
      properties: {
        cadastral_id: valueOrFallback(property?.cadastral_id ?? null),
        address: valueOrFallback(fullAddress, fallback),
        city: valueOrFallback(property?.city ?? null),
        municipality: valueOrFallback(property?.municipality ?? null),
        owner_name: valueOrFallback(property?.owner_name ?? null),
        brf_name: valueOrFallback(assignment?.brf_name ?? null, ''),
        apartment_number: valueOrFallback(assignment?.apartment_number ?? null, ''),
        apartment_holder_name: valueOrFallback(assignment?.apartment_holder_name ?? null, ''),
        cover_path: coverImageUrl,
      },
      documents: {
        provided: providedDocuments,
      },
      disclosures: {
        acquisition_text:
          disclosureRow?.note && disclosureRow.note.trim().length > 0
            ? disclosureRow.note
            : 'Säljaren förvärvade fastigheten --.',
        renovations: [],
        property_faults: propertyFaultsText ? propertyFaultsText : '',
      },
      inspections: {
        date: inspectionDate,
        date_time: inspectionDateTime,
        side: valueOrFallback(inspection?.inspection_side ?? null, ''),
        inspector_name: valueOrFallback(inspection?.client_contact ?? null),
        assignment_number: valueOrFallback(inspection?.assignment_number ?? null),
        client_name: valueOrFallback(inspection?.client_name ?? null),
        scope_text: scopeText,
        attendees_text: attendeesText,
        assignment_confirmation_date: assignmentDeliveredDate,
        assignment_confirmation_text: assignmentConfirmationText,
      },
      inspection_conditions: {
        furnishing_level: valueOrFallback(
          inspectionConditions?.furnishing_level ?? null,
          ''
        ),
      },
      buildingData: {
        text: buildingDataText,
      },
      exterior: {
        text: exteriorText || fallback,
        blocks: exteriorBlocks,
      },
      interior: {
        text: interiorText || fallback,
        blocks: interiorBlocks,
      },
      risk: {
        text: riskText || fallback,
      },
      ftu: {
        text: ftuText || fallback,
      },
      appendices: {
        area_measurement: {
          enabled: areaMeasurementEnabled,
          object: {
            assignment_number: valueOrFallback(inspection?.assignment_number ?? null),
            address: valueOrFallback(fullAddress, fallback),
            building_type: valueOrFallback(
              areaMeasurementHeader?.building_type ?? null,
              valueOrFallback(buildingTypeParts.TYPE, fallback)
            ),
            building_year: areaMeasurementBuildingYear,
            object_other: valueOrFallback(areaMeasurementHeader?.object_other ?? null),
          },
          measurement: {
            instrument: valueOrFallback(areaMeasurementHeader?.measurement_instrument ?? null),
            comment: valueOrFallback(areaMeasurementHeader?.comment ?? null),
            other_notes: valueOrFallback(areaMeasurementHeader?.other_notes ?? null),
          },
          summary: {
            boarea_total: `${formatSquareMeters(areaMeasurementTotals.boarea)} +/-2 %`,
            biarea_total: `${formatSquareMeters(areaMeasurementTotals.biarea)} +/-2 %`,
          },
          rows: areaMeasurementRowsForReport,
          signing: {
            place_date: composePlaceDate(areaSigningPlace, areaSigningDate),
            company_name: companyNameForSigning,
            inspector_name: inspectorNameForSigning,
            secondary_qualification: inspectorStatusForSigning,
            membership_line: inspectorMembershipLineForSigning,
          },
          blocks: areaMeasurementBlocks,
        },
        moisture_control: {
          enabled: moistureControlEnabled,
          object: {
            assignment_number: valueOrFallback(inspection?.assignment_number ?? null),
            address: valueOrFallback(fullAddress, fallback),
            building_type: valueOrFallback(
              moistureControlHeader?.building_type ?? null,
              valueOrFallback(buildingTypeParts.TYPE, fallback)
            ),
            building_year: valueOrFallback(
              moistureControlHeader?.building_year ?? null,
              valueOrFallback(buildingYearFromBuildingData || buildingYearFromConditions, fallback)
            ),
            extension_note: valueOrFallback(moistureControlHeader?.extension_note ?? null),
            heating: valueOrFallback(
              moistureControlHeader?.heating ?? null,
              valueOrFallback(buildingDataMap['Uppvärmning:'], fallback)
            ),
            ventilation: valueOrFallback(
              moistureControlHeader?.ventilation ?? null,
              valueOrFallback(buildingDataMap['Ventilation:'], fallback)
            ),
            object_other: valueOrFallback(moistureControlHeader?.object_other ?? null),
          },
          measurement: {
            instrument: moistureInstrument,
            instrument_sentence: moistureInstrumentSentence,
            comment: valueOrFallback(moistureControlHeader?.comment ?? null),
          },
          rows: moistureControlRowsForReport,
          indication_rows: moistureIndicationRowsForReport,
          measurement_rows: moistureMeasurementRowsForReport,
          signing: {
            place_date: composePlaceDate(moistureSigningPlace, moistureSigningDate),
            company_name: companyNameForSigning,
            inspector_name: inspectorNameForSigning,
            secondary_qualification: inspectorStatusForSigning,
            membership_line: inspectorMembershipLineForSigning,
          },
          blocks: moistureControlBlocks,
        },
      },
    },
  }

  return mockData
}
