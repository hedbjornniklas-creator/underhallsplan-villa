'use client'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'

type Property = {
  id: string
  name: string
  address: string | null
  client_name: string | null
  year_built: number | null
  area_m2: number | null
  heating: string | null
  ventilation: string | null
  last_inspection_at: string | null
  cover_path: string | null
}

type Building = {
  id: string
  name: string
  cover_path?: string | null
  created_at?: string
}

export default function PropertyOverviewPage() {
  const router = useRouter()
  const { id } = useParams() as { id: string }

  const [property, setProperty] = useState<Property | null>(null)
  const [buildings, setBuildings] = useState<Building[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  // Edit state
  const [edit, setEdit] = useState(false)
  const [form, setForm] = useState<Omit<Property, 'id'>>({
    name: '',
    address: null,
    client_name: null,
    year_built: null,
    area_m2: null,
    heating: null,
    ventilation: null,
    last_inspection_at: null,
    cover_path: null,
  })

  const dirty = useMemo(() => {
    if (!property) return false
    return JSON.stringify({ ...form, last_inspection_at: form.last_inspection_at ?? null }) !==
           JSON.stringify({ ...{ ...property, id: undefined }, last_inspection_at: property.last_inspection_at ?? null })
  }, [form, property])

  // Ladda fastighet + byggnader
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: p, error: pe }, { data: b, error: be }] = await Promise.all([
        supabase.from('properties').select('*').eq('id', id).single(),
        supabase.from('buildings').select('id,name,cover_path,created_at').eq('property_id', id).order('created_at', { ascending: false })
      ])
      if (!pe && p) {
        setProperty(p as Property)
        setForm({
          name: p.name,
          address: p.address,
          client_name: p.client_name,
          year_built: p.year_built,
          area_m2: p.area_m2,
          heating: p.heating,
          ventilation: p.ventilation,
          last_inspection_at: p.last_inspection_at,
          cover_path: p.cover_path,
        })
      }
      if (!be && b) setBuildings(b as Building[])
      setLoading(false)
    }
    load()
  }, [id])

  // === Bilduppladdning för fastigheten ===
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0]
      if (!file || !property) return

      setUploading(true)
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const filePath = `${property.id}/cover.${ext}`

      const { error: uploadError } = await supabase
        .storage.from('property-media')
        .upload(filePath, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data: pub } = supabase.storage.from('property-media').getPublicUrl(filePath)

      const { error: updErr } = await supabase
        .from('properties')
        .update({ cover_path: pub.publicUrl })
        .eq('id', property.id)
      if (updErr) throw updErr

      const busted = `${pub.publicUrl}?v=${Date.now()}`
      setProperty({ ...property, cover_path: busted })
      setForm(prev => ({ ...prev, cover_path: busted }))
    } catch (err) {
      alert('Uppladdning misslyckades.')
      console.error(err)
    } finally {
      setUploading(false)
    }
  }

  const handleChange = (key: keyof typeof form, val: any) => {
    setForm(prev => ({ ...prev, [key]: val === '' ? null : val }))
  }

  const cancelEdit = () => {
    if (!property) return
    setForm({
      name: property.name,
      address: property.address,
      client_name: property.client_name,
      year_built: property.year_built,
      area_m2: property.area_m2,
      heating: property.heating,
      ventilation: property.ventilation,
      last_inspection_at: property.last_inspection_at,
      cover_path: property.cover_path,
    })
    setEdit(false)
  }

  const save = async () => {
    if (!property) return
    const payload = {
      name: form.name,
      address: form.address,
      client_name: form.client_name,
      year_built: form.year_built ? Number(form.year_built) : null,
      area_m2: form.area_m2 ? Number(form.area_m2) : null,
      heating: form.heating,
      ventilation: form.ventilation,
      last_inspection_at: form.last_inspection_at,
      cover_path: form.cover_path,
    }
    const { error } = await supabase.from('properties').update(payload).eq('id', property.id)
    if (error) {
      alert(error.message)
      return
    }
    setProperty({ ...property, ...payload })
    setEdit(false)
  }

  // === Ny kod 2: Skapa byggnad + seed spaces + gå till byggnaden ===
  const addBuildingAndGo = async () => {
    if (!property) return

    const { count, error: countErr } = await supabase
      .from('buildings')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', property.id)
    if (countErr) return alert(countErr.message)

    const n = count ?? 0
    const defaultName = n === 0 ? 'Huvudbyggnad' : `Byggnad ${n + 1}`

    const { data: bld, error } = await supabase
      .from('buildings')
      .insert({ property_id: property.id, name: defaultName })
      .select('id,name,cover_path,created_at')
      .single()
    if (error || !bld) return alert(error?.message ?? 'Kunde inte skapa byggnad')

    // Seed standard-spaces
    const seeds = [
      { name: 'Utvändigt', category: 'Utvändigt' },
      { name: 'Mark', category: 'Utvändigt' },
      { name: 'Grund', category: 'Utvändigt' },
      { name: 'Fasad', category: 'Utvändigt' },
      { name: 'Tak', category: 'Utvändigt' },
      { name: 'Fönster', category: 'Utvändigt' },
      { name: 'Invändigt', category: 'Invändigt' },
      { name: 'Hall', category: 'Invändigt' },
      { name: 'Kök', category: 'Invändigt' },
      { name: 'Badrum', category: 'Invändigt' },
      { name: 'Vardagsrum', category: 'Invändigt' },
    ].map(s => ({ ...s, building_id: bld.id }))

    const { error: seedErr } = await supabase.from('spaces').insert(seeds)
    if (seedErr) console.warn('Kunde inte seed:a spaces:', seedErr.message)

    // Lägg in i UI och gå till byggnaden
    setBuildings(prev => [bld as Building, ...prev])
    router.push(`/properties/${id}/buildings/${(bld as any).id}`)
  }

  if (loading) {
    return (
      <Protected>
        <div className="p-6 text-gray-600">Laddar fastighet…</div>
      </Protected>
    )
  }

  if (!property) {
    return (
      <Protected>
        <div className="p-6 text-gray-600">Fastigheten kunde inte hittas.</div>
      </Protected>
    )
  }

  return (
    <Protected>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            {!edit ? (
              <>
                <h1 className="text-xl md:text-2xl font-semibold">
                  {property.name ?? 'Fastighet utan namn'}
                </h1>
                <div className="text-sm text-gray-600">
                  {property.address ?? 'Ingen adress angiven'}
                </div>
              </>
            ) : (
              <div className="space-y-2">
                <input
                  className="border rounded px-3 py-2 text-base w-full md:w-[28rem]"
                  value={form.name ?? ''}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="Fastighetsnamn"
                />
                <input
                  className="border rounded px-3 py-2 text-sm w-full md:w-[28rem]"
                  value={form.address ?? ''}
                  onChange={(e) => handleChange('address', e.target.value)}
                  placeholder="Adress"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link href="/properties" className="text-sm underline">← Tillbaka</Link>
            {!edit ? (
              <button onClick={() => setEdit(true)} className="text-sm px-3 py-2 rounded border hover:bg-gray-50">
                Redigera
              </button>
            ) : (
              <>
                <button onClick={cancelEdit} className="text-sm px-3 py-2 rounded border hover:bg-gray-50">
                  Avbryt
                </button>
                <button
                  onClick={save}
                  disabled={!dirty}
                  className={`text-sm px-3 py-2 rounded ${dirty ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-500 cursor-not-allowed'}`}
                >
                  Spara
                </button>
              </>
            )}
          </div>
        </div>

        {/* Huvudkort */}
        <div className="bg-white rounded-xl shadow p-6 flex flex-col md:flex-row gap-6">
          {/* Vänster – info */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Kund/ägare" edit={edit} value={form.client_name} onChange={(v)=>handleChange('client_name', v)} placeholder="Namn" />
            <Field label="Byggår" edit={edit} type="number" value={form.year_built?.toString() ?? ''} onChange={(v)=>handleChange('year_built', v ? Number(v) : null)} placeholder="Årtal" />
            <Field label="Boarea" edit={edit} type="number" value={form.area_m2?.toString() ?? ''} onChange={(v)=>handleChange('area_m2', v ? Number(v) : null)} placeholder="m²" suffix=" m²" />
            <Field label="Uppvärmning" edit={edit} value={form.heating} onChange={(v)=>handleChange('heating', v)} placeholder="Ex. Fjärrvärme" />
            <Field label="Ventilation" edit={edit} value={form.ventilation} onChange={(v)=>handleChange('ventilation', v)} placeholder="Ex. Självdrag" />
            <Field label="Senaste besiktning" edit={edit} type="date" value={form.last_inspection_at ?? ''} onChange={(v)=>handleChange('last_inspection_at', v || null)} />
          </div>

          {/* Höger – bild */}
          <div className="w-full md:w-64 flex flex-col items-center">
            {property.cover_path ? (
              <Image
                key={property.cover_path}
                src={property.cover_path}
                alt="Fastighetsbild"
                width={256}
                height={180}
                className="rounded-lg object-cover w-full h-40 shadow"
              />
            ) : (
              <div className="w-full h-40 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 text-sm border">
                Ingen bild
              </div>
            )}

            <label
              className={`mt-2 text-sm px-3 py-1.5 border rounded cursor-pointer hover:bg-gray-50 ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {uploading ? 'Laddar upp...' : property.cover_path ? 'Byt bild' : 'Lägg till bild'}
              <input type="file" accept="image/*" onChange={handleUpload} className="hidden" disabled={uploading} />
            </label>
          </div>
        </div>

        {/* Byggnader */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Byggnader</h2>
          <button
            onClick={addBuildingAndGo}
            className="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg shadow hover:bg-emerald-700 transition"
          >
            + Lägg till byggnad
          </button>
        </div>

        {buildings.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-6 text-gray-600">
            Inga byggnader än. Klicka “Lägg till byggnad” för att starta.
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow divide-y">
            {buildings.map((b) => (
              <div key={b.id} className="p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">{b.name}</div>
                  {b.created_at && (
                    <div className="text-xs text-gray-500 mt-0.5">Skapad {new Date(b.created_at).toLocaleDateString()}</div>
                  )}
                </div>
                {/* === Ny kod 1: rätt länk till byggnad === */}
                <Link href={`/properties/${id}/buildings/${b.id}`} className="text-sm text-emerald-700 underline">
                  Öppna
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>
    </Protected>
  )
}

/* --------------------------------- */
/* Små UI-hjälpare för inline-edit   */
/* --------------------------------- */
function Field({
  label, value, onChange, placeholder, edit, type, suffix,
}: {
  label: string
  value: string | null
  onChange: (v: string) => void
  placeholder?: string
  edit: boolean
  type?: 'text' | 'number' | 'date'
  suffix?: string
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {!edit ? (
        <div className="text-sm font-medium text-gray-800">
          {value && value !== '' ? `${value}${suffix ?? ''}` : '–'}
        </div>
      ) : (
        <input
          type={type ?? 'text'}
          className="border rounded px-3 py-2 text-sm w-full"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
