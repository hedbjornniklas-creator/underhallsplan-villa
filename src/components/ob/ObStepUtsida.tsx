'use client'

import { useEffect, useState, ChangeEvent, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabaseClient'
import DebouncedTextarea from './DebouncedTextarea'
import ControlPointSearchDialog, {
  type ControlPointSearchMode,
} from './ControlPointSearchDialog'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  assignment_number: string | null
  status?: string | null
  locked_at?: string | null
}
type SearchMode = ControlPointSearchMode
type ValueMap = Record<string, unknown>
type ErrorLike = { code?: string; message?: string; details?: string; hint?: string }

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
  trigger_tags?: unknown
  created_at?: string | null
  updated_at?: string | null
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
  control_point_id: string | null
  title: string
  status: string | null
  note: string | null
  risk_text?: string | null
  ftu_text?: string | null
  sort_order: number
  selected_outcome_id: string | null
}

// Lätta kontrollpunkter från settings_control_points (scope='exterior')
type ControlPointLite = {
  id: string
  key: string
  title: string
  label?: string | null
  description: string | null
  scope?: string | null
  tags: unknown
  exterior_item_key?: string | null
  search_hint?: string | null
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
  tags: unknown
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

const toErrorLike = (err: unknown): ErrorLike | null => {
  if (!err || typeof err !== 'object') return null
  return err as ErrorLike
}

const serializeDbError = (err: unknown) => {
  const e = toErrorLike(err)
  if (!e) return null
  return {
    code: e.code ?? null,
    message: e.message ?? null,
    details: e.details ?? null,
    hint: e.hint ?? null,
  }
}

const isMissingIsFreeNoteColumnError = (err: unknown) => {
  const e = toErrorLike(err)
  const text = `${e?.message ?? ''} ${e?.details ?? ''} ${e?.hint ?? ''}`.toLowerCase()
  return e?.code === '42703' || (text.includes('is_free_note') && text.includes('column'))
}

const isUniqueViolationError = (err: unknown) => {
  const e = toErrorLike(err)
  const text = `${e?.message ?? ''} ${e?.details ?? ''}`.toLowerCase()
  return e?.code === '23505' || text.includes('duplicate key') || text.includes('unique')
}

export default function ObStepUtsida({ inspection }: { inspection: Inspection }) {
  const collapsedStorageKey = `ob:utsida:collapsed:${inspection.id}`
  const [loading, setLoading] = useState(true)
  const [, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isInspectionLocked = Boolean(inspection?.locked_at)

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
  // Bilder per observation/fri notering (inspection_images.exterior_observation_id)
  const [imagesByObservationId, setImagesByObservationId] = useState<
    Record<string, InspectionImage[]>
  >({})
  const [collapsedItemIds, setCollapsedItemIds] = useState<Set<string>>(() => new Set())
  const [useHybridLayout, setUseHybridLayout] = useState(false)
  const [activeHybridItemId, setActiveHybridItemId] = useState<string | null>(null)
  const supportsIsFreeNoteRef = useRef<boolean | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setUseHybridLayout(params.get('obLayout') === 'hybrid')
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(collapsedStorageKey)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      setCollapsedItemIds(new Set(parsed.filter((value): value is string => typeof value === 'string')))
    } catch (e) {
      console.warn('Kunde inte läsa sparat visningsläge för utsida:', e)
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(
        collapsedStorageKey,
        JSON.stringify(Array.from(collapsedItemIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara visningsläge för utsida:', e)
    }
  }, [collapsedItemIds, collapsedStorageKey])

  const buildObservationPayload = (base: ValueMap, isFreeNote: boolean) => {
    if (supportsIsFreeNoteRef.current === false) return base
    return { ...base, is_free_note: isFreeNote }
  }

  const fetchMainObservation = async (
    inspectionId: string,
    exteriorItemId: string
  ): Promise<{ data: InspectionExteriorObservation | null; error: unknown }> => {
    let query = supabase
      .from('inspection_exterior_observations')
      .select('*')
      .eq('inspection_id', inspectionId)
      .eq('exterior_item_id', exteriorItemId)
      .order('created_at', { ascending: true })
      .limit(1)

    if (supportsIsFreeNoteRef.current !== false) {
      query = query.eq('is_free_note', false)
    }

    const firstTry = await query.maybeSingle()
    if (!firstTry.error) {
      return { data: (firstTry.data as InspectionExteriorObservation | null) ?? null, error: null }
    }

    if (!isMissingIsFreeNoteColumnError(firstTry.error)) {
      return { data: null, error: firstTry.error }
    }

    supportsIsFreeNoteRef.current = false

    const fallback = await supabase
      .from('inspection_exterior_observations')
      .select('*')
      .eq('inspection_id', inspectionId)
      .eq('exterior_item_id', exteriorItemId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()

    return {
      data: (fallback.data as InspectionExteriorObservation | null) ?? null,
      error: fallback.error ?? null,
    }
  }

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

        const allObs: InspectionExteriorObservation[] = (
          (obsData ?? []) as Array<InspectionExteriorObservation & { values?: unknown }>
        ).map(o => ({
          ...o,
          values: (o.values as ValueMap) || {},
        }))

        // 4b) Säkerställ att varje komponent har minst EN "main"-observation (utan free_note)
        for (const it of itemsArr) {
          const hasMain = allObs.some(
            o =>
              o.exterior_item_id === it.id &&
              !(o.is_free_note === true || o.values?._free_note)
          )

          if (!hasMain && !isInspectionLocked) {
            const { data: existingMain, error: existingMainErr } = await fetchMainObservation(
              inspection.id,
              it.id
            )

            if (existingMainErr) {
              console.error(
                'fetch existing main exterior observation failed:',
                serializeDbError(existingMainErr) ?? existingMainErr
              )
            }

            if (existingMain) {
              allObs.push({
                ...existingMain,
                values: (existingMain.values as ValueMap) || {},
              })
              continue
            }

            const baseInsertPayload = {
              inspection_id: inspection.id,
              exterior_item_id: it.id,
              part_label: null,
              values: {},
              note: null,
            }

            let { data: newObsData, error: newObsErr } = await supabase
              .from('inspection_exterior_observations')
              .insert(buildObservationPayload(baseInsertPayload, false))
              .select('*')
              .single()

            if (newObsErr && isMissingIsFreeNoteColumnError(newObsErr)) {
              supportsIsFreeNoteRef.current = false
              const retry = await supabase
                .from('inspection_exterior_observations')
                .insert(baseInsertPayload)
                .select('*')
                .single()
              newObsData = retry.data
              newObsErr = retry.error
            }

            if (newObsErr && isUniqueViolationError(newObsErr)) {
              const { data: existingAfterConflict, error: fetchErr } = await fetchMainObservation(
                inspection.id,
                it.id
              )
              if (fetchErr) {
                console.error(
                  'fetch main exterior observation after unique conflict failed:',
                  serializeDbError(fetchErr) ?? fetchErr
                )
              }
              if (existingAfterConflict) {
                newObsData = existingAfterConflict
                newObsErr = null
              }
            }

            if (newObsErr) {
              console.error(
                'create default exterior observation failed:',
                serializeDbError(newObsErr) ?? newObsErr
              )
              continue
            }

            const newObs: InspectionExteriorObservation = {
              ...(newObsData as InspectionExteriorObservation),
              values: ((newObsData as InspectionExteriorObservation).values as ValueMap) || {},
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

          const ciArr = ((ciData ?? []) as InspectionControlItem[]).map(ci => ({
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

        // 7) Bilder kopplade till fria noteringar/observationer (control_item_id = null)
        const { data: imgObsData, error: imgObsErr } = await supabase
          .from('inspection_images')
          .select('*')
          .eq('inspection_id', inspection.id)
          .is('control_item_id', null)
          .not('exterior_observation_id', 'is', null)
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: true })

        if (imgObsErr) {
          console.error('inspection_images (observationer) error:', imgObsErr)
          throw new Error(imgObsErr.message)
        }

        const imgsObsArr = (imgObsData ?? []) as InspectionImage[]
        const imgObsMap: Record<string, InspectionImage[]> = {}
        for (const img of imgsObsArr) {
          if (!img.exterior_observation_id) continue
          const key = img.exterior_observation_id
          imgObsMap[key] = imgObsMap[key] || []
          imgObsMap[key].push(img)
        }
        setImagesByObservationId(imgObsMap)
      } catch (e: unknown) {
        console.error('loadAll utsida failed:', e)
        setError(e instanceof Error ? e.message : 'Kunde inte ladda Utsida-data.')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
  }, [inspection?.id, isInspectionLocked])

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
    if (isInspectionLocked) {
      setError('Besiktningen är låst (klar) och kan inte redigeras.')
      return row
    }
    setSaving(true)
    setError(null)
    try {
      if (row.id) {
        const baseUpdatePayload = {
          part_label: row.part_label,
          values: row.values,
          note: row.note,
          risk_text: row.risk_text ?? null,
          ftu_text: row.ftu_text ?? null,
        }

        let { data, error } = await supabase
          .from('inspection_exterior_observations')
          .update(buildObservationPayload(baseUpdatePayload, row.is_free_note ?? false))
          .eq('id', row.id)
          .select('*')
          .single()

        if (error && isMissingIsFreeNoteColumnError(error)) {
          supportsIsFreeNoteRef.current = false
          const retry = await supabase
            .from('inspection_exterior_observations')
            .update(baseUpdatePayload)
            .eq('id', row.id)
            .select('*')
            .single()
          data = retry.data
          error = retry.error
        }

        if (error) throw error
        const r = data as InspectionExteriorObservation
        return { ...r, values: (r.values as ValueMap) || {} }
      } else {
        const baseInsertPayload = {
          inspection_id: row.inspection_id,
          exterior_item_id: row.exterior_item_id,
          part_label: row.part_label,
          values: row.values,
          note: row.note,
          risk_text: row.risk_text ?? null,
          ftu_text: row.ftu_text ?? null,
        }

        let { data, error } = await supabase
          .from('inspection_exterior_observations')
          .insert(buildObservationPayload(baseInsertPayload, row.is_free_note ?? false))
          .select('*')
          .single()

        if (error && isMissingIsFreeNoteColumnError(error)) {
          supportsIsFreeNoteRef.current = false
          const retry = await supabase
            .from('inspection_exterior_observations')
            .insert(baseInsertPayload)
            .select('*')
            .single()
          data = retry.data
          error = retry.error
        }

        if (error) throw error
        const r = data as InspectionExteriorObservation
        return { ...r, values: (r.values as ValueMap) || {} }
      }
    } catch (e: unknown) {
      console.error('upsertObservationRow utsida failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte spara notering.')
      return row
    } finally {
      setSaving(false)
    }
  }

  const updateFreeNoteRow = async (
    itemId: string,
    rowId: string,
    patch: Partial<InspectionExteriorObservation>
  ) => {
    if (isInspectionLocked) return
    const rows = getItemRows(itemId)
    const index = rows.findIndex(r => r.id === rowId)
    if (index === -1) return

    const current = rows[index]
      const updated: InspectionExteriorObservation = {
        ...current,
        ...patch,
        is_free_note: true,
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
    if (isInspectionLocked) return
    if (!confirm('Ta bort denna fria notering?')) return
    try {
      setSaving(true)
      setError(null)

      await supabase
        .from('inspection_images')
        .delete()
        .eq('inspection_id', inspection.id)
        .eq('exterior_observation_id', rowId)
        .is('control_item_id', null)

      await supabase
        .from('inspection_exterior_observations')
        .delete()
        .eq('id', rowId)

      const rows = getItemRows(itemId)
      const filtered = rows.filter(r => r.id !== rowId)
      setItemRows(itemId, filtered)
      setImagesByObservationId(prev => {
        const next = { ...prev }
        delete next[rowId]
        return next
      })
    } catch (e: unknown) {
      console.error('deleteFreeNoteRow utsida failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort fri notering.')
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
            interior_room_id: null,
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

        if (error) throw error
        return data as InspectionControlItem
      }
    } catch (e: unknown) {
      console.error('upsertControlItem (utsida) failed:', e)
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
    } catch (e: unknown) {
      console.error('deleteControlItem (utsida) failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort kontrollpunkt.')
    } finally {
      setSaving(false)
    }
  }

  const addControlItemFromCatalog = async (
    item: ItemBundle,
    row: InspectionExteriorObservation,
    cp: ControlPointLite
  ) => {
    if (isInspectionLocked) return
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
      risk_text: null,
      ftu_text: null,
      sort_order: sortOrder,
      selected_outcome_id: null,
    }

    const saved = await upsertControlItem(newItem)
    setControlItems(prev => [...prev, saved])
  }

  const addFreeNoteControlItem = async (
    row: InspectionExteriorObservation
  ) => {
    if (isInspectionLocked) return
    if (!row.id) return

    const existingForRow = controlItems.filter(
      ci => ci.exterior_observation_id === row.id
    )
    const sortOrder =
      existingForRow.length > 0
        ? Math.min(...existingForRow.map(ci => ci.sort_order || 0)) - 10
        : 10

    const newItem: InspectionControlItem = {
      inspection_id: inspection.id,
      exterior_observation_id: row.id,
      control_point_id: null,
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

  const addOutcomeControlItem = async (
    baseItem: InspectionControlItem,
    outcome: ControlPointOutcome
  ) => {
    if (isInspectionLocked) return
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
      risk_text: (outcome.risk_template ?? '').trim() || null,
      ftu_text: (outcome.ftu_template ?? '').trim() || null,
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
    if (isInspectionLocked) return
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
    if (isInspectionLocked) return
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
    } catch (e: unknown) {
      console.error('handleUploadImageForControlItem failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ladda upp bild för kontrollpunkt.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteControlItemImage = async (imageId: string) => {
    if (isInspectionLocked) return
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
    } catch (e: unknown) {
      console.error('handleDeleteControlItemImage failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort bild för kontrollpunkt.')
    } finally {
      setSaving(false)
    }
  }

  const handleUploadImageForObservation = async (
    observation: InspectionExteriorObservation,
    file: File
  ) => {
    if (isInspectionLocked) return
    if (!observation.id) return

    try {
      setSaving(true)
      setError(null)

      const obsId = observation.id
      const currentImages = imagesByObservationId[obsId] || []
      const maxSort =
        currentImages.length > 0
          ? Math.max(...currentImages.map(img => img.sort_order || 0))
          : 0

      const ext = file.name.split('.').pop() || 'jpg'
      const safeExt = ext.toLowerCase()
      const fileName = `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}.${safeExt}`

      const path = `${inspection.id}/exterior/observation/${obsId}/${fileName}`

      const { error: uploadErr } = await supabase.storage
        .from(IMAGE_BUCKET)
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        })

      if (uploadErr) {
        console.error('upload observation image failed', uploadErr)
        throw new Error(uploadErr.message)
      }

      const { data, error: insErr } = await supabase
        .from('inspection_images')
        .insert({
          inspection_id: inspection.id,
          exterior_observation_id: obsId,
          interior_room_id: null,
          control_item_id: null,
          file_path: path,
          label: null,
          sort_order: maxSort + 10,
        })
        .select('*')
        .single()

      if (insErr) {
        console.error('insert inspection_image (observation) failed', insErr)
        throw new Error(insErr.message)
      }

      const img = data as InspectionImage
      setImagesByObservationId(prev => {
        const prevArr = prev[obsId] || []
        return {
          ...prev,
          [obsId]: [...prevArr, img].sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
          ),
        }
      })
    } catch (e: unknown) {
      console.error('handleUploadImageForObservation failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ladda upp bild för fri notering.')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteObservationImage = async (imageId: string) => {
    if (isInspectionLocked) return
    try {
      setSaving(true)
      setError(null)

      let targetObservationId: string | null = null
      for (const [obsId, arr] of Object.entries(imagesByObservationId)) {
        const found = arr.find(img => img.id === imageId)
        if (found) {
          targetObservationId = obsId
          break
        }
      }

      if (!targetObservationId) return

      const { error: delErr } = await supabase
        .from('inspection_images')
        .delete()
        .eq('id', imageId)

      if (delErr) {
        console.error('delete inspection_image (observation) failed', delErr)
        throw new Error(delErr.message)
      }

      setImagesByObservationId(prev => {
        const prevArr = prev[targetObservationId!] || []
        return {
          ...prev,
          [targetObservationId!]: prevArr.filter(img => img.id !== imageId),
        }
      })
    } catch (e: unknown) {
      console.error('handleDeleteObservationImage failed', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ta bort bild för fri notering.')
    } finally {
      setSaving(false)
    }
  }

  // -----------------------------
  // UI HELPERS
  // -----------------------------
  const itemEmoji: Record<string, string> = {
    mark: '\u{1F331}',
    grundmur_sockel: '\u{1F9F1}',
    fasad: '\u{1F3E0}',
    dorrar_fonster: '\u{1F6AA}',
    yttertak: '\u{1F3E1}',
    ovrigt: '\u2795',
  }
  const scrollToItemAnchor = (itemKey: string) => {
    if (!itemKey) return
    const element = document.getElementById(`utsida-${itemKey}`)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const controlItemsByObservationId: Record<string, InspectionControlItem[]> =
    controlItems.reduce((map, ci) => {
      const key = ci.exterior_observation_id
      if (!key) return map
      if (!map[key]) map[key] = []
      map[key].push(ci)
      return map
    }, {} as Record<string, InspectionControlItem[]>)

  const toggleItemCollapsed = (itemId: string) => {
    setCollapsedItemIds(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) {
        next.delete(itemId)
      } else {
        next.add(itemId)
      }
      return next
    })
  }

  const isFreeNoteRow = (row: InspectionExteriorObservation) =>
    row.is_free_note === true || row.values?._free_note === true

  const getItemSummary = (item: ItemBundle) => {
    const rows = getItemRows(item.id)
    if (!rows.length) return 'Initierar komponentdata'

    const observationIds = rows
      .map(row => row.id)
      .filter((id): id is string => !!id)
    const itemControlItems = observationIds.flatMap(id => controlItemsByObservationId[id] || [])
    const freeNoteRows = rows.filter(isFreeNoteRow)

    const noteCount =
      itemControlItems.filter(ci =>
        [ci.note, ci.risk_text, ci.ftu_text].some(value => String(value ?? '').trim().length > 0)
      ).length +
      freeNoteRows.filter(row =>
        [row.note, row.risk_text, row.ftu_text].some(value => String(value ?? '').trim().length > 0)
      ).length
    const imageCount =
      itemControlItems.reduce((sum, ci) => sum + (ci.id ? (imagesByControlItemId[ci.id] || []).length : 0), 0) +
      observationIds.reduce((sum, id) => sum + (imagesByObservationId[id] || []).length, 0)

    const parts = [
      `${itemControlItems.length} kontrollpunkter`,
      noteCount > 0 ? `${noteCount} noteringar` : 'inga noteringar',
      imageCount > 0 ? `${imageCount} bilder` : null,
    ].filter(Boolean)

    return parts.join(' · ')
  }

  const renderItemCard = (
    item: ItemBundle,
    options: { forceExpanded?: boolean; embedded?: boolean; hideHeader?: boolean } = {}
  ) => {
    const rows = getItemRows(item.id)
    const itemAnchorId = `utsida-${item.key}`
    const isCollapsed = options.forceExpanded ? false : collapsedItemIds.has(item.id)
    const sectionClassName = options.embedded
      ? 'w-full min-w-0 max-w-full space-y-4'
      : 'w-full min-w-0 max-w-full scroll-mt-28 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-4'

    if (!rows || rows.length === 0) {
      return (
        <section
          key={item.id}
          id={itemAnchorId}
          className={options.embedded ? 'w-full min-w-0 max-w-full space-y-3' : 'w-full min-w-0 max-w-full scroll-mt-28 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-gray-200 p-4 md:p-5 space-y-3'}
        >
          {!options.hideHeader ? (
            <header className="flex min-w-0 max-w-full items-center justify-between gap-2">
              <h3 className="min-w-0 text-base font-semibold text-gray-900">
                <span className="mr-2">{itemEmoji[item.key] || '•'}</span>
                {item.label}
              </h3>
              {!options.forceExpanded ? (
                <button
                  type="button"
                  onClick={() => toggleItemCollapsed(item.id)}
                  className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                  aria-expanded={!isCollapsed}
                >
                  {isCollapsed ? 'Visa' : 'Dölj'}
                </button>
              ) : null}
            </header>
          ) : null}
          {!isCollapsed ? (
            <p className="text-xs text-gray-500">Initierar komponentdata…</p>
          ) : null}
        </section>
      )
    }

    // Huvud-observation (utan free_note)
    const mainRow = rows.find(r => !isFreeNoteRow(r)) ?? rows[0]

    // Fria noteringar (med free_note)
    const freeNoteRows = rows
      .filter(r => r.id !== mainRow.id && isFreeNoteRow(r))
      .sort((a, b) => {
        const aTime = a.created_at ? Date.parse(a.created_at) : Number.NaN
        const bTime = b.created_at ? Date.parse(b.created_at) : Number.NaN
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0
        if (Number.isNaN(aTime)) return 1
        if (Number.isNaN(bTime)) return -1
        return bTime - aTime
      })

    const rowControlItems = mainRow.id
      ? controlItemsByObservationId[mainRow.id] || []
      : []

    return (
      <section
        key={item.id}
        id={itemAnchorId}
        className={sectionClassName}
      >
        {!options.hideHeader ? (
          <header className="flex min-w-0 max-w-full items-center justify-between gap-2">
            <h3 className="min-w-0 text-base font-semibold text-gray-900">
              <span className="mr-2">{itemEmoji[item.key] || '•'}</span>
              {item.label}
            </h3>
            {!options.forceExpanded ? (
              <button
                type="button"
                onClick={() => toggleItemCollapsed(item.id)}
                className="shrink-0 rounded-full border border-gray-300 bg-white px-3 py-1 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
                aria-expanded={!isCollapsed}
              >
                {isCollapsed ? 'Visa' : 'Dölj'}
              </button>
            ) : null}
          </header>
        ) : null}

        {!isCollapsed ? (
          <>
            {/* Kontrollpunkter för komponenten */}
            <ExteriorControlPointsSection
              item={item}
              collapsedStorageKey={`${collapsedStorageKey}:control-points:${item.id}`}
              items={rowControlItems}
              isInspectionLocked={isInspectionLocked}
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

            {/* Fria noteringar + knapp för ytterligare kontrollpunkt */}
            <FreeNotesSection
              item={item}
              collapsedStorageKey={`${collapsedStorageKey}:free-notes:${item.id}`}
              rows={freeNoteRows}
              imagesByObservationId={imagesByObservationId}
              onAddNewFreeNote={() => addFreeNoteControlItem(mainRow)}
              onUpdateFreeNote={(rowId, patch) =>
                updateFreeNoteRow(item.id, rowId, patch)
              }
              onDeleteFreeNote={(rowId) => deleteFreeNoteRow(item.id, rowId)}
              onUploadImageForObservation={handleUploadImageForObservation}
              onDeleteObservationImage={handleDeleteObservationImage}
              onAddControlFromCatalog={cp =>
                addControlItemFromCatalog(item, mainRow, cp)
              }
              isInspectionLocked={isInspectionLocked}
            />
          </>
        ) : null}
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
        Inga rubriker för utsida är definierade. Lägg upp dem under Settings ? Utsida.
      </div>
    )
  }

  if (useHybridLayout) {
    const activeItem = items.find(item => item.id === activeHybridItemId) ?? null
    const activeIndex = activeItem ? items.findIndex(item => item.id === activeItem.id) : -1
    const previousItem = activeIndex > 0 ? items[activeIndex - 1] : null
    const nextItem =
      activeIndex >= 0 && activeIndex < items.length - 1 ? items[activeIndex + 1] : null
    const closePanel = () => setActiveHybridItemId(null)
    const panelContent = activeItem ? (
      <>
        <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-4 py-4 md:px-6">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Utsida
            </div>
            <h3 className="mt-1 truncate text-xl font-semibold text-gray-900">
              <span className="mr-2">{itemEmoji[activeItem.key] || '•'}</span>
              {activeItem.label}
            </h3>
            <p className="mt-1 text-xs text-gray-500">{getItemSummary(activeItem)}</p>
          </div>
          <button
            type="button"
            onClick={closePanel}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Stäng
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 md:px-6">
          {renderItemCard(activeItem, {
            forceExpanded: true,
            embedded: true,
            hideHeader: true,
          })}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-gray-200 px-4 py-3 md:px-6">
          <button
            type="button"
            onClick={() => previousItem && setActiveHybridItemId(previousItem.id)}
            disabled={!previousItem}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Föregående
          </button>
          <button
            type="button"
            onClick={() => nextItem && setActiveHybridItemId(nextItem.id)}
            disabled={!nextItem}
            className="rounded-full border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Nästa
          </button>
        </footer>
      </>
    ) : null

    return (
      <div className="w-full min-w-0 max-w-full overflow-x-hidden space-y-5">
        <section className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white/95 p-4 md:p-5 space-y-3">
          <header className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">Byggnad – utsida</h2>
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">
                Paneltest
              </span>
            </div>
            <p className="text-xs text-gray-600">
              Testvy. Sparning, låsning och rapportdata använder samma logik som ordinarie vy.
            </p>
          </header>

          {isInspectionLocked ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Besiktningen är låst. Utsida är skrivskyddad.
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-gray-200 md:p-4">
          <div className="mb-3 flex items-center justify-between gap-3 px-1">
            <div className="text-xs font-semibold uppercase text-gray-500">
              Delar
            </div>
            <div className="text-xs text-gray-500">
              Klicka för att öppna arbetsfönster
            </div>
          </div>
          <div className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {items.map(item => {
              const isActive = activeItem?.id === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveHybridItemId(item.id)}
                  className={`flex w-full items-center gap-3 px-3 py-3 text-left transition ${
                    isActive
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <span aria-hidden="true" className="shrink-0">
                    {itemEmoji[item.key] || '•'}
                  </span>
                  <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[220px_minmax(0,1fr)] md:items-center">
                    <div className="truncate text-sm font-semibold">{item.label}</div>
                    <div
                      className={`truncate text-xs md:text-sm ${
                        isActive ? 'text-gray-200' : 'text-gray-500'
                      }`}
                    >
                      {getItemSummary(item)}
                    </div>
                  </div>
                  <span
                    aria-hidden="true"
                    className={`shrink-0 text-lg leading-none ${
                      isActive ? 'text-gray-200' : 'text-gray-400'
                    }`}
                  >
                    ›
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        {activeItem && panelContent ? (
          <>
            <aside className="fixed inset-y-0 right-0 z-50 hidden w-full max-w-4xl border-l border-gray-200 bg-white shadow-2xl lg:flex lg:flex-col">
              {panelContent}
            </aside>
            <section className="fixed inset-0 z-50 flex flex-col bg-white lg:hidden">
              {panelContent}
            </section>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-hidden space-y-5">
      <section className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-gray-200 bg-white/95 p-4 md:p-5 space-y-4">
        <header className="space-y-1">
          <h2 className="text-xl font-semibold text-gray-900">Byggnad – utsida</h2>
          <p className="text-sm text-gray-700">
            Här dokumenterar du utsidans komponenter per rubrik (Mark, Grundmur/sockel,
            Fasad, Dörrar/fönster, Yttertak, Övrigt). Under varje komponent visas
            kontrollpunkter med status, noteringar och bilder samt fria noteringar som
            kan användas för kompletterande information.
          </p>
        </header>

        <section className="flex flex-wrap items-center gap-2">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              onClick={() => scrollToItemAnchor(item.key)}
              className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs text-gray-800 hover:bg-gray-50"
            >
              <span className="mr-1">{itemEmoji[item.key] || '•'}</span>
              {item.label}
            </button>
          ))}
        </section>
      </section>

      <section className="w-full min-w-0 max-w-full space-y-4">
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
  title?: string
  disabled?: boolean
}

function ControlPointImagesSection({
  images,
  onUpload,
  onDelete,
  title,
  disabled = false,
}: ControlPointImagesSectionProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const libraryInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
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
          <span>{title ?? 'Bilder (denna kontrollpunkt)'}</span>
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
  collapsedStorageKey: string
  items: InspectionControlItem[]
  isInspectionLocked: boolean
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
  collapsedStorageKey,
  items,
  isInspectionLocked,
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
  const freeNoteItems = useMemo(
    () =>
      items
        .filter(ci => ci.control_point_id === null)
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [items]
  )
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

  useEffect(() => {
    hasLoadedCollapsedGroupsRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(collapsedStorageKey)
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
      console.warn('Kunde inte läsa dolda kontrollpunkter för utsida:', e)
      setCollapsedGroupIds(new Set())
    } finally {
      hasLoadedCollapsedGroupsRef.current = true
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedCollapsedGroupsRef.current) return
    try {
      window.localStorage.setItem(
        collapsedStorageKey,
        JSON.stringify(Array.from(collapsedGroupIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara dolda kontrollpunkter för utsida:', e)
    }
  }, [collapsedGroupIds, collapsedStorageKey])

  useEffect(() => {
    hasLoadedCollapsedFreeNotesRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(`${collapsedStorageKey}:free-control-notes`)
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
      console.warn('Kunde inte läsa dolda fria kontrollpunkter för utsida:', e)
      setCollapsedFreeNoteIds(new Set())
    } finally {
      hasLoadedCollapsedFreeNotesRef.current = true
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedCollapsedFreeNotesRef.current) return
    try {
      window.localStorage.setItem(
        `${collapsedStorageKey}:free-control-notes`,
        JSON.stringify(Array.from(collapsedFreeNoteIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara dolda fria kontrollpunkter för utsida:', e)
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

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-900">
          Kontrollpunkter – {item.label}
        </h4>
      </header>

      <div className="space-y-2">
        {groupedItems.length === 0 && freeNoteItems.length === 0 && (
          <div className="text-xs text-gray-500">
            Inga kontrollpunkter ännu. Lägg till via knappen Lägg till ytterligare kontrollpunkt.
          </div>
        )}

        {freeNoteItems.map(ci => {
          const ciId = ci.id ?? ''
          const ciImages = ciId ? imagesByControlItemId[ciId] || [] : []
          const isCollapsed = ciId ? collapsedFreeNoteIds.has(ciId) : false

          return (
            <div
              key={ci.id}
              className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-gray-900">
                  {ci.title || 'Fri notering'}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => ciId && toggleFreeNoteCollapsed(ciId)}
                    className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                    aria-expanded={!isCollapsed}
                    disabled={!ciId}
                  >
                    {isCollapsed ? 'Visa' : 'Dölj'}
                  </button>
                  {ci.id && (
                    <button
                      type="button"
                      onClick={() => onDeleteItem(ci.id!)}
                      className="text-[11px] text-rose-600 hover:underline"
                      disabled={isInspectionLocked}
                    >
                      Ta bort
                    </button>
                  )}
                </div>
              </div>

              {!isCollapsed && (
                <>
                  <div className="space-y-1">
                    <label className="text-[11px] text-gray-600">
                      Notering
                    </label>
                    <DebouncedTextarea
                      rows={2}
                      className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                      placeholder={`Fri notering för ${item.label.toLowerCase()}...`}
                      value={ci.note ?? ''}
                      onSave={value => {
                        if (ci.id) onUpdateItem(ci.id, { note: value })
                      }}
                      readOnly={isInspectionLocked}
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] text-gray-600">
                      Riskanalys
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
                    <label className="text-[11px] text-gray-600">
                      Fortsatt teknisk utredning (FTU)
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
                    <ControlPointImagesSection
                      images={ciImages}
                      onUpload={file => onUploadImageForControlItem(ci, file)}
                      onDelete={onDeleteControlItemImage}
                      title="Bilder"
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
              ? `${selectedItems.length} vald${selectedItems.length === 1 ? '' : 'a'} chip`
              : 'Ej färdig'
            return (
              <div
                key={group.controlPointId}
                className={`rounded-lg border px-3 py-2 ${rowToneClass}`}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 truncate text-xs font-semibold text-gray-900">
                    {baseItem.title}
                  </div>
                  <span
                    className={`rounded-full border bg-white px-2 py-0.5 text-[10px] font-medium ${collapsedBadgeClass}`}
                  >
                    {collapsedBadgeText}
                  </span>
                  <div className="ml-auto flex shrink-0 items-center gap-2">
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
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="min-w-0 text-xs font-semibold text-gray-900">
                  {baseItem.title}
                </div>
                <div className="ml-auto flex shrink-0 items-center gap-2">
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
                      } else {
                        onUpdateItem(baseItem.id, {
                          status: RED_STATUS,
                          selected_outcome_id: null,
                          risk_text: null,
                          ftu_text: null,
                        })
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
                    <ControlPointImagesSection
                      images={imagesByControlItemId[baseItem.id] || []}
                      onUpload={file => onUploadImageForControlItem(baseItem, file)}
                      onDelete={onDeleteControlItemImage}
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
                          <label className="text-[11px] text-gray-600">
                            🧱 Notering
                          </label>
                          <DebouncedTextarea
                            rows={2}
                            className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                            placeholder="Notering för just detta chip…"
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
                          <ControlPointImagesSection
                            images={ciImages}
                            onUpload={file => onUploadImageForControlItem(ci, file)}
                            onDelete={onDeleteControlItemImage}
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
// UND-KOMPONENT: Fria noteringar + knapp för kontrollpunkt
// =============================
type FreeNotesSectionProps = {
  item: ItemBundle
  collapsedStorageKey: string
  rows: InspectionExteriorObservation[]
  imagesByObservationId: Record<string, InspectionImage[]>
  isInspectionLocked: boolean
  onAddNewFreeNote: () => void
  onUpdateFreeNote: (
    rowId: string,
    patch: Partial<InspectionExteriorObservation>
  ) => void
  onDeleteFreeNote: (rowId: string) => void
  onUploadImageForObservation: (
    observation: InspectionExteriorObservation,
    file: File
  ) => void
  onDeleteObservationImage: (imageId: string) => void
  onAddControlFromCatalog: (cp: ControlPointLite) => void
}

function FreeNotesSection({
  item,
  collapsedStorageKey,
  rows,
  imagesByObservationId,
  isInspectionLocked,
  onAddNewFreeNote,
  onUpdateFreeNote,
  onDeleteFreeNote,
  onUploadImageForObservation,
  onDeleteObservationImage,
  onAddControlFromCatalog,
}: FreeNotesSectionProps) {
  const [showSearch, setShowSearch] = useState(false)
  const [searchMode, setSearchMode] = useState<SearchMode>('control_points')
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<ControlPointLite[]>([])
  const [searching, setSearching] = useState(false)
  const [collapsedFreeNoteIds, setCollapsedFreeNoteIds] = useState<Set<string>>(
    () => new Set()
  )
  const hasLoadedCollapsedFreeNotesRef = useRef(false)

  useEffect(() => {
    hasLoadedCollapsedFreeNotesRef.current = false
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(collapsedStorageKey)
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
      console.warn('Kunde inte läsa dolda fria noteringar för utsida:', e)
      setCollapsedFreeNoteIds(new Set())
    } finally {
      hasLoadedCollapsedFreeNotesRef.current = true
    }
  }, [collapsedStorageKey])

  useEffect(() => {
    if (typeof window === 'undefined' || !hasLoadedCollapsedFreeNotesRef.current) return
    try {
      window.localStorage.setItem(
        collapsedStorageKey,
        JSON.stringify(Array.from(collapsedFreeNoteIds.values()))
      )
    } catch (e) {
      console.warn('Kunde inte spara dolda fria noteringar för utsida:', e)
    }
  }, [collapsedFreeNoteIds, collapsedStorageKey])

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

  const handleCloseSearch = () => {
    setShowSearch(false)
    clearSearch()
  }

  const handleSearchModeChange = (mode: SearchMode) => {
    if (mode === searchMode) return
    setSearchMode(mode)
    clearSearch()
  }

  const toggleFreeNoteCollapsed = (rowId: string) => {
    setCollapsedFreeNoteIds(prev => {
      const next = new Set(prev)
      if (next.has(rowId)) {
        next.delete(rowId)
      } else {
        next.add(rowId)
      }
      return next
    })
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
          .select('id, key, title, label, description, scope, tags, exterior_item_key')
          .eq('is_active', true)
          .or(
            `title.ilike.${like},label.ilike.${like},key.ilike.${like},description.ilike.${like}`
          )

        if (error) {
          console.error(
            'search exterior control points (FreeNotesSection) failed:',
            error
          )
          return
        }

        setSearchResults((data ?? []) as ControlPointLite[])
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
        console.error(
          'search exterior control point outcomes (FreeNotesSection) failed:',
          outcomesError
        )
        return
      }

      const outcomes = (outcomeRows ?? []) as Array<{
        control_point_id: string | null
        label: string | null
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
        .select('id, key, title, label, description, scope, tags, exterior_item_key')
        .eq('is_active', true)
        .in('id', controlPointIds)

      if (controlPointsError) {
        console.error(
          'search exterior control points by outcomes (FreeNotesSection) failed:',
          controlPointsError
        )
        return
      }

      const outcomeLabelsByControlPointId = outcomes.reduce<Record<string, string[]>>(
        (acc, outcome) => {
          const controlPointId = outcome.control_point_id
          const label = (outcome.label ?? '').trim()
          if (!controlPointId || !label) return acc
          const current = acc[controlPointId] || []
          if (!current.includes(label)) current.push(label)
          acc[controlPointId] = current
          return acc
        },
        {}
      )

      const points = (controlPointsData ?? []) as ControlPointLite[]
      setSearchResults(
        points.map(cp => {
          const labels = outcomeLabelsByControlPointId[cp.id] || []
          return {
            ...cp,
            search_hint:
              labels.length > 0
                ? `Chipträff: ${labels.slice(0, 3).join(', ')}`
                : 'Chipträff',
          }
        })
      )
    } finally {
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

  const hasFreeNotes = rows.length > 0

  return (
    <section className="space-y-3">
      <header className="flex justify-end">
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onAddNewFreeNote}
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

      {/* Sök-ruta för att lägga till kontrollpunkt – visas först när man klickar på knappen */}
      <ControlPointSearchDialog
        open={showSearch}
        title="Lägg till kontrollpunkt"
        contextLabel={item.label}
        searchMode={searchMode}
        searchTerm={searchTerm}
        searchResults={searchResults}
        searching={searching}
        disabled={isInspectionLocked}
        controlPointPlaceholder="Sök t.ex. sprickor, rost, avrinning..."
        chipPlaceholder="Sök chip, t.ex. spricka, fukt, missfärgning..."
        scopeLabelForResult={controlPointScopeLabel}
        onSearchModeChange={handleSearchModeChange}
        onSearchChange={handleSearchChange}
        onSelect={cp => {
          onAddControlFromCatalog(cp)
          handleCloseSearch()
        }}
        onClose={handleCloseSearch}
      />

      {/* Äldre fria observationer visas kvar för bakåtkompatibilitet. */}
      {hasFreeNotes && (
        <div className="space-y-2">
          {rows.map(row => {
            const rowId = row.id ?? ''
            const isCollapsed = rowId ? collapsedFreeNoteIds.has(rowId) : false

            return (
              <div
                key={row.id}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex-1">
                    <input
                      className="w-full rounded-md border border-transparent bg-transparent px-0 py-0.5 text-xs font-semibold text-gray-900 placeholder:text-gray-500 focus:border-gray-300 focus:bg-white focus:px-2 focus:py-1.5"
                      placeholder="Rubrik"
                      value={row.part_label ?? ''}
                      onChange={e =>
                        row.id &&
                        onUpdateFreeNote(row.id, { part_label: e.target.value })
                      }
                      readOnly={isInspectionLocked}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => rowId && toggleFreeNoteCollapsed(rowId)}
                      className="text-[11px] text-gray-700 hover:underline"
                      aria-expanded={!isCollapsed}
                      disabled={!rowId}
                    >
                      {isCollapsed ? 'Visa' : 'Dölj'}
                    </button>
                    <button
                      type="button"
                      onClick={() => row.id && onDeleteFreeNote(row.id)}
                      className="text-[11px] text-red-600 hover:underline"
                      disabled={isInspectionLocked}
                    >
                      Ta bort
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <>
                    <div className="space-y-1">
                      <label className="text-[11px] text-gray-600">
                        Notering
                      </label>
                      <DebouncedTextarea
                        rows={2}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                        placeholder="Beskrivning av observationen eller kompletterande upplysning…"
                        value={row.note ?? ''}
                        onSave={value => {
                          if (row.id) onUpdateFreeNote(row.id, { note: value })
                        }}
                        readOnly={isInspectionLocked}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-gray-600">
                        Riskanalys
                      </label>
                      <DebouncedTextarea
                        rows={3}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                        placeholder="Beskriv riskanalys..."
                        value={row.risk_text ?? ''}
                        onSave={value => {
                          if (row.id) onUpdateFreeNote(row.id, { risk_text: value })
                        }}
                        readOnly={isInspectionLocked}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[11px] text-gray-600">
                        Fortsatt teknisk utredning (FTU)
                      </label>
                      <DebouncedTextarea
                        rows={3}
                        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm md:text-xs text-gray-900 placeholder:text-gray-500"
                        placeholder="Beskriv fortsatt teknisk utredning..."
                        value={row.ftu_text ?? ''}
                        onSave={value => {
                          if (row.id) onUpdateFreeNote(row.id, { ftu_text: value })
                        }}
                        readOnly={isInspectionLocked}
                      />
                    </div>

                    {row.id && (
                      <ControlPointImagesSection
                        images={imagesByObservationId[row.id] || []}
                        onUpload={file => onUploadImageForObservation(row, file)}
                        onDelete={onDeleteObservationImage}
                        title="Bilder"
                        disabled={isInspectionLocked}
                      />
                    )}
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}














