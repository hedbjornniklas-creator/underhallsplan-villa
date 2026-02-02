// @ts-nocheck
'use client'

import { useEffect, useState, ChangeEvent, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  assignment_number: string | null
}

type SettingsExteriorItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  created_at?: string | null
  updated_at?: string | null
}

type SettingsExteriorGroup = {
  id: string
  item_id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
  field_type?: string | null
  created_at?: string | null
  updated_at?: string | null
}

type SettingsExteriorOption = {
  id: string
  group_id: string
  value: string
  label: string
  sort_order: number
  is_active: boolean
  trigger_tags?: any | null
  created_at?: string | null
  updated_at?: string | null
}

type InspectionExteriorObservation = {
  id?: string
  inspection_id: string
  exterior_item_id: string
  part_label: string | null
  values: Record<string, any>
  note: string | null
  created_at?: string | null
  updated_at?: string | null
}

type ItemBundle = SettingsExteriorItem & {
  groups: (SettingsExteriorGroup & { options: SettingsExteriorOption[] })[]
}

// Kontrollpunkter (samma tabell som insida, men här via exterior_observation_id)
type InspectionControlItem = {
  id?: string
  inspection_id: string
  exterior_observation_id: string
  control_point_id: string
  title: string
  status: string | null
  note: string | null
  sort_order: number
  selected_outcome_id: string | null
}

// Lätta kontrollpunkter från settings_control_points (scope='exterior')
type ControlPointLite = {
  id: string
  key: string
  title: string
  description: string | null
  tags: any | null
  exterior_item_key?: string | null
}

type ControlPointOutcome = {
  id: string
  control_point_id: string
  outcome_key: string
  label: string
  severity: number
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
  tags: any | null
  sort_order: number
  is_active: boolean
}

type ControlPointMeta = {
  id: string
  title: string
  description: string | null
}

// Bilder kopplade till kontrollpunkter (inspection_images.control_item_id)
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

// Storage-bucket för bilder
const IMAGE_BUCKET = 'inspection-images' as const
const RED_STATUS: InspectionControlItem['status'] = null

const getImagePublicUrl = (filePath: string) => {
  const { data } = supabase.storage.from(IMAGE_BUCKET).getPublicUrl(filePath)
  return data.publicUrl
}

export default function ObStepUtsida({ inspection }: { inspection: Inspection }) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<ItemBundle[]>([])
  const [observations, setObservations] = useState<
    Record<string, InspectionExteriorObservation[]>
  >({})
  const [controlItems, setControlItems] = useState<InspectionControlItem[]>([])
  const [controlPointMetaById, setControlPointMetaById] = useState<
    Record<string, ControlPointMeta>
  >({})
  const [outcomesByControlPointId, setOutcomesByControlPointId] = useState<
    Record<string, ControlPointOutcome[]>
  >({})

  // Bilder per kontrollpunkt (inspection_control_items)
  const [imagesByControlItemId, setImagesByControlItemId] = useState<
    Record<string, InspectionImage[]>
  >({})

  useEffect(() => {
    const missingOutcomeControlPointIds = Array.from(
      new Set(
        controlItems
          .map(ci => ci.control_point_id)
          .filter((id): id is string => !!id)
          .filter(id => !outcomesByControlPointId[id])
      )
    )

    if (missingOutcomeControlPointIds.length === 0) return

    const fetchMissingOutcomeData = async () => {
      const { data: outcomesData, error: outcomesErr } = await supabase
        .from('settings_control_point_outcomes')
        .select(
          'id, control_point_id, label, severity, note_template, risk_template, ftu_template, sort_order, is_active'
        )
        .in('control_point_id', missingOutcomeControlPointIds)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (outcomesErr) {
        console.error('settings_control_point_outcomes (utsida) error:', outcomesErr)
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

      const { data: metaData, error: metaErr } = await supabase
        .from('settings_control_points')
        .select('id, title, description')
        .in('id', missingOutcomeControlPointIds)
        .eq('is_active', true)

      if (metaErr) {
        console.error('settings_control_points (utsida) error:', metaErr)
      } else {
        const metaArr = (metaData ?? []) as ControlPointMeta[]
        const metaMap: Record<string, ControlPointMeta> = {}
        for (const meta of metaArr) {
          metaMap[meta.id] = meta
        }
        setControlPointMetaById(prev => ({ ...prev, ...metaMap }))
      }
    }

    void fetchMissingOutcomeData()
  }, [controlItems, outcomesByControlPointId])

  // -----------------------------
  // LOAD SETTINGS + OBSERVATIONER + KONTROLLPUNKTER + BILDER
  // -----------------------------
  useEffect(() => {
    if (!inspection?.id) return

    const loadAll = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1) Items (Mark, Grundmur/sockel, Fasad, Dörrar/fönster, Yttertak, Övrigt)
        const { data: itemsData, error: itemsErr } = await supabase
          .from('settings_exterior_items')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })

        if (itemsErr) {
          console.error('settings_exterior_items error:', itemsErr)
          throw new Error(itemsErr.message)
        }

        const itemsArr = (itemsData ?? []) as SettingsExteriorItem[]
        const itemIds = itemsArr.map(i => i.id)

        if (itemIds.length === 0) {
          setItems([])
          setObservations({})
          setControlItems([])
          setControlPointMetaById({})
          setOutcomesByControlPointId({})
          setImagesByControlItemId({})
          return
        }

        // 2) Groups
        const { data: groupsData, error: groupsErr } = await supabase
          .from('settings_exterior_groups')
          .select('*')
          .in('item_id', itemIds)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })

        if (groupsErr) {
          console.error('settings_exterior_groups error:', groupsErr)
          throw new Error(groupsErr.message)
        }

        const groupsArr = (groupsData ?? []) as SettingsExteriorGroup[]
        const groupIds = groupsArr.map(g => g.id)

        // 3) Options per group
        const { data: optionsData, error: optErr } = await supabase
          .from('settings_exterior_options')
          .select('*')
          .in('group_id', groupIds)
          .eq('is_active', true)
          .order('sort_order', { ascending: true })

        if (optErr) {
          console.error('settings_exterior_options error:', optErr)
          throw new Error(optErr.message)
        }

        const optionsArr = (optionsData ?? []) as SettingsExteriorOption[]

        // 4) Befintliga observationer för denna besiktning
        const { data: obsData, error: obsErr } = await supabase
          .from('inspection_exterior_observations')
          .select('*')
          .eq('inspection_id', inspection.id)
          .order('created_at', { ascending: true })

        if (obsErr) {
          console.error('inspection_exterior_observations error:', obsErr)
          throw new Error(obsErr.message)
        }

        let allObs: InspectionExteriorObservation[] = (obsData ?? []).map(o => ({
          ...o,
          values: (o.values as any) || {},
        }))

        // 4b) Säkerställ att varje komponent har minst EN "main"-observation (utan _free_note)
        for (const it of itemsArr) {
          const hasMain = allObs.some(
            o => o.exterior_item_id === it.id && !o.values?._free_note
          )

          if (!hasMain) {
            const { data: newObsData, error: newObsErr } = await supabase
              .from('inspection_exterior_observations')
              .insert({
                inspection_id: inspection.id,
                exterior_item_id: it.id,
                part_label: null,
                values: {},
                note: null,
              })
              .select('*')
              .single()

            if (newObsErr) {
              console.error('create default exterior observation failed:', newObsErr)
              continue
            }

            const newObs: InspectionExteriorObservation = {
              ...(newObsData as any),
              values: ((newObsData as any).values as any) || {},
            }

            allObs.push(newObs)

            // Skapa standardkontrollpunkter för denna komponent
            const { data: cpsData, error: cpsErr } = await supabase
              .from('settings_control_points')
              .select('id, key, title, tags, exterior_item_key')
              .eq('scope', 'exterior')
              .eq('is_active', true)
              .eq('exterior_item_key', it.key)

            if (cpsErr) {
              console.error('fetch exterior control points (init) failed:', cpsErr)
            } else {
              const cps = (cpsData ?? []) as ControlPointLite[]
              if (cps.length > 0) {
                let sortBase = 0
              const payload = cps.map(cp => {
                sortBase += 10
                return {
                  inspection_id: inspection.id,
                  exterior_observation_id: newObs.id!,
                  control_point_id: cp.id,
                  title: cp.title || cp.key,
                  status: RED_STATUS,
                  note: null,
                  sort_order: sortBase,
                }
              })

                const { error: insErr } = await supabase
                  .from('inspection_control_items')
                  .insert(payload)

                if (insErr) {
                  console.error(
                    'insert default exterior control items (init) failed:',
                    insErr
                  )
                }
              }
            }
          }
        }

        // Bygg bundles
        const optionsByGroup: Record<string, SettingsExteriorOption[]> = {}
        for (const o of optionsArr) {
          optionsByGroup[o.group_id] = optionsByGroup[o.group_id] || []
          optionsByGroup[o.group_id].push(o)
        }

        const groupsByItem: Record<
          string,
          (SettingsExteriorGroup & { options: SettingsExteriorOption[] })[]
        > = {}
        for (const g of groupsArr) {
          groupsByItem[g.item_id] = groupsByItem[g.item_id] || []
          groupsByItem[g.item_id].push({
            ...g,
            options: optionsByGroup[g.id] || [],
          })
        }

        const bundles: ItemBundle[] = itemsArr.map(it => ({
          ...it,
          groups: groupsByItem[it.id] || [],
        }))
        setItems(bundles)

        // Observationer map (per komponent)
        const obsMap: Record<string, InspectionExteriorObservation[]> = {}
        for (const o of allObs) {
          const key = o.exterior_item_id
          obsMap[key] = obsMap[key] || []
          obsMap[key].push(o)
        }
        setObservations(obsMap)

        // 5) Hämta kontrollpunkter per observation
        const obsIds = allObs
          .map(o => o.id)
          .filter((id): id is string => !!id)

        if (obsIds.length > 0) {
          const { data: ciData, error: ciErr } = await supabase
            .from('inspection_control_items')
            .select('*')
            .in('exterior_observation_id', obsIds)
            .order('sort_order', { ascending: true })

          if (ciErr) {
            console.error('inspection_control_items (utsida) error:', ciErr)
            throw new Error(ciErr.message)
          }

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
            setControlPointMetaById({})
            setOutcomesByControlPointId({})
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

              if (outcomesErr) {
                throw outcomesErr
              }

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
                'settings_control_point_outcomes (utsida) error:',
                outcomesErr
              )
              setOutcomesByControlPointId({})
            }

            try {
              const { data: metaData, error: metaErr } = await supabase
                .from('settings_control_points')
                .select('id, title, description')
                .in('id', cpIds)
                .eq('is_active', true)

              if (metaErr) {
                throw metaErr
              }

              const metaArr = (metaData ?? []) as ControlPointMeta[]
              const metaMap: Record<string, ControlPointMeta> = {}
              for (const meta of metaArr) {
                metaMap[meta.id] = meta
              }
              setControlPointMetaById(metaMap)
            } catch (metaErr) {
              console.error('settings_control_points (utsida) error:', metaErr)
              setControlPointMetaById({})
            }
          }
        } else {
          setControlItems([])
          setControlPointMetaById({})
          setOutcomesByControlPointId({})
        }

        // 6) Bilder kopplade till kontrollpunkter (control_item_id)
        const { data: imgCtrlData, error: imgCtrlErr } = await supabase
          .from('inspection_images')
          .select('*')
          .eq('inspection_id', inspection.id)
          .not('control_item_id', 'is', null)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })

        if (imgCtrlErr) {
          console.error('inspection_images (kontrollpunkter) error:', imgCtrlErr)
          throw new Error(imgCtrlErr.message)
        }

        const imgsCtrlArr = (imgCtrlData ?? []) as InspectionImage[]
        const imgCtrlMap: Record<string, InspectionImage[]> = {}
        for (const img of imgsCtrlArr) {
          if (!img.control_item_id) continue
          const key = img.control_item_id
          imgCtrlMap[key] = imgCtrlMap[key] || []
          imgCtrlMap[key].push(img)
        }
        setImagesByControlItemId(imgCtrlMap)
      } catch (e: any) {
        console.error('loadAll utsida failed:', e)
        setError(e?.message ?? 'Kunde inte ladda Utsida-data.')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
  }, [inspection?.id])

  // -----------------------------
  // OBSERVATIONER – helpers (fri notering)
  // -----------------------------
  const getItemRows = (itemId: string) => observations[itemId] || []

  const setItemRows = (itemId: string, rows: InspectionExteriorObservation[]) => {
    setObservations(prev => ({ ...prev, [itemId]: rows }))
  }

  const upsertObservationRow = async (
    row: InspectionExteriorObservation
  ): Promise<InspectionExteriorObservation> => {
    setSaving(true)
    setError(null)
    try {
      if (row.id) {
        const { data, error } = await supabase
          .from('inspection_exterior_observations')
          .update({
            part_label: row.part_label,
            values: row.values,
            note: row.note,
          })
          .eq('id', row.id)
          .select('*')
          .single()

        if (error) throw error
        const r = data as any
        return { ...r, values: (r.values as any) || {} }
      } else {
        const { data, error } = await supabase
          .from('inspection_exterior_observations')
          .insert({
            inspection_id: row.inspection_id,
            exterior_item_id: row.exterior_item_id,
            part_label: row.part_label,
            values: row.values,
            note: row.note,
          })
          .select('*')
          .single()

        if (error) throw error
        const r = data as any
        return { ...r, values: (r.values as any) || {} }
      }
    } catch (e: any) {
      console.error('upsertObservationRow utsida failed:', e)
      setError(e?.message ?? 'Kunde inte spara notering.')
      return row
    } finally {
      setSaving(false)
    }
  }

  const addFreeNoteRow = async (item: ItemBundle) => {
    const rows = getItemRows(item.id)
    const newRow: InspectionExteriorObservation = {
      inspection_id: inspection.id,
      exterior_item_id: item.id,
      part_label: '',
      values: { _free_note: true },
      note: '',
    }

    const saved = await upsertObservationRow(newRow)
    setItemRows(item.id, [...rows, saved])
  }

  const updateFreeNoteRow = async (
    itemId: string,
    rowId: string,
    patch: Partial<InspectionExteriorObservation>
  ) => {
    const rows = getItemRows(itemId)
    const index = rows.findIndex(r => r.id === rowId)
    if (index === -1) return

    const current = rows[index]
    const updated: InspectionExteriorObservation = {
      ...current,
      ...patch,
      values: {
        ...(current.values || {}),
        ...(patch.values || {}),
        _free_note: true,
      },
    }

    const optimistic = [...rows]
    optimistic[index] = updated
    setItemRows(itemId, optimistic)

    const saved = await upsertObservationRow(updated)
    const finalRows = [...getItemRows(itemId)]
    const finalIndex = finalRows.findIndex(r => r.id === rowId)
    if (finalIndex !== -1) {
      finalRows[finalIndex] = saved
      setItemRows(itemId, finalRows)
    }
  }

  const deleteFreeNoteRow = async (itemId: string, rowId: string) => {
    try {
      setSaving(true)
      setError(null)

      await supabase
        .from('inspection_exterior_observations')
        .delete()
        .eq('id', rowId)

      const rows = getItemRows(itemId)
      const filtered = rows.filter(r => r.id !== rowId)
      setItemRows(itemId, filtered)
    } catch (e: any) {
      console.error('deleteFreeNoteRow utsida failed:', e)
      setError(e?.message ?? 'Kunde inte ta bort fri notering.')
    } finally {
      setSaving(false)
    }
  }

  // -----------------------------
  // KONTROLLPUNKTER – helpers
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
            updated_at: new Date().toISOString(),
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
            exterior_observation_id: item.exterior_observation_id,
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
      console.error('upsertControlItem (utsida) failed:', e)
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

  const deleteControlItem = async (itemId: string, skipConfirm?: boolean) => {
    const item = controlItems.find(ci => ci.id === itemId)
    if (!item) return
    if (!skipConfirm && !confirm('Ta bort denna kontrollpunkt?')) return

    try {
      setSaving(true)
      setError(null)

      const { data: imgRows, error: imgFetchErr } = await supabase
        .from('inspection_images')
        .select('id, file_path')
        .eq('control_item_id', itemId)

      if (imgFetchErr) {
        console.error('fetch inspection_images (utsida) failed:', imgFetchErr)
      }

      const imageRows = (imgRows ?? []) as Pick<InspectionImage, 'id' | 'file_path'>[]
      if (imageRows.length > 0) {
        const paths = imageRows.map(img => img.file_path).filter(Boolean)
        if (paths.length > 0) {
          const { error: storageErr } = await supabase.storage
            .from(IMAGE_BUCKET)
            .remove(paths)

          if (storageErr) {
            console.error('remove storage files (utsida) failed:', storageErr)
          }
        }

        const imageIds = imageRows.map(img => img.id)
        const { error: imgDeleteErr } = await supabase
          .from('inspection_images')
          .delete()
          .in('id', imageIds)

        if (imgDeleteErr) {
          console.error('delete inspection_images (utsida) failed:', imgDeleteErr)
        }
      }

      const { error: delErr } = await supabase
        .from('inspection_control_items')
        .delete()
        .eq('id', itemId)

      if (delErr) {
        console.error('delete inspection_control_item (utsida) failed:', delErr)
        throw new Error(delErr.message)
      }

      setControlItems(prev => prev.filter(ci => ci.id !== itemId))
      setImagesByControlItemId(prev => {
        const clone = { ...prev }
        delete clone[itemId]
        return clone
      })
    } catch (e: any) {
      console.error('deleteControlItem (utsida) failed:', e)
      setError(e?.message ?? 'Kunde inte ta bort kontrollpunkt.')
    } finally {
      setSaving(false)
    }
  }

  const addControlItemFromCatalog = async (
    item: ItemBundle,
    row: InspectionExteriorObservation,
    cp: ControlPointLite
  ) => {
    if (!row.id) return

    const existingForRow = controlItems.filter(
      ci => ci.exterior_observation_id === row.id
    )
    const sortOrder =
      existingForRow.length > 0
        ? Math.max(...existingForRow.map(ci => ci.sort_order || 0)) + 10
        : 10

    const newItem: InspectionControlItem = {
      inspection_id: inspection.id,
      exterior_observation_id: row.id,
      control_point_id: cp.id,
      title: cp.title || cp.key,
      status: RED_STATUS,
      note: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    }

    const saved = await upsertControlItem(newItem)
    setControlItems(prev => [...prev, saved])
  }

  const addOutcomeControlItem = async (
    baseItem: InspectionControlItem,
    outcome: ControlPointOutcome
  ) => {
    if (!baseItem.control_point_id) return
    const group = controlItems.filter(
      ci =>
        ci.exterior_observation_id === baseItem.exterior_observation_id &&
        ci.control_point_id === baseItem.control_point_id
    )
    const maxSort = group.reduce((m, ci) => Math.max(m, ci.sort_order ?? 0), 0)

    const newItem: InspectionControlItem = {
      inspection_id: baseItem.inspection_id,
      exterior_observation_id: baseItem.exterior_observation_id,
      control_point_id: baseItem.control_point_id,
      title: baseItem.title,
      status: 'remark',
      note: (outcome.note_template ?? '').trim() || null,
      sort_order: maxSort + 10,
      selected_outcome_id: outcome.id,
    }

    const saved = await upsertControlItem(newItem)
    if (saved.id) {
      setControlItems(prev => [...prev, saved])
    }
  }

  const deleteControlItemGroup = async (
    baseItem: InspectionControlItem
  ) => {
    if (!confirm('Ta bort denna kontrollpunkt?')) return
    const group = controlItems.filter(
      ci =>
        ci.exterior_observation_id === baseItem.exterior_observation_id &&
        ci.control_point_id === baseItem.control_point_id
    )
    for (const ci of group) {
      if (ci.id) {
        await deleteControlItem(ci.id, true)
      }
    }
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

      const path = `${inspection.id}/exterior/control/${ciId}/${fileName}`

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
          exterior_observation_id: null,
          interior_room_id: null,
          control_item_id: ciId,
          file_path: path,
          label: null,
          sort_order: maxSort + 10,
        })
        .select('*')
        .single()

      if (insErr) {
        console.error('insert inspection_image (control item) failed', insErr)
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
      console.error('handleUploadImageForControlItem failed', e)
      setError(e?.message ?? 'Kunde inte ladda upp bild för kontrollpunkt.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteControlItemImage = async (imageId: string) => {
    try {
      setSaving(true)
      setError(null)

      let targetControlId: string | null = null

      for (const [ciId, arr] of Object.entries(imagesByControlItemId)) {
        const found = arr.find(img => img.id === imageId)
        if (found) {
          targetControlId = ciId
          break
        }
      }

      if (!targetControlId) return

      const { error: delErr } = await supabase
        .from('inspection_images')
        .delete()
        .eq('id', imageId)

      if (delErr) {
        console.error('delete inspection_image (control item) failed', delErr)
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
      console.error('handleDeleteControlItemImage failed', e)
      setError(e?.message ?? 'Kunde inte ta bort bild för kontrollpunkt.')
    } finally {
      setSaving(false)
    }
  }

  // -----------------------------
  // UI HELPERS
  // -----------------------------
  const itemEmoji: Record<string, string> = {
    mark: '🌱',
    grundmur_sockel: '🧱',
    fasad: '🏠',
    dorrar_fonster: '🚪',
    yttertak: '🏡',
    ovrigt: '➕',
  }

  const controlItemsByObservationId: Record<string, InspectionControlItem[]> =
    controlItems.reduce((map, ci) => {
      const key = ci.exterior_observation_id
      if (!key) return map
      if (!map[key]) map[key] = []
      map[key].push(ci)
      return map
    }, {} as Record<string, InspectionControlItem[]>)

  const renderItemCard = (item: ItemBundle) => {
    const rows = getItemRows(item.id)
    const itemAnchorId = `utsida-${item.key}`

    if (!rows || rows.length === 0) {
      return (
        <section
          key={item.id}
          id={itemAnchorId}
          className="scroll-mt-28 rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3"
        >
          <header className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-gray-900">
              <span className="mr-2">{itemEmoji[item.key] || '•'}</span>
              {item.label}
            </h3>
          </header>
          <p className="text-xs text-gray-500">Initierar komponentdata…</p>
        </section>
      )
    }

    // Huvud-observation (utan _free_note)
    const mainRow =
      rows.find(r => !r.values?._free_note) ?? rows[0]

    // Fria noteringar (med _free_note)
    const freeNoteRows = rows.filter(
      r => r.id !== mainRow.id && r.values?._free_note
    )

    const rowControlItems = mainRow.id
      ? controlItemsByObservationId[mainRow.id] || []
      : []

    return (
      <section
        key={item.id}
        id={itemAnchorId}
        className="scroll-mt-28 rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-4"
      >
        <header className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">
            <span className="mr-2">{itemEmoji[item.key] || '•'}</span>
            {item.label}
          </h3>
        </header>

        {/* Kontrollpunkter för komponenten */}
        <div className="rounded-xl bg-gray-50 ring-1 ring-gray-200 p-3 md:p-4">
          <ExteriorControlPointsSection
            item={item}
            row={mainRow}
            items={rowControlItems}
            onUpdateItem={updateControlItem}
            onDeleteItem={deleteControlItem}
            onDeleteItemGroup={deleteControlItemGroup}
            onAddOutcomeItem={addOutcomeControlItem}
            outcomesByControlPointId={outcomesByControlPointId}
            controlPointMetaById={controlPointMetaById}
            imagesByControlItemId={imagesByControlItemId}
            onUploadImageForControlItem={handleUploadImageForControlItem}
            onDeleteControlItemImage={handleDeleteControlItemImage}
          />
        </div>

        {/* Fria noteringar + knapp för ytterligare kontrollpunkt */}
        <FreeNotesSection
          item={item}
          rows={freeNoteRows}
          onAddFreeNote={() => addFreeNoteRow(item)}
          onUpdateFreeNote={(rowId, patch) =>
            updateFreeNoteRow(item.id, rowId, patch)
          }
          onDeleteFreeNote={(rowId) => deleteFreeNoteRow(item.id, rowId)}
          onAddControlFromCatalog={cp =>
            addControlItemFromCatalog(item, mainRow, cp)
          }
        />
      </section>
    )
  }

  // -----------------------------
  // RENDER
  // -----------------------------
  if (loading) {
    return <div className="p-4 text-sm text-gray-600">Laddar utsida…</div>
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        {error}
        <div className="mt-1 text-xs text-gray-500">
          Kontrollera att tabellerna settings_exterior_*,
          inspection_exterior_observations, inspection_control_items och inspection_images finns
          och att RLS/policies släpper igenom.
        </div>
      </div>
    )
  }

  if (!items.length) {
    return (
      <div className="p-4 text-sm text-gray-600">
        Inga rubriker för utsida är definierade. Lägg upp dem under Settings → Utsida.
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold text-gray-900">Byggnad – utsida</h2>
        <p className="text-sm text-gray-700">
          Här dokumenterar du utsidans komponenter per rubrik (Mark, Grundmur/sockel,
          Fasad, Dörrar/fönster, Yttertak, Övrigt). Under varje komponent visas
          kontrollpunkter med status, noteringar och bilder samt fria noteringar som
          kan användas för kompletterande information.
        </p>
      </header>

      <section className="space-y-4">
        {items.map(item => renderItemCard(item))}
      </section>
    </div>
  )
}

// =============================
// UND-KOMPONENT: Bilder per kontrollpunkt
// =============================
type ControlPointImagesSectionProps = {
  images: InspectionImage[]
  onUpload: (file: File) => void
  onDelete: (imageId: string) => void
}

function ControlPointImagesSection({
  images,
  onUpload,
  onDelete,
}: ControlPointImagesSectionProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    onUpload(file)
    e.target.value = ''
  }

  return (
    <section className="space-y-2 border-t pt-2">
      <header className="flex items-center justify-between">
        <h5 className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-900">
          <span aria-hidden="true">{'\u{1F4F7}'}</span>
          <span>Bilder (denna kontrollpunkt)</span>
        </h5>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex items-center rounded-full border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-800 hover:bg-gray-50"
        >
          + Lägg till bild
        </button>
      </header>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
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
                  className="absolute right-0.5 top-0.5 rounded-full bg-black/70 px-1 text-[8px] font-medium text-white"
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
// UND-KOMPONENT: Kontrollpunkter per komponent
type ExteriorControlPointsSectionProps = {
  item: ItemBundle
  row: InspectionExteriorObservation
  items: InspectionControlItem[]
  onUpdateItem: (itemId: string, patch: Partial<InspectionControlItem>) => void
  onDeleteItem: (itemId: string, skipConfirm?: boolean) => void
  onDeleteItemGroup: (baseItem: InspectionControlItem) => void
  onAddOutcomeItem: (
    baseItem: InspectionControlItem,
    outcome: ControlPointOutcome
  ) => void
  outcomesByControlPointId: Record<string, ControlPointOutcome[]>
  controlPointMetaById: Record<string, ControlPointMeta>
  imagesByControlItemId: Record<string, InspectionImage[]>
  onUploadImageForControlItem: (
    controlItem: InspectionControlItem,
    file: File
  ) => void
  onDeleteControlItemImage: (imageId: string) => void
}

function ExteriorControlPointsSection({
  item,
  row,
  items,
  onUpdateItem,
  onDeleteItem,
  onDeleteItemGroup,
  onAddOutcomeItem,
  outcomesByControlPointId,
  controlPointMetaById,
  imagesByControlItemId,
  onUploadImageForControlItem,
  onDeleteControlItemImage,
}: ExteriorControlPointsSectionProps) {
  const groupedItems = useMemo(() => {
    const map = new Map<string, InspectionControlItem[]>()
    for (const ci of items) {
      const cpId = ci.control_point_id
      if (!cpId) continue
      const list = map.get(cpId) ?? []
      list.push(ci)
      map.set(cpId, list)
    }
    return Array.from(map.entries()).map(([controlPointId, list]) => ({
      controlPointId,
      items: list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    }))
  }, [items])

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">
          Kontrollpunkter – {item.label}
        </h4>
        <span className="text-[11px] text-gray-500">
          Varje kontrollpunkt kan ha flera val med egna noteringar.
        </span>
      </header>

      <div className="space-y-2">
        {items.length === 0 && (
          <div className="text-xs text-gray-500">
            Inga kontrollpunkter ännu. Lägg till via knappen “Lägg till ytterligare kontrollpunkt”.
          </div>
        )}

        {groupedItems.map(group => {
          const baseItem = group.items[0]
          if (!baseItem) return null
          const outcomes = outcomesByControlPointId[group.controlPointId] || []
          const meta = controlPointMetaById[group.controlPointId]
          const description = (meta?.description ?? '').trim()
          const selectedItems = group.items.filter(ci => ci.selected_outcome_id)
          const isGreen = selectedItems.length === 0 && baseItem.status === 'ok'
          const isYellow = selectedItems.length > 0
          const isRed = !isGreen && !isYellow
          const rowToneClass = isRed
            ? 'bg-red-50 border-red-200'
            : isGreen
            ? 'bg-emerald-50 border-emerald-200'
            : 'bg-amber-50 border-amber-200'

          return (
            <div
              key={group.controlPointId}
              className={`rounded-lg border px-3 py-2 space-y-2 ${rowToneClass}`}
            >
              <div className="flex items-center justify_between gap-2">
                <div className="text-xs font-semibold text-gray-900">
                  {baseItem.title}
                </div>
                {baseItem.id && (
                  <button
                    type="button"
                    onClick={() => onDeleteItemGroup(baseItem)}
                    className="ml-auto text-[11px] text-rose-600 hover:underline"
                  >
                    Ta bort
                  </button>
                )}
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
                        })
                      } else {
                        onUpdateItem(baseItem.id, {
                          status: RED_STATUS,
                          selected_outcome_id: null,
                        })
                      }
                    }}
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
                              })
                            } else {
                              onAddOutcomeItem(baseItem, outcome)
                            }
                          }
                        }}
                      >
                        {outcome.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {selectedItems.length === 0 && (
                <div className="space-y-1">
                  <label className="text-[11px] text-gray-600">
                    Förtydligande
                  </label>
                  <textarea
                    rows={2}
                    className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                    placeholder="Specifik notering för just denna kontrollpunkt…"
                    value={baseItem.note ?? ''}
                    onChange={e =>
                      baseItem.id &&
                      onUpdateItem(baseItem.id, { note: e.target.value })
                    }
                  />
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
                    const hasRiskTemplate = riskTemplate.length > 0
                    const hasFtuTemplate = ftuTemplate.length > 0
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
                            >
                              Ta bort
                            </button>
                          )}
                        </div>

                        {(hasRiskTemplate || hasFtuTemplate) && (
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
                            Förtydligande
                          </label>
                          <textarea
                            rows={2}
                            className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                            placeholder="Specifik notering för just detta chip…"
                            value={ci.note ?? ''}
                            onChange={e =>
                              ci.id &&
                              onUpdateItem(ci.id, { note: e.target.value })
                            }
                          />
                        </div>

                        {ci.id && (
                          <ControlPointImagesSection
                            images={ciImages}
                            onUpload={file => onUploadImageForControlItem(ci, file)}
                            onDelete={onDeleteControlItemImage}
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
// UND-KOMPONENT: Fria noteringar + knapp för kontrollpunkt
// =============================
type FreeNotesSectionProps = {
  item: ItemBundle
  rows: InspectionExteriorObservation[]
  onAddFreeNote: () => void
  onUpdateFreeNote: (
    rowId: string,
    patch: Partial<InspectionExteriorObservation>
  ) => void
  onDeleteFreeNote: (rowId: string) => void
  onAddControlFromCatalog: (cp: ControlPointLite) => void
}

function FreeNotesSection({
  item,
  rows,
  onAddFreeNote,
  onUpdateFreeNote,
  onDeleteFreeNote,
  onAddControlFromCatalog,
}: FreeNotesSectionProps) {
  const [showSearch, setShowSearch] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<ControlPointLite[]>([])
  const [searching, setSearching] = useState(false)

  const handleToggleSearch = () => {
    const next = !showSearch
    setShowSearch(next)
    if (!next) {
      setSearchTerm('')
      setSearchResults([])
    }
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

      const { data, error } = await supabase
        .from('settings_control_points')
        .select('id, key, title, description, tags, exterior_item_key')
        .eq('scope', 'exterior')
        .eq('is_active', true)
        .or(
          `title.ilike.${like},key.ilike.${like},description.ilike.${like}`
        )

      if (error) {
        console.error(
          'search exterior control points (FreeNotesSection) failed:',
          error
        )
        return
      }

      setSearchResults((data ?? []) as ControlPointLite[])
    } finally {
      setSearching(false)
    }
  }

  return (
    <section className="space-y-3">
      <header className="flex flex_wrap items-center justify_between gap-2">
        <h4 className="text-sm font-semibold text-gray-900">
          Fria noteringar – {item.label}
        </h4>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddFreeNote}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            + Lägg till fri notering
          </button>
          <button
            type="button"
            onClick={handleToggleSearch}
            className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
          >
            + Lägg till ytterligare kontrollpunkt
          </button>
        </div>
      </header>

      {/* Sök-ruta för att lägga till kontrollpunkt – visas först när man klickar på knappen */}
      {showSearch && (
        <div className="space-y-2 rounded-lg border bg-gray-50 px-3 py-2">
          <label className="text-xs font-medium text-gray-700">
            Sök kontrollpunkt (alla utsides-kontrollpunkter)
          </label>
          <input
            className="w-full rounded-md border px-2 py-1.5 text-sm bg-white"
            placeholder="Sök t.ex. sprickor, rost, avrinning…"
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
                      onAddControlFromCatalog(cp)
                      setShowSearch(false)
                      setSearchTerm('')
                      setSearchResults([])
                    }}
                    className="flex w-full flex-col items-start px-3 py-2 text-left text-xs hover:bg-gray-50"
                  >
                    <span className="font-medium text-gray-900">
                      {cp.title || cp.key}
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

      {/* Lista fria noteringar */}
      {rows.length === 0 && (
        <p className="text-xs text-gray-500">
          Inga fria noteringar ännu. Använd knappen ovan om du vill lägga till en separat rad med
          rubrik/del och notering för denna komponent.
        </p>
      )}

      {rows.length > 0 && (
        <div className="space-y-2">
          {rows.map(row => (
            <div
              key={row.id}
              className="rounded-lg border bg-gray-50 px-3 py-2 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 space-y-1">
                  <label className="text-[11px] text-gray-600">
                    Del / rubrik (fri)
                  </label>
                  <input
                    className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                    placeholder="t.ex. Uterum, altanräcke, stödmur…"
                    value={row.part_label ?? ''}
                    onChange={e =>
                      row.id &&
                      onUpdateFreeNote(row.id, { part_label: e.target.value })
                    }
                  />
                </div>
                <button
                  type="button"
                  onClick={() => row.id && onDeleteFreeNote(row.id)}
                  className="text-[11px] text-red-600 hover:underline"
                >
                  Ta bort
                </button>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-gray-600">
                  Notering (fri text)
                </label>
                <textarea
                  rows={2}
                  className="w-full rounded-md border px-2 py-1.5 text-xs bg-white"
                  placeholder="Beskrivning av observationen eller kompletterande upplysning…"
                  value={row.note ?? ''}
                  onChange={e =>
                    row.id &&
                    onUpdateFreeNote(row.id, { note: e.target.value })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}






