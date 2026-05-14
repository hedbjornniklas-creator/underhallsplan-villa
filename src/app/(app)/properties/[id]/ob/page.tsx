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

type ObSnapshotUpsertClient = {
  from: (table: 'ob_property_snapshot') => {
    upsert: (
      payload: Record<string, unknown>,
      options: { onConflict: string }
    ) => Promise<{ error: unknown | null }>
  }
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

      // HÃ¤mta fastighet
      const { data: propertyData, error: propertyError } = await supabase
        .from('properties')
        .select('id, name, address, postal_code, city')
        .eq('id', propertyId)
        .single()

      if (propertyError) {
        console.error(propertyError)
        setError('Kunde inte hÃ¤mta fastigheten.')
        setLoading(false)
        return
      }

      setProperty(propertyData as Property)

      // HÃ¤mta besiktningar fÃ¶r fastigheten
      const { data: inspectionsData, error: inspectionsError } = await supabase
        .from('inspections')
        .select('id, property_id, date, type, status, inspector_name, created_at')
        .eq('property_id', propertyId)
        .eq('inspection_family', 'OB')
        .order('date', { ascending: false })

      if (inspectionsError) {
        // Vi stoppar inte sidan â€“ vi visar bara en tom lista
        console.warn('Kunde inte hÃ¤mta besiktningar:', inspectionsError.message)
        setInspections([])
      } else {
        setInspections((inspectionsData || []) as Inspection[])
      }

      setLoading(false)
    }

    fetchData()
  }, [propertyId])

  const hasInspections = useMemo(() => inspections.length > 0, [inspections])

  const handleCreateNew = async () => {
    if (!propertyId) return

    // Skapa en ny besiktning i databasen
    const { data, error } = await supabase
      .from('inspections')
      .insert({
        property_id: propertyId,
        type: 'OB',
        inspection_family: 'OB',
        inspection_variant: 'OB',
        status: 'draft',
      })
      .select('id')
      .single()

    if (error || !data) {
      console.error('Kunde inte skapa besiktning:', error?.message)
      alert('Kunde inte skapa en ny överlåtelsebesiktning.')
      return
    }

    const newId = data.id as string

    const { error: conditionsError } = await supabase
      .from('inspection_conditions')
      .insert({
        inspection_id: newId,
        furnishing_level: 'fullt_moblerad',
      })

    if (conditionsError) {
      console.error('Kunde inte skapa inspection_conditions för besiktning:', conditionsError)
      await supabase.from('inspections').delete().eq('id', newId)
      alert('Kunde inte skapa förutsättningar för besiktningen.')
      return
    }

    const { data: sourceProperty, error: sourcePropertyError } = await supabase
      .from('properties')
      .select(
        'id,owner,created_at,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name,contact_person,tenure_type,dwelling_type,property_type,plot_area_m2,area_m2,area_sqm,tax_value,planning_status,type_code,heating,ventilation,roof_type,year_built,cover_path,status,last_inspected,last_inspection_at'
      )
      .eq('id', propertyId)
      .single()

    if (sourcePropertyError || !sourceProperty) {
      console.error('Kunde inte läsa fastighetsdata för snapshot:', sourcePropertyError)
      await supabase.from('inspections').delete().eq('id', newId)
      alert('Kunde inte skapa snapshot för besiktningen.')
      return
    }

    const snapshotClient = supabase as unknown as ObSnapshotUpsertClient
    const { error: snapshotError } = await snapshotClient
      .from('ob_property_snapshot')
      .upsert(
        {
          inspection_id: newId,
          source_property_id: sourceProperty.id,
          source_property_owner: sourceProperty.owner ?? null,
          source_property_created_at: sourceProperty.created_at ?? null,
          imported_at: new Date().toISOString(),
          snapshot_version: 1,
          name: sourceProperty.name ?? null,
          address: sourceProperty.address ?? null,
          postal_code: sourceProperty.postal_code ?? null,
          city: sourceProperty.city ?? null,
          municipality: sourceProperty.municipality ?? null,
          cadastral_id: sourceProperty.cadastral_id ?? null,
          owner_name: sourceProperty.owner_name ?? null,
          client_name: sourceProperty.client_name ?? null,
          contact_person: sourceProperty.contact_person ?? null,
          tenure_type: sourceProperty.tenure_type ?? null,
          dwelling_type: sourceProperty.dwelling_type ?? null,
          property_type: sourceProperty.property_type ?? null,
          plot_area_m2: sourceProperty.plot_area_m2 ?? null,
          area_m2: sourceProperty.area_m2 ?? null,
          area_sqm: sourceProperty.area_sqm ?? null,
          tax_value: sourceProperty.tax_value ?? null,
          planning_status: sourceProperty.planning_status ?? null,
          type_code: sourceProperty.type_code ?? null,
          heating: sourceProperty.heating ?? null,
          ventilation: sourceProperty.ventilation ?? null,
          roof_type: sourceProperty.roof_type ?? null,
          year_built: sourceProperty.year_built ?? null,
          cover_path: sourceProperty.cover_path ?? null,
          status: sourceProperty.status ?? null,
          last_inspected: sourceProperty.last_inspected ?? null,
          last_inspection_at: sourceProperty.last_inspection_at ?? null,
        },
        { onConflict: 'inspection_id' }
      )

    if (snapshotError) {
      console.error('Kunde inte skapa snapshot för besiktning:', snapshotError)
      await supabase.from('inspections').delete().eq('id', newId)
      alert('Kunde inte skapa snapshot för besiktningen.')
      return
    }

    // Gå direkt till detaljsidan för besiktningen
    router.push(`/properties/${propertyId}/ob/${newId}`)
  }
  const handleDelete = async (inspectionId: string) => {
    const ok = confirm('Vill du verkligen radera denna besiktning?')
    if (!ok) return

    const { error } = await supabase
      .from('inspections')
      .delete()
      .eq('id', inspectionId)

    if (error) {
      console.error('Kunde inte radera besiktning:', error)
      alert('Kunde inte radera besiktningen.')
      return
    }

    // Ta bort den lokalt ur listan
    setInspections(prev => prev.filter(i => i.id !== inspectionId))
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
                              href={`/properties/${property.id}/ob/${inspection.id}`}
                              className="text-sm text-blue-600 hover:underline"
                            >
                              Ã–ppna
                            </Link>
                            <button
                              onClick={() => void handleDelete(inspection.id)}
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

