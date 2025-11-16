'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useMemo, useState, ChangeEvent } from 'react'

type Property = {
  id: string
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  plot_area_m2: number | null

  owner_name: string | null
  contact_person: string | null
  property_type: string | null

  tax_value: number | null
  planning_status: string | null
  type_code: string | null

  cover_path: string | null
}

type Building = {
  id: string
  name: string
  cover_path?: string | null
  created_at?: string
}

/** Fält vi använder som basinformation per byggnad (nycklar i basic_fields.key) */
const BUILDING_SUMMARY_KEYS = [
  'year_built',
  'building_type',
  'floors',
  'area_m2',
  'heating',
  'ventilation',
] as const

type BuildingSummaryKey = (typeof BUILDING_SUMMARY_KEYS)[number]

type BasicFieldSummary = {
  id: string
  key: string
  label: string
}

type BuildingBasicValueRow = {
  building_id: string
  field_id: string
  value_text: string | null
}

/** Hjälp: gör om ev. relativ storage-path till full URL som next/image accepterar */
function getImageSrc(path: string | null | undefined): string | null {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('/')) {
    return path
  }
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null
  return `${base}/storage/v1/object/public/property-media/${path}`
}

export default function PropertyOverviewPage() {
  const router = useRouter()
  const { id } = useParams() as { id: string }

  const [property, setProperty] = useState<Property | null>(null)
  const [buildings, setBuildings] = useState<Building[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [edit, setEdit] = useState(false)

  const [form, setForm] = useState<Omit<Property, 'id'>>({
    name: '',
    address: null,
    postal_code: null,
    city: null,
    municipality: null,
    cadastral_id: null,
    plot_area_m2: null,
    owner_name: null,
    contact_person: null,
    property_type: null,
    tax_value: null,
    planning_status: null,
    type_code: null,
    cover_path: null,
  })

  /** Basinfo per byggnad: buildingId -> { key: value_text } */
  const [buildingSummaries, setBuildingSummaries] = useState<
    Record<string, Partial<Record<BuildingSummaryKey, string | null>>>
  >({})

  const dirty = useMemo(() => {
    if (!property) return false
    return JSON.stringify(form) !== JSON.stringify({ ...property, id: undefined })
  }, [form, property])

  /** Hämta basinformationsvärden för en lista med byggnader */
  const loadBuildingSummaries = async (blds: Building[]) => {
    if (!blds || blds.length === 0) return

    const buildingIds = blds.map(b => b.id)

    // 1) Hämta de basic_fields som används för sammanfattningen
    const { data: fieldsData, error: fieldsError } = await supabase
      .from('basic_fields')
      .select('id,key,label')
      .in('key', [...BUILDING_SUMMARY_KEYS])
      .eq('is_active', true)

    if (fieldsError || !fieldsData) {
      console.warn('Kunde inte hämta basic_fields för byggnader:', fieldsError?.message)
      return
    }

    const fields = fieldsData as BasicFieldSummary[]
    if (fields.length === 0) return

    const fieldIdToKey: Record<string, BuildingSummaryKey> = {}
    for (const f of fields) {
      if (BUILDING_SUMMARY_KEYS.includes(f.key as BuildingSummaryKey)) {
        fieldIdToKey[f.id] = f.key as BuildingSummaryKey
      }
    }

    const fieldIds = Object.keys(fieldIdToKey)
    if (fieldIds.length === 0) return

    // 2) Hämta värden för de här fälten för alla byggnader
    const { data: valuesData, error: valuesError } = await supabase
      .from('building_basic_values')
      .select('building_id,field_id,value_text')
      .in('building_id', buildingIds)
      .in('field_id', fieldIds)

    if (valuesError || !valuesData) {
      console.warn('Kunde inte hämta building_basic_values:', valuesError?.message)
      return
    }

    const values = valuesData as BuildingBasicValueRow[]

    const summaries: Record<string, Partial<Record<BuildingSummaryKey, string | null>>> = {}
    for (const bId of buildingIds) {
      summaries[bId] = {}
    }

    for (const row of values) {
      const key = fieldIdToKey[row.field_id]
      if (!key) continue
      if (!summaries[row.building_id]) {
        summaries[row.building_id] = {}
      }
      summaries[row.building_id][key] = row.value_text
    }

    setBuildingSummaries(summaries)
  }

  // Ladda fastighet + byggnader
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [{ data: p }, { data: b }] = await Promise.all([
        supabase.from('properties').select('*').eq('id', id).single(),
        supabase
          .from('buildings')
          .select('id,name,cover_path,created_at')
          .eq('property_id', id)
          .order('created_at', { ascending: false }),
      ])

      if (p) {
        setProperty(p as Property)
        setForm({
          name: p.name,
          address: p.address,
          postal_code: p.postal_code,
          city: p.city,
          municipality: p.municipality,
          cadastral_id: p.cadastral_id,
          plot_area_m2: p.plot_area_m2,
          owner_name: p.owner_name,
          contact_person: p.contact_person,
          property_type: p.property_type,
          tax_value: p.tax_value,
          planning_status: p.planning_status,
          type_code: p.type_code,
          cover_path: p.cover_path,
        })
      }
      if (b) {
        const list = b as Building[]
        setBuildings(list)
        // hämta basinfo för byggnaderna
        loadBuildingSummaries(list)
      }
      setLoading(false)
    }
    load()
  }, [id])

  // Ladda upp/byt bild för FASTIGHET
  const handleUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
      const publicURL = `${pub.publicUrl}?v=${Date.now()}`

      const { error: updErr } = await supabase
        .from('properties')
        .update({ cover_path: publicURL })
        .eq('id', property.id)
      if (updErr) throw updErr

      setProperty({ ...property, cover_path: publicURL })
      setForm(prev => ({ ...prev, cover_path: publicURL }))
    } catch (err) {
      console.error(err)
      alert('Uppladdning misslyckades.')
    } finally {
      setUploading(false)
    }
  }

  // Ladda upp/byt bild för BYGGNAD
  const handleBuildingImageUpload = async (
    buildingId: string,
    e: ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0]
    if (!file || !property) return

    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const filePath = `${property.id}/${buildingId}/cover.${ext}`

      const { error: uploadErr } = await supabase
        .storage.from('property-media')
        .upload(filePath, file, { upsert: true })
      if (uploadErr) throw uploadErr

      const { data: pub } = supabase
        .storage
        .from('property-media')
        .getPublicUrl(filePath)
      const publicURL = `${pub.publicUrl}?v=${Date.now()}`

      const { error: updErr } = await supabase
        .from('buildings')
        .update({ cover_path: publicURL })
        .eq('id', buildingId)
      if (updErr) throw updErr

      setBuildings(prev =>
        prev.map(b => (b.id === buildingId ? { ...b, cover_path: publicURL } : b))
      )
    } catch (err) {
      console.error(err)
      alert('Kunde inte uppdatera bild för byggnaden.')
    } finally {
      e.target.value = ''
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
      postal_code: property.postal_code,
      city: property.city,
      municipality: property.municipality,
      cadastral_id: property.cadastral_id,
      plot_area_m2: property.plot_area_m2,
      owner_name: property.owner_name,
      contact_person: property.contact_person,
      property_type: property.property_type,
      tax_value: property.tax_value,
      planning_status: property.planning_status,
      type_code: property.type_code,
      cover_path: property.cover_path,
    })
    setEdit(false)
  }

  const save = async () => {
    if (!property) return
    const { error } = await supabase
      .from('properties')
      .update(form)
      .eq('id', property.id)

    if (error) {
      alert(error.message)
      return
    }
    setProperty({ ...property, ...form })
    setEdit(false)
  }

  const deleteProperty = async () => {
    if (!property || deleting) return
    if (
      !confirm(
        `Är du säker på att du vill ta bort fastigheten "${property.name}"? Detta går inte att ångra.`
      )
    ) {
      return
    }

    try {
      setDeleting(true)
      const { error } = await supabase
        .from('properties')
        .delete()
        .eq('id', property.id)

      if (error) {
        alert('Kunde inte ta bort fastigheten: ' + error.message)
        console.error(error)
        setDeleting(false)
        return
      }

      router.push('/properties')
    } catch (err) {
      console.error(err)
      alert('Något gick fel vid radering.')
      setDeleting(false)
    }
  }

  // Skapa byggnad + seed basic spaces och gå till byggnaden
  const addBuildingAndGo = async () => {
    if (!property) return

    const { count, error: countErr } = await supabase
      .from('buildings')
      .select('*', { count: 'exact', head: true })
      .eq('property_id', property.id)

    if (countErr) {
      alert(countErr.message)
      return
    }

    const n = count ?? 0
    const defaultName = n === 0 ? 'Huvudbyggnad' : `Byggnad ${n + 1}`

    const { data: bld, error } = await supabase
      .from('buildings')
      .insert({ property_id: property.id, name: defaultName })
      .select('id,name,cover_path,created_at')
      .single()

    if (error || !bld) {
      alert(error?.message ?? 'Kunde inte skapa byggnad')
      return
    }

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
    if (seedErr) {
      console.warn('Kunde inte seed:a spaces:', seedErr.message)
    }

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

  const propertyImgSrc = getImageSrc(property.cover_path)

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
                  onChange={e => handleChange('name', e.target.value)}
                  placeholder="Fastighetsnamn"
                />
                <input
                  className="border rounded px-3 py-2 text-sm w-full md:w-[28rem]"
                  value={form.address ?? ''}
                  onChange={e => handleChange('address', e.target.value)}
                  placeholder="Adress"
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link href="/properties" className="text-sm underline">
              ← Tillbaka
            </Link>

            {!edit ? (
              <>
                <button
                  onClick={() => setEdit(true)}
                  className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
                >
                  Redigera
                </button>
                <button
                  onClick={deleteProperty}
                  disabled={deleting}
                  className="text-sm px-3 py-2 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? 'Tar bort…' : 'Ta bort fastighet'}
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={cancelEdit}
                  className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
                >
                  Avbryt
                </button>
                <button
                  onClick={save}
                  disabled={!dirty}
                  className={`text-sm px-3 py-2 rounded ${
                    dirty
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  Spara
                </button>
              </>
            )}
          </div>
        </div>

        {/* Huvudkort: info + bild */}
        <div className="bg-white rounded-xl shadow p-6 flex flex-col md:flex-row gap-6">
          {/* Vänster – info (Basdata + Ägande + Administrativ info) */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Basdata */}
            <div className="space-y-3">
              <h2 className="font-semibold text-gray-700">Basdata</h2>
              <Field
                label="Fastighetsbeteckning"
                edit={edit}
                value={form.cadastral_id}
                onChange={v => handleChange('cadastral_id', v)}
              />
              <Field
                label="Adress"
                edit={edit}
                value={form.address}
                onChange={v => handleChange('address', v)}
              />
              <Field
                label="Postnummer"
                edit={edit}
                value={form.postal_code}
                onChange={v => handleChange('postal_code', v)}
              />
              <Field
                label="Ort"
                edit={edit}
                value={form.city}
                onChange={v => handleChange('city', v)}
              />
              <Field
                label="Kommun"
                edit={edit}
                value={form.municipality}
                onChange={v => handleChange('municipality', v)}
              />
              <Field
                label="Tomtarea (m²)"
                edit={edit}
                type="number"
                value={form.plot_area_m2?.toString() ?? ''}
                onChange={v =>
                  handleChange('plot_area_m2', v ? Number(v) : null)
                }
              />
            </div>

            {/* Ägande + Administrativ info */}
            <div className="space-y-3">
              <h2 className="font-semibold text-gray-700">Ägande</h2>
              <Field
                label="Fastighetsägare"
                edit={edit}
                value={form.owner_name}
                onChange={v => handleChange('owner_name', v)}
              />
              <Field
                label="Kontaktperson"
                edit={edit}
                value={form.contact_person}
                onChange={v => handleChange('contact_person', v)}
              />
              <Field
                label="Fastighetstyp"
                edit={edit}
                value={form.property_type}
                onChange={v => handleChange('property_type', v)}
                selectOptions={[
                  'Småhus',
                  'BRF',
                  'Kommersiell',
                  'Industrifastighet',
                  'Specialfastighet',
                ]}
              />

              <h2 className="font-semibold text-gray-700 mt-4">
                Administrativ info
              </h2>
              <Field
                label="Taxeringsvärde"
                edit={edit}
                type="number"
                value={form.tax_value?.toString() ?? ''}
                onChange={v =>
                  handleChange('tax_value', v ? Number(v) : null)
                }
              />
              <Field
                label="Planstatus"
                edit={edit}
                value={form.planning_status}
                onChange={v => handleChange('planning_status', v)}
              />
              <Field
                label="Typkod"
                edit={edit}
                value={form.type_code}
                onChange={v => handleChange('type_code', v)}
              />
            </div>
          </div>

          {/* Höger – bild */}
          <div className="w-full md:w-64 flex flex-col items-center">
            {propertyImgSrc ? (
              <Image
                key={propertyImgSrc}
                src={propertyImgSrc}
                alt="Fastighetsbild"
                width={320}
                height={240}
                className="rounded-lg object-cover w-full h-64 shadow"
              />
            ) : (
              <div className="w-full h-40 bg-gray-100 rounded-lg flex items-center justify-center text-gray-500 text-sm border">
                Ingen bild
              </div>
            )}

            <label
              className={`mt-2 text-sm px-3 py-1.5 border rounded cursor-pointer hover:bg-gray-50 ${
                uploading ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              {uploading
                ? 'Laddar upp...'
                : property.cover_path
                ? 'Byt bild'
                : 'Lägg till bild'}
              <input
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="hidden"
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        {/* Åtgärder för fastigheten */}
        <div className="bg-white rounded-xl shadow p-4 flex flex-wrap gap-3">
          <Link
            href={`/properties/${property.id}/ob`}
            className="inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow hover:bg-blue-700"
          >
            Överlåtelsebesiktning
          </Link>
        </div>

        {/* Byggnader */}
        <div>
          <div className="flex items-center justify-between mb-2">
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
              Inga byggnader än.
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow divide-y">
              {buildings.map(b => {
                const buildingImgSrc = getImageSrc(b.cover_path)
                const summary = buildingSummaries[b.id] || {}
                return (
                  <div
                    key={b.id}
                    className="p-4 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between"
                  >
                    {/* Vänster: bild + basinfo */}
                    <div className="flex items-start gap-4 min-w-0 w-full md:w-auto">
                      <div className="h-24 w-36 bg-gray-100 rounded-lg overflow-hidden border flex-shrink-0">
                        {buildingImgSrc ? (
                          <Image
                            src={buildingImgSrc}
                            alt={b.name}
                            width={144}
                            height={96}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="h-full w-full flex items-center justify-center text-[11px] text-gray-400">
                            Ingen bild
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium truncate">{b.name}</div>
                        {b.created_at && (
                          <div className="text-xs text-gray-500 mt-0.5">
                            Skapad {new Date(b.created_at).toLocaleDateString()}
                          </div>
                        )}

                        {/* Basinformation för byggnaden */}
                        <div className="mt-2 text-xs text-gray-600 space-y-0.5">
                          <div>
                            Byggår:{' '}
                            {summary.year_built && summary.year_built !== ''
                              ? summary.year_built
                              : '–'}
                          </div>
                          <div>
                            Typ:{' '}
                            {summary.building_type && summary.building_type !== ''
                              ? summary.building_type
                              : '–'}
                          </div>
                          <div>
                            Våningar:{' '}
                            {summary.floors && summary.floors !== ''
                              ? summary.floors
                              : '–'}
                          </div>
                          <div>
                            Boarea:{' '}
                            {summary.area_m2 && summary.area_m2 !== ''
                              ? `${summary.area_m2} m²`
                              : '–'}
                          </div>
                          <div>
                            Uppvärmning:{' '}
                            {summary.heating && summary.heating !== ''
                              ? summary.heating
                              : '–'}
                          </div>
                          <div>
                            Ventilation:{' '}
                            {summary.ventilation && summary.ventilation !== ''
                              ? summary.ventilation
                              : '–'}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Höger: knappar */}
                    <div className="flex flex-wrap gap-2 md:justify-end w-full md:w-auto items-center">
                      <Link
                        href={`/properties/${id}/buildings/${b.id}/transfer-inspection`}
                        className="text-sm px-3 py-2 rounded border border-emerald-600 text-emerald-700 hover:bg-emerald-50"
                      >
                        Överlåtelsebesiktning
                      </Link>
                      <Link
                        href={`/properties/${id}/buildings/${b.id}`}
                        className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
                      >
                        Underhållsplan
                      </Link>

                      <label className="text-xs px-3 py-1.5 border rounded cursor-pointer hover:bg-gray-50">
                        Byt bild
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={e => handleBuildingImageUpload(b.id, e)}
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </Protected>
  )
}

/* Fält-komponent */
function Field({
  label,
  value,
  onChange,
  placeholder,
  edit,
  type = 'text',
  selectOptions,
}: {
  label: string
  value: string | null
  onChange: (v: string) => void
  placeholder?: string
  edit: boolean
  type?: 'text' | 'number'
  selectOptions?: string[]
}) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      {!edit ? (
        <div className="text-sm font-medium text-gray-800">
          {value && value !== '' ? value : '–'}
        </div>
      ) : selectOptions ? (
        <select
          className="border rounded px-3 py-2 text-sm w-full"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
        >
          <option value="">Välj…</option>
          {selectOptions.map(opt => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          className="border rounded px-3 py-2 text-sm w-full"
          value={value ?? ''}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
