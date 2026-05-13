'use client'

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, Image as ImageIcon, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
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
type RoundArea = 'interior' | 'exterior'
type ValueMap = Record<string, unknown>

type RoomType = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
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

type SettingsExteriorItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type InspectionExteriorObservation = {
  id?: string
  inspection_id: string
  exterior_item_id: string
  part_label: string | null
  values: ValueMap
  is_free_note?: boolean | null
  note: string | null
  risk_text?: string | null
  ftu_text?: string | null
}

type InspectionControlItem = {
  id?: string
  inspection_id: string
  interior_room_id: string | null
  exterior_observation_id: string | null
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
  tags?: unknown
  trigger_room_types?: unknown
  applies_to?: unknown
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
  source_area?: RoundArea | null
  origin_interior_room_id?: string | null
  origin_exterior_observation_id?: string | null
  origin_exterior_item_id?: string | null
  origin_floor_label?: string | null
  origin_room_label?: string | null
  origin_room_type_key?: string | null
  origin_exterior_item_key?: string | null
  captured_at?: string | null
  processing_status?: 'unprocessed' | 'linked' | 'ignored' | string | null
  ignored_at?: string | null
}

type QuickNote = {
  id: string
  inspection_id: string
  source_area: RoundArea
  interior_room_id: string | null
  exterior_observation_id: string | null
  exterior_item_id: string | null
  note: string
  created_at?: string | null
  updated_at?: string | null
}

type ImageFilter = 'all' | 'unprocessed' | 'linked' | 'ignored' | 'active' | 'unclassified'

type ObStepRundaProps = {
  inspection: Inspection
}

const IMAGE_BUCKET = 'inspection-images' as const
const RED_STATUS: InspectionControlItem['status'] = null
const OTHER_ROOM_TYPE_KEY = 'ovrigt'
const OTHER_ROOM_DISPLAY_LABEL = 'Allmänt'

const normalizeSwedish = (value: string) =>
  value
    .replace(/Ã¤/g, 'ä')
    .replace(/Ã¥/g, 'å')
    .replace(/Ã¶/g, 'ö')
    .replace(/Ã„/g, 'Ä')
    .replace(/Ã…/g, 'Å')
    .replace(/Ã–/g, 'Ö')
    .replace(/Ã©/g, 'é')

const parseFloorCount = (value: ValueMap[keyof ValueMap]) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value))
  const normalized = String(value ?? '').trim().replace(',', '.')
  if (!normalized) return 0
  const halfFloorMatch = normalized.match(/^(\d+)(?:_5|\.5)$/)
  if (halfFloorMatch) return Number(halfFloorMatch[1]) + 1
  const numeric = Number(normalized)
  if (!Number.isFinite(numeric)) return 0
  return Math.max(0, Math.floor(numeric))
}

const buildFloorsFromAnswers = (answers: ValueMap): string[] => {
  const floorsVal = answers.floors ?? answers['våningar'] ?? answers['våning'] ?? null
  const basementVal = answers.basement ?? answers['källare'] ?? null
  const atticVal = answers.attic ?? null
  const count = parseFloorCount(floorsVal)
  const keys: string[] = []

  if (basementVal === 'yes' || basementVal === 'ja' || basementVal === true) {
    keys.push('källare')
  } else if (basementVal === 'partial' || basementVal === 'delvis') {
    keys.push('källare_delvis')
  }

  for (let floor = 1; floor <= count; floor += 1) keys.push(`plan${floor}`)
  if (atticVal !== null && atticVal !== undefined && String(atticVal).trim() !== '') keys.push('vind')
  return keys
}

const normalizeFloorKey = (value: string | null | undefined) => {
  const normalized = normalizeSwedish(String(value ?? '')).trim()
  if (normalized === 'entréplan') return 'plan1'
  if (normalized === 'övrigt' || normalized === 'ovrigt') return OTHER_ROOM_TYPE_KEY
  return normalized
}

const floorLabelFromKey = (key: string) => {
  const normalized = normalizeFloorKey(key)
  if (normalized === OTHER_ROOM_TYPE_KEY) return OTHER_ROOM_DISPLAY_LABEL
  if (normalized === 'källare') return 'Källare'
  if (normalized === 'källare_delvis') return 'Källare'
  if (normalized === 'plan1') return 'Plan 1'
  if (normalized === 'plan2') return 'Plan 2'
  if (normalized === 'plan3') return 'Plan 3'
  if (normalized === 'vind') return 'Vind'
  if (normalized.startsWith('plan')) return `Plan ${normalized.replace('plan', '')}`
  return normalized || 'Plan'
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

const sortRooms = (a: InteriorRoom, b: InteriorRoom) => {
  const floorCompare = normalizeFloorKey(a.floor_label).localeCompare(normalizeFloorKey(b.floor_label), 'sv')
  if (floorCompare !== 0) return floorCompare
  return (a.order_index ?? 0) - (b.order_index ?? 0)
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

const getImagePublicUrl = (filePath: string) => {
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

const parseInspectionSideToken = (value: string): InspectionSide | null => {
  const token = normalizeSwedish(value)
    .trim()
    .toLowerCase()
    .replaceAll('å', 'a')
    .replaceAll('ä', 'a')
    .replaceAll('ö', 'o')

  if (token.includes('seller') || token.includes('salj')) return 'seller'
  if (token.includes('apartment') || token.includes('lagenhet') || token.includes('apt')) return 'apartment'
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

const getNormalizedTriggerRoomTypes = (triggerRoomTypes: unknown) => {
  const raw = Array.isArray(triggerRoomTypes) ? triggerRoomTypes : []
  return raw
    .map(val => normalizeRoomTypeKey((val ?? null) as string | null))
    .filter((val): val is string => !!val)
}

const controlPointMatchesRoom = (
  cp: ControlPointLite,
  roomTypeKey: string | null | undefined
) => {
  const roomKey = normalizeRoomTypeKey(roomTypeKey)
  if (!roomKey) return false
  const normalizedTriggerRoomTypes = getNormalizedTriggerRoomTypes(cp.trigger_room_types)
  if (normalizedTriggerRoomTypes.length === 0) return false
  return normalizedTriggerRoomTypes.includes(roomKey)
}

const imageStatus = (image: InspectionImage): 'unprocessed' | 'linked' | 'ignored' => {
  if (image.control_item_id) return 'linked'
  if (image.processing_status === 'ignored') return 'ignored'
  return 'unprocessed'
}

const statusLabel = (status: ReturnType<typeof imageStatus>) => {
  if (status === 'linked') return 'Kopplad'
  if (status === 'ignored') return 'Ignorerad'
  return 'Obehandlad'
}

export default function ObStepRunda({ inspection }: ObStepRundaProps) {
  const isInspectionLocked = Boolean(inspection?.locked_at)
  const inspectionSide = normalizeInspectionSide(inspection?.inspection_side)

  const [area, setArea] = useState<RoundArea>('interior')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [rooms, setRooms] = useState<InteriorRoom[]>([])
  const [derivedFloors, setDerivedFloors] = useState<string[]>([])
  const [activeFloor, setActiveFloor] = useState('')
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null)
  const [roomDialogOpen, setRoomDialogOpen] = useState(false)
  const [roundNavVisible, setRoundNavVisible] = useState(true)
  const [newRoomTypeKey, setNewRoomTypeKey] = useState('')
  const [newRoomLabel, setNewRoomLabel] = useState('')

  const [exteriorItems, setExteriorItems] = useState<SettingsExteriorItem[]>([])
  const [exteriorObservations, setExteriorObservations] = useState<InspectionExteriorObservation[]>([])
  const [activeExteriorItemId, setActiveExteriorItemId] = useState<string>('')
  const [exteriorDialogOpen, setExteriorDialogOpen] = useState(false)

  const [controlItems, setControlItems] = useState<InspectionControlItem[]>([])
  const [outcomesByControlPointId, setOutcomesByControlPointId] = useState<Record<string, ControlPointOutcome[]>>({})
  const [controlPointMetaById, setControlPointMetaById] = useState<Record<string, ControlPointLite>>({})
  const [quickNotes, setQuickNotes] = useState<QuickNote[]>([])
  const [images, setImages] = useState<InspectionImage[]>([])

  const [selectedControlItemId, setSelectedControlItemId] = useState<string | null>(null)
  const [freeNoteDialogId, setFreeNoteDialogId] = useState<string | null>(null)
  const [previewImage, setPreviewImage] = useState<InspectionImage | null>(null)
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(() => new Set())
  const [imageFilter, setImageFilter] = useState<ImageFilter>('unprocessed')

  const [searchOpen, setSearchOpen] = useState(false)
  const [searchMode, setSearchMode] = useState<ControlPointSearchMode>('control_points')
  const [searchTerm, setSearchTerm] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchResults, setSearchResults] = useState<ControlPointLite[]>([])
  const [aiSearchHasRun, setAiSearchHasRun] = useState(false)

  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const galleryInputRef = useRef<HTMLInputElement | null>(null)
  const pendingImageControlItemIdRef = useRef<string | null>(null)
  const lastScrollYRef = useRef(0)
  const overlayHistoryPushedRef = useRef(false)
  const ensuredInteriorRoomIdsRef = useRef<Set<string>>(new Set())
  const ensuredExteriorItemIdsRef = useRef<Set<string>>(new Set())

  const activeRoom = useMemo(
    () => rooms.find(room => room.id === activeRoomId) ?? null,
    [rooms, activeRoomId]
  )

  const activeExteriorItem = useMemo(
    () => exteriorItems.find(item => item.id === activeExteriorItemId) ?? null,
    [exteriorItems, activeExteriorItemId]
  )

  const activeExteriorObservation = useMemo(() => {
    if (!activeExteriorItem) return null
    return exteriorObservations.find(obs => obs.exterior_item_id === activeExteriorItem.id) ?? null
  }, [activeExteriorItem, exteriorObservations])

  const roomTypeLabelByKey = useMemo(
    () =>
      roomTypes.reduce<Record<string, string>>((acc, type) => {
        acc[type.key] = type.label || type.key
        return acc
      }, {}),
    [roomTypes]
  )

  const getRoomTypeLabel = (roomTypeKey: string | null | undefined) => {
    if (!roomTypeKey) return 'Rum'
    return roomTypeLabelByKey[roomTypeKey] ?? roomTypeKey
  }

  const getRoomDisplayName = (room: InteriorRoom | null) => {
    if (!room) return 'Rum'
    return room.room_label?.trim() || getRoomTypeLabel(room.room_type_key)
  }

  const getSuggestedRoomLabel = (roomTypeKey: string, floorKey = activeFloor) => {
    const floor = normalizeFloorKey(floorKey)
    const existingOnFloor = rooms.filter(
      room => normalizeFloorKey(room.floor_label) === floor && room.room_type_key === roomTypeKey
    ).length
    const roomTypeLabel = getRoomTypeLabel(roomTypeKey)
    return existingOnFloor === 0 ? roomTypeLabel : `${roomTypeLabel} ${existingOnFloor + 1}`
  }

  const floorOptions = useMemo(() => {
    const base = derivedFloors.length
      ? derivedFloors.map(normalizeFloorKey)
      : Array.from(new Set(rooms.map(room => normalizeFloorKey(room.floor_label))))
    const extras = rooms.map(room => normalizeFloorKey(room.floor_label))
    const merged = [...base, ...extras].filter(Boolean)
    const withoutOther = merged.filter(floor => floor !== OTHER_ROOM_TYPE_KEY)
    const hasVind = withoutOther.includes('vind')
    const withoutVind = withoutOther.filter(floor => floor !== 'vind')
    const ordered = [OTHER_ROOM_TYPE_KEY, ...withoutVind, ...(hasVind ? ['vind'] : [])]
    const unique = ordered.filter((floor, index) => ordered.indexOf(floor) === index)
    return unique.length > 0 ? unique : [OTHER_ROOM_TYPE_KEY, 'plan1']
  }, [derivedFloors, rooms])

  const roomsForActiveFloor = useMemo(
    () =>
      rooms
        .filter(room => normalizeFloorKey(room.floor_label) === normalizeFloorKey(activeFloor))
        .sort((a, b) => (b.order_index ?? 0) - (a.order_index ?? 0)),
    [rooms, activeFloor]
  )

  const activeRoomImages = useMemo(() => {
    if (!activeRoom?.id) return []
    return images
      .filter(image => image.origin_interior_room_id === activeRoom.id)
      .sort((a, b) => {
        const left = new Date(a.captured_at ?? a.created_at ?? 0).getTime()
        const right = new Date(b.captured_at ?? b.created_at ?? 0).getTime()
        return right - left
      })
  }, [activeRoom, images])

  const activeExteriorImages = useMemo(() => {
    if (!activeExteriorItem?.id) return []
    return images
      .filter(image => image.origin_exterior_item_id === activeExteriorItem.id)
      .sort((a, b) => {
        const left = new Date(a.captured_at ?? a.created_at ?? 0).getTime()
        const right = new Date(b.captured_at ?? b.created_at ?? 0).getTime()
        return right - left
      })
  }, [activeExteriorItem, images])

  const activeTargetLabel = useMemo(() => {
    if (area === 'interior') {
      if (!activeRoom) return 'Välj rum'
      const roomName =
        activeRoom.room_label?.trim() ||
        roomTypeLabelByKey[activeRoom.room_type_key] ||
        activeRoom.room_type_key ||
        'Rum'
      return `${floorLabelFromKey(activeRoom.floor_label)} > ${roomName}`
    }
    if (activeExteriorItem) return `Utsida > ${activeExteriorItem.label}`
    return 'Välj komponent'
  }, [area, activeRoom, activeExteriorItem, roomTypeLabelByKey])

  const activeQuickNote = useMemo(() => {
    if (area === 'interior' && activeRoom?.id) {
      return quickNotes.find(note => note.interior_room_id === activeRoom.id) ?? null
    }
    if (area === 'exterior' && activeExteriorItem?.id) {
      return quickNotes.find(note => note.exterior_item_id === activeExteriorItem.id) ?? null
    }
    return null
  }, [area, activeRoom, activeExteriorItem, quickNotes])

  const activeControlItems = useMemo(() => {
    if (area === 'interior' && activeRoom?.id) {
      return controlItems.filter(item => item.interior_room_id === activeRoom.id)
    }
    if (area === 'exterior' && activeExteriorObservation?.id) {
      return controlItems.filter(item => item.exterior_observation_id === activeExteriorObservation.id)
    }
    return []
  }, [area, activeRoom, activeExteriorObservation, controlItems])

  const groupedControlItems = useMemo(() => {
    const freeItems = activeControlItems
      .filter(item => !item.control_point_id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

    const groups = new Map<string, InspectionControlItem[]>()
    activeControlItems
      .filter((item): item is InspectionControlItem & { control_point_id: string } => !!item.control_point_id)
      .forEach(item => {
        const bucket = groups.get(item.control_point_id) ?? []
        bucket.push(item)
        groups.set(item.control_point_id, bucket)
      })

    return {
      freeItems,
      groups: Array.from(groups.entries())
        .map(([controlPointId, items]) => ({
          controlPointId,
          items: [...items].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
        }))
        .sort((a, b) => (a.items[0]?.sort_order ?? 0) - (b.items[0]?.sort_order ?? 0)),
    }
  }, [activeControlItems])

  const filteredImages = useMemo(() => {
    const activeRoomOriginId = activeRoom?.id ?? null
    const activeExteriorOriginId = activeExteriorItem?.id ?? null

    return images
      .filter(image => {
        const status = imageStatus(image)
        if (imageFilter === 'unprocessed') return status === 'unprocessed'
        if (imageFilter === 'linked') return status === 'linked'
        if (imageFilter === 'ignored') return status === 'ignored'
        if (imageFilter === 'unclassified') {
          return image.source_area === 'exterior' && !image.origin_exterior_item_id
        }
        if (imageFilter === 'active') {
          if (area === 'interior') return !!activeRoomOriginId && image.origin_interior_room_id === activeRoomOriginId
          return activeExteriorOriginId
            ? image.origin_exterior_item_id === activeExteriorOriginId
            : image.source_area === 'exterior' && !image.origin_exterior_item_id
        }
        return true
      })
      .sort((a, b) => {
        const left = new Date(a.captured_at ?? a.created_at ?? 0).getTime()
        const right = new Date(b.captured_at ?? b.created_at ?? 0).getTime()
        return right - left
      })
  }, [images, imageFilter, area, activeRoom, activeExteriorItem])

  const selectedImages = useMemo(
    () => images.filter(image => selectedImageIds.has(image.id)),
    [images, selectedImageIds]
  )
  const overlayOpen = Boolean(previewImage) || searchOpen || Boolean(freeNoteDialogId) || exteriorDialogOpen || roomDialogOpen

  const closeTopOverlay = useCallback(() => {
    if (previewImage) {
      setPreviewImage(null)
      return true
    }
    if (searchOpen) {
      setSearchOpen(false)
      setSearchTerm('')
      setSearchResults([])
      setAiSearchHasRun(false)
      return true
    }
    if (freeNoteDialogId) {
      setFreeNoteDialogId(null)
      return true
    }
    if (exteriorDialogOpen) {
      setExteriorDialogOpen(false)
      return true
    }
    if (roomDialogOpen) {
      setRoomDialogOpen(false)
      return true
    }
    return false
  }, [previewImage, searchOpen, freeNoteDialogId, exteriorDialogOpen, roomDialogOpen])

  useEffect(() => {
    if (!inspection?.id) return
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspection?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (overlayOpen && !overlayHistoryPushedRef.current) {
      window.history.pushState({ obRoundOverlay: true }, '', window.location.href)
      overlayHistoryPushedRef.current = true
    }
    if (!overlayOpen) overlayHistoryPushedRef.current = false
  }, [overlayOpen])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = () => {
      if (!overlayHistoryPushedRef.current) return
      const closed = closeTopOverlay()
      if (closed) overlayHistoryPushedRef.current = false
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [closeTopOverlay])

  useEffect(() => {
    if (typeof window === 'undefined') return
    lastScrollYRef.current = window.scrollY

    const handleScroll = () => {
      const currentY = window.scrollY
      const delta = currentY - lastScrollYRef.current
      if (Math.abs(delta) > 8) {
        setRoundNavVisible(delta < 0 || currentY < 24)
      }
      lastScrollYRef.current = currentY
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (floorOptions.length === 0) return
    const normalizedActiveFloor = normalizeFloorKey(activeFloor)
    if (!activeFloor || !floorOptions.includes(normalizedActiveFloor)) {
      setActiveFloor(floorOptions[0])
    } else if (activeFloor !== normalizedActiveFloor) {
      setActiveFloor(normalizedActiveFloor)
    }
  }, [activeFloor, floorOptions])

  useEffect(() => {
    if (activeRoomId && rooms.some(room => room.id === activeRoomId)) return
    const firstRoom = roomsForActiveFloor.find(room => room.id)
    setActiveRoomId(firstRoom?.id ?? null)
  }, [activeRoomId, rooms, roomsForActiveFloor])

  useEffect(() => {
    if (!activeRoom?.id || isInspectionLocked) return
    if (ensuredInteriorRoomIdsRef.current.has(activeRoom.id)) return
    ensuredInteriorRoomIdsRef.current.add(activeRoom.id)
    void ensureDefaultInteriorControlItems(activeRoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoom?.id])

  useEffect(() => {
    if (!activeExteriorItem?.id || isInspectionLocked) return
    if (ensuredExteriorItemIdsRef.current.has(activeExteriorItem.id)) return
    ensuredExteriorItemIdsRef.current.add(activeExteriorItem.id)
    void ensureExteriorObservationAndDefaults(activeExteriorItem)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeExteriorItem?.id])

  const loadAll = async () => {
    setLoading(true)
    setError(null)
    try {
      const [
        { data: roomTypeRows, error: roomTypesError },
        { data: roomRows, error: roomsError },
        { data: exteriorRows, error: exteriorError },
        { data: observationRows, error: observationsError },
        { data: controlRows, error: controlItemsError },
        { data: imageRows, error: imagesError },
        { data: quickNoteRows, error: quickNotesError },
      ] = await Promise.all([
        supabase
          .from('settings_interior_room_types')
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
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        supabase
          .from('inspection_exterior_observations')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('created_at', { ascending: true }),
        supabase
          .from('inspection_control_items')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('inspection_images')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('inspection_round_quick_notes')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('updated_at', { ascending: false }),
      ])

      if (roomTypesError) throw roomTypesError
      if (roomsError) throw roomsError
      if (exteriorError) throw exteriorError
      if (observationsError) throw observationsError
      if (controlItemsError) throw controlItemsError
      if (imagesError) throw imagesError
      if (quickNotesError) throw quickNotesError

      const filteredRoomTypes = ((roomTypeRows ?? []) as RoomType[]).filter(roomType => {
        const label = normalizeSwedish(roomType.label ?? '').toLowerCase()
        const key = normalizeSwedish(roomType.key ?? '').toLowerCase()
        return label !== 'rum saknas' && key !== 'rum_saknas'
      })
      const normalizedRooms = ((roomRows ?? []) as Array<InteriorRoom & { values?: unknown }>).map(room => ({
        ...room,
        values: (room.values as ValueMap) || {},
      }))
      const normalizedObservations = (
        (observationRows ?? []) as Array<InspectionExteriorObservation & { values?: unknown }>
      )
        .filter(row => !(row.is_free_note === true || (row.values as ValueMap | undefined)?._free_note === true))
        .map(row => ({ ...row, values: (row.values as ValueMap) || {} }))

      setRoomTypes(sortRoomTypesByLabel(filteredRoomTypes))
      setRooms(normalizedRooms.sort(sortRooms))
      setExteriorItems((exteriorRows ?? []) as SettingsExteriorItem[])
      setExteriorObservations(normalizedObservations)
      setControlItems(((controlRows ?? []) as InspectionControlItem[]).map(normalizeControlItem))
      setImages((imageRows ?? []) as InspectionImage[])
      setQuickNotes((quickNoteRows ?? []) as QuickNote[])

      await loadFloorsFromConditions()
      await ensureControlPointData(
        Array.from(
          new Set(
            ((controlRows ?? []) as InspectionControlItem[])
              .map(item => item.control_point_id)
              .filter((id): id is string => !!id)
          )
        )
      )

      if (!activeFloor) {
        const firstFloor = normalizedRooms[0]?.floor_label ?? 'plan1'
        setActiveFloor(normalizeFloorKey(firstFloor))
      }
      if (!activeRoomId) {
        setActiveRoomId(normalizedRooms.find(room => room.id)?.id ?? null)
      }
      if (!activeExteriorItemId && (exteriorRows ?? []).length > 0) {
        setActiveExteriorItemId(((exteriorRows ?? []) as SettingsExteriorItem[])[0]?.id ?? '')
      }
    } catch (e: unknown) {
      console.error('load OB round failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte läsa ÖB-rundan.')
    } finally {
      setLoading(false)
    }
  }

  const loadFloorsFromConditions = async () => {
    try {
      const { data: buildingItem, error: buildingItemError } = await supabase
        .from('settings_overview_items')
        .select('id, key')
        .eq('key', 'building_type')
        .eq('is_active', true)
        .maybeSingle()

      if (buildingItemError) throw buildingItemError
      if (!buildingItem) {
        setDerivedFloors([])
        return
      }

      const { data: selectionRows, error: selectionError } = await supabase
        .from('inspection_overview_selections')
        .select('values')
        .eq('inspection_id', inspection.id)
        .eq('overview_item_id', buildingItem.id)
        .order('set_index', { ascending: true })

      if (selectionError) throw selectionError
      const answers = (selectionRows?.[0]?.values as ValueMap) || {}
      setDerivedFloors(buildFloorsFromAnswers(answers))
    } catch (e) {
      console.warn('Kunde inte läsa våningsinfo för ÖB-runda:', e)
      setDerivedFloors([])
    }
  }

  const normalizeControlItem = (item: InspectionControlItem): InspectionControlItem => ({
    ...item,
    selected_outcome_id: item.selected_outcome_id ?? null,
    risk_text: item.risk_text ?? null,
    ftu_text: item.ftu_text ?? null,
  })

  const ensureControlPointData = async (controlPointIds: string[]) => {
    const missingIds = Array.from(
      new Set(controlPointIds.filter(id => id && !outcomesByControlPointId[id]))
    )
    if (missingIds.length === 0) return

    try {
      const [{ data: outcomeRows, error: outcomesError }, { data: metaRows, error: metaError }] =
        await Promise.all([
          supabase
            .from('settings_control_point_outcomes')
            .select(
              'id, control_point_id, label, severity, note_template, risk_template, ftu_template, sort_order, is_active'
            )
            .in('control_point_id', missingIds)
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('settings_control_points')
            .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
            .in('id', missingIds)
            .eq('is_active', true),
        ])

      if (outcomesError) throw outcomesError
      if (metaError) throw metaError

      const nextOutcomes: Record<string, ControlPointOutcome[]> = {}
      for (const outcome of (outcomeRows ?? []) as ControlPointOutcome[]) {
        nextOutcomes[outcome.control_point_id] = nextOutcomes[outcome.control_point_id] || []
        nextOutcomes[outcome.control_point_id].push(outcome)
      }

      const nextMeta: Record<string, ControlPointLite> = {}
      for (const meta of (metaRows ?? []) as ControlPointLite[]) nextMeta[meta.id] = meta

      setOutcomesByControlPointId(prev => ({ ...prev, ...nextOutcomes }))
      setControlPointMetaById(prev => ({ ...prev, ...nextMeta }))
    } catch (e) {
      console.error('ensure control point data failed:', e)
    }
  }

  const upsertRoom = async (room: InteriorRoom): Promise<InteriorRoom | null> => {
    if (isInspectionLocked) return null
    setSaving(true)
    setError(null)
    try {
      const { data, error: upsertError } = room.id
        ? await supabase
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
        : await supabase
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

      if (upsertError) throw upsertError
      const saved = data as InteriorRoom & { values?: unknown }
      return { ...saved, values: (saved.values as ValueMap) || {} }
    } catch (e: unknown) {
      console.error('upsert room in OB round failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara rummet.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const addRoom = async () => {
    if (isInspectionLocked) return
    if (!newRoomTypeKey || !activeFloor) {
      setError('Välj plan och rumstyp.')
      return
    }

    const floor = normalizeFloorKey(activeFloor)
    const roomLabel = newRoomLabel.trim() || getSuggestedRoomLabel(newRoomTypeKey, floor)
    const maxOrder = rooms
      .filter(room => normalizeFloorKey(room.floor_label) === floor)
      .reduce((max, room) => Math.max(max, room.order_index ?? 0), 0)

    const saved = await upsertRoom({
      inspection_id: inspection.id,
      floor_label: floor,
      order_index: maxOrder + 10,
      room_type_key: newRoomTypeKey,
      room_label: roomLabel,
      values: {},
      note: null,
    })

    if (!saved?.id) return
    setRooms(prev => [...prev, saved].sort(sortRooms))
    setActiveRoomId(saved.id)
    setNewRoomLabel('')
    await ensureDefaultInteriorControlItems(saved)
  }

  const ensureDefaultInteriorControlItems = async (room: InteriorRoom) => {
    if (isInspectionLocked || !room.id) return
    try {
      const { data: cpRows, error: cpError } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
        .eq('scope', 'interior')
        .eq('is_active', true)

      if (cpError) throw cpError
      const roomControlPoints = ((cpRows ?? []) as ControlPointLite[]).filter(
        cp => controlPointAppliesToInspectionSide(cp, inspectionSide) && controlPointMatchesRoom(cp, room.room_type_key)
      )
      if (roomControlPoints.length === 0) return

      const { data: existingRows, error: existingError } = await supabase
        .from('inspection_control_items')
        .select('id, control_point_id, sort_order')
        .eq('interior_room_id', room.id)

      if (existingError) throw existingError
      const existing = (existingRows ?? []) as Array<Pick<InspectionControlItem, 'control_point_id' | 'sort_order'>>
      const existingControlPointIds = new Set(
        existing.map(item => item.control_point_id).filter((id): id is string => !!id)
      )
      let sortBase = existing.length > 0 ? Math.max(...existing.map(item => item.sort_order || 0)) : 0
      const payload = roomControlPoints
        .filter(cp => !existingControlPointIds.has(cp.id))
        .map(cp => {
          sortBase += 10
          return {
            inspection_id: inspection.id,
            interior_room_id: room.id,
            exterior_observation_id: null,
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

      if (payload.length > 0) {
        const { error: insertError } = await supabase.from('inspection_control_items').insert(payload)
        if (insertError && !isPgUniqueViolation(insertError)) throw insertError
      }

      await refreshControlItems()
      await ensureControlPointData(roomControlPoints.map(cp => cp.id))
    } catch (e) {
      console.error('ensure default interior control items failed:', e)
    }
  }

  const ensureExteriorObservationAndDefaults = async (
    item: SettingsExteriorItem
  ): Promise<InspectionExteriorObservation | null> => {
    const existing = exteriorObservations.find(obs => obs.exterior_item_id === item.id)
    if (existing?.id) return existing
    if (isInspectionLocked) return null

    try {
      const { data, error: insertError } = await supabase
        .from('inspection_exterior_observations')
        .insert({
          inspection_id: inspection.id,
          exterior_item_id: item.id,
          part_label: null,
          values: {},
          note: null,
          is_free_note: false,
        })
        .select('*')
        .single()

      if (insertError) {
        if (isPgUniqueViolation(insertError)) {
          const { data: existingAfterConflict, error: fetchError } = await supabase
            .from('inspection_exterior_observations')
            .select('*')
            .eq('inspection_id', inspection.id)
            .eq('exterior_item_id', item.id)
            .limit(1)
            .maybeSingle()
          if (fetchError) throw fetchError
          if (existingAfterConflict) {
            const normalized = {
              ...(existingAfterConflict as InspectionExteriorObservation),
              values: ((existingAfterConflict as InspectionExteriorObservation).values as ValueMap) || {},
            }
            setExteriorObservations(prev => [...prev.filter(obs => obs.id !== normalized.id), normalized])
            await ensureDefaultExteriorControlItems(item, normalized)
            return normalized
          }
        }
        throw insertError
      }

      const saved = {
        ...(data as InspectionExteriorObservation),
        values: ((data as InspectionExteriorObservation).values as ValueMap) || {},
      }
      setExteriorObservations(prev => [...prev, saved])
      await ensureDefaultExteriorControlItems(item, saved)
      return saved
    } catch (e) {
      console.error('ensure exterior observation failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte skapa utsideskomponent för rundan.')
      return null
    }
  }

  const ensureDefaultExteriorControlItems = async (
    item: SettingsExteriorItem,
    observation: InspectionExteriorObservation
  ) => {
    if (!observation.id || isInspectionLocked) return
    try {
      const { data: cpRows, error: cpError } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
        .eq('scope', 'exterior')
        .eq('is_active', true)
        .eq('exterior_item_key', item.key)

      if (cpError) throw cpError
      const controlPoints = (cpRows ?? []) as ControlPointLite[]
      if (controlPoints.length === 0) return

      const { data: existingRows, error: existingError } = await supabase
        .from('inspection_control_items')
        .select('id, control_point_id, sort_order')
        .eq('exterior_observation_id', observation.id)

      if (existingError) throw existingError
      const existing = (existingRows ?? []) as Array<Pick<InspectionControlItem, 'control_point_id' | 'sort_order'>>
      const existingControlPointIds = new Set(
        existing.map(row => row.control_point_id).filter((id): id is string => !!id)
      )
      let sortBase = existing.length > 0 ? Math.max(...existing.map(row => row.sort_order || 0)) : 0
      const payload = controlPoints
        .filter(cp => !existingControlPointIds.has(cp.id))
        .map(cp => {
          sortBase += 10
          return {
            inspection_id: inspection.id,
            interior_room_id: null,
            exterior_observation_id: observation.id,
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

      if (payload.length > 0) {
        const { error: insertError } = await supabase.from('inspection_control_items').insert(payload)
        if (insertError && !isPgUniqueViolation(insertError)) throw insertError
      }

      await refreshControlItems()
      await ensureControlPointData(controlPoints.map(cp => cp.id))
    } catch (e) {
      console.error('ensure default exterior control items failed:', e)
    }
  }

  const refreshControlItems = async () => {
    const { data, error: refreshError } = await supabase
      .from('inspection_control_items')
      .select('*')
      .eq('inspection_id', inspection.id)
      .order('sort_order', { ascending: true })
    if (refreshError) throw refreshError
    const rows = ((data ?? []) as InspectionControlItem[]).map(normalizeControlItem)
    setControlItems(rows)
    await ensureControlPointData(
      Array.from(new Set(rows.map(row => row.control_point_id).filter((id): id is string => !!id)))
    )
  }

  const upsertControlItem = async (
    item: InspectionControlItem
  ): Promise<InspectionControlItem | null> => {
    if (isInspectionLocked) return null
    setSaving(true)
    setError(null)
    try {
      const payload = {
        title: item.title,
        status: item.status,
        note: item.note,
        risk_text: item.risk_text ?? null,
        ftu_text: item.ftu_text ?? null,
        sort_order: item.sort_order,
        selected_outcome_id: item.selected_outcome_id ?? null,
      }
      const { data, error: upsertError } = item.id
        ? await supabase
            .from('inspection_control_items')
            .update(payload)
            .eq('id', item.id)
            .select('*')
            .single()
        : await supabase
            .from('inspection_control_items')
            .insert({
              inspection_id: item.inspection_id,
              interior_room_id: item.interior_room_id,
              exterior_observation_id: item.exterior_observation_id,
              control_point_id: item.control_point_id,
              ...payload,
            })
            .select('*')
            .single()

      if (upsertError) throw upsertError
      const saved = normalizeControlItem(data as InspectionControlItem)
      setControlItems(prev => {
        const exists = prev.some(row => row.id === saved.id)
        return exists
          ? prev.map(row => (row.id === saved.id ? saved : row))
          : [...prev, saved].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      })
      if (saved.control_point_id) await ensureControlPointData([saved.control_point_id])
      return saved
    } catch (e: unknown) {
      console.error('upsert control item in OB round failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara kontrollpunkten.')
      return null
    } finally {
      setSaving(false)
    }
  }

  const updateControlItem = async (itemId: string, patch: Partial<InspectionControlItem>) => {
    const current = controlItems.find(item => item.id === itemId)
    if (!current) return
    const optimistic = { ...current, ...patch }
    setControlItems(prev => prev.map(item => (item.id === itemId ? optimistic : item)))
    const saved = await upsertControlItem(optimistic)
    if (saved) setControlItems(prev => prev.map(item => (item.id === itemId ? saved : item)))
  }

  const deleteControlItem = async (itemId: string, skipConfirm = false) => {
    if (isInspectionLocked) return
    if (!skipConfirm && !confirm('Ta bort denna notering/kontrollpunkt?')) return
    const { error: deleteError } = await supabase.from('inspection_control_items').delete().eq('id', itemId)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setControlItems(prev => prev.filter(item => item.id !== itemId))
    if (selectedControlItemId === itemId) setSelectedControlItemId(null)
    if (freeNoteDialogId === itemId) setFreeNoteDialogId(null)
    setImages(prev =>
      prev.map(image =>
        image.control_item_id === itemId
          ? { ...image, control_item_id: null, processing_status: 'unprocessed' }
          : image
      )
    )
  }

  const deleteRoom = async () => {
    if (isInspectionLocked || !activeRoom?.id) return
    if (!confirm('Ta bort rummet från besiktningen?')) return
    const roomId = activeRoom.id
    const { error: deleteError } = await supabase
      .from('inspection_interior_rooms')
      .delete()
      .eq('id', roomId)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setRooms(prev => prev.filter(room => room.id !== roomId))
    setControlItems(prev => prev.filter(item => item.interior_room_id !== roomId))
    setImages(prev =>
      prev.map(image =>
        image.origin_interior_room_id === roomId || image.interior_room_id === roomId
          ? { ...image, origin_interior_room_id: null, interior_room_id: null }
          : image
      )
    )
    setActiveRoomId(null)
    setRoomDialogOpen(false)
  }

  const addOutcomeControlItem = async (
    baseItem: InspectionControlItem,
    outcome: ControlPointOutcome
  ) => {
    if (!baseItem.control_point_id) return
    const siblings = controlItems.filter(
      item =>
        item.control_point_id === baseItem.control_point_id &&
        item.interior_room_id === baseItem.interior_room_id &&
        item.exterior_observation_id === baseItem.exterior_observation_id
    )
    const sortOrder = siblings.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0) + 10
    await upsertControlItem({
      inspection_id: inspection.id,
      interior_room_id: baseItem.interior_room_id,
      exterior_observation_id: baseItem.exterior_observation_id,
      control_point_id: baseItem.control_point_id,
      title: baseItem.title,
      status: 'remark',
      note: (outcome.note_template ?? '').trim() || null,
      risk_text: (outcome.risk_template ?? '').trim() || null,
      ftu_text: (outcome.ftu_template ?? '').trim() || null,
      sort_order: sortOrder,
      selected_outcome_id: outcome.id,
    })
  }

  const addControlPointFromCatalog = async (controlPoint: ControlPointLite) => {
    if (isInspectionLocked) return
    let interiorRoomId: string | null = null
    let exteriorObservationId: string | null = null

    if (area === 'interior') {
      if (!activeRoom?.id) {
        setError('Välj rum först.')
        return
      }
      interiorRoomId = activeRoom.id
    } else {
      if (!activeExteriorItem) {
        setError('Välj komponent först.')
        return
      }
      const observation = await ensureExteriorObservationAndDefaults(activeExteriorItem)
      if (!observation?.id) return
      exteriorObservationId = observation.id
    }

    const alreadyExists = controlItems.some(
      item =>
        item.control_point_id === controlPoint.id &&
        item.interior_room_id === interiorRoomId &&
        item.exterior_observation_id === exteriorObservationId
    )
    if (alreadyExists) {
      setSearchOpen(false)
      await ensureControlPointData([controlPoint.id])
      return
    }

    const siblings = controlItems.filter(
      item => item.interior_room_id === interiorRoomId && item.exterior_observation_id === exteriorObservationId
    )
    const sortOrder = siblings.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0) + 10

    await upsertControlItem({
      inspection_id: inspection.id,
      interior_room_id: interiorRoomId,
      exterior_observation_id: exteriorObservationId,
      control_point_id: controlPoint.id,
      title: controlPoint.title || controlPoint.label || controlPoint.key,
      status: RED_STATUS,
      note: null,
      risk_text: null,
      ftu_text: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    })
    setSearchOpen(false)
    setSearchTerm('')
    setSearchResults([])
  }

  const createFreeNote = async (note = ''): Promise<InspectionControlItem | null> => {
    if (isInspectionLocked) return null
    let interiorRoomId: string | null = null
    let exteriorObservationId: string | null = null

    if (area === 'interior') {
      if (!activeRoom?.id) {
        setError('Välj rum först.')
        return null
      }
      interiorRoomId = activeRoom.id
    } else {
      if (!activeExteriorItem) {
        setError('Välj komponent först.')
        return null
      }
      const observation = await ensureExteriorObservationAndDefaults(activeExteriorItem)
      if (!observation?.id) return null
      exteriorObservationId = observation.id
    }

    const siblings = controlItems.filter(
      item => item.interior_room_id === interiorRoomId && item.exterior_observation_id === exteriorObservationId
    )
    const sortOrder = siblings.reduce((max, item) => Math.max(max, item.sort_order ?? 0), 0) + 10
    const saved = await upsertControlItem({
      inspection_id: inspection.id,
      interior_room_id: interiorRoomId,
      exterior_observation_id: exteriorObservationId,
      control_point_id: null,
      title: 'Fri notering',
      status: RED_STATUS,
      note,
      risk_text: null,
      ftu_text: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    })
    if (saved?.id) setSelectedControlItemId(saved.id)
    return saved
  }

  const createAndOpenFreeNote = async () => {
    const note = await createFreeNote('')
    if (note?.id) setFreeNoteDialogId(note.id)
  }

  const saveQuickNote = async (value: string) => {
    if (isInspectionLocked) return
    if (area === 'exterior' && !activeExteriorItem) return
    if (area === 'interior' && !activeRoom?.id) return

    const existing = activeQuickNote
    const payload = {
      inspection_id: inspection.id,
      source_area: area,
      interior_room_id: area === 'interior' ? activeRoom?.id ?? null : null,
      exterior_item_id: area === 'exterior' ? activeExteriorItem?.id ?? null : null,
      exterior_observation_id: area === 'exterior' ? activeExteriorObservation?.id ?? null : null,
      note: value,
    }

    try {
      const { data, error: quickNoteError } = existing?.id
        ? await supabase
            .from('inspection_round_quick_notes')
            .update({
              note: value,
              exterior_observation_id: payload.exterior_observation_id,
            })
            .eq('id', existing.id)
            .select('*')
            .single()
        : await supabase
            .from('inspection_round_quick_notes')
            .insert(payload)
            .select('*')
            .single()

      if (quickNoteError) throw quickNoteError
      const saved = data as QuickNote
      setQuickNotes(prev => {
        const exists = prev.some(note => note.id === saved.id)
        return exists ? prev.map(note => (note.id === saved.id ? saved : note)) : [saved, ...prev]
      })
    } catch (e: unknown) {
      console.error('save quick note failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara snabbanteckningen.')
    }
  }

  const uploadFiles = async (files: FileList | File[], linkToControlItemId: string | null = null) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0 || isInspectionLocked) return
    for (const file of fileArray) {
      await uploadImage(file, file.name, linkToControlItemId)
    }
  }

  const openCameraCapture = (linkToControlItemId: string | null = null) => {
    pendingImageControlItemIdRef.current = linkToControlItemId
    cameraInputRef.current?.click()
  }

  const openGalleryPicker = (linkToControlItemId: string | null = null) => {
    pendingImageControlItemIdRef.current = linkToControlItemId
    galleryInputRef.current?.click()
  }

  const uploadImage = async (blob: Blob, originalName?: string, linkToControlItemId: string | null = null) => {
    if (isInspectionLocked) return
    setUploading(true)
    setError(null)
    setMessage(null)
    try {
      const capturedAt = new Date().toISOString()
      const datePart = capturedAt.slice(0, 10)
      const ext = originalName?.split('.').pop()?.toLowerCase() || 'jpg'
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const path = `${inspection.id}/round/${datePart}/${fileName}`

      const { error: uploadError } = await supabase.storage.from(IMAGE_BUCKET).upload(path, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType: blob.type || 'image/jpeg',
      })
      if (uploadError) throw uploadError

      const origin = await getCaptureOrigin()
      const maxSort = images.reduce((max, image) => Math.max(max, image.sort_order ?? 0), 0)
      const linkedControlItem = linkToControlItemId
        ? controlItems.find(item => item.id === linkToControlItemId) ?? null
        : null

      const { data, error: insertError } = await supabase
        .from('inspection_images')
        .insert({
          inspection_id: inspection.id,
          interior_room_id: linkedControlItem?.interior_room_id ?? null,
          exterior_observation_id: linkedControlItem?.exterior_observation_id ?? null,
          control_item_id: linkedControlItem?.id ?? null,
          file_path: path,
          label: null,
          sort_order: maxSort + 10,
          capture_source: 'ob_round',
          source_area: area,
          origin_interior_room_id: origin.origin_interior_room_id,
          origin_exterior_observation_id: origin.origin_exterior_observation_id,
          origin_exterior_item_id: origin.origin_exterior_item_id,
          origin_floor_label: origin.origin_floor_label,
          origin_room_label: origin.origin_room_label,
          origin_room_type_key: origin.origin_room_type_key,
          origin_exterior_item_key: origin.origin_exterior_item_key,
          captured_at: capturedAt,
          processing_status: linkedControlItem ? 'linked' : 'unprocessed',
        })
        .select('*')
        .single()

      if (insertError) throw insertError
      const saved = data as InspectionImage
      setImages(prev => [saved, ...prev])
      setMessage(linkedControlItem ? 'Bild sparad och kopplad.' : 'Bild sparad.')
    } catch (e: unknown) {
      console.error('upload OB round image failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara bilden.')
    } finally {
      setUploading(false)
    }
  }

  const getCaptureOrigin = async () => {
    if (area === 'interior') {
      if (!activeRoom?.id) throw new Error('Välj rum innan du fotograferar.')
      return {
        origin_interior_room_id: activeRoom.id,
        origin_exterior_observation_id: null,
        origin_exterior_item_id: null,
        origin_floor_label: activeRoom.floor_label,
        origin_room_label: activeRoom.room_label,
        origin_room_type_key: activeRoom.room_type_key,
        origin_exterior_item_key: null,
      }
    }

    if (!activeExteriorItem) {
      return {
        origin_interior_room_id: null,
        origin_exterior_observation_id: null,
        origin_exterior_item_id: null,
        origin_floor_label: null,
        origin_room_label: null,
        origin_room_type_key: null,
        origin_exterior_item_key: null,
      }
    }

    const observation = await ensureExteriorObservationAndDefaults(activeExteriorItem)
    return {
      origin_interior_room_id: null,
      origin_exterior_observation_id: observation?.id ?? null,
      origin_exterior_item_id: activeExteriorItem.id,
      origin_floor_label: null,
      origin_room_label: null,
      origin_room_type_key: null,
      origin_exterior_item_key: activeExteriorItem.key,
    }
  }

  const linkSelectedImagesToControlItem = async (controlItemId = selectedControlItemId) => {
    if (isInspectionLocked) return
    if (!controlItemId) {
      setError('Välj en notering att koppla bilderna till.')
      return
    }
    if (selectedImages.length === 0) {
      setError('Välj minst en bild.')
      return
    }
    const controlItem = controlItems.find(item => item.id === controlItemId)
    if (!controlItem?.id) return
    const alreadyLinkedElsewhere = selectedImages.find(
      image => image.control_item_id && image.control_item_id !== controlItem.id
    )
    if (alreadyLinkedElsewhere) {
      setError('En vald bild är redan kopplad till en annan notering.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      const imageIds = selectedImages.map(image => image.id)
      const { data, error: updateError } = await supabase
        .from('inspection_images')
        .update({
          control_item_id: controlItem.id,
          interior_room_id: controlItem.interior_room_id,
          exterior_observation_id: controlItem.exterior_observation_id,
          processing_status: 'linked',
          ignored_at: null,
        })
        .in('id', imageIds)
        .select('*')

      if (updateError) throw updateError
      const updated = (data ?? []) as InspectionImage[]
      setImages(prev => prev.map(image => updated.find(row => row.id === image.id) ?? image))
      setSelectedImageIds(new Set())
      setMessage(`${updated.length} bild${updated.length === 1 ? '' : 'er'} kopplad${updated.length === 1 ? '' : 'e'}.`)
    } catch (e: unknown) {
      console.error('link images failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte koppla bilder.')
    } finally {
      setSaving(false)
    }
  }

  const createFreeNoteFromSelectedImages = async () => {
    if (selectedImages.length === 0) {
      setError('Välj minst en bild.')
      return
    }
    const note = await createFreeNote('')
    if (note?.id) await linkSelectedImagesToControlItem(note.id)
  }

  const ignoreSelectedImages = async () => {
    if (selectedImages.length === 0 || isInspectionLocked) return
    if (selectedImages.some(image => image.control_item_id)) {
      setError('Kopplade bilder kan inte ignoreras. Radera bilden om den inte ska användas.')
      return
    }
    const imageIds = selectedImages.map(image => image.id)
    const ignoredAt = new Date().toISOString()
    const { data, error: updateError } = await supabase
      .from('inspection_images')
      .update({ processing_status: 'ignored', ignored_at: ignoredAt })
      .in('id', imageIds)
      .select('*')
    if (updateError) {
      setError(updateError.message)
      return
    }
    const updated = (data ?? []) as InspectionImage[]
    setImages(prev => prev.map(image => updated.find(row => row.id === image.id) ?? image))
    setSelectedImageIds(new Set())
  }

  const deleteSelectedImages = async () => {
    if (selectedImages.length === 0 || isInspectionLocked) return
    if (!confirm(`Radera ${selectedImages.length} bild${selectedImages.length === 1 ? '' : 'er'}?`)) return
    const paths = selectedImages.map(image => image.file_path).filter(Boolean)
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage.from(IMAGE_BUCKET).remove(paths)
      if (storageError) console.error('delete round images from storage failed:', storageError)
    }
    const imageIds = selectedImages.map(image => image.id)
    const { error: deleteError } = await supabase.from('inspection_images').delete().in('id', imageIds)
    if (deleteError) {
      setError(deleteError.message)
      return
    }
    setImages(prev => prev.filter(image => !imageIds.includes(image.id)))
    setSelectedImageIds(new Set())
  }

  const openSearch = () => {
    setSearchOpen(true)
    setSearchMode('control_points')
    setSearchTerm('')
    setSearchResults([])
    setAiSearchHasRun(false)
  }

  const handleSearchModeChange = (mode: ControlPointSearchMode) => {
    if (mode === searchMode) return
    setSearchMode(mode)
    setSearchTerm('')
    setSearchResults([])
    setAiSearchHasRun(false)
  }

  const handleSearchChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const term = event.target.value
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
        const { data, error: searchError } = await supabase
          .from('settings_control_points')
          .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
          .eq('is_active', true)
          .or(`title.ilike.${like},label.ilike.${like},key.ilike.${like},description.ilike.${like}`)
        if (searchError) throw searchError
        setSearchResults(filterSearchResults((data ?? []) as ControlPointLite[]))
        return
      }

      const { data: outcomeRows, error: outcomesError } = await supabase
        .from('settings_control_point_outcomes')
        .select('control_point_id, label, note_template, risk_template, ftu_template')
        .eq('is_active', true)
        .or(`label.ilike.${like},note_template.ilike.${like},risk_template.ilike.${like},ftu_template.ilike.${like}`)
      if (outcomesError) throw outcomesError

      const controlPointIds = Array.from(
        new Set(
          ((outcomeRows ?? []) as Array<{ control_point_id: string | null }>)
            .map(row => row.control_point_id)
            .filter((id): id is string => !!id)
        )
      )
      if (controlPointIds.length === 0) {
        setSearchResults([])
        return
      }

      const { data, error: cpError } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, scope, exterior_item_key, tags, trigger_room_types, applies_to')
        .eq('is_active', true)
        .in('id', controlPointIds)
      if (cpError) throw cpError
      const outcomes = (outcomeRows ?? []) as Array<{ control_point_id: string | null; label: string | null }>
      const outcomeLabelsByControlPointId = outcomes.reduce<Record<string, string[]>>((acc, outcome) => {
        const controlPointId = outcome.control_point_id
        const label = (outcome.label ?? '').trim()
        if (!controlPointId || !label) return acc
        const current = acc[controlPointId] || []
        if (!current.includes(label)) current.push(label)
        acc[controlPointId] = current
        return acc
      }, {})
      setSearchResults(
        filterSearchResults((data ?? []) as ControlPointLite[]).map(cp => {
          const outcomeLabels = outcomeLabelsByControlPointId[cp.id] || []
          return {
            ...cp,
            search_hint:
              outcomeLabels.length > 0
                ? `Chipträff: ${outcomeLabels.slice(0, 3).join(', ')}`
                : 'Chipträff',
          }
        })
      )
    } catch (e) {
      console.error('search OB round control points failed:', e)
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleAiSearch = async () => {
    const trimmed = searchTerm.trim()
    if (trimmed.length < 2 || isInspectionLocked || area !== 'interior') return

    setSearching(true)
    setAiSearchHasRun(false)
    try {
      const response = await fetch('/api/ai/search-control-points/interior', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, limit: 10 }),
      })

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string }
        console.error('AI control point search failed:', payload.error ?? response.statusText)
        setSearchResults([])
        return
      }

      const payload = await response.json() as { results?: ControlPointLite[] }
      setSearchResults(filterSearchResults(payload.results ?? []))
    } catch (e) {
      console.error('AI control point search failed:', e)
      setSearchResults([])
    } finally {
      setAiSearchHasRun(true)
      setSearching(false)
    }
  }

  const filterSearchResults = (results: ControlPointLite[]) =>
    results.filter(cp => {
      if (area === 'interior') {
        return (
          cp.scope === 'interior' &&
          !!activeRoom &&
          controlPointAppliesToInspectionSide(cp, inspectionSide)
        )
      }
      if (!activeExteriorItem) return cp.scope === 'exterior'
      return cp.scope === 'exterior' && cp.exterior_item_key === activeExteriorItem.key
    })

  const toggleImageSelection = (imageId: string) => {
    setSelectedImageIds(prev => {
      const next = new Set(prev)
      if (next.has(imageId)) next.delete(imageId)
      else next.add(imageId)
      return next
    })
  }

  const clearNotice = () => {
    setError(null)
    setMessage(null)
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-white/50 bg-white/95 p-4 text-sm text-gray-700 shadow-xl">
        Läser ÖB-runda...
      </div>
    )
  }

  return (
    <div className="-m-2 min-h-[calc(100vh-10rem)] space-y-4 bg-white p-2 md:-m-4 md:p-4">
      {isInspectionLocked ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Besiktningen är låst. ÖB-rundan kan läsas men inte ändras.
        </div>
      ) : null}

      {(error || message) ? (
        <div
          className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2 text-xs ${
            error ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'
          }`}
        >
          <span>{error ?? message}</span>
          <button type="button" onClick={clearNotice} aria-label="Stäng" className="text-current">
            <X size={14} />
          </button>
        </div>
      ) : null}

      {renderRoundSurface()}
      {roomDialogOpen && activeRoom ? renderRoomDialog() : null}
      {exteriorDialogOpen && activeExteriorItem ? renderExteriorDialog() : null}
      {freeNoteDialogId ? renderFreeNoteDialog() : null}
      {previewImage ? renderImagePreviewDialog() : null}

      <ControlPointSearchDialog
        open={searchOpen}
        title="Lägg till kontrollpunkt"
        contextLabel={activeTargetLabel}
        searchMode={searchMode}
        searchTerm={searchTerm}
        searchResults={searchResults}
        searching={searching}
        disabled={isInspectionLocked}
        controlPointPlaceholder="Sök kontrollpunkt..."
        chipPlaceholder="Sök chip eller malltext..."
        aiPlaceholder="Beskriv vad du ser, t.ex. plåt som släppt på insidan..."
        showAiMode={area === 'interior'}
        aiSearchHasRun={aiSearchHasRun}
        scopeLabelForResult={(result) =>
          result.scope === 'exterior' ? `Utsida${result.exterior_item_key ? ` · ${result.exterior_item_key}` : ''}` : 'Insida'
        }
        onSearchModeChange={handleSearchModeChange}
        onSearchChange={handleSearchChange}
        onRunAiSearch={handleAiSearch}
        onSelect={result => void addControlPointFromCatalog(result)}
        onClose={() => {
          setSearchOpen(false)
          setSearchTerm('')
          setSearchResults([])
          setAiSearchHasRun(false)
        }}
      />

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={event => {
          const files = event.target.files
          const targetControlItemId = pendingImageControlItemIdRef.current
          pendingImageControlItemIdRef.current = null
          if (files) void uploadFiles(files, targetControlItemId)
          event.currentTarget.value = ''
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={event => {
          const files = event.target.files
          const targetControlItemId = pendingImageControlItemIdRef.current
          pendingImageControlItemIdRef.current = null
          if (files) void uploadFiles(files, targetControlItemId)
          event.currentTarget.value = ''
        }}
      />
    </div>
  )

  function primaryButtonClass(extra = '') {
    return `inline-flex items-center justify-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-900 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 ${extra}`
  }

  function activeTileClass(isActive: boolean) {
    return isActive
      ? 'border-sky-300 bg-sky-50 text-sky-950 ring-1 ring-sky-200'
      : 'border-slate-200 bg-white text-slate-900 hover:bg-sky-50/60'
  }

  function renderRoundSurface() {
    return (
      <section className="space-y-4">
        <div
          className={`sticky top-3 z-30 transition-all duration-200 ${
            roundNavVisible
              ? 'translate-y-0 opacity-100'
              : 'pointer-events-none -translate-y-[calc(100%+1rem)] opacity-0'
          }`}
        >
          <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-3 shadow-lg ring-1 ring-white/80 backdrop-blur md:p-4">
            {renderAreaTabs()}
            <div className="mt-3">
              {area === 'interior' ? renderFloorTabs() : null}
            </div>
          </div>
        </div>

        {area === 'interior' ? renderRoomListBox() : renderExteriorPicker()}

      </section>
    )
  }

  function renderAreaTabs() {
    return (
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setArea('interior')}
          className={`rounded-xl border px-3 py-3 text-sm font-semibold ${activeTileClass(area === 'interior')}`}
        >
          Insida
        </button>
        <button
          type="button"
          onClick={() => setArea('exterior')}
          className={`rounded-xl border px-3 py-3 text-sm font-semibold ${activeTileClass(area === 'exterior')}`}
        >
          Utsida
        </button>
      </div>
    )
  }

  function renderFloorTabs() {
    return (
      <div className="flex gap-2 overflow-x-auto pb-1">
        {floorOptions.map(floor => (
          <button
            key={floor}
            type="button"
            onClick={() => setActiveFloor(floor)}
            className={`shrink-0 rounded-full border px-3 py-2 text-sm font-semibold ${activeTileClass(
              normalizeFloorKey(activeFloor) === normalizeFloorKey(floor)
            )}`}
          >
            {floorLabelFromKey(floor)}
          </button>
        ))}
      </div>
    )
  }

  function renderRoomListBox() {
    return (
      <div className="space-y-3 rounded-2xl border-2 border-sky-200 bg-white p-3 shadow-lg ring-1 ring-sky-100 md:p-4">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <div className="rounded-xl border border-sky-300 bg-sky-50/70 p-2.5 shadow-sm">
            <div className="space-y-2">
              <select
                value={newRoomTypeKey}
                onChange={event => {
                  const nextRoomTypeKey = event.target.value
                  setNewRoomTypeKey(nextRoomTypeKey)
                  setNewRoomLabel(nextRoomTypeKey ? getSuggestedRoomLabel(nextRoomTypeKey) : '')
                }}
                className="w-full rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm text-gray-900"
                disabled={isInspectionLocked}
              >
                <option value="">Rumstyp</option>
                {roomTypes.map(type => (
                  <option key={type.id} value={type.key}>
                    {type.label}
                  </option>
                ))}
              </select>
              <input
                value={newRoomLabel}
                onChange={event => setNewRoomLabel(event.target.value)}
                placeholder="Rumsnamn"
                className="w-full rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-sm text-gray-900"
                disabled={isInspectionLocked}
              />
              <button
                type="button"
                onClick={() => void addRoom()}
                disabled={isInspectionLocked || saving}
                className={primaryButtonClass('min-h-10 w-full')}
              >
                <Plus size={16} />
                Lägg till rum
              </button>
            </div>
          </div>
          {roomsForActiveFloor.map(room => (
            <button
              key={room.id}
              type="button"
              onClick={() => {
                setActiveRoomId(room.id ?? null)
                setRoomDialogOpen(true)
              }}
              className={`min-h-[58px] rounded-xl border-2 px-3 py-2 text-left text-base shadow-sm ${activeTileClass(activeRoomId === room.id)}`}
            >
              <div className="text-base font-semibold leading-snug">{getRoomDisplayName(room)}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  function renderExteriorPicker() {
    return (
      <div className="grid gap-2 rounded-2xl border border-sky-200 bg-white p-3 shadow-lg ring-1 ring-sky-100 sm:grid-cols-2 md:p-4 lg:grid-cols-3">
        {exteriorItems.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              setActiveExteriorItemId(item.id)
              setExteriorDialogOpen(true)
            }}
            className={`min-h-[58px] rounded-xl border-2 px-3 py-2 text-left text-base font-semibold shadow-sm ${activeTileClass(
              activeExteriorItemId === item.id
            )}`}
          >
            {item.label}
          </button>
        ))}
      </div>
    )
  }

  function renderQuickNote() {
    if (area === 'interior' && !activeRoom) return null
    if (area === 'exterior' && !activeExteriorItem) return null
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Intern snabbanteckning
        </label>
        <DebouncedTextarea
          rows={3}
          value={activeQuickNote?.note ?? ''}
          onSave={value => void saveQuickNote(value)}
          readOnly={isInspectionLocked}
          placeholder="Endast internt stöd, syns inte i rapporten."
          className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
        />
      </div>
    )
  }

  function renderRoomDialog() {
    return (
      <div className="fixed inset-0 z-[80] bg-white md:bg-black/35" role="dialog" aria-modal="true">
        <div className="flex h-full flex-col bg-white md:mx-auto md:my-4 md:h-[calc(100%-2rem)] md:max-w-4xl md:rounded-2xl md:shadow-2xl">
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {activeRoom ? floorLabelFromKey(activeRoom.floor_label) : 'Rum'}
                </div>
                <h2 className="text-lg font-semibold text-gray-950">{getRoomDisplayName(activeRoom)}</h2>
              </div>
              <button
                type="button"
                onClick={() => setRoomDialogOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700"
                aria-label="Stäng rum"
                title="Stäng rum"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={openSearch}
                disabled={isInspectionLocked}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <Search size={17} />
                Kontrollpunkt
              </button>
              <button
                type="button"
                onClick={() => void createAndOpenFreeNote()}
                disabled={isInspectionLocked}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <Plus size={17} />
                Notering
              </button>
              <button
                type="button"
                onClick={() => openCameraCapture()}
                disabled={isInspectionLocked || uploading}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <Camera size={17} />
                Kamera
              </button>
              <button
                type="button"
                onClick={() => openGalleryPicker()}
                disabled={isInspectionLocked || uploading}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <ImageIcon size={17} />
                Bilder
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <div className="space-y-4">
              {renderControlItemsPanel(false, false)}
              {renderRoomImageStrip()}
              {renderQuickNote()}
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={() => void deleteRoom()}
              disabled={isInspectionLocked}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50 sm:w-auto"
            >
              <Trash2 size={16} />
              Ta bort rum
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderExteriorDialog() {
    return (
      <div className="fixed inset-0 z-[80] bg-white md:bg-black/35" role="dialog" aria-modal="true">
        <div className="flex h-full flex-col bg-white md:mx-auto md:my-4 md:h-[calc(100%-2rem)] md:max-w-4xl md:rounded-2xl md:shadow-2xl">
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Utsida</div>
                <h2 className="text-lg font-semibold text-gray-950">{activeExteriorItem?.label}</h2>
              </div>
              <button
                type="button"
                onClick={() => setExteriorDialogOpen(false)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700"
                aria-label="Stäng komponent"
                title="Stäng komponent"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={openSearch}
                disabled={isInspectionLocked}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <Search size={17} />
                Kontrollpunkt
              </button>
              <button
                type="button"
                onClick={() => void createAndOpenFreeNote()}
                disabled={isInspectionLocked}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <Plus size={17} />
                Notering
              </button>
              <button
                type="button"
                onClick={() => openCameraCapture()}
                disabled={isInspectionLocked || uploading}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <Camera size={17} />
                Kamera
              </button>
              <button
                type="button"
                onClick={() => openGalleryPicker()}
                disabled={isInspectionLocked || uploading}
                className={primaryButtonClass('min-h-12 flex-col gap-1 px-2 text-xs')}
              >
                <ImageIcon size={17} />
                Bilder
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <div className="space-y-4">
              {renderControlItemsPanel(false, false)}
              {renderExteriorImageStrip()}
              {renderQuickNote()}
            </div>
          </div>
        </div>
      </div>
    )
  }

  function renderRoomImageStrip() {
    if (!activeRoom) return null
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-950">Bilder i rummet</div>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
            {activeRoomImages.length}
          </span>
        </div>
        {activeRoomImages.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {activeRoomImages.map(image => (
              <button
                key={image.id}
                type="button"
                onClick={() => setPreviewImage(image)}
                className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                aria-label="Visa bild"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getImagePublicUrl(image.file_path)}
                  alt=""
                  className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600">
            Inga bilder tagna i rummet ännu.
          </div>
        )}
      </div>
    )
  }

  function renderExteriorImageStrip() {
    if (!activeExteriorItem) return null
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-950">Bilder i komponenten</div>
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
            {activeExteriorImages.length}
          </span>
        </div>
        {activeExteriorImages.length > 0 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {activeExteriorImages.map(image => (
              <button
                key={image.id}
                type="button"
                onClick={() => setPreviewImage(image)}
                className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                aria-label="Visa bild"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getImagePublicUrl(image.file_path)}
                  alt=""
                  className="h-20 w-20 rounded-lg border border-gray-200 object-cover"
                />
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600">
            Inga bilder tagna i komponenten ännu.
          </div>
        )}
      </div>
    )
  }

  function renderImagePreviewDialog() {
    if (!previewImage) return null
    return (
      <div className="fixed inset-0 z-[130] bg-black/85 p-3" role="dialog" aria-modal="true">
        <div className="flex h-full flex-col">
          <div className="mb-3 flex justify-end">
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/25 bg-white/10 text-white"
              aria-label="Stäng bild"
              title="Stäng bild"
            >
              <X size={20} />
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

  function renderFreeNoteDialog() {
    const item = controlItems.find(row => row.id === freeNoteDialogId)
    if (!item?.id) return null
    const linkedImages = images.filter(image => image.control_item_id === item.id)

    return (
      <div className="fixed inset-0 z-[100] bg-white md:bg-black/35" role="dialog" aria-modal="true">
        <div className="flex h-full flex-col bg-white md:mx-auto md:my-4 md:h-[calc(100%-2rem)] md:max-w-3xl md:rounded-2xl md:shadow-2xl">
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {activeTargetLabel}
                </div>
                <h2 className="text-lg font-semibold text-gray-950">Fri notering</h2>
              </div>
              <button
                type="button"
                onClick={() => setFreeNoteDialogId(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700"
                aria-label="Stäng notering"
                title="Stäng notering"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
            <div className="space-y-4">
              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Notering</label>
                <DebouncedTextarea
                  rows={5}
                  value={item.note ?? ''}
                  onSave={value => void updateControlItem(item.id!, { note: value })}
                  readOnly={isInspectionLocked}
                  placeholder="Skriv noteringen..."
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">Risk</label>
                <DebouncedTextarea
                  rows={4}
                  value={item.risk_text ?? ''}
                  onSave={value => void updateControlItem(item.id!, { risk_text: value || null })}
                  readOnly={isInspectionLocked}
                  placeholder="Risktext..."
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">FTU</label>
                <DebouncedTextarea
                  rows={4}
                  value={item.ftu_text ?? ''}
                  onSave={value => void updateControlItem(item.id!, { ftu_text: value || null })}
                  readOnly={isInspectionLocked}
                  placeholder="Fortsatt teknisk utredning..."
                  className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </div>

              <div className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bilder</div>
                    <div className="text-sm font-semibold text-gray-950">
                      {linkedImages.length} kopplad{linkedImages.length === 1 ? '' : 'e'}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => openCameraCapture(item.id!)}
                      disabled={isInspectionLocked || uploading}
                      className={primaryButtonClass()}
                    >
                      <Camera size={16} />
                      Kamera
                    </button>
                    <button
                      type="button"
                      onClick={() => openGalleryPicker(item.id!)}
                      disabled={isInspectionLocked || uploading}
                      className={primaryButtonClass()}
                    >
                      <ImageIcon size={16} />
                      Bilder
                    </button>
                  </div>
                </div>

                {linkedImages.length > 0 ? (
                  <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {linkedImages.map(image => (
                      <button
                        key={image.id}
                        type="button"
                        onClick={() => setPreviewImage(image)}
                        className="rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                        aria-label="Visa bild"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={getImagePublicUrl(image.file_path)}
                          alt=""
                          className="aspect-square rounded-lg border border-gray-200 object-cover"
                        />
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-4 text-sm text-gray-600">
                    Inga bilder kopplade till noteringen.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 px-4 py-3">
            <button
              type="button"
              onClick={() => void deleteControlItem(item.id!)}
              disabled={isInspectionLocked}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 disabled:opacity-50 sm:w-auto"
            >
              <Trash2 size={16} />
              Ta bort notering
            </button>
          </div>
        </div>
      </div>
    )
  }

  function renderControlItemsPanel(processMode: boolean, showHeaderActions = true) {
    const canHaveControlItems = area === 'interior' ? !!activeRoom : !!activeExteriorItem
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Kontrollpunkter</div>
            <div className="text-sm font-semibold text-gray-950">{activeTargetLabel}</div>
          </div>
          {showHeaderActions ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={openSearch}
              disabled={!canHaveControlItems || isInspectionLocked}
              className={primaryButtonClass()}
            >
              <Search size={16} />
              Lägg till
            </button>
            <button
              type="button"
              onClick={() => void createAndOpenFreeNote()}
              disabled={!canHaveControlItems || isInspectionLocked}
              className={primaryButtonClass()}
            >
              <Plus size={16} />
              Fri notering
            </button>
          </div>
          ) : null}
        </div>

        {!canHaveControlItems ? (
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
            Välj rum eller komponent för att arbeta med kontrollpunkter.
          </div>
        ) : null}

        <div className="space-y-3">
          {groupedControlItems.freeItems.map(item => renderControlItemCard(item, [], processMode, true))}
          {groupedControlItems.groups.map(group => {
            const outcomes = outcomesByControlPointId[group.controlPointId] ?? []
            return renderControlItemGroup(group.controlPointId, group.items, outcomes, processMode)
          })}
        </div>
      </div>
    )
  }

  function renderControlItemGroup(
    controlPointId: string,
    items: InspectionControlItem[],
    outcomes: ControlPointOutcome[],
    processMode: boolean
  ) {
    const baseItem = items[0]
    if (!baseItem) return null
    const selectedItems = items.filter(item => item.selected_outcome_id)
    const isOk = selectedItems.length === 0 && baseItem.status === 'ok'
    const tone = isOk
      ? 'border-emerald-200 bg-emerald-50'
      : selectedItems.length > 0
        ? 'border-amber-200 bg-amber-50'
        : 'border-red-200 bg-red-50'
    const meta = controlPointMetaById[controlPointId]
    const selectedForImages = selectedItems.length > 0 ? selectedItems : [baseItem]

    return (
      <div key={controlPointId} className={`rounded-xl border p-3 ${tone}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="font-semibold text-gray-950">{baseItem.title}</div>
            {processMode && meta?.description ? <div className="mt-1 text-xs text-gray-600">{meta.description}</div> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {processMode
              ? selectedForImages.map(item => (
                <button
                  key={item.id ?? item.title}
                  type="button"
                  onClick={() => setSelectedControlItemId(item.id ?? null)}
                  disabled={!item.id}
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    item.id && selectedControlItemId === item.id
                      ? 'border-sky-300 bg-sky-50 text-sky-900'
                      : 'border-gray-300 bg-white text-gray-700'
                  }`}
                >
                  Välj
                </button>
              ))
              : null}
            {baseItem.id ? (
              <button
                type="button"
                onClick={() => void deleteControlItem(baseItem.id!)}
                disabled={isInspectionLocked}
                className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
              >
                Ta bort
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              selectedItems.forEach(item => {
                if (item.id && item.id !== baseItem.id) void deleteControlItem(item.id, true)
              })
              if (baseItem.id) {
                void updateControlItem(baseItem.id, {
                  status: isOk ? RED_STATUS : 'ok',
                  selected_outcome_id: null,
                  note: null,
                  risk_text: null,
                  ftu_text: null,
                })
              }
            }}
            disabled={isInspectionLocked || !baseItem.id}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
              isOk ? 'border-sky-300 bg-sky-50 text-sky-900' : 'border-gray-300 bg-white text-gray-800'
            }`}
          >
            Inget att notera
          </button>
          {outcomes.map(outcome => {
            const activeItem = selectedItems.find(item => item.selected_outcome_id === outcome.id)
            return (
              <button
                key={outcome.id}
                type="button"
                onClick={() => {
                  if (!baseItem.id) return
                  if (activeItem?.id) {
                    if (selectedItems.length === 1) {
                      void updateControlItem(activeItem.id, {
                        status: RED_STATUS,
                        selected_outcome_id: null,
                        note: null,
                        risk_text: null,
                        ftu_text: null,
                      })
                    } else {
                      void deleteControlItem(activeItem.id, true)
                    }
                    return
                  }
                  if (selectedItems.length === 0) {
                    void updateControlItem(baseItem.id, {
                      status: 'remark',
                      selected_outcome_id: outcome.id,
                      note: (outcome.note_template ?? '').trim() || null,
                      risk_text: (outcome.risk_template ?? '').trim() || null,
                      ftu_text: (outcome.ftu_template ?? '').trim() || null,
                    })
                  } else {
                    void addOutcomeControlItem(baseItem, outcome)
                  }
                }}
                disabled={isInspectionLocked || !baseItem.id}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  activeItem
                    ? 'border-sky-300 bg-sky-50 text-sky-900'
                    : 'border-gray-300 bg-white text-gray-800'
                }`}
              >
                {outcome.label}
              </button>
            )
          })}
        </div>

        {processMode ? (
          <div className="mt-3 space-y-3">
            {(selectedItems.length > 0 ? selectedItems : [baseItem]).map(item =>
              renderControlItemCard(item, outcomes, processMode, false)
            )}
          </div>
        ) : null}
      </div>
    )
  }

  function renderControlItemCard(
    item: InspectionControlItem,
    outcomes: ControlPointOutcome[],
    processMode: boolean,
    isFreeNote: boolean
  ) {
    const selectedOutcome = item.selected_outcome_id
      ? outcomes.find(outcome => outcome.id === item.selected_outcome_id)
      : null
    const linkedImages = images.filter(image => image.control_item_id === item.id)
    const hasRiskText = Boolean(item.risk_text?.trim())
    const hasFtuText = Boolean(item.ftu_text?.trim())
    return (
      <div
        key={item.id ?? `${item.title}-${item.sort_order}`}
        className={`rounded-lg border bg-white p-3 ${
          item.id && selectedControlItemId === item.id ? 'border-sky-300 ring-2 ring-sky-100' : 'border-gray-200'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-950">
            {isFreeNote ? 'Fri notering' : selectedOutcome?.label ?? 'Notering'}
          </div>
          <div className="flex items-center gap-2">
            {isFreeNote && hasRiskText ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-1.5 text-xs font-semibold text-amber-800">
                R
              </span>
            ) : null}
            {isFreeNote && hasFtuText ? (
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-sky-200 bg-sky-50 px-1.5 text-xs font-semibold text-sky-800">
                F
              </span>
            ) : null}
            {linkedImages.length > 0 ? (
              <span className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600">
                {linkedImages.length} bild{linkedImages.length === 1 ? '' : 'er'}
              </span>
            ) : null}
            {isFreeNote && item.id ? (
              <>
                <button
                  type="button"
                  onClick={() => setFreeNoteDialogId(item.id ?? null)}
                  className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-900"
                >
                  Öppna
                </button>
                <button
                  type="button"
                  onClick={() => void deleteControlItem(item.id!)}
                  disabled={isInspectionLocked}
                  className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 disabled:opacity-50"
                >
                  Ta bort
                </button>
              </>
            ) : item.id ? (
              <button
                type="button"
                onClick={() => setSelectedControlItemId(item.id ?? null)}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                  selectedControlItemId === item.id
                    ? 'border-sky-300 bg-sky-50 text-sky-900'
                    : 'border-gray-300 bg-white text-gray-700'
                }`}
              >
                Välj
              </button>
            ) : null}
          </div>
        </div>

        {isFreeNote ? (
          <button
            type="button"
            onClick={() => item.id && setFreeNoteDialogId(item.id)}
            className="mt-2 w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-left text-sm text-gray-700"
          >
            {item.note?.trim() || 'Öppna för att skriva notering, risk och FTU.'}
          </button>
        ) : (
          <DebouncedTextarea
            rows={2}
            value={item.note ?? ''}
            onSave={value => {
              if (item.id) void updateControlItem(item.id, { note: value })
            }}
            readOnly={isInspectionLocked}
            placeholder="Notering..."
            className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
          />
        )}

        {processMode && linkedImages.length > 0 ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {linkedImages.slice(0, 6).map(image => (
              <button
                key={image.id}
                type="button"
                onClick={() => setPreviewImage(image)}
                className="rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-300"
                aria-label="Visa bild"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={getImagePublicUrl(image.file_path)}
                  alt=""
                  className="aspect-square rounded-lg border border-gray-200 object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  // Bearbeta-vyn är pausad i UI:t, men bildbankslogiken ligger kvar för nästa steg.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function renderImageRail() {
    const filters: Array<{ key: ImageFilter; label: string }> = [
      { key: 'unprocessed', label: 'Obehandlade' },
      { key: 'active', label: 'Aktuell plats' },
      { key: 'linked', label: 'Kopplade' },
      { key: 'ignored', label: 'Ignorerade' },
      { key: 'unclassified', label: 'Oklassade' },
      { key: 'all', label: 'Alla' },
    ]

    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Bildbank</div>
            <div className="text-sm font-semibold text-gray-950">{selectedImageIds.size} valda</div>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700"
            aria-label="Uppdatera"
            title="Uppdatera"
          >
            <RefreshCw size={16} />
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map(filter => (
            <button
              key={filter.key}
              type="button"
              onClick={() => setImageFilter(filter.key)}
              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                imageFilter === filter.key
                  ? 'border-gray-900 bg-gray-900 text-white'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => void linkSelectedImagesToControlItem()}
            disabled={isInspectionLocked || !selectedControlItemId || selectedImageIds.size === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Check size={15} />
            Koppla
          </button>
          <button
            type="button"
            onClick={() => void createFreeNoteFromSelectedImages()}
            disabled={isInspectionLocked || selectedImageIds.size === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 disabled:opacity-50"
          >
            <Plus size={15} />
            Fri notering
          </button>
          <button
            type="button"
            onClick={() => void ignoreSelectedImages()}
            disabled={isInspectionLocked || selectedImageIds.size === 0}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-800 disabled:opacity-50"
          >
            Ignorera
          </button>
          <button
            type="button"
            onClick={() => void deleteSelectedImages()}
            disabled={isInspectionLocked || selectedImageIds.size === 0}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 disabled:opacity-50"
          >
            <Trash2 size={15} />
            Radera
          </button>
        </div>

        <div className="space-y-2">
          {filteredImages.length === 0 ? (
            <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-4 text-sm text-gray-600">
              Inga bilder i filtret.
            </div>
          ) : null}
          {filteredImages.map(image => {
            const selected = selectedImageIds.has(image.id)
            const status = imageStatus(image)
            return (
              <button
                key={image.id}
                type="button"
                onClick={() => toggleImageSelection(image.id)}
                className={`w-full overflow-hidden rounded-xl border bg-white text-left ${
                  selected ? 'border-gray-900 ring-2 ring-gray-900/10' : 'border-gray-200'
                }`}
              >
                <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-2 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={getImagePublicUrl(image.file_path)}
                    alt=""
                    className="aspect-square rounded-lg object-cover"
                  />
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          status === 'linked'
                            ? 'bg-emerald-50 text-emerald-700'
                            : status === 'ignored'
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-amber-50 text-amber-700'
                        }`}
                      >
                        {statusLabel(status)}
                      </span>
                      {selected ? (
                        <span className="rounded-full bg-gray-900 px-2 py-0.5 text-[11px] font-semibold text-white">
                          Vald
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs font-medium text-gray-900">{imageOriginLabel(image)}</div>
                    <div className="text-[11px] text-gray-500">
                      {formatDateTime(image.captured_at ?? image.created_at)}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  function imageOriginLabel(image: InspectionImage) {
    if (image.source_area === 'interior') {
      const floor = image.origin_floor_label ? floorLabelFromKey(image.origin_floor_label) : 'Insida'
      return `${floor} > ${image.origin_room_label ?? 'Rum'}`
    }
    if (image.source_area === 'exterior') {
      const item = image.origin_exterior_item_id
        ? exteriorItems.find(row => row.id === image.origin_exterior_item_id)
        : null
      return item ? `Utsida > ${item.label}` : 'Utsida > Oklassad'
    }
    return 'Bild'
  }

  function formatDateTime(value: string | null | undefined) {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleString('sv-SE', {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
}
