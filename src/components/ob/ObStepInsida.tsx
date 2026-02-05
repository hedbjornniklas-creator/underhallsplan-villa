'use client'

import { useEffect, useMemo, useState, ChangeEvent, useRef } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  assignment_number: string | null
}

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

const normalizeRoomTypeKey = (value: string | null | undefined) => {
  const base = normalizeSwedish(String(value ?? '')).trim().toLowerCase()
  if (base === 'ovrigt') return 'övrigt'
  return base
}

const isOtherRoomKey = (value: string | null | undefined) => {
  const key = normalizeRoomTypeKey(value)
  return key === 'ovrigt' || key === 'övrigt'
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
  const otherRoomEnsuredRef = useRef(false)
  const otherRoomItemsEnsuredRef = useRef(false)
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

                  const match = (atticOptions ?? []).find(
                    o => o.value === rawAttic
                  )
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
          const ciArr = (ciData ?? []).map(ci => ({
            ...(ci as InspectionControlItem),
            selected_outcome_id:
              (ci as InspectionControlItem).selected_outcome_id ?? null,
          })) as InspectionControlItem[]
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
                .select('id, title, label, description')
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
    if (!roomTypes.length) return
    if (otherRoomEnsuredRef.current) return

    const existing = rooms.find(room => isOtherRoomKey(room.room_type_key))
    if (existing) {
      otherRoomEnsuredRef.current = true
      return
    }

    const label =
      roomTypes.find(rt => isOtherRoomKey(rt.key))?.label ?? 'Övrigt'
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
      if (saved.id) {
        setRooms(prev => [saved, ...prev])
        await createDefaultControlItemsForRoom(saved)
        if (!activeFloor) setActiveFloor(OTHER_ROOM_TYPE_KEY)
        otherRoomEnsuredRef.current = true
      }
    })()
  }, [inspection?.id, roomTypes, rooms, activeFloor])

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

    ;(async () => {
      await createDefaultControlItemsForRoom(otherRoom)
      otherRoomItemsEnsuredRef.current = true
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
        .select('id, title, label, description')
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
    if (k === OTHER_ROOM_TYPE_KEY) return 'Övrigt'
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

  const getRoomTypeLabel = (key: string) =>
    roomTypes.find(rt => normalizeRoomTypeKey(rt.key) === normalizeRoomTypeKey(key))
      ?.label ?? key

  const isOtherRoom = (room: InteriorRoom) =>
    isOtherRoomKey(room.room_type_key)

  const isSystemOtherRoom = (room: InteriorRoom) =>
    isOtherRoom(room) &&
    normalizeSwedish(room.floor_label) === OTHER_ROOM_TYPE_KEY &&
    (room.order_index ?? 0) === 0

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
            sort_order: item.sort_order,
            selected_outcome_id: item.selected_outcome_id ?? null,
          })
          .select('*')
          .single()

        if (error) throw error
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
    const current = controlItems.find(ci => ci.id === itemId)
    if (!current) return

    const optimistic: InspectionControlItem = { ...current, ...patch }
    setControlItems(prev => prev.map(ci => (ci.id === itemId ? optimistic : ci)))

    const saved = await upsertControlItem(optimistic)
    setControlItems(prev => prev.map(ci => (ci.id === itemId ? saved : ci)))
  }

  const deleteControlItem = async (itemId: string) => {
    const item = controlItems.find(ci => ci.id === itemId)
    if (!item) return

    // Framför allt avsett för fria noteringar, men fungerar för alla
    if (!confirm('Ta bort denna notering/kontrollpunkt?')) return

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
  const createDefaultControlItemsForRoom = async (room: InteriorRoom) => {
    if (!room.id) return

    try {
      const { data, error } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, tags, trigger_room_types')
        .eq('scope', 'interior')
        .eq('is_active', true)

      if (error) {
        console.error(
          'fetch control points failed:',
          (error as any)?.message || error
        )
        return
      }

      const all = (data ?? []) as ControlPointLite[]

      // Filtrera i JS på trigger_room_types (jsonb-array)
      const cps = all.filter(cp => {
        try {
          const arr = Array.isArray(cp.trigger_room_types)
            ? cp.trigger_room_types
            : []
          if (arr.length === 0) {
            return isOtherRoomKey(room.room_type_key)
          }
          const roomKey = normalizeRoomTypeKey(room.room_type_key)
          const normalized = arr.map(val => normalizeRoomTypeKey(val))
          return normalized.includes(roomKey)
        } catch {
          return false
        }
      })

      if (!cps.length) return

      const existingForRoom = controlItems.filter(
        ci => ci.interior_room_id === room.id
      )
      let sortBase =
        existingForRoom.length > 0
          ? Math.max(...existingForRoom.map(ci => ci.sort_order || 0))
          : 0

      const payload = cps.map(cp => {
        sortBase += 10
        return {
          inspection_id: inspection.id,
          interior_room_id: room.id!,
          control_point_id: cp.id,
          title: cp.title || cp.label || cp.key,
          status: RED_STATUS,
          note: null,
          sort_order: sortBase,
          selected_outcome_id: null,
        }
      })

      const { data: insData, error: insErr } = await supabase
        .from('inspection_control_items')
        .insert(payload)
        .select('*')

      if (insErr) {
        console.error('insert default control items failed:', insErr)
        return
      }

      setControlItems(prev => [
        ...prev,
        ...((insData ?? []) as InspectionControlItem[]),
      ])
      await ensureControlPointData(cps.map(cp => cp.id))
    } catch (e) {
      console.error('createDefaultControlItemsForRoom error:', e)
    }
  }

  // -----------------------------
  // Skapa kontrollpunkt från katalog via sök
  // -----------------------------
  const addControlItemFromCatalog = async (
    room: InteriorRoom,
    cp: ControlPointLite
  ) => {
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
      control_point_id: cp.id,
      title: cp.title || cp.label || cp.key,
      status: RED_STATUS,
      note: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    }

    const saved = await upsertControlItem(newItem)
    setControlItems(prev => [saved, ...prev])
    await ensureControlPointData([cp.id])
  }

  // -----------------------------
  // Lägg till fri notering som egen kontrollpunkt
  // -----------------------------
  const addFreeNoteControlItem = async (room: InteriorRoom) => {
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
      sort_order: sortOrder,
      selected_outcome_id: null,
    }

    const saved = await upsertControlItem(newItem)
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

        if (error) throw error
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
  }

  const cancelEditRoom = () => {
    setEditingRoomId(null)
    setEditRoomLabel('')
    setEditRoomTypeKey('')
  }

  const saveEditRoom = async () => {
    if (!editingRoomId) return
    await updateRoomField(editingRoomId, {
      room_label: editRoomLabel,
      room_type_key: editRoomTypeKey,
    })
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
              {room.room_label}
            </button>
          ))}
        </section>
      )}

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
                    {room.room_label}{' '}
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <label className="text-xs text-gray-600">Rumnamn</label>
                      <input
                        className="mt-0.5 w-full rounded-md border px-2 py-1.5 text-sm"
                        value={editRoomLabel}
                        onChange={e => setEditRoomLabel(e.target.value)}
                      />
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
                  items={roomControlItems}
                  onUpdateItem={updateControlItem}
                  onDeleteItem={deleteControlItem}
                  onAddFromCatalog={addControlItemFromCatalog}
                  onAddFreeNote={addFreeNoteControlItem}
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
  items: InspectionControlItem[]
  onUpdateItem: (itemId: string, patch: Partial<InspectionControlItem>) => void
  onDeleteItem: (itemId: string) => void
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
  items,
  onUpdateItem,
  onDeleteItem,
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

      const { data, error } = await supabase
        .from('settings_control_points')
        .select('id, key, title, label, description, tags')
        .eq('scope', 'interior')
        .eq('is_active', true)
        .or(
          `title.ilike.${like},label.ilike.${like},key.ilike.${like},description.ilike.${like}`
        )

      if (error) {
        console.error('search control points failed:', error)
        return
      }

      setSearchResults((data ?? []) as ControlPointLite[])
    } finally {
      setSearching(false)
    }
  }

  return (
    <section className="space-y-3 border-t pt-3">
      {showSearch && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-700">
            Lägg till kontrollpunkt i {room.room_label}
          </label>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            placeholder="Sök t.ex. golvbrunn, kyl, trinett…"
            value={searchTerm}
            onChange={handleSearchChange}
          />

          {searching && (
            <div className="text-[11px] text-gray-500">Söker…</div>
          )}

          {!searching && searchTerm.trim().length >= 2 && (
            <div className="max-h-40 overflow-auto rounded-md border bg-white">
              {searchResults.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500">
                  Inga kontrollpunkter hittades för “{searchTerm.trim()}”.
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
                  >
                    <span className="font-medium text-gray-900">
                      {cp.title || cp.label || cp.key}
                    </span>
                    {cp.description && (
                      <span className="text-[11px] text-gray-500 line-clamp-2">
                        {cp.description}
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
          >
            + Lägg till fri notering
          </button>
          <button
            type="button"
            onClick={() => setShowSearch(prev => !prev)}
            className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
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

        {items.map(ci => {
          const ciId = ci.id ?? ''
          const ciImages = imagesByControlItemId[ciId] || []
          const isFreeNote = ci.control_point_id === null
          const outcomes = ci.control_point_id
            ? outcomesByControlPointId[ci.control_point_id] || []
            : []
          const meta = ci.control_point_id
            ? controlPointMetaById[ci.control_point_id]
            : undefined
          const description = (meta?.description ?? '').trim()
          const selectedOutcome = ci.selected_outcome_id
            ? outcomes.find(outcome => outcome.id === ci.selected_outcome_id) || null
            : null
          const riskTemplate = (selectedOutcome?.risk_template ?? '').trim()
          const ftuTemplate = (selectedOutcome?.ftu_template ?? '').trim()
          const hasRiskTemplate = riskTemplate.length > 0
          const hasFtuTemplate = ftuTemplate.length > 0
          const effectiveStatus = ci.status
          const isGreen = !ci.selected_outcome_id && effectiveStatus === 'ok'
          const isYellow = !!ci.selected_outcome_id
          const isRed = !isGreen && !isYellow
          const rowToneClass = isFreeNote
            ? 'bg-gray-50 border-gray-200'
            : isRed
            ? 'bg-red-50 border-red-200'
            : isGreen
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'

          return (
            <div
              key={ci.id}
              className={`rounded-lg border px-3 py-2 space-y-2 ${rowToneClass}`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-900">
                  {ci.title}
                </div>

                {ci.id && (
                  <button
                    type="button"
                    onClick={() => onDeleteItem(ci.id!)}
                    className="text-[11px] text-rose-600 hover:underline"
                  >
                    {isFreeNote ? 'Ta bort notering' : 'Ta bort kontrollpunkt'}
                  </button>
                )}
              </div>

              {description.length > 0 && (
                <div className="text-[11px] text-gray-600">
                  {description}
                </div>
              )}

              {!isFreeNote && (
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
                        if (!ci.id) return
                        onUpdateItem(ci.id, {
                          status: isGreen ? RED_STATUS : 'ok',
                          selected_outcome_id: null,
                        })
                      }}
                    >
                      Inget att notera
                    </button>
                    {outcomes.map(outcome => {
                      const isActive = ci.selected_outcome_id === outcome.id
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
                            if (!ci.id) return
                            const nextNote = isActive
                              ? ci.note ?? null
                              : (ci.note?.trim()
                                  ? ci.note
                                  : (outcome.note_template ?? null))
                            onUpdateItem(ci.id, {
                              status: isActive ? RED_STATUS : 'remark',
                              selected_outcome_id: isActive ? null : outcome.id,
                              note: nextNote,
                            })
                          }}
                        >
                          {outcome.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {!isFreeNote && selectedOutcome && (hasRiskTemplate || hasFtuTemplate) && (
                <div className="space-y-2">
                  {hasRiskTemplate && (
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="text-xs font-semibold text-gray-700">
                        Risk (från databas)
                      </div>
                      <div className="text-sm text-gray-800 whitespace-pre-line">
                        {riskTemplate}
                      </div>
                    </div>
                  )}
                  {hasFtuTemplate && (
                    <div className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="text-xs font-semibold text-gray-700">
                        Fortsatt teknisk utredning (från databas)
                      </div>
                      <div className="text-sm text-gray-800 whitespace-pre-line">
                        {ftuTemplate}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-1">
                <label className="text-[11px] text-gray-600">
                  {isFreeNote ? 'Notering' : 'Förtydligande'}
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                  placeholder={
                    isFreeNote
                      ? 'Fri notering för rummet…'
                      : 'Specifik notering för just denna kontrollpunkt…'
                  }
                  value={ci.note ?? ''}
                  onChange={e =>
                    ci.id &&
                    onUpdateItem(ci.id, { note: e.target.value })
                  }
                />
              </div>

              {/* Bilder för denna kontrollpunkt */}
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

      {/* Lägg till kontrollpunkt via sök (togglar på knapp) */}
      {showSearch && (
        <div className="space-y-2">
          <label className="text-xs font-medium text-gray-700">
            Lägg till kontrollpunkt i {room.room_label}
          </label>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            placeholder="Sök t.ex. golvbrunn, kyl, trinett…"
            value={searchTerm}
            onChange={handleSearchChange}
          />

          {searching && (
            <div className="text-[11px] text-gray-500">Söker…</div>
          )}

          {!searching && searchTerm.trim().length >= 2 && (
            <div className="max-h-40 overflow-auto rounded-md border bg-white">
              {searchResults.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-500">
                  Inga kontrollpunkter hittades för “{searchTerm.trim()}”.
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
                  >
                    <span className="font-medium text-gray-900">
                      {cp.title || cp.label || cp.key}
                    </span>
                    {cp.description && (
                      <span className="text-[11px] text-gray-500 line-clamp-2">
                        {cp.description}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}











