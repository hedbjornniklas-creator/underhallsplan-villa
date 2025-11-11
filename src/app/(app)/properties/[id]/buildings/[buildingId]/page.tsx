'use client'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Building = { id: string; name: string }
type Space = { id: string; name: string; category: string | null; floor?: string | null }
type ComponentRow = {
  id: string; name: string; status: string | null;
  installed_year: number | null; lifecycle_years: number | null;
  last_action_date: string | null; notes: string | null;
}
type Disclosure = { id: string; title: string; content: string | null; link_url: string | null }
type Fact = { id: string; key: string; value: string | null }

export default function BuildingPage() {
  const { id, buildingId } = useParams() as { id: string; buildingId: string }

  const [building, setBuilding] = useState<Building | null>(null)

  // Handlingar & upplysningar
  const [disclosures, setDisclosures] = useState<Disclosure[]>([])
  const [newDisclosureTitle, setNewDisclosureTitle] = useState('')
  const [newDisclosureContent, setNewDisclosureContent] = useState('')

  // Basinformation
  const [facts, setFacts] = useState<Fact[]>([])
  const [newFactKey, setNewFactKey] = useState('')
  const [newFactValue, setNewFactValue] = useState('')

  // Utrymmen & komponenter
  const [spaces, setSpaces] = useState<Space[]>([])
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)
  const [components, setComponents] = useState<ComponentRow[]>([])
  const [newSpaceName, setNewSpaceName] = useState('')
  const [newSpaceCat, setNewSpaceCat] = useState('')
  const [newSpaceFloor, setNewSpaceFloor] = useState('')
  const [newCompName, setNewCompName] = useState('')
  const [newCompStatus, setNewCompStatus] = useState<'Grön'|'Gul'|'Röd'|''>('')
  const [newCompYear, setNewCompYear] = useState<number | ''>('')
  const [newCompLife, setNewCompLife] = useState<number | ''>('')

  // -------------------- LOAD --------------------
  useEffect(() => {
    loadBuilding()
    loadDisclosures()
    loadFacts()
    loadSpaces()
  }, [buildingId])

  const loadBuilding = async () => {
    const { data } = await supabase.from('buildings').select('id,name').eq('id', buildingId).single()
    if (data) setBuilding(data)
  }

  const loadDisclosures = async () => {
    const { data } = await supabase.from('building_disclosures').select('*').eq('building_id', buildingId).order('created_at', { ascending: false })
    if (data) setDisclosures(data as Disclosure[])
  }

  const loadFacts = async () => {
    const { data } = await supabase.from('building_facts').select('*').eq('building_id', buildingId).order('key', { ascending: true })
    if (data) setFacts(data as Fact[])
  }

  const loadSpaces = async () => {
    const { data } = await supabase.from('spaces').select('id,name,category,floor').eq('building_id', buildingId).order('created_at')
    if (data) {
      setSpaces(data as Space[])
      if (!selectedSpaceId && data.length > 0) setSelectedSpaceId(data[0].id)
    }
  }

  const loadComponents = async (spaceId: string) => {
    const { data } = await supabase.from('components').select('*').eq('space_id', spaceId).order('created_at', { ascending: false })
    if (data) setComponents(data as ComponentRow[])
  }

  useEffect(() => {
    if (selectedSpaceId) loadComponents(selectedSpaceId)
    else setComponents([])
  }, [selectedSpaceId])

  // -------------------- ADD NEW --------------------
  const addDisclosure = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDisclosureTitle.trim()) return
    const { data, error } = await supabase.from('building_disclosures').insert({
      building_id: buildingId,
      title: newDisclosureTitle.trim(),
      content: newDisclosureContent.trim() || null
    }).select('*').single()
    if (error) return alert(error.message)
    setDisclosures(prev => [data as Disclosure, ...prev])
    setNewDisclosureTitle(''); setNewDisclosureContent('')
  }

  const addFact = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newFactKey.trim()) return
    const { data, error } = await supabase.from('building_facts').insert({
      building_id: buildingId,
      key: newFactKey.trim(),
      value: newFactValue.trim() || null
    }).select('*').single()
    if (error) return alert(error.message)
    setFacts(prev => [...prev, data as Fact])
    setNewFactKey(''); setNewFactValue('')
  }

  const addSpace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newSpaceName.trim()) return
    const payload = {
      building_id: buildingId,
      name: newSpaceName.trim(),
      category: newSpaceCat.trim() || null,
      floor: newSpaceFloor.trim() || null
    }
    const { data, error } = await supabase.from('spaces').insert(payload).select('*').single()
    if (error) return alert(error.message)
    setSpaces(prev => [...prev, data as Space])
    setNewSpaceName(''); setNewSpaceCat(''); setNewSpaceFloor('')
  }

  const addComponent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedSpaceId) return alert('Välj ett utrymme först')
    if (!newCompName.trim()) return

    const payload: any = {
      space_id: selectedSpaceId,
      name: newCompName.trim(),
      status: newCompStatus || null,
      installed_year: newCompYear === '' ? null : Number(newCompYear),
      lifecycle_years: newCompLife === '' ? null : Number(newCompLife),
    }

    const { data, error } = await supabase.from('components').insert(payload).select('*').single()
    if (error) return alert(error.message)
    setComponents(prev => [data as ComponentRow, ...prev])
    setNewCompName(''); setNewCompStatus(''); setNewCompYear(''); setNewCompLife('')
  }

  // -------------------- RENDER --------------------
  return (
    <Protected>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-gray-500">
              <Link href={`/properties/${id}`} className="underline">← Till fastighet</Link>
            </div>
            <h1 className="text-xl md:text-2xl font-semibold mt-1">
              {building?.name ?? 'Byggnad'}
            </h1>
          </div>
        </div>

        {/* HANDLINGAR */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="font-semibold">Handlingar & upplysningar</h2>
          {disclosures.length === 0 ? (
            <div className="text-sm text-gray-600">Inga upplysningar än.</div>
          ) : (
            <ul className="space-y-1">
              {disclosures.map(d => (
                <li key={d.id}>
                  <div className="font-medium">{d.title}</div>
                  {d.content && <div className="text-xs text-gray-500">{d.content}</div>}
                  {d.link_url && <a href={d.link_url} target="_blank" className="text-xs text-emerald-700 underline">Visa dokument</a>}
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addDisclosure} className="border-t pt-3 space-y-2">
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Titel" value={newDisclosureTitle} onChange={e=>setNewDisclosureTitle(e.target.value)} />
            <textarea className="border rounded px-2 py-1 text-sm w-full" placeholder="Beskrivning" value={newDisclosureContent} onChange={e=>setNewDisclosureContent(e.target.value)} />
            <button className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">+ Lägg till</button>
          </form>
        </div>

        {/* BASINFORMATION */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="font-semibold">Basinformation</h2>
          {facts.length === 0 ? (
            <div className="text-sm text-gray-600">Ingen information ännu.</div>
          ) : (
            <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {facts.map(f => (
                <div key={f.id}>
                  <dt className="text-xs text-gray-500">{f.key}</dt>
                  <dd className="text-sm font-medium text-gray-800">{f.value ?? '—'}</dd>
                </div>
              ))}
            </dl>
          )}
          <form onSubmit={addFact} className="border-t pt-3 grid sm:grid-cols-2 gap-2">
            <input className="border rounded px-2 py-1 text-sm" placeholder="Nyckel (ex. Byggnadsår)" value={newFactKey} onChange={e=>setNewFactKey(e.target.value)} />
            <input className="border rounded px-2 py-1 text-sm" placeholder="Värde" value={newFactValue} onChange={e=>setNewFactValue(e.target.value)} />
            <div className="sm:col-span-2">
              <button className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">+ Lägg till rad</button>
            </div>
          </form>
        </div>

        {/* UTRYMMEN */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <h2 className="font-semibold">Utrymmen</h2>
          {spaces.length === 0 ? (
            <div className="text-sm text-gray-600">Inga utrymmen ännu.</div>
          ) : (
            <ul className="space-y-1">
              {spaces.map(s => (
                <li key={s.id}>
                  <button
                    onClick={() => setSelectedSpaceId(s.id)}
                    className={`w-full text-left px-2 py-1 rounded ${
                      selectedSpaceId === s.id ? 'bg-emerald-50 text-emerald-800' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="font-medium">{s.name}</div>
                    <div className="text-xs text-gray-500">
                      {s.category ?? '—'} {s.floor ? `• ${s.floor}` : ''}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form onSubmit={addSpace} className="mt-4 border-t pt-3 space-y-2">
            <div className="text-sm font-medium">Lägg till utrymme</div>
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Namn (ex. Badrum)" value={newSpaceName} onChange={e=>setNewSpaceName(e.target.value)} />
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Kategori (Utvändigt / Invändigt)" value={newSpaceCat} onChange={e=>setNewSpaceCat(e.target.value)} />
            <input className="w-full border rounded px-2 py-1 text-sm" placeholder="Våningsplan (ex. Entréplan)" value={newSpaceFloor} onChange={e=>setNewSpaceFloor(e.target.value)} />
            <button className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">+ Lägg till</button>
          </form>
        </div>

        {/* KOMPONENTER */}
        <div className="bg-white rounded-xl shadow p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Komponenter</h2>
            {selectedSpaceId && (
              <span className="text-xs text-gray-500">
                {spaces.find(s=>s.id===selectedSpaceId)?.name}
              </span>
            )}
          </div>

          {!selectedSpaceId ? (
            <div className="text-sm text-gray-600">Välj ett utrymme ovanför.</div>
          ) : (
            <>
              {components.length === 0 ? (
                <div className="text-sm text-gray-600">Inga komponenter än.</div>
              ) : (
                <div className="divide-y">
                  {components.map(c => (
                    <div key={c.id} className="py-3 flex items-center justify-between">
                      <div>
                        <div className="font-medium">{c.name}</div>
                        <div className="text-xs text-gray-500">
                          {c.status ?? '—'} {c.installed_year ? `• ${c.installed_year}` : ''} {c.lifecycle_years ? `• livslängd ${c.lifecycle_years} år` : ''}
                        </div>
                      </div>
                      {c.last_action_date && (
                        <div className="text-xs text-gray-500">Senaste åtgärd: {c.last_action_date}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={addComponent} className="mt-4 border-t pt-4 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
                <input className="border rounded px-2 py-1 text-sm" placeholder="Namn (ex. Tak – Plåt)" value={newCompName} onChange={e=>setNewCompName(e.target.value)} />
                <select className="border rounded px-2 py-1 text-sm" value={newCompStatus} onChange={e=>setNewCompStatus(e.target.value as any)}>
                  <option value="">Status</option>
                  <option>Grön</option>
                  <option>Gul</option>
                  <option>Röd</option>
                </select>
                <input className="border rounded px-2 py-1 text-sm" type="number" placeholder="Installerad (år)" value={newCompYear} onChange={e=>setNewCompYear(e.target.value === '' ? '' : Number(e.target.value))} />
                <input className="border rounded px-2 py-1 text-sm" type="number" placeholder="Livslängd (år)" value={newCompLife} onChange={e=>setNewCompLife(e.target.value === '' ? '' : Number(e.target.value))} />
                <div className="sm:col-span-2">
                  <button className="bg-emerald-600 text-white text-sm px-3 py-1.5 rounded">+ Lägg till komponent</button>
                </div>
              </form>
            </>
          )}
        </div>
      </div>
    </Protected>
  )
}
