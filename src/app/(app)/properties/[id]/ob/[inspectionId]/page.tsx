'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { parseScopeCodes } from '@/lib/report/scopeText'
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
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
}

type AssignmentForInspection = {
  id: string
  orderer_role: string | null
  customer_name: string | null
  customer_address: string | null
  customer_postal_code: string | null
  customer_city: string | null
  customer_phone: string | null
  customer_email: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
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

const AREA_MEASUREMENT_ADDON_KEY = 'area'

function normalizeAddonKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function hasAreaMeasurementSelection(selectedAddonKeys: string[], scope: string | null | undefined) {
  const selectedLookup = new Set(selectedAddonKeys.map(normalizeAddonKey).filter(Boolean))
  const hasSelectedAddon = selectedLookup.has(AREA_MEASUREMENT_ADDON_KEY)
  if (hasSelectedAddon) return true

  const normalizedScopeCodes = parseScopeCodes(scope).map(normalizeAddonKey)
  return (
    normalizedScopeCodes.includes(AREA_MEASUREMENT_ADDON_KEY) ||
    normalizedScopeCodes.includes('areamatning')
  )
}

function normalizeAddonKeysForCompare(keys: string[]) {
  return keys
    .map((key) => normalizeAddonKey(key))
    .filter(Boolean)
    .sort()
}

function areAddonKeyListsEqual(a: string[], b: string[]) {
  const left = normalizeAddonKeysForCompare(a)
  const right = normalizeAddonKeysForCompare(b)
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function normalizeAssignmentRoleToInspectionSide(
  value: string | null | undefined
): 'buyer' | 'seller' | 'apartment' | null {
  const lowered = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (!lowered) return null
  if (lowered.includes('buy') || lowered.includes('kop')) return 'buyer'
  if (lowered.includes('sell') || lowered.includes('salj')) return 'seller'
  if (lowered.includes('apt') || lowered.includes('apartment') || lowered.includes('lagenhet')) {
    return 'apartment'
  }
  return null
}

const SECTIONS: { key: ObSectionKey; label: string }[] = [
  { key: 'grunddata', label: 'Grunddata' },
  { key: 'handlingar', label: 'Handlingar & upplysningar' },
  { key: 'forutsattningar', label: 'Förutsättningar' },
  { key: 'utsida', label: 'Byggnad - utsida' },
  { key: 'insida', label: 'Byggnad - insida' },
]

function getVisibleSections(isApartmentInspection: boolean, showAreaMeasurement: boolean) {
  const sections: { key: ObSectionKey; label: string }[] = [...SECTIONS]
  if (showAreaMeasurement) {
    sections.push({ key: 'areamatning', label: 'Areamätning' })
  }
  sections.push({ key: 'delivery', label: 'Skicka utlåtande' })

  if (!isApartmentInspection) return sections
  return sections.filter(section => section.key !== 'utsida')
}

export default function InspectionDetailPage() {
  const params = useParams()
  const router = useRouter()

  const propertyId = params?.id as string
  const inspectionId = params?.inspectionId as string

  const [property, setProperty] = useState<Property | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAddonKeys, setSelectedAddonKeys] = useState<string[]>([])
  const handleInspectionAddonSelectionChanged = useCallback((keys: string[]) => {
    setSelectedAddonKeys((prev) => (areAddonKeyListsEqual(prev, keys) ? prev : keys))
  }, [])

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
          cover_path,
          scope,
          inspection_time,
          attendees,
          attendees_other,
          inspection_side,
          defect_disclosures,
          locked_at,
          locked_by
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

      const [
        { data: snapshotData, error: snapshotError },
        { data: sourceProperty, error: propertyError },
        { data: assignmentData, error: assignmentError },
      ] = await Promise.all([
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
            dwelling_type,
            brf_name,
            apartment_number,
            apartment_holder_name
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
            dwelling_type,
            year_built
          `
          )
          .eq('id', resolvedPropertyId)
          .maybeSingle(),
        supabase
          .from('assignments')
          .select(
            'id,orderer_role,customer_name,customer_address,customer_postal_code,customer_city,customer_phone,customer_email,brf_name,apartment_number,apartment_holder_name'
          )
          .eq('inspection_id', inspectionId)
          .maybeSingle(),
      ])

      if (snapshotError) {
        console.error('Kunde inte hämta OB-snapshot:', snapshotError)
      }

      if (propertyError) {
        console.error('Kunde inte hämta fastighet:', propertyError?.message)
      }

      if (assignmentError) {
        console.error('Kunde inte hämta kopplad uppdragsbekräftelse:', assignmentError?.message)
      }

      const snapshot = (snapshotData as ObPropertySnapshot | null) ?? null
      const prop = (sourceProperty as Property | null) ?? null
      const assignment = (assignmentData as AssignmentForInspection | null) ?? null

      if (!snapshot && !prop) {
        setError('Kunde inte hämta fastighetsdata för besiktningen.')
        setLoading(false)
        return
      }

      const normalizedInspectionSide =
        normalizeAssignmentRoleToInspectionSide(inspectionRow.inspection_side) ??
        normalizeAssignmentRoleToInspectionSide(assignment?.orderer_role) ??
        'buyer'

      setInspection({
        ...inspectionRow,
        inspection_side: normalizedInspectionSide,
      } as Inspection)
      setProperty({
        id: resolvedPropertyId,
        name: snapshot?.name ?? prop?.name ?? 'Fastighet',
        address: snapshot?.address ?? prop?.address ?? null,
        postal_code: snapshot?.postal_code ?? prop?.postal_code ?? null,
        city: snapshot?.city ?? prop?.city ?? null,
        municipality: snapshot?.municipality ?? prop?.municipality ?? null,
        cadastral_id: snapshot?.cadastral_id ?? prop?.cadastral_id ?? null,
        owner_name: snapshot?.owner_name ?? prop?.owner_name ?? null,
        assignment_id: assignment?.id ?? null,
        customer_name: assignment?.customer_name ?? inspectionRow.client_name ?? null,
        customer_address: assignment?.customer_address ?? null,
        customer_postal_code: assignment?.customer_postal_code ?? null,
        customer_city: assignment?.customer_city ?? null,
        customer_phone: assignment?.customer_phone ?? null,
        customer_email: assignment?.customer_email ?? null,
        tenure_type: (snapshot?.tenure_type ?? prop?.tenure_type ?? null) as Property['tenure_type'],
        dwelling_type: (snapshot?.dwelling_type ?? prop?.dwelling_type ?? null) as Property['dwelling_type'],
        year_built: prop?.year_built ?? null,
        brf_name: snapshot?.brf_name ?? assignment?.brf_name ?? null,
        apartment_number: snapshot?.apartment_number ?? assignment?.apartment_number ?? null,
        apartment_holder_name:
          snapshot?.apartment_holder_name ?? assignment?.apartment_holder_name ?? null,
      } as Property)
      setLoading(false)
    }

    void load()
  }, [propertyId, inspectionId])

  useEffect(() => {
    if (!inspectionId) {
      setSelectedAddonKeys([])
      return
    }

    let cancelled = false

    const loadInspectionAddonSelections = async () => {
      try {
        const response = await fetch(`/api/ob/inspections/${inspectionId}/addon-orders`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as
          | {
              addonOrders?: Array<{ addon_key?: string | null; is_selected?: boolean }>
              error?: string
            }
          | null

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Kunde inte hämta tilläggsuppdrag.')
        }

        if (cancelled) return
        const rows = Array.isArray(payload?.addonOrders) ? payload.addonOrders : []
        const selected = rows
          .filter((row) => row?.is_selected === true)
          .map((row) => String(row?.addon_key ?? '').trim())
          .filter((value) => value.length > 0)
        setSelectedAddonKeys((prev) =>
          areAddonKeyListsEqual(prev, selected) ? prev : selected
        )
      } catch (loadAddonError) {
        console.error('Kunde inte läsa tilläggsuppdrag för sidomeny:', loadAddonError)
        if (!cancelled) {
          setSelectedAddonKeys((prev) => (prev.length === 0 ? prev : []))
        }
      }
    }

    void loadInspectionAddonSelections()

    return () => {
      cancelled = true
    }
  }, [inspectionId])

  const isApartmentInspection =
    normalizeAssignmentRoleToInspectionSide(inspection?.inspection_side) === 'apartment'
  const showAreaMeasurement = hasAreaMeasurementSelection(
    selectedAddonKeys,
    inspection?.scope ?? null
  )
  const visibleSections = getVisibleSections(isApartmentInspection, showAreaMeasurement)

  useEffect(() => {
    if (isApartmentInspection && activeSection === 'utsida') {
      setActiveSection('insida')
    }
  }, [isApartmentInspection, activeSection])

  useEffect(() => {
    if (!showAreaMeasurement && activeSection === 'areamatning') {
      setActiveSection('insida')
    }
  }, [showAreaMeasurement, activeSection])

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
              'radial-gradient(100% 70% at 50% 0%, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0) 58%), linear-gradient(135deg, #5a86dc 0%, #6eaeea 45%, #87CEFA 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/8" />

        <div className="relative mx-auto w-full max-w-7xl space-y-4">
          <div className="grid items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
            <div className="md:w-[240px]">
              <nav className="space-y-2 rounded-2xl border border-white/45 bg-white/95 p-3 shadow-xl ring-1 ring-black/5 md:sticky md:top-24 md:max-h-[calc(100vh-7rem)] md:w-[240px] md:overflow-auto">
                <div className="mb-2 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof window !== 'undefined' && window.history.length > 1) {
                        router.back()
                        return
                      }
                      router.push(`/properties/${propertyId}/ob`)
                    }}
                    aria-label="Tillbaka"
                    title="Tillbaka"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <ArrowLeft size={16} strokeWidth={2} />
                  </button>
                  <div className="text-sm font-semibold text-gray-900">Överlåtelsebesiktning</div>
                </div>

                {visibleSections.map((section) => (
                  <div key={section.key}>
                    <button
                      onClick={() => setActiveSection(section.key)}
                      className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                        activeSection === section.key
                          ? 'bg-indigo-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {section.label}
                    </button>

                  </div>
                ))}

              </nav>
            </div>

            <div
              className={`${
                activeSection === 'insida' || activeSection === 'utsida'
                  ? 'p-0 md:p-0'
                  : 'rounded-2xl border border-white/45 bg-white/95 p-3 shadow-xl ring-1 ring-black/5 md:p-4'
              }
                [&_input]:text-gray-900
                [&_input]:placeholder:text-gray-500
                [&_input]:border-gray-300
                [&_textarea]:text-gray-900
                [&_textarea]:placeholder:text-gray-500
                [&_textarea]:border-gray-300
                [&_textarea]:text-sm
                [&_textarea]:leading-5
                [&_select]:text-gray-900
                [&_select]:border-gray-300`}
            >
              <ObWizard
                property={property}
                inspection={inspection}
                activeSection={activeSection}
                onPropertyUpdated={(updated) => setProperty(updated as Property)}
                onInspectionUpdated={(updated) => setInspection(updated as Inspection)}
                onInspectionAddonSelectionChanged={handleInspectionAddonSelectionChanged}
              />
            </div>
          </div>
        </div>
      </main>
    </Protected>
  )
}
