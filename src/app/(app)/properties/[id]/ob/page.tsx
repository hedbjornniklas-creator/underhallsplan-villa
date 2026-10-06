'use client'

import { useEffect, useState, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import Protected from '@/components/Protected'
import ObOrganizationBoundary, { useObOrganization, useObOrganizationSwitchGuard, withObOrganization } from '@/components/ob/ObOrganizationBoundary'
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
  return <ObOrganizationBoundary><PropertyInspectionsContent /></ObOrganizationBoundary>
}

function PropertyInspectionsContent() {
  const { id: orgId } = useObOrganization()
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const mutating = creating || deletingId !== null
  useObOrganizationSwitchGuard(false, mutating)
  const params = useParams()
  const router = useRouter()
  const propertyId = params?.id as string

  const [property, setProperty] = useState<Property | null>(null)
  const [inspections, setInspections] = useState<Inspection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!propertyId) return
    const controller = new AbortController()

    const fetchData = async () => {
      setLoading(true)
      setError(null)

      // HÃ¤mta fastighet
      const { data: propertyData, error: propertyError } = await supabase
        .from('properties')
        .select('id, name, address, postal_code, city')
        .eq('id', propertyId)
        .single()

      if (controller.signal.aborted) return

      if (propertyError) {
        console.error(propertyError)
        setError('Kunde inte hÃ¤mta fastigheten.')
        setLoading(false)
        return
      }

      setProperty(propertyData as Property)

      try {
        const query = new URLSearchParams({ orgId, propertyId })
        const response = await fetch(`/api/ob/inspections?${query}`, { cache: 'no-store', signal: controller.signal })
        const body = await response.json()
        if (!response.ok || !Array.isArray(body.inspections)) throw new Error(body.error || 'Kunde inte hämta besiktningar.')
        if (controller.signal.aborted) return
        setInspections(body.inspections)
      } catch (error) {
        if (controller.signal.aborted) return
        setInspections([])
        setError(error instanceof Error ? error.message : 'Kunde inte hämta besiktningar.')
      }

      setLoading(false)
    }

    fetchData()
    return () => controller.abort()
  }, [propertyId, orgId])

  const hasInspections = useMemo(() => inspections.length > 0, [inspections])

  const handleCreateNew = async () => {
    if (!propertyId || mutating) return
    setCreating(true)
    try {
      const response = await fetch(withObOrganization('/api/ob/inspections', orgId), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId }),
      })
      const body = await response.json()
      if (!response.ok || body.propertyId !== propertyId || !body.inspectionId || body.orgId !== orgId) throw new Error(body.error || 'Kunde inte skapa besiktningen i vald organisation.')
      router.push(withObOrganization(`/properties/${propertyId}/ob/${body.inspectionId}`, orgId))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Kunde inte skapa besiktningen.')
    } finally { setCreating(false) }
  }

  const handleDelete = async (inspectionId: string) => {
    if (mutating) return
    const ok = confirm('Vill du verkligen radera denna besiktning?')
    if (!ok) return

    setDeletingId(inspectionId)
    try {
      const { error } = await supabase
        .from('inspections')
        .delete()
        .eq('id', inspectionId)
      if (error) throw error

      // Ta bort endast den bekräftat raderade besiktningen ur listan.
      setInspections(prev => prev.filter(i => i.id !== inspectionId))
    } catch (error) {
      console.error('Kunde inte radera besiktning:', error)
      alert('Kunde inte radera besiktningen.')
    } finally { setDeletingId(null) }
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
    if (type === 'OB') return 'Ã–verlÃ¥telsebesiktning'
    return type
  }

  if (loading) {
    return (
      <Protected>
        <main className="p-6">
          <p className="text-sm text-gray-500">
            Laddar fastighet och besiktningarâ€¦
          </p>
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
              â† Tillbaka till fastigheten
            </button>
            <h1 className="text-2xl font-semibold text-gray-900">
              Ã–verlÃ¥telsebesiktningar
            </h1>
            <p className="text-sm text-gray-600">
              Fastighet: {property.name}
              {property.address && (
                <>
                  {' â€“ '}
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
              disabled={mutating}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              Ny Ã¶verlÃ¥telsebesiktning
            </button>
          </div>
        </div>

        {/* TvÃ¥ kolumner */}
        <div className="grid gap-6 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* VÃ¤nster: lista med besiktningar */}
          <section className="rounded-lg border bg-white p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Besiktningar fÃ¶r denna fastighet
              </h2>
              {hasInspections && (
                <button
                  onClick={handleCreateNew}
                  disabled={mutating}
                  className="text-sm text-blue-600 hover:underline"
                >
                  Skapa ny
                </button>
              )}
            </div>

            {!hasInspections ? (
              <div className="rounded-md border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
                <p className="mb-3 text-sm text-gray-700">
                  Det finns Ã¤nnu inga registrerade Ã¶verlÃ¥telsebesiktningar fÃ¶r denna
                  fastighet.
                </p>
                <button
                  onClick={handleCreateNew}
                  disabled={mutating}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  Skapa fÃ¶rsta Ã¶verlÃ¥telsebesiktningen
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
                      <th className="px-3 py-2 text-right">Ã…tgÃ¤rder</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inspections.map(inspection => (
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
                          {inspection.inspector_name || 'â€“'}
                        </td>
                        <td className="px-3 py-2 align-middle">
                          <div className="flex justify-end gap-3">
                            <Link
                              href={withObOrganization(`/properties/${property.id}/ob/${inspection.id}`, orgId)}
                              className="text-sm text-blue-600 hover:underline"
                            >
                              Ã–ppna
                            </Link>
                            <button
                              onClick={() => void handleDelete(inspection.id)}
                              disabled={mutating}
                              className="text-sm text-red-600 hover:underline"
                            >
                              Radera
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* HÃ¶ger: info-panel */}
          <aside className="space-y-4">
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-base font-semibold text-gray-900">
                Om Ã¶verlÃ¥telsebesiktning
              </h2>
              <p className="text-sm text-gray-700">
                HÃ¤r hanterar du Ã¶verlÃ¥telsebesiktningar fÃ¶r den aktuella fastigheten.
                UtlÃ¥tandena fÃ¶ljer SBR-modellen och kan senare kompletteras med
                riskanalys och fortsatt teknisk utredning.
              </p>
              <p className="mt-2 text-sm text-gray-700">
                Du kan skapa flera besiktningar fÃ¶r samma fastighet, till exempel vid
                ny fÃ¶rsÃ¤ljning eller ombestÃ¤llning.
              </p>
            </section>

            <section className="rounded-lg border border-dashed bg-gray-50 p-4 text-sm text-gray-600">
              HÃ¤r kan vi senare visa snabbstatus, senaste utlÃ¥tande eller genvÃ¤gar
              till PDF-export.
            </section>
          </aside>
        </div>
      </main>
    </Protected>
  )
}

