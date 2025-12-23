'use client'

import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

type PropertyStatus = 'Utkast' | 'Aktiv' | 'Arkiverad'

type PropertyRow = {
  id: string
  owner?: string | null
  name: string
  address: string | null
  client_name: string | null
  status: PropertyStatus | null
  created_at?: string
}

export default function PropertiesPage() {
  const router = useRouter()

  const [rows, setRows] = useState<PropertyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI: sök & filter
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'Alla' | PropertyStatus>('Alla')

  const load = async () => {
    setLoading(true)
    setError(null)

    // Om du vill visa ALLA fastigheter i systemet (admin-vy), ta bort .eq('owner', auth.user.id)
    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) {
      setLoading(false)
      router.replace('/login')
      return
    }

    const { data, error } = await supabase
      .from('properties')
      .select('id,owner,name,address,client_name,status,created_at')
      .eq('owner', auth.user.id) // rekommenderat: visa bara användarens fastigheter
      .order('created_at', { ascending: false })

    if (error) {
      setError(error.message)
      setRows([])
    } else {
      setRows((data ?? []) as PropertyRow[])
    }

    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    let r = rows

    if (filter !== 'Alla') {
      r = r.filter(x => (x.status ?? 'Utkast') === filter)
    }

    if (q.trim()) {
      const s = q.trim().toLowerCase()
      r = r.filter(x =>
        (x.name ?? '').toLowerCase().includes(s) ||
        (x.address ?? '').toLowerCase().includes(s) ||
        (x.client_name ?? '').toLowerCase().includes(s)
      )
    }

    return r
  }, [rows, filter, q])

  // Skapa fastighet och gå direkt till detaljsidan
  const createPropertyAndGo = async () => {
    setError(null)

    const { data: auth } = await supabase.auth.getUser()
    if (!auth.user) return router.replace('/login')

    // Temporärt namn t.ex. "Fastighet 2025-11-09 X3AB"
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    const short = Math.random().toString(36).slice(2, 6).toUpperCase()
    const tempName = `Fastighet ${today} ${short}`

    const { data, error } = await supabase
      .from('properties')
      .insert({
        owner: auth.user.id,
        name: tempName,
        status: 'Utkast', // behåll utkast-läget
      })
      .select('id')
      .single()

    if (error || !data) {
      alert(error?.message ?? 'Kunde inte skapa fastighet')
      return
    }

    // Optimistisk uppdatering (så den syns direkt i listan utan reload)
    setRows(prev => [
      {
        id: data.id,
        owner: auth.user.id,
        name: tempName,
        address: null,
        client_name: null,
        status: 'Utkast',
        created_at: new Date().toISOString(),
      },
      ...prev,
    ])

    router.push(`/properties/${data.id}`)
  }

  return (
    <Protected>
      <div className="space-y-4">
        {/* Header + actions */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <h1 className="text-xl md:text-2xl font-semibold tracking-tight">Fastigheter</h1>

          <div className="flex items-center gap-2">
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Sök namn, adress eller kund…"
              className="border rounded-lg px-3 py-2 text-sm w-64"
            />
            <select
              value={filter}
              onChange={e => setFilter(e.target.value as any)}
              className="border rounded-lg px-3 py-2 text-sm"
            >
              <option value="Alla">Alla</option>
              <option value="Utkast">Utkast</option>
              <option value="Aktiv">Aktiv</option>
              <option value="Arkiverad">Arkiverad</option>
            </select>
            <button
              onClick={createPropertyAndGo}
              className="bg-emerald-600 text-white text-sm px-3 py-2 rounded-lg"
            >
              + Ny fastighet
            </button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 text-sm">
            {error}
          </div>
        )}

        {/* Tom-vy */}
        {!loading && filtered.length === 0 && (
          <div className="bg-white rounded-xl shadow p-8 text-center text-gray-600">
            {q || filter !== 'Alla' ? (
              <>Inga träffar. Justera din sökning eller filter.</>
            ) : (
              <>
                Du har inga fastigheter ännu.
                <div className="mt-3">
                  <button
                    onClick={createPropertyAndGo}
                    className="bg-emerald-600 text-white text-sm px-4 py-2 rounded-lg"
                  >
                    Skapa din första fastighet
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {/* Lista (card rows) */}
        {filtered.length > 0 && (
          <div className="bg-white rounded-xl shadow divide-y">
            {filtered.map(r => (
              <div key={r.id} className="p-4 flex items-center justify-between">
                <div className="min-w-0">
                  <div className="font-medium truncate">{r.name}</div>
                  <div className="text-xs text-gray-600 truncate">
                    {r.address ?? '—'} {r.client_name ? `• Kund: ${r.client_name}` : ''}
                  </div>
                  <div className="text-xs mt-1">
                    <span
                      className={`inline-block px-2 py-0.5 rounded ${
                        (r.status ?? 'Utkast') === 'Aktiv'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : (r.status ?? 'Utkast') === 'Arkiverad'
                            ? 'bg-gray-100 text-gray-700 border'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}
                    >
                      {r.status ?? 'Utkast'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/properties/${r.id}`}
                    className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
                  >
                    Öppna
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Laddar-indikator */}
        {loading && (
          <div className="bg-white rounded-xl shadow p-6 text-gray-500">Laddar…</div>
        )}
      </div>
    </Protected>
  )
}
