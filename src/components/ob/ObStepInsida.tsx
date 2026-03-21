'use client'

import { useEffect, useMemo, useState, ChangeEvent, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  assignment_number: string | null
  status?: string | null
  inspection_side?: string | null
}
type InspectionSide = 'buyer' | 'seller' | 'apartment'
type SearchMode = 'control_points' | 'chips'

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
  trigger_tags?: any | null
}

type InteriorRoom = {
  id?: string
  inspection_id: string
  floor_label: string
  order_index: number
  room_type_key: string
  room_label: string
  values: Record<string, any>
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

type ControlPointLite = {
  id: string
  key: string
  title: string
  label: string | null
  description: string | null
  tags: any | null
  trigger_room_types?: any | null
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
  trigger_room_types?: any | null
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

const getImagePublicUrl = (filePath: string) => {
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

// -----------------------------
// Hjälpfunktion: bygg våningsnycklar från Förutsättningar (Byggnadstyp)
// -----------------------------
const buildFloorsFromAnswers = (answers: Record<string, any>): string[] => {
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

  const count =
    floorsVal === '1_5' ? 2 :
    floorsVal === '2'   ? 2 :
    floorsVal === '3'   ? 3 :
    floorsVal === '1'   ? 1 :
    typeof floorsVal === 'number' ? floorsVal :
    0

  const keys: string[] = []

  if (basementVal === 'yes' || basementVal === 'ja' || basementVal === true) {
    keys.push('källare')
  } else if (basementVal === 'partial' || basementVal === 'delvis') {
    keys.push('källare_delvis')
  }

  if (count >= 1) keys.push('entréplan')
  if (count >= 2) keys.push('plan2')
  if (count >= 3) keys.push('plan3')
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

const isOtherRoomKey = (value: string | null | undefined) => {
  const key = normalizeRoomTypeKey(value)
  return key === 'ovrigt' || key === 'övrigt'
}

const isPgUniqueViolation = (error: any) =>
  error?.code === '23505' ||
  error?.details?.includes?.('duplicate key value violates unique constraint') ||
  error?.message?.includes?.('duplicate key value violates unique constraint')

const getNormalizedTriggerRoomTypes = (triggerRoomTypes: any | null | undefined) => {
  const raw = Array.isArray(triggerRoomTypes) ? triggerRoomTypes : []
  return raw
    .map(val => normalizeRoomTypeKey(val))
    .filter((val): val is string => !!val)
}

const triggerRoomTypesMatchRoom = (
  triggerRoomTypes: any | null | undefined,
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
  if (normalized === 'källare_delvis') return 'Källare (delvis)'
  if (normalized === 'entréplan') return 'Entréplan'
  if (normalized === 'plan2') return 'Plan 2 / Övre plan'
  if (normalized === 'plan3') return 'Plan 3'
  if (normalized.startsWith('plan')) return `Plan ${normalized.replace('plan', '')}`
  return normalized
}

// =============================
// Huvudkomponent
// =============================
export default function ObStepInsida({ inspection }: ObStepInsidaProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInspectionLocked = normalizeInspectionStatus(inspection?.status) === 'completed'
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
  const otherRoomEnsuredRef = useRef(false)
  const otherRoomItemsEnsuredRef = useRef(false)

  useEffect(() => {
    otherRoomEnsuredRef.current = false
    otherRoomItemsEnsuredRef.current = false
  }, [inspection?.id])

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
        ])

        if (rtErr) throw rtErr
        if (gErr) throw gErr
        if (oErr) throw oErr
        if (rErr) throw rErr

        const roomTypesArr = (rtData ?? []) as RoomType[]
        const filteredRoomTypes = roomTypesArr.filter(rt => {
          const label = normalizeSwedish(rt.label ?? '').toLowerCase()
          const key = normalizeSwedish(rt.key ?? '').toLowerCase()
          return label !== 'rum saknas' && key !== 'rum_saknas'
        })
        setRoomTypes(filteredRoomTypes)
        setGroups((gData ?? []) as InteriorGroup[])
        setOptions((oData ?? []) as InteriorOption[])

        const roomsArr = (rData ?? []) as any[]
        const normalizedRooms: InteriorRoom[] = roomsArr.map(r => ({
          ...r,
          values: (r.values as any) || {},
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

            const answers = (btSelData?.[0]?.values as any) || {}
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

        // 5) Sätt aktivt plan
        if (floorsFromConditions.length) {
          setActiveFloor(floorsFromConditions[0])
        } else if (normalizedRooms.length) {
          setActiveFloor(normalizedRooms[0].floor_label)
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
            setNewFloorLabel('Entréplan')
          }
        }
      } catch (e: any) {
        console.error('loadAll insida failed:', e)
        setError(e?.message ?? 'Kunde inte ladda Insida-data.')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
  }, [inspection?.id])
  useEffect(() => {
    if (!inspection?.id) return
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
  }, [inspection?.id, loading, roomTypes, rooms, activeFloor])

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
      ? [...derivedFloors]
      : Array.from(new Set(rooms.map(r => r.floor_label)))

    const withoutOther = base.filter(k => k && k !== OTHER_ROOM_TYPE_KEY)
    const hasVind = withoutOther.includes('vind')
    const withoutVind = withoutOther.filter(k => k !== 'vind')

    const ordered = [OTHER_ROOM_TYPE_KEY, ...withoutVind, ...(hasVind ? ['vind'] : [])]
    return ordered.filter((k, idx) => ordered.indexOf(k) === idx)
  }, [derivedFloors, rooms])

  useEffect(() => {
    if (!floorLabels.length) return
    if (!activeFloor || !floorLabels.includes(activeFloor)) {
      setActiveFloor(floorLabels[0])
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
    const target = normalizeSwedish(activeFloor)
    return rooms.filter(
      r =>
        !isMissingRoom(r) &&
        normalizeSwedish(r.floor_label) === target
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

  const getRoomDisplayLabel = (room: InteriorRoom) =>
    isOtherRoom(room) ? OTHER_ROOM_DISPLAY_LABEL : room.room_label

  const roomChips = useMemo(() => {
    if (!activeFloor) return []
    const target = normalizeSwedish(activeFloor)
    return rooms
      .filter(
        r =>
          !isMissingRoom(r) &&
          normalizeSwedish(r.floor_label) === target
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
    if (a.floor_label < b.floor_label) return -1
    if (a.floor_label > b.floor_label) return 1
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
    } catch (e: any) {
      console.error('upsertControlItem failed:', e)
      setError(e?.message ?? 'Kunde inte spara kontrollpunkt.')
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
        .select('id, file_path')
        .eq('control_item_id', itemId)

      if (imgFetchErr) {
        console.error('fetch inspection_images (insida) failed:', imgFetchErr)
      }

      const imageRows = (imgRows ?? []) as Pick<InspectionImage, 'id' | 'file_path'>[]
      if (imageRows.length > 0) {
        const paths = imageRows.map(img => img.file_path).filter(Boolean)
        if (paths.length > 0) {
          const { error: storageErr } = await supabase.storage
            .from(IMAGE_BUCKET)
            .remove(paths)

          if (storageErr) {
            console.error('remove storage files (insida) failed:', storageErr)
          }
        }

        const imageIds = imageRows.map(img => img.id)
        const { error: imgDeleteErr } = await supabase
          .from('inspection_images')
          .delete()
          .in('id', imageIds)

        if (imgDeleteErr) {
          console.error('delete inspection_images (insida) failed:', imgDeleteErr)
        }
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
          (cpErr as any)?.message || cpErr
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
    } catch (e: any) {
      console.error('handleUploadImageForControlItem (insida) failed:', e)
      setError(e?.message ?? 'Kunde inte ladda upp bild.')
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
    } catch (e: any) {
      console.error('handleDeleteImage (insida) failed:', e)
      setError(e?.message ?? 'Kunde inte ta bort bild.')
    } finally {
      setSaving(false)
    }
  }

  // -----------------------------
  // Upsert rum
  // -----------------------------
  const upsertRoom = async (room: InteriorRoom): Promise<InteriorRoom> => {
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
        const r = data as any
        return { ...r, values: (r.values as any) || {} }
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
                return { ...existing, values: (existing.values as any) || {} }
              }
            }
          }

          throw error
        }
        const r = data as any
        return { ...r, values: (r.values as any) || {} }
      }
    } catch (e: any) {
      console.error('upsertRoom insida failed:', e)
      setError(e?.message ?? 'Kunde inte spara rum.')
      return room
    } finally {
      setSaving(false)
    }
  }

  const addRoom = async () => {
    if (!newRoomTypeKey || !newFloorLabel.trim()) {
      alert('Välj rumstyp och ange/ välj plan.')
      return
    }

    const floor = newFloorLabel.trim()
    const typeKey = newRoomTypeKey
    const defaultLabel =
      newRoomLabel.trim() ||
      (() => {
        const baseLabel = getRoomTypeLabel(typeKey)
        const existingOnFloor = rooms.filter(
          r => r.floor_label === floor && r.room_type_key === typeKey
        ).length
        const num = existingOnFloor + 1
        return `${baseLabel} ${num}`
      })()

    const maxOrder = rooms
      .filter(r => r.floor_label === floor)
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
    if (!id) return
    const current = rooms.find(r => r.id === id)
    if (!current) return
    const updated: InteriorRoom = { ...current, ...patch }
    setRooms(prev => prev.map(r => (r.id === id ? updated : r)))
    const saved = await upsertRoom(updated)
    setRooms(prev => prev.map(r => (r.id === id ? saved : r)))
  }

  const startEditRoom = (room: InteriorRoom) => {
    if (!room.id) return
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
    if (!editingRoomId) return
    const current = rooms.find(r => r.id === editingRoomId)
    if (!current) return
    const nextFloor = editRoomFloorLabel || current.floor_label
    const isFloorChanged = nextFloor !== current.floor_label
    const nextOrder = isFloorChanged
      ? rooms
          .filter(r => r.floor_label === nextFloor && r.id !== current.id)
          .reduce((m, r) => Math.max(m, r.order_index ?? 0), 0) + 10
      : current.order_index
    await updateRoomField(editingRoomId, {
      room_label: editRoomLabel,
      room_type_key: editRoomTypeKey,
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
    patchValues: Record<string, any>
  ) => {
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
  }: {
    label: string
    value: any
    onChange: (v: string) => void
    options: InteriorOption[]
  }) => (
    <div className="space-y-1">
      <label className="text-xs font-medium text-gray-700">{label}</label>
      <select
        value={value ?? ''}
        onChange={e => onChange(e.target.value)}
        className="h-9 w-full rounded-lg border border-gray-300 bg-gray-50 px-2 text-sm text-gray-900
                   focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
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

  // ----------------- RENDER -----------------
  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Laddar insida…</div>
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        {error}
        <div className="mt-1 text-xs text-gray-500">
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

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-gray-200 bg-white/95 p-4 md:p-5 space-y-4">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold text-gray-900">Byggnad – insida</h2>
          <p className="text-sm text-gray-700">
            Här dokumenterar du invändiga rum per plan och rumstyp. Gå vänstervarv per plan och lägg till
            ett kort för varje rum (Sovrum 1, Sovrum 2, Vardagsrum, Badrum osv.). Kontrollpunkter
            föreslås automatiskt men du kan även lägga till egna per rum.
          </p>
        </header>

        {/* Plan-flikar + Lägg till rum */}
        <section className="flex flex-wrap items-center gap-2">
          {floorLabels.map(fl => (
            <button
              key={fl}
              type="button"
              onClick={() => setActiveFloor(fl)}
              className={`rounded-full border px-3 py-1 text-xs ${
                activeFloor === fl
                  ? 'bg-gray-900 text-white border-gray-900'
                  : 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {getFloorLabel(fl)}
            </button>
          ))}

          {floorLabels.length === 0 && (
            <span className="text-xs text-gray-500">
              Inga plan ännu. Fyll i Byggnadstyp under Förutsättningar, eller lägg till ett rum så skapas plan automatiskt.
            </span>
          )}

          {!isOtherFloor && (
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
                  setNewFloorLabel('entréplan')
                }
                setShowNewRoomForm(true)
              }}
              className="ml-auto inline-flex items-center justify-center rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
            >
              + Lägg till rum
            </button>
          )}
        </section>

        {roomChips.length > 0 && (
          <section className="flex flex-wrap items-center gap-2">
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

      {/* Ny-rumsformulär */}
      {showNewRoomForm && (
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
                  placeholder="t.ex. Källare, Entréplan, Övre plan"
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
      )}

      {/* Rumskort */}
      <section className="space-y-4">
        {filteredRooms.map(room => {
          const rtLabel = getRoomTypeLabel(room.room_type_key)
          const vals = room.values || {}
          const roomId = room.id ?? ''
          const roomControlItems = controlItemsByRoomId[roomId] || []

          return (
            <article
              key={room.id}
              id={room.id ? `room-card-${room.id}` : undefined}
              className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-4"
            >
              <header className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs uppercase text-gray-500">
                    {getFloorLabel(room.floor_label)}
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">
                    {getRoomDisplayLabel(room)}{' '}
                    <span className="text-gray-500 text-xs">({rtLabel})</span>
                  </h3>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => startEditRoom(room)}
                    className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                  >
                    Redigera rum
                  </button>

                  {!isSystemOtherRoom(room) && (
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

              {editingRoomId === room.id && (
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                  <div className="grid gap-3 md:grid-cols-3">
                    <div>
                      <label className="text-xs text-gray-600">Rumnamn</label>
                      <input
                        className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                        value={editRoomLabel}
                        onChange={e => setEditRoomLabel(e.target.value)}
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
                          <div className="mt-1 text-[11px] text-gray-500">
                            Systemrummet kan inte flyttas mellan plan.
                          </div>
                        </>
                      ) : (
                        <select
                          className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm bg-white"
                          value={editRoomFloorLabel}
                          onChange={e => setEditRoomFloorLabel(e.target.value)}
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
                      className="rounded-md bg-gray-900 px-3 py-1.5 text-xs text-white"
                    >
                      Spara
                    </button>
                  </div>
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                {filteredGroups.map(g => (
                  <SelectField
                    key={g.id}
                    label={g.label}
                    value={vals[g.key] ?? ''}
                    options={optionsByGroup[g.id] || []}
                    onChange={v =>
                      updateRoomValues(room.id, { [g.key]: v })
                    }
                  />
                ))}
              </div>

              {/* Kontrollpunkter för rummet */}
              {room.id && (
                <RoomControlPointsSection
                  room={room}
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
                />
              )}
            </article>
          )
        })}

        {filteredRooms.length === 0 && (
          <div className="p-3 text-sm text-gray-500 border border-dashed rounded-lg">
            Inga rum registrerade på detta plan ännu.
            <br />
            Lägg till ett rum med knappen “Lägg till rum” ovanför.
          </div>
        )}
      </section>

      {saving && (
        <div className="text-xs text-gray-500">
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
  onUpload: (ci: InspectionControlItem, file: File) => void
  onDelete: (imageId: string) => void
}

function ControlItemImagesSection({
  controlItem,
  images,
  onUpload,
  onDelete,
}: ControlItemImagesSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    onUpload(controlItem, file)
    e.target.value = ''
  }

  return (
    <section className="space-y-2 border-t pt-2 mt-2">
      <div className="flex items-center justify-between">
        <h5 className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-900">
          <span aria-hidden="true">{'\u{1F4F7}'}</span>
          <span>Bilder (denna kontrollpunkt)</span>
        </h5>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
        >
          + Lägg till bild
        </button>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {images.length === 0 && (
        <p className="text-[11px] text-gray-500">
          Inga bilder ännu. Lägg till en bild från kamera eller galleri.
        </p>
      )}

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map(img => {
            const url = getImagePublicUrl(img.file_path)
            return (
              <div
                key={img.id}
                className="relative h-16 w-16 overflow-hidden rounded-lg border bg-gray-100"
              >
                <img
                  src={url}
                  alt={img.label || 'Bild'}
                  className="h-full w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => onDelete(img.id)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1 text-[9px] font-medium text-white"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

// =============================
// Undkomponent: Kontrollpunkter per rum
// =============================
type RoomControlPointsSectionProps = {
  room: InteriorRoom
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
}

function RoomControlPointsSection({
  room,
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
}: RoomControlPointsSectionProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<ControlPointLite[]>([])
  const [searching, setSearching] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('control_points')
  const [expandedOkGroupIds, setExpandedOkGroupIds] = useState<Set<string>>(
    () => new Set()
  )
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(
    () => new Set()
  )
  const roomDisplayLabel = isOtherRoomKey(room.room_type_key)
    ? OTHER_ROOM_DISPLAY_LABEL
    : room.room_label
  const groupedItems = useMemo(() => {
    const map = new Map<string, InspectionControlItem[]>()
    for (const ci of items) {
      const cpId = ci.control_point_id
      if (!cpId) continue
      const bucket = map.get(cpId) ?? []
      bucket.push(ci)
      map.set(cpId, bucket)
    }
    return Array.from(map.entries()).map(([controlPointId, list]) => ({
      controlPointId,
      items: list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
  }, [items])
  const freeNoteItems = useMemo(
    () =>
      items
        .filter(ci => ci.control_point_id === null)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [items]
  )
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

  const clearSearch = () => {
    setSearchTerm('')
    setSearchResults([])
    setSearching(false)
  }

  const handleToggleSearch = () => {
    const next = !showSearch
    setShowSearch(next)
    if (!next) clearSearch()
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
          .select('id, key, title, label, description, tags, trigger_room_types, applies_to')
          .eq('scope', 'interior')
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
        .select('id, key, title, label, description, tags, trigger_room_types, applies_to')
        .eq('scope', 'interior')
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
                ? `Chipträff: ${outcomeLabels.slice(0, 3).join(', ')}`
                : 'Chipträff',
          }
        })
      )
    } finally {
      setSearching(false)
    }
  }

  return (
    <section className="space-y-3 border-t pt-3">
      {showSearch && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-700">
            Lägg till kontrollpunkt i {roomDisplayLabel}
          </label>
          <div className="inline-flex rounded-md border border-gray-300 bg-white p-0.5">
            <button
              type="button"
              onClick={() => handleSearchModeChange('control_points')}
              className={
                'rounded px-2.5 py-1 text-[11px] font-medium ' +
                (searchMode === 'control_points'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-700 hover:bg-gray-100')
              }
            >
              Kontrollpunkter
            </button>
            <button
              type="button"
              onClick={() => handleSearchModeChange('chips')}
              className={
                'rounded px-2.5 py-1 text-[11px] font-medium ' +
                (searchMode === 'chips'
                  ? 'bg-gray-900 text-white'
                  : 'text-gray-700 hover:bg-gray-100')
              }
            >
              Chips
            </button>
          </div>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            placeholder={
              searchMode === 'chips'
                ? 'Sök chip, t.ex. spricka, fukt, missfärgning…'
                : 'Sök t.ex. golvbrunn, kyl, trinett…'
            }
            value={searchTerm}
            onChange={handleSearchChange}
            readOnly={isInspectionLocked}
          />

          {searching && (
            <div className="text-[11px] text-gray-500">Söker…</div>
          )}

          {!searching && searchTerm.trim().length >= 2 && (
            <div className="max-h-40 overflow-auto rounded-md border bg-white">
              {searchResults.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500">
                  {searchMode === 'chips' ? 'Inga chips' : 'Inga kontrollpunkter'} hittades för
                  {' '}“{searchTerm.trim()}”.
                </div>
              ) : (
                searchResults.map(cp => (
                  <button
                    key={cp.id}
                    type="button"
                    onClick={() => {
                      onAddFromCatalog(room, cp)
                      setSearchTerm('')
                      setSearchResults([])
                      setShowSearch(false)
                    }}
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-gray-50"
                    disabled={isInspectionLocked}
                  >
                    <span className="font-medium text-gray-900">
                      {cp.title || cp.label || cp.key}
                    </span>
                    {cp.description && (
                      <span className="text-[11px] text-gray-500 line-clamp-2">
                        {cp.description}
                      </span>
                    )}
                    {cp.search_hint && (
                      <span className="text-[11px] text-gray-500">
                        {cp.search_hint}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      <header className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 className="text-sm font-semibold text-gray-900">
            Kontrollpunkter i detta rum
          </h4>
          <span className="text-[11px] text-gray-500">
            Noteringarna här gäller respektive kontrollpunkt.
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onAddFreeNote(room)}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
            disabled={isInspectionLocked}
          >
            + Lägg till fri notering
          </button>
          <button
            type="button"
            onClick={handleToggleSearch}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
            disabled={isInspectionLocked}
          >
            + Lägg till ytterligare kontrollpunkt
          </button>
        </div>
      </header>

      {/* Lista med befintliga kontrollpunkter */}
      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-gray-500">
            Inga kontrollpunkter ännu. De kan läggas till automatiskt för rumstypen
            eller via knappen “Lägg till ytterligare kontrollpunkt”.
          </div>
        )}

        {freeNoteItems.map(ci => {
          const ciId = ci.id ?? ''
          const ciImages = imagesByControlItemId[ciId] || []
          return (
            <div
              key={ci.id}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-900">
                  {ci.title}
                </div>

                {ci.id && (
                  <button
                    type="button"
                    onClick={() => ci.id && onDeleteItem(ci.id)}
                    className="text-[11px] text-rose-600 hover:underline"
                    disabled={isInspectionLocked}
                  >
                    Ta bort notering
                  </button>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-gray-600">
                  🧱 Notering
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                  placeholder="Fri notering för rummet…"
                  value={ci.note ?? ''}
                  onChange={e =>
                    ci.id &&
                    onUpdateItem(ci.id, { note: e.target.value })
                  }
                  readOnly={isInspectionLocked}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-gray-600">
                  ⚠️ Riskanalys
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                  placeholder="Beskriv riskanalys..."
                  value={ci.risk_text ?? ''}
                  onChange={e =>
                    ci.id &&
                    onUpdateItem(ci.id, { risk_text: e.target.value })
                  }
                  readOnly={isInspectionLocked}
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-gray-600">
                  🔍 Fortsatt teknisk utredning (FTU)
                </label>
                <textarea
                  rows={3}
                  className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                  placeholder="Beskriv fortsatt teknisk utredning..."
                  value={ci.ftu_text ?? ''}
                  onChange={e =>
                    ci.id &&
                    onUpdateItem(ci.id, { ftu_text: e.target.value })
                  }
                  readOnly={isInspectionLocked}
                />
              </div>

              {ci.id && (
                <ControlItemImagesSection
                  controlItem={ci}
                  images={ciImages}
                  onUpload={onUploadImage}
                  onDelete={onDeleteImage}
                />
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
              ? `${selectedItems.length} vald${selectedItems.length === 1 ? '' : 'a'} chip`
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
                  <span className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-medium ${collapsedBadgeClass}`}>
                    {collapsedBadgeText}
                  </span>
                  <div className="ml-auto flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (isGreen) expandOkGroup(groupId)
                        expandGroup(groupId)
                      }}
                      className="text-[11px] text-gray-700 hover:underline"
                    >
                      Visa
                    </button>
                    {baseItem.id && (
                      <button
                        type="button"
                        onClick={() => onDeleteItemGroup(baseItem)}
                        className="text-[11px] text-rose-600 hover:underline"
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
                    className="text-[11px] text-gray-700 hover:underline"
                  >
                    Dölj
                  </button>
                  {baseItem.id && (
                    <button
                      type="button"
                      onClick={() => onDeleteItemGroup(baseItem)}
                      className="text-[11px] text-rose-600 hover:underline"
                      disabled={isInspectionLocked}
                    >
                      Ta bort
                    </button>
                  )}
                </div>
              </div>

              {description.length > 0 && (
                <div className="text-[11px] text-gray-600">
                  {description}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] text-gray-600">
                  Bedömning
                </label>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    className={
                      'rounded-full border px-2.5 py-1 text-[11px] ' +
                      (isGreen
                        ? 'border-gray-900 bg-gray-900 text-white'
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
                      'rounded-full border px-2.5 py-1 text-[11px] ' +
                      (isActive
                        ? 'border-gray-900 bg-gray-900 text-white'
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
                    <label className="text-[11px] text-gray-600">
                      🧱 Notering
                    </label>
                    <textarea
                      rows={2}
                      className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                      placeholder="Notering för just denna kontrollpunkt…"
                      value={baseItem.note ?? ''}
                      onChange={e =>
                        baseItem.id &&
                        onUpdateItem(baseItem.id, { note: e.target.value })
                      }
                      readOnly={isInspectionLocked}
                    />
                  </div>
                  {baseItem.id && (
                    <ControlItemImagesSection
                      controlItem={baseItem}
                      images={imagesByControlItemId[baseItem.id] || []}
                      onUpload={onUploadImage}
                      onDelete={onDeleteImage}
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
                          {ci.id && (
                            <button
                              type="button"
                              onClick={() => onDeleteItem(ci.id!, true)}
                              className="text-[11px] text-rose-600 hover:underline"
                              disabled={isInspectionLocked}
                            >
                              Ta bort
                            </button>
                          )}
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] text-gray-600">
                            🧱 Notering
                          </label>
                          <textarea
                            rows={2}
                            className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                            placeholder="Notering för just detta chip…"
                            value={ci.note ?? ''}
                            onChange={e =>
                              ci.id &&
                              onUpdateItem(ci.id, { note: e.target.value })
                            }
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
                                <textarea
                                  rows={3}
                                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                                  placeholder="Beskriv riskanalys..."
                                  value={riskText}
                                  onChange={e =>
                                    ci.id &&
                                    onUpdateItem(ci.id, { risk_text: e.target.value })
                                  }
                                  readOnly={isInspectionLocked}
                                />
                              </div>
                            )}
                            {ftuText.length > 0 && (
                              <div className="rounded-lg border border-gray-200 bg-white p-3">
                                <div className="text-xs font-semibold text-gray-700">
                                  🔍 Fortsatt teknisk utredning (FTU)
                                </div>
                                <textarea
                                  rows={3}
                                  className="mt-1 w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                                  placeholder="Beskriv fortsatt teknisk utredning..."
                                  value={ftuText}
                                  onChange={e =>
                                    ci.id &&
                                    onUpdateItem(ci.id, { ftu_text: e.target.value })
                                  }
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











