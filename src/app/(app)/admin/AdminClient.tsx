'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import type { Database } from '@/types/supabase'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import EbSettingsPanel from '@/components/eb/EbSettingsPanel'
import ForutsattningarSettingsPage from '@/app/(app)/settings/forutsattningar/page'
import ObUtsidaSettingsPage from '@/app/(app)/settings/ob-utsida/page'
import {
  BESIKTAPP_ADMIN_TABS,
  type BesiktAppAdminTab as AdminTab,
} from '@/lib/admin/navigation'

type DocType = {
  id: string
  code: string
  label: string
  category: string | null
  applies_to: string | null
  description: string | null
  is_default: boolean | null
  is_active: boolean | null
}

type DocDraft = {
  id?: string
  code: string
  label: string
  category: string | null
  applies_to: string | null
  description: string | null
  is_default: boolean
  is_active: boolean
}

type CompType = {
  id: string
  code: string | null
  name: string
  category: string | null
  default_lifespan_years: number | null
  maintenance_interval_years: number | null
  notes: string | null
}

type RoomType = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type RoomTypeDraft = {
  id?: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type AddonServiceType = {
  id: string
  key: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type AddonServiceDraft = {
  id?: string
  key: string
  name: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type CertificationType = {
  id: string
  key: string
  name: string
  description: string | null
  category: 'certification' | 'membership'
  requires_number: boolean
  requires_valid_to: boolean
  number_label: string | null
  valid_to_label: string | null
  sort_order: number
  is_active: boolean
}

type CertificationDraft = {
  id?: string
  key: string
  name: string
  description: string | null
  category: 'certification' | 'membership'
  requires_number: boolean
  requires_valid_to: boolean
  number_label: string | null
  valid_to_label: string | null
  sort_order: number
  is_active: boolean
}

type ExteriorItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type ControlPointRow = Database['public']['Tables']['settings_control_points']['Row'] & {
  applies_to?: string[] | null
}

type ControlPointDraft = {
  id?: string
  key: string
  title: string
  description: string | null
  scope: string
  applies_to: string[]
  exterior_item_key: string | null
  sort_order: number | null
  is_active: boolean
  default_risk_code: string | null
  default_ftu_code: string | null
  trigger_year_from: number | null
  trigger_year_to: number | null
  trigger_room_types_text: string
  trigger_component_keys_text: string
  trigger_foundation_types_text: string
  trigger_tags_text: string
  tags_text: string
  risk_tags_text: string
  created_at?: string
  updated_at?: string | null
}

type ControlPointOutcomeRow = {
  id: string
  control_point_id: string
  outcome_key: string
  label: string
  severity: string | null
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
  sort_order: number
  is_active: boolean
}

type ControlPointOutcomeDraft = {
  id?: string
  control_point_id: string
  outcome_key: string
  label: string
  severity: string | null
  note_template: string | null
  risk_template: string | null
  ftu_template: string | null
  sort_order: number
  is_active: boolean
}

export default function AdminClient() {
  const router = useRouter()
  const search = useSearchParams()

  const initialTab = (search.get('tab') === 'comps'
    ? 'comps'
    : search.get('tab') === 'control-points'
      ? 'control-points'
    : search.get('tab') === 'forutsattningar'
      ? 'forutsattningar'
    : search.get('tab') === 'exterior-items'
      ? 'exterior-items'
    : search.get('tab') === 'room-types'
      ? 'room-types'
    : search.get('tab') === 'certifications'
      ? 'certifications'
      : search.get('tab') === 'addon-services'
        ? 'addon-services'
      : search.get('tab') === 'eb'
        ? 'eb'
        : 'docs') as AdminTab
  const [tab, setTab] = useState<AdminTab>(initialTab)

  // Synka tab <-> URL
  useEffect(() => {
    const t = search.get('tab')
    if (t === 'docs' || t === 'comps' || t === 'control-points' || t === 'exterior-items' || t === 'room-types' || t === 'certifications' || t === 'forutsattningar' || t === 'addon-services' || t === 'eb') setTab(t)
  }, [search])
  const setTabAndPush = (t: AdminTab) => {
    setTab(t)
    router.replace(`/admin?tab=${t}`)
  }

  // Dokumenttyper
  const [docs, setDocs] = useState<DocType[]>([])
  const [qDocs, setQDocs] = useState('')
  const [docSort, setDocSort] = useState<{
    key: keyof DocType
    dir: 'asc' | 'desc'
  }>({ key: 'label', dir: 'asc' })
  const [docFilters, setDocFilters] = useState<{
    applies_to: string
    category: string
    is_default: string
    is_active: string
  }>({ applies_to: '', category: '', is_default: '', is_active: '' })
  const [docModalOpen, setDocModalOpen] = useState(false)
  const [docDraft, setDocDraft] = useState<DocDraft | null>(null)

  // Komponenttyper
  const [comps, setComps] = useState<CompType[]>([])
  const [qComps, setQComps] = useState('')

  // Kontrollpunkter
  const [controlPoints, setControlPoints] = useState<ControlPointRow[]>([])
  const [qPoints, setQPoints] = useState('')
  const [pointSort, setPointSort] = useState<{
    key: keyof ControlPointRow
    dir: 'asc' | 'desc'
  }>({ key: 'sort_order', dir: 'asc' })
  const [pointFilters, setPointFilters] = useState<{
    scope: string
    applies_to: string
    exterior_item_key: string
    room_type_keys: string[]
    is_active: string
  }>({ scope: '', applies_to: '', exterior_item_key: '', room_type_keys: [], is_active: '' })
  const [roomTypeFilterOpen, setRoomTypeFilterOpen] = useState(false)
  const roomTypeFilterRef = useRef<HTMLDivElement | null>(null)
  const [pointModalOpen, setPointModalOpen] = useState(false)
  const [pointDraft, setPointDraft] = useState<ControlPointDraft | null>(null)
  const [selectedControlPointId, setSelectedControlPointId] = useState<string | null>(null)
  const [outcomesPanelOpen, setOutcomesPanelOpen] = useState(false)
  const [outcomes, setOutcomes] = useState<ControlPointOutcomeRow[]>([])
  const [outcomesLoading, setOutcomesLoading] = useState(false)
  const [selectedOutcomeIds, setSelectedOutcomeIds] = useState<string[]>([])
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false)
  const [outcomeDraft, setOutcomeDraft] = useState<ControlPointOutcomeDraft | null>(null)
  const [copyTargetControlPointId, setCopyTargetControlPointId] = useState('')
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [exteriorItems, setExteriorItems] = useState<ExteriorItem[]>([])
  const [roomTypesAll, setRoomTypesAll] = useState<RoomType[]>([])
  const [qRoomTypes, setQRoomTypes] = useState('')
  const [roomTypeSort, setRoomTypeSort] = useState<{
    key: keyof RoomType
    dir: 'asc' | 'desc'
  }>({ key: 'sort_order', dir: 'asc' })
  const [roomTypeModalOpen, setRoomTypeModalOpen] = useState(false)
  const [roomTypeDraft, setRoomTypeDraft] = useState<RoomTypeDraft | null>(null)
  const [addonServicesAll, setAddonServicesAll] = useState<AddonServiceType[]>([])
  const [qAddonServices, setQAddonServices] = useState('')
  const [addonServiceSort, setAddonServiceSort] = useState<{
    key: keyof AddonServiceType
    dir: 'asc' | 'desc'
  }>({ key: 'sort_order', dir: 'asc' })
  const [addonServiceModalOpen, setAddonServiceModalOpen] = useState(false)
  const [addonServiceDraft, setAddonServiceDraft] = useState<AddonServiceDraft | null>(null)
  const [certificationsAll, setCertificationsAll] = useState<CertificationType[]>([])
  const [qCertifications, setQCertifications] = useState('')
  const [certificationSort, setCertificationSort] = useState<{
    key: keyof CertificationType
    dir: 'asc' | 'desc'
  }>({ key: 'sort_order', dir: 'asc' })
  const [certificationModalOpen, setCertificationModalOpen] = useState(false)
  const [certificationDraft, setCertificationDraft] = useState<CertificationDraft | null>(null)

  useEffect(() => {
    loadDocs()
    loadComps()
    loadControlPoints()
    loadRoomTypes()
    loadRoomTypesAll()
    loadExteriorItems()
    loadAddonServices()
    loadCertifications()
  }, [])

  useEffect(() => {
    if (!controlPoints.length) {
      setSelectedControlPointId(null)
      return
    }
    if (!selectedControlPointId || !controlPoints.some(p => p.id === selectedControlPointId)) {
      setSelectedControlPointId(controlPoints[0].id)
    }
  }, [controlPoints, selectedControlPointId])

  useEffect(() => {
    if (tab !== 'control-points') return
    if (!selectedControlPointId) {
      setOutcomes([])
      return
    }
    void loadOutcomes(selectedControlPointId)
  }, [tab, selectedControlPointId])

  useEffect(() => {
    if (!roomTypeFilterOpen) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      const container = roomTypeFilterRef.current
      if (!container) return
      if (target && container.contains(target)) return
      setRoomTypeFilterOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [roomTypeFilterOpen])

  useEffect(() => {
    setCopyTargetControlPointId('')
  }, [selectedControlPointId])

  const loadDocs = async () => {
    const { data, error } = await supabase
      .from('document_types')
      .select('id, code, label, category, applies_to, description, is_default, is_active')
      .order('category', { ascending: true })
      .order('label', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setDocs((data ?? []) as DocType[])
  }

  const loadComps = async () => {
    const { data, error } = await supabase
      .from('component_types')
      .select('id, code, name, category, default_lifespan_years, maintenance_interval_years, notes')
      .order('category', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setComps((data ?? []) as CompType[])
  }

  const loadControlPoints = async () => {
    const { data, error } = await supabase
      .from('settings_control_points')
      .select(
        'id, key, title, description, scope, applies_to, exterior_item_key, sort_order, is_active, default_risk_code, default_ftu_code, trigger_year_from, trigger_year_to, trigger_room_types, trigger_component_keys, trigger_foundation_types, trigger_tags, tags, risk_tags, created_at, updated_at'
      )
      .order('scope', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('key', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setControlPoints((data ?? []) as ControlPointRow[])
  }

  const loadOutcomes = async (controlPointId: string) => {
    setOutcomesLoading(true)
  const { data, error } = await (supabase as any)
      .from('settings_control_point_outcomes')
      .select('id, control_point_id, outcome_key, label, severity, note_template, risk_template, ftu_template, sort_order, is_active')
      .eq('control_point_id', controlPointId)
      .order('sort_order', { ascending: true })
      .order('label', { ascending: true })
    setOutcomesLoading(false)
    if (error) {
      console.error(error.message)
      setOutcomes([])
      return
    }
    setOutcomes((data ?? []) as ControlPointOutcomeRow[])
    setSelectedOutcomeIds([])
  }

  const loadRoomTypes = async () => {
    const { data, error } = await supabase
      .from('settings_interior_room_types')
      .select('id, key, label, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setRoomTypes((data ?? []) as RoomType[])
  }

  const loadRoomTypesAll = async () => {
    const { data, error } = await supabase
      .from('settings_interior_room_types')
      .select('id, key, label, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('key', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setRoomTypesAll((data ?? []) as RoomType[])
  }

  const loadExteriorItems = async () => {
    const { data, error } = await supabase
      .from('settings_exterior_items')
      .select('id, key, label, sort_order, is_active')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setExteriorItems((data ?? []) as ExteriorItem[])
  }

  const loadAddonServices = async () => {
    const { data, error } = await (supabase as any)
      .from('settings_addon_services')
      .select('id, key, name, description, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setAddonServicesAll((data ?? []) as AddonServiceType[])
  }

  const loadCertifications = async () => {
    const { data, error } = await (supabase as any)
      .from('settings_certifications')
      .select(
        'id, key, name, description, category, requires_number, requires_valid_to, number_label, valid_to_label, sort_order, is_active'
      )
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (error) {
      console.error(error.message)
      return
    }
    setCertificationsAll((data ?? []) as CertificationType[])
  }

  const filteredDocs = useMemo(() => {
    const s = qDocs.trim().toLowerCase()
    const rows = !s
      ? docs
      : docs.filter(
          d =>
            (d.label ?? '').toLowerCase().includes(s) ||
            (d.code ?? '').toLowerCase().includes(s) ||
            (d.category ?? '').toLowerCase().includes(s) ||
            (d.applies_to ?? '').toLowerCase().includes(s) ||
            (d.is_active ? 'aktiv' : 'inaktiv').includes(s)
        )

    const filtered = rows.filter(d => {
      if (docFilters.applies_to && (d.applies_to ?? 'all') !== docFilters.applies_to) return false
      if (docFilters.category && (d.category ?? '') !== docFilters.category) return false
      if (docFilters.is_default) {
        if (docFilters.is_default === 'default' && !d.is_default) return false
        if (docFilters.is_default === 'non-default' && d.is_default) return false
      }
      if (docFilters.is_active) {
        if (docFilters.is_active === 'active' && !d.is_active) return false
        if (docFilters.is_active === 'inactive' && d.is_active) return false
      }
      return true
    })

    const sorted = [...filtered].sort((a, b) => {
      const dir = docSort.dir === 'asc' ? 1 : -1
      const aVal = (a[docSort.key] ?? '') as any
      const bVal = (b[docSort.key] ?? '') as any
      const aNum = typeof aVal === 'number' ? aVal : NaN
      const bNum = typeof bVal === 'number' ? bVal : NaN
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return (aNum - bNum) * dir
      }
      const aStr = typeof aVal === 'boolean' ? (aVal ? '1' : '0') : String(aVal).toLowerCase()
      const bStr = typeof bVal === 'boolean' ? (bVal ? '1' : '0') : String(bVal).toLowerCase()
      return aStr.localeCompare(bStr) * dir
    })

    return sorted
  }, [docs, qDocs, docSort, docFilters])

  const docCategoryOptions = useMemo(() => {
    const options = docs
      .map(d => (d.category ?? '').trim())
      .filter(v => v !== '')
      .filter((v, i, arr) => arr.indexOf(v) === i)
      .sort((a, b) => a.localeCompare(b, 'sv'))
    return options
  }, [docs])

  const filteredComps = useMemo(() => {
    const s = qComps.trim().toLowerCase()
    if (!s) return comps
    return comps.filter(
      c =>
        c.name.toLowerCase().includes(s) ||
        (c.code ?? '').toLowerCase().includes(s) ||
        (c.category ?? '').toLowerCase().includes(s)
    )
  }, [comps, qComps])

  const filteredRoomTypes = useMemo(() => {
    const s = qRoomTypes.trim().toLowerCase()
    const rows = !s
      ? roomTypesAll
      : roomTypesAll.filter(
          r =>
            (r.key ?? '').toLowerCase().includes(s) ||
            (r.label ?? '').toLowerCase().includes(s)
        )

    const sorted = [...rows].sort((a, b) => {
      const dir = roomTypeSort.dir === 'asc' ? 1 : -1
      const aVal = (a[roomTypeSort.key] ?? '') as any
      const bVal = (b[roomTypeSort.key] ?? '') as any
      const aNum = typeof aVal === 'number' ? aVal : NaN
      const bNum = typeof bVal === 'number' ? bVal : NaN
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return (aNum - bNum) * dir
      }
      const aStr = typeof aVal === 'boolean' ? (aVal ? '1' : '0') : String(aVal).toLowerCase()
      const bStr = typeof bVal === 'boolean' ? (bVal ? '1' : '0') : String(bVal).toLowerCase()
      return aStr.localeCompare(bStr) * dir
    })

    return sorted
  }, [roomTypesAll, qRoomTypes, roomTypeSort])

  const filteredAddonServices = useMemo(() => {
    const s = qAddonServices.trim().toLowerCase()
    const rows = !s
      ? addonServicesAll
      : addonServicesAll.filter(
          r =>
            (r.key ?? '').toLowerCase().includes(s) ||
            (r.name ?? '').toLowerCase().includes(s) ||
            (r.description ?? '').toLowerCase().includes(s)
        )

    const sorted = [...rows].sort((a, b) => {
      const dir = addonServiceSort.dir === 'asc' ? 1 : -1
      const aVal = (a[addonServiceSort.key] ?? '') as any
      const bVal = (b[addonServiceSort.key] ?? '') as any
      const aNum = typeof aVal === 'number' ? aVal : NaN
      const bNum = typeof bVal === 'number' ? bVal : NaN
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return (aNum - bNum) * dir
      }
      const aStr = typeof aVal === 'boolean' ? (aVal ? '1' : '0') : String(aVal).toLowerCase()
      const bStr = typeof bVal === 'boolean' ? (bVal ? '1' : '0') : String(bVal).toLowerCase()
      return aStr.localeCompare(bStr) * dir
    })

    return sorted
  }, [addonServicesAll, qAddonServices, addonServiceSort])

  const filteredCertifications = useMemo(() => {
    const s = qCertifications.trim().toLowerCase()
    const rows = !s
      ? certificationsAll
      : certificationsAll.filter(
          r =>
            (r.key ?? '').toLowerCase().includes(s) ||
            (r.name ?? '').toLowerCase().includes(s) ||
            (r.description ?? '').toLowerCase().includes(s) ||
            (r.category ?? '').toLowerCase().includes(s)
        )

    const sorted = [...rows].sort((a, b) => {
      const dir = certificationSort.dir === 'asc' ? 1 : -1
      const aVal = (a[certificationSort.key] ?? '') as any
      const bVal = (b[certificationSort.key] ?? '') as any
      const aNum = typeof aVal === 'number' ? aVal : NaN
      const bNum = typeof bVal === 'number' ? bVal : NaN
      if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
        return (aNum - bNum) * dir
      }
      const aStr = typeof aVal === 'boolean' ? (aVal ? '1' : '0') : String(aVal).toLowerCase()
      const bStr = typeof bVal === 'boolean' ? (bVal ? '1' : '0') : String(bVal).toLowerCase()
      return aStr.localeCompare(bStr) * dir
    })

    return sorted
  }, [certificationsAll, qCertifications, certificationSort])

  const buildPointDraft = (
    row?: ControlPointRow,
    overrides?: Partial<ControlPointDraft>
  ): ControlPointDraft => ({
    id: row?.id,
    key: row?.key ?? '',
    title: row?.title ?? '',
    description: row?.description ?? null,
    scope: row?.scope ?? 'interior',
    applies_to:
      Array.isArray(row?.applies_to) && row!.applies_to!.length > 0
        ? row!.applies_to!.filter(v => ['buyer', 'seller', 'apartment'].includes(v))
        : ['buyer', 'seller', 'apartment'],
    exterior_item_key: row?.exterior_item_key ?? null,
    sort_order: row?.sort_order ?? 100,
    is_active: row?.is_active ?? true,
    default_risk_code: row?.default_risk_code ?? null,
    default_ftu_code: row?.default_ftu_code ?? null,
    trigger_year_from: row?.trigger_year_from ?? null,
    trigger_year_to: row?.trigger_year_to ?? null,
    trigger_room_types_text: row?.trigger_room_types ? JSON.stringify(row.trigger_room_types) : '',
    trigger_component_keys_text: row?.trigger_component_keys ? JSON.stringify(row.trigger_component_keys) : '',
    trigger_foundation_types_text: row?.trigger_foundation_types ? JSON.stringify(row.trigger_foundation_types) : '',
    trigger_tags_text: row?.trigger_tags ? JSON.stringify(row.trigger_tags) : '',
    tags_text: row?.tags ? JSON.stringify(row.tags) : '',
    risk_tags_text: row?.risk_tags ? JSON.stringify(row.risk_tags) : '',
    created_at: row?.created_at,
    updated_at: row?.updated_at ?? null,
    ...overrides,
  })

  const openPointModal = (row?: ControlPointRow) => {
    if (row?.id) setSelectedControlPointId(row.id)
    setPointDraft(buildPointDraft(row))
    setPointModalOpen(true)
  }

  const duplicatePoint = (row: ControlPointRow) => {
    if (row?.id) setSelectedControlPointId(row.id)
    const nextKey = row.key ? `${row.key}_copy` : ''
    setPointDraft(buildPointDraft(row, { id: undefined, key: nextKey }))
    setPointModalOpen(true)
  }

  const closePointModal = () => {
    setPointModalOpen(false)
    setPointDraft(null)
  }

  const updatePointDraft = (patch: Partial<ControlPointDraft>) => {
    setPointDraft(prev => (prev ? { ...prev, ...patch } : prev))
  }

  const openOutcomeModal = (row?: ControlPointOutcomeRow) => {
    if (!selectedControlPointId && !row) return
    if (row) {
      setOutcomeDraft({
        id: row.id,
        control_point_id: row.control_point_id,
        outcome_key: row.outcome_key ?? '',
        label: row.label ?? '',
        severity: row.severity ?? null,
        note_template: row.note_template ?? null,
        risk_template: row.risk_template ?? null,
        ftu_template: row.ftu_template ?? null,
        sort_order: row.sort_order ?? 100,
        is_active: !!row.is_active,
      })
    } else {
      setOutcomeDraft({
        control_point_id: selectedControlPointId!,
        outcome_key: '',
        label: '',
        severity: null,
        note_template: null,
        risk_template: null,
        ftu_template: null,
        sort_order: 100,
        is_active: true,
      })
    }
    setOutcomeModalOpen(true)
  }

  const openOutcomesPanel = (controlPointId: string) => {
    setSelectedControlPointId(controlPointId)
    setOutcomesPanelOpen(true)
  }

  const closeOutcomesPanel = () => {
    setOutcomesPanelOpen(false)
    setSelectedOutcomeIds([])
    setCopyTargetControlPointId('')
  }

  const duplicateOutcome = (row: ControlPointOutcomeRow) => {
    setOutcomeDraft({
      control_point_id: row.control_point_id,
      outcome_key: '',
      label: row.label ? `${row.label} (kopia)` : 'Kopia',
      severity: row.severity ?? null,
      note_template: row.note_template ?? null,
      risk_template: row.risk_template ?? null,
      ftu_template: row.ftu_template ?? null,
      sort_order: row.sort_order ?? 100,
      is_active: !!row.is_active,
    })
    setOutcomeModalOpen(true)
  }

  const closeOutcomeModal = () => {
    setOutcomeModalOpen(false)
    setOutcomeDraft(null)
  }

  const getTriggerRoomTypes = (draft: ControlPointDraft) => {
    const raw = draft.trigger_room_types_text.trim()
    if (!raw) return [] as string[]
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string') : []
    } catch {
      return []
    }
  }

  const setTriggerRoomTypes = (next: string[]) => {
    updatePointDraft({ trigger_room_types_text: JSON.stringify(next) })
  }

  const parseJsonField = (value: string, label: string) => {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return JSON.parse(trimmed)
    } catch {
      throw new Error(`Fältet ${label} måste vara giltig JSON.`)
    }
  }

  const normalizeAppliesTo = (values: string[]) => {
    const allowed = ['buyer', 'seller', 'apartment']
    const unique = Array.from(new Set(values.filter(v => allowed.includes(v))))
    return unique.length > 0 ? unique : ['buyer', 'seller', 'apartment']
  }

  const saveControlPoint = async () => {
    if (!pointDraft) return

    const title = pointDraft.title.trim()
    const scope = pointDraft.scope?.trim()

    if (!title || !scope) {
      alert('Titel och insida/utsida måste fyllas i.')
      return
    }
    let key = pointDraft.key.trim()
    if (!key) {
      const existing = new Set(controlPoints.map(p => p.key))
      do {
        key = `CP_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
      } while (existing.has(key))
    }

    let payload: Partial<ControlPointRow>
    try {
      payload = {
        key,

        title,
        scope,
        applies_to: normalizeAppliesTo(pointDraft.applies_to),
        description: pointDraft.description?.trim() || null,
        exterior_item_key: pointDraft.exterior_item_key?.trim() || null,
        sort_order: pointDraft.sort_order ?? 100,
        is_active: !!pointDraft.is_active,
        default_risk_code: pointDraft.default_risk_code?.trim() || null,
        default_ftu_code: pointDraft.default_ftu_code?.trim() || null,
        trigger_year_from: pointDraft.trigger_year_from ?? null,
        trigger_year_to: pointDraft.trigger_year_to ?? null,
        trigger_room_types: parseJsonField(pointDraft.trigger_room_types_text, 'trigger_room_types'),
        trigger_component_keys: parseJsonField(pointDraft.trigger_component_keys_text, 'trigger_component_keys'),
        trigger_foundation_types: parseJsonField(pointDraft.trigger_foundation_types_text, 'trigger_foundation_types'),
        trigger_tags: parseJsonField(pointDraft.trigger_tags_text, 'trigger_tags'),
        tags: parseJsonField(pointDraft.tags_text, 'tags'),
        risk_tags: parseJsonField(pointDraft.risk_tags_text, 'risk_tags'),
      }
    } catch (e: any) {
      alert(e?.message || 'JSON-fältet är ogiltigt.')
      return
    }

    if (pointDraft.id) {
      const { error } = await (supabase as any)
        .from('settings_control_points')
        .update(payload)
        .eq('id', pointDraft.id)
      if (error) return alert(error.message)
      setControlPoints(prev =>
        prev.map(p => (p.id === pointDraft.id ? ({ ...p, ...payload } as ControlPointRow) : p))
      )
      closePointModal()
      return
    }

    const { data, error } = await (supabase as any)
      .from('settings_control_points')
      .insert(payload)
      .select(
        'id, key, title, description, scope, applies_to, exterior_item_key, room_type_key, sort_order, is_active, default_risk_code, default_ftu_code, trigger_year_from, trigger_year_to, trigger_room_types, trigger_component_keys, trigger_foundation_types, trigger_tags, tags, risk_tags, created_at, updated_at'
      )
      .single()
    if (error) return alert(error.message)
    setControlPoints(prev => [data as ControlPointRow, ...prev])
    closePointModal()
  }

  const deleteControlPoint = async (id: string) => {
    if (!confirm('Ta bort kontrollpunkten?')) return
    const { error } = await (supabase as any)
      .from('settings_control_points')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setControlPoints(prev => prev.filter(p => p.id !== id))
    if (selectedControlPointId === id) {
      setSelectedControlPointId(null)
      setOutcomes([])
      setSelectedOutcomeIds([])
    }
    closePointModal()
  }

  const saveOutcome = async () => {
    if (!outcomeDraft) return
    const label = outcomeDraft.label.trim()
    if (!label) {
      alert('Label måste fyllas i.')
      return
    }

    const outcomeKey =
      outcomeDraft.outcome_key.trim() || `OC_${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const payload = {
      control_point_id: outcomeDraft.control_point_id,
      outcome_key: outcomeKey,
      label,
      severity: outcomeDraft.severity || null,
      note_template: outcomeDraft.note_template || null,
      risk_template: outcomeDraft.risk_template || null,
      ftu_template: outcomeDraft.ftu_template || null,
      sort_order: outcomeDraft.sort_order ?? 100,
      is_active: !!outcomeDraft.is_active,
    }

    if (outcomeDraft.id) {
      const { error } = await (supabase as any)
        .from('settings_control_point_outcomes')
        .update(payload)
        .eq('id', outcomeDraft.id)
      if (error) return alert(error.message)
      setOutcomes(prev =>
        prev.map(o => (o.id === outcomeDraft.id ? ({ ...o, ...payload } as ControlPointOutcomeRow) : o))
      )
      closeOutcomeModal()
      return
    }

    const { data, error } = await (supabase as any)
      .from('settings_control_point_outcomes')
      .insert(payload)
      .select('id, control_point_id, outcome_key, label, severity, note_template, risk_template, ftu_template, sort_order, is_active')
      .single()
    if (error) return alert(error.message)
    setOutcomes(prev => [...prev, data as ControlPointOutcomeRow].sort((a, b) => a.sort_order - b.sort_order))
    closeOutcomeModal()
  }

  const deleteOutcome = async (id: string) => {
    if (!confirm('Ta bort notering/utfall?')) return
    const { error } = await (supabase as any)
      .from('settings_control_point_outcomes')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setOutcomes(prev => prev.filter(o => o.id !== id))
    setSelectedOutcomeIds(prev => prev.filter(x => x !== id))
    if (outcomeDraft?.id === id) closeOutcomeModal()
  }

  const copyOutcomesToControlPoint = async () => {
    if (!selectedControlPointId) return
    if (!copyTargetControlPointId) {
      alert('Välj mål-kontrollpunkt.')
      return
    }
    if (copyTargetControlPointId === selectedControlPointId) {
      alert('Mål-kontrollpunkt måste vara en annan kontrollpunkt.')
      return
    }
    const rowsToCopy = outcomes.filter(o => selectedOutcomeIds.includes(o.id))
    if (!rowsToCopy.length) {
      alert('Välj minst en notering att kopiera.')
      return
    }

    const payload = rowsToCopy.map(o => ({
      control_point_id: copyTargetControlPointId,
      outcome_key: `OC_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      label: o.label,
      severity: o.severity ?? null,
      note_template: o.note_template ?? null,
      risk_template: o.risk_template ?? null,
      ftu_template: o.ftu_template ?? null,
      sort_order: o.sort_order ?? 100,
      is_active: !!o.is_active,
    }))

    const { error } = await (supabase as any)
      .from('settings_control_point_outcomes')
      .insert(payload)
    if (error) return alert(error.message)

    alert(`${rowsToCopy.length} noteringar kopierades.`)
  }

  const filteredPoints = useMemo(() => {
    const s = qPoints.trim().toLowerCase()
    const rows = !s
      ? controlPoints
      : controlPoints.filter(p =>
          (p.key ?? '').toLowerCase().includes(s) ||
          (p.title ?? '').toLowerCase().includes(s) ||
          (p.description ?? '').toLowerCase().includes(s) ||
          (p.exterior_item_key ?? '').toLowerCase().includes(s) ||
          (p.scope ?? '').toLowerCase().includes(s) ||
          (Array.isArray(p.applies_to) ? p.applies_to.join(',') : '').toLowerCase().includes(s)
        )

    const filtered = rows.filter(p => {
      if (pointFilters.scope && p.scope !== pointFilters.scope) return false
      if (pointFilters.applies_to) {
        const appliesTo = Array.isArray(p.applies_to) && p.applies_to.length > 0
          ? p.applies_to
          : ['buyer', 'seller', 'apartment']
        if (!appliesTo.includes(pointFilters.applies_to)) return false
      }
      if (
        pointFilters.exterior_item_key &&
        (p.exterior_item_key ?? '') !== pointFilters.exterior_item_key
      )
        return false
      if (pointFilters.is_active) {
        if (pointFilters.is_active === 'active' && !p.is_active) return false
        if (pointFilters.is_active === 'inactive' && p.is_active) return false
      }
      if (pointFilters.room_type_keys.length > 0) {
        const rt = p.trigger_room_types
        const rtArr = Array.isArray(rt)
          ? rt
          : rt
            ? JSON.parse(JSON.stringify(rt))
            : []
        if (!Array.isArray(rtArr)) return false
        const hasMatch = pointFilters.room_type_keys.some(k =>
          rtArr.includes(k)
        )
        if (!hasMatch) return false
      }
      return true
    })

    const sorted = [...filtered].sort((a, b) => {
      const dir = pointSort.dir === 'asc' ? 1 : -1
      const aVal = (a[pointSort.key] ?? '') as any
      const bVal = (b[pointSort.key] ?? '') as any
      const aNum = typeof aVal === 'number' ? aVal : NaN
    const bNum = typeof bVal === 'number' ? bVal : NaN
    if (!Number.isNaN(aNum) && !Number.isNaN(bNum)) {
      return (aNum - bNum) * dir
    }
    const aStr =
      typeof aVal === 'boolean'
        ? aVal
          ? '1'
          : '0'
        : typeof aVal === 'object' && aVal !== null
          ? JSON.stringify(aVal).toLowerCase()
          : String(aVal).toLowerCase()
    const bStr =
      typeof bVal === 'boolean'
        ? bVal
          ? '1'
          : '0'
        : typeof bVal === 'object' && bVal !== null
          ? JSON.stringify(bVal).toLowerCase()
          : String(bVal).toLowerCase()
    return aStr.localeCompare(bStr) * dir
  })

    return sorted
  }, [controlPoints, qPoints, pointSort, pointFilters])

  const selectedControlPoint =
    selectedControlPointId
      ? controlPoints.find(cp => cp.id === selectedControlPointId) ?? null
      : null

  const togglePointSort = (key: keyof ControlPointRow) => {
    setPointSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  const renderSortIcon = (active: boolean, dir: 'asc' | 'desc') => (
    <span className="inline-flex flex-col leading-none">
      <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
        <path d="M5 0 L10 6 H0 Z" className={active && dir === 'asc' ? 'fill-gray-700' : 'fill-gray-300'} />
      </svg>
      <svg width="10" height="6" viewBox="0 0 10 6" aria-hidden="true">
        <path d="M0 0 H10 L5 6 Z" className={active && dir === 'desc' ? 'fill-gray-700' : 'fill-gray-300'} />
      </svg>
    </span>
  )

  const pointAppliesToLabel = (row: ControlPointRow) => {
    const values = Array.isArray(row.applies_to) && row.applies_to.length > 0
      ? row.applies_to
      : ['buyer', 'seller', 'apartment']
    const labels = values.map(value => {
      if (value === 'buyer') return 'Köpare'
      if (value === 'seller') return 'Säljare'
      if (value === 'apartment') return 'Lägenhet'
      return value
    })
    return labels.join(', ')
  }

  const toggleDocSort = (key: keyof DocType) => {
    setDocSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  const docAppliesToLabel = (value: string | null | undefined) => {
    const normalized = String(value ?? '').trim().toLowerCase()
    if (!normalized || normalized === 'all') return 'Alla'
    if (normalized === 'buyer') return 'Köpare'
    if (normalized === 'seller') return 'Säljare'
    if (normalized === 'apartment') return 'Lägenhet'
    if (normalized === 'buyer,seller' || normalized === 'seller,buyer') return 'Köpare + säljare'
    return value ?? ''
  }

  const openDocModal = (doc?: DocType) => {
    if (doc) {
      setDocDraft({
        id: doc.id,
        code: doc.code ?? '',
        label: doc.label ?? '',
        category: doc.category ?? null,
        applies_to: doc.applies_to ?? 'all',
        description: doc.description ?? null,
        is_default: !!doc.is_default,
        is_active: doc.is_active ?? true,
      })
    } else {
      setDocDraft({
        code: '',
        label: '',
        category: null,
        applies_to: 'all',
        description: null,
        is_default: false,
        is_active: true,
      })
    }
    setDocModalOpen(true)
  }

  const duplicateDoc = (doc: DocType) => {
    setDocDraft({
      code: '',
      label: doc.label ? `${doc.label} (kopia)` : 'Kopia',
      category: doc.category ?? null,
      applies_to: doc.applies_to ?? 'all',
      description: doc.description ?? null,
      is_default: !!doc.is_default,
      is_active: doc.is_active ?? true,
    })
    setDocModalOpen(true)
  }

  const closeDocModal = () => {
    setDocModalOpen(false)
    setDocDraft(null)
  }

  const toggleRoomTypeSort = (key: keyof RoomType) => {
    setRoomTypeSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  const openRoomTypeModal = (row?: RoomType) => {
    if (row) {
      setRoomTypeDraft({
        id: row.id,
        key: row.key ?? '',
        label: row.label ?? '',
        sort_order: row.sort_order ?? 100,
        is_active: !!row.is_active,
      })
    } else {
      setRoomTypeDraft({
        key: '',
        label: '',
        sort_order: 100,
        is_active: true,
      })
    }
    setRoomTypeModalOpen(true)
  }

  const closeRoomTypeModal = () => {
    setRoomTypeModalOpen(false)
    setRoomTypeDraft(null)
  }

  const normalizeAddonKey = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[åä]/g, 'a')
      .replace(/ö/g, 'o')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')

  const toggleAddonServiceSort = (key: keyof AddonServiceType) => {
    setAddonServiceSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  const openAddonServiceModal = (row?: AddonServiceType) => {
    if (row) {
      setAddonServiceDraft({
        id: row.id,
        key: row.key ?? '',
        name: row.name ?? '',
        description: row.description ?? null,
        sort_order: row.sort_order ?? 100,
        is_active: !!row.is_active,
      })
    } else {
      setAddonServiceDraft({
        key: '',
        name: '',
        description: null,
        sort_order: 100,
        is_active: true,
      })
    }
    setAddonServiceModalOpen(true)
  }

  const closeAddonServiceModal = () => {
    setAddonServiceModalOpen(false)
    setAddonServiceDraft(null)
  }

  const toggleCertificationSort = (key: keyof CertificationType) => {
    setCertificationSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  const openCertificationModal = (row?: CertificationType) => {
    if (row) {
      setCertificationDraft({
        id: row.id,
        key: row.key ?? '',
        name: row.name ?? '',
        description: row.description ?? null,
        category: row.category ?? 'certification',
        requires_number: !!row.requires_number,
        requires_valid_to: !!row.requires_valid_to,
        number_label: row.number_label ?? null,
        valid_to_label: row.valid_to_label ?? null,
        sort_order: row.sort_order ?? 100,
        is_active: !!row.is_active,
      })
    } else {
      setCertificationDraft({
        key: '',
        name: '',
        description: null,
        category: 'certification',
        requires_number: false,
        requires_valid_to: false,
        number_label: null,
        valid_to_label: null,
        sort_order: 100,
        is_active: true,
      })
    }
    setCertificationModalOpen(true)
  }

  const closeCertificationModal = () => {
    setCertificationModalOpen(false)
    setCertificationDraft(null)
  }

  // --- INLINE SAVE HELPERS ---
  const saveDoc = async () => {
    if (!docDraft) return
    const code =
      docDraft.code.trim() || `DOC_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const payload: Database['public']['Tables']['document_types']['Insert'] = {
      code,
      label: docDraft.label.trim() || 'Nytt dokument',
      category: docDraft.category || null,
      applies_to: docDraft.applies_to || 'all',
      description: docDraft.description || null,
      is_default: docDraft.is_default,
      is_active: docDraft.is_active,
    }

    if (docDraft.id) {
      const { error } = await (supabase as any)
        .from('document_types')
        .update(payload)
        .eq('id', docDraft.id)
      if (error) return alert(error.message)
      setDocs(prev => prev.map(x => (x.id === docDraft.id ? { ...x, ...payload } as DocType : x)))
      closeDocModal()
      return
    }

    const { data, error } = await (supabase as any)
      .from('document_types')
      .insert(payload)
      .select('id, code, label, category, applies_to, description, is_default, is_active')
      .single()
    if (error) return alert(error.message)
    setDocs(prev => [data as DocType, ...prev])
    closeDocModal()
  }
  const addDoc = async () => {
    openDocModal()
  }
  const delDoc = async (id: string) => {
    if (!confirm('Ta bort dokumenttypen?')) return
    const { error } = await (supabase as any)
      .from('document_types')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setDocs(prev => prev.filter(x => x.id !== id))
    if (docDraft?.id === id) closeDocModal()
  }

  const saveComp = async (id: string, patch: Partial<CompType>) => {
    const { error } = await (supabase as any)
      .from('component_types')
      .update(patch)
      .eq('id', id)
    if (error) return alert(error.message)
    setComps(prev => prev.map(x => (x.id === id ? { ...x, ...patch } as CompType : x)))
  }
  const addComp = async () => {
    const code = `CMP_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const { data, error } = await (supabase as any)
      .from('component_types')
      .insert({ code, name: 'Ny komponent' })
      .select('id, code, name, category, default_lifespan_years, maintenance_interval_years, notes')
      .single()
    if (error) return alert(error.message)
    setComps(prev => [data as CompType, ...prev])
  }
  const delComp = async (id: string) => {
    if (!confirm('Ta bort komponenttypen?')) return
    const { error } = await (supabase as any)
      .from('component_types')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setComps(prev => prev.filter(x => x.id !== id))
  }

  const saveRoomType = async () => {
    if (!roomTypeDraft) return
    const label = roomTypeDraft.label.trim()
    const key = roomTypeDraft.key.trim() || label
    const payload: Database['public']['Tables']['settings_interior_room_types']['Insert'] = {
      key,
      label,
      sort_order: roomTypeDraft.sort_order ?? 100,
      is_active: roomTypeDraft.is_active,
    }

    if (!payload.key || !payload.label) {
      return alert('Key och label måste fyllas i.')
    }

    if (roomTypeDraft.id) {
      const { error } = await (supabase as any)
        .from('settings_interior_room_types')
        .update(payload)
        .eq('id', roomTypeDraft.id)
      if (error) return alert(error.message)
      setRoomTypesAll(prev =>
        prev.map(r => (r.id === roomTypeDraft.id ? ({ ...r, ...payload } as RoomType) : r))
      )
      loadRoomTypes()
      closeRoomTypeModal()
      return
    }

    const { data, error } = await (supabase as any)
      .from('settings_interior_room_types')
      .insert(payload)
      .select('id, key, label, sort_order, is_active')
      .single()
    if (error) return alert(error.message)
    setRoomTypesAll(prev => [data as RoomType, ...prev])
    loadRoomTypes()
    closeRoomTypeModal()
  }

  const delRoomType = async (id: string) => {
    if (!confirm('Ta bort rumstypen?')) return
    const { error } = await (supabase as any)
      .from('settings_interior_room_types')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setRoomTypesAll(prev => prev.filter(r => r.id !== id))
    loadRoomTypes()
    if (roomTypeDraft?.id === id) closeRoomTypeModal()
  }

  const saveAddonService = async () => {
    if (!addonServiceDraft) return
    const name = addonServiceDraft.name.trim()
    const autoKey = normalizeAddonKey(name)
    const key = (
      addonServiceDraft.id
        ? addonServiceDraft.key
        : autoKey || `addon_${Math.random().toString(36).slice(2, 8)}`
    ).trim()
    const payload = {
      key,
      name,
      description: addonServiceDraft.description || null,
      sort_order: addonServiceDraft.sort_order ?? 100,
      is_active: addonServiceDraft.is_active,
    }

    if (!payload.name) {
      return alert('Namn måste fyllas i.')
    }

    if (addonServiceDraft.id) {
      const { error } = await (supabase as any)
        .from('settings_addon_services')
        .update(payload)
        .eq('id', addonServiceDraft.id)
      if (error) return alert(error.message)
      setAddonServicesAll(prev =>
        prev.map(r => (r.id === addonServiceDraft.id ? ({ ...r, ...payload } as AddonServiceType) : r))
      )
      closeAddonServiceModal()
      return
    }

    const { data, error } = await (supabase as any)
      .from('settings_addon_services')
      .insert(payload)
      .select('id, key, name, description, sort_order, is_active')
      .single()
    if (error) return alert(error.message)
    setAddonServicesAll(prev => [data as AddonServiceType, ...prev])
    closeAddonServiceModal()
  }

  const delAddonService = async (id: string) => {
    if (!confirm('Ta bort tilläggsuppdraget?')) return
    const { error } = await (supabase as any)
      .from('settings_addon_services')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setAddonServicesAll(prev => prev.filter(r => r.id !== id))
    if (addonServiceDraft?.id === id) closeAddonServiceModal()
  }

  const saveCertification = async () => {
    if (!certificationDraft) return
    const name = certificationDraft.name.trim()
    const autoKey = normalizeAddonKey(name)
    const key = (
      certificationDraft.id
        ? certificationDraft.key
        : autoKey || `cert_${Math.random().toString(36).slice(2, 8)}`
    ).trim()
    const payload = {
      key,
      name,
      description: certificationDraft.description || null,
      category: certificationDraft.category,
      requires_number: certificationDraft.requires_number,
      requires_valid_to: certificationDraft.requires_valid_to,
      number_label: certificationDraft.number_label || null,
      valid_to_label: certificationDraft.valid_to_label || null,
      sort_order: certificationDraft.sort_order ?? 100,
      is_active: certificationDraft.is_active,
    }

    if (!payload.name) {
      return alert('Namn måste fyllas i.')
    }

    if (certificationDraft.id) {
      const { error } = await (supabase as any)
        .from('settings_certifications')
        .update(payload)
        .eq('id', certificationDraft.id)
      if (error) return alert(error.message)
      setCertificationsAll(prev =>
        prev.map(r => (r.id === certificationDraft.id ? ({ ...r, ...payload } as CertificationType) : r))
      )
      closeCertificationModal()
      return
    }

    const { data, error } = await (supabase as any)
      .from('settings_certifications')
      .insert(payload)
      .select(
        'id, key, name, description, category, requires_number, requires_valid_to, number_label, valid_to_label, sort_order, is_active'
      )
      .single()
    if (error) return alert(error.message)
    setCertificationsAll(prev => [data as CertificationType, ...prev])
    closeCertificationModal()
  }

  const delCertification = async (id: string) => {
    if (!confirm('Ta bort certifieringen?')) return
    const { error } = await (supabase as any)
      .from('settings_certifications')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setCertificationsAll(prev => prev.filter(r => r.id !== id))
    if (certificationDraft?.id === id) closeCertificationModal()
  }

  const activeAdminSection =
    BESIKTAPP_ADMIN_TABS.find(section => section.key === tab) ?? BESIKTAPP_ADMIN_TABS[0]

  return (
    <Protected>
      <div className="space-y-6">
        <section className="rounded-[28px] border border-stone-200/80 bg-[linear-gradient(145deg,rgba(255,251,247,0.98),rgba(245,242,238,0.94))] p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.45)]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">BesiktApp admin</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">Systeminställningar</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-700">
                Växla mellan BesiktApps inställningsområden här uppe. Innehållet nedan hålls i samma arbetsyta.
              </p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-white/85 px-4 py-3 text-sm text-stone-700">
              Visar nu: <span className="font-semibold text-stone-900">{activeAdminSection.label}</span>
            </div>
          </div>

          <nav className="mt-5 flex flex-wrap gap-2" aria-label="BesiktApp admin navigation">
            {BESIKTAPP_ADMIN_TABS.map(section => {
              const active = section.key === tab
              return (
                <button
                  key={section.key}
                  type="button"
                  onClick={() => setTabAndPush(section.key)}
                  className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                    active
                      ? 'bg-stone-900 text-white'
                      : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100'
                  }`}
                >
                  {section.label}
                </button>
              )
            })}
          </nav>
        </section>

        <section className="rounded-2xl border border-stone-200/80 bg-white/90 p-4 shadow-sm">
          <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-base font-semibold text-stone-900">{activeAdminSection.label}</h2>
              <p className="text-sm leading-6 text-stone-600">{activeAdminSection.description}</p>
            </div>
            <div className="text-xs uppercase tracking-[0.18em] text-stone-400">Aktiv modul</div>
          </div>
        </section>

        {tab === 'forutsattningar' && <ForutsattningarSettingsPage />}
        {tab === 'exterior-items' && <ObUtsidaSettingsPage />}
        {tab === 'eb' && <EbSettingsPanel />}

        {tab === 'docs' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Dokumenttyper</h2>
                <div className="text-xs text-gray-500">Dokumentmallar</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={qDocs}
                  onChange={e => setQDocs(e.target.value)}
                  placeholder="Sök..."
                  className="border rounded px-2 py-1 text-sm"
                />
                <button onClick={addDoc} className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">
                  + Ny
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="text-gray-400">Sortera:</span>
                <button
                  type="button"
                  onClick={() => toggleDocSort('code')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Kod
                  {renderSortIcon(docSort.key === 'code', docSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => toggleDocSort('label')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Namn
                  {renderSortIcon(docSort.key === 'label', docSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => toggleDocSort('category')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Kategori
                  {renderSortIcon(docSort.key === 'category', docSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => toggleDocSort('applies_to')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Gäller för
                  {renderSortIcon(docSort.key === 'applies_to', docSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => toggleDocSort('is_default')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Standard
                  {renderSortIcon(docSort.key === 'is_default', docSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => toggleDocSort('is_active')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Aktiv
                  {renderSortIcon(docSort.key === 'is_active', docSort.dir)}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="text-gray-400">Filtrera:</span>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={docFilters.applies_to}
                  onChange={e => setDocFilters(prev => ({ ...prev, applies_to: e.target.value }))}
                >
                  <option value="">Gäller för</option>
                  <option value="all">Alla</option>
                  <option value="buyer">Köpare</option>
                  <option value="seller">Säljare</option>
                  <option value="apartment">Lägenhet</option>
                  <option value="buyer,seller">Köpare + säljare</option>
                </select>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={docFilters.category}
                  onChange={e => setDocFilters(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="">Kategori</option>
                  {docCategoryOptions.map(category => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={docFilters.is_default}
                  onChange={e => setDocFilters(prev => ({ ...prev, is_default: e.target.value }))}
                >
                  <option value="">Standard</option>
                  <option value="default">Endast standard</option>
                  <option value="non-default">Ej standard</option>
                </select>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={docFilters.is_active}
                  onChange={e => setDocFilters(prev => ({ ...prev, is_active: e.target.value }))}
                >
                  <option value="">Aktiv</option>
                  <option value="active">Endast aktiva</option>
                  <option value="inactive">Endast inaktiva</option>
                </select>
              </div>

              <div className="overflow-auto">
                <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-gray-400 whitespace-nowrap">
                      <th className="px-3 py-1 w-[12%]">Kod</th>
                      <th className="px-3 py-1 w-[24%]">Namn</th>
                      <th className="px-3 py-1 w-[14%]">Kategori</th>
                      <th className="px-3 py-1 w-[14%]">Gäller för</th>
                      <th className="px-3 py-1 w-[8%]">Standard</th>
                      <th className="px-3 py-1 w-[8%]">Aktiv</th>
                      <th className="px-3 py-1 w-[14%]">Beskrivning</th>
                      <th className="px-3 py-1 w-[16%] text-center">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDocs.map(d => (
                      <tr key={d.id} className="group transition-colors hover:bg-blue-50">
                        <td className="px-3 py-2 border border-gray-200 rounded-l-xl bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{d.code}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate font-medium text-gray-900">{d.label}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{d.category ?? ''}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{docAppliesToLabel(d.applies_to)}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{d.is_default ? 'Ja' : 'Nej'}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{d.is_active ? 'Ja' : 'Nej'}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate" title={d.description ?? ''}>
                            {d.description ?? ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 border border-gray-200 rounded-r-xl bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="grid grid-cols-2 gap-1 text-[11px] whitespace-nowrap">
                            <button
                              onClick={() => openDocModal(d)}
                              className="w-full rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            >
                              Editera
                            </button>
                            <button
                              onClick={() => duplicateDoc(d)}
                              className="w-full rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            >
                              Duplicera
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredDocs.length === 0 && (
                      <tr>
                        <td className="py-4 text-gray-500 text-xs" colSpan={8}>
                          Inga rader.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {tab === 'comps' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Komponentkatalog</h2>
                <div className="text-xs text-gray-500">component_types</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={qComps}
                  onChange={e => setQComps(e.target.value)}
                  placeholder="Sök..."
                  className="border rounded px-2 py-1 text-sm"
                />
                <button onClick={addComp} className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">
                  + Ny
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">Code</th>
                    <th className="py-2 pr-3">Namn</th>
                    <th className="py-2 pr-3">Kategori</th>
                    <th className="py-2 pr-3">Standardlivslängd (år)</th>
                    <th className="py-2 pr-3">Underhållsintervall (år)</th>
                    <th className="py-2 pr-3">Anteckning</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredComps.map(c => (
                    <tr key={c.id}>
                      <td className="py-2 pr-3">{c.code ?? ''}</td>
                      <td className="py-2 pr-3">
                        <input
                          className="border rounded px-2 py-1 w-56"
                          value={c.name}
                          onChange={e => saveComp(c.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          className="border rounded px-2 py-1 w-40"
                          value={c.category ?? ''}
                          onChange={e => saveComp(c.id, { category: e.target.value || null })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          className="border rounded px-2 py-1 w-32"
                          value={c.default_lifespan_years ?? ''}
                          onChange={e =>
                            saveComp(c.id, {
                              default_lifespan_years: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          className="border rounded px-2 py-1 w-32"
                          value={c.maintenance_interval_years ?? ''}
                          onChange={e =>
                            saveComp(c.id, {
                              maintenance_interval_years: e.target.value === '' ? null : Number(e.target.value),
                            })
                          }
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          className="border rounded px-2 py-1 w-72"
                          value={c.notes ?? ''}
                          onChange={e => saveComp(c.id, { notes: e.target.value || null })}
                        />
                      </td>
                      <td className="py-2">
                        <button onClick={() => delComp(c.id)} className="text-rose-600 underline">
                          Ta bort
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredComps.length === 0 && (
                    <tr>
                      <td className="py-4 text-gray-500" colSpan={7}>
                        Inga rader.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'room-types' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Rumstyper</h2>
                <div className="text-xs text-gray-500">settings_interior_room_types</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={qRoomTypes}
                  onChange={e => setQRoomTypes(e.target.value)}
                  placeholder="Sök..."
                  className="border rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={() => openRoomTypeModal()}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
                >
                  + Ny
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleRoomTypeSort('key')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Key
                        {renderSortIcon(roomTypeSort.key === 'key', roomTypeSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleRoomTypeSort('label')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Label
                        {renderSortIcon(roomTypeSort.key === 'label', roomTypeSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleRoomTypeSort('is_active')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Aktiv
                        {renderSortIcon(roomTypeSort.key === 'is_active', roomTypeSort.dir)}
                      </button>
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRoomTypes.map(r => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3">{r.key}</td>
                      <td className="py-2 pr-3">{r.label}</td>
                      <td className="py-2 pr-3">{r.is_active ? 'Ja' : 'Nej'}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => openRoomTypeModal(r)}
                          className="text-emerald-700 underline"
                        >
                          Editera
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredRoomTypes.length === 0 && (
                    <tr>
                      <td className="py-4 text-gray-500" colSpan={5}>
                        Inga rader.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'addon-services' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Tilläggsuppdrag</h2>
                <div className="text-xs text-gray-500">settings_addon_services</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={qAddonServices}
                  onChange={e => setQAddonServices(e.target.value)}
                  placeholder="Sök..."
                  className="border rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={() => openAddonServiceModal()}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
                >
                  + Ny
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleAddonServiceSort('key')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Key
                        {renderSortIcon(addonServiceSort.key === 'key', addonServiceSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleAddonServiceSort('name')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Namn
                        {renderSortIcon(addonServiceSort.key === 'name', addonServiceSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3 max-w-[30rem]">
                      <button
                        type="button"
                        onClick={() => toggleAddonServiceSort('description')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Beskrivning
                        {renderSortIcon(addonServiceSort.key === 'description', addonServiceSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleAddonServiceSort('sort_order')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Sortering
                        {renderSortIcon(addonServiceSort.key === 'sort_order', addonServiceSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleAddonServiceSort('is_active')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Aktiv
                        {renderSortIcon(addonServiceSort.key === 'is_active', addonServiceSort.dir)}
                      </button>
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredAddonServices.map(r => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3">{r.key}</td>
                      <td className="py-2 pr-3">{r.name}</td>
                      <td className="py-2 pr-3 truncate max-w-[28rem]" title={r.description ?? ''}>
                        {r.description ?? ''}
                      </td>
                      <td className="py-2 pr-3">{r.sort_order}</td>
                      <td className="py-2 pr-3">{r.is_active ? 'Ja' : 'Nej'}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => openAddonServiceModal(r)}
                          className="text-emerald-700 underline"
                        >
                          Editera
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredAddonServices.length === 0 && (
                    <tr>
                      <td className="py-4 text-gray-500" colSpan={6}>
                        Inga rader.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'certifications' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Certifieringar</h2>
                <div className="text-xs text-gray-500">settings_certifications</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={qCertifications}
                  onChange={e => setQCertifications(e.target.value)}
                  placeholder="Sök..."
                  className="border rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={() => openCertificationModal()}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
                >
                  + Ny
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleCertificationSort('key')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Key
                        {renderSortIcon(certificationSort.key === 'key', certificationSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleCertificationSort('name')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Namn
                        {renderSortIcon(certificationSort.key === 'name', certificationSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleCertificationSort('category')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Typ
                        {renderSortIcon(certificationSort.key === 'category', certificationSort.dir)}
                      </button>
                    </th>
                    <th className="py-2 pr-3 max-w-[30rem]">
                      <button
                        type="button"
                        onClick={() => toggleCertificationSort('description')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Beskrivning
                        {renderSortIcon(
                          certificationSort.key === 'description',
                          certificationSort.dir
                        )}
                      </button>
                    </th>
                    <th className="py-2 pr-3">Krav</th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleCertificationSort('sort_order')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Sortering
                        {renderSortIcon(
                          certificationSort.key === 'sort_order',
                          certificationSort.dir
                        )}
                      </button>
                    </th>
                    <th className="py-2 pr-3">
                      <button
                        type="button"
                        onClick={() => toggleCertificationSort('is_active')}
                        className="inline-flex items-center gap-1 hover:text-gray-800"
                      >
                        Aktiv
                        {renderSortIcon(
                          certificationSort.key === 'is_active',
                          certificationSort.dir
                        )}
                      </button>
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredCertifications.map(r => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3">{r.key}</td>
                      <td className="py-2 pr-3">{r.name}</td>
                      <td className="py-2 pr-3">{r.category === 'membership' ? 'Medlemskap' : 'Certifiering'}</td>
                      <td className="py-2 pr-3 truncate max-w-[28rem]" title={r.description ?? ''}>
                        {r.description ?? ''}
                      </td>
                      <td className="py-2 pr-3 text-xs text-gray-700">
                        <div>{r.requires_number ? `Nummer: Ja (${r.number_label ?? 'Nummer'})` : 'Nummer: Nej'}</div>
                        <div>{r.requires_valid_to ? `Slutdatum: Ja (${r.valid_to_label ?? 'Giltig till'})` : 'Slutdatum: Nej'}</div>
                      </td>
                      <td className="py-2 pr-3">{r.sort_order}</td>
                      <td className="py-2 pr-3">{r.is_active ? 'Ja' : 'Nej'}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => openCertificationModal(r)}
                          className="text-emerald-700 underline"
                        >
                          Editera
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredCertifications.length === 0 && (
                    <tr>
                      <td className="py-4 text-gray-500" colSpan={8}>
                        Inga rader.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'control-points' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="font-semibold">Kontrollpunkter</h2>
                <div className="text-xs text-gray-500">settings_control_points</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  value={qPoints}
                  onChange={e => setQPoints(e.target.value)}
                  placeholder="Sök..."
                  className="border rounded px-2 py-1 text-sm"
                />
                <button
                  onClick={() => openPointModal()}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
                >
                  + Ny
                </button>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="text-gray-400">Sortera:</span>
                <button
                  type="button"
                  onClick={() => togglePointSort('title')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Titel
                  {renderSortIcon(pointSort.key === 'title', pointSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => togglePointSort('scope')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Insida/Utsida
                  {renderSortIcon(pointSort.key === 'scope', pointSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => togglePointSort('applies_to')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Gäller för
                  {renderSortIcon(pointSort.key === 'applies_to', pointSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => togglePointSort('exterior_item_key')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Exterior key
                  {renderSortIcon(pointSort.key === 'exterior_item_key', pointSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => togglePointSort('trigger_room_types')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Rumstyper
                  {renderSortIcon(pointSort.key === 'trigger_room_types', pointSort.dir)}
                </button>
                <button
                  type="button"
                  onClick={() => togglePointSort('is_active')}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-2.5 py-1 hover:bg-gray-50"
                >
                  Aktiv
                  {renderSortIcon(pointSort.key === 'is_active', pointSort.dir)}
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                <span className="text-gray-400">Filtrera:</span>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={pointFilters.scope}
                  onChange={e =>
                    setPointFilters(prev => ({ ...prev, scope: e.target.value }))
                  }
                >
                  <option value="">Insida/Utsida</option>
                  <option value="interior">interior</option>
                  <option value="exterior">exterior</option>
                </select>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={pointFilters.applies_to}
                  onChange={e =>
                    setPointFilters(prev => ({ ...prev, applies_to: e.target.value }))
                  }
                >
                  <option value="">Gäller för</option>
                  <option value="buyer">Köpare</option>
                  <option value="seller">Säljare</option>
                  <option value="apartment">Lägenhet</option>
                </select>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={pointFilters.exterior_item_key}
                  onChange={e =>
                    setPointFilters(prev => ({
                      ...prev,
                      exterior_item_key: e.target.value,
                    }))
                  }
                >
                  <option value="">Exterior key</option>
                  {exteriorItems.map(item => (
                    <option key={item.id} value={item.key}>
                      {item.label} ({item.key})
                    </option>
                  ))}
                </select>
                <div className="relative" ref={roomTypeFilterRef}>
                  <button
                    type="button"
                    onClick={() => setRoomTypeFilterOpen(prev => !prev)}
                    className="border rounded-full px-2.5 py-1 bg-white text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Rumstyper
                    {pointFilters.room_type_keys.length > 0
                      ? ` (${pointFilters.room_type_keys.length})`
                      : ''}
                  </button>
                  {roomTypeFilterOpen && (
                    <div className="absolute z-20 mt-2 w-[260px] rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                      <div className="max-h-[160px] overflow-auto space-y-1">
                        {roomTypes.map(rt => {
                          const checked = pointFilters.room_type_keys.includes(
                            rt.key
                          )
                          return (
                            <label
                              key={rt.id}
                              className="flex items-center gap-2 text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={e =>
                                  setPointFilters(prev => {
                                    const next = new Set(prev.room_type_keys)
                                    if (e.target.checked) next.add(rt.key)
                                    else next.delete(rt.key)
                                    return {
                                      ...prev,
                                      room_type_keys: Array.from(next),
                                    }
                                  })
                                }
                              />
                              <span>
                                {rt.label} ({rt.key})
                              </span>
                            </label>
                          )
                        })}
                        {roomTypes.length === 0 && (
                          <div className="text-xs text-gray-400">
                            Inga rumstyper
                          </div>
                        )}
                      </div>
                      <div className="mt-2 flex justify-end">
                        <button
                          type="button"
                          onClick={() =>
                            setPointFilters(prev => ({
                              ...prev,
                              room_type_keys: [],
                            }))
                          }
                          className="text-[11px] px-2 py-1 rounded-full border border-gray-200 text-gray-600 hover:bg-gray-50"
                        >
                          Rensa val
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <select
                  className="border rounded-full px-2.5 py-1 bg-white"
                  value={pointFilters.is_active}
                  onChange={e =>
                    setPointFilters(prev => ({
                      ...prev,
                      is_active: e.target.value,
                    }))
                  }
                >
                  <option value="">Aktiv</option>
                  <option value="active">Endast aktiva</option>
                  <option value="inactive">Endast inaktiva</option>
                </select>
              </div>

              <div className="space-y-2">
                <table className="w-full table-fixed border-separate border-spacing-y-2 text-[11px]">
                  <thead>
                    <tr className="text-left text-[10px] uppercase text-gray-400 whitespace-nowrap">
                      <th className="px-3 py-1 w-[22%]">Titel</th>
                      <th className="px-3 py-1 w-[10%]">Insida/Utsida</th>
                      <th className="px-3 py-1 w-[14%]">Gäller för</th>
                      <th className="px-3 py-1 w-[10%]">Exterior key</th>
                      <th className="px-3 py-1 w-[22%]">Rumstyper</th>
                      <th className="px-3 py-1 w-[6%]">Aktiv</th>
                      <th className="px-3 py-1 w-[16%] text-center">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPoints.map(p => (
                      <tr
                        key={p.id}
                        className={`group transition-colors ${
                          selectedControlPointId === p.id
                            ? 'bg-emerald-50'
                            : 'hover:bg-blue-50'
                        }`}
                      >
                        <td className="px-3 py-2 border border-gray-200 rounded-l-xl bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate font-medium text-gray-900">
                            {p.title}
                          </div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{p.scope}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{pointAppliesToLabel(p)}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{p.exterior_item_key ?? ''}</div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">
                            {Array.isArray(p.trigger_room_types)
                              ? p.trigger_room_types.join(', ')
                              : p.trigger_room_types
                                ? JSON.stringify(p.trigger_room_types)
                                : ''}
                          </div>
                        </td>
                        <td className="px-3 py-2 border-y border-gray-200 bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="truncate">{p.is_active ? 'Ja' : 'Nej'}</div>
                        </td>
                        <td className="px-3 py-2 border border-gray-200 rounded-r-xl bg-white transition-colors group-hover:bg-blue-50 group-hover:shadow-sm">
                          <div className="grid grid-cols-3 gap-1 text-[11px] whitespace-nowrap">
                            <button
                              onClick={() => openOutcomesPanel(p.id)}
                              className="w-full rounded-md border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                            >
                              Noteringar
                            </button>
                            <button
                              onClick={() => openPointModal(p)}
                              className="w-full rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                            >
                              Editera
                            </button>
                            <button
                              onClick={() => duplicatePoint(p)}
                              className="w-full rounded-md border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"
                            >
                              Duplicera
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {filteredPoints.length === 0 && (
                      <tr>
                        <td className="py-4 text-gray-500 text-xs" colSpan={7}>
                          Inga rader.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

          </div>
        )}
      </div>

      {docModalOpen && docDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {docDraft.id ? 'Redigera dokumenttyp' : 'Ny dokumenttyp'}
                </h3>
                {docDraft.id && (
                  <div className="text-xs text-gray-500 mt-1">ID: {docDraft.id}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {docDraft.id && (
                  <button
                    onClick={() => delDoc(docDraft.id!)}
                    className="text-rose-700 border border-rose-200 bg-rose-50 text-sm px-3 py-1.5 rounded-md hover:bg-rose-100"
                  >
                    Ta bort
                  </button>
                )}
                <button
                  onClick={closeDocModal}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveDoc}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700"
                >
                  Spara
                </button>
                <button
                  onClick={closeDocModal}
                  className="text-sm px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  aria-label="Stäng"
                  title="Stäng"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Kod</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={docDraft.code}
                  onChange={e => setDocDraft({ ...docDraft, code: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Gäller för</div>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={docDraft.applies_to ?? 'all'}
                  onChange={e =>
                    setDocDraft({
                      ...docDraft,
                      applies_to: e.target.value,
                    })
                  }
                >
                  <option value="all">Alla</option>
                  <option value="buyer">Köpare</option>
                  <option value="seller">Säljare</option>
                  <option value="apartment">Lägenhet</option>
                  <option value="buyer,seller">Köpare + säljare</option>
                </select>
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Namn</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={docDraft.label}
                  onChange={e => setDocDraft({ ...docDraft, label: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Kategori</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={docDraft.category ?? ''}
                  onChange={e =>
                    setDocDraft({ ...docDraft, category: e.target.value || null })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Standard</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!docDraft.is_default}
                  onChange={e => setDocDraft({ ...docDraft, is_default: e.target.checked })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Aktiv</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!docDraft.is_active}
                  onChange={e => setDocDraft({ ...docDraft, is_active: e.target.checked })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Beskrivning</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={docDraft.description ?? ''}
                  onChange={e =>
                    setDocDraft({ ...docDraft, description: e.target.value || null })
                  }
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {roomTypeModalOpen && roomTypeDraft && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {roomTypeDraft.id ? 'Redigera rumstyp' : 'Ny rumstyp'}
                </h3>
                {roomTypeDraft.id && (
                  <div className="text-xs text-gray-500 mt-1">ID: {roomTypeDraft.id}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {roomTypeDraft.id && (
                  <button
                    onClick={() => delRoomType(roomTypeDraft.id!)}
                    className="text-rose-700 border border-rose-200 bg-rose-50 text-sm px-3 py-1.5 rounded-md hover:bg-rose-100"
                  >
                    Ta bort
                  </button>
                )}
                <button
                  onClick={closeRoomTypeModal}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveRoomType}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700"
                >
                  Spara
                </button>
                <button
                  onClick={closeRoomTypeModal}
                  className="text-sm px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  aria-label="Stäng"
                  title="Stäng"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Key</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={roomTypeDraft.key}
                  readOnly
                  disabled
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Label</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={roomTypeDraft.label}
                  onChange={e => {
                    const labelValue = e.target.value
                    setRoomTypeDraft(prev =>
                      prev
                        ? {
                            ...prev,
                            label: labelValue,
                            key: prev.id ? prev.key : labelValue,
                          }
                        : prev
                    )
                  }}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Aktiv</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!roomTypeDraft.is_active}
                  onChange={e => setRoomTypeDraft({ ...roomTypeDraft, is_active: e.target.checked })}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {addonServiceModalOpen && addonServiceDraft && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {addonServiceDraft.id ? 'Redigera tilläggsuppdrag' : 'Nytt tilläggsuppdrag'}
                </h3>
                {addonServiceDraft.id && (
                  <div className="text-xs text-gray-500 mt-1">ID: {addonServiceDraft.id}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {addonServiceDraft.id && (
                  <button
                    onClick={() => delAddonService(addonServiceDraft.id!)}
                    className="text-rose-700 border border-rose-200 bg-rose-50 text-sm px-3 py-1.5 rounded-md hover:bg-rose-100"
                  >
                    Ta bort
                  </button>
                )}
                <button
                  onClick={closeAddonServiceModal}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveAddonService}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700"
                >
                  Spara
                </button>
                <button
                  onClick={closeAddonServiceModal}
                  className="text-sm px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  aria-label="Stäng"
                  title="Stäng"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Key (automatisk)</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={
                    addonServiceDraft.id
                      ? addonServiceDraft.key
                      : normalizeAddonKey(addonServiceDraft.name)
                  }
                  readOnly
                />
                <div className="mt-1 text-xs text-gray-500">
                  Skapas automatiskt från namn vid första sparning.
                </div>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Sortering</div>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full"
                  value={addonServiceDraft.sort_order}
                  onChange={e =>
                    setAddonServiceDraft({
                      ...addonServiceDraft,
                      sort_order: e.target.value === '' ? 100 : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Namn</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={addonServiceDraft.name}
                  onChange={e => setAddonServiceDraft({ ...addonServiceDraft, name: e.target.value })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Beskrivning</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={addonServiceDraft.description ?? ''}
                  onChange={e => setAddonServiceDraft({ ...addonServiceDraft, description: e.target.value || null })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Aktiv</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!addonServiceDraft.is_active}
                  onChange={e => setAddonServiceDraft({ ...addonServiceDraft, is_active: e.target.checked })}
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {certificationModalOpen && certificationDraft && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {certificationDraft.id ? 'Redigera certifiering' : 'Ny certifiering'}
                </h3>
                {certificationDraft.id && (
                  <div className="text-xs text-gray-500 mt-1">ID: {certificationDraft.id}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {certificationDraft.id && (
                  <button
                    onClick={() => delCertification(certificationDraft.id!)}
                    className="text-rose-700 border border-rose-200 bg-rose-50 text-sm px-3 py-1.5 rounded-md hover:bg-rose-100"
                  >
                    Ta bort
                  </button>
                )}
                <button
                  onClick={closeCertificationModal}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveCertification}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700"
                >
                  Spara
                </button>
                <button
                  onClick={closeCertificationModal}
                  className="text-sm px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  aria-label="Stäng"
                  title="Stäng"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Key (automatisk)</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={
                    certificationDraft.id
                      ? certificationDraft.key
                      : normalizeAddonKey(certificationDraft.name)
                  }
                  readOnly
                />
                <div className="mt-1 text-xs text-gray-500">
                  Skapas automatiskt från namn vid första sparning.
                </div>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Sortering</div>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full"
                  value={certificationDraft.sort_order}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      sort_order: e.target.value === '' ? 100 : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Typ</div>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={certificationDraft.category}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      category: e.target.value === 'membership' ? 'membership' : 'certification',
                    })
                  }
                >
                  <option value="certification">Certifiering</option>
                  <option value="membership">Medlemskap</option>
                </select>
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Namn</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={certificationDraft.name}
                  onChange={e => setCertificationDraft({ ...certificationDraft, name: e.target.value })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Beskrivning</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={certificationDraft.description ?? ''}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      description: e.target.value || null,
                    })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Nummer obligatoriskt</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!certificationDraft.requires_number}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      requires_number: e.target.checked,
                    })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Slutdatum obligatoriskt</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!certificationDraft.requires_valid_to}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      requires_valid_to: e.target.checked,
                    })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Etikett för nummer</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={certificationDraft.number_label ?? ''}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      number_label: e.target.value || null,
                    })
                  }
                  placeholder="t.ex. Medlemsnummer"
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Etikett för slutdatum</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={certificationDraft.valid_to_label ?? ''}
                  onChange={e =>
                    setCertificationDraft({
                      ...certificationDraft,
                      valid_to_label: e.target.value || null,
                    })
                  }
                  placeholder="t.ex. Giltig till"
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Aktiv</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!certificationDraft.is_active}
                  onChange={e =>
                    setCertificationDraft({ ...certificationDraft, is_active: e.target.checked })
                  }
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {outcomesPanelOpen && selectedControlPointId && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-6xl rounded-xl shadow-lg p-4 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-semibold">Noteringar / Utfall</div>
                <div className="text-xs text-gray-500">settings_control_point_outcomes</div>
                {selectedControlPoint && (
                  <div className="mt-1 text-xs text-gray-600">
                    Kontrollpunkt: <span className="font-medium">{selectedControlPoint.title}</span> ({selectedControlPoint.key})
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => openOutcomeModal()}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
                >
                  + Ny notering
                </button>
                <button
                  onClick={closeOutcomesPanel}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-600">Kopiera markerade noteringar till:</span>
              <select
                value={copyTargetControlPointId}
                onChange={e => setCopyTargetControlPointId(e.target.value)}
                className="border rounded px-2 py-1"
              >
                <option value="">Välj kontrollpunkt...</option>
                {controlPoints
                  .filter(cp => cp.id !== selectedControlPointId)
                  .map(cp => (
                    <option key={cp.id} value={cp.id}>
                      {cp.title} ({cp.key})
                    </option>
                  ))}
              </select>
              <button
                onClick={copyOutcomesToControlPoint}
                className="text-sm px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50"
              >
                Kopiera
              </button>
            </div>

            {outcomesLoading ? (
              <div className="text-sm text-gray-500">Laddar noteringar...</div>
            ) : (
              <div className="overflow-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-600">
                      <th className="py-2 pr-3"></th>
                      <th className="py-2 pr-3">Label</th>
                      <th className="py-2 pr-3">Notering</th>
                      <th className="py-2 pr-3">Risktext</th>
                      <th className="py-2 pr-3">FTU-Text</th>
                      <th className="py-2 pr-3">Severity</th>
                      <th className="py-2 pr-3">Aktiv</th>
                      <th className="py-2 pr-3">Sort</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {outcomes.map(o => (
                      <tr key={o.id}>
                        <td className="py-2 pr-3">
                          <input
                            type="checkbox"
                            checked={selectedOutcomeIds.includes(o.id)}
                            onChange={e =>
                              setSelectedOutcomeIds(prev => {
                                if (e.target.checked) return [...prev, o.id]
                                return prev.filter(id => id !== o.id)
                              })
                            }
                          />
                        </td>
                        <td className="py-2 pr-3">{o.label}</td>
                        <td className="py-2 pr-3 max-w-[220px] truncate">{o.note_template ?? ''}</td>
                        <td className="py-2 pr-3 max-w-[220px] truncate">{o.risk_template ?? ''}</td>
                        <td className="py-2 pr-3 max-w-[220px] truncate">{o.ftu_template ?? ''}</td>
                        <td className="py-2 pr-3">{o.severity ?? ''}</td>
                        <td className="py-2 pr-3">{o.is_active ? 'Ja' : 'Nej'}</td>
                        <td className="py-2 pr-3">{o.sort_order}</td>
                        <td className="py-2 text-right">
                          <button
                            onClick={() => openOutcomeModal(o)}
                            className="text-emerald-700 underline mr-3"
                          >
                            Editera
                          </button>
                          <button
                            onClick={() => duplicateOutcome(o)}
                            className="text-blue-700 underline mr-3"
                          >
                            Duplicera
                          </button>
                          <button
                            onClick={() => deleteOutcome(o.id)}
                            className="text-rose-700 underline"
                          >
                            Ta bort
                          </button>
                        </td>
                      </tr>
                    ))}
                    {outcomes.length === 0 && (
                      <tr>
                        <td className="py-4 text-gray-500" colSpan={9}>
                          Inga noteringar ännu.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {outcomeModalOpen && outcomeDraft && (
        <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-4xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {outcomeDraft.id ? 'Redigera notering/utfall' : 'Ny notering/utfall'}
                </h3>
                {outcomeDraft.id && (
                  <div className="text-xs text-gray-500 mt-1">ID: {outcomeDraft.id}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {outcomeDraft.id && (
                  <button
                    onClick={() => deleteOutcome(outcomeDraft.id!)}
                    className="text-rose-700 border border-rose-200 bg-rose-50 text-sm px-3 py-1.5 rounded-md hover:bg-rose-100"
                  >
                    Ta bort
                  </button>
                )}
                <button
                  onClick={closeOutcomeModal}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveOutcome}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700"
                >
                  Spara
                </button>
                <button
                  onClick={closeOutcomeModal}
                  className="text-sm px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  aria-label="Stäng"
                  title="Stäng"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Label</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={outcomeDraft.label}
                  onChange={e => setOutcomeDraft({ ...outcomeDraft, label: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Severity</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={outcomeDraft.severity ?? ''}
                  onChange={e =>
                    setOutcomeDraft({ ...outcomeDraft, severity: e.target.value || null })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Sort order</div>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full"
                  value={outcomeDraft.sort_order ?? 100}
                  onChange={e =>
                    setOutcomeDraft({
                      ...outcomeDraft,
                      sort_order: e.target.value === '' ? 100 : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Noteringstext</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={outcomeDraft.note_template ?? ''}
                  onChange={e =>
                    setOutcomeDraft({ ...outcomeDraft, note_template: e.target.value || null })
                  }
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Risktext</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={4}
                  value={outcomeDraft.risk_template ?? ''}
                  onChange={e =>
                    setOutcomeDraft({ ...outcomeDraft, risk_template: e.target.value || null })
                  }
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">FTU-Text</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={4}
                  value={outcomeDraft.ftu_template ?? ''}
                  onChange={e =>
                    setOutcomeDraft({ ...outcomeDraft, ftu_template: e.target.value || null })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Aktiv</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!outcomeDraft.is_active}
                  onChange={e =>
                    setOutcomeDraft({ ...outcomeDraft, is_active: e.target.checked })
                  }
                />
              </label>
            </div>
          </div>
        </div>
      )}

      {pointModalOpen && pointDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-4xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">
                  {pointDraft.id ? 'Redigera kontrollpunkt' : 'Ny kontrollpunkt'}
                </h3>
                {pointDraft.key && (
                  <div className="text-xs text-gray-500 mt-1">Key: {pointDraft.key}</div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {pointDraft.id && (
                  <button
                    onClick={() => deleteControlPoint(pointDraft.id!)}
                    className="text-rose-700 border border-rose-200 bg-rose-50 text-sm px-3 py-1.5 rounded-md hover:bg-rose-100"
                  >
                    Ta bort
                  </button>
                )}
                <button
                  onClick={closePointModal}
                  className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={saveControlPoint}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-emerald-700"
                >
                  Spara
                </button>
                <button
                  onClick={closePointModal}
                  className="text-sm px-2 py-1.5 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
                  aria-label="Stäng"
                  title="Stäng"
                >
                  Stäng
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Insida/Utsida</div>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.scope}
                  onChange={e => updatePointDraft({ scope: e.target.value })}
                >
                  <option value="interior">interior</option>
                  <option value="exterior">exterior</option>
                </select>
              </label>
              <div className="text-sm">
                <div className="mb-1 text-gray-600">Gäller för</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border rounded px-2 py-2">
                  {[
                    { value: 'buyer', label: 'Köpare' },
                    { value: 'seller', label: 'Säljare' },
                    { value: 'apartment', label: 'Lägenhet' },
                  ].map(option => {
                    const checked = pointDraft.applies_to.includes(option.value)
                    return (
                      <label key={option.value} className="inline-flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e => {
                            const next = new Set(pointDraft.applies_to)
                            if (e.target.checked) next.add(option.value)
                            else next.delete(option.value)
                            updatePointDraft({ applies_to: normalizeAppliesTo(Array.from(next)) })
                          }}
                        />
                        <span>{option.label}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Titel</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.title}
                  onChange={e => updatePointDraft({ title: e.target.value })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Beskrivning</div>
                <textarea
                  className="border rounded px-2 py-1 w-full resize-y min-h-[120px]"
                  rows={4}
                  value={pointDraft.description ?? ''}
                  onChange={e => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                    updatePointDraft({ description: e.target.value || null })
                  }}
                  onInput={e => {
                    const el = e.currentTarget
                    el.style.height = 'auto'
                    el.style.height = `${el.scrollHeight}px`
                  }}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Exterior item</div>
                <select
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.exterior_item_key ?? ''}
                  onChange={e => updatePointDraft({ exterior_item_key: e.target.value || null })}
                  disabled={pointDraft.scope !== 'exterior'}
                >
                  <option value="">—</option>
                  {exteriorItems.map(item => (
                    <option key={item.id} value={item.key}>
                      {item.label} ({item.key})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Aktiv</div>
                <input
                  type="checkbox"
                  className="mt-2"
                  checked={!!pointDraft.is_active}
                  onChange={e => updatePointDraft({ is_active: e.target.checked })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Risktext</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.default_risk_code ?? ''}
                  onChange={e => updatePointDraft({ default_risk_code: e.target.value || null })}
                />
                <div className="mt-1 text-[11px] text-gray-500">
                  Standardtext på kontrollpunkten. Noteringarnas texter hanteras under Noteringar/Utfall.
                </div>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">FTU-Text</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.default_ftu_code ?? ''}
                  onChange={e => updatePointDraft({ default_ftu_code: e.target.value || null })}
                />
                <div className="mt-1 text-[11px] text-gray-500">
                  Standardtext på kontrollpunkten. Noteringarnas texter hanteras under Noteringar/Utfall.
                </div>
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Trigger year from</div>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.trigger_year_from ?? ''}
                  onChange={e =>
                    updatePointDraft({
                      trigger_year_from: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Trigger year to</div>
                <input
                  type="number"
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.trigger_year_to ?? ''}
                  onChange={e =>
                    updatePointDraft({
                      trigger_year_to: e.target.value === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {pointDraft.scope === 'interior' && (
                <div className="text-sm md:col-span-2">
                  <div className="mb-1 flex items-center justify-between gap-2 text-gray-600">
                    <span>Rumstyper (välj flera)</span>
                    <button
                      type="button"
                      onClick={() => openRoomTypeModal()}
                      className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-700 hover:bg-gray-50"
                    >
                      + Ny rumstyp
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 border rounded p-2 bg-gray-50">
                    {roomTypes.map(rt => {
                      const selected = getTriggerRoomTypes(pointDraft).includes(rt.key)
                      return (
                        <label key={rt.id} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected}
                            onChange={e => {
                              const next = new Set(getTriggerRoomTypes(pointDraft))
                              if (e.target.checked) next.add(rt.key)
                              else next.delete(rt.key)
                              setTriggerRoomTypes(Array.from(next))
                            }}
                          />
                          <span>{rt.label} ({rt.key})</span>
                        </label>
                      )
                    })}
                    {roomTypes.length === 0 && (
                      <div className="text-gray-500 text-sm">Inga rumstyper hittades.</div>
                    )}
                  </div>
                </div>
              )}
              <label className="text-sm">
                <div className="mb-1 text-gray-600">trigger_room_types (JSON)</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.trigger_room_types_text}
                  onChange={e => updatePointDraft({ trigger_room_types_text: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">trigger_component_keys (JSON)</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.trigger_component_keys_text}
                  onChange={e => updatePointDraft({ trigger_component_keys_text: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">trigger_foundation_types (JSON)</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.trigger_foundation_types_text}
                  onChange={e => updatePointDraft({ trigger_foundation_types_text: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">trigger_tags (JSON)</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.trigger_tags_text}
                  onChange={e => updatePointDraft({ trigger_tags_text: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">tags (JSON)</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.tags_text}
                  onChange={e => updatePointDraft({ tags_text: e.target.value })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">risk_tags (JSON)</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.risk_tags_text}
                  onChange={e => updatePointDraft({ risk_tags_text: e.target.value })}
                />
              </label>
            </div>

            <div className="pt-2 border-t text-xs text-gray-500">
              {pointDraft.id ? `ID: ${pointDraft.id}` : 'Ny kontrollpunkt'}
            </div>
          </div>
        </div>
      )}
    </Protected>
  )
}





