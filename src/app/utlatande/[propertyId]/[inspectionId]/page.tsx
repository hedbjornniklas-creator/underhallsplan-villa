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
  const trimText = (value: string | null | undefined) => (value ?? '').trim()
  const normalizeSwedish = (value: string) =>
    value
      .replace(/ÃƒÂ¤/g, 'Ã¤')
      .replace(/ÃƒÂ¥/g, 'Ã¥')
      .replace(/ÃƒÂ¶/g, 'Ã¶')
      .replace(/Ãƒâ€ž/g, 'Ã„')
      .replace(/Ãƒâ€¦/g, 'Ã…')
      .replace(/Ãƒâ€“/g, 'Ã–')
      .replace(/ÃƒÂ©/g, 'Ã©')
      .replace(/Ãƒâ€°/g, 'Ã‰')

  const normalizeKey = (value: string | null | undefined) =>
    normalizeSwedish(String(value ?? '')).trim().toLowerCase()

  const floorLabelFromKey = (value: string) => {
    const key = normalizeKey(value)
    if (key === 'kÃ¤llare') return 'KÃ¤llare'
    if (key === 'kÃ¤llare_delvis') return 'KÃ¤llare (delvis)'
    if (key === 'entrÃ©plan') return 'EntrÃ©plan'
    if (key === 'plan2') return 'Plan 2'
    if (key === 'plan3') return 'Plan 3'
    if (key.startsWith('plan')) return `Plan ${key.replace('plan', '')}`
    if (key === 'vind') return 'Vind'
    if (key === 'ovrigt' || key === 'Ã¶vrigt') return 'Ã–vrigt'
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

  const { data: property, error: propertyError } = await supabase
    .from('properties')
    .select('id, address, postal_code, city, municipality, cadastral_id, owner_name, cover_path')
    .eq('id', resolvedParams.propertyId)
    .maybeSingle()

  if (propertyError) {
    console.error('Kunde inte hÃ¤mta fastighet', propertyError)
  }

  const { data: inspectionData, error: inspectionError } = await supabase
    .from('inspections')
    .select(
      'id, property_id, date, inspection_time, assignment_number, client_name, client_contact, defect_disclosures, scope, attendees, attendees_other, assignment_confirmation_delivered_date, inspection_side'
    )
    .eq('id', resolvedParams.inspectionId)
    .maybeSingle()
  const inspection = (inspectionData as any) ?? null

  if (inspectionError) {
    console.error('Kunde inte hÃ¤mta besiktning', inspectionError)
  }

  const inspectionSide = (inspection?.inspection_side ?? null) as 'buyer' | 'seller' | null


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
          'full_name, sbr_group, sbr_status, membership_number, phone, email, company_name, company_orgno, company_address, company_postal_code, company_city, logo_path'
        )
        .eq('id', userId)
        .maybeSingle()
    : { data: null, error: null }

  if (profileError) {
    console.error('Kunde inte hÃ¤mta profil', profileError)
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

  const resolveCoverImage = (path: string | null | undefined) => {
    if (!path) return null
    if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
      return path
    }
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (!base) return null
    return `${base}/storage/v1/object/public/property-media/${path}`
  }

  const coverImageUrl = resolveCoverImage(property?.cover_path ?? null)

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
  const scopeText = renderScopeText(scopeCodes)
  const assignmentDeliveredDate = valueOrFallback(
    inspection?.assignment_confirmation_delivered_date ?? null,
    '--'
  )
  const assignmentConfirmationText = `En uppdragsbekrÃ¤ftelse med bifogad villkorsbilaga Ã¶verlÃ¤mnades till uppdragsgivaren den ${assignmentDeliveredDate}.`

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
  const buildingDataText = renderBuildingDataTextFromTemplate(
    buildingDataMap,
    undefined,
    buildingTypeParts
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
    .select('id, exterior_item_id, part_label, note, values, created_at')
    .eq('inspection_id', resolvedParams.inspectionId)
    .order('created_at', { ascending: true })

  if (exteriorObservationsError) {
    console.error('Kunde inte hamta utsida-observationer', exteriorObservationsError)
  }

  const { data: exteriorControlItems, error: exteriorControlItemsError } = await supabase
    .from('inspection_control_items')
    .select(
      'id, exterior_observation_id, control_point_id, title, note, sort_order, selected_outcome_id'
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

  const { data: interiorRoomTypes, error: interiorRoomTypesError } = await supabase
    .from('settings_interior_room_types')
    .select('key, label')
    .eq('is_active', true)

  if (interiorRoomTypesError) {
    console.error('Kunde inte hamta rumstyper (insida)', interiorRoomTypesError)
  }

  const interiorRoomRows = (interiorRooms ?? []) as InteriorRoomRow[]
  const OTHER_ROOM_TYPE_KEY = 'ovrigt'
  const FLOOR_ORDER = ['kÃ¤llare', 'kÃ¤llare_delvis', 'entrÃ©plan', 'plan2', 'plan3']

  const getFloorRank = (floor: string) => {
    if (floor === 'vind') return 900
    const index = FLOOR_ORDER.indexOf(floor)
    if (index >= 0) return index
    return 100 + floor.localeCompare('')
  }

  const sortedInteriorRooms = [...interiorRoomRows].sort((a, b) => {
    const aIsOther = a.room_type_key === OTHER_ROOM_TYPE_KEY
    const bIsOther = b.room_type_key === OTHER_ROOM_TYPE_KEY
    if (aIsOther && !bIsOther) return -1
    if (!aIsOther && bIsOther) return 1

    const aRank = getFloorRank(a.floor_label)
    const bRank = getFloorRank(b.floor_label)
    if (aRank !== bRank) return aRank - bRank

    const aOrder = a.order_index ?? 0
    const bOrder = b.order_index ?? 0
    if (aOrder !== bOrder) return aOrder - bOrder

    return (a.room_label ?? '').localeCompare(b.room_label ?? '')
  })
  const interiorRoomIds = sortedInteriorRooms.map((room) => room.id)

  const { data: interiorControlItems, error: interiorControlItemsError } =
    interiorRoomIds.length > 0
      ? await supabase
          .from('inspection_control_items')
          .select(
            'id, interior_room_id, control_point_id, title, note, sort_order, selected_outcome_id'
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

      const controlItemImages =
        controlItem.id ? imagesByControlItemId.get(controlItem.id) ?? [] : []
      const photoUrls = controlItemImages
        .map((image) => buildInspectionImageUrl(image.file_path))
        .filter((url): url is string => Boolean(url))

      const riskText = trimText(outcome?.risk_template ?? '')
      if (riskText.length > 0) {
        riskLines.push(item.label)
        riskLines.push(riskText)
        riskLines.push('')
      }

      const ftuText = trimText(outcome?.ftu_template ?? '')
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
      if (!note) return
      const label = trimText(row.part_label) || 'Fri notering'
      const line = `${label}: ${note}`
      itemLines.push(line)
      blocksForItem.push({
        title: item.label,
        noteText: line,
        riskText: '',
        ftuText: '',
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

  const roomTypeLabelByKey = new Map<string, string>(
    (interiorRoomTypes ?? []).map((row: any) => [
      normalizeKey(row.key),
      normalizeSwedish(String(row.label ?? row.key ?? '')).trim(),
    ])
  )

  for (const room of sortedInteriorRooms) {
    const floorLabel = floorLabelFromKey(room.floor_label)
    const roomTypeLabel =
      roomTypeLabelByKey.get(normalizeKey(room.room_type_key)) ??
      normalizeSwedish(String(room.room_type_key ?? '')).trim()
    const roomName = normalizeSwedish(String(room.room_label ?? '')).trim()
    const roomTitle = [floorLabel, roomTypeLabel, roomName]
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

      const riskText = trimText(outcome?.risk_template ?? '')
      if (riskText.length > 0) {
        riskLines.push(roomTitle)
        riskLines.push(riskText)
        riskLines.push('')
      }

      const ftuText = trimText(outcome?.ftu_template ?? '')
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
        logo_url: profile?.logo_path ?? null,
      },
      profile: {
        full_name: valueOrFallback(profile?.full_name ?? null),
        sbr_group: valueOrFallback(profile?.sbr_group ?? null),
        sbr_status: valueOrFallback(profile?.sbr_status ?? null),
        membership_number: valueOrFallback(profile?.membership_number ?? null),
        phone: valueOrFallback(profile?.phone ?? null),
        email: valueOrFallback(profile?.email ?? null),
        company_name: valueOrFallback(profile?.company_name ?? null),
        company_orgno: valueOrFallback(profile?.company_orgno ?? null),
        company_address: valueOrFallback(profile?.company_address ?? null),
        company_postal_code: valueOrFallback(profile?.company_postal_code ?? null),
        company_city: valueOrFallback(profile?.company_city ?? null),
      },
      properties: {
        cadastral_id: valueOrFallback(property?.cadastral_id ?? null),
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
            : 'SÃ¤ljaren fÃ¶rvÃ¤rvade fastigheten --.',
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
    },
  }

  let content = null
  let errorMessage = ''

  try {
    content = (
      <ReportRenderer
        spec={buildReportSpec({ inspectionSide })}
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







