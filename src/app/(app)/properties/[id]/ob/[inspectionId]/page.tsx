'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Menu, X } from 'lucide-react'
import Protected from '@/components/Protected'
import { supabase } from '@/lib/supabaseClient'
import { parseScopeCodes } from '@/lib/report/scopeText'
import { hasObTextDraftsForInspection } from '@/lib/ob/localTextDrafts'
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
  heating: string | null
  ventilation: string | null
  year_built: number | null
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
const MOISTURE_CONTROL_ADDON_KEY = 'moisture_risk'

function isMoistureAddonToken(value: string) {
  const normalized = normalizeAddonKey(value)
  if (!normalized) return false
  if (
    normalized === MOISTURE_CONTROL_ADDON_KEY ||
    normalized === 'moisture' ||
    normalized === 'fuktkontroll' ||
    normalized === 'fuktmatning' ||
    normalized === 'fuktmatning_eller_fuktindikering_av_riskkonstruktion' ||
    normalized === 'fuktindikering_av_riskkonstruktion'
  ) {
    return true
  }
  if (normalized.includes('moisture')) return true
  if (normalized.includes('fukt')) {
    return (
      normalized.includes('risk') ||
      normalized.includes('kontroll') ||
      normalized.includes('matning')
    )
  }
  return false
}

function normalizeAddonKey(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

function normalizeTextOrNull(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return normalized.length > 0 ? normalized : null
}

function extractEmailFromLegacyContact(value: string | null | undefined) {
  const match = String(value ?? '').match(EMAIL_PATTERN)
  return match?.[0]?.trim().toLowerCase() ?? null
}

function extractPhoneFromLegacyContact(value: string | null | undefined) {
  const withoutEmail = String(value ?? '').replace(EMAIL_PATTERN, '')
  const normalized = withoutEmail.replace(/\s*\|\s*/g, ' ').trim()
  return normalized.length > 0 ? normalized : null
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

function hasMoistureControlSelection(selectedAddonKeys: string[], scope: string | null | undefined) {
  const hasSelectedAddon = selectedAddonKeys.some((key) => isMoistureAddonToken(key))
  if (hasSelectedAddon) return true

  const normalizedScopeCodes = parseScopeCodes(scope).map(normalizeAddonKey)
  return normalizedScopeCodes.some((token) => isMoistureAddonToken(token))
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
  { key: 'runda', label: 'ÖB-runda' },
  { key: 'utsida', label: 'Byggnad - utsida' },
  { key: 'insida', label: 'Byggnad - insida' },
]

function getVisibleSections(
  isApartmentInspection: boolean,
  showAreaMeasurement: boolean,
  showMoistureControl: boolean
) {
  const sections: { key: ObSectionKey; label: string }[] = [...SECTIONS]
  if (showAreaMeasurement) {
    sections.push({ key: 'areamatning', label: 'Areamätning' })
  }
  if (showMoistureControl) {
    sections.push({ key: 'fuktkontroll', label: 'Fuktkontroll' })
  }
  sections.push({ key: 'review', label: 'Granska' })
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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const textDraftHistoryGuardPushedRef = useRef(false)
  const confirmLeaveIfTextDrafts = useCallback(() => {
    if (!hasObTextDraftsForInspection(inspectionId)) return true
    return window.confirm(
      'Det finns text som bara är sparad lokalt på den här enheten. Den ligger kvar och försöker sparas när du öppnar besiktningen igen. Vill du lämna ändå?'
    )
  }, [inspectionId])
  const handleBackToInspections = useCallback(() => {
    if (!confirmLeaveIfTextDrafts()) return
    router.push('/inspections')
  }, [confirmLeaveIfTextDrafts, router])
  const handleInspectionAddonSelectionChanged = useCallback((keys: string[]) => {
    setSelectedAddonKeys((prev) => (areAddonKeyListsEqual(prev, keys) ? prev : keys))
  }, [])

  // Starta på Grunddata
  const [activeSection, setActiveSection] = useState<ObSectionKey>('grunddata')

  useEffect(() => {
    if (typeof window === 'undefined') return

    const hasTextDrafts = () => hasObTextDraftsForInspection(inspectionId)
    const confirmMessage =
      'Det finns text som bara är sparad lokalt på den här enheten. Den ligger kvar och försöker sparas när du öppnar besiktningen igen. Vill du lämna ändå?'

    const pushBackButtonGuard = () => {
      if (textDraftHistoryGuardPushedRef.current || !hasTextDrafts()) return
      window.history.pushState({ obTextDraftGuard: true }, '', window.location.href)
      textDraftHistoryGuardPushedRef.current = true
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasTextDrafts()) return
      event.preventDefault()
      event.returnValue = ''
    }

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const anchor = target?.closest('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target === '_blank') return

      const nextUrl = new URL(anchor.href, window.location.href)
      const currentUrl = new URL(window.location.href)
      if (nextUrl.origin === currentUrl.origin && nextUrl.pathname === currentUrl.pathname) {
        return
      }

      if (!hasTextDrafts()) return
      if (!window.confirm(confirmMessage)) event.preventDefault()
    }

    const handlePopState = (event: PopStateEvent) => {
      const state = event.state as { obTextDraftGuard?: unknown } | null
      if (state?.obTextDraftGuard === true) return
      if (!textDraftHistoryGuardPushedRef.current) return
      if (!hasTextDrafts()) {
        textDraftHistoryGuardPushedRef.current = false
        return
      }

      if (window.confirm(confirmMessage)) {
        textDraftHistoryGuardPushedRef.current = false
        window.setTimeout(() => window.history.back(), 0)
        return
      }

      window.history.pushState({ obTextDraftGuard: true }, '', window.location.href)
    }

    pushBackButtonGuard()
    const intervalId = window.setInterval(pushBackButtonGuard, 1000)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('popstate', handlePopState)
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [inspectionId])

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
          customer_name,
          customer_email,
          customer_phone,
          customer_address,
          customer_postal_code,
          customer_city,
          locked_at,
          locked_by
        `
        )
        .eq('id', inspectionId)
        .eq('inspection_family', 'OB')
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
            apartment_holder_name,
            heating,
            ventilation,
            year_built
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
            heating,
            ventilation,
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
      const legacyCustomerEmail = extractEmailFromLegacyContact(inspectionRow.client_contact)
      const legacyCustomerPhone = extractPhoneFromLegacyContact(inspectionRow.client_contact)
      const hasInspectionCustomerFields = [
        inspectionRow.customer_name,
        inspectionRow.customer_email,
        inspectionRow.customer_phone,
        inspectionRow.customer_address,
        inspectionRow.customer_postal_code,
        inspectionRow.customer_city,
      ].some((value) => normalizeTextOrNull(value) !== null)
      const inspectionCustomerName =
        normalizeTextOrNull(inspectionRow.customer_name) ??
        normalizeTextOrNull(inspectionRow.client_name)
      const inspectionCustomerEmail =
        normalizeTextOrNull(inspectionRow.customer_email)?.toLowerCase() ?? legacyCustomerEmail
      const inspectionCustomerPhone =
        normalizeTextOrNull(inspectionRow.customer_phone) ?? legacyCustomerPhone

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
        customer_name:
          inspectionCustomerName ??
          (hasInspectionCustomerFields ? null : assignment?.customer_name ?? null),
        customer_address: hasInspectionCustomerFields
          ? inspectionRow.customer_address ?? null
          : assignment?.customer_address ?? null,
        customer_postal_code:
          hasInspectionCustomerFields
            ? inspectionRow.customer_postal_code ?? null
            : assignment?.customer_postal_code ?? null,
        customer_city: hasInspectionCustomerFields
          ? inspectionRow.customer_city ?? null
          : assignment?.customer_city ?? null,
        customer_phone:
          inspectionCustomerPhone ??
          (hasInspectionCustomerFields ? null : assignment?.customer_phone ?? null),
        customer_email:
          inspectionCustomerEmail ??
          (hasInspectionCustomerFields ? null : assignment?.customer_email ?? null),
        tenure_type: (snapshot?.tenure_type ?? prop?.tenure_type ?? null) as Property['tenure_type'],
        dwelling_type: (snapshot?.dwelling_type ?? prop?.dwelling_type ?? null) as Property['dwelling_type'],
        year_built: snapshot?.year_built ?? prop?.year_built ?? null,
        heating: snapshot?.heating ?? prop?.heating ?? null,
        ventilation: snapshot?.ventilation ?? prop?.ventilation ?? null,
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
  const showMoistureControl = hasMoistureControlSelection(selectedAddonKeys, inspection?.scope ?? null)
  const visibleSections = getVisibleSections(
    isApartmentInspection,
    showAreaMeasurement,
    showMoistureControl
  )
  const activeSectionIndex = visibleSections.findIndex((section) => section.key === activeSection)
  const activeSectionLabel = visibleSections.find((section) => section.key === activeSection)?.label ?? ''

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

  useEffect(() => {
    if (!showMoistureControl && activeSection === 'fuktkontroll') {
      setActiveSection(showAreaMeasurement ? 'areamatning' : 'insida')
    }
  }, [activeSection, showAreaMeasurement, showMoistureControl])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [activeSection])

  useEffect(() => {
    document.body.classList.toggle('ob-round-fullscreen', activeSection === 'runda')

    return () => {
      document.body.classList.remove('ob-round-fullscreen')
    }
  }, [activeSection])

  useEffect(() => {
    if (!mobileMenuOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [mobileMenuOpen])

  if (loading) {
    return (
      <Protected>
        <main className="p-6">
          <p className="text-sm text-gray-500">Laddar besiktning...</p>
        </main>
      </Protected>
    )
  }

  if (error || !inspection || !property) {
    return (
      <Protected>
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
    <Protected>
      <main
        className={`relative min-h-full overflow-hidden ${
          activeSection === 'runda' ? 'p-0' : 'px-2 pb-24 pt-3 sm:px-3 md:p-6'
        }`}
      >
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(135deg, #f7fbff 0%, #ffffff 52%, #f3f9ff 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/8" />

        <div
          className={`relative mx-auto w-full ${
            activeSection === 'runda' ? 'max-w-none space-y-0' : 'max-w-7xl space-y-3 md:space-y-4'
          }`}
        >
          {activeSection !== 'runda' ? (
            <div className="flex items-center justify-between gap-2 rounded-full border border-white/45 bg-white/90 px-2.5 py-2 shadow-lg ring-1 ring-black/5 md:hidden">
              <button
                type="button"
                onClick={handleBackToInspections}
                aria-label="Tillbaka"
                title="Tillbaka"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <ArrowLeft size={17} strokeWidth={2} />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <div className="truncate text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Överlåtelsebesiktning
                </div>
                <div className="truncate text-sm font-semibold text-gray-900">
                  {activeSectionLabel}
                  {activeSectionIndex >= 0 ? (
                    <span className="ml-1 text-xs font-medium text-gray-500">
                      {activeSectionIndex + 1}/{visibleSections.length}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="inline-flex h-9 min-w-9 items-center justify-center rounded-full bg-indigo-50 px-2 text-xs font-semibold text-indigo-700">
                {activeSectionIndex >= 0 ? `${activeSectionIndex + 1}/${visibleSections.length}` : null}
              </div>
            </div>
          ) : null}

          <div className="grid min-w-0 items-start">
            <div
              className={`${
                activeSection === 'insida' ||
                activeSection === 'utsida' ||
                activeSection === 'runda' ||
                activeSection === 'review' ||
                activeSection === 'areamatning' ||
                activeSection === 'fuktkontroll'
                  ? 'p-0 md:p-0'
                  : 'md:rounded-2xl md:border md:border-white/45 md:bg-white/95 md:p-4 md:shadow-xl md:ring-1 md:ring-black/5'
              }
                min-w-0 max-w-full overflow-x-hidden
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
                onSectionChange={setActiveSection}
                availableSections={visibleSections.map((section) => section.key)}
              />
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Öppna stegmeny"
          title="Öppna stegmeny"
          className="fixed left-4 top-28 z-[60] hidden h-12 w-12 items-center justify-center rounded-full bg-indigo-600 text-white shadow-2xl shadow-indigo-950/30 ring-1 ring-white/50 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:inline-flex"
        >
          <Menu size={25} strokeWidth={2.35} />
        </button>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          aria-label="Öppna stegmeny"
          title="Öppna stegmeny"
          className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] right-4 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-2xl shadow-indigo-950/30 ring-1 ring-white/50 transition hover:bg-indigo-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 md:hidden"
        >
          <Menu size={25} strokeWidth={2.35} />
        </button>

        {mobileMenuOpen ? (
          <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true">
            <button
              type="button"
              aria-label="Stäng stegmeny"
              className="absolute inset-0 h-full w-full bg-black/40"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="absolute inset-x-0 bottom-0 rounded-t-[2rem] border border-white/40 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-y-0 md:left-0 md:right-auto md:w-[320px] md:rounded-none md:border-r md:p-5">
              <div className="mx-auto mb-3 h-1.5 w-12 rounded-full bg-gray-300 md:hidden" />
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500">Steg</div>
                  <div className="text-lg font-semibold text-gray-900">Överlåtelsebesiktning</div>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Stäng"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-gray-200 bg-gray-50 text-gray-700"
                >
                  <X size={20} strokeWidth={2.25} />
                </button>
              </div>
              <button
                type="button"
                onClick={handleBackToInspections}
                className="mb-3 inline-flex w-full items-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50"
              >
                <ArrowLeft size={17} strokeWidth={2} />
                Tillbaka till besiktningar
              </button>
              <div className="grid max-h-[62vh] gap-2 overflow-auto pr-1">
                {visibleSections.map((section, index) => (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => setActiveSection(section.key)}
                    className={`flex items-center justify-between rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                      activeSection === section.key
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/15'
                        : 'bg-gray-50 text-gray-800 hover:bg-gray-100'
                    }`}
                  >
                    <span>{section.label}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs ${
                        activeSection === section.key
                          ? 'bg-white/18 text-white'
                          : 'bg-white text-gray-500'
                      }`}
                    >
                      {index + 1}/{visibleSections.length}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </Protected>
  )
}


