'use client'

import {
  useEffect,
  useMemo,
  useState,
  ChangeEvent,
  useRef,
  useCallback,
  type CSSProperties,
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { supabase } from '@/lib/supabaseClient'
import DebouncedTextarea from './DebouncedTextarea'
import ControlPointSearchDialog, {
  type ControlPointSearchMode,
  type ControlPointSearchResult,
} from './ControlPointSearchDialog'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  assignment_number: string | null
  status?: string | null
  locked_at?: string | null
  inspection_side?: string | null
}
type InspectionSide = 'buyer' | 'seller' | 'apartment'
type SearchMode = ControlPointSearchMode
type ValueMap = Record<string, unknown>

type RoomType = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type InteriorGroup = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  field_type: string | null
}

type InteriorOption = {
  id: string
  group_id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  trigger_tags?: unknown
}

type InteriorRoom = {
  id?: string
  inspection_id: string
  floor_label: string
  order_index: number
  room_type_key: string
  room_label: string
  values: ValueMap
  note: string | null
}

type InspectionControlItem = {
  id?: string
  inspection_id: string
  interior_room_id: string
  control_point_id: string | null
  title: string
  status: string | null
  note: string | null
  risk_text?: string | null
  ftu_text?: string | null
  sort_order: number
  selected_outcome_id: string | null
}

type ControlPointLite = ControlPointSearchResult & {
  id: string
  key: string
  title: string
  label: string | null
  description: string | null
  scope?: string | null
  exterior_item_key?: string | null
  tags: unknown
  trigger_room_types?: unknown
  applies_to?: unknown
  search_hint?: string | null
}

type ControlPointOutcome = {
  id: string
  control_point_id: string
  label: string
  severity: number
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
  sort_order: number
  is_active: boolean
}

type ControlPointMeta = {
  id: string
  title: string
  label: string | null
  description: string | null
  trigger_room_types?: unknown
  applies_to?: unknown
}

type InspectionImage = {
  id: string
  inspection_id: string
  exterior_observation_id: string | null
  interior_room_id: string | null
  control_item_id: string | null
  file_path: string
  label: string | null
  sort_order: number
  created_at?: string | null
  capture_source?: string | null
  source_area?: string | null
  origin_interior_room_id?: string | null
  origin_exterior_observation_id?: string | null
  origin_exterior_item_id?: string | null
  origin_floor_label?: string | null
  origin_room_label?: string | null
  origin_room_type_key?: string | null
  origin_exterior_item_key?: string | null
  captured_at?: string | null
  processing_status?: string | null
  ignored_at?: string | null
}

type SettingsExteriorItemLite = {
  id: string
  key: string
  label: string
}

type InteriorPanelFilter = 'current' | 'floor' | 'interior' | 'all'
type InteriorImageViewCount = 15 | 9 | 1
type PanelTab = 'images' | 'quick_notes'
type QuickNoteFilter = InteriorPanelFilter
type MobileSplitDragState = {
  pointerId: number
  startY: number
  startHeight: number
  containerHeight: number
}
type ImageBankTarget = {
  controlItem: InspectionControlItem
  title: string
}

type RoundQuickNote = {
  id: string
  inspection_id: string
  source_area: 'interior' | 'exterior'
  interior_room_id: string | null
  exterior_observation_id: string | null
  exterior_item_id: string | null
  note: string
  created_at?: string | null
  updated_at?: string | null
}

type ObStepInsidaProps = {
  inspection: Inspection
}

const RED_STATUS: InspectionControlItem['status'] = null
const OTHER_ROOM_TYPE_KEY = 'ovrigt'
const OTHER_ROOM_DISPLAY_LABEL = 'Allm\u00e4nt'
const normalizeInspectionStatus = (value: string | null | undefined) => {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'completed' || normalized === 'klar' || normalized === 'done') {
    return 'completed'
  }
  return normalized
}

// Storage-bucket för bilder
const IMAGE_BUCKET = 'inspection-images' as const
const IMAGE_DRAG_DATA_TYPE = 'application/x-ob-insida-image-id'

const getImagePublicUrl = (filePath: string) => {
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

const sortAttachedImages = (imageList: InspectionImage[]) =>
  [...imageList].sort((a, b) => {
    const sortCompare = (a.sort_order ?? 0) - (b.sort_order ?? 0)
    if (sortCompare !== 0) return sortCompare
    const left = new Date(a.created_at ?? 0).getTime()
    const right = new Date(b.created_at ?? 0).getTime()
    return left - right
  })

const removeImageFromImageMap = (
  map: Record<string, InspectionImage[]>,
  imageId: string
) => {
  const next: Record<string, InspectionImage[]> = {}
  for (const [key, images] of Object.entries(map)) {
    const filtered = images.filter(image => image.id !== imageId)
    if (filtered.length > 0) next[key] = filtered
  }
  return next
}

const addImageToImageMap = (
  map: Record<string, InspectionImage[]>,
  targetId: string,
  image: InspectionImage
) => {
  const next = removeImageFromImageMap(map, image.id)
  next[targetId] = sortAttachedImages([...(next[targetId] ?? []), image])
  return next
}

const removeImagesFromImageMap = (
  map: Record<string, InspectionImage[]>,
  imageIds: Set<string>
) => {
  const next: Record<string, InspectionImage[]> = {}
  for (const [key, images] of Object.entries(map)) {
    const filtered = images.filter(image => !imageIds.has(image.id))
    if (filtered.length > 0) next[key] = filtered
  }
  return next
}

const isImageLinkedToNote = (image: InspectionImage) =>
  Boolean(image.control_item_id || image.exterior_observation_id)

// -----------------------------
// Hjälpfunktion: bygg våningsnycklar från Förutsättningar (Byggnadstyp)
// -----------------------------
const parseFloorCount = (value: ValueMap[keyof ValueMap]) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value))
  }

  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized) return 0

  const halfFloorMatch = normalized.match(/^(\d+)(?:_5|\.5)$/)
  if (halfFloorMatch) {
    return Number(halfFloorMatch[1]) + 1
  }

  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

const buildFloorsFromAnswers = (answers: ValueMap): string[] => {
  const floorsVal =
    answers['floors'] ??
    answers['våningar'] ??
    answers['våning'] ??
    null

  const basementVal =
    answers['basement'] ??
    answers['källare'] ??
    null

  const atticVal = answers['attic'] ?? null

  const count = parseFloorCount(floorsVal)

  const keys: string[] = []

  if (basementVal === 'yes' || basementVal === 'ja' || basementVal === true) {
    keys.push('källare')
  } else if (basementVal === 'partial' || basementVal === 'delvis') {
    keys.push('källare_delvis')
  }

  for (let floor = 1; floor <= count; floor += 1) {
    keys.push(`plan${floor}`)
  }
  if (atticVal !== null && atticVal !== undefined && String(atticVal).trim() !== '') {
    keys.push('vind')
  }

  return keys
}

const normalizeSwedish = (value: string) =>
  value
    .replace(/Ã¤/g, 'ä')
    .replace(/Ã¥/g, 'å')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã„/g, 'Ä')
    .replace(/Ã…/g, 'Å')
    .replace(/Ã–/g, 'Ö')
    .replace(/Ã©/g, 'é')

const parseInspectionSideToken = (value: string): InspectionSide | null => {
  const token = normalizeSwedish(value)
    .trim()
    .toLowerCase()
    .replaceAll('å', 'a')
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')

  if (token.includes('seller') || token.includes('salj')) return 'seller'
  if (token.includes('apartment') || token.includes('lagenhet') || token.includes('apt')) {
    return 'apartment'
  }
  if (token.includes('buyer') || token.includes('kop')) return 'buyer'
  return null
}

const normalizeInspectionSide = (value: unknown): InspectionSide => {
  if (typeof value !== 'string') return 'buyer'
  return parseInspectionSideToken(value) ?? 'buyer'
}

const parseAppliesToSides = (raw: unknown): InspectionSide[] | null => {
  if (raw == null) return null

  let tokens: string[] = []
  if (Array.isArray(raw)) {
    tokens = raw.filter((value): value is string => typeof value === 'string')
  } else if (typeof raw === 'string') {
    tokens = raw.split(/[,;|]/g)
  } else {
    return null
  }

  const normalizedTokens = tokens
    .map(token =>
      normalizeSwedish(token)
        .trim()
        .toLowerCase()
        .replaceAll('å', 'a')
        .replaceAll('ä', 'a')
        .replaceAll('ö', 'o')
    )
    .filter(Boolean)

  if (normalizedTokens.includes('all')) return null

  const parsed = Array.from(
    new Set(
      normalizedTokens
        .map(token => parseInspectionSideToken(token))
        .filter((token): token is InspectionSide => token !== null)
    )
  )
  return parsed.length > 0 ? parsed : null
}

const controlPointAppliesToInspectionSide = (
  controlPoint: Pick<ControlPointLite, 'applies_to'>,
  inspectionSide: InspectionSide
) => {
  const appliesTo = parseAppliesToSides(controlPoint.applies_to)
  return !appliesTo || appliesTo.includes(inspectionSide)
}

const normalizeRoomTypeKey = (value: string | null | undefined) => {
  const base = normalizeSwedish(String(value ?? '')).trim().toLowerCase()
  if (base === 'ovrigt') return 'övrigt'
  return base
}

const sortRoomTypesByLabel = (roomTypes: RoomType[]) =>
  [...roomTypes].sort((a, b) =>
    normalizeSwedish(a.label || a.key).localeCompare(
      normalizeSwedish(b.label || b.key),
      'sv',
      { sensitivity: 'base' }
    )
  )

const isOtherRoomKey = (value: string | null | undefined) => {
  const key = normalizeRoomTypeKey(value)
  return key === 'ovrigt' || key === 'övrigt'
}

const isPgUniqueViolation = (error: unknown) => {
  const err = (error && typeof error === 'object' ? error : null) as
    | { code?: string; details?: string; message?: string }
    | null
  return (
    err?.code === '23505' ||
    err?.details?.includes('duplicate key value violates unique constraint') ||
    err?.message?.includes('duplicate key value violates unique constraint')
  )
}

const getNormalizedTriggerRoomTypes = (triggerRoomTypes: unknown) => {
  const raw = Array.isArray(triggerRoomTypes) ? triggerRoomTypes : []
  return raw
    .map(val => normalizeRoomTypeKey((val ?? null) as string | null))
    .filter((val): val is string => !!val)
}

const triggerRoomTypesMatchRoom = (
  triggerRoomTypes: unknown,
  roomTypeKey: string | null | undefined
) => {
  const roomKey = normalizeRoomTypeKey(roomTypeKey)
  if (!roomKey) return false

  // Endast kontrollpunkter med explicit tagg för rumstyp får visas/läggas till.
  const normalizedTriggerRoomTypes = getNormalizedTriggerRoomTypes(triggerRoomTypes)
  if (normalizedTriggerRoomTypes.length === 0) return false

  return normalizedTriggerRoomTypes.includes(roomKey)
}

const controlPointMatchesRoom = (
  cp: ControlPointLite,
  roomTypeKey: string | null | undefined
) => {
  return triggerRoomTypesMatchRoom(cp.trigger_room_types, roomTypeKey)
}

// Visningslabel för våningsnycklar
const floorLabelFromKey = (k: string) => {
  const normalized = normalizeSwedish(k)
  if (normalized === 'källare') return 'Källare'
  if (normalized === 'källare_delvis') return 'Källare'
  if (normalized === 'entréplan' || normalized === 'plan1') return 'Plan 1'
  if (normalized === 'plan2') return 'Plan 2'
  if (normalized === 'plan3') return 'Plan 3'
  if (normalized.startsWith('plan')) return `Plan ${normalized.replace('plan', '')}`
  return normalized
}

const normalizeFloorKey = (value: string | null | undefined) => {
  const normalized = normalizeSwedish(String(value ?? '')).trim()
  if (normalized === 'entréplan') return 'plan1'
  return normalized
}

// =============================
// Huvudkomponent
// =============================
export default function ObStepInsida({ inspection }: ObStepInsidaProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInspectionLocked = Boolean(inspection?.locked_at)
  const inspectionSide = normalizeInspectionSide(inspection?.inspection_side)

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [groups, setGroups] = useState<InteriorGroup[]>([])
  const [options, setOptions] = useState<InteriorOption[]>([])
  const [rooms, setRooms] = useState<InteriorRoom[]>([])

  // Kontrollpunkter per rum
  const [controlItems, setControlItems] = useState<InspectionControlItem[]>([])
  const [outcomesByControlPointId, setOutcomesByControlPointId] = useState<
    Record<string, ControlPointOutcome[]>
  >({})
  const [controlPointMetaById, setControlPointMetaById] = useState<
    Record<string, ControlPointMeta>
  >({})

  const [atticLabel, setAtticLabel] = useState<string | null>(null)

  // Bilder per kontrollpunkt
  const [imagesByControlItemId, setImagesByControlItemId] = useState<
    Record<string, InspectionImage[]>
  >({})
  const [allInspectionImages, setAllInspectionImages] = useState<InspectionImage[]>([])
  const [panelTab, setPanelTab] = useState<PanelTab>('images')
  const [imageFilter, setImageFilter] = useState<InteriorPanelFilter>('current')
  const [imageViewCount, setImageViewCount] = useState<InteriorImageViewCount>(9)
  const [showLinkedImages, setShowLinkedImages] = useState(false)
  const [selectedPanelImageIds, setSelectedPanelImageIds] = useState<Set<string>>(() => new Set())
  const [imageBankTarget, setImageBankTarget] = useState<ImageBankTarget | null>(null)
  const [selectedImageBankIds, setSelectedImageBankIds] = useState<Set<string>>(() => new Set())
  const [quickNoteFilter, setQuickNoteFilter] = useState<QuickNoteFilter>('current')
  const [quickNotes, setQuickNotes] = useState<RoundQuickNote[]>([])
  const [exteriorItems, setExteriorItems] = useState<SettingsExteriorItemLite[]>([])
  const [mobileImagePanelHeight, setMobileImagePanelHeight] = useState(63)
  const [previewImage, setPreviewImage] = useState<InspectionImage | null>(null)

  // Våningar hämtade från Förutsättningar → Byggnadstyp
  const [derivedFloors, setDerivedFloors] = useState<string[]>([])

  const [activeFloor, setActiveFloor] = useState<string | null>(null)

  // För ny-rumsformulär
  const [showNewRoomForm, setShowNewRoomForm] = useState(false)
  const [newFloorLabel, setNewFloorLabel] = useState('') // intern floor key om vi har derivedFloors
  const [newRoomTypeKey, setNewRoomTypeKey] = useState<string>('')
  const [newRoomLabel, setNewRoomLabel] = useState('')

  const [editingRoomId, setEditingRoomId] = useState<string | null>(null)
  const [editRoomLabel, setEditRoomLabel] = useState('')
  const [editRoomTypeKey, setEditRoomTypeKey] = useState('')
  const [editRoomFloorLabel, setEditRoomFloorLabel] = useState('')
  const [collapsedRoomIds, setCollapsedRoomIds] = useState<Set<string>>(
    () => new Set()
  )
  const [useHybridLayout] = useState(true)
  const [activeHybridRoomId, setActiveHybridRoomId] = useState<string | null>(null)
  const otherRoomEnsuredRef = useRef(false)
  const otherRoomItemsEnsuredRef = useRef(false)
  const hasLoadedCollapsedRoomsRef = useRef(false)
  const overlayHistoryPushedRef = useRef(false)
  const mobileSplitContainerRef = useRef<HTMLDivElement | null>(null)
  const mobileSplitDragRef = useRef<MobileSplitDragState | null>(null)
  const collapsedRoomsStorageKey = `ob:insida:collapsed:${inspection.id}:rooms`

  useEffect(() => {
    otherRoomEnsuredRef.current = false
    otherRoomItemsEnsuredRef.current = false
  }, [inspection?.id])

  useEffect(() => {
    hasLoadedCollapsedRoomsRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(collapsedRoomsStorageKey)
      if (!raw) {
        setCollapsedRoomIds(new Set())
        hasLoadedCollapsedRoomsRef.current = true
        return
      }
      const parsed = JSON.parse(raw)
      setCollapsedRoomIds(
        Array.isArray(parsed)
          ? new Set(parsed.filter((value): value is string => typeof value === 'string'))
          : new Set()
      )
    } catch (e) {
      console.warn('Kunde inte läsa dolda rum för insida:', e)
      setCollapsedRoomIds(new Set())
    } finally {
      hasLoadedCollapsedRoomsRef.current = true
    }
  }, [collapsedRoomsStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedCollapsedRoomsRef.current) return
    try {
      window.localStorage.setItem(
        collapsedRoomsStorageKey,
        JSON.stringify(Array.from(collapsedRoomIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara dolda rum för insida:', e)
    }
  }, [collapsedRoomIds, collapsedRoomsStorageKey])

  useEffect(() => {
    setImageFilter('current')
    setQuickNoteFilter('current')
    setPreviewImage(null)
    setSelectedPanelImageIds(new Set())
    setImageBankTarget(null)
    setSelectedImageBankIds(new Set())
  }, [activeHybridRoomId])

  useEffect(() => {
    setSelectedPanelImageIds(prev => {
      const existingIds = new Set(allInspectionImages.map(image => image.id))
      const next = new Set(Array.from(prev).filter(imageId => existingIds.has(imageId)))
      return next.size === prev.size ? prev : next
    })
  }, [allInspectionImages])

  useEffect(() => {
    setSelectedImageBankIds(prev => {
      const availableIds = new Set(
        allInspectionImages
          .filter(image => !isImageLinkedToNote(image))
          .map(image => image.id)
      )
      const next = new Set(Array.from(prev).filter(imageId => availableIds.has(imageId)))
      return next.size === prev.size ? prev : next
    })
  }, [allInspectionImages])

  const closeImageBank = useCallback(() => {
    setImageBankTarget(null)
    setSelectedImageBankIds(new Set())
  }, [])

  const closeTopOverlay = useCallback(() => {
    if (previewImage) {
      setPreviewImage(null)
      return true
    }
    if (imageBankTarget) {
      closeImageBank()
      return true
    }
    if (activeHybridRoomId) {
      setActiveHybridRoomId(null)
      return true
    }
    return false
  }, [activeHybridRoomId, closeImageBank, imageBankTarget, previewImage])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const overlayOpen = Boolean(previewImage || imageBankTarget || activeHybridRoomId)
    if (!overlayOpen) {
      overlayHistoryPushedRef.current = false
      return
    }

    if (!overlayHistoryPushedRef.current) {
      window.history.pushState({ obStepInsidaOverlay: true }, '', window.location.href)
      overlayHistoryPushedRef.current = true
    }

    const handlePopState = () => {
      if (closeTopOverlay()) {
        overlayHistoryPushedRef.current = false
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [activeHybridRoomId, closeTopOverlay, imageBankTarget, previewImage])

  useEffect(() => {
    if (!inspection?.id) return

    const loadAll = async () => {
      setLoading(true)
      setError(null)
      try {
        // 1) Rumstyper, grupper, options, befintliga rum
        const [
          { data: rtData, error: rtErr },
          { data: gData, error: gErr },
          { data: oData, error: oErr },
          { data: rData, error: rErr },
          { data: exteriorItemData, error: exteriorItemErr },
          { data: quickNoteData, error: quickNoteErr },
        ] = await Promise.all([
          supabase
            .from('settings_interior_room_types')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('settings_interior_groups')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('settings_interior_options')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('inspection_interior_rooms')
            .select('*')
            .eq('inspection_id', inspection.id)
            .order('floor_label', { ascending: true })
            .order('order_index', { ascending: true }),
          supabase
            .from('settings_exterior_items')
            .select('id,key,label')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('inspection_round_quick_notes')
            .select('*')
            .eq('inspection_id', inspection.id)
            .order('updated_at', { ascending: false }),
        ])

        if (rtErr) throw rtErr
        if (gErr) throw gErr
        if (oErr) throw oErr
        if (rErr) throw rErr
        if (exteriorItemErr) throw exteriorItemErr
        if (quickNoteErr) throw quickNoteErr

        const roomTypesArr = (rtData ?? []) as RoomType[]
        const filteredRoomTypes = roomTypesArr.filter(rt => {
          const label = normalizeSwedish(rt.label ?? '').toLowerCase()
          const key = normalizeSwedish(rt.key ?? '').toLowerCase()
          return label !== 'rum saknas' && key !== 'rum_saknas'
        })
        setRoomTypes(sortRoomTypesByLabel(filteredRoomTypes))
        setGroups((gData ?? []) as InteriorGroup[])
        setOptions((oData ?? []) as InteriorOption[])
        setExteriorItems((exteriorItemData ?? []) as SettingsExteriorItemLite[])
        setQuickNotes((quickNoteData ?? []) as RoundQuickNote[])

        const roomsArr = (rData ?? []) as Array<InteriorRoom & { values?: unknown }>
        const normalizedRooms: InteriorRoom[] = roomsArr.map(r => ({
          ...r,
          values: (r.values as ValueMap) || {},
        }))
        setRooms(normalizedRooms)

        // 2) Hämta våningsinfo från Förutsättningar → Byggnadstyp
        let floorsFromConditions: string[] = []
        try {
          const { data: buildingItem, error: btErr } = await supabase
            .from('settings_overview_items')
            .select('id, key')
            .eq('key', 'building_type')
            .eq('is_active', true)
            .maybeSingle()

          if (btErr) throw btErr

          if (buildingItem) {
            const { data: btSelData, error: btSelErr } = await supabase
              .from('inspection_overview_selections')
              .select('values')
              .eq('inspection_id', inspection.id)
              .eq('overview_item_id', buildingItem.id)
              .order('set_index', { ascending: true })

            if (btSelErr) throw btSelErr

            const answers = (btSelData?.[0]?.values as ValueMap) || {}
            floorsFromConditions = buildFloorsFromAnswers(answers)

            const rawAttic = answers['attic'] ?? null
            if (
              rawAttic !== null &&
              rawAttic !== undefined &&
              String(rawAttic).trim() !== ''
            ) {
              try {
                const { data: atticGroup, error: atticGroupErr } = await supabase
                  .from('settings_overview_groups')
                  .select('id, key')
                  .eq('overview_item_id', buildingItem.id)
                  .eq('key', 'attic')
                  .eq('is_active', true)
                  .maybeSingle()

                if (atticGroupErr) throw atticGroupErr

                if (atticGroup) {
                  const { data: atticOptions, error: atticOptErr } =
                    await supabase
                      .from('settings_overview_options')
                      .select('value, label')
                      .eq('group_id', atticGroup.id)
                      .eq('is_active', true)

                  if (atticOptErr) throw atticOptErr

                  const options = (atticOptions ?? []) as Array<{
                    value: string | null
                    label: string | null
                  }>
                  const match = options.find(o => o.value === rawAttic)
                  setAtticLabel(match?.label ?? String(rawAttic))
                } else {
                  setAtticLabel(String(rawAttic))
                }
              } catch (atticErr) {
                console.warn('Kunde inte läsa vind-etikett:', atticErr)
                setAtticLabel(String(rawAttic))
              }
            } else {
              setAtticLabel(null)
            }
          }
        } catch (e) {
          console.warn('Kunde inte läsa våningsinfo från Förutsättningar:', e)
        }

        setDerivedFloors(floorsFromConditions)

        // 3) Läs kontrollpunkter per rum
        const roomIds = normalizedRooms
          .map(r => r.id)
          .filter((id): id is string => !!id)

        if (roomIds.length > 0) {
          const { data: ciData, error: ciErr } = await supabase
            .from('inspection_control_items')
            .select('*')
            .in('interior_room_id', roomIds)
            .order('sort_order', { ascending: true })

          if (ciErr) throw ciErr
          const ciRows = (ciData ?? []) as InspectionControlItem[]
          const ciArr = ciRows.map(ci => ({
            ...ci,
            selected_outcome_id: ci.selected_outcome_id ?? null,
            risk_text: ci.risk_text ?? null,
            ftu_text: ci.ftu_text ?? null,
          }))
          setControlItems(ciArr)

          const cpIds = Array.from(
            new Set(
              ciArr
                .map(ci => ci.control_point_id)
                .filter((id): id is string => !!id)
            )
          )

          if (cpIds.length === 0) {
            setOutcomesByControlPointId({})
            setControlPointMetaById({})
          } else {
            try {
              const { data: outcomesData, error: outcomesErr } = await supabase
                .from('settings_control_point_outcomes')
                .select(
                  'id, control_point_id, label, severity, note_template, risk_template, ftu_template, sort_order, is_active'
                )
                .in('control_point_id', cpIds)
                .eq('is_active', true)
                .order('sort_order', { ascending: true })

              if (outcomesErr) throw outcomesErr

              const outcomesArr = (outcomesData ?? []) as ControlPointOutcome[]
              const outcomesMap: Record<string, ControlPointOutcome[]> = {}
              for (const outcome of outcomesArr) {
                const key = outcome.control_point_id
                outcomesMap[key] = outcomesMap[key] || []
                outcomesMap[key].push(outcome)
              }
              setOutcomesByControlPointId(outcomesMap)
            } catch (outcomesErr) {
              console.error(
                'settings_control_point_outcomes (insida) error:',
                outcomesErr
              )
              setOutcomesByControlPointId({})
            }

            try {
              const { data: metaData, error: metaErr } = await supabase
                .from('settings_control_points')
                .select('id, title, label, description, trigger_room_types')
                .in('id', cpIds)
                .eq('is_active', true)

              if (metaErr) throw metaErr

              const metaArr = (metaData ?? []) as ControlPointMeta[]
              const metaMap: Record<string, ControlPointMeta> = {}
              for (const meta of metaArr) {
                metaMap[meta.id] = meta
              }
              setControlPointMetaById(metaMap)
            } catch (metaErr) {
              console.error('settings_control_points (insida) error:', metaErr)
              setControlPointMetaById({})
            }
          }
        } else {
          setControlItems([])
          setOutcomesByControlPointId({})
          setControlPointMetaById({})
        }

        // 4) Läs bilder kopplade till kontrollpunkter (insida)
        const { data: imgData, error: imgErr } = await supabase
          .from('inspection_images')
          .select('*')
          .eq('inspection_id', inspection.id)
          .not('control_item_id', 'is', null)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })

        if (imgErr) throw imgErr

        const imgsArr = (imgData ?? []) as InspectionImage[]
        const imgMap: Record<string, InspectionImage[]> = {}
        for (const img of imgsArr) {
          if (!img.control_item_id) continue
          const key = img.control_item_id
          imgMap[key] = imgMap[key] || []
          imgMap[key].push(img)
        }
        setImagesByControlItemId(imgMap)

        const { data: allImgData, error: allImgErr } = await supabase
          .from('inspection_images')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('created_at', { ascending: false })

        if (allImgErr) throw allImgErr

        setAllInspectionImages((allImgData ?? []) as InspectionImage[])

        // 5) Sätt aktivt plan
        if (floorsFromConditions.length) {
          setActiveFloor(floorsFromConditions[0])
        } else if (normalizedRooms.length) {
          setActiveFloor(normalizeFloorKey(normalizedRooms[0].floor_label))
        } else {
          setActiveFloor(null)
        }

        // 6) Default rumstyp + plan i formuläret
        if (!newRoomTypeKey && (rtData ?? []).length) {
          setNewRoomTypeKey((rtData as RoomType[])[0].key)
        }

        if (!newFloorLabel) {
          if (floorsFromConditions.length) {
            setNewFloorLabel(floorsFromConditions[0])
          } else {
            setNewFloorLabel('plan1')
          }
        }
      } catch (e: unknown) {
        console.error('loadAll insida failed:', e)
        setError(e instanceof Error ? e.message : 'Kunde inte ladda Insida-data.')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
  }, [inspection?.id])
  useEffect(() => {
    if (!inspection?.id) return
    if (isInspectionLocked) return
    if (loading) return
    if (!roomTypes.length) return
    if (otherRoomEnsuredRef.current) return

    const existing = rooms.find(room => isOtherRoomKey(room.room_type_key))
    if (existing) {
      otherRoomEnsuredRef.current = true
      return
    }

    otherRoomEnsuredRef.current = true
    const label = OTHER_ROOM_DISPLAY_LABEL
    const newRoom: InteriorRoom = {
      inspection_id: inspection.id,
      floor_label: OTHER_ROOM_TYPE_KEY,
      order_index: 0,
      room_type_key: OTHER_ROOM_TYPE_KEY,
      room_label: label,
      values: {},
      note: null,
    }

    ;(async () => {
      const saved = await upsertRoom(newRoom)
      if (!saved.id) {
        otherRoomEnsuredRef.current = false
        return
      }

      setRooms(prev => {
        const alreadyExists = prev.some(r => r.id === saved.id)
        const merged = alreadyExists
          ? prev.map(r => (r.id === saved.id ? saved : r))
          : [saved, ...prev]
        return merged.sort(sortRooms)
      })
      if (!activeFloor) setActiveFloor(OTHER_ROOM_TYPE_KEY)
    })()
  }, [inspection?.id, isInspectionLocked, loading, roomTypes, rooms, activeFloor])

  useEffect(() => {
    if (loading) return
    if (otherRoomItemsEnsuredRef.current) return
    const otherRoom = rooms.find(room => isOtherRoomKey(room.room_type_key))
    if (!otherRoom?.id) return

    const hasItems = controlItems.some(
      ci => ci.interior_room_id === otherRoom.id && ci.control_point_id
    )
    if (hasItems) {
      otherRoomItemsEnsuredRef.current = true
      return
    }

    otherRoomItemsEnsuredRef.current = true
    ;(async () => {
      try {
        await createDefaultControlItemsForRoom(otherRoom)
      } catch (e) {
        console.error('ensure default control items for Allm\u00e4nt failed:', e)
      }
    })()
  }, [loading, rooms, controlItems])


  const optionsByGroup = useMemo(() => {
    const map: Record<string, InteriorOption[]> = {}
    for (const o of options) {
      map[o.group_id] = map[o.group_id] || []
      map[o.group_id].push(o)
    }
    return map
  }, [options])

  const filteredGroups = useMemo(() => {
    const blockedTokens = ['vägg', 'tak', 'golv', 'ventilation', 'fukt']
    return groups.filter(g => {
      const label = (g.label || '').toLowerCase()
      const key = (g.key || '').toLowerCase()
      return !blockedTokens.some(token => label.includes(token) || key.includes(token))
    })
  }, [groups])

  const ensureControlPointData = async (cpIds: string[]) => {
    const uniqueIds = Array.from(new Set(cpIds)).filter(
      (id): id is string => !!id
    )
    if (uniqueIds.length === 0) return

    const missingOutcomes = uniqueIds.filter(
      id => !outcomesByControlPointId[id]
    )
    if (missingOutcomes.length > 0) {
      const { data: outcomesData, error: outcomesErr } = await supabase
        .from('settings_control_point_outcomes')
        .select(
          'id, control_point_id, label, severity, note_template, risk_template, ftu_template, sort_order, is_active'
        )
        .in('control_point_id', missingOutcomes)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (outcomesErr) {
        console.error(
          'settings_control_point_outcomes (insida) error:',
          outcomesErr
        )
      } else {
        const outcomesArr = (outcomesData ?? []) as ControlPointOutcome[]
        const outcomesMap: Record<string, ControlPointOutcome[]> = {}
        for (const outcome of outcomesArr) {
          const key = outcome.control_point_id
          outcomesMap[key] = outcomesMap[key] || []
          outcomesMap[key].push(outcome)
        }
        setOutcomesByControlPointId(prev => ({ ...prev, ...outcomesMap }))
      }
    }

    const missingMeta = uniqueIds.filter(id => !controlPointMetaById[id])
    if (missingMeta.length > 0) {
      const { data: metaData, error: metaErr } = await supabase
        .from('settings_control_points')
        .select('id, title, label, description, trigger_room_types')
        .in('id', missingMeta)
        .eq('is_active', true)

      if (metaErr) {
        console.error('settings_control_points (insida) error:', metaErr)
      } else {
        const metaArr = (metaData ?? []) as ControlPointMeta[]
        const metaMap: Record<string, ControlPointMeta> = {}
        for (const meta of metaArr) {
          metaMap[meta.id] = meta
        }
        setControlPointMetaById(prev => ({ ...prev, ...metaMap }))
      }
    }
  }

  // Våningar för flikar
  const floorLabels = useMemo(() => {
    const base = derivedFloors.length
      ? derivedFloors.map(normalizeFloorKey)
      : Array.from(new Set(rooms.map(r => normalizeFloorKey(r.floor_label))))

    const withoutOther = base.filter(k => k && k !== OTHER_ROOM_TYPE_KEY)
    const hasVind = withoutOther.includes('vind')
    const withoutVind = withoutOther.filter(k => k !== 'vind')

    const ordered = [OTHER_ROOM_TYPE_KEY, ...withoutVind, ...(hasVind ? ['vind'] : [])]
    return ordered.filter((k, idx) => ordered.indexOf(k) === idx)
  }, [derivedFloors, rooms])

  useEffect(() => {
    if (!floorLabels.length) return
    const normalizedActiveFloor = normalizeFloorKey(activeFloor)
    if (!activeFloor || !floorLabels.includes(normalizedActiveFloor)) {
      setActiveFloor(floorLabels[0])
    } else if (activeFloor !== normalizedActiveFloor) {
      setActiveFloor(normalizedActiveFloor)
    }
  }, [floorLabels, activeFloor])

  const isOtherFloor =
    normalizeSwedish(activeFloor ?? '').toLowerCase() === OTHER_ROOM_TYPE_KEY

  const getFloorLabel = (k: string) => {
    if (k === OTHER_ROOM_TYPE_KEY) return OTHER_ROOM_DISPLAY_LABEL
    if (k === 'vind') return atticLabel || 'Vind'
    return floorLabelFromKey(k)
  }

  const isMissingRoom = (room: InteriorRoom) => {
    const key = normalizeSwedish(room.room_type_key ?? '').toLowerCase()
    const label = normalizeSwedish(room.room_label ?? '').toLowerCase()
    return key === 'rum_saknas' || label === 'rum saknas'
  }

  const filteredRooms = useMemo(() => {
    if (!activeFloor) return rooms
    const target = normalizeFloorKey(activeFloor)
    return rooms.filter(
      r =>
        !isMissingRoom(r) &&
        normalizeFloorKey(r.floor_label) === target
    )
  }, [rooms, activeFloor])

  const getRoomTypeLabel = (key: string) => {
    if (isOtherRoomKey(key)) return OTHER_ROOM_DISPLAY_LABEL
    return (
      roomTypes.find(rt => normalizeRoomTypeKey(rt.key) === normalizeRoomTypeKey(key))
        ?.label ?? key
    )
  }

  const isOtherRoom = (room: InteriorRoom) =>
    isOtherRoomKey(room.room_type_key)

  const isSystemOtherRoom = (room: InteriorRoom) =>
    isOtherRoom(room) &&
    normalizeSwedish(room.floor_label) === OTHER_ROOM_TYPE_KEY &&
    (room.order_index ?? 0) === 0

  const getRoomDisplayLabel = (room: InteriorRoom) => {
    const customLabel = normalizeSwedish(room.room_label ?? '').trim()
    if (customLabel) return customLabel
    return isOtherRoom(room) ? OTHER_ROOM_DISPLAY_LABEL : getRoomTypeLabel(room.room_type_key)
  }

  const getCompactRoomTypeLabel = (room: InteriorRoom) => {
    const typeLabel = getRoomTypeLabel(room.room_type_key)
    const roomLabel = normalizeSwedish(room.room_label ?? '').trim()
    if (!roomLabel) return typeLabel
    return roomLabel
  }

  const getRoomHeading = (room: InteriorRoom) => {
    return getCompactRoomTypeLabel(room)
  }

  const toggleRoomCollapsed = (roomId: string) => {
    setCollapsedRoomIds(prev => {
      const next = new Set(prev)
      if (next.has(roomId)) {
        next.delete(roomId)
      } else {
        next.add(roomId)
      }
      return next
    })
  }

  const roomChips = useMemo(() => {
    if (!activeFloor) return []
    const target = normalizeFloorKey(activeFloor)
    return rooms
      .filter(
        r =>
          !isMissingRoom(r) &&
          normalizeFloorKey(r.floor_label) === target
      )
      .sort((a, b) => (a.order_index ?? 0) - (b.order_index ?? 0))
  }, [rooms, activeFloor])

  const scrollToRoom = (roomId?: string) => {
    if (!roomId) return
    const el = document.getElementById(`room-card-${roomId}`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  const sortRooms = (a: InteriorRoom, b: InteriorRoom) => {
    const aFloor = normalizeFloorKey(a.floor_label)
    const bFloor = normalizeFloorKey(b.floor_label)
    if (aFloor < bFloor) return -1
    if (aFloor > bFloor) return 1
    // Nyaste (högst order_index) överst inom samma plan
    return (b.order_index ?? 0) - (a.order_index ?? 0)
  }

  // Kontrollpunkter grupperade per rum
  const controlItemsByRoomId = useMemo(() => {
    const map: Record<string, InspectionControlItem[]> = {}
    for (const ci of controlItems) {
      const roomId = ci.interior_room_id
      if (!roomId) continue
      map[roomId] = map[roomId] || []
      map[roomId].push(ci)
    }
    return map
  }, [controlItems])

  const getRoomSummary = (room: InteriorRoom) => {
    const roomId = room.id ?? ''
    const roomControlItems = roomId ? controlItemsByRoomId[roomId] || [] : []
    const roomNoteCount = (room.note ?? '').trim().length > 0 ? 1 : 0
    const itemNoteCount = roomControlItems.filter(ci =>
      [ci.note, ci.risk_text, ci.ftu_text].some(value =>
        String(value ?? '').trim().length > 0
      )
    ).length
    const imageCount = roomControlItems.reduce((sum, ci) => {
      if (!ci.id) return sum
      return sum + (imagesByControlItemId[ci.id] || []).length
    }, 0)

    return [
      `${roomControlItems.length} kontrollpunkter`,
      roomNoteCount + itemNoteCount > 0
        ? `${roomNoteCount + itemNoteCount} noteringar`
        : 'inga noteringar',
      imageCount > 0 ? `${imageCount} bilder` : null,
    ]
      .filter(Boolean)
      .join(' · ')
  }

  // -----------------------------
  // Upsert kontrollpunkt-instans
  // -----------------------------
  const upsertControlItem = async (
    item: InspectionControlItem
  ): Promise<InspectionControlItem> => {
    if (isInspectionLocked) {
      setError('Besiktningen är låst (klar) och kan inte redigeras.')
      return item
    }
    setSaving(true)
    setError(null)
    try {
      if (item.id) {
        const { data, error } = await supabase
          .from('inspection_control_items')
          .update({
            title: item.title,
            status: item.status,
            note: item.note,
            risk_text: item.risk_text ?? null,
            ftu_text: item.ftu_text ?? null,
            sort_order: item.sort_order,
            selected_outcome_id: item.selected_outcome_id ?? null,
          })
          .eq('id', item.id)
          .select('*')
          .single()

        if (error) throw error
        return data as InspectionControlItem
      } else {
        const { data, error } = await supabase
          .from('inspection_control_items')
          .insert({
            inspection_id: item.inspection_id,
            interior_room_id: item.interior_room_id,
            control_point_id: item.control_point_id,
            title: item.title,
            status: item.status,
            note: item.note,
            risk_text: item.risk_text ?? null,
            ftu_text: item.ftu_text ?? null,
            sort_order: item.sort_order,
            selected_outcome_id: item.selected_outcome_id ?? null,
          })
          .select('*')
          .single()

        if (error) {
          if (
            isPgUniqueViolation(error) &&
            item.interior_room_id &&
            item.control_point_id
          ) {
            const { data: existing, error: existingErr } = await supabase
              .from('inspection_control_items')
              .select('*')
              .eq('interior_room_id', item.interior_room_id)
              .eq('control_point_id', item.control_point_id)
              .order('created_at', { ascending: true })
              .limit(1)
              .maybeSingle()

            if (!existingErr && existing) {
              return {
                ...(existing as InspectionControlItem),
                selected_outcome_id:
                  (existing as InspectionControlItem).selected_outcome_id ?? null,
                risk_text: (existing as InspectionControlItem).risk_text ?? null,
                ftu_text: (existing as InspectionControlItem).ftu_text ?? null,
              }
            }
          }
          throw error
        }
        return data as InspectionControlItem
      }
    } catch (e: unknown) {
      console.error('upsertControlItem failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara kontrollpunkt.')
      return item
    } finally {
      setSaving(false)
    }
  }

  const updateControlItem = async (
    itemId: string,
    patch: Partial<InspectionControlItem>
  ) => {
    if (isInspectionLocked) return
    const current = controlItems.find(ci => ci.id === itemId)
    if (!current) return

    const optimistic: InspectionControlItem = { ...current, ...patch }
    setControlItems(prev => prev.map(ci => (ci.id === itemId ? optimistic : ci)))

    const saved = await upsertControlItem(optimistic)
    setControlItems(prev => prev.map(ci => (ci.id === itemId ? saved : ci)))
  }

  const deleteControlItem = async (itemId: string, skipConfirm?: boolean) => {
    if (isInspectionLocked) return
    const item = controlItems.find(ci => ci.id === itemId)
    if (!item) return

    // Framför allt avsett för fria noteringar, men fungerar för alla
    if (!skipConfirm && !confirm('Ta bort denna notering/kontrollpunkt?')) return

    try {
      const { data: imgRows, error: imgFetchErr } = await supabase
        .from('inspection_images')
        .select('*')
        .eq('inspection_id', inspection.id)
        .eq('control_item_id', itemId)

      if (imgFetchErr) throw imgFetchErr

      const imageRows = (imgRows ?? []) as InspectionImage[]
      const unlinkedImages: InspectionImage[] = []
      for (const image of imageRows) {
        const { data: updatedImage, error: updateError } = await supabase
          .from('inspection_images')
          .update(buildUnlinkedInteriorImagePatch(image))
          .eq('id', image.id)
          .eq('inspection_id', inspection.id)
          .select('*')
          .single()

        if (updateError) throw updateError
        unlinkedImages.push(updatedImage as InspectionImage)
      }

      const { error } = await supabase
        .from('inspection_control_items')
        .delete()
        .eq('id', itemId)

      if (error) {
        console.error('deleteControlItem failed:', error)
        alert(error.message)
        return
      }

      setControlItems(prev => prev.filter(ci => ci.id !== itemId))
      setImagesByControlItemId(prev => {
        const clone = { ...prev }
        delete clone[itemId]
        return clone
      })
      if (unlinkedImages.length > 0) {
        const unlinkedById = new Map(unlinkedImages.map(image => [image.id, image]))
        setAllInspectionImages(prev =>
          prev.map(image => unlinkedById.get(image.id) ?? image)
        )
      }
    } catch (e) {
      console.error('deleteControlItem (insida) failed:', e)
      alert('Kunde inte ta bort kontrollpunkt.')
    }
  }

  // -----------------------------
  // Skapa default-kontrollpunkter vid nytt rum
  // -----------------------------
  const createDefaultControlItemsForRoom = async (
    room: InteriorRoom
  ): Promise<number> => {
    if (isInspectionLocked) return 0
    if (!room.id) return 0

    try {
      const { data: cpData, error: cpErr } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, tags, trigger_room_types, applies_to')
        .eq('scope', 'interior')
        .eq('is_active', true)

      if (cpErr) {
        console.error(
          'fetch control points failed:',
          (cpErr instanceof Error ? cpErr.message : String(cpErr))
        )
        return 0
      }

      const allControlPoints = (cpData ?? []) as ControlPointLite[]
      const roomControlPoints = allControlPoints.filter(
        cp =>
          controlPointAppliesToInspectionSide(cp, inspectionSide) &&
          controlPointMatchesRoom(cp, room.room_type_key)
      )
      if (!roomControlPoints.length) return 0

      const { data: existingRows, error: existingErr } = await supabase
        .from('inspection_control_items')
        .select('id, control_point_id, sort_order')
        .eq('interior_room_id', room.id)

      if (existingErr) {
        console.error('fetch existing room control items failed:', existingErr)
        return 0
      }

      const existingRoomItems = (existingRows ??
        []) as Array<Pick<InspectionControlItem, 'id' | 'control_point_id' | 'sort_order'>>
      const existingControlPointIds = new Set(
        existingRoomItems
          .map(row => row.control_point_id)
          .filter((id): id is string => !!id)
      )

      const missingControlPoints = roomControlPoints.filter(
        cp => !existingControlPointIds.has(cp.id)
      )

      let sortBase =
        existingRoomItems.length > 0
          ? Math.max(...existingRoomItems.map(ci => ci.sort_order || 0))
          : 0

      if (missingControlPoints.length > 0) {
        const payload = missingControlPoints.map(cp => {
          sortBase += 10
          return {
            inspection_id: inspection.id,
            interior_room_id: room.id!,
            control_point_id: cp.id,
            title: cp.title || cp.label || cp.key,
            status: RED_STATUS,
            note: null,
            risk_text: null,
            ftu_text: null,
            sort_order: sortBase,
            selected_outcome_id: null,
          }
        })

        const { error: upsertErr } = await supabase
          .from('inspection_control_items')
          .upsert(payload, {
            onConflict: 'interior_room_id,control_point_id',
            ignoreDuplicates: true,
          })

        if (upsertErr) {
          if (upsertErr.code === '42P10') {
            const { error: insertErr } = await supabase
              .from('inspection_control_items')
              .insert(payload)
            if (insertErr && !isPgUniqueViolation(insertErr)) {
              console.error('insert default control items failed:', insertErr)
              return 0
            }
          } else if (!isPgUniqueViolation(upsertErr)) {
            console.error('upsert default control items failed:', upsertErr)
            return 0
          }
        }
      }

      const { data: roomItemsData, error: roomItemsErr } = await supabase
        .from('inspection_control_items')
        .select('*')
        .eq('interior_room_id', room.id)
        .order('sort_order', { ascending: true })

      if (roomItemsErr) {
        console.error('refresh room control items failed:', roomItemsErr)
      } else {
        const refreshedRoomItems = (roomItemsData ?? []) as InspectionControlItem[]
        setControlItems(prev => [
          ...prev.filter(ci => ci.interior_room_id !== room.id),
          ...refreshedRoomItems,
        ])
      }

      await ensureControlPointData(roomControlPoints.map(cp => cp.id))
      return missingControlPoints.length
    } catch (e) {
      console.error('createDefaultControlItemsForRoom error:', e)
      return 0
    }
  }

  // -----------------------------
  // Skapa kontrollpunkt från katalog via sök
  // -----------------------------
  const addControlItemFromCatalog = async (
    room: InteriorRoom,
    cp: ControlPointLite
  ) => {
    if (isInspectionLocked) return
    if (!room.id) return

    const existingLocal = controlItems.find(
      ci => ci.interior_room_id === room.id && ci.control_point_id === cp.id
    )
    if (existingLocal) {
      await ensureControlPointData([cp.id])
      return
    }

    const { data: existingDb, error: existingDbErr } = await supabase
      .from('inspection_control_items')
      .select('*')
      .eq('interior_room_id', room.id)
      .eq('control_point_id', cp.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    if (!existingDbErr && existingDb) {
      const existing = existingDb as InspectionControlItem
      setControlItems(prev => {
        const alreadyExists = prev.some(ci => ci.id === existing.id)
        if (alreadyExists) return prev
        return [existing, ...prev]
      })
      await ensureControlPointData([cp.id])
      return
    }

    const existingForRoom = controlItems.filter(
      ci => ci.interior_room_id === room.id
    )
    const sortOrder =
      existingForRoom.length > 0
        ? Math.min(...existingForRoom.map(ci => ci.sort_order || 0)) - 10
        : 10

    const newItem: InspectionControlItem = {
      inspection_id: inspection.id,
      interior_room_id: room.id,
      control_point_id: cp.id,
      title: cp.title || cp.label || cp.key,
      status: RED_STATUS,
      note: null,
      risk_text: null,
      ftu_text: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    }

    const saved = await upsertControlItem(newItem)
    if (!saved.id) return

    setControlItems(prev => {
      const withoutSamePair = prev.filter(
        ci =>
          !(
            ci.interior_room_id === saved.interior_room_id &&
            ci.control_point_id === saved.control_point_id
          )
      )
      return [saved, ...withoutSamePair]
    })
    await ensureControlPointData([cp.id])
  }

  const addOutcomeControlItem = async (
    baseItem: InspectionControlItem,
    outcome: ControlPointOutcome
  ) => {
    if (isInspectionLocked) return
    if (!baseItem.control_point_id) return
    const group = controlItems.filter(
      ci =>
        ci.interior_room_id === baseItem.interior_room_id &&
        ci.control_point_id === baseItem.control_point_id
    )
    const maxSort = group.reduce((m, ci) => Math.max(m, ci.sort_order ?? 0), 0)

    const newItem: InspectionControlItem = {
      inspection_id: baseItem.inspection_id,
      interior_room_id: baseItem.interior_room_id,
      control_point_id: baseItem.control_point_id,
      title: baseItem.title,
      status: 'remark',
      note: (outcome.note_template ?? '').trim() || null,
      risk_text: (outcome.risk_template ?? '').trim() || null,
      ftu_text: (outcome.ftu_template ?? '').trim() || null,
      sort_order: maxSort + 10,
      selected_outcome_id: outcome.id,
    }

    const saved = await upsertControlItem(newItem)
    if (!saved.id) return
    setControlItems(prev => {
      const idx = prev.findIndex(ci => ci.id === saved.id)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = saved
        return next
      }
      return [...prev, saved]
    })
  }

  const deleteControlItemGroup = async (baseItem: InspectionControlItem) => {
    if (isInspectionLocked) return
    if (!confirm('Ta bort denna kontrollpunkt?')) return
    const group = controlItems.filter(
      ci =>
        ci.interior_room_id === baseItem.interior_room_id &&
        ci.control_point_id === baseItem.control_point_id
    )
    for (const ci of group) {
      if (ci.id) {
        await deleteControlItem(ci.id, true)
      }
    }
  }

  // -----------------------------
  // Lägg till fri notering som egen kontrollpunkt
  // -----------------------------
  const addFreeNoteControlItem = async (room: InteriorRoom) => {
    if (isInspectionLocked) return
    if (!room.id) return

    const existingForRoom = controlItems.filter(
      ci => ci.interior_room_id === room.id
    )
    const sortOrder =
      existingForRoom.length > 0
        ? Math.min(...existingForRoom.map(ci => ci.sort_order || 0)) - 10
        : 10

    const newItem: InspectionControlItem = {
      inspection_id: inspection.id,
      interior_room_id: room.id,
      control_point_id: null, // viktigt: null, inte "free_note"
      title: 'Fri notering',
      status: RED_STATUS,
      note: '',
      risk_text: null,
      ftu_text: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    }

    const saved = await upsertControlItem(newItem)
    if (!saved.id) return
    setControlItems(prev => [saved, ...prev])
  }

  // -----------------------------
  // BILDER – helpers (per kontrollpunkt)
  // -----------------------------
  const handleUploadImageForControlItem = async (
    controlItem: InspectionControlItem,
    file: File
  ) => {
    if (!controlItem.id) return

    try {
      setSaving(true)
      setError(null)

      const ciId = controlItem.id
      const currentImages = imagesByControlItemId[ciId] || []
      const maxSort =
        currentImages.length > 0
          ? Math.max(...currentImages.map(img => img.sort_order || 0))
          : 0

      const ext = file.name.split('.').pop() || 'jpg'
      const safeExt = ext.toLowerCase()
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${safeExt}`

      const path = `${inspection.id}/interior/${ciId}/${fileName}`

      const { error: uploadErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadErr) {
        console.error('upload control-item image failed', uploadErr)
        throw new Error(uploadErr.message)
      }

      const { data, error: insErr } = await supabase
        .from('inspection_images')
        .insert({
          inspection_id: inspection.id,
          interior_room_id: controlItem.interior_room_id,
          control_item_id: ciId,
          exterior_observation_id: null,
          file_path: path,
          label: null,
          sort_order: maxSort + 10,
          capture_source: 'legacy_upload',
          source_area: 'interior',
          origin_interior_room_id: controlItem.interior_room_id,
        })
        .select('*')
        .single()

      if (insErr) {
        console.error('insert inspection_image (insida) failed', insErr)
        throw new Error(insErr.message)
      }

      const img = data as InspectionImage

      setImagesByControlItemId(prev => {
        const prevArr = prev[ciId] || []
        return {
          ...prev,
          [ciId]: [...prevArr, img].sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
          ),
        }
      })
      setAllInspectionImages(prev => [img, ...prev.filter(image => image.id !== img.id)])
    } catch (e: unknown) {
      console.error('handleUploadImageForControlItem (insida) failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ladda upp bild.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteImage = async (imageId: string) => {
    try {
      setSaving(true)
      setError(null)

      let targetImg: InspectionImage | null = null
      let targetControlId: string | null = null

      for (const [ciId, arr] of Object.entries(imagesByControlItemId)) {
        const found = arr.find(img => img.id === imageId)
        if (found) {
          targetImg = found
          targetControlId = ciId
          break
        }
      }

      if (!targetImg || !targetControlId) return

      const { error: delErr } = await supabase
        .from('inspection_images')
        .delete()
        .eq('id', imageId)

      if (delErr) {
        console.error('delete inspection_image (insida) failed', delErr)
        throw new Error(delErr.message)
      }

      setImagesByControlItemId(prev => {
        const prevArr = prev[targetControlId!] || []
        return {
          ...prev,
          [targetControlId!]: prevArr.filter(img => img.id !== imageId),
        }
      })
      setAllInspectionImages(prev => prev.filter(img => img.id !== imageId))
    } catch (e: unknown) {
      console.error('handleDeleteImage (insida) failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort bild.')
    } finally {
      setSaving(false)
    }
  }

  const updateImageInAllImages = (updatedImage: InspectionImage) => {
    setAllInspectionImages(prev =>
      prev.some(image => image.id === updatedImage.id)
        ? prev.map(image => (image.id === updatedImage.id ? updatedImage : image))
        : [updatedImage, ...prev]
    )
  }

  const buildUnlinkedInteriorImagePatch = (image: InspectionImage) => {
    const linkedControlItem = image.control_item_id
      ? controlItems.find(item => item.id === image.control_item_id) ?? null
      : null
    const isOriginallyExterior =
      Boolean(image.origin_exterior_item_id || image.origin_exterior_observation_id) ||
      (image.source_area === 'exterior' &&
        !image.origin_interior_room_id &&
        !image.interior_room_id)

    if (isOriginallyExterior) {
      return {
        control_item_id: null,
        exterior_observation_id: null,
        interior_room_id: null,
        source_area: 'exterior',
        origin_exterior_item_id: image.origin_exterior_item_id ?? null,
        origin_exterior_observation_id: image.origin_exterior_observation_id ?? null,
        origin_exterior_item_key: image.origin_exterior_item_key ?? null,
      }
    }

    const sourceRoomId =
      image.origin_interior_room_id ??
      image.interior_room_id ??
      linkedControlItem?.interior_room_id ??
      null
    const sourceRoom = sourceRoomId
      ? rooms.find(room => room.id === sourceRoomId) ?? null
      : null

    return {
      control_item_id: null,
      exterior_observation_id: null,
      interior_room_id: null,
      source_area: 'interior',
      origin_interior_room_id: sourceRoomId,
      origin_floor_label: image.origin_floor_label ?? sourceRoom?.floor_label ?? null,
      origin_room_label: image.origin_room_label ?? sourceRoom?.room_label ?? null,
      origin_room_type_key: image.origin_room_type_key ?? sourceRoom?.room_type_key ?? null,
    }
  }

  const moveImageToControlItem = async (
    imageId: string,
    controlItem: InspectionControlItem
  ) => {
    if (isInspectionLocked) return
    if (!controlItem.id) return

    const sourceImage = allInspectionImages.find(image => image.id === imageId)
    if (!sourceImage) {
      setError('Bilden hittades inte. Uppdatera sidan och försök igen.')
      return
    }

    if (sourceImage.control_item_id === controlItem.id) return

    try {
      setSaving(true)
      setError(null)

      const targetImages = (imagesByControlItemId[controlItem.id] || []).filter(
        image => image.id !== imageId
      )
      const maxSort =
        targetImages.length > 0
          ? Math.max(...targetImages.map(image => image.sort_order || 0))
          : 0

      const { data, error: updateError } = await supabase
        .from('inspection_images')
        .update({
          control_item_id: controlItem.id,
          interior_room_id: controlItem.interior_room_id,
          exterior_observation_id: null,
          sort_order: maxSort + 10,
        })
        .eq('id', imageId)
        .eq('inspection_id', inspection.id)
        .select('*')
        .single()

      if (updateError) throw updateError

      const updatedImage = data as InspectionImage
      setImagesByControlItemId(prev => addImageToImageMap(prev, controlItem.id!, updatedImage))
      updateImageInAllImages(updatedImage)
    } catch (e: unknown) {
      console.error('moveImageToControlItem failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte koppla bilden till noteringen.')
    } finally {
      setSaving(false)
    }
  }

  const unlinkImageFromNote = async (imageId: string) => {
    if (isInspectionLocked) return

    const sourceImage = allInspectionImages.find(image => image.id === imageId)
    if (!sourceImage) {
      setError('Bilden hittades inte. Uppdatera sidan och försök igen.')
      return
    }

    if (!isImageLinkedToNote(sourceImage)) return

    try {
      setSaving(true)
      setError(null)

      const { data, error: updateError } = await supabase
        .from('inspection_images')
        .update(buildUnlinkedInteriorImagePatch(sourceImage))
        .eq('id', imageId)
        .eq('inspection_id', inspection.id)
        .select('*')
        .single()

      if (updateError) throw updateError

      const updatedImage = data as InspectionImage
      setImagesByControlItemId(prev => removeImageFromImageMap(prev, imageId))
      updateImageInAllImages(updatedImage)
    } catch (e: unknown) {
      console.error('unlinkImageFromNote failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte koppla loss bilden.')
    } finally {
      setSaving(false)
    }
  }

  const togglePanelImageSelection = (imageId: string) => {
    setSelectedPanelImageIds(prev => {
      const next = new Set(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.add(imageId)
      return next
    })
  }

  const deleteSelectedPanelImages = async () => {
    if (isInspectionLocked) return
    const selectedIds = Array.from(selectedPanelImageIds)
    if (selectedIds.length === 0) return
    if (!confirm(`Radera ${selectedIds.length} bild${selectedIds.length === 1 ? '' : 'er'}?`)) return

    try {
      setSaving(true)
      setError(null)

      const selectedIdSet = new Set(selectedIds)
      const selectedImages = allInspectionImages.filter(image => selectedIdSet.has(image.id))

      const { error: deleteError } = await supabase
        .from('inspection_images')
        .delete()
        .eq('inspection_id', inspection.id)
        .in('id', selectedIds)

      if (deleteError) throw deleteError

      const storagePaths = selectedImages.map(image => image.file_path).filter(Boolean)
      if (storagePaths.length > 0) {
        const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(storagePaths)
        if (storageError) console.error('delete selected interior images from storage failed:', storageError)
      }

      setImagesByControlItemId(prev => removeImagesFromImageMap(prev, selectedIdSet))
      setAllInspectionImages(prev => prev.filter(image => !selectedIdSet.has(image.id)))
      setSelectedPanelImageIds(new Set())
    } catch (e: unknown) {
      console.error('deleteSelectedPanelImages failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte radera markerade bilder.')
    } finally {
      setSaving(false)
    }
  }

  const handleImageDragStart = (
    event: DragEvent<HTMLButtonElement>,
    image: InspectionImage
  ) => {
    if (isInspectionLocked) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData(IMAGE_DRAG_DATA_TYPE, image.id)
  }

  const handleMobileSplitPointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const container = mobileSplitContainerRef.current
    if (!container) return

    const rect = container.getBoundingClientRect()
    if (rect.height <= 0) return

    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    mobileSplitDragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: mobileImagePanelHeight,
      containerHeight: rect.height,
    }
  }

  const handleMobileSplitPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = mobileSplitDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return

    const deltaY = event.clientY - drag.startY
    const nextHeight = drag.startHeight - (deltaY / drag.containerHeight) * 100
    setMobileImagePanelHeight(Math.min(72, Math.max(24, nextHeight)))
  }

  const handleMobileSplitPointerEnd = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = mobileSplitDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    mobileSplitDragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  // -----------------------------
  // Upsert rum
  // -----------------------------
  const upsertRoom = async (room: InteriorRoom): Promise<InteriorRoom> => {
    if (isInspectionLocked) {
      setError('Besiktningen är låst (klar) och kan inte redigeras.')
      return room
    }
    setSaving(true)
    setError(null)
    try {
      if (room.id) {
        const { data, error } = await supabase
          .from('inspection_interior_rooms')
          .update({
            floor_label: room.floor_label,
            order_index: room.order_index,
            room_type_key: room.room_type_key,
            room_label: room.room_label,
            values: room.values,
            note: room.note,
          })
          .eq('id', room.id)
          .select('*')
          .single()

        if (error) throw error
        const r = data as InteriorRoom & { values?: unknown }
        return { ...r, values: (r.values as ValueMap) || {} }
      } else {
        const { data, error } = await supabase
          .from('inspection_interior_rooms')
          .insert({
            inspection_id: room.inspection_id,
            floor_label: room.floor_label,
            order_index: room.order_index,
            room_type_key: room.room_type_key,
            room_label: room.room_label,
            values: room.values,
            note: room.note,
          })
          .select('*')
          .single()

        if (error) {
          const isSystemOtherCandidate =
            isOtherRoomKey(room.room_type_key) &&
            normalizeSwedish(room.floor_label) === OTHER_ROOM_TYPE_KEY

          if (isSystemOtherCandidate && isPgUniqueViolation(error)) {
            const { data: existingRows, error: existingErr } = await supabase
              .from('inspection_interior_rooms')
              .select('*')
              .eq('inspection_id', room.inspection_id)
              .order('created_at', { ascending: true })

            if (!existingErr) {
              const existing = ((existingRows ?? []) as InteriorRoom[]).find(
                r =>
                  isOtherRoomKey(r.room_type_key) &&
                  normalizeSwedish(r.floor_label) === OTHER_ROOM_TYPE_KEY
              )
              if (existing) {
                return { ...existing, values: (existing.values as ValueMap) || {} }
              }
            }
          }

          throw error
        }
        const r = data as InteriorRoom & { values?: unknown }
        return { ...r, values: (r.values as ValueMap) || {} }
      }
    } catch (e: unknown) {
      console.error('upsertRoom insida failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara rum.')
      return room
    } finally {
      setSaving(false)
    }
  }

  const addRoom = async () => {
    if (isInspectionLocked) return
    if (!newRoomTypeKey || !newFloorLabel.trim()) {
      alert('Välj rumstyp och ange/ välj plan.')
      return
    }

    const floor = normalizeFloorKey(newFloorLabel)
    const typeKey = newRoomTypeKey
    const defaultLabel =
      newRoomLabel.trim() ||
      (() => {
        const baseLabel = getRoomTypeLabel(typeKey)
        const existingOnFloor = rooms.filter(
          r => normalizeFloorKey(r.floor_label) === floor && r.room_type_key === typeKey
        ).length
        const num = existingOnFloor + 1
        return `${baseLabel} ${num}`
      })()

    const maxOrder = rooms
      .filter(r => normalizeFloorKey(r.floor_label) === floor)
      .reduce((m, r) => Math.max(m, r.order_index ?? 0), 0)

    const newRoom: InteriorRoom = {
      inspection_id: inspection.id,
      floor_label: floor,
      order_index: maxOrder + 10,
      room_type_key: typeKey,
      room_label: defaultLabel,
      values: {},
      note: null,
    }

    const saved = await upsertRoom(newRoom)
    if (!saved.id) return
    setRooms(prev => [...prev, saved].sort(sortRooms))
    setShowNewRoomForm(false)
    setNewRoomLabel('')
    if (!activeFloor) setActiveFloor(saved.floor_label)

    // Skapa default-kontrollpunkter för detta rum
    await createDefaultControlItemsForRoom(saved)
  }

  const removeRoom = async (id?: string) => {
    if (isInspectionLocked) return
    if (!id) return
    if (!confirm('Ta bort rummet från besiktningen?')) return
    const { error } = await supabase
      .from('inspection_interior_rooms')
      .delete()
      .eq('id', id)
    if (error) {
      console.error(error)
      alert(error.message)
      return
    }
    setRooms(prev => prev.filter(r => r.id !== id))
    setControlItems(prev => prev.filter(ci => ci.interior_room_id !== id))
  }

  const updateRoomField = async (
    id: string | undefined,
    patch: Partial<InteriorRoom>
  ) => {
    if (isInspectionLocked) return
    if (!id) return
    const current = rooms.find(r => r.id === id)
    if (!current) return
    const updated: InteriorRoom = { ...current, ...patch }
    setRooms(prev => prev.map(r => (r.id === id ? updated : r)))
    const saved = await upsertRoom(updated)
    setRooms(prev => prev.map(r => (r.id === id ? saved : r)))
  }

  const startEditRoom = (room: InteriorRoom) => {
    if (isInspectionLocked) return
    if (!room.id) return
    setCollapsedRoomIds(prev => {
      if (!prev.has(room.id!)) return prev
      const next = new Set(prev)
      next.delete(room.id!)
      return next
    })
    setEditingRoomId(room.id)
    setEditRoomLabel(room.room_label)
    setEditRoomTypeKey(room.room_type_key)
    setEditRoomFloorLabel(room.floor_label)
  }

  const cancelEditRoom = () => {
    setEditingRoomId(null)
    setEditRoomLabel('')
    setEditRoomTypeKey('')
    setEditRoomFloorLabel('')
  }

  const saveEditRoom = async () => {
    if (isInspectionLocked) return
    if (!editingRoomId) return
    const current = rooms.find(r => r.id === editingRoomId)
    if (!current) return
    const nextRoomTypeKey = editRoomTypeKey || current.room_type_key
    const nextRoomLabel =
      normalizeSwedish(editRoomLabel).trim() || getRoomTypeLabel(nextRoomTypeKey)
    const nextFloor = normalizeFloorKey(editRoomFloorLabel || current.floor_label)
    const isFloorChanged = nextFloor !== normalizeFloorKey(current.floor_label)
    const nextOrder = isFloorChanged
      ? rooms
          .filter(r => normalizeFloorKey(r.floor_label) === nextFloor && r.id !== current.id)
          .reduce((m, r) => Math.max(m, r.order_index ?? 0), 0) + 10
      : current.order_index
    await updateRoomField(editingRoomId, {
      room_label: nextRoomLabel,
      room_type_key: nextRoomTypeKey,
      floor_label: nextFloor,
      order_index: nextOrder,
    })
    if (nextFloor && nextFloor !== activeFloor) {
      setActiveFloor(nextFloor)
    }
    cancelEditRoom()
  }

  const updateRoomValues = async (
    id: string | undefined,
    patchValues: ValueMap
  ) => {
    if (isInspectionLocked) return
    if (!id) return
    const current = rooms.find(r => r.id === id)
    if (!current) return
    const updated: InteriorRoom = {
      ...current,
      values: { ...(current.values || {}), ...patchValues },
    }
    setRooms(prev => prev.map(r => (r.id === id ? updated : r)))
    const saved = await upsertRoom(updated)
    setRooms(prev => prev.map(r => (r.id === id ? saved : r)))
  }

  const SelectField = ({
    label,
    value,
    onChange,
    options,
    disabled = false,
  }: {
    label: string
    value: unknown
    onChange: (v: string) => void
    options: InteriorOption[]
    disabled?: boolean
  }) => {
    const normalizedValue =
      typeof value === 'boolean'
        ? String(value)
        : typeof value === 'string' || typeof value === 'number'
          ? value
          : ''

    return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <select
        value={normalizedValue}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="h-9 w-full rounded-lg border border-gray-300 bg-gray-50 px-2 text-sm text-gray-900
                   focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        <option value="">Välj…</option>
        {options.map(o => (
          <option key={o.id} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
    )
  }

  const sortImagesNewestFirst = (imageList: InspectionImage[]) =>
    [...imageList].sort((a, b) => {
      const left = new Date(a.captured_at ?? a.created_at ?? 0).getTime()
      const right = new Date(b.captured_at ?? b.created_at ?? 0).getTime()
      if (left !== right) return right - left
      return (b.sort_order ?? 0) - (a.sort_order ?? 0)
    })

  const uniqueImages = (imageList: InspectionImage[]) => {
    const seen = new Set<string>()
    return imageList.filter(image => {
      if (seen.has(image.id)) return false
      seen.add(image.id)
      return true
    })
  }

  const isInteriorImage = (image: InspectionImage) =>
    image.source_area === 'interior' ||
    Boolean(image.origin_interior_room_id) ||
    Boolean(image.interior_room_id) ||
    Boolean(
      image.control_item_id &&
        controlItems.some(
          item => item.id === image.control_item_id && Boolean(item.interior_room_id)
        )
    )

  const getRoomIdsForFloor = (floorLabel: string | null | undefined) => {
    const targetFloor = normalizeFloorKey(floorLabel)
    return new Set(
      rooms
        .filter(room => normalizeFloorKey(room.floor_label) === targetFloor)
        .map(room => room.id)
        .filter((id): id is string => !!id)
    )
  }

  const getImagesForRoom = (room: InteriorRoom) => {
    if (!room.id) return []
    const roomControlItemIds = new Set(
      (controlItemsByRoomId[room.id] || [])
        .map(item => item.id)
        .filter((id): id is string => !!id)
    )

    return sortImagesNewestFirst(
      uniqueImages(
        allInspectionImages.filter(
          image =>
            image.origin_interior_room_id === room.id ||
            image.interior_room_id === room.id ||
            (image.control_item_id ? roomControlItemIds.has(image.control_item_id) : false)
        )
      )
    )
  }

  const getImagesForFloor = (room: InteriorRoom) => {
    const roomIds = getRoomIdsForFloor(room.floor_label)
    const floorControlItemIds = new Set(
      Array.from(roomIds).flatMap(roomId =>
        (controlItemsByRoomId[roomId] || [])
          .map(item => item.id)
          .filter((id): id is string => !!id)
      )
    )

    return sortImagesNewestFirst(
      uniqueImages(
        allInspectionImages.filter(
          image =>
            (image.origin_interior_room_id
              ? roomIds.has(image.origin_interior_room_id)
              : false) ||
            (image.interior_room_id ? roomIds.has(image.interior_room_id) : false) ||
            (image.control_item_id ? floorControlItemIds.has(image.control_item_id) : false)
        )
      )
    )
  }

  const getFilteredPanelImages = (room: InteriorRoom) => {
    const rawImages =
      imageFilter === 'current'
        ? getImagesForRoom(room)
        : imageFilter === 'floor'
          ? getImagesForFloor(room)
          : imageFilter === 'interior'
            ? sortImagesNewestFirst(uniqueImages(allInspectionImages.filter(isInteriorImage)))
            : sortImagesNewestFirst(uniqueImages(allInspectionImages))

    return showLinkedImages ? rawImages : rawImages.filter(image => !isImageLinkedToNote(image))
  }

  const quickNoteHasText = (note: RoundQuickNote) => note.note.trim().length > 0

  const getQuickNoteContext = (note: RoundQuickNote) => {
    if (note.source_area === 'exterior') {
      const exteriorItem = note.exterior_item_id
        ? exteriorItems.find(item => item.id === note.exterior_item_id)
        : null
      return `Utsida > ${exteriorItem?.label ?? 'Komponent'}`
    }

    const room = note.interior_room_id
      ? rooms.find(interiorRoom => interiorRoom.id === note.interior_room_id)
      : null
    const floorLabel = getFloorLabel(room?.floor_label ?? '')
    const roomLabel = room?.room_label?.trim() || room?.room_type_key?.trim() || 'Rum'
    return `Insida > ${floorLabel} > ${roomLabel}`
  }

  const getFilteredQuickNotes = (
    room: InteriorRoom,
    filter: QuickNoteFilter = quickNoteFilter
  ) => {
    const visibleNotes = quickNotes.filter(quickNoteHasText)
    const floorRoomIds = getRoomIdsForFloor(room.floor_label)

    if (filter === 'current') {
      return visibleNotes.filter(
        note => note.source_area === 'interior' && note.interior_room_id === room.id
      )
    }

    if (filter === 'floor') {
      return visibleNotes.filter(
        note =>
          note.source_area === 'interior' &&
          Boolean(note.interior_room_id && floorRoomIds.has(note.interior_room_id))
      )
    }

    if (filter === 'interior') {
      return visibleNotes.filter(note => note.source_area === 'interior')
    }

    return visibleNotes
  }

  const deleteQuickNote = async (noteId: string) => {
    if (isInspectionLocked) return
    if (!confirm('Radera snabbanteckningen?')) return

    try {
      setSaving(true)
      setError(null)

      const { error: deleteError } = await supabase
        .from('inspection_round_quick_notes')
        .delete()
        .eq('inspection_id', inspection.id)
        .eq('id', noteId)

      if (deleteError) throw deleteError

      setQuickNotes(prev => prev.filter(note => note.id !== noteId))
    } catch (e: unknown) {
      console.error('deleteQuickNote failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte radera snabbanteckningen.')
    } finally {
      setSaving(false)
    }
  }

  const openImageBankForControlItem = (controlItem: InspectionControlItem) => {
    if (isInspectionLocked || !controlItem.id) return
    setSelectedImageBankIds(new Set())
    setImageBankTarget({
      controlItem,
      title: controlItem.title || 'Kontrollpunkt',
    })
  }

  const toggleImageBankSelection = (imageId: string) => {
    setSelectedImageBankIds(prev => {
      const next = new Set(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.add(imageId)
      return next
    })
  }

  const linkSelectedImageBankImages = async () => {
    if (!imageBankTarget || selectedImageBankIds.size === 0) return

    const selectedIds = new Set(selectedImageBankIds)
    const selectedImages = sortImagesNewestFirst(
      allInspectionImages.filter(
        image => selectedIds.has(image.id) && !isImageLinkedToNote(image)
      )
    )

    for (const image of selectedImages) {
      await moveImageToControlItem(image.id, imageBankTarget.controlItem)
    }

    closeImageBank()
  }

  const renderImageBankPicker = () => {
    if (!imageBankTarget) return null
    const imageBankImages = sortImagesNewestFirst(
      uniqueImages(allInspectionImages.filter(image => !isImageLinkedToNote(image)))
    )
    const selectedCount = selectedImageBankIds.size

    return (
      <div className="fixed inset-0 z-[90] bg-black/45 p-3" role="dialog" aria-modal="true">
        <div className="mx-auto flex h-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
          <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Bildbank
              </div>
              <h3 className="mt-0.5 truncate text-base font-semibold text-gray-900">
                Lägg till bilder i {imageBankTarget.title}
              </h3>
            </div>
            <button
              type="button"
              onClick={closeImageBank}
              className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
            >
              Stäng
            </button>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto bg-gray-50 p-3">
            {imageBankImages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-10 text-center text-sm text-gray-600">
                Inga okopplade bilder i bildbanken.
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {imageBankImages.map(image => {
                  const isSelected = selectedImageBankIds.has(image.id)
                  return (
                    <button
                      key={image.id}
                      type="button"
                      onClick={() => toggleImageBankSelection(image.id)}
                      className={`relative overflow-hidden rounded-xl border bg-white text-left shadow-sm transition ${
                        isSelected
                          ? 'border-sky-600 ring-2 ring-sky-200'
                          : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                      }`}
                      aria-pressed={isSelected}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getImagePublicUrl(image.file_path)}
                        alt=""
                        className="aspect-square w-full object-cover"
                      />
                      <span
                        className={`absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold shadow-sm ${
                          isSelected
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-white/80 bg-white/90 text-transparent'
                        }`}
                      >
                        ✓
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-3 border-t border-gray-200 px-4 py-3">
            <div className="text-xs text-gray-600">
              {selectedCount > 0 ? `${selectedCount} markerad${selectedCount === 1 ? '' : 'e'}` : 'Välj en eller flera bilder'}
            </div>
            <button
              type="button"
              onClick={() => void linkSelectedImageBankImages()}
              disabled={isInspectionLocked || selectedCount === 0}
              className="rounded-full bg-sky-600 px-4 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-sky-50 disabled:text-sky-700 disabled:ring-1 disabled:ring-sky-200"
            >
              Lägg till
            </button>
          </footer>
        </div>
      </div>
    )
  }

  const renderImageProcessingPanel = (room: InteriorRoom) => {
    const currentImages = getImagesForRoom(room)
    const floorImages = getImagesForFloor(room)
    const interiorImages = sortImagesNewestFirst(uniqueImages(allInspectionImages.filter(isInteriorImage)))
    const filteredImages = getFilteredPanelImages(room)
    const filteredQuickNotes = getFilteredQuickNotes(room)
    const countVisibleImages = (imageList: InspectionImage[]) =>
      showLinkedImages ? imageList.length : imageList.filter(image => !isImageLinkedToNote(image)).length
    const filters: Array<{ key: InteriorPanelFilter; label: string; count: number }> = [
      { key: 'current', label: 'Aktuell', count: countVisibleImages(currentImages) },
      { key: 'floor', label: 'Plan', count: countVisibleImages(floorImages) },
      { key: 'interior', label: 'Insida', count: countVisibleImages(interiorImages) },
      { key: 'all', label: 'Alla', count: countVisibleImages(allInspectionImages) },
    ]
    const quickNoteFilters: Array<{ key: QuickNoteFilter; label: string; count: number }> = [
      { key: 'current', label: 'Aktuell', count: getFilteredQuickNotes(room, 'current').length },
      { key: 'floor', label: 'Plan', count: getFilteredQuickNotes(room, 'floor').length },
      { key: 'interior', label: 'Insida', count: getFilteredQuickNotes(room, 'interior').length },
      { key: 'all', label: 'Alla', count: getFilteredQuickNotes(room, 'all').length },
    ]
    const panelTabs: Array<{ key: PanelTab; label: string }> = [
      { key: 'images', label: 'Bilder' },
      { key: 'quick_notes', label: 'Snabbanteckningar' },
    ]
    const imageViewCounts: InteriorImageViewCount[] = [15, 9, 1]
    const imageGridClass =
      imageViewCount === 1
        ? 'grid grid-cols-1 gap-3'
        : imageViewCount === 15
          ? 'grid grid-cols-5 gap-1.5 sm:gap-2'
          : 'grid grid-cols-3 gap-2'
    const imageClass =
      imageViewCount === 1
        ? 'max-h-[65vh] w-full object-contain bg-gray-100'
        : 'aspect-square w-full object-cover transition group-hover:scale-[1.02]'

    return (
      <aside className="flex min-h-0 flex-col border-t border-gray-200 bg-gray-50/70 lg:h-auto lg:border-l lg:border-t-0">
        <div className="border-b border-gray-200 bg-white">
          <div className="flex gap-1 border-b border-gray-200 px-4 pt-3" role="tablist" aria-label="Panelinnehåll">
            {panelTabs.map(tab => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                onClick={() => setPanelTab(tab.key)}
                className={`rounded-t-lg border border-b-0 px-3 py-2 text-xs font-semibold transition ${
                  panelTab === tab.key
                    ? 'border-gray-200 bg-gray-50 text-gray-900'
                    : 'border-transparent bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`}
                aria-selected={panelTab === tab.key}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {panelTab === 'images' ? (
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bilder</div>
                <div className="flex flex-wrap gap-2">
                  {filters.map(filter => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => {
                        setImageFilter(filter.key)
                        setSelectedPanelImageIds(new Set())
                      }}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        imageFilter === filter.key
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {filter.label} <span className="ml-1 opacity-70">{filter.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setShowLinkedImages(prev => !prev)
                      setSelectedPanelImageIds(new Set())
                    }}
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      showLinkedImages
                        ? 'border-rose-700 bg-rose-700 text-white'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    Visa kopplade
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSelectedPanelImages()}
                    disabled={isInspectionLocked || selectedPanelImageIds.size === 0}
                    className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Radera{selectedPanelImageIds.size > 0 ? ` ${selectedPanelImageIds.size}` : ''}
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {imageViewCounts.map(count => (
                    <button
                      key={count}
                      type="button"
                      onClick={() => setImageViewCount(count)}
                      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border transition ${
                        imageViewCount === count
                          ? 'border-sky-700 bg-sky-700 text-white'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                      aria-label={`Visa ${count} bild${count === 1 ? '' : 'er'}`}
                      title={`Visa ${count} bild${count === 1 ? '' : 'er'}`}
                    >
                      <span
                        aria-hidden="true"
                        className={
                          count === 15
                            ? 'grid h-5 w-5 grid-cols-3 gap-0.5'
                            : count === 9
                              ? 'grid h-5 w-5 grid-cols-2 gap-0.5'
                              : 'grid h-5 w-5 grid-cols-1 gap-0.5'
                        }
                      >
                        {Array.from({ length: count === 15 ? 9 : count === 9 ? 4 : 1 }).map((_, index) => (
                          <span
                            key={index}
                            className={`rounded-[1px] ${imageViewCount === count ? 'bg-white' : 'bg-gray-600'}`}
                          />
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Snabbanteckningar
                </div>
                <div className="flex flex-wrap gap-2">
                  {quickNoteFilters.map(filter => (
                    <button
                      key={filter.key}
                      type="button"
                      onClick={() => setQuickNoteFilter(filter.key)}
                      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                        quickNoteFilter === filter.key
                          ? 'border-indigo-600 bg-indigo-600 text-white'
                          : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      {filter.label} <span className="ml-1 opacity-70">{filter.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {panelTab === 'images' ? (
            filteredImages.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-8 text-center text-sm text-gray-600">
                Inga bilder i valt filter.
              </div>
            ) : (
              <div className={imageGridClass}>
                {filteredImages.map(image => {
                  const isLinked = isImageLinkedToNote(image)
                  const isSelected = selectedPanelImageIds.has(image.id)
                  return (
                    <div
                      key={image.id}
                      className={`relative overflow-hidden rounded-xl border bg-white shadow-sm transition ${
                        isLinked
                          ? 'border-rose-400 opacity-75 ring-2 ring-rose-100'
                          : isSelected
                            ? 'border-sky-600 ring-2 ring-sky-100'
                            : 'border-gray-200 hover:border-gray-300 hover:shadow-md'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setPreviewImage(image)}
                        draggable={!isInspectionLocked}
                        onDragStart={event => handleImageDragStart(event, image)}
                        className="group block w-full cursor-grab overflow-hidden text-left focus:outline-none focus:ring-2 focus:ring-sky-300 active:cursor-grabbing"
                        aria-label="Visa bild"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={getImagePublicUrl(image.file_path)} alt="" className={imageClass} />
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePanelImageSelection(image.id)}
                        disabled={isInspectionLocked}
                        className={`absolute left-1 top-1 flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold shadow-sm ${
                          isSelected
                            ? 'border-sky-600 bg-sky-600 text-white'
                            : 'border-white/80 bg-white/90 text-transparent'
                        }`}
                        aria-label={isSelected ? 'Avmarkera bild' : 'Markera bild'}
                        title={isSelected ? 'Avmarkera bild' : 'Markera bild'}
                      >
                        ✓
                      </button>
                      {isLinked ? (
                        <span className="absolute bottom-1.5 left-1.5 rounded-full bg-rose-700 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm">
                          Kopplad
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )
          ) : filteredQuickNotes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white px-3 py-8 text-center text-sm text-gray-600">
              Inga snabbanteckningar i valt filter.
            </div>
          ) : (
            <div className="divide-y divide-gray-200 rounded-xl border border-gray-200 bg-white">
              {filteredQuickNotes.map(note => (
                <article key={note.id} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {getQuickNoteContext(note)}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-gray-900">
                        {note.note}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void deleteQuickNote(note.id)}
                      disabled={isInspectionLocked}
                      className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Radera
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </aside>
    )
  }

  const renderImagePreview = () => {
    if (!previewImage) return null
    return (
      <div className="fixed inset-0 z-[80] bg-black/85 p-4" role="dialog" aria-modal="true">
        <div className="flex h-full flex-col">
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
            >
              Stäng
            </button>
          </div>
          <div className="min-h-0 flex-1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={getImagePublicUrl(previewImage.file_path)}
              alt=""
              className="h-full w-full object-contain"
            />
          </div>
        </div>
      </div>
    )
  }

  const renderRoomCard = (
    room: InteriorRoom,
    options: { forceExpanded?: boolean; embedded?: boolean; hideHeader?: boolean } = {}
  ) => {
    const vals = room.values || {}
    const roomId = room.id ?? ''
    const roomControlItems = controlItemsByRoomId[roomId] || []
    const isRoomCollapsed = options.forceExpanded
      ? false
      : roomId
        ? collapsedRoomIds.has(roomId)
        : false
    const articleClassName = options.embedded
      ? 'w-full min-w-0 max-w-full space-y-4'
      : 'rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-4'

    return (
      <article
        key={room.id}
        id={room.id ? `room-card-${room.id}` : undefined}
        className={articleClassName}
      >
        {!options.hideHeader && (
          <header className="flex min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-gray-900">
                {getRoomHeading(room)}
              </h3>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!options.forceExpanded && (
                <button
                  type="button"
                  onClick={() => roomId && toggleRoomCollapsed(roomId)}
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs md:text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                  aria-expanded={!isRoomCollapsed}
                  disabled={!roomId}
                >
                  {isRoomCollapsed ? 'Visa' : 'Dölj'}
                </button>
              )}
              <button
                type="button"
                onClick={() => startEditRoom(room)}
                disabled={isInspectionLocked}
                className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs md:text-[11px] font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Redigera rum
              </button>

              {!isSystemOtherRoom(room) && !isInspectionLocked && (
                <button
                  type="button"
                  onClick={() => removeRoom(room.id)}
                  className="text-xs text-rose-600 hover:underline"
                >
                  Ta bort rum
                </button>
              )}
            </div>
          </header>
        )}

        {!isRoomCollapsed && editingRoomId === room.id && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <label className="text-xs text-gray-600">Rumnamn</label>
                <input
                  className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                  value={editRoomLabel}
                  onChange={e => setEditRoomLabel(e.target.value)}
                  readOnly={isInspectionLocked}
                />
              </div>
              <div>
                <label className="text-xs text-gray-600">Plan</label>
                {isSystemOtherRoom(room) ? (
                  <>
                    <input
                      className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-gray-100 text-gray-700"
                      value={getFloorLabel(editRoomFloorLabel || room.floor_label)}
                      readOnly
                    />
                    <div className="mt-1 text-xs md:text-[11px] text-gray-600">
                      Systemrummet kan inte flyttas mellan plan.
                    </div>
                  </>
                ) : (
                  <select
                    className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                    value={editRoomFloorLabel}
                    onChange={e => setEditRoomFloorLabel(e.target.value)}
                    disabled={isInspectionLocked}
                  >
                    {floorLabels
                      .filter(fl => fl && fl !== OTHER_ROOM_TYPE_KEY)
                      .map(fl => (
                        <option key={fl} value={fl}>
                          {getFloorLabel(fl)}
                        </option>
                      ))}
                  </select>
                )}
              </div>
              <div>
                <label className="text-xs text-gray-600">Rumstyp</label>
                <select
                  className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                  value={editRoomTypeKey}
                  onChange={e => setEditRoomTypeKey(e.target.value)}
                  disabled={isInspectionLocked}
                >
                  {roomTypes.map(rt => (
                    <option key={rt.id} value={rt.key}>
                      {rt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelEditRoom}
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={saveEditRoom}
                disabled={isInspectionLocked}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-50 disabled:text-indigo-700 disabled:ring-1 disabled:ring-indigo-200"
              >
                Spara
              </button>
            </div>
          </div>
        )}

        {!isRoomCollapsed && (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {filteredGroups.map(g => (
                <SelectField
                  key={g.id}
                  label={g.label}
                  value={vals[g.key] ?? ''}
                  options={optionsByGroup[g.id] || []}
                  disabled={isInspectionLocked}
                  onChange={v => updateRoomValues(room.id, { [g.key]: v })}
                />
              ))}
            </div>

            {room.id && (
              <RoomControlPointsSection
                room={room}
                collapsedStorageKey={`ob:insida:collapsed:${inspection.id}:room:${room.id}`}
                inspectionSide={inspectionSide}
                items={roomControlItems}
                onUpdateItem={updateControlItem}
                onDeleteItem={deleteControlItem}
                onDeleteItemGroup={deleteControlItemGroup}
                onAddOutcomeItem={addOutcomeControlItem}
                onAddFromCatalog={addControlItemFromCatalog}
                onAddFreeNote={addFreeNoteControlItem}
                isInspectionLocked={isInspectionLocked}
                outcomesByControlPointId={outcomesByControlPointId}
                controlPointMetaById={controlPointMetaById}
                imagesByControlItemId={imagesByControlItemId}
                onUploadImage={handleUploadImageForControlItem}
                onDeleteImage={handleDeleteImage}
                onDropImage={(controlItem, imageId) => {
                  void moveImageToControlItem(imageId, controlItem)
                }}
                onOpenImageBank={openImageBankForControlItem}
                onPreviewImage={setPreviewImage}
                onUnlinkImage={unlinkImageFromNote}
              />
            )}
          </>
        )}
      </article>
    )
  }

  const renderNewRoomForm = () => {
    if (!showNewRoomForm || isInspectionLocked) return null

    return (
      <section className="rounded-xl border border-gray-200 bg-gray-50 p-3 md:p-4 space-y-2 text-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-xs text-gray-600">Plan</label>
            {derivedFloors.length ? (
              <select
                className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                value={newFloorLabel}
                onChange={e => setNewFloorLabel(e.target.value)}
              >
                {derivedFloors.map(fk => (
                  <option key={fk} value={fk}>
                    {getFloorLabel(fk)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                value={newFloorLabel}
                onChange={e => setNewFloorLabel(e.target.value)}
                placeholder="t.ex. Källare, Plan 1, Plan 2"
              />
            )}
          </div>

          <div>
            <label className="text-xs text-gray-600">Rumstyp</label>
            <select
              className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
              value={newRoomTypeKey}
              onChange={e => setNewRoomTypeKey(e.target.value)}
            >
              {roomTypes.map(rt => (
                <option key={rt.id} value={rt.key}>
                  {rt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-600">
              Rumnamn (valfritt, auto om tomt)
            </label>
            <input
              className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
              value={newRoomLabel}
              onChange={e => setNewRoomLabel(e.target.value)}
              placeholder="t.ex. Sovrum 1, Master bedroom…"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={() => {
              setShowNewRoomForm(false)
              setNewRoomLabel('')
            }}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={addRoom}
            className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
          >
            Spara rum
          </button>
        </div>
      </section>
    )
  }

  // ----------------- RENDER -----------------
  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Laddar insida…</div>
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        {error}
        <div className="mt-1 text-xs text-gray-600">
          Kontrollera att tabellerna settings_interior_*,
          inspection_interior_rooms, inspection_control_items och inspection_images finns
          och att RLS/policies tillåter läsning/skrivning.
        </div>
      </div>
    )
  }

  if (!roomTypes.length || !groups.length) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Inga rumstyper eller grupper definierade ännu. Lägg upp dem under Settings → Insida.
      </div>
    )
  }

  if (useHybridLayout) {
    const activeRoom = activeHybridRoomId
      ? rooms.find(room => room.id === activeHybridRoomId) ?? null
      : null
    const activeRoomIndex = activeRoom
      ? filteredRooms.findIndex(room => room.id === activeRoom.id)
      : -1
    const previousRoom =
      activeRoomIndex > 0 ? filteredRooms[activeRoomIndex - 1] : null
    const nextRoom =
      activeRoomIndex >= 0 && activeRoomIndex < filteredRooms.length - 1
        ? filteredRooms[activeRoomIndex + 1]
        : null
    const closePanel = () => setActiveHybridRoomId(null)
    const mobileSplitStyle = {
      '--mobile-image-panel-height': `${mobileImagePanelHeight}%`,
    } as CSSProperties

    const panelContent = activeRoom ? (
      <>
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 md:px-6">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Insida
            </div>
            <h3 className="mt-1 truncate text-xl font-semibold text-gray-900">
              {getRoomHeading(activeRoom)}
            </h3>
            <p className="mt-1 text-xs text-gray-500">
              {getRoomSummary(activeRoom)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => startEditRoom(activeRoom)}
              disabled={isInspectionLocked}
              className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Redigera rum
            </button>
            <button
              type="button"
              onClick={closePanel}
              className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
            >
              Stäng
            </button>
          </div>
        </header>

        <div
          ref={mobileSplitContainerRef}
          className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[minmax(0,1fr)_570px] xl:grid-cols-[minmax(0,1fr)_690px]"
          style={mobileSplitStyle}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
            {renderRoomCard(activeRoom, {
              forceExpanded: true,
              embedded: true,
              hideHeader: true,
            })}
          </div>
          <button
            type="button"
            onPointerDown={handleMobileSplitPointerDown}
            onPointerMove={handleMobileSplitPointerMove}
            onPointerUp={handleMobileSplitPointerEnd}
            onPointerCancel={handleMobileSplitPointerEnd}
            className="flex h-5 shrink-0 touch-none items-center justify-center border-y border-gray-200 bg-gray-50 text-gray-400 lg:hidden"
            aria-label="Ändra höjd på bildbanken"
            title="Dra för att ändra höjd på bildbanken"
          >
            <span className="h-1 w-12 rounded-full bg-gray-300" />
          </button>
          <div className="h-[var(--mobile-image-panel-height)] min-h-0 shrink-0 lg:contents">
            {renderImageProcessingPanel(activeRoom)}
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => previousRoom?.id && setActiveHybridRoomId(previousRoom.id)}
            disabled={!previousRoom}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Föregående
          </button>
          <button
            type="button"
            onClick={() => nextRoom?.id && setActiveHybridRoomId(nextRoom.id)}
            disabled={!nextRoom}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Nästa
          </button>
        </footer>
      </>
    ) : null

    return (
      <div className="space-y-5">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5 space-y-4">
          <header className="space-y-1">
            <h2 className="text-xl font-semibold text-gray-900">
              Byggnad – insida
            </h2>
          </header>

          {isInspectionLocked && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Besiktningen är låst. Insidan är skrivskyddad.
            </div>
          )}

          <section className="flex flex-wrap items-center gap-2">
            {floorLabels.map(fl => (
              <button
                key={fl}
                type="button"
                onClick={() => {
                  setActiveFloor(fl)
                  setActiveHybridRoomId(null)
                }}
                className={`rounded-md border px-3 py-1 text-xs ${
                  activeFloor === fl
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
                }`}
              >
                {getFloorLabel(fl)}
              </button>
            ))}

            {floorLabels.length === 0 && (
              <span className="text-xs text-gray-600">
                Inga plan ännu. Fyll i Byggnadstyp under Förutsättningar, eller lägg till ett rum så skapas plan automatiskt.
              </span>
            )}
          </section>
        </section>

        {!isOtherFloor && !isInspectionLocked && (
          <section className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (activeFloor && activeFloor !== OTHER_ROOM_TYPE_KEY) {
                  setNewFloorLabel(activeFloor)
                } else if (derivedFloors.length) {
                  setNewFloorLabel(derivedFloors[0])
                } else if (floorLabels.length) {
                  setNewFloorLabel(floorLabels[0])
                } else {
                  setNewFloorLabel('plan1')
                }
                setShowNewRoomForm(true)
              }}
              className="inline-flex items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              + Lägg till rum
            </button>
          </section>
        )}

        {renderNewRoomForm()}

        <section className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
          <header className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Rum
            </h3>
            <span className="text-xs text-gray-500">
              Klicka för att öppna arbetsfönster
            </span>
          </header>

          {filteredRooms.length > 0 ? (
            <div className="divide-y divide-gray-200">
              {filteredRooms.map(room => {
                const isActive = activeRoom?.id === room.id

                return (
                  <button
                    key={room.id ?? `${room.floor_label}-${room.room_label}`}
                    type="button"
                    onClick={() => room.id && setActiveHybridRoomId(room.id)}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-2 py-3 text-left transition hover:bg-gray-50 ${
                      isActive ? 'bg-blue-50' : ''
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-gray-900">
                        {getRoomHeading(room)}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-gray-600">
                        {getRoomSummary(room)}
                      </span>
                    </span>
                    <span className="text-lg leading-none text-gray-400">›</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="p-3 text-sm text-gray-600 border border-dashed rounded-lg">
              Inga rum registrerade på detta plan ännu.
              <br />
              Lägg till ett rum med knappen “Lägg till rum” ovanför.
            </div>
          )}
        </section>

        {activeRoom && panelContent && (
          <>
            <div
              className="fixed inset-0 z-50 hidden bg-black/20 lg:flex lg:justify-end"
              onMouseDown={closePanel}
            >
              <aside
                className="h-full w-full max-w-[1280px] border-l border-gray-200 bg-white shadow-2xl lg:flex lg:flex-col"
                onMouseDown={event => event.stopPropagation()}
              >
                {panelContent}
              </aside>
            </div>
            <section className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
              {panelContent}
            </section>
          </>
        )}

        {saving && (
          <div className="text-xs text-gray-600">
            Sparar…
          </div>
        )}
        {renderImagePreview()}
        {renderImageBankPicker()}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white p-4 md:p-5 space-y-4">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold text-gray-900">Byggnad – insida</h2>
          <p className="text-sm text-gray-700">
            Här dokumenterar du invändiga rum per plan och rumstyp. Gå vänstervarv per plan och lägg till
            ett kort för varje rum (Sovrum 1, Sovrum 2, Vardagsrum, Badrum osv.). Kontrollpunkter
            föreslås automatiskt men du kan även lägga till egna per rum.
          </p>
        </header>

        {/* Plan-flikar */}
        <section className="flex flex-wrap items-center gap-2">
          {floorLabels.map(fl => (
            <button
              key={fl}
              type="button"
              onClick={() => setActiveFloor(fl)}
              className={`rounded-md border px-3 py-1 text-xs ${
                activeFloor === fl
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {getFloorLabel(fl)}
            </button>
          ))}

          {floorLabels.length === 0 && (
            <span className="text-xs text-gray-600">
              Inga plan ännu. Fyll i Byggnadstyp under Förutsättningar, eller lägg till ett rum så skapas plan automatiskt.
            </span>
          )}
        </section>

        {roomChips.length > 0 && (
          <section className="flex flex-wrap items-center gap-2 border-t border-gray-200 pt-3">
            {roomChips.map(room => (
              <button
                key={room.id ?? room.room_label}
                type="button"
                onClick={() => scrollToRoom(room.id)}
                className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-gray-50"
              >
                {getRoomDisplayLabel(room)}
              </button>
            ))}
          </section>
        )}
      </section>

      {!isOtherFloor && !isInspectionLocked && (
        <section className="flex justify-end">
          <button
            type="button"
            onClick={() => {
              // Alltid förinställ Plan till aktuellt plan om det finns
              if (activeFloor && activeFloor !== OTHER_ROOM_TYPE_KEY) {
                setNewFloorLabel(activeFloor)
              } else if (derivedFloors.length) {
                setNewFloorLabel(derivedFloors[0])
              } else if (floorLabels.length) {
                setNewFloorLabel(floorLabels[0])
              } else {
                setNewFloorLabel('plan1')
              }
              setShowNewRoomForm(true)
            }}
            className="inline-flex items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            + Lägg till rum
          </button>
        </section>
      )}

      {/* Ny-rumsformulär */}
      {renderNewRoomForm()}

      {/* Rumskort */}
      <section className="space-y-4">
        {filteredRooms.map(room => renderRoomCard(room))}

        {filteredRooms.length === 0 && (
          <div className="p-3 text-sm text-gray-600 border border-dashed rounded-lg">
            Inga rum registrerade på detta plan ännu.
            <br />
            Lägg till ett rum med knappen “Lägg till rum” ovanför.
          </div>
        )}
      </section>

      {saving && (
        <div className="text-xs text-gray-600">
          Sparar…
        </div>
      )}
    </div>
  )
}

// =============================
// Undkomponent: Bilder per kontrollpunkt
// =============================
type ControlItemImagesSectionProps = {
  controlItem: InspectionControlItem
  images: InspectionImage[]
  onUpload: (ci: InspectionControlItem, file: File) => void | Promise<void>
  onDelete: (imageId: string) => void
  onDropImage: (ci: InspectionControlItem, imageId: string) => void | Promise<void>
  onOpenImageBank?: () => void
  onPreviewImage: (image: InspectionImage) => void
  onUnlink: (imageId: string) => void | Promise<void>
  disabled?: boolean
}

function ControlItemImagesSection({
  controlItem,
  images,
  onUpload,
  onDropImage,
  onOpenImageBank,
  onPreviewImage,
  onUnlink,
  disabled = false,
}: ControlItemImagesSectionProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    for (const file of files) {
      await onUpload(controlItem, file)
    }
    e.target.value = ''
  }

  const canDropImage = (event: DragEvent<HTMLElement>) =>
    !disabled &&
    Array.from(event.dataTransfer.types).includes(IMAGE_DRAG_DATA_TYPE)

  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!canDropImage(event)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = () => {
    setIsDragOver(false)
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!canDropImage(event)) return
    event.preventDefault()
    setIsDragOver(false)
    const imageId = event.dataTransfer.getData(IMAGE_DRAG_DATA_TYPE)
    if (!imageId) return
    void onDropImage(controlItem, imageId)
  }

  return (
    <section className="space-y-2 border-t pt-2">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-lg border border-dashed p-2 transition ${
          isDragOver
            ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-100'
            : 'border-gray-200 bg-white/70'
        }`}
      >
      <header className="flex items-center justify-between">
        <h5 className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-900">
          <span aria-hidden="true">{'\u{1F4F7}'}</span>
          <span>Bilder (denna kontrollpunkt)</span>
        </h5>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-800 hover:bg-gray-50"
            disabled={disabled}
          >
            Kamera
          </button>
          <button
            type="button"
            onClick={() => libraryInputRef.current?.click()}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-800 hover:bg-gray-50"
            disabled={disabled}
          >
            Fil
          </button>
          {onOpenImageBank ? (
            <button
              type="button"
              onClick={onOpenImageBank}
              className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-800 hover:bg-gray-50"
              disabled={disabled}
            >
              Bildbank
            </button>
          ) : null}
        </div>
      </header>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
      />
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />

      {images.length === 0 && (
        <p className="text-[10px] text-gray-500">
          Inga bilder ännu för denna kontrollpunkt.
        </p>
      )}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(img => {
            const url = getImagePublicUrl(img.file_path)
            return (
              <div
                key={img.id}
                draggable={!disabled}
                onDragStart={event => {
                  if (disabled) {
                    event.preventDefault()
                    return
                  }
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData(IMAGE_DRAG_DATA_TYPE, img.id)
                }}
                className="relative h-16 w-16 overflow-hidden rounded-lg border bg-gray-100"
              >
                <button
                  type="button"
                  onClick={() => onPreviewImage(img)}
                  className="block h-full w-full"
                  aria-label="Visa bild"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={img.label || 'Bild'}
                    className="h-full w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void onUnlink(img.id)}
                  className="absolute inset-x-1 bottom-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[0px] font-semibold text-white"
                  title="Koppla loss"
                  aria-label="Koppla loss bild"
                >
                  <span className="text-[9px]">Koppla loss</span>
                </button>
              </div>
            )
          })}
        </div>
      )}
      </div>
    </section>
  )
}

// =============================
// Undkomponent: Kontrollpunkter per rum
// =============================
type RoomControlPointsSectionProps = {
  room: InteriorRoom
  collapsedStorageKey: string
  inspectionSide: InspectionSide
  items: InspectionControlItem[]
  isInspectionLocked: boolean
  onUpdateItem: (itemId: string, patch: Partial<InspectionControlItem>) => void
  onDeleteItem: (itemId: string, skipConfirm?: boolean) => void
  onDeleteItemGroup: (baseItem: InspectionControlItem) => void
  onAddOutcomeItem: (
    baseItem: InspectionControlItem,
    outcome: ControlPointOutcome
  ) => void
  onAddFromCatalog: (room: InteriorRoom, cp: ControlPointLite) => void
  onAddFreeNote: (room: InteriorRoom) => void
  outcomesByControlPointId: Record<string, ControlPointOutcome[]>
  controlPointMetaById: Record<string, ControlPointMeta>
  imagesByControlItemId: Record<string, InspectionImage[]>
  onUploadImage: (ci: InspectionControlItem, file: File) => void
  onDeleteImage: (imageId: string) => void
  onDropImage: (ci: InspectionControlItem, imageId: string) => void
  onOpenImageBank: (ci: InspectionControlItem) => void
  onPreviewImage: (image: InspectionImage) => void
  onUnlinkImage: (imageId: string) => void
}

function RoomControlPointsSection({
  room,
  collapsedStorageKey,
  inspectionSide,
  items,
  isInspectionLocked,
  onUpdateItem,
  onDeleteItem,
  onDeleteItemGroup,
  onAddOutcomeItem,
  onAddFromCatalog,
  onAddFreeNote,
  outcomesByControlPointId,
  controlPointMetaById,
  imagesByControlItemId,
  onUploadImage,
  onDeleteImage,
  onDropImage,
  onOpenImageBank,
  onPreviewImage,
  onUnlinkImage,
}: RoomControlPointsSectionProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<ControlPointLite[]>([])
  const [searching, setSearching] = useState(false)
  const [aiSearchHasRun, setAiSearchHasRun] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('control_points')
  const [expandedOkGroupIds, setExpandedOkGroupIds] = useState<Set<string>>(
    () => new Set()
  )
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set()
  )
  const [collapsedFreeNoteIds, setCollapsedFreeNoteIds] = useState<Set<string>>(
    () => new Set()
  )
  const hasLoadedCollapsedGroupsRef = useRef(false)
  const hasLoadedCollapsedFreeNotesRef = useRef(false)
  const roomDisplayLabel =
    normalizeSwedish(room.room_label ?? '').trim() ||
    (isOtherRoomKey(room.room_type_key) ? OTHER_ROOM_DISPLAY_LABEL : 'rummet')
  const groupedItems = useMemo(() => {
    const map = new Map<string, InspectionControlItem[]>()
    for (const ci of items) {
      const cpId = ci.control_point_id
      if (!cpId) continue
      const bucket = map.get(cpId) ?? []
      bucket.push(ci)
      map.set(cpId, bucket)
    }
    return Array.from(map.entries())
      .map(([controlPointId, list]) => ({
        controlPointId,
        items: [...list].sort(
          (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
        ),
      }))
      .sort((a, b) => {
        const aSort = a.items[0]?.sort_order ?? 0
        const bSort = b.items[0]?.sort_order ?? 0
        if (aSort !== bSort) return aSort - bSort
        return String(a.items[0]?.title ?? '').localeCompare(
          String(b.items[0]?.title ?? ''),
          'sv'
        )
      })
  }, [items])
  const freeNoteItems = useMemo(
    () =>
      items
        .filter(ci => ci.control_point_id === null)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [items]
  )

  useEffect(() => {
    hasLoadedCollapsedGroupsRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(`${collapsedStorageKey}:control-points`)
      if (!raw) {
        setCollapsedGroupIds(new Set())
        hasLoadedCollapsedGroupsRef.current = true
        return
      }
      const parsed = JSON.parse(raw)
      setCollapsedGroupIds(
        Array.isArray(parsed)
          ? new Set(parsed.filter((value): value is string => typeof value === 'string'))
          : new Set()
      )
    } catch (e) {
      console.warn('Kunde inte läsa dolda kontrollpunkter för insida:', e)
      setCollapsedGroupIds(new Set())
    } finally {
      hasLoadedCollapsedGroupsRef.current = true
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedCollapsedGroupsRef.current) return
    try {
      window.localStorage.setItem(
        `${collapsedStorageKey}:control-points`,
        JSON.stringify(Array.from(collapsedGroupIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara dolda kontrollpunkter för insida:', e)
    }
  }, [collapsedGroupIds, collapsedStorageKey])

  useEffect(() => {
    hasLoadedCollapsedFreeNotesRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(`${collapsedStorageKey}:free-notes`)
      if (!raw) {
        setCollapsedFreeNoteIds(new Set())
        hasLoadedCollapsedFreeNotesRef.current = true
        return
      }
      const parsed = JSON.parse(raw)
      setCollapsedFreeNoteIds(
        Array.isArray(parsed)
          ? new Set(parsed.filter((value): value is string => typeof value === 'string'))
          : new Set()
      )
    } catch (e) {
      console.warn('Kunde inte läsa dolda fria noteringar för insida:', e)
      setCollapsedFreeNoteIds(new Set())
    } finally {
      hasLoadedCollapsedFreeNotesRef.current = true
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedCollapsedFreeNotesRef.current) return
    try {
      window.localStorage.setItem(
        `${collapsedStorageKey}:free-notes`,
        JSON.stringify(Array.from(collapsedFreeNoteIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara dolda fria noteringar för insida:', e)
    }
  }, [collapsedFreeNoteIds, collapsedStorageKey])

  const expandOkGroup = (groupId: string) => {
    setExpandedOkGroupIds(prev => {
      const next = new Set(prev)
      next.add(groupId)
      return next
    })
  }

  const collapseOkGroup = (groupId: string) => {
    setExpandedOkGroupIds(prev => {
      if (!prev.has(groupId)) return prev
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
  }
  const collapseGroup = (groupId: string) => {
    setCollapsedGroupIds(prev => {
      const next = new Set(prev)
      next.add(groupId)
      return next
    })
  }

  const expandGroup = (groupId: string) => {
    setCollapsedGroupIds(prev => {
      if (!prev.has(groupId)) return prev
      const next = new Set(prev)
      next.delete(groupId)
      return next
    })
  }

  const toggleFreeNoteCollapsed = (itemId: string) => {
    setCollapsedFreeNoteIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const clearSearch = () => {
    setSearchTerm('')
    setSearchResults([])
    setSearching(false)
    setAiSearchHasRun(false)
  }

  const handleToggleSearch = () => {
    const next = !showSearch
    setShowSearch(next)
    if (!next) clearSearch()
  }

  const handleCloseSearch = () => {
    setShowSearch(false)
    clearSearch()
  }

  const handleSearchModeChange = (mode: SearchMode) => {
    if (mode === searchMode) return
    setSearchMode(mode)
    clearSearch()
  }

  const handleSearchChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const term = e.target.value
    setSearchTerm(term)

    const trimmed = term.trim()
    if (searchMode === 'ai') {
      setAiSearchHasRun(false)
      setSearchResults([])
      setSearching(false)
      return
    }

    if (trimmed.length < 2) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      const like = `%${trimmed}%`
      if (searchMode === 'control_points') {
        const { data, error } = await supabase
          .from('settings_control_points')
          .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
          .eq('is_active', true)
          .or(
            `title.ilike.${like},label.ilike.${like},key.ilike.${like},description.ilike.${like}`
          )

        if (error) {
          console.error('search control points failed:', error)
          return
        }

        const points = (data ?? []) as ControlPointLite[]
        setSearchResults(
          points.filter(cp => controlPointAppliesToInspectionSide(cp, inspectionSide))
        )
        return
      }

      const { data: outcomeRows, error: outcomesError } = await supabase
        .from('settings_control_point_outcomes')
        .select('control_point_id, label, note_template, risk_template, ftu_template')
        .eq('is_active', true)
        .or(
          `label.ilike.${like},note_template.ilike.${like},risk_template.ilike.${like},ftu_template.ilike.${like}`
        )

      if (outcomesError) {
        console.error('search control point outcomes failed:', outcomesError)
        return
      }

      const outcomes = (outcomeRows ?? []) as Array<{
        control_point_id: string | null
        label: string | null
        note_template: string | null
        risk_template: string | null
        ftu_template: string | null
      }>

      const controlPointIds = Array.from(
        new Set(
          outcomes
            .map(outcome => outcome.control_point_id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        )
      )

      if (controlPointIds.length === 0) {
        setSearchResults([])
        return
      }

      const { data: controlPointsData, error: controlPointsError } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
        .eq('is_active', true)
        .in('id', controlPointIds)

      if (controlPointsError) {
        console.error('search control points by outcomes failed:', controlPointsError)
        return
      }

      const outcomeLabelsByControlPointId = outcomes.reduce<Record<string, string[]>>(
        (acc, outcome) => {
          const controlPointId = outcome.control_point_id
          const outcomeLabel = (outcome.label ?? '').trim()
          if (!controlPointId || !outcomeLabel) return acc
          const current = acc[controlPointId] || []
          if (!current.includes(outcomeLabel)) current.push(outcomeLabel)
          acc[controlPointId] = current
          return acc
        },
        {}
      )

      const points = (controlPointsData ?? []) as ControlPointLite[]
      const filteredPoints = points.filter(cp =>
        controlPointAppliesToInspectionSide(cp, inspectionSide)
      )
      setSearchResults(
        filteredPoints.map(cp => {
          const outcomeLabels = outcomeLabelsByControlPointId[cp.id] || []
          return {
            ...cp,
            search_hint:
              outcomeLabels.length > 0
                ? `Noteringsträff: ${outcomeLabels.slice(0, 3).join(', ')}`
                : 'Noteringsträff',
          }
        })
      )
    } finally {
      setSearching(false)
    }
  }

  const handleAiSearch = async () => {
    const trimmed = searchTerm.trim()
    if (trimmed.length < 2 || isInspectionLocked) return

    setSearching(true)
    setAiSearchHasRun(false)
    try {
      const response = await fetch('/api/ai/search-control-points/interior', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: trimmed,
          limit: 10,
        }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        console.error('AI control point search failed:', payload.error ?? response.statusText)
        setSearchResults([])
        return
      }

      const payload = (await response.json()) as { results?: ControlPointLite[] }
      setSearchResults(payload.results ?? [])
    } catch (error) {
      console.error('AI control point search failed:', error)
      setSearchResults([])
    } finally {
      setAiSearchHasRun(true)
      setSearching(false)
    }
  }

  const controlPointScopeLabel = (cp: ControlPointLite) => {
    if (cp.scope === 'exterior') {
      return cp.exterior_item_key ? `Utsida - ${cp.exterior_item_key}` : 'Utsida'
    }
    if (cp.scope === 'interior') return 'Insida'
    return cp.scope || 'Kontrollpunkt'
  }

  return (
    <section className="space-y-3 border-t pt-3">
      <ControlPointSearchDialog
        open={showSearch}
        title="Lägg till kontrollpunkt"
        contextLabel={roomDisplayLabel}
        searchMode={searchMode}
        searchTerm={searchTerm}
        searchResults={searchResults}
        searching={searching}
        disabled={isInspectionLocked}
        controlPointPlaceholder="Sök t.ex. golvbrunn, kyl, trinett..."
        chipPlaceholder="Sök notering, t.ex. spricka, fukt, missfärgning..."
        aiPlaceholder="Beskriv vad du ser, t.ex. plåt som släppt på insidan..."
        showAiMode
        aiSearchHasRun={aiSearchHasRun}
        scopeLabelForResult={controlPointScopeLabel}
        onSearchModeChange={handleSearchModeChange}
        onSearchChange={handleSearchChange}
        onRunAiSearch={handleAiSearch}
        onSelect={cp => {
          onAddFromCatalog(room, cp)
          handleCloseSearch()
        }}
        onClose={handleCloseSearch}
      />

      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">
            Kontrollpunkter i detta rum
          </h4>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAddFreeNote(room)}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs md:text-[11px] font-medium text-gray-800 hover:bg-gray-50"
            disabled={isInspectionLocked}
          >
            + Lägg till fri notering
          </button>
          <button
            type="button"
            onClick={handleToggleSearch}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-xs md:text-[11px] font-medium text-gray-800 hover:bg-gray-50"
            disabled={isInspectionLocked}
          >
            + Lägg till ytterligare kontrollpunkt
          </button>
        </div>
      </header>

      {/* Lista med befintliga kontrollpunkter */}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-gray-600">
            Inga kontrollpunkter ännu. De kan läggas till automatiskt för rumstypen
            eller via knappen “Lägg till ytterligare kontrollpunkt”.
          </div>
        )}

        {freeNoteItems.map(ci => {
          const ciId = ci.id ?? ''
          const ciImages = imagesByControlItemId[ciId] || []
          const isCollapsed = ciId ? collapsedFreeNoteIds.has(ciId) : false
          return (
            <div
              key={ci.id}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-900">
                  {ci.title}
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => ciId && toggleFreeNoteCollapsed(ciId)}
                    className="text-xs md:text-[11px] text-gray-700 hover:underline"
                    aria-expanded={!isCollapsed}
                    disabled={!ciId}
                  >
                    {isCollapsed ? 'Visa' : 'Dölj'}
                  </button>
                  {ci.id && (
                  <button
                    type="button"
                    onClick={() => ci.id && onDeleteItem(ci.id)}
                    className="text-xs md:text-[11px] text-rose-600 hover:underline"
                    disabled={isInspectionLocked}
                  >
                    Ta bort notering
                  </button>
                  )}
                </div>
              </div>

              {!isCollapsed && (
                <>
                  <div className="space-y-1">
                    <label className="text-xs md:text-[11px] text-gray-600">
                      🧱 Notering
                    </label>
                    <DebouncedTextarea
                      rows={2}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                      placeholder="Fri notering för rummet…"
                      value={ci.note ?? ''}
                      onSave={value => {
                        if (ci.id) onUpdateItem(ci.id, { note: value })
                      }}
                      readOnly={isInspectionLocked}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs md:text-[11px] text-gray-600">
                      ⚠️ Riskanalys
                    </label>
                    <DebouncedTextarea
                      rows={3}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                      placeholder="Beskriv riskanalys..."
                      value={ci.risk_text ?? ''}
                      onSave={value => {
                        if (ci.id) onUpdateItem(ci.id, { risk_text: value })
                      }}
                      readOnly={isInspectionLocked}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs md:text-[11px] text-gray-600">
                      🔍 Fortsatt teknisk utredning (FTU)
                    </label>
                    <DebouncedTextarea
                      rows={3}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                      placeholder="Beskriv fortsatt teknisk utredning..."
                      value={ci.ftu_text ?? ''}
                      onSave={value => {
                        if (ci.id) onUpdateItem(ci.id, { ftu_text: value })
                      }}
                      readOnly={isInspectionLocked}
                    />
                  </div>

                  {ci.id && (
                    <ControlItemImagesSection
                      controlItem={ci}
                      images={ciImages}
                      onUpload={onUploadImage}
                      onDelete={onDeleteImage}
                      onDropImage={onDropImage}
                      onOpenImageBank={() => onOpenImageBank(ci)}
                      onPreviewImage={onPreviewImage}
                      onUnlink={onUnlinkImage}
                      disabled={isInspectionLocked}
                    />
                  )}
                </>
              )}
            </div>
          )
        })}

        {groupedItems.map(group => {
          const groupId = group.controlPointId
          const baseItem = group.items[0]
          if (!baseItem) return null
          const outcomes = outcomesByControlPointId[group.controlPointId] || []
          const meta = controlPointMetaById[group.controlPointId]
          const description = (meta?.description ?? '').trim()
          const selectedItems = group.items.filter(ci => ci.selected_outcome_id)
          const isGreen = selectedItems.length === 0 && baseItem.status === 'ok'
          const isYellow = selectedItems.length > 0
          const isRed = !isGreen && !isYellow
          const isCollapsedGreen = isGreen && !expandedOkGroupIds.has(groupId)
          const isCollapsedManually = collapsedGroupIds.has(groupId)
          const isCollapsed = isCollapsedGreen || isCollapsedManually
          const rowToneClass = isRed
            ? 'bg-red-50 border-red-200'
            : isGreen
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'

          if (isCollapsed) {
            const collapsedBadgeClass = isGreen
              ? 'border-emerald-300 text-emerald-700'
              : isYellow
              ? 'border-amber-300 text-amber-700'
              : 'border-red-300 text-red-700'
            const collapsedBadgeText = isGreen
              ? 'Inget att notera'
              : isYellow
              ? `${selectedItems.length} vald${selectedItems.length === 1 ? ' notering' : 'a noteringar'}`
              : 'Ej färdig'
            return (
              <div
                key={group.controlPointId}
                className={`rounded-lg border px-3 py-2 ${rowToneClass}`}
              >
                <div className="flex items-center gap-2">
                  <div className="text-xs font-semibold text-gray-900 truncate">
                    {baseItem.title}
                  </div>
                  <span className={`rounded-full border bg-white px-2 py-0.5 text-[11px] md:text-[10px] font-medium ${collapsedBadgeClass}`}>
                    {collapsedBadgeText}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isGreen) expandOkGroup(groupId)
                        expandGroup(groupId)
                      }}
                      className="rounded-full border border-gray-300 bg-white px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-50 md:text-[11px]"
                    >
                      Öppna kontrollpunkt
                    </button>
                    {baseItem.id && (
                      <button
                        type="button"
                        onClick={() => onDeleteItemGroup(baseItem)}
                        className="text-xs md:text-[11px] text-rose-600 hover:underline"
                        disabled={isInspectionLocked}
                      >
                        Ta bort
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          }

          return (
            <div
              key={group.controlPointId}
              className={`rounded-lg border px-3 py-2 space-y-2 ${rowToneClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-900">
                  {baseItem.title}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (isGreen) {
                        collapseOkGroup(groupId)
                        expandGroup(groupId)
                      } else {
                        collapseGroup(groupId)
                      }
                    }}
                    className="text-xs md:text-[11px] text-gray-700 hover:underline"
                  >
                    Dölj
                  </button>
                  {baseItem.id && (
                    <button
                      type="button"
                      onClick={() => onDeleteItemGroup(baseItem)}
                      className="text-xs md:text-[11px] text-rose-600 hover:underline"
                      disabled={isInspectionLocked}
                    >
                      Ta bort
                    </button>
                  )}
                </div>
              </div>

              {description.length > 0 && (
                <div className="text-xs md:text-[11px] text-gray-600">
                  {description}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-xs md:text-[11px] text-gray-600">
                  Bedömning
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={
                      'rounded-full border px-2.5 py-1 text-xs md:text-[11px] ' +
                      (isGreen
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50')
                    }
                    onClick={() => {
                      if (!baseItem.id) return
                      if (selectedItems.length > 0 || !isGreen) {
                        selectedItems.forEach(ci => {
                          if (ci.id && ci.id !== baseItem.id) {
                            onDeleteItem(ci.id, true)
                          }
                        })
                        onUpdateItem(baseItem.id, {
                          status: 'ok',
                          selected_outcome_id: null,
                          note: null,
                          risk_text: null,
                          ftu_text: null,
                        })
                        collapseOkGroup(groupId)
                        expandGroup(groupId)
                      } else {
                        onUpdateItem(baseItem.id, {
                          status: RED_STATUS,
                          selected_outcome_id: null,
                          risk_text: null,
                          ftu_text: null,
                        })
                        expandOkGroup(groupId)
                        expandGroup(groupId)
                      }
                    }}
                    disabled={isInspectionLocked}
                  >
                    Inget att notera
                  </button>
                  {outcomes.map(outcome => {
                    const activeItem = selectedItems.find(
                      ci => ci.selected_outcome_id === outcome.id
                    )
                    const isActive = !!activeItem
                    const chipClass =
                      'rounded-full border px-2.5 py-1 text-xs md:text-[11px] ' +
                      (isActive
                        ? 'border-amber-600 bg-amber-600 text-white'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50')
                    return (
                      <button
                        key={outcome.id}
                        type="button"
                        className={chipClass}
                        onClick={() => {
                          if (!baseItem.id) return
                          if (isActive && activeItem?.id) {
                            if (selectedItems.length === 1) {
                              onUpdateItem(activeItem.id, {
                                status: RED_STATUS,
                                selected_outcome_id: null,
                                note: null,
                                risk_text: null,
                                ftu_text: null,
                              })
                            } else {
                              onDeleteItem(activeItem.id, true)
                            }
                          } else {
                            if (selectedItems.length === 0) {
                              onUpdateItem(baseItem.id, {
                                status: 'remark',
                                selected_outcome_id: outcome.id,
                                note: (outcome.note_template ?? '').trim() || null,
                                risk_text:
                                  (baseItem.risk_text ?? '').trim().length > 0
                                    ? baseItem.risk_text
                                    : (outcome.risk_template ?? '').trim() || null,
                                ftu_text:
                                  (baseItem.ftu_text ?? '').trim().length > 0
                                    ? baseItem.ftu_text
                                    : (outcome.ftu_template ?? '').trim() || null,
                              })
                            } else {
                              onAddOutcomeItem(baseItem, outcome)
                            }
                          }
                        }}
                        disabled={isInspectionLocked}
                      >
                        {outcome.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedItems.length === 0 && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <label className="text-xs md:text-[11px] text-gray-600">
                      🧱 Notering
                    </label>
                    <DebouncedTextarea
                      rows={2}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                      placeholder="Notering för just denna kontrollpunkt…"
                      value={baseItem.note ?? ''}
                      onSave={value => {
                        if (baseItem.id) onUpdateItem(baseItem.id, { note: value })
                      }}
                      readOnly={isInspectionLocked}
                    />
                  </div>
                  {baseItem.id && (
                    <ControlItemImagesSection
                      controlItem={baseItem}
                      images={imagesByControlItemId[baseItem.id] || []}
                      onUpload={onUploadImage}
                      onDelete={onDeleteImage}
                      onDropImage={onDropImage}
                      onOpenImageBank={() => onOpenImageBank(baseItem)}
                      onPreviewImage={onPreviewImage}
                      onUnlink={onUnlinkImage}
                      disabled={isInspectionLocked}
                    />
                  )}
                </div>
              )}

              {selectedItems.length > 0 && (
                <div className="space-y-3">
                  {selectedItems.map(ci => {
                    const selectedOutcome = ci.selected_outcome_id
                      ? outcomes.find(outcome => outcome.id === ci.selected_outcome_id) || null
                      : null
                    if (!selectedOutcome) return null
                    const riskTemplate = (selectedOutcome.risk_template ?? '').trim()
                    const ftuTemplate = (selectedOutcome.ftu_template ?? '').trim()
                    const riskText = (ci.risk_text ?? riskTemplate).trim()
                    const ftuText = (ci.ftu_text ?? ftuTemplate).trim()
                    const ciId = ci.id ?? ''
                    const ciImages = ciId ? imagesByControlItemId[ciId] || [] : []

                    return (
                      <div
                        key={ci.id}
                        className="rounded-lg border border-amber-200 bg-white p-3 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-gray-900">
                            {selectedOutcome.label}
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-xs md:text-[11px] text-gray-600">
                            🧱 Notering
                          </label>
                          <DebouncedTextarea
                            rows={2}
                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                            placeholder="Noteringstext..."
                            value={ci.note ?? ''}
                            onSave={value => {
                              if (ci.id) onUpdateItem(ci.id, { note: value })
                            }}
                            readOnly={isInspectionLocked}
                          />
                        </div>

                        {(riskText.length > 0 || ftuText.length > 0) && (
                          <div className="space-y-2">
                            {riskText.length > 0 && (
                              <div className="rounded-lg border border-gray-200 bg-white p-3">
                                <div className="text-xs font-semibold text-gray-700">
                                  ⚠️ Riskanalys
                                </div>
                                <DebouncedTextarea
                                  rows={3}
                                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                                  placeholder="Beskriv riskanalys..."
                                  value={riskText}
                                  onSave={value => {
                                    if (ci.id) onUpdateItem(ci.id, { risk_text: value })
                                  }}
                                  readOnly={isInspectionLocked}
                                />
                              </div>
                            )}
                            {ftuText.length > 0 && (
                              <div className="rounded-lg border border-gray-200 bg-white p-3">
                                <div className="text-xs font-semibold text-gray-700">
                                  🔍 Fortsatt teknisk utredning (FTU)
                                </div>
                                <DebouncedTextarea
                                  rows={3}
                                  className="mt-1 w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                                  placeholder="Beskriv fortsatt teknisk utredning..."
                                  value={ftuText}
                                  onSave={value => {
                                    if (ci.id) onUpdateItem(ci.id, { ftu_text: value })
                                  }}
                                  readOnly={isInspectionLocked}
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {ci.id && (
                          <ControlItemImagesSection
                            controlItem={ci}
                            images={ciImages}
                            onUpload={onUploadImage}
                            onDelete={onDeleteImage}
                            onDropImage={onDropImage}
                            onOpenImageBank={() => onOpenImageBank(ci)}
                            onPreviewImage={onPreviewImage}
                            onUnlink={onUnlinkImage}
                            disabled={isInspectionLocked}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}

      </div>

    </section>
  )
}











