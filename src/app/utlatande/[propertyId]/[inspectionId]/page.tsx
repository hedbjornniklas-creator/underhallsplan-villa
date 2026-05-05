// @ts-nocheck
import AutoPrintTrigger from '../../_components/AutoPrintTrigger'
import ReportToolbar from '../../_components/ReportToolbar'
import SessionBridge from '../../_components/SessionBridge'
import ClientSessionDebug from '../../_components/ClientSessionDebug'
import ReportRenderer from '@/components/report/ReportRenderer'
import { buildReportSpec } from '@/lib/report/reportSpec'
import {
  buildBuildingDataMap,
  buildBuildingTypeParts,
  renderBuildingDataTextFromTemplate,
} from '@/lib/report/buildingData'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { parseScopeCodes, renderScopeText } from '@/lib/report/scopeText'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'

export const dynamic = 'force-dynamic'

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

type InspectionSide = 'buyer' | 'seller' | 'apartment'

export default async function Page({
  params,
  searchParams,
}: {
  params:
    | { propertyId: string; inspectionId: string }
    | Promise<{ propertyId: string; inspectionId: string }>
  searchParams?:
    | Record<string, string | string[] | undefined>
    | Promise<Record<string, string | string[] | undefined>>
}) {
  const resolvedParams = await Promise.resolve(params)
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {})
  const isEmbed = resolvedSearchParams?.embed === '1'
  const isAutoPrint = resolvedSearchParams?.autoprint === '1'
  const isPdf = resolvedSearchParams?.pdf === '1'
  const supabase: any = createSupabaseServerClient()

  const fallback = '--'
  const valueOrFallback = (value: string | null | undefined, alt = fallback) => {
    if (value === null || value === undefined) return alt
    const trimmed = String(value).trim()
    return trimmed.length > 0 ? trimmed : alt
  }
  const composePlaceDate = (place: string, date: string) => {
    if (place !== fallback && date !== fallback) return `${place}, ${date}`
    if (place !== fallback) return place
    if (date !== fallback) return date
    return fallback
  }
  const trimText = (value: string | null | undefined) => (value ?? '').trim()
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
    return `${Number(value).toFixed(2)} m²`
  }
  const formatMeasurementValue = (value: number | null | undefined) => {
    if (value === null || value === undefined || !Number.isFinite(value)) return '--'
    return Number(value).toFixed(2)
  }
  const measurementTypeLabel = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (normalized === 'rf') return 'RF'
    if (normalized === 'fk') return 'FK'
    return 'Annat'
  }
  const criticalLevelLabel = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    return normalized === 'over' ? 'Över kritisk nivå' : 'Under kritisk nivå'
  }

  const resolveInspectionSide = (value: string | null | undefined): InspectionSide => {
    if (value === 'seller') return 'seller'
    if (value === 'apartment') return 'apartment'
    return 'buyer'
  }

  const appliesToMatches = (
    appliesTo: string[] | null | undefined,
    side: InspectionSide
  ) => {
    if (!Array.isArray(appliesTo) || appliesTo.length === 0) return true
    const normalized = appliesTo.map((entry) => String(entry ?? '').trim().toLowerCase())
    return normalized.includes(side)
  }

  const buildApartmentBuildingDataText = (raw: string) => {
    const text = String(raw ?? '').trim()
    const keepPrefixes = ['v\u00e4derlek:', 'byggnads\u00e5r:', 'ombyggnads\u00e5r:']
    const keptLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => {
        const normalizedLine = normalizeSwedish(line).toLowerCase()
        return keepPrefixes.some((prefix) => normalizedLine.startsWith(prefix))
      })
    if (
      !keptLines.some((line) =>
        normalizeSwedish(line).toLowerCase().startsWith('ombyggnads\u00e5r:')
      )
    ) {
      keptLines.push('Ombyggnads\u00e5r: --')
    }
    return keptLines.join('\n')
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

  const inspectionSide = resolveInspectionSide(inspection?.inspection_side ?? null)
  const resolvedPropertyId = inspection?.property_id ?? resolvedParams.propertyId

  const { data: propertyData, error: propertyError } = await supabase
    .from('properties')
    .select('id, name, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path')
    .eq('id', resolvedPropertyId)
    .maybeSingle()

  if (propertyError) {
    console.error('Kunde inte hÃ¤mta fastighet', propertyError)
  }

  const { data: snapshotData, error: snapshotError } = await (supabase as any)
    .from('ob_property_snapshot')
    .select(
      'inspection_id, source_property_id, name, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path, brf_name, apartment_number, apartment_holder_name'
    )
    .eq('inspection_id', resolvedParams.inspectionId)
    .maybeSingle()

  if (snapshotError) {
    console.error('Kunde inte hÃ¤mta OB-snapshot', snapshotError)
  }

  const { data: assignmentRows, error: assignmentError } = await (supabase as any)
    .from('assignments')
    .select('id, brf_name, apartment_number, apartment_holder_name')
    .eq('inspection_id', resolvedParams.inspectionId)
    .limit(1)

  if (assignmentError) {
    console.error('Kunde inte hÃ¤mta uppdragsfÃ¤lt fÃ¶r lÃ¤genhet', assignmentError)
  }

  const assignmentForInspection = Array.isArray(assignmentRows) ? assignmentRows[0] : null
  const apartmentData = {
    brf_name:
      snapshotData?.brf_name ??
      assignmentForInspection?.brf_name ??
      null,
    apartment_number:
      snapshotData?.apartment_number ??
      assignmentForInspection?.apartment_number ??
      null,
    apartment_holder_name:
      snapshotData?.apartment_holder_name ??
      assignmentForInspection?.apartment_holder_name ??
      null,
  }

  const property = {
    ...(propertyData ?? {}),
    ...(snapshotData ?? {}),
    ...apartmentData,
    id: (propertyData as any)?.id ?? resolvedPropertyId ?? null,
  }


  if (inspection && inspection.property_id !== resolvedParams.propertyId) {
    console.error('Besiktning tillhÃ¶r inte fastighet', {
      inspectionPropertyId: inspection.property_id,
      propertyId: resolvedParams.propertyId,
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

  let frozenProfileFromSnapshot = null
  let frozenCompanyFromSnapshot = null
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
        const payload = (row as any)?.snapshot_payload ?? null
        const reportData = payload?.reportData ?? null
        const mock = reportData?.mock ?? null
        if (mock?.profile && typeof mock.profile === 'object') {
          frozenProfileFromSnapshot = mock.profile
        }
        if (mock?.company && typeof mock.company === 'object') {
          frozenCompanyFromSnapshot = mock.company
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
    .select('id, key, label, sort_order, applies_to')
    .in('key', overviewItemKeys)
    .eq('is_active', true)

  if (overviewItemsError) {
    console.error('Kunde inte hamta byggnadsdata-installningar', overviewItemsError)
  }

  const overviewItemsRowsAll = (overviewItems ?? []) as Array<{
    id: string
    key: string
    label: string
    sort_order: number | null
    applies_to: string[] | null
  }>
  const overviewItemsRows = overviewItemsRowsAll.filter((item) =>
    appliesToMatches(item.applies_to, inspectionSide)
  )
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
    inspectionSide === 'apartment' && (scopeTextRaw === '--' || !scopeTextRaw.trim())
      ? 'Invändig besiktning av lägenhet/bostadsrätt'
      : scopeTextRaw
  const assignmentDeliveredDate = valueOrFallback(
    inspection?.assignment_confirmation_delivered_date ?? null,
    '--'
  )
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
    .map((line) => line.trim())
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
  const buildingDataTextRaw = renderBuildingDataTextFromTemplate(
    buildingDataMap,
    undefined,
    buildingTypeParts
  )
  const buildingDataText =
    inspectionSide === 'apartment'
      ? buildApartmentBuildingDataText(buildingDataTextRaw)
      : buildingDataTextRaw

  let areaMeasurementHeader: Record<string, unknown> | null = null
  let areaMeasurementRows: Array<Record<string, unknown>> = []
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
    areaMeasurementHeader = (areaMeasurementHeaderData as Record<string, unknown> | null) ?? null
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
    areaMeasurementRows = Array.isArray(areaMeasurementRowsData)
      ? (areaMeasurementRowsData as Array<Record<string, unknown>>)
      : []
  }

  const areaMeasurementBlocks: InspectionBlock[] = areaMeasurementRows.map((row, index) => {
    const title = trimText(String(row.floor_or_part ?? '')) || `Del ${index + 1}`
    const boarea = formatSquareMeters(
      typeof row.boarea_m2 === 'number' ? row.boarea_m2 : Number(row.boarea_m2 ?? NaN)
    )
    const biarea = formatSquareMeters(
      typeof row.biarea_m2 === 'number' ? row.biarea_m2 : Number(row.biarea_m2 ?? NaN)
    )
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
      boarea:
        acc.boarea +
        (typeof row.boarea_m2 === 'number' ? row.boarea_m2 : Number(row.boarea_m2 ?? 0) || 0),
      biarea:
        acc.biarea +
        (typeof row.biarea_m2 === 'number' ? row.biarea_m2 : Number(row.biarea_m2 ?? 0) || 0),
    }),
    { boarea: 0, biarea: 0 }
  )
  const areaMeasurementEnabled =
    areaMeasurementHeader !== null || areaMeasurementRows.length > 0
  const areaMeasurementRowsForReport = areaMeasurementRows.map((row, index) => {
    const floorOrPart = trimText(String(row.floor_or_part ?? '')) || `Del ${index + 1}`
    const boarea = formatSquareMeters(
      typeof row.boarea_m2 === 'number' ? row.boarea_m2 : Number(row.boarea_m2 ?? NaN)
    )
    const biarea = formatSquareMeters(
      typeof row.biarea_m2 === 'number' ? row.biarea_m2 : Number(row.biarea_m2 ?? NaN)
    )
    return {
      floor_or_part: floorOrPart,
      boarea_display: boarea === '--' ? '--' : `${boarea} +/-2 %`,
      biarea_display: biarea === '--' ? '--' : `${biarea} +/-2 %`,
    }
  })

  let moistureControlHeader: Record<string, unknown> | null = null
  let moistureControlRows: Array<Record<string, unknown>> = []
  let moistureControlImages: Array<Record<string, unknown>> = []
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
    moistureControlHeader = (moistureControlHeaderData as Record<string, unknown> | null) ?? null
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
    moistureControlRows = Array.isArray(moistureControlRowsData)
      ? (moistureControlRowsData as Array<Record<string, unknown>>)
      : []
  }

  const { data: moistureControlImagesData, error: moistureControlImagesError } = await supabase
    .from('inspection_moisture_control_images')
    .select('moisture_control_row_id,file_path,sort_order')
    .eq('inspection_id', resolvedParams.inspectionId)
    .order('sort_order', { ascending: true })

  if (moistureControlImagesError) {
    if (
      !isMissingRelationError(moistureControlImagesError, ['inspection_moisture_control_images'])
    ) {
      console.error('Kunde inte hämta bilder för fuktkontroll', moistureControlImagesError)
    }
  } else {
    moistureControlImages = Array.isArray(moistureControlImagesData)
      ? (moistureControlImagesData as Array<Record<string, unknown>>)
      : []
  }

  const moistureImagesByRowId = new Map<string, string[]>()
  for (const image of moistureControlImages) {
    const rowId = trimText(String(image.moisture_control_row_id ?? ''))
    if (!rowId) continue
    const url = buildInspectionImageUrl(String(image.file_path ?? ''))
    if (!url) continue
    const bucket = moistureImagesByRowId.get(rowId) ?? []
    bucket.push(url)
    moistureImagesByRowId.set(rowId, bucket)
  }

  const moistureControlBlocks: InspectionBlock[] = moistureControlRows.map((row, index) => {
    const rowId = trimText(String(row.id ?? ''))
    const title = trimText(String(row.location_label ?? '')) || `Kontrollplats ${index + 1}`
    const lines: string[] = []
    const buildingPart = trimText(String(row.building_part ?? ''))
    if (buildingPart) lines.push(`Byggdel/kontrollpunkt: ${buildingPart}`)
    lines.push(`Mätmetod: ${measurementTypeLabel(String(row.measurement_type ?? ''))}`)
    lines.push(
      `Värde: ${formatMeasurementValue(
        typeof row.measurement_value === 'number'
          ? row.measurement_value
          : Number(row.measurement_value ?? NaN)
      )}`
    )
    if (row.temperature_c !== null && row.temperature_c !== undefined && `${row.temperature_c}`.trim()) {
      const temperatureNumber =
        typeof row.temperature_c === 'number' ? row.temperature_c : Number(row.temperature_c ?? NaN)
      if (Number.isFinite(temperatureNumber)) {
        lines.push(`Temperatur: ${Number(temperatureNumber).toFixed(2)} °C`)
      }
    }
    lines.push(`Kritisk nivå: ${criticalLevelLabel(String(row.critical_level ?? ''))}`)
    const note = trimText(String(row.note ?? ''))
    if (note) lines.push(`Anteckning: ${note}`)

    const photoUrls = rowId ? moistureImagesByRowId.get(rowId) ?? [] : []
    const isOverLevel = String(row.critical_level ?? '')
      .trim()
      .toLowerCase() === 'over'

    return {
      title,
      noteText: lines.length > 0 ? lines.join('\n') : '--',
      riskText: '',
      ftuText: '',
      photoUrls,
      hasDeviations: isOverLevel || note.length > 0 || photoUrls.length > 0,
    }
  })
  const moistureControlEnabled =
    moistureControlHeader !== null || moistureControlRows.length > 0
  const moistureControlRowsForReport = moistureControlRows.map((row, index) => {
    const locationLabel = trimText(String(row.location_label ?? '')) || `Kontrollplats ${index + 1}`
    const buildingPart = trimText(String(row.building_part ?? ''))
    const method = measurementTypeLabel(String(row.measurement_type ?? ''))
    const value = formatMeasurementValue(
      typeof row.measurement_value === 'number'
        ? row.measurement_value
        : Number(row.measurement_value ?? NaN)
    )
    const temperatureNumber =
      typeof row.temperature_c === 'number' ? row.temperature_c : Number(row.temperature_c ?? NaN)
    const temperatureText =
      Number.isFinite(temperatureNumber) && method === 'RF'
        ? ` vid ${Number(temperatureNumber).toFixed(2)} °C`
        : ''
    const resultText =
      value === '--' ? `${method}: --` : `${value} % ${method}${temperatureText}`
    const note = trimText(String(row.note ?? ''))
    return {
      location_display: buildingPart ? `${locationLabel}\n${buildingPart}` : locationLabel,
      result_display: note ? `${resultText}\nAnteckning: ${note}` : resultText,
      critical_display: criticalLevelLabel(String(row.critical_level ?? '')),
    }
  })

  const inspectorNameForSigning = valueOrFallback(
    frozenProfileFromSnapshot?.full_name ?? profile?.full_name ?? null
  )
  const companyNameForSigning = valueOrFallback(
    frozenProfileFromSnapshot?.company_name ?? profile?.company_name ?? null
  )
  const inspectorStatusForSigning = valueOrFallback(
    frozenProfileFromSnapshot?.sbr_status ?? profileCertificationSummary.sbr_status ?? null
  )
  const inspectorMembershipNumberForSigning = valueOrFallback(
    frozenProfileFromSnapshot?.membership_number ?? profileCertificationSummary.membership_number ?? null,
    ''
  )
  const inspectorMembershipLineForSigning =
    inspectorMembershipNumberForSigning.trim().length > 0
      ? `Medlemsnummer: ${inspectorMembershipNumberForSigning}`
      : fallback
  const areaSigningPlace = valueOrFallback(
    (areaMeasurementHeader?.place_name as string | null | undefined) ?? null,
    valueOrFallback(property?.city ?? null)
  )
  const areaSigningDate = valueOrFallback(
    (areaMeasurementHeader?.signed_date as string | null | undefined) ??
      inspection?.date ??
      null
  )
  const moistureSigningPlace = valueOrFallback(
    (moistureControlHeader?.place_name as string | null | undefined) ?? null,
    valueOrFallback(property?.city ?? null)
  )
  const moistureSigningDate = valueOrFallback(
    (moistureControlHeader?.signed_date as string | null | undefined) ??
      inspection?.date ??
      null
  )
  const conditionBuildingYear =
    inspectionConditions?.building_year === null || inspectionConditions?.building_year === undefined
      ? null
      : String(inspectionConditions.building_year)
  const buildingDataBuildingYear = trimText(buildingDataMap['Byggnadsår:'] ?? '')
  const areaMeasurementBuildingYear = valueOrFallback(
    areaMeasurementHeader?.building_year === null || areaMeasurementHeader?.building_year === undefined
      ? buildingDataBuildingYear || conditionBuildingYear
      : String(areaMeasurementHeader.building_year)
  )
  const moistureControlBuildingYear = valueOrFallback(
    (moistureControlHeader?.building_year as string | null | undefined) ??
      (buildingDataBuildingYear || conditionBuildingYear)
  )

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
    const aIsOther = isOtherKey(a.room_type_key)
    const bIsOther = isOtherKey(b.room_type_key)
    if (aIsOther && !bIsOther) return -1
    if (!aIsOther && bIsOther) return 1

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

  const outcomeById = new Map<string, ControlPointOutcomeRow>(
    (outcomeRows ?? []).map((row) => [row.id, row as ControlPointOutcomeRow])
  )
  for (const row of interiorOutcomeRows ?? []) {
    outcomeById.set(row.id, row as ControlPointOutcomeRow)
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
      const line = note ? `${label}: ${note}` : `${label}: --`
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
        logo_url: frozenCompanyFromSnapshot?.logo_url ?? profile?.logo_path ?? null,
      },
      profile: {
        full_name: valueOrFallback(frozenProfileFromSnapshot?.full_name ?? profile?.full_name ?? null),
        sbr_group: valueOrFallback(
          frozenProfileFromSnapshot?.sbr_group ?? profileCertificationSummary.sbr_group ?? null
        ),
        sbr_status: valueOrFallback(
          frozenProfileFromSnapshot?.sbr_status ?? profileCertificationSummary.sbr_status ?? null
        ),
        membership_number: valueOrFallback(
          frozenProfileFromSnapshot?.membership_number ??
            profileCertificationSummary.membership_number ??
            null
        ),
        certification_number: valueOrFallback(
          frozenProfileFromSnapshot?.certification_number ??
            profileCertificationSummary.certification_number ??
            null,
          ''
        ),
        certification_items: Array.isArray(frozenProfileFromSnapshot?.certification_items)
          ? frozenProfileFromSnapshot.certification_items
          : profileCertificationSummary.all_selected_items,
        phone: valueOrFallback(frozenProfileFromSnapshot?.phone ?? profile?.phone ?? null),
        email: valueOrFallback(frozenProfileFromSnapshot?.email ?? profile?.email ?? null),
        company_name: valueOrFallback(
          frozenProfileFromSnapshot?.company_name ?? profile?.company_name ?? null
        ),
        company_orgno: valueOrFallback(
          frozenProfileFromSnapshot?.company_orgno ?? profile?.company_orgno ?? null
        ),
        company_address: valueOrFallback(
          frozenProfileFromSnapshot?.company_address ?? profile?.company_address ?? null
        ),
        company_postal_code: valueOrFallback(
          frozenProfileFromSnapshot?.company_postal_code ?? profile?.company_postal_code ?? null
        ),
        company_city: valueOrFallback(
          frozenProfileFromSnapshot?.company_city ?? profile?.company_city ?? null
        ),
      },
      properties: {
        cadastral_id: valueOrFallback(property?.cadastral_id ?? null),
        brf_name: valueOrFallback(property?.brf_name ?? null),
        apartment_number: valueOrFallback(property?.apartment_number ?? null),
        apartment_holder_name: valueOrFallback(property?.apartment_holder_name ?? null),
        address: valueOrFallback(fullAddress, fallback),
        city: valueOrFallback(property?.city ?? null),
        municipality: valueOrFallback(property?.municipality ?? null),
        owner_name: valueOrFallback(property?.owner_name ?? null),
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
        text: inspectionSide === 'apartment' ? '' : exteriorText || fallback,
        blocks: inspectionSide === 'apartment' ? [] : exteriorBlocks,
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
              (areaMeasurementHeader?.building_type as string | null | undefined) ?? null,
              valueOrFallback(buildingTypeParts.TYPE, fallback)
            ),
            building_year: valueOrFallback(
              areaMeasurementBuildingYear
            ),
            object_other: valueOrFallback(
              (areaMeasurementHeader?.object_other as string | null | undefined) ?? null
            ),
          },
          measurement: {
            instrument: valueOrFallback(
              (areaMeasurementHeader?.measurement_instrument as string | null | undefined) ?? null
            ),
            comment: valueOrFallback(
              (areaMeasurementHeader?.comment as string | null | undefined) ?? null
            ),
            other_notes: valueOrFallback(
              (areaMeasurementHeader?.other_notes as string | null | undefined) ?? null
            ),
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
              (moistureControlHeader?.building_type as string | null | undefined) ?? null,
              valueOrFallback(buildingTypeParts.TYPE, fallback)
            ),
            building_year: valueOrFallback(moistureControlBuildingYear),
            extension_note: valueOrFallback(
              (moistureControlHeader?.extension_note as string | null | undefined) ?? null
            ),
            heating: valueOrFallback(
              (moistureControlHeader?.heating as string | null | undefined) ?? null,
              valueOrFallback(buildingDataMap['Uppvärmning:'], fallback)
            ),
            ventilation: valueOrFallback(
              (moistureControlHeader?.ventilation as string | null | undefined) ?? null,
              valueOrFallback(buildingDataMap['Ventilation:'], fallback)
            ),
            object_other: valueOrFallback(
              (moistureControlHeader?.object_other as string | null | undefined) ?? null
            ),
          },
          measurement: {
            instrument: valueOrFallback(
              (moistureControlHeader?.measurement_instrument as string | null | undefined) ?? null
            ),
            comment: valueOrFallback(
              (moistureControlHeader?.comment as string | null | undefined) ?? null
            ),
          },
          rows: moistureControlRowsForReport,
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

  let content = null
  let errorMessage = ''

  try {
    const appendices = (mockData.mock?.appendices as Record<string, any> | undefined) ?? {}
    content = (
      <ReportRenderer
        spec={buildReportSpec({
          inspectionSide,
          dynamicAppendices: {
            includeAreaMeasurement: appendices.area_measurement?.enabled === true,
            includeMoistureControl: appendices.moisture_control?.enabled === true,
          },
        })}
        mockData={mockData}
        rootClassName={isPdf ? 'report-root--pdf' : undefined}
        inspectionSide={inspectionSide}
      />
    )
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'OkÃ¤nt fel vid rendering.'
  }

  const pickErrorDetails = (err: any) =>
    err
      ? {
          message: err.message ?? null,
          code: err.code ?? null,
          details: err.details ?? null,
          hint: err.hint ?? null,
          status: err.status ?? null,
        }
      : null

  const cookieStore = (await Promise.resolve(cookies() as any)) as {
    getAll?: () => { name: string }[]
  }
  const cookieEntries = typeof cookieStore.getAll === 'function' ? cookieStore.getAll() : []

  const diagnostics = {
    propertyId: resolvedParams.propertyId ?? null,
    inspectionId: resolvedParams.inspectionId ?? null,
    hasUser: Boolean(authData.user),
    userId: authData.user?.id ?? null,
    cookieNames: cookieEntries.map((cookie) => cookie.name),
    supabaseCookieNames: cookieEntries
      .map((cookie) => cookie.name)
      .filter((name) => name.startsWith('sb-') || name.includes('supabase')),
    propertyFound: Boolean(property),
    inspectionFound: Boolean(inspection),
    propertyMatchesInspection: inspection
      ? inspection.property_id === resolvedParams.propertyId
      : null,
    propertyError: pickErrorDetails(propertyError),
    inspectionError: pickErrorDetails(inspectionError),
    profileError: pickErrorDetails(profileError),
    documentError: pickErrorDetails(documentError),
    disclosureError: pickErrorDetails(disclosureError),
    conditionsError: pickErrorDetails(conditionsError),
    overviewSelectionsError: pickErrorDetails(overviewSelectionsError),
    overviewItemsError: pickErrorDetails(overviewItemsError),
    overviewGroupsError: pickErrorDetails(overviewGroupsError),
    overviewOptionsError: pickErrorDetails(overviewOptionsError),
    overviewSelectionCount: overviewSelections?.length ?? null,
    overviewItemCount: overviewItems?.length ?? null,
    overviewGroupCount: overviewGroups?.length ?? null,
    overviewOptionCount: overviewOptions?.length ?? null,
    documentCount: documentRows?.length ?? null,
    providedDocumentCount: providedDocuments.length,
    disclosureNoteLength: disclosureRow?.note?.length ?? null,
  }

  const showDiagnostics =
    !property ||
    !inspection ||
    !authData.user ||
    Boolean(propertyError) ||
    Boolean(inspectionError) ||
    Boolean(profileError) ||
    Boolean(documentError) ||
    Boolean(disclosureError)
  return (
    <div className="min-h-screen bg-neutral-100 print:bg-white">
      {!authData.user && <SessionBridge />}
      {isAutoPrint && <AutoPrintTrigger />}
      {!isEmbed && (
        <ReportToolbar
          backHref={`/properties/${resolvedParams.propertyId}/ob/${resolvedParams.inspectionId}`}
        />
      )}
      {showDiagnostics && (
        <div className="mx-auto w-full max-w-3xl px-4 pt-4 print:hidden">
          <details className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <summary className="cursor-pointer font-semibold">
              Teknisk felsÃ¶kning (utlÃ¥tande)
            </summary>
            <pre className="mt-2 whitespace-pre-wrap">
              {JSON.stringify(diagnostics, null, 2)}
            </pre>
            <ClientSessionDebug />
          </details>
        </div>
      )}
      {errorMessage ? (
        <div className="mx-auto w-full max-w-3xl rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : (
        content
      )}
    </div>
  )
}







