'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import type { Database } from '@/types/supabase'
import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { useRouter, useSearchParams } from 'next/navigation'

type DocType = {
  id: string
  code: string
  label: string
  category: string | null
  scope: 'property' | 'building' | null
  description: string | null
  is_default: boolean | null
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

type ExteriorItem = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type ControlPointRow = Database['public']['Tables']['settings_control_points']['Row']

type ControlPointDraft = {
  id?: string
  key: string
  title: string
  label: string | null
  description: string | null
  scope: string
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

export default function AdminClient() {
  const { isAdmin, loading } = useProfile()
  const router = useRouter()
  const search = useSearchParams()

  const initialTab = (search.get('tab') === 'comps'
    ? 'comps'
    : search.get('tab') === 'control-points'
      ? 'control-points'
      : 'docs') as 'docs' | 'comps' | 'control-points'
  const [tab, setTab] = useState<'docs' | 'comps' | 'control-points'>(initialTab)

  // Synka tab <-> URL
  useEffect(() => {
    const t = search.get('tab')
    if (t === 'docs' || t === 'comps' || t === 'control-points') setTab(t)
  }, [search])
  const setTabAndPush = (t: 'docs' | 'comps' | 'control-points') => {
    setTab(t)
    router.replace(`/admin?tab=${t}`)
  }

  // Dokumenttyper
  const [docs, setDocs] = useState<DocType[]>([])
  const [qDocs, setQDocs] = useState('')

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
  const [pointModalOpen, setPointModalOpen] = useState(false)
  const [pointDraft, setPointDraft] = useState<ControlPointDraft | null>(null)
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([])
  const [exteriorItems, setExteriorItems] = useState<ExteriorItem[]>([])

  useEffect(() => {
    if (loading || !isAdmin) return
    loadDocs()
    loadComps()
    loadControlPoints()
    loadRoomTypes()
    loadExteriorItems()
  }, [loading, isAdmin])

  const loadDocs = async () => {
    const { data, error } = await supabase
      .from('document_types')
      .select('id, code, label, category, scope, description, is_default')
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
        'id, key, title, label, description, scope, exterior_item_key, sort_order, is_active, default_risk_code, default_ftu_code, trigger_year_from, trigger_year_to, trigger_room_types, trigger_component_keys, trigger_foundation_types, trigger_tags, tags, risk_tags, created_at, updated_at'
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

  const filteredDocs = useMemo(() => {
    const s = qDocs.trim().toLowerCase()
    if (!s) return docs
    return docs.filter(
      d =>
        d.label.toLowerCase().includes(s) ||
        (d.code ?? '').toLowerCase().includes(s) ||
        (d.category ?? '').toLowerCase().includes(s)
    )
  }, [docs, qDocs])

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

  const buildPointDraft = (
    row?: ControlPointRow,
    overrides?: Partial<ControlPointDraft>
  ): ControlPointDraft => ({
    id: row?.id,
    key: row?.key ?? '',
    title: row?.title ?? '',
    label: row?.label ?? null,
    description: row?.description ?? null,
    scope: row?.scope ?? 'interior',
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
    setPointDraft(buildPointDraft(row))
    setPointModalOpen(true)
  }

  const duplicatePoint = (row: ControlPointRow) => {
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
      throw new Error(`FÃ¤ltet ${label} mÃ¥ste vara giltig JSON.`)
    }
  }

  const saveControlPoint = async () => {
    if (!pointDraft) return

    const title = pointDraft.title.trim()
    const scope = pointDraft.scope?.trim()

    if (!title || !scope) {
      alert('Titel och scope måste fyllas i.')
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
        label: pointDraft.label?.trim() || null,
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
      alert(e?.message || 'JSON-fÃ¤ltet Ã¤r ogiltigt.')
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
        'id, key, title, label, description, scope, exterior_item_key, room_type_key, sort_order, is_active, default_risk_code, default_ftu_code, trigger_year_from, trigger_year_to, trigger_room_types, trigger_component_keys, trigger_foundation_types, trigger_tags, tags, risk_tags, created_at, updated_at'
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
    closePointModal()
  }

  const filteredPoints = useMemo(() => {
    const s = qPoints.trim().toLowerCase()
    const rows = !s
      ? controlPoints
      : controlPoints.filter(p =>
          (p.key ?? '').toLowerCase().includes(s) ||
          (p.title ?? '').toLowerCase().includes(s) ||
          (p.label ?? '').toLowerCase().includes(s) ||
          (p.description ?? '').toLowerCase().includes(s) ||
          (p.exterior_item_key ?? '').toLowerCase().includes(s) ||
          (p.scope ?? '').toLowerCase().includes(s)
        )

    const sorted = [...rows].sort((a, b) => {
      const dir = pointSort.dir === 'asc' ? 1 : -1
      const aVal = (a[pointSort.key] ?? '') as any
      const bVal = (b[pointSort.key] ?? '') as any
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
  }, [controlPoints, qPoints, pointSort])

  const togglePointSort = (key: keyof ControlPointRow) => {
    setPointSort(prev => {
      if (prev.key === key) {
        return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      }
      return { key, dir: 'asc' }
    })
  }

  // --- INLINE SAVE HELPERS ---
  const saveDoc = async (
    id: string,
    patch: Database['public']['Tables']['document_types']['Update']
  ) => {
    const { error } = await (supabase as any)
      .from('document_types')
      .update(patch)
      .eq('id', id)
    if (error) return alert(error.message)
    setDocs(prev => prev.map(x => (x.id === id ? { ...x, ...patch } as DocType : x)))
  }
  const addDoc = async () => {
    const code = `DOC_${Math.random().toString(36).slice(2, 7).toUpperCase()}`
    const { data, error } = await (supabase as any)
      .from('document_types')
      .insert({ code, label: 'Nytt dokument', scope: 'building', is_default: true })
      .select('id, code, label, category, scope, description, is_default')
      .single()
    if (error) return alert(error.message)
    setDocs(prev => [data as DocType, ...prev])
  }
  const delDoc = async (id: string) => {
    if (!confirm('Ta bort dokumenttypen?')) return
    const { error } = await (supabase as any)
      .from('document_types')
      .delete()
      .eq('id', id)
    if (error) return alert(error.message)
    setDocs(prev => prev.filter(x => x.id !== id))
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

  if (loading)
    return (
      <Protected>
        <div className="p-6">LaddarÆ?Ã</div>
      </Protected>
    )
  if (!isAdmin)
    return (
      <Protected>
        <div className="p-6 text-rose-700">Ã.tkomst nekad (endast admin).</div>
      </Protected>
    )

  return (
    <Protected>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">Admin</h1>
          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              onClick={() => setTabAndPush('docs')}
              className={`px-3 py-1.5 text-sm ${tab === 'docs' ? 'bg-gray-100' : ''}`}
            >
              Dokumenttyper
            </button>
            <button
              onClick={() => setTabAndPush('comps')}
              className={`px-3 py-1.5 text-sm ${tab === 'comps' ? 'bg-gray-100' : ''}`}
            >
              Komponentkatalog
            </button>
            <button
              onClick={() => setTabAndPush('control-points')}
              className={`px-3 py-1.5 text-sm ${tab === 'control-points' ? 'bg-gray-100' : ''}`}
            >
              Kontrollpunkter
            </button>
          </div>
        </div>

        {tab === 'docs' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Dokumenttyper</h2>
              <div className="flex items-center gap-2">
                <input
                  value={qDocs}
                  onChange={e => setQDocs(e.target.value)}
                  placeholder="SÃÃ´kÆ?Ã"
                  className="border rounded px-2 py-1 text-sm"
                />
                <button onClick={addDoc} className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">
                  + Ny
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">Code</th>
                    <th className="py-2 pr-3">Label</th>
                    <th className="py-2 pr-3">Kategori</th>
                    <th className="py-2 pr-3">Scope</th>
                    <th className="py-2 pr-3">Standard</th>
                    <th className="py-2 pr-3">Beskrivning</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredDocs.map(d => (
                    <tr key={d.id}>
                      <td className="py-2 pr-3">{d.code}</td>
                      <td className="py-2 pr-3">
                        <input
                          className="border rounded px-2 py-1 w-56"
                          value={d.label}
                          onChange={e => saveDoc(d.id, { label: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          className="border rounded px-2 py-1 w-40"
                          value={d.category ?? ''}
                          onChange={e => saveDoc(d.id, { category: e.target.value || null })}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          className="border rounded px-2 py-1"
                          value={d.scope ?? 'building'}
                          onChange={e => saveDoc(d.id, { scope: e.target.value as any })}
                        >
                          <option value="building">building</option>
                          <option value="property">property</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="checkbox" checked={!!d.is_default} onChange={e => saveDoc(d.id, { is_default: e.target.checked })} />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          className="border rounded px-2 py-1 w-72"
                          value={d.description ?? ''}
                          onChange={e => saveDoc(d.id, { description: e.target.value || null })}
                        />
                      </td>
                      <td className="py-2">
                        <button onClick={() => delDoc(d.id)} className="text-rose-600 underline">
                          Ta bort
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredDocs.length === 0 && (
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

        {tab === 'comps' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Komponentkatalog</h2>
              <div className="flex items-center gap-2">
                <input
                  value={qComps}
                  onChange={e => setQComps(e.target.value)}
                  placeholder="SÃÃ´kÆ?Ã"
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
                    <th className="py-2 pr-3">StandardlivslÃÃngd (ÃÂ¾r)</th>
                    <th className="py-2 pr-3">UnderhÃÂ¾llsintervall (ÃÂ¾r)</th>
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

        {tab === 'control-points' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Kontrollpunkter</h2>
              <div className="flex items-center gap-2">
                <input
                  value={qPoints}
                  onChange={e => setQPoints(e.target.value)}
                  placeholder="Sok..."
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
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3 cursor-pointer" onClick={() => togglePointSort('key')}>
                      Key{pointSort.key === 'key' ? (pointSort.dir === 'asc' ? ' â²' : ' â¼') : ''}
                    </th>
                    <th className="py-2 pr-3 cursor-pointer" onClick={() => togglePointSort('title')}>
                      Titel{pointSort.key === 'title' ? (pointSort.dir === 'asc' ? ' â²' : ' â¼') : ''}
                    </th>
                    <th className="py-2 pr-3 cursor-pointer" onClick={() => togglePointSort('scope')}>
                      Insida/Utsida{pointSort.key === 'scope' ? (pointSort.dir === 'asc' ? ' â²' : ' â¼') : ''}
                    </th>
                    <th className="py-2 pr-3">Exterior key</th>
                    <th className="py-2 pr-3 cursor-pointer" onClick={() => togglePointSort('is_active')}>
                      Aktiv{pointSort.key === 'is_active' ? (pointSort.dir === 'asc' ? ' â²' : ' â¼') : ''}
                    </th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredPoints.map(p => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3">{p.key}</td>
                      <td className="py-2 pr-3">{p.title}</td>
                      <td className="py-2 pr-3">{p.scope}</td>
                      <td className="py-2 pr-3">{p.exterior_item_key ?? ''}</td>
                      <td className="py-2 pr-3">{p.is_active ? 'Ja' : 'Nej'}</td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => openPointModal(p)}
                          className="text-emerald-700 underline mr-3"
                        >
                          Editera
                        </button>
                        <button
                          onClick={() => duplicatePoint(p)}
                          className="text-blue-700 underline"
                        >
                          Duplicera
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredPoints.length === 0 && (
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
      </div>

      {pointModalOpen && pointDraft && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-auto">
          <div className="bg-white w-full max-w-4xl rounded-xl shadow-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold">
                  {pointDraft.id ? 'Redigera kontrollpunkt' : 'Ny kontrollpunkt'}
                </h3>
                {pointDraft.key && (
                  <div className="text-xs text-gray-500 mt-1">Key: {pointDraft.key}</div>
                )}
              </div>
              <button onClick={closePointModal} className="text-sm underline">
                Stang
              </button>
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
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Titel</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.title}
                  onChange={e => updatePointDraft({ title: e.target.value })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Label</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.label ?? ''}
                  onChange={e => updatePointDraft({ label: e.target.value || null })}
                />
              </label>
              <label className="text-sm md:col-span-2">
                <div className="mb-1 text-gray-600">Beskrivning</div>
                <textarea
                  className="border rounded px-2 py-1 w-full"
                  rows={3}
                  value={pointDraft.description ?? ''}
                  onChange={e => updatePointDraft({ description: e.target.value || null })}
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
                  <option value="">â</option>
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
                <div className="mb-1 text-gray-600">Default risk code</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.default_risk_code ?? ''}
                  onChange={e => updatePointDraft({ default_risk_code: e.target.value || null })}
                />
              </label>
              <label className="text-sm">
                <div className="mb-1 text-gray-600">Default FTU code</div>
                <input
                  className="border rounded px-2 py-1 w-full"
                  value={pointDraft.default_ftu_code ?? ''}
                  onChange={e => updatePointDraft({ default_ftu_code: e.target.value || null })}
                />
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
                  <div className="mb-1 text-gray-600">Rumstyper (valj flera)</div>
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

            <div className="flex items-center justify-between pt-2 border-t">
              <div className="text-xs text-gray-500">
                {pointDraft.id ? `ID: ${pointDraft.id}` : 'Ny kontrollpunkt'}
              </div>
              <div className="flex items-center gap-2">
                {pointDraft.id && (
                  <button
                    onClick={() => deleteControlPoint(pointDraft.id!)}
                    className="text-rose-600 underline text-sm"
                  >
                    Ta bort
                  </button>
                )}
                <button onClick={closePointModal} className="text-sm underline">
                  Avbryt
                </button>
                <button
                  onClick={saveControlPoint}
                  className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded"
                >
                  Spara
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Protected>
  )
}



