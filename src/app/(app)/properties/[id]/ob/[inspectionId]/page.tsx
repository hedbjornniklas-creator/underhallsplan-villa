'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import ObWizard, {
  ObSectionKey,
  TenureType,
  DwellingType,
  InspectionSide,
  ObWizardProperty,
  ObWizardInspectionInput,
  ObWizardPropertyInput,
} from '@/components/ob/ObWizard'

type Property = ObWizardPropertyInput

type Inspection = ObWizardInspectionInput

const SECTIONS: { key: ObSectionKey; label: string }[] = [
  { key: 'overview', label: 'Ç-versikt' },
  { key: 'grunddata', label: 'Grunddata' },
  { key: 'handlingar', label: 'Handlingar & upplysningar' },
  { key: 'forutsattningar', label: 'FÇôrutsÇÏttningar' },
  { key: 'utsida', label: 'Byggnad ƒ?" utsida' },
  { key: 'insida', label: 'Byggnad ƒ?" insida' },
  { key: 'risk', label: 'Riskanalys' },
  { key: 'ftu', label: 'FTU' },
]

export default function InspectionDetailPage() {
  const params = useParams()
  const router = useRouter()

  const propertyId = params?.id as string
  const inspectionId = params?.inspectionId as string

  const [property, setProperty] = useState<Property | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Starta pÇ¾ Grunddata (som ni gjort hittills)
  const [activeSection, setActiveSection] =
    useState<ObSectionKey>('grunddata')

  useEffect(() => {
    if (!propertyId || !inspectionId) return

    const load = async () => {
      setLoading(true)
      setError(null)

      const [
        { data: inspData, error: inspErr },
        { data: propData, error: propErr },
      ] = await Promise.all([
        supabase
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
            assignment_number,
            scope,
            inspection_time,
            attendees,
            attendees_other,
            inspection_side,
            defect_disclosures
          `
          )
          .eq('id', inspectionId)
          .single(),
        supabase
          .from('properties')
          .select(
            `
            id,
            name,
            address,
            postal_code,
            city,
            municipality,
            cadastral_id,
            owner_name,
            tenure_type,
            dwelling_type
          `
          )
          .eq('id', propertyId)
          .single(),
      ])

      if (inspErr || !inspData) {
        console.error('Kunde inte hÇÏmta besiktning:', inspErr?.message)
        setError('Kunde inte hÇÏmta besiktningen.')
        setLoading(false)
        return
      }

      if (propErr || !propData) {
        console.error('Kunde inte hÇÏmta fastighet:', propErr?.message)
        setError('Kunde inte hÇÏmta fastigheten.')
        setLoading(false)
        return
      }

      setInspection(inspData as Inspection)
      setProperty(propData as Property)
      setLoading(false)
    }

    load()
  }, [propertyId, inspectionId])

  if (loading) {
    return (
      <Protected hideSidebar>
        <main className="p-6">
          <p className="text-sm text-gray-500">Laddar besiktningƒ?Ý</p>
        </main>
      </Protected>
    )
  }

  if (error || !inspection || !property) {
    return (
      <Protected hideSidebar>
        <main className="p-6">
          <p className="mb-4 text-sm text-red-600">
            {error || 'Besiktningen kunde inte hittas.'}
          </p>
          <button
            onClick={() => router.push(`/properties/${propertyId}/ob`)}
            className="rounded-md border px-3 py-2 text-sm"
          >
            Tillbaka till besiktningar
          </button>
        </main>
      </Protected>
    )
  }

  return (
    <Protected hideSidebar>
      <main className="p-6 space-y-4">
        {/* Tillbaka-knapp hÇôgst upp */}
        <button
          onClick={() => router.push(`/properties/${propertyId}/ob`)}
          className="text-sm text-blue-600 hover:underline"
        >
          ƒÅ? Tillbaka till besiktningar
        </button>

        {/* Layout: lokal Ç-B-sidebar + wizard */}
        <div className="mt-2 grid gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
          {/* Lokal Ç-B-sidebar */}
          <nav className="rounded-lg border bg-white p-3 space-y-2">
            <div className="mb-2 text-xs font-semibold uppercase text-gray-500">
              Ç-B-moduler
            </div>

            {SECTIONS.map(section => (
              <button
                key={section.key}
                onClick={() => setActiveSection(section.key)}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  activeSection === section.key
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                {section.label}
              </button>
            ))}

            <div className="mt-4 border-t pt-3">
              <button
                onClick={() => router.push(`/properties/${propertyId}`)}
                className="w-full rounded-md border px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
              >
                ƒÅ? Till fastighetssidan
              </button>
            </div>
          </nav>

          {/* SjÇÏlva Ç-B-wizarden */}
          <div>
            <ObWizard
              property={property}
              inspection={inspection}
              activeSection={activeSection}
              onPropertyUpdated={updated =>
                setProperty(updated as Property)
              }
              onInspectionUpdated={updated =>
                setInspection(updated as Inspection)
              }
            />
          </div>
        </div>
      </main>
    </Protected>
  )
}
