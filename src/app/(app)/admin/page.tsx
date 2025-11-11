'use client'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '@/hooks/useProfile'
import { useRouter, useSearchParams } from 'next/navigation'

type DocType = {
  id: string; code: string; label: string;
  category: string | null; scope: 'property'|'building'|null;
  description: string | null; is_default: boolean | null;
}
type CompType = {
  id: string; code: string; name: string;
  category: string | null; default_lifecycle_years: number | null;
  notes: string | null;
}

export default function AdminPage() {
  const { isAdmin, loading } = useProfile()
  const router = useRouter()
  const search = useSearchParams()

  const initialTab = (search.get('tab') === 'comps' ? 'comps' : 'docs') as 'docs'|'comps'
  const [tab, setTab] = useState<'docs'|'comps'>(initialTab)

  // Synka tab <-> URL
  useEffect(() => {
    const t = search.get('tab')
    if (t === 'docs' || t === 'comps') setTab(t)
  }, [search])
  const setTabAndPush = (t: 'docs'|'comps') => {
    setTab(t)
    router.replace(`/admin?tab=${t}`)
  }

  // Dokumenttyper
  const [docs, setDocs] = useState<DocType[]>([])
  const [qDocs, setQDocs] = useState('')

  // Komponenttyper
  const [comps, setComps] = useState<CompType[]>([])
  const [qComps, setQComps] = useState('')

  useEffect(() => {
    if (loading || !isAdmin) return
    loadDocs()
    loadComps()
  }, [loading, isAdmin])

  const loadDocs = async () => {
    const { data, error } = await supabase
      .from('document_types')
      .select('*')
      .order('category', { ascending: true })
      .order('label', { ascending: true })
    if (error) { console.error(error.message); return }
    setDocs((data ?? []) as DocType[])
  }
  const loadComps = async () => {
    const { data, error } = await supabase
      .from('component_types')
      .select('*')
      .order('category', { ascending: true })
      .order('name', { ascending: true })
    if (error) { console.error(error.message); return }
    setComps((data ?? []) as CompType[])
  }

  const filteredDocs = useMemo(() => {
    const s = qDocs.trim().toLowerCase()
    if (!s) return docs
    return docs.filter(d =>
      d.label.toLowerCase().includes(s) ||
      (d.code ?? '').toLowerCase().includes(s) ||
      (d.category ?? '').toLowerCase().includes(s)
    )
  }, [docs, qDocs])

  const filteredComps = useMemo(() => {
    const s = qComps.trim().toLowerCase()
    if (!s) return comps
    return comps.filter(c =>
      c.name.toLowerCase().includes(s) ||
      (c.code ?? '').toLowerCase().includes(s) ||
      (c.category ?? '').toLowerCase().includes(s)
    )
  }, [comps, qComps])

  // --- INLINE SAVE HELPERS ---
  const saveDoc = async (id: string, patch: Partial<DocType>) => {
    const { error } = await supabase.from('document_types').update(patch).eq('id', id)
    if (error) return alert(error.message)
    setDocs(prev => prev.map(x => x.id === id ? { ...x, ...patch } as DocType : x))
  }
  const addDoc = async () => {
    const code = `DOC_${Math.random().toString(36).slice(2,7).toUpperCase()}`
    const { data, error } = await supabase.from('document_types')
      .insert({ code, label: 'Nytt dokument', scope: 'building', is_default: true })
      .select('*').single()
    if (error) return alert(error.message)
    setDocs(prev => [data as DocType, ...prev])
  }
  const delDoc = async (id: string) => {
    if (!confirm('Ta bort dokumenttypen?')) return
    const { error } = await supabase.from('document_types').delete().eq('id', id)
    if (error) return alert(error.message)
    setDocs(prev => prev.filter(x => x.id !== id))
  }

  const saveComp = async (id: string, patch: Partial<CompType>) => {
    const { error } = await supabase.from('component_types').update(patch).eq('id', id)
    if (error) return alert(error.message)
    setComps(prev => prev.map(x => x.id === id ? { ...x, ...patch } as CompType : x))
  }
  const addComp = async () => {
    const code = `CMP_${Math.random().toString(36).slice(2,7).toUpperCase()}`
    const { data, error } = await supabase.from('component_types')
      .insert({ code, name: 'Ny komponent' })
      .select('*').single()
    if (error) return alert(error.message)
    setComps(prev => [data as CompType, ...prev])
  }
  const delComp = async (id: string) => {
    if (!confirm('Ta bort komponenttypen?')) return
    const { error } = await supabase.from('component_types').delete().eq('id', id)
    if (error) return alert(error.message)
    setComps(prev => prev.filter(x => x.id !== id))
  }

  if (loading) return <Protected><div className="p-6">Laddar…</div></Protected>
  if (!isAdmin) return <Protected><div className="p-6 text-rose-700">Åtkomst nekad (endast admin).</div></Protected>

  return (
    <Protected>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-semibold">Admin</h1>
          <div className="inline-flex rounded-lg border overflow-hidden">
            <button
              onClick={()=>setTabAndPush('docs')}
              className={`px-3 py-1.5 text-sm ${tab==='docs'?'bg-gray-100':''}`}
            >
              Dokumenttyper
            </button>
            <button
              onClick={()=>setTabAndPush('comps')}
              className={`px-3 py-1.5 text-sm ${tab==='comps'?'bg-gray-100':''}`}
            >
              Komponentkatalog
            </button>
          </div>
        </div>

        {tab === 'docs' && (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Dokumenttyper</h2>
              <div className="flex items-center gap-2">
                <input value={qDocs} onChange={e=>setQDocs(e.target.value)} placeholder="Sök…" className="border rounded px-2 py-1 text-sm"/>
                <button onClick={addDoc} className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">+ Ny</button>
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
                        <input className="border rounded px-2 py-1 w-56"
                          value={d.label} onChange={e=>saveDoc(d.id,{label:e.target.value})}/>
                      </td>
                      <td className="py-2 pr-3">
                        <input className="border rounded px-2 py-1 w-40"
                          value={d.category ?? ''} onChange={e=>saveDoc(d.id,{category:e.target.value||null})}/>
                      </td>
                      <td className="py-2 pr-3">
                        <select className="border rounded px-2 py-1"
                          value={d.scope ?? 'building'}
                          onChange={e=>saveDoc(d.id,{scope:e.target.value as any})}>
                          <option value="building">building</option>
                          <option value="property">property</option>
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="checkbox" checked={!!d.is_default}
                          onChange={e=>saveDoc(d.id,{is_default: e.target.checked})}/>
                      </td>
                      <td className="py-2 pr-3">
                        <input className="border rounded px-2 py-1 w-72"
                          value={d.description ?? ''} onChange={e=>saveDoc(d.id,{description:e.target.value||null})}/>
                      </td>
                      <td className="py-2">
                        <button onClick={()=>delDoc(d.id)} className="text-rose-600 underline">Ta bort</button>
                      </td>
                    </tr>
                  ))}
                  {filteredDocs.length===0 && (
                    <tr><td className="py-4 text-gray-500" colSpan={7}>Inga rader.</td></tr>
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
                <input value={qComps} onChange={e=>setQComps(e.target.value)} placeholder="Sök…" className="border rounded px-2 py-1 text-sm"/>
                <button onClick={addComp} className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">+ Ny</button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600">
                    <th className="py-2 pr-3">Code</th>
                    <th className="py-2 pr-3">Namn</th>
                    <th className="py-2 pr-3">Kategori</th>
                    <th className="py-2 pr-3">Livslängd (år)</th>
                    <th className="py-2 pr-3">Anteckning</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredComps.map(c => (
                    <tr key={c.id}>
                      <td className="py-2 pr-3">{c.code}</td>
                      <td className="py-2 pr-3">
                        <input className="border rounded px-2 py-1 w-56"
                          value={c.name} onChange={e=>saveComp(c.id,{name:e.target.value})}/>
                      </td>
                      <td className="py-2 pr-3">
                        <input className="border rounded px-2 py-1 w-40"
                          value={c.category ?? ''} onChange={e=>saveComp(c.id,{category:e.target.value||null})}/>
                      </td>
                      <td className="py-2 pr-3">
                        <input type="number" className="border rounded px-2 py-1 w-28"
                          value={c.default_lifecycle_years ?? ''} onChange={e=>saveComp(c.id,{default_lifecycle_years: e.target.value===''? null : Number(e.target.value)})}/>
                      </td>
                      <td className="py-2 pr-3">
                        <input className="border rounded px-2 py-1 w-72"
                          value={c.notes ?? ''} onChange={e=>saveComp(c.id,{notes:e.target.value||null})}/>
                      </td>
                      <td className="py-2">
                        <button onClick={()=>delComp(c.id)} className="text-rose-600 underline">Ta bort</button>
                      </td>
                    </tr>
                  ))}
                  {filteredComps.length===0 && (
                    <tr><td className="py-4 text-gray-500" colSpan={6}>Inga rader.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Protected>
  )
}
