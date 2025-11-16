'use client'

// Route: /properties/[id]/buildings

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import Protected from '@/components/Protected'

type Building = {
  id: string
  property_id: string
  name: string
  built_year: number | null
  notes: string | null
  cover_path: string | null
}

type Media = {
  id: string
  building_id: string
  path: string
  caption: string | null
  sort_order: number | null
  created_at: string
}

export default function BuildingsPage() {
  const { id: propertyId } = useParams() as { id: string }

  const [buildings, setBuildings] = useState<Building[]>([])
  const [loading, setLoading] = useState(true)

  // Ny byggnad (modal)
  const [openNew, setOpenNew] = useState(false)
  const [bName, setBName] = useState('')

  // Galleri (modal)
  const [openGallery, setOpenGallery] = useState(false)
  const [activeBuilding, setActiveBuilding] = useState<Building | null>(null)
  const [gallery, setGallery] = useState<Media[]>([])
  const [galleryLoading, setGalleryLoading] = useState(false)

  // Cache för signerade URL:er så vi inte hämtar om och om igen
  const [signedUrlCache, setSignedUrlCache] = useState<Record<string, string>>({})

  // Vilken byggnad som tas bort just nu
  const [deletingId, setDeletingId] = useState<string | null>(null)

  useEffect(() => {
    loadBuildings()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  const loadBuildings = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('buildings')
      .select('id, property_id, name, built_year, notes, cover_path')
      .eq('property_id', propertyId)
      .order('created_at', { ascending: true })
    if (!error) setBuildings((data ?? []) as Building[])
    setLoading(false)
  }

  // Hjälp: hämta signerad URL för storage-path
  const getSignedUrl = async (path: string | null) => {
    if (!path) return null
    if (signedUrlCache[path]) return signedUrlCache[path]
    // giltighet 1 timme
    const { data, error } = await supabase.storage.from('property-media').createSignedUrl(path, 3600)
    if (error) return null
    const url = data.signedUrl
    setSignedUrlCache(prev => ({ ...prev, [path]: url }))
    return url
  }

  // Lägg till ny byggnad (endast namn krävs)
  const addBuilding = async (e: React.FormEvent) => {
    e.preventDefault()
    const payload = { property_id: propertyId, name: bName || 'Byggnad' }
    const { error } = await supabase.from('buildings').insert(payload)
    if (error) return alert(error.message)
    setBName('')
    setOpenNew(false)
    await loadBuildings()
  }

  // Ta bort byggnad
  const deleteBuilding = async (b: Building) => {
    const ok = confirm(
      `Är du säker på att du vill ta bort byggnaden "${b.name}"? Detta går inte att ångra.`
    )
    if (!ok) return

    try {
      setDeletingId(b.id)
      const { error } = await supabase.from('buildings').delete().eq('id', b.id)
      if (error) {
        alert('Kunde inte ta bort byggnaden: ' + error.message)
        console.error(error)
        return
      }
      await loadBuildings()
    } finally {
      setDeletingId(null)
    }
  }

  // Ladda upp / byt omslagsbild
  const onUploadCover = async (building: Building, file: File) => {
    try {
      if (!file) return
      const ext = file.name.split('.').pop()?.toLowerCase() || 'webp'
      const path = `${propertyId}/${building.id}/cover.${ext}`

      // Ladda upp (upsert = true för att ersätta)
      const { error: upErr } = await supabase
        .storage.from('property-media')
        .upload(path, file, { upsert: true, cacheControl: '3600' })
      if (upErr) throw upErr

      // Spara sökväg på byggnaden
      const { error: updErr } = await supabase
        .from('buildings')
        .update({ cover_path: path })
        .eq('id', building.id)
      if (updErr) throw updErr

      // Rensa cache för just denna path så ny URL hämtas
      setSignedUrlCache(prev => {
        const nxt = { ...prev }
        delete nxt[path]
        return nxt
      })

      await loadBuildings()
    } catch (e: any) {
      alert(e.message ?? 'Kunde inte ladda upp bild')
    }
  }

  // Öppna galleri-modal för en byggnad
  const openGalleryFor = async (building: Building) => {
    setActiveBuilding(building)
    setOpenGallery(true)
    setGalleryLoading(true)
    const { data, error } = await supabase
      .from('building_media')
      .select('id, building_id, path, caption, sort_order, created_at')
      .eq('building_id', building.id)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    if (!error) setGallery((data ?? []) as Media[])
    setGalleryLoading(false)
  }

  // Ladda upp flera galleribilder
  const onUploadGallery = async (files: FileList | null) => {
    if (!files || !activeBuilding) return
    try {
      const list = Array.from(files)
      for (const f of list) {
        const ext = f.name.split('.').pop()?.toLowerCase() || 'webp'
        const uid = crypto.randomUUID()
        const path = `${propertyId}/${activeBuilding.id}/gallery/${uid}.${ext}`

        const { error: upErr } = await supabase
          .storage.from('property-media')
          .upload(path, f, { cacheControl: '3600' })
        if (upErr) throw upErr

        const { error: insErr } = await supabase
          .from('building_media')
          .insert({ building_id: activeBuilding.id, path })
        if (insErr) throw insErr
      }
      // Ladda om listan
      await openGalleryFor(activeBuilding)
    } catch (e: any) {
      alert(e.message ?? 'Kunde inte ladda upp en eller flera filer')
    }
  }

  // Ta bort bild från galleri
  const deleteGalleryItem = async (m: Media) => {
    if (!confirm('Ta bort denna bild?')) return
    const { error: delDb } = await supabase.from('building_media').delete().eq('id', m.id)
    if (delDb) return alert(delDb.message)

    // Försök ta bort filen (om den finns kvar)
    await supabase.storage.from('property-media').remove([m.path])

    if (activeBuilding) await openGalleryFor(activeBuilding)
  }

  // Hjälp: rendera bild (omsorgsfullt hanterad signerad URL)
  const useSigned = (path: string | null) => {
    const [url, setUrl] = useState<string | null>(null)
    useEffect(() => {
      let mounted = true
      ;(async () => {
        const u = await getSignedUrl(path)
        if (mounted) setUrl(u)
      })()
      return () => { mounted = false }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [path])
    return url
  }

  // Liten rad-komponent inline (för enkelhet)
  const BuildingRow: React.FC<{ b: Building }> = ({ b }) => {
    const coverUrl = useSigned(b.cover_path)
    const isDeleting = deletingId === b.id

    return (
      <div className="p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-14 w-20 bg-gray-100 rounded overflow-hidden border">
            {coverUrl ? (
              // Använder <img> för att slippa konfigurera next/image-domänen nu
              <img src={coverUrl} alt="Omslag" className="h-full w-full object-cover" />
            ) : (
              <div className="h-full w-full flex items-center justify-center text-[11px] text-gray-400">
                Ingen bild
              </div>
            )}
          </div>
          <div className="min-w-0">
            <div className="font-medium truncate">{b.name}</div>
            <div className="text-xs text-gray-600 truncate">
              {b.built_year ? `Byggår ${b.built_year}` : '—'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Byt/Lägg omslag */}
          <label className="text-sm px-3 py-2 rounded border hover:bg-gray-50 cursor-pointer">
            {b.cover_path ? 'Byt omslag' : 'Lägg omslag'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) onUploadCover(b, file)
                e.currentTarget.value = ''
              }}
            />
          </label>

          {/* Galleri */}
          <button
            onClick={() => openGalleryFor(b)}
            className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
          >
            Galleri
          </button>

          {/* Öppna byggnad (detalj) */}
          <Link
            href={`/properties/${propertyId}/buildings/${b.id}`}
            className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
          >
            Öppna
          </Link>

          {/* Ta bort byggnad */}
          <button
            onClick={() => deleteBuilding(b)}
            disabled={isDeleting}
            className="text-sm px-3 py-2 rounded border border-red-300 text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {isDeleting ? 'Tar bort…' : 'Ta bort'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <Protected>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">Byggnader</h1>
            <p className="text-sm text-gray-600">Fastighet: {propertyId}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/properties/${propertyId}`} className="text-sm underline">
              ← Tillbaka
            </Link>
            <button
              onClick={() => setOpenNew(true)}
              className="bg-emerald-600 text-white text-sm px-3 py-2 rounded-lg"
            >
              + Lägg till byggnad
            </button>
          </div>
        </div>

        {/* Lista */}
        {loading ? (
          <div className="bg-white rounded-xl shadow p-6 text-gray-500">Laddar…</div>
        ) : buildings.length === 0 ? (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-600">
            Inga byggnader ännu.<br />
            <button
              onClick={() => setOpenNew(true)}
              className="mt-3 bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg"
            >
              Skapa din första byggnad
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow divide-y">
            {buildings.map(b => <BuildingRow key={b.id} b={b} />)}
          </div>
        )}

        {/* Modal: Ny byggnad */}
        {openNew && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow w-full max-w-md p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Ny byggnad</h2>
                <button onClick={() => setOpenNew(false)} className="text-sm text-gray-500">
                  Stäng
                </button>
              </div>
              <form onSubmit={addBuilding} className="space-y-3">
                <div>
                  <label className="block text-sm mb-1">Namn *</label>
                  <input
                    className="border rounded w-full p-2"
                    value={bName}
                    onChange={e=>setBName(e.target.value)}
                    placeholder="t.ex. Huvudbyggnad"
                    required
                  />
                </div>
                <div className="pt-2 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenNew(false)}
                    className="px-3 py-2 text-sm rounded border"
                  >
                    Avbryt
                  </button>
                  <button className="px-3 py-2 text-sm rounded bg-emerald-600 text-white">
                    Spara
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Modal: Galleri */}
        {openGallery && activeBuilding && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-xl shadow w-full max-w-3xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-semibold">Galleri – {activeBuilding.name}</h2>
                <button
                  onClick={() => { setOpenGallery(false); setActiveBuilding(null) }}
                  className="text-sm text-gray-500"
                >
                  Stäng
                </button>
              </div>

              <div className="mb-3">
                <label className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded border hover:bg-gray-50 cursor-pointer">
                  + Lägg till bilder
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = e.target.files
                      onUploadGallery(files)
                      e.currentTarget.value = ''
                    }}
                  />
                </label>
              </div>

              {galleryLoading ? (
                <div className="text-gray-500">Laddar…</div>
              ) : gallery.length === 0 ? (
                <div className="text-gray-600">Inga bilder ännu.</div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {gallery.map((m) => (
                    <GalleryThumb
                      key={m.id}
                      media={m}
                      getUrl={getSignedUrl}
                      onDelete={() => deleteGalleryItem(m)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Protected>
  )
}

// Liten thumb-komponent (separat för läsbarhet)
function GalleryThumb({
  media,
  getUrl,
  onDelete,
}: {
  media: Media
  getUrl: (p: string) => Promise<string | null>
  onDelete: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let mounted = true
    ;(async () => {
      const u = await getUrl(media.path)
      if (mounted) setUrl(u)
    })()
    return () => { mounted = false }
  }, [media.path, getUrl])

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="h-40 bg-gray-100">
        {url ? <img src={url} alt={media.caption ?? 'Bild'} className="h-full w-full object-cover" /> : null}
      </div>
      <div className="p-2 flex items-center justify-between">
        <div className="text-xs text-gray-600 truncate">{media.caption ?? '—'}</div>
        <button onClick={onDelete} className="text-xs text-rose-600 hover:underline">
          Ta bort
        </button>
      </div>
    </div>
  )
}
