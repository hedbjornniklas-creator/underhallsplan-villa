'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import Protected from '@/components/Protected'

type Inspection = {
  id: string
  property_id: string
  date: string | null
  type: string | null
  status: string | null
  inspector_name: string | null
  created_at: string
  client_name: string | null
  client_contact: string | null
  assignment_number: string | null
}

type Property = {
  id: string
  name: string | null
  address: string | null
  postal_code: string | null
  city: string | null
}

type InspectionWithProperty = Inspection & {
  property?: Property | null
}

export default function InspectionsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [inspections, setInspections] = useState<InspectionWithProperty[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true)
        setError(null)

        // 1) Hämta alla besiktningar
        const { data: inspData, error: inspErr } = await supabase
          .from('inspections')
          .select(
            `
            id,
            property_id,
            date,
            type,
            status,
            inspector_name,
            created_at,
            client_name,
            client_contact,
            assignment_number
          `
          )
          .order('created_at', { ascending: false })

        if (inspErr) throw inspErr

        const inspArr = (inspData ?? []) as Inspection[]

        if (!inspArr.length) {
          setInspections([])
          return
        }

        // 2) Hämta tillhörande fastigheter
        const propertyIds = Array.from(
          new Set(inspArr.map(i => i.property_id).filter(Boolean))
        )

        let propsMap: Record<string, Property> = {}

        if (propertyIds.length) {
          const { data: propData, error: propErr } = await supabase
            .from('properties')
            .select(
              `
              id,
              name,
              address,
              postal_code,
              city
            `
            )
            .in('id', propertyIds)

          if (propErr) throw propErr

          const propArr = (propData ?? []) as Property[]
          propsMap = propArr.reduce((acc, p) => {
            acc[p.id] = p
            return acc
          }, {} as Record<string, Property>)
        }

        // 3) Kombinera
        const combined: InspectionWithProperty[] = inspArr.map(i => ({
          ...i,
          property: propsMap[i.property_id] ?? null,
        }))

        setInspections(combined)
      } catch (e: any) {
        console.error('Could not load inspections:', e)
        setError(e?.message ?? 'Kunde inte hämta besiktningar.')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [])

  const filtered = useMemo(() => {
    if (!search.trim()) return inspections

    const q = search.toLowerCase()

    return inspections.filter(i => {
      const p = i.property
      const haystack = [
        i.assignment_number ?? '',
        i.client_name ?? '',
        i.client_contact ?? '',
        i.type ?? '',
        p?.name ?? '',
        p?.address ?? '',
        p?.city ?? '',
      ]
        .join(' ')
        .toLowerCase()

      return haystack.includes(q)
    })
  }, [inspections, search])

  return (
    <Protected>
      <main className="p-4 md:p-6 space-y-4">
        <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">
              Besiktningar
            </h1>
            <p className="text-sm text-gray-600">
              Översikt över alla överlåtelsebesiktningar kopplade till dina fastigheter.
            </p>
          </div>

          <div className="w-full max-w-xs">
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Sök på fastighet, kund, adress, uppdragsnr…"
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm
                         placeholder:text-gray-400 focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </div>
        </header>

        {loading && (
          <div className="text-sm text-gray-600">Laddar besiktningar…</div>
        )}

        {error && !loading && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            Inga besiktningar hittades.
          </div>
        )}

        {!loading && !error && filtered.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Datum</th>
                  <th className="px-3 py-2">Fastighet</th>
                  <th className="px-3 py-2">Kund</th>
                  <th className="px-3 py-2">Typ / status</th>
                  <th className="px-3 py-2 text-right">Åtgärder</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(insp => {
                  const p = insp.property
                  const dateStr =
                    insp.date ??
                    new Date(insp.created_at).toLocaleDateString('sv-SE')

                  return (
                    <tr
                      key={insp.id}
                      className="border-b last:border-b-0 hover:bg-gray-50/70"
                    >
                      <td className="px-3 py-2 align-top whitespace-nowrap">
                        <div className="text-sm text-gray-900">{dateStr}</div>
                        {insp.assignment_number && (
                          <div className="text-xs text-gray-500">
                            {insp.assignment_number}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className="text-sm font-medium text-gray-900">
                          {p?.name || '–'}
                        </div>
                        <div className="text-xs text-gray-500">
                          {p?.address
                            ? `${p.address}${
                                p.city ? `, ${p.postal_code ?? ''} ${p.city}` : ''
                              }`
                            : 'Ingen adress angiven'}
                        </div>
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className="text-sm text-gray-900">
                          {insp.client_name || '–'}
                        </div>
                        {insp.client_contact && (
                          <div className="text-xs text-gray-500">
                            {insp.client_contact}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top">
                        <div className="text-sm text-gray-900">
                          {insp.type || 'Överlåtelsebesiktning'}
                        </div>
                        {insp.status && (
                          <div className="text-xs text-gray-500">
                            {insp.status}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 align-top text-right">
                        <Link
                          href={`/properties/${insp.property_id}/ob/${insp.id}`}
                          className="inline-flex items-center rounded-md border border-gray-300 px-2.5 py-1.5 text-xs font-medium text-gray-800 hover:bg-gray-50"
                        >
                          Öppna besiktning
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </Protected>
  )
}
