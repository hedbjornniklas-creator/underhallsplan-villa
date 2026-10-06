'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Protected from '@/components/Protected'
import ObOrganizationBoundary, { useObOrganization, withObOrganization } from '@/components/ob/ObOrganizationBoundary'
import ObAssignmentWorkflowBoundary from '@/components/ob/ObAssignmentWorkflowBoundary'
import ObStepMenu from '@/components/ob/ObStepMenu'
import ObInspectionHeader, { ObInspectionNavigationContext } from '@/components/ob/ObInspectionHeader'
import '@/components/ob/ob-forms.css'
import { getObAssignmentReconciliationPatches, type ObAssignmentReconciledDetail } from '@/lib/ob/assignmentWorkflow'
import { ObBuildingContext } from '@/components/ob/ObBuildingContext'
import type { ObBuildingOverview } from '@/lib/ob/buildingStructure'
import { supabase } from '@/lib/supabaseClient'
import { parseScopeCodes } from '@/lib/report/scopeText'
import { hasEnvironmentalSelection } from '@/lib/ob/environmentalProtocol'
import { hasObTextDraftsForInspection } from '@/lib/ob/localTextDrafts'
import { isObRoundBackManaged } from '@/lib/ob/roundBackHistory'
import { getInitialObSection, isObRoundSection } from '@/lib/ob/mobileRound'
import { inspectionNavigationKey, restoreInspectionNavigation } from '@/lib/ob/inspectionNavigation'
import { parseObInspectionProfile, resolveObInspectionProfile, type ObInspectionProfileKey } from '@/lib/ob/inspectionProfile'
import { parseObObjectType, type ObObjectType } from '@/lib/ob/objectType'
import ObWizard, {
  ObSectionKey,
  ObWizardInspectionInput,
  ObWizardPropertyInput,
} from '@/components/ob/ObWizard'

type Property = ObWizardPropertyInput
type Inspection = ObWizardInspectionInput
type ObPropertySnapshot = {
  object_type: ObObjectType | null
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
): ObInspectionProfileKey | null {
  return parseObInspectionProfile(value)
}

type Section = { key: ObSectionKey; label: string; partId?: string }
const SECTIONS: Section[] = [
  { key: 'grunddata', label: 'Fastighet & uppdrag' },
  { key: 'handlingar', label: 'Handlingar & upplysningar' },
  { key: 'forutsattningar', label: 'Förutsättningar' },
  { key: 'runda-ny', label: 'ÖB-runda' },
]

function getVisibleSections(
  isApartmentInspection: boolean,
  showAreaMeasurement: boolean,
  showMoistureControl: boolean,
  buildings?: ObBuildingOverview | null,
  showRadon = false,
  showMould = false,
  isStatus = false,
) {
  const roundLabel = isStatus ? 'Statusbesiktning' : 'ÖB-runda'
  const sections: Section[] = buildings?.structure ? [
    ...SECTIONS.slice(0, 2),
    ...buildings.parts.flatMap(part => [
      { key: 'forutsattningar' as const, label: `Förutsättningar · ${part.name}`, partId: part.id },
      { key: 'runda-ny' as const, label: `${roundLabel} · ${part.name}`, partId: part.id },
    ]),
  ] : SECTIONS.map(section => section.key === 'runda-ny' ? { ...section, label: roundLabel } : section)
  if (showAreaMeasurement) {
    sections.push({ key: 'areamatning', label: 'Areamätning' })
  }
  if (showMoistureControl) {
    sections.push({ key: 'fuktkontroll', label: 'Fuktkontroll' })
  }
  if (showRadon) sections.push({ key: 'radon', label: 'Radonindikering' })
  if (showMould) sections.push({ key: 'mould', label: 'Mögelprov' })
  sections.push({ key: 'delivery', label: 'Skicka utlåtande' })

  if (!isApartmentInspection) return sections
  return sections.filter(section => section.key !== 'utsida')
}

export default function InspectionDetailPage() {
  return <ObOrganizationBoundary><InspectionDetailContent /></ObOrganizationBoundary>
}

function InspectionDetailContent() {
  const { id: orgId } = useObOrganization()
  const params = useParams()
  const router = useRouter()

  const propertyId = params?.id as string
  const inspectionId = params?.inspectionId as string

  const [property, setProperty] = useState<Property | null>(null)
  const [inspection, setInspection] = useState<Inspection | null>(null)
  useEffect(() => {
    const reconcile = (event: Event) => {
      const detail = (event as CustomEvent<ObAssignmentReconciledDetail>).detail
      if (!detail || detail.workflow.inspectionId !== inspectionId) return
      const patches = getObAssignmentReconciliationPatches(detail)
      if (Object.keys(patches.inspection).length) setInspection(current => current ? { ...current, ...patches.inspection } as Inspection : current)
      if (Object.keys(patches.property).length) setProperty(current => current ? { ...current, ...patches.property } as Property : current)
    }
    window.addEventListener('ob-assignment-reconciled', reconcile)
    return () => window.removeEventListener('ob-assignment-reconciled', reconcile)
  }, [inspectionId])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedAddonKeys, setSelectedAddonKeys] = useState<string[]>([])
  const [addonsLoadedFor, setAddonsLoadedFor] = useState<string | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [buildingOverview, setBuildingOverview] = useState<ObBuildingOverview | null>(null)
  const [buildingError, setBuildingError] = useState<string | null>(null)
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null)
  const buildingRequest = useRef(0)
  const reloadBuildings = useCallback(async () => {
    const request = ++buildingRequest.current
    const response = await fetch(withObOrganization(`/api/ob/inspections/${inspectionId}/buildings`, orgId), { cache: 'no-store' })
    const result = await response.json()
    if (request !== buildingRequest.current) return
    if (!response.ok || !result.data) throw Error(result.error || 'Byggnaderna kunde inte hämtas.')
    if (!Array.isArray(result.data.parts) || result.data.structure && (
      result.data.structure.inspection_id !== inspectionId || !result.data.parts.some((part: { id: string; inspection_id: string }) =>
        part.id === result.data.structure.primary_part_id && part.inspection_id === inspectionId)))
      throw Error('Byggnadsindelningen kunde inte verifieras.')
    setBuildingOverview(result.data)
    setBuildingError(null)
  }, [inspectionId, orgId])
  useEffect(() => {
    let active = true
    setBuildingOverview(null); setBuildingError(null); setSelectedBuildingId(null)
    void reloadBuildings().catch(error => { if (active) setBuildingError(error.message) })
    return () => { active = false; buildingRequest.current++ }
  }, [reloadBuildings])
  const textDraftHistoryGuardPushedRef = useRef(false)
  const confirmLeaveIfTextDrafts = useCallback(() => {
    if (!hasObTextDraftsForInspection(inspectionId)) return true
    return window.confirm(
      'Det finns text som bara är sparad lokalt på den här enheten. Den ligger kvar och försöker sparas när du öppnar besiktningen igen. Vill du lämna ändå?'
    )
  }, [inspectionId])
  const handleBackToInspections = useCallback(() => {
    if (!confirmLeaveIfTextDrafts()) return
    router.push(withObOrganization('/inspections', orgId))
  }, [confirmLeaveIfTextDrafts, router, orgId])
  const handleInspectionAddonSelectionChanged = useCallback((keys: string[]) => {
    setSelectedAddonKeys((prev) => (areAddonKeyListsEqual(prev, keys) ? prev : keys))
  }, [])

  const [activeSection, setActiveSection] = useState<ObSectionKey>('grunddata')
  const [navigationReadyFor, setNavigationReadyFor] = useState<string | null>(null)
  const activeBuilding = buildingOverview?.parts.find(part => part.id === selectedBuildingId)
    ?? buildingOverview?.parts.find(part => part.id === buildingOverview.structure?.primary_part_id) ?? null
  useEffect(() => {
    if (['runda', 'insida', 'utsida'].includes(activeSection)) setActiveSection('runda-ny')
  }, [buildingOverview?.structure, activeSection])
  const mobileRoundV2 = activeSection === 'runda-ny'
  const isRoundSection = isObRoundSection(activeSection)

  useEffect(() => {
    if (typeof window === 'undefined') return

    const hasTextDrafts = () => hasObTextDraftsForInspection(inspectionId)
    const confirmMessage =
      'Det finns text som bara är sparad lokalt på den här enheten. Den ligger kvar och försöker sparas när du öppnar besiktningen igen. Vill du lämna ändå?'

    const pushBackButtonGuard = () => {
      if (textDraftHistoryGuardPushedRef.current || isObRoundBackManaged(inspectionId) || !hasTextDrafts()) return
      window.history.pushState({ obTextDraftGuard: true }, '', window.location.href)
      textDraftHistoryGuardPushedRef.current = true
    }

    const beforeOrganizationSwitch = (event: Event) => {
      if (hasTextDrafts() && !window.confirm(confirmMessage)) event.preventDefault()
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
    window.addEventListener('hushub:before-organization-switch', beforeOrganizationSwitch)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('popstate', handlePopState)
    document.addEventListener('click', handleDocumentClick, true)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('hushub:before-organization-switch', beforeOrganizationSwitch)
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
          inspection_family,
          inspection_variant,
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
            object_type,
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
        resolveObInspectionProfile({ ...inspectionRow, ordererRole: assignment?.orderer_role }) ??
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
        object_type: parseObObjectType(snapshot?.object_type),
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
    setAddonsLoadedFor(null)
    setSelectedAddonKeys([])

    const loadInspectionAddonSelections = async () => {
      try {
        const response = await fetch(withObOrganization(`/api/ob/inspections/${inspectionId}/addon-orders`, orgId), {
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
      } finally {
        if (!cancelled) setAddonsLoadedFor(inspectionId)
      }
    }

    void loadInspectionAddonSelections()

    return () => {
      cancelled = true
    }
  }, [inspectionId, orgId])

  const isApartmentInspection =
    normalizeAssignmentRoleToInspectionSide(inspection?.inspection_side) === 'apartment'
  const isStatusInspection = inspection ? resolveObInspectionProfile(inspection) === 'status' : false
  const showAreaMeasurement = hasAreaMeasurementSelection(
    selectedAddonKeys,
    inspection?.scope ?? null
  )
  const showMoistureControl = hasMoistureControlSelection(selectedAddonKeys, inspection?.scope ?? null)
  const showRadon = hasEnvironmentalSelection(selectedAddonKeys, parseScopeCodes(inspection?.scope), 'radon')
  const showMould = hasEnvironmentalSelection(selectedAddonKeys, parseScopeCodes(inspection?.scope), 'mould')
  const visibleSections = getVisibleSections(
    isApartmentInspection,
    showAreaMeasurement,
    showMoistureControl,
    buildingOverview,
    showRadon,
    showMould,
    isStatusInspection,
  )
  const activeSectionIndex = visibleSections.findIndex(section => section.key === activeSection && (!section.partId || section.partId === activeBuilding?.id))
  const activeSectionLabel = visibleSections[activeSectionIndex]?.label ?? ''

  useEffect(() => {
    if (loading || inspection?.id !== inspectionId || !buildingOverview || navigationReadyFor === inspectionId) return
    let raw: string | null = null
    try { raw = sessionStorage.getItem(inspectionNavigationKey(inspectionId)) } catch {}
    // Add-on visibility is reconciled once its independent request completes.
    const sections = getVisibleSections(isApartmentInspection, true, true, buildingOverview, true, true, isStatusInspection)
    const position = restoreInspectionNavigation(raw, sections, 'grunddata', buildingOverview.structure?.primary_part_id ?? null,
      getInitialObSection(window.location.search) === 'runda-ny')
    setActiveSection(position.section)
    setSelectedBuildingId(position.partId)
    setNavigationReadyFor(inspectionId)
  }, [loading, inspection?.id, inspectionId, buildingOverview, navigationReadyFor, isApartmentInspection, isStatusInspection])

  useEffect(() => {
    if (loading || navigationReadyFor !== inspectionId || !buildingOverview) return
    try {
      sessionStorage.setItem(inspectionNavigationKey(inspectionId), JSON.stringify({ section: activeSection, partId: activeBuilding?.id ?? null }))
    } catch {}
  }, [loading, navigationReadyFor, inspectionId, buildingOverview, activeSection, activeBuilding?.id])

  useEffect(() => {
    if (isApartmentInspection && activeSection === 'utsida') {
      setActiveSection('runda-ny')
    }
  }, [isApartmentInspection, activeSection])

  useEffect(() => {
    if (addonsLoadedFor === inspectionId && !showAreaMeasurement && activeSection === 'areamatning') {
      setActiveSection('runda-ny')
    }
  }, [addonsLoadedFor, inspectionId, showAreaMeasurement, activeSection])

  useEffect(() => {
    if (addonsLoadedFor === inspectionId && !showMoistureControl && activeSection === 'fuktkontroll') {
      setActiveSection(showAreaMeasurement ? 'areamatning' : 'runda-ny')
    }
  }, [addonsLoadedFor, inspectionId, activeSection, showAreaMeasurement, showMoistureControl])

  useEffect(() => {
    if (addonsLoadedFor === inspectionId && ((activeSection === 'radon' && !showRadon) || (activeSection === 'mould' && !showMould))) setActiveSection('grunddata')
  }, [addonsLoadedFor, inspectionId, activeSection, showRadon, showMould])

  useEffect(() => {
    setMobileMenuOpen(false)
  }, [activeSection])

  useEffect(() => {
    document.body.classList.add('ob-inspection-active')

    return () => {
      document.body.classList.remove('ob-inspection-active')
    }
  }, [])

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
            onClick={() => router.push(withObOrganization(`/properties/${propertyId}/ob`, orgId))}
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
        data-ob-mobile-round={mobileRoundV2}
        className="ob-inspection-page"
      >
        <ObInspectionNavigationContext.Provider value={{ address: property.address ?? '',
          step: activeSectionIndex + 1, total: visibleSections.length, onBack: handleBackToInspections }}>
        <div className="ob-form-shell ob-inspection-shell">
          {!isRoundSection && <ObInspectionHeader inspectionId={inspection.id} title={activeSectionLabel}
            onOpenMenu={() => setMobileMenuOpen(true)} />}
          {isRoundSection && (buildingError || !buildingOverview || navigationReadyFor !== inspectionId) &&
            <ObInspectionHeader inspectionId={inspection.id} title={activeSectionLabel || (isStatusInspection ? 'Statusbesiktning' : 'ÖB-runda')} onOpenMenu={() => setMobileMenuOpen(true)} />}

          <div className="grid min-w-0 items-start">
            <div
              className={`ob-inspection-content${isRoundSection ? ' ob-inspection-content-round' : ''}`}
            >
              <ObAssignmentWorkflowBoundary key={inspection.id} inspectionId={inspection.id} showStatus={!isRoundSection}>
              {buildingError ? <div role="alert" className="p-4 text-red-700">{buildingError}
                <button type="button" className="ml-3 underline" onClick={() => void reloadBuildings().catch(error => setBuildingError(error.message))}>Försök igen</button>
              </div> : !buildingOverview || navigationReadyFor !== inspectionId ? <p role="status" className="p-4">Hämtar byggnader...</p> :
              <ObBuildingContext.Provider value={{ inspectionId, overview: buildingOverview, part: activeBuilding, reload: reloadBuildings }}>
              <ObWizard
                property={property}
                inspection={inspection}
                activeSection={activeSection}
                onOpenStepMenu={() => setMobileMenuOpen(true)}
                onPropertyUpdated={(updated) => setProperty(updated as Property)}
                onInspectionUpdated={(updated) => setInspection(updated as Inspection)}
                onInspectionAddonSelectionChanged={handleInspectionAddonSelectionChanged}
              />
              </ObBuildingContext.Provider>}
              </ObAssignmentWorkflowBoundary>
            </div>
          </div>
        </div>
        </ObInspectionNavigationContext.Provider>

        {mobileMenuOpen ? (
          <ObStepMenu sections={visibleSections} buildings={buildingOverview?.parts ?? []}
            activeIndex={activeSectionIndex} onClose={() => setMobileMenuOpen(false)}
            onBack={handleBackToInspections}
            onSelect={section => {
              // Local drafts survive internal navigation. Do not block the path back to their editor.
              if (section.partId) setSelectedBuildingId(section.partId)
              setActiveSection(section.key)
              setMobileMenuOpen(false)
            }} />
        ) : null}
      </main>
    </Protected>
  )
}


