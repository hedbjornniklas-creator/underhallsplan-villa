'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'

type Property = {
  id: string
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
}

type Inspection = {
  id: string
  property_id: string
  date: string | null
  type: string | null // t.ex. 'OB'
  status: string | null // 'draft' | 'completed' | 'archived'
  inspector_name: string | null
  created_at: string
}

export default function PropertyInspectionsPage() {
  const params = useParams()
  const router = useRouter()
  const propertyId = params?.id as string

  const [property, setProperty] = useState<Property | null>(null)
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!propertyId) return

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      // Hämta fastighet
      const { data: propertyData, error: propertyError } = await supabase
        .from('properties')
        .select('id, name, address, postal_code, city')
        .eq('id', propertyId)
        .single()

      if (propertyError) {
        console.error(propertyError)
        setError('Kunde inte hämta fastigheten.')
        setLoading(false)
        return
      }

      setProperty(propertyData as Property)

      // Hämta besiktningar för fastigheten
      const { data: inspectionsData, error: inspectionsError } = await supabase
        .from('inspections')
        .select('id, property_id, date, type, status, inspector_name, created_at')
        .eq('property_id', propertyId)
        .order('date', { ascending: false })

      if (inspectionsError) {
        // Vi stoppar inte sidan – vi visar bara en tom lista
        console.warn('Kunde inte hämta besiktningar:', inspectionsError.message)
        setInspections([])
      } else {
        setInspections((inspectionsData || []) as Inspection[])
      }

      setLoading(false)
    }

    fetchData()
  }, [propertyId])

  const hasInspections = useMemo(() => inspections.length > 0, [inspections])

  const handleCreateNew = () => {
    // Här kommer vi senare skapa en ny rad i `inspections`
    // och sedan styra vidare till formuläret.
    router.push(`/properties/${propertyId}/ob/new`)
  }

  const formatDate = (value: string | null) => {
    if (!value) return '-'
    const d = new Date(value)
    if (isNaN(d.getTime())) return value
    return d.toLocaleDateString('sv-SE')
  }

  const formatStatus = (status: string | null) => {
    if (!status) return '-'
    switch (status) {
      case 'draft':
        return 'Utkast'
      case 'completed':
        return 'Klar'
      case 'archived':
        return 'Arkiverad'
      default:
        return status
    }
  }

  const formatType = (type: string | null) => {
    if (!type) return '-'
    if (type === 'OB') return 'Överlåtelsebesiktning'
    return type
  }

  if (loading) {
    return (
      <Protected>
        <main className="p-6">
          <p className="text-sm text-gray-500">Laddar fastighet och besiktningar…</p>
        </main>
      </Protected>
    )
  }

  if (error || !property) {
    return (
      <Protected>
        <main className="p-6">
          <p className="mb-4 text-sm text-red-600">
            {error || 'Fastigheten kunde inte hittas.'}
          </p>
          <button
            onClick={() => router.push('/properties')}
            className="rounded-md border px-3 py-2 text-sm"
          >
            Tillbaka till fastighetslista
          </button>
        </main>
      </Protected>
    )
  }

  return (
    <Protected>
      <main className="space-y-6 p-6">
        {/* Breadcrumb / header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              onClick={() => router.push(`/properties/${property.id}`)}
              className="mb-1 text-sm text-blue-600 hover:underline"
            >
              ← Tillbaka till fastigheten
            </button>
            <h1 className="text-2xl font-semibold text-gray-900">
              Överlåtelsebesiktningar
            </h1>
            <p className="text-sm text-gray-600">
              Fastighet: {property.name}
              {property.address && (
                <>
                  {' – '}
                  {property.address}
                  {property.postal_code && `, ${property.postal_code}`}
                  {property.city && ` ${property.city}`}
                </>
              )}
            </p>
          </div>
          <div>
            <button
              onClick={handleCreateNew}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Ny överlåtelsebesiktning
            </button>
          </div>
        </div>

        {/* Två kolumner */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* Vänster: lista med besiktningar */}
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Besiktningar för denna fastighet
              </h2>
              {hasInspections && (
                <button
                  onClick={handleCreateNew}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Skapa ny
                </button>
              )}
            </div>

            {!hasInspections ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                <p className="mb-3 text-sm text-gray-700">
                  Det finns ännu inga registrerade överlåtelsebesiktningar för denna
                  fastighet.
                </p>
                <button
                  onClick={handleCreateNew}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Skapa första överlåtelsebesiktningen
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50 text-xs uppercase text-gray-500">
                      <th className="px-3 py-2">Datum</th>
                      <th className="px-3 py-2">Typ</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Besiktningsman</th>
                      <th className="px-3 py-2 text-right">Åtgärder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map((inspection) => (
                      <tr
                        key={inspection.id}
                        className="border-b last:border-b-0 hover:bg-gray-50"
                      >
                        <td className="px-3 py-2 align-middle">
                          {formatDate(inspection.date || inspection.created_at)}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          {formatType(inspection.type)}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          {formatStatus(inspection.status)}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          {inspection.inspector_name || '–'}
                        </td>
                        <td className="px-3 py-2 align-middle text-right">
                          <Link
                            href={`/properties/${property.id}/ob/${inspection.id}`}
                            className="text-sm text-blue-600 hover:underline"
                          >
                            Öppna
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Höger: info-panel */}
          <aside className="space-y-4">
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-base font-semibold text-gray-900">
                Om överlåtelsebesiktning
              </h2>
              <p className="text-sm text-gray-700">
                Här hanterar du överlåtelsebesiktningar för den aktuella fastigheten.
                Utlåtandena följer SBR-modellen och kan senare kompletteras med
                riskanalys och fortsatt teknisk utredning.
              </p>
              <p className="mt-2 text-sm text-gray-700">
                Du kan skapa flera besiktningar för samma fastighet, till exempel vid
                ny försäljning eller ombeställning.
              </p>
            </section>

            <section className="rounded-lg border border-dashed bg-gray-50 p-4 text-sm text-gray-600">
              Här kan vi senare visa snabbstatus, senaste utlåtande eller genvägar
              till PDF-export.
            </section>
          </aside>
        </div>
      </main>
    </Protected>
  )
}
