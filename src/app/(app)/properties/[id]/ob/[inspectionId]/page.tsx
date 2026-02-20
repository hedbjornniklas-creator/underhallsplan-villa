'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import ObWizard, {
  ObSectionKey,
  ObWizardInspectionInput,
  ObWizardPropertyInput,
} from '@/components/ob/ObWizard'

type Property = ObWizardPropertyInput
type Inspection = ObWizardInspectionInput
type ObPropertySnapshot = {
  inspection_id: string
  source_property_id: string | null
  name: string | null
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null
  tenure_type: string | null
  dwelling_type: string | null
}

type ObSnapshotSingleClient = {
  from: (table: 'ob_property_snapshot') => {
    select: (columns: string) => {
      eq: (
        column: 'inspection_id',
        value: string
      ) => { maybeSingle: () => Promise<{ data: ObPropertySnapshot | null; error: unknown | null }> }
    }
  }
}
type ExteriorSidebarItem = {
  id: string
  key: string
  label: string
  sort_order: number
}

const SECTIONS: { key: ObSectionKey; label: string }[] = [
  { key: 'overview', label: 'Översikt' },
  { key: 'grunddata', label: 'Grunddata' },
  { key: 'handlingar', label: 'Handlingar & upplysningar' },
  { key: 'forutsattningar', label: 'Förutsättningar' },
  { key: 'utsida', label: 'Byggnad - utsida' },
  { key: 'insida', label: 'Byggnad - insida' },
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
  const [exteriorItems, setExteriorItems] = useState<ExteriorSidebarItem[]>([])
  const [exteriorItemsLoaded, setExteriorItemsLoaded] = useState(false)

  // Starta på Grunddata
  const [activeSection, setActiveSection] = useState<ObSectionKey>('grunddata')

  useEffect(() => {
    if (!propertyId || !inspectionId) return

    const load = async () => {
      setLoading(true)
      setError(null)

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
          assignment_number,
          assignment_confirmation_delivered_date,
          scope,
          inspection_time,
          attendees,
          attendees_other,
          inspection_side,
          defect_disclosures
        `
        )
        .eq('id', inspectionId)
        .single()

      if (inspErr || !inspData) {
        console.error('Kunde inte hämta besiktning:', inspErr?.message)
        setError('Kunde inte hämta besiktningen.')
        setLoading(false)
        return
      }

      const inspectionRow = inspData as Inspection
      const resolvedPropertyId = inspectionRow.property_id ?? propertyId

      const [{ data: snapshotData, error: snapshotError }, { data: sourceProperty, error: propertyError }] =
        await Promise.all([
          (supabase as unknown as ObSnapshotSingleClient)
            .from('ob_property_snapshot')
            .select(
              `
              inspection_id,
              source_property_id,
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
            .eq('inspection_id', inspectionId)
            .maybeSingle(),
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
            .eq('id', resolvedPropertyId)
            .maybeSingle(),
        ])

      if (snapshotError) {
        console.error('Kunde inte hämta OB-snapshot:', snapshotError)
      }

      if (propertyError) {
        console.error('Kunde inte hämta fastighet:', propertyError?.message)
      }

      const snapshot = (snapshotData as ObPropertySnapshot | null) ?? null
      const prop = (sourceProperty as Property | null) ?? null

      if (!snapshot && !prop) {
        setError('Kunde inte hämta fastighetsdata för besiktningen.')
        setLoading(false)
        return
      }

      setInspection(inspData as Inspection)
      setProperty({
        id: resolvedPropertyId,
        name: snapshot?.name ?? prop?.name ?? 'Fastighet',
        address: snapshot?.address ?? prop?.address ?? null,
        postal_code: snapshot?.postal_code ?? prop?.postal_code ?? null,
        city: snapshot?.city ?? prop?.city ?? null,
        municipality: snapshot?.municipality ?? prop?.municipality ?? null,
        cadastral_id: snapshot?.cadastral_id ?? prop?.cadastral_id ?? null,
        owner_name: snapshot?.owner_name ?? prop?.owner_name ?? null,
        tenure_type: (snapshot?.tenure_type ?? prop?.tenure_type ?? null) as Property['tenure_type'],
        dwelling_type: (snapshot?.dwelling_type ?? prop?.dwelling_type ?? null) as Property['dwelling_type'],
      } as Property)
      setLoading(false)
    }

    void load()
  }, [propertyId, inspectionId])

  useEffect(() => {
    if (activeSection !== 'utsida' || exteriorItemsLoaded) return

    let cancelled = false

    const loadExteriorItems = async () => {
      const { data, error: itemsErr } = await supabase
        .from('settings_exterior_items')
        .select('id, key, label, sort_order')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })

      if (itemsErr) {
        console.error('settings_exterior_items (sidebar) error:', itemsErr)
      } else if (!cancelled) {
        setExteriorItems((data ?? []) as ExteriorSidebarItem[])
      }

      if (!cancelled) setExteriorItemsLoaded(true)
    }

    void loadExteriorItems()

    return () => {
      cancelled = true
    }
  }, [activeSection, exteriorItemsLoaded])

  if (loading) {
    return (
      <Protected hideSidebar>
        <main className="p-6">
          <p className="text-sm text-gray-500">Laddar besiktning...</p>
        </main>
      </Protected>
    )
  }

  if (error || !inspection || !property) {
    return (
      <Protected hideSidebar>
        <main className="p-6">
          <p className="mb-4 text-sm text-red-600">{error || 'Besiktningen kunde inte hittas.'}</p>
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
      <main className="relative min-h-full overflow-hidden p-4 md:p-6">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 70% at 50% 0%, rgba(219,234,254,0.5) 0%, rgba(219,234,254,0) 60%), linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 42%, #60a5fa 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/10 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl space-y-4">
          <header className="rounded-2xl border border-white/30 bg-white/10 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => router.push(`/properties/${propertyId}/ob`)}
                aria-label="Tillbaka"
                title="Tillbaka"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
              <h1 className="text-2xl font-semibold text-white drop-shadow-sm">Överlåtelsebesiktning</h1>
            </div>
          </header>

          <div className="grid items-start gap-6 md:grid-cols-[220px_minmax(0,1fr)]">
          <div className="md:w-[220px]">
            <nav className="space-y-2 rounded-lg border bg-white p-3 md:fixed md:left-6 md:top-28 md:max-h-[calc(100vh-7rem)] md:w-[220px] md:overflow-auto">
              <div className="mb-2 text-xs font-semibold uppercase text-gray-500">MODULER</div>

              {SECTIONS.map((section) => (
                <div key={section.key}>
                  <button
                    onClick={() => setActiveSection(section.key)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                      activeSection === section.key
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    {section.label}
                  </button>

                  {section.key === 'utsida' && activeSection === 'utsida' && exteriorItems.length > 0 && (
                    <div className="mt-2 space-y-1 border-l border-gray-200 pl-3">
                      {exteriorItems.map((item) => (
                        <a
                          key={item.id}
                          href={`#utsida-${item.key}`}
                          className="block text-xs text-gray-600 hover:text-gray-900"
                        >
                          {item.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}

              <div className="mt-4 border-t pt-3">
                <button
                  onClick={() => router.push(`/properties/${propertyId}`)}
                  className="w-full rounded-md border px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50"
                >
                  ← Till fastighetssidan
                </button>
              </div>
            </nav>
          </div>

          <div>
            <ObWizard
              property={property}
              inspection={inspection}
              activeSection={activeSection}
              onPropertyUpdated={(updated) => setProperty(updated as Property)}
              onInspectionUpdated={(updated) => setInspection(updated as Inspection)}
            />
          </div>
        </div>
        </div>
      </main>
    </Protected>
  )
}
