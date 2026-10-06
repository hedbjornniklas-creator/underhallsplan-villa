'use client'

import { useCallback, useEffect, useId, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import ObFormSaveStatus from './ObFormSaveStatus'
import { ObFormField, ObFormSection } from './ObFormPrimitives'
import { Camera, Image as ImageIcon } from 'lucide-react'
import './ob-forms.css'
import { enqueueObGrunddataWrite, recordObGrunddataWriteResult, trackObGrunddataWrite } from '@/lib/ob/grunddataWrites'
import { useObFormDraft } from './useObFormDraft'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'
import { loadObOrganizationInspectorProfile } from '@/lib/ob/profileCardClient'
import { useObOrganization, useObOrganizationSwitchGuard, withObOrganization } from './ObOrganizationBoundary'
import { formatCertificationDisplayLines } from '@/lib/certifications/display'
import type { InspectorCertificationListItem } from '@/lib/certifications/profileSummary'
import {
  getNextInspectionAssignmentNumber,
  isInspectionAssignmentNumberForDate,
} from '@/lib/inspections/assignmentNumber'
import DebouncedTextarea from './DebouncedTextarea'
import ObBuildingOverview from './ObBuildingOverview'
import ObCoverImageBank from './ObCoverImageBank'
import { useObBuilding } from './ObBuildingContext'
import { resolveInspectionCoverUrl } from '@/lib/ob/inspectionCoverUrl'
import { getObInspectionClassification, resolveObInspectionProfile, type ObInspectionProfileKey } from '@/lib/ob/inspectionProfile'
import { getObProfileChangeConfirmation } from '@/lib/ob/inspectionProfileChange'
import { resolveObObjectType, type ObObjectType } from '@/lib/ob/objectType'
import { hasObTextDraftsForInspection } from '@/lib/ob/localTextDrafts'

export type ObInspection = Tables<'inspections'>

type BaseProperty = Tables<'properties'>
type Property = BaseProperty & {
  object_type: ObObjectType | null
  assignment_id: string | null
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
type Inspection = ObInspection
type EditableInspectionSide = ObInspectionProfileKey

function profileChangeDraftError(inspectionId: string): string | null {
  try {
    if (!hasObTextDraftsForInspection(inspectionId)) return null
  } catch {
    return 'Lokala utkast kunde inte kontrolleras. Typ av uppdrag har inte ändrats.'
  }
  return 'Det finns lokala textutkast. Öppna och spara dem innan du byter till eller från statusbesiktning.'
}
type SupabaseUpsertClient = {
  from: (table: string) => {
    upsert: (
      payload: Record<string, unknown>,
      options: { onConflict: string }
    ) => Promise<{ error: { message?: string } | null }>
  }
}
type InspectorProfile = {
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  certification_items: InspectorCertificationListItem[]
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
}

type FrozenInspectorApiResponse = {
  locked: boolean
  hasSnapshot: boolean
  profile: Partial<InspectorProfile> | null
}

interface ObStepGrunddataProps {
  property: Property
  inspection: ObInspection
  workspace?: boolean
  onPropertyUpdated?: (p: Property) => void
  onInspectionUpdated?: (i: ObInspection) => void
  onInspectionAddonSelectionChanged?: (selectedAddonKeys: string[]) => void
}

type InspectionAddonOrder = {
  id: string
  addon_key: string
  addon_name_snapshot: string
  sort_order: number | null
  price_amount_snapshot: number | string | null
  currency_snapshot: string | null
  is_selected: boolean
}

// Standardval för Omfattning - går lätt att ändra senare
const SCOPE_OPTIONS: { key: string; label: string }[] = [
  { key: 'main_building', label: 'Okulär besiktning av huvudbyggnaden' },
  { key: 'outbuildings', label: 'Besiktning av komplementbyggnader' },
  {
    key: 'moisture_risk',
    label: 'Fuktmätning eller fuktindikering av riskkonstruktion',
  },
  { key: 'area', label: 'Areamätning' },
  { key: 'radon', label: 'Radonindikering' },
  { key: 'mould', label: 'Mögelprov' },
]

// Standardval för Närvarande (huvudroller)
const ATTENDEE_OPTIONS: { key: 'owner' | 'buyer'; label: string }[] = [
  { key: 'owner', label: 'Fastighetsägare' },
  { key: 'buyer', label: 'Köpare' },
]

// Visitkort / besiktningsinfo (statisk tills vi kopplar mot profil)
const INSPECTOR_CARD = {
  name: 'Ej angivet',
  sbrLine1: 'SBR-grupp saknas',
  sbrLine2: 'SBR-status saknas',
  memberNumber: '-',
  phone: '-',
  email: '-',
  company: '-',
  orgNumber: '-',
  addressLine: '-',
}

const COVER_IMAGE_BUCKET = 'inspection-images' as const
const CUSTOMER_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function normalizeTextOrNull(value: string): string | null {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function formValues(patch: object): Record<string, string> {
  return Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, value == null ? '' : String(value)]))
}

// Hjälpare: tolka/spara listor som semikolon-separerad text
function parseList(raw: string | null): string[] {
  if (!raw) return []
  return raw
    .split(';')
    .map(s => s.trim())
    .filter(Boolean)
}

function formatList(labels: string[]): string {
  return labels.join('; ')
}

function parseScopeLabels(raw: string | null): string[] {
  return parseList(raw)
}

function formatScopeLabels(labels: string[]): string {
  return formatList(labels)
}

function parseAttendeeLabels(raw: string | null): string[] {
  return parseList(raw)
}

function formatAttendeeLabels(labels: string[]): string {
  return formatList(labels)
}

function resolvePublicMediaUrl(path: string | null | undefined) {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return null

  if (path.startsWith('/storage/')) {
    return `${base}${path}`
  }

  if (path.startsWith('storage/')) {
    return `${base}/${path}`
  }

  if (path.startsWith('/')) {
    return path
  }

  return `${base}/storage/v1/object/public/property-media/${path}`
}

function normalizeInspectionStatus(value: string | null | undefined): string {
  const raw = (value ?? '').trim()
  const normalized = raw.toLowerCase()

  if (normalized === '' || normalized === 'draft' || normalized === 'utkast') {
    return 'draft'
  }
  if (
    normalized === 'ongoing' ||
    normalized === 'p\u00e5g\u00e5ende' ||
    normalized === 'pagaende'
  ) {
    return 'ongoing'
  }
  if (normalized === 'completed' || normalized === 'klar' || normalized === 'done') {
    return 'completed'
  }
  if (normalized === 'archived' || normalized === 'arkiverad') {
    return 'archived'
  }

  return raw
}

export default function ObStepGrunddata({
  property,
  inspection,
  workspace = false,
  onPropertyUpdated,
  onInspectionUpdated,
  onInspectionAddonSelectionChanged,
}: ObStepGrunddataProps) {
  const { id: orgId } = useObOrganization()
  // Lokalt formulär-state - vi utgår från inkommande props
  const [propForm, setPropForm, acknowledgeProperty, propertyDirty] = useObFormDraft(inspection.id, {
    object_type: property.object_type ?? '',
    cadastral_id: property.cadastral_id ?? '',
    address: property.address ?? '',
    postal_code: property.postal_code ?? '',
    city: property.city ?? '',
    municipality: property.municipality ?? '',
    owner_name: property.owner_name ?? '',
    brf_name: property.brf_name ?? '',
    apartment_number: property.apartment_number ?? '',
    apartment_holder_name: property.apartment_holder_name ?? '',
  })

  const [inspForm, setInspForm, acknowledgeInspection, inspectionDirty] = useObFormDraft(inspection.id, {
    status: normalizeInspectionStatus(inspection.status),
    cover_path: inspection.cover_path ?? '',
    assignment_number: inspection.assignment_number ?? '',
    assignment_confirmation_delivered_date:
      inspection.assignment_confirmation_delivered_date ?? '',
    scope: inspection.scope ?? '',
    date: inspection.date ?? '',
    inspection_time: inspection.inspection_time ?? '',
    attendees: inspection.attendees ?? '',
    attendees_other: inspection.attendees_other ?? '',
    inspection_side: resolveObInspectionProfile(inspection) ?? 'buyer',
  })
  const [ordererForm, setOrdererForm, acknowledgeOrderer, ordererDirty] = useObFormDraft(inspection.id, {
    customer_name: property.customer_name ?? inspection.client_name ?? '',
    customer_address: property.customer_address ?? '',
    customer_postal_code: property.customer_postal_code ?? '',
    customer_city: property.customer_city ?? '',
    customer_phone: property.customer_phone ?? '',
    customer_email: property.customer_email ?? '',
  })

  const [pendingProp, setPendingProp] = useState(0)
  const [pendingInsp, setPendingInsp] = useState(0)
  const [pendingOrderer, setPendingOrderer] = useState(0)
  const savingProp = pendingProp > 0
  const savingInsp = pendingInsp > 0
  const savingOrderer = pendingOrderer > 0
  const latestProperty = useRef(property)
  const latestInspection = useRef<ObInspection & { locked_at?: string | null }>(inspection)
  latestProperty.current = property
  latestInspection.current = inspection
  const [uploadingCover, setUploadingCover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [changingInspectionSide, setChangingInspectionSide] = useState(false)
  const [changingObjectType, setChangingObjectType] = useState(false)
  useObOrganizationSwitchGuard(
    propertyDirty || inspectionDirty || ordererDirty,
    savingProp || savingInsp || savingOrderer || uploadingCover || changingInspectionSide || changingObjectType
  )
  const coverCameraInputRef = useRef<HTMLInputElement | null>(null)
  const coverLibraryInputRef = useRef<HTMLInputElement | null>(null)
  const [inspectorProfile, setInspectorProfile] = useState<InspectorProfile | null>(null)
  const [frozenInspectorProfile, setFrozenInspectorProfile] = useState<Partial<InspectorProfile> | null>(null)
  const [inspectorAvatarLoadError, setInspectorAvatarLoadError] = useState(false)
  const [inspectionAddonOrders, setInspectionAddonOrders] = useState<InspectionAddonOrder[]>([])
  const [inspectionAddonLoading, setInspectionAddonLoading] = useState(false)
  const isInspectionLocked = Boolean((inspection as ObInspection & { locked_at?: string | null }).locked_at)

  const notifyAddonSelection = useCallback(
    (rows: InspectionAddonOrder[]) => {
      if (!onInspectionAddonSelectionChanged) return
      onInspectionAddonSelectionChanged(
        rows
          .filter(row => row.is_selected)
          .map(row => row.addon_key)
          .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      )
    },
    [onInspectionAddonSelectionChanged]
  )

  useEffect(() => {
    if (workspace) return
    const controller = new AbortController()
    void loadObOrganizationInspectorProfile(orgId, controller.signal)
      .then(profile => { if (!controller.signal.aborted) { setInspectorProfile(profile); setInspectorAvatarLoadError(false) } })
      .catch(error => { if (!controller.signal.aborted) { setInspectorProfile(null); setError(error instanceof Error ? error.message : 'Profilen kunde inte hämtas.') } })
    return () => controller.abort()
  }, [orgId, workspace])

  useEffect(() => {
    if (workspace) return
    let cancelled = false

    const loadFrozenInspectorProfile = async () => {
      if (!isInspectionLocked) {
        setFrozenInspectorProfile(null)
        return
      }

      try {
        const response = await fetch(withObOrganization(`/api/ob/inspections/${inspection.id}/frozen-inspector`, orgId), {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as FrozenInspectorApiResponse | null
        if (!response.ok || cancelled) return
        setFrozenInspectorProfile(payload?.profile ?? null)
      } catch {
        if (!cancelled) setFrozenInspectorProfile(null)
      }
    }

    void loadFrozenInspectorProfile()

    return () => {
      cancelled = true
    }
  }, [inspection.id, isInspectionLocked, workspace, orgId])

  useEffect(() => {
    let cancelled = false

    const loadInspectionAddons = async () => {
      setInspectionAddonLoading(true)
      try {
        const response = await fetch(withObOrganization(`/api/ob/inspections/${inspection.id}/addon-orders`, orgId), {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as
          | { addonOrders?: InspectionAddonOrder[]; error?: string }
          | null

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Kunde inte hämta tilläggsuppdrag för besiktningen.')
        }

        if (cancelled) return
        const rows = Array.isArray(payload?.addonOrders) ? payload.addonOrders : []
        setInspectionAddonOrders(rows)
        notifyAddonSelection(rows)

        if (resolveObInspectionProfile(inspection) !== 'status' && (inspection.scope ?? '').trim() === '' && rows.length > 0) {
          const selectedFromSnapshot = formatScopeLabels(
            rows
              .filter(row => row.is_selected)
              .map(row => row.addon_name_snapshot)
              .filter(Boolean)
          )
          if (selectedFromSnapshot !== '') {
            setInspForm(prev => ({ ...prev, scope: selectedFromSnapshot }))
          }
        }
      } catch (addonError) {
        console.error('Kunde inte hämta tilläggsuppdrag för Grunddata:', addonError)
        if (!cancelled) {
          setInspectionAddonOrders([])
          notifyAddonSelection([])
        }
      } finally {
        if (!cancelled) setInspectionAddonLoading(false)
      }
    }

    void loadInspectionAddons()

    return () => {
      cancelled = true
    }
  }, [inspection.id, inspection.scope, notifyAddonSelection, orgId])

  // Hjälpare: spara property-fält
  const saveProperty = (patch: Partial<Property>) => {
    if (isInspectionLocked) return Promise.resolve(false)
    setPendingProp(count => count + 1)
    return enqueueObGrunddataWrite(inspection.id, async () => {
    if (latestInspection.current.id !== inspection.id || latestInspection.current.locked_at) return false
    setError(null)

    const payload = {
      inspection_id: inspection.id,
      ...patch,
    }

    const obSnapshotClient = supabase as unknown as SupabaseUpsertClient
    const { error: updErr } = await Promise.resolve(obSnapshotClient
      .from('ob_property_snapshot')
      .upsert(payload, { onConflict: 'inspection_id' }))
      .catch(error => ({ error }))

    recordObGrunddataWriteResult(inspection.id, Object.keys(patch).map(key => `property:${key}`), Boolean(updErr))

    if (updErr) {
      console.error(updErr)
      setError('Kunde inte spara objektets uppgifter i ÖB.')
      return false
    }

    if (latestInspection.current.id !== inspection.id) return false
    latestProperty.current = { ...latestProperty.current, ...patch }
    acknowledgeProperty(formValues(patch))
    onPropertyUpdated?.(latestProperty.current)
    return true
    }).finally(() => setPendingProp(count => count - 1))
  }

  // Hjälpare: spara inspection-fält
  const saveInspection = useCallback(async (
    patch: Partial<Inspection>,
    options?: { throwOnError?: boolean }
  ): Promise<Inspection | null> => {
    if (isInspectionLocked) {
      if (options?.throwOnError) throw new Error('Besiktningen ar last och kan inte redigeras.')
      return null
    }
    setPendingInsp(count => count + 1)
    return enqueueObGrunddataWrite(inspection.id, async () => {
    if (latestInspection.current.id !== inspection.id || latestInspection.current.locked_at) {
      if (options?.throwOnError) throw new Error('Besiktningen kan inte längre redigeras.')
      return null
    }
    // Recheck inside the write queue: a draft can arrive while validation or
    // an earlier save is pending, including from another tab on this device.
    if (patch.inspection_side !== undefined &&
        (resolveObInspectionProfile(latestInspection.current) === 'status') !==
        (resolveObInspectionProfile({ ...latestInspection.current, ...patch }) === 'status')) {
      const draftError = profileChangeDraftError(inspection.id)
      if (draftError) {
        setError(draftError)
        if (options?.throwOnError) throw new Error(draftError)
        return null
      }
    }
    setError(null)

    const { error: updErr, data } = await Promise.resolve(supabase
      .from('inspections')
      .update(patch)
      .eq('id', inspection.id)
      .select('*')
      .single())
      .catch(error => ({ error, data: null }))

    recordObGrunddataWriteResult(inspection.id, Object.keys(patch).map(key => `inspection:${key}`), Boolean(updErr))

    if (updErr) {
      console.error(updErr)
      setError('Kunde inte spara uppdragsuppgifterna.')
      if (options?.throwOnError) throw updErr
      return null
    }

    if (data && latestInspection.current.id === inspection.id) {
      latestInspection.current = data as Inspection
      acknowledgeInspection(formValues(patch), formValues(data))
      onInspectionUpdated?.(data as Inspection)
    }

    return (data as Inspection | null) ?? null
    }).finally(() => setPendingInsp(count => count - 1))
  }, [inspection.id, isInspectionLocked, onInspectionUpdated, acknowledgeInspection])

  const saveOrdererToInspection = (nextOrderer: typeof ordererForm) => trackObGrunddataWrite(inspection.id, async () => {
    if (isInspectionLocked) return

    const customerName = normalizeTextOrNull(nextOrderer.customer_name)
    const customerAddress = normalizeTextOrNull(nextOrderer.customer_address)
    const customerPostalCode = normalizeTextOrNull(nextOrderer.customer_postal_code)
    const customerCity = normalizeTextOrNull(nextOrderer.customer_city)
    const customerPhone = normalizeTextOrNull(nextOrderer.customer_phone)
    const customerEmail = normalizeTextOrNull(nextOrderer.customer_email)?.toLowerCase() ?? null

    if (customerEmail && !CUSTOMER_EMAIL_REGEX.test(customerEmail)) {
      setError('Ogiltig e-postadress för uppdragsgivare.')
      return
    }

    setPendingOrderer(count => count + 1)
    try {
    const clientContact = [customerPhone, customerEmail].filter(Boolean).join(' | ') || null
    const savedInspection = await saveInspection({
      client_name: customerName,
      client_contact: clientContact,
      customer_name: customerName,
      customer_address: customerAddress,
      customer_postal_code: customerPostalCode,
      customer_city: customerCity,
      customer_phone: customerPhone,
      customer_email: customerEmail,
    } as Partial<Inspection>)
    if (!savedInspection || latestInspection.current.id !== inspection.id) return

    const savedOrderer = {
      customer_name: customerName,
      customer_address: customerAddress,
      customer_postal_code: customerPostalCode,
      customer_city: customerCity,
      customer_phone: customerPhone,
      customer_email: customerEmail,
    }
    acknowledgeOrderer(nextOrderer, formValues(savedOrderer))
    latestProperty.current = { ...latestProperty.current, ...savedOrderer }
    onPropertyUpdated?.(latestProperty.current)
    } finally { setPendingOrderer(count => count - 1) }
  })

  // Autogenerera uppdragsnummer baserat på datum + löpnummer
  useEffect(() => {
    const maybeGenerateAssignmentNumber = async () => {
      if (isInspectionLocked) return
      if (!inspection.date) return
      if (isInspectionAssignmentNumberForDate(inspection.assignment_number, inspection.date)) return

      try {
        const { data, error } = await supabase
          .from('inspections')
          .select('assignment_number, date')
          .eq('date', inspection.date)
          .eq('inspection_family', 'OB')

        if (error) {
          console.error('Kunde inte generera uppdragsnummer:', error)
          return
        }

        const newNumber = getNextInspectionAssignmentNumber(inspection.date, data || [])
        if (!newNumber) return

        await saveInspection({ assignment_number: newNumber } as Partial<Inspection>)
        setInspForm(prev => ({ ...prev, assignment_number: newNumber }))
      } catch (err) {
        console.error('Fel vid generering av uppdragsnummer:', err)
      }
    }

    void maybeGenerateAssignmentNumber()
  }, [inspection.id, inspection.assignment_number, inspection.date, isInspectionLocked, saveInspection])

  // Handlers för formulärfält - spara vid blur
  const handlePropChange = (field: keyof typeof propForm, value: string) => {
    if (isInspectionLocked) return
    setPropForm(prev => ({ ...prev, [field]: value }))
  }

  const handlePropBlur = (field: keyof typeof propForm) => {
    if (isInspectionLocked) return
    const rawVal = propForm[field]
    const val = rawVal === '' ? null : rawVal

    const patch: Partial<Property> = {}
    if (field === 'cadastral_id') patch.cadastral_id = val
    if (field === 'address') patch.address = val
    if (field === 'postal_code') patch.postal_code = val
    if (field === 'city') patch.city = val
    if (field === 'municipality') patch.municipality = val
    if (field === 'owner_name') patch.owner_name = val
    if (field === 'brf_name') patch.brf_name = val
    if (field === 'apartment_number') patch.apartment_number = val
    if (field === 'apartment_holder_name') patch.apartment_holder_name = val

    if (Object.keys(patch).length > 0) void saveProperty(patch)
  }

  const handleInspChange = (field: keyof typeof inspForm, value: string) => {
    if (isInspectionLocked) return
    setInspForm(prev => ({ ...prev, [field]: value }))
  }

  const handleInspBlur = (field: keyof typeof inspForm) => {
    if (isInspectionLocked) return
    const val = inspForm[field] || null
    const patch: Partial<Inspection> = {}

    if (field === 'assignment_number') patch.assignment_number = val
    if (field === 'assignment_confirmation_delivered_date') {
      patch.assignment_confirmation_delivered_date = val
    }
    if (field === 'scope') patch.scope = val
    if (field === 'date') patch.date = val
    if (field === 'inspection_time') patch.inspection_time = val
    if (field === 'attendees') patch.attendees = val
    if (field === 'attendees_other') patch.attendees_other = val

    if (field === 'inspection_side') {
      // The type selector has a separate guarded write path.
      return
    }

    if (Object.keys(patch).length > 0) void saveInspection(patch)
  }

  const handleOrdererChange = (field: keyof typeof ordererForm, value: string) => {
    if (isInspectionLocked) return
    setOrdererForm(prev => ({ ...prev, [field]: value }))
  }

  const handleOrdererBlur = async (field: keyof typeof ordererForm) => {
    if (isInspectionLocked) return
    const normalizedValue = normalizeTextOrNull(ordererForm[field])

    if (field === 'customer_email' && normalizedValue && !CUSTOMER_EMAIL_REGEX.test(normalizedValue)) {
      setError('Ogiltig e-postadress för uppdragsgivare.')
      return
    }

    await saveOrdererToInspection(ordererForm)
  }

  // Checkboxar för omfattning
  const selectedScopeLabels = parseScopeLabels(inspForm.scope)
  const hasInspectionAddonSnapshot = inspectionAddonOrders.length > 0

  const scopeFromInspectionAddons = (rows: InspectionAddonOrder[]) =>
    formatScopeLabels(
      rows
        .filter(row => row.is_selected)
        .map(row => row.addon_name_snapshot)
        .filter(Boolean)
    )

  const handleInspectionAddonToggle = async (row: InspectionAddonOrder) => {
    if (isInspectionLocked) return
    const nextSelected = !row.is_selected
    const optimisticRows = inspectionAddonOrders.map(current =>
      current.id === row.id ? { ...current, is_selected: nextSelected } : current
    )
    setInspectionAddonOrders(optimisticRows)
    notifyAddonSelection(optimisticRows)

    try {
      const response = await fetch(withObOrganization(`/api/ob/inspections/${inspection.id}/addon-orders`, orgId), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          addon_key: row.addon_key,
          is_selected: nextSelected,
        }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { addonOrders?: InspectionAddonOrder[]; error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte uppdatera tilläggsuppdrag.')
      }

      const persistedRows = Array.isArray(payload?.addonOrders)
        ? payload.addonOrders
        : optimisticRows
      setInspectionAddonOrders(persistedRows)
      notifyAddonSelection(persistedRows)

      if (inspForm.inspection_side !== 'status') {
        const newScope = scopeFromInspectionAddons(persistedRows)
        setInspForm(prev => ({ ...prev, scope: newScope }))
        await saveInspection({ scope: newScope } as Partial<Inspection>)
      }
    } catch (addonUpdateError) {
      console.error('Kunde inte uppdatera tilläggsuppdrag:', addonUpdateError)
      setInspectionAddonOrders(prev => {
        const reverted = prev.map(current =>
          current.id === row.id ? { ...current, is_selected: row.is_selected } : current
        )
        notifyAddonSelection(reverted)
        return reverted
      }
      )
      setError(
        addonUpdateError instanceof Error
          ? addonUpdateError.message
          : 'Kunde inte uppdatera tilläggsuppdrag.'
      )
    }
  }

  const handleScopeToggle = async (label: string) => {
    if (isInspectionLocked) return
    const current = parseScopeLabels(inspForm.scope)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newScope = formatScopeLabels(next)
    setInspForm(prev => ({ ...prev, scope: newScope }))
    await saveInspection({ scope: newScope } as Partial<Inspection>)
  }

  // Checkboxar för närvarande
  const selectedAttendees = parseAttendeeLabels(inspForm.attendees)

  const handleAttendeeToggle = async (label: string) => {
    if (isInspectionLocked) return
    const current = parseAttendeeLabels(inspForm.attendees)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newAttendees = formatAttendeeLabels(next)
    setInspForm(prev => ({ ...prev, attendees: newAttendees }))
    await saveInspection({ attendees: newAttendees } as Partial<Inspection>)
  }

  // Köpar-/säljarbesiktning - radioknappar
  const handleInspectionSideChange = async (side: EditableInspectionSide) => {
    if (isInspectionLocked || changingInspectionSide || changingObjectType || side === inspForm.inspection_side) return
    setChangingInspectionSide(true)
    try {
      const crossesStatusProfile = (inspForm.inspection_side === 'status') !== (side === 'status')
      if (crossesStatusProfile) {
        const draftError = profileChangeDraftError(inspection.id)
        if (draftError) { setError(draftError); return }
        const { data: linkedAssignments, error: assignmentError } = await supabase.from('assignments')
          .select('status,accepted_at').eq('inspection_id', inspection.id)
        if (assignmentError) {
          setError('Kunde inte kontrollera uppdragsbekräftelsen. Typ av uppdrag har inte ändrats.')
          return
        }
        const assignments = linkedAssignments as Array<{ status: string; accepted_at: string | null }> | null
        if (assignments?.some(assignment => assignment.accepted_at || ['sent', 'ordered', 'booked', 'completed'].includes(assignment.status))) {
          setError('Byte till eller från statusbesiktning kräver en ny uppdragsbekräftelse. Den kopplade bekräftelsen är redan skickad eller godkänd.')
          return
        }
        let confirmation: string | null
        try {
          confirmation = await getObProfileChangeConfirmation(supabase, inspection.id, side)
        } catch {
          setError('Kunde inte kontrollera besiktningens texter. Typ av uppdrag har inte ändrats. Försök igen.')
          return
        }
        if (confirmation && !window.confirm(confirmation)) return
      }
      if (side === 'status') {
        // Preserve the current object's identity when entering STB. The marker
        // has no effect on the old OB profile if the subsequent profile save fails.
        const objectType = resolveObObjectType(inspForm.inspection_side as EditableInspectionSide, propForm.object_type)
        if (!await saveProperty({ object_type: objectType })) return
      }
      const patch: Partial<Inspection> = crossesStatusProfile
        ? getObInspectionClassification(side)
        : { inspection_side: side }

      // Om vi växlar till säljarbesiktning ska "Köpare" inte vara markerad
      if (side === 'seller') {
        const current = parseAttendeeLabels(inspForm.attendees)
        if (current.includes('Köpare')) {
          const next = current.filter(l => l !== 'Köpare')
          const newAttendees = formatAttendeeLabels(next)
          patch.attendees = newAttendees
          const saved = await saveInspection(patch)
          if (saved) setInspForm(prev => ({ ...prev, inspection_side: side, attendees: newAttendees }))
          return
        }
      }

      const saved = await saveInspection(patch)
      if (saved) setInspForm(prev => ({ ...prev, inspection_side: side }))
    } finally {
      setChangingInspectionSide(false)
    }
  }

  const handleStatusObjectTypeChange = async (objectType: ObObjectType) => {
    if (isInspectionLocked || changingObjectType || changingInspectionSide || inspForm.inspection_side !== 'status') return
    if (resolveObObjectType('status', propForm.object_type) === objectType) return
    setChangingObjectType(true)
    setError(null)
    try {
      const { data, error: assignmentError } = await supabase.from('assignments')
        .select('status,accepted_at,last_sent_at').eq('inspection_id', inspection.id)
      if (assignmentError) throw assignmentError
      const assignments = data as Array<{ status: string; accepted_at: string | null; last_sent_at: string | null }> | null
      if (assignments?.some(assignment => assignment.accepted_at || assignment.last_sent_at || ['sent', 'ordered', 'booked', 'completed'].includes(assignment.status))) {
        setError('Byte av objekttyp kräver en ny uppdragsbekräftelse. Den kopplade bekräftelsen är redan skickad eller godkänd.')
        return
      }
      // Persist before changing the visible fields. The database rechecks linked confirmations.
      if (await saveProperty({ object_type: objectType })) {
        setPropForm(prev => ({ ...prev, object_type: objectType }))
        acknowledgeProperty({ object_type: objectType })
      }
    } catch {
      setError('Kunde inte kontrollera uppdragsbekräftelsen. Objekttypen har inte ändrats. Försök igen.')
    } finally {
      setChangingObjectType(false)
    }
  }

  // Vilka närvarorutor vi ska visa: vid säljarbesiktning, ingen "Köpare"
  const attendeeOptionsToShow =
    inspForm.inspection_side === 'seller'
      ? ATTENDEE_OPTIONS.filter(opt => opt.key !== 'buyer')
      : ATTENDEE_OPTIONS

  const uploadInspectionCoverFile = async (file: File) => {
    if (isInspectionLocked) {
      setError('Besiktningen är klar. Omslagsbild kan inte ändras.')
      return false
    }

    try {
      setError(null)
      setUploadingCover(true)

      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
      const fileName = `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
      const filePath = `${inspection.id}/cover/${fileName}`

      const { error: uploadError } = await supabase.storage
        .from(COVER_IMAGE_BUCKET)
        .upload(filePath, file, { upsert: false, cacheControl: '3600' })

      if (uploadError) throw uploadError

      const saved = await saveInspection({ cover_path: filePath } as Partial<Inspection>)
      if (!saved) return false

      setInspForm(prev => ({ ...prev, cover_path: saved.cover_path ?? filePath }))

      // Earlier report snapshots may still reference the previous cover file.
      return true
    } catch (e: unknown) {
      console.error('uploadInspectionCoverFile failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ladda upp omslagsbild.')
      return false
    } finally {
      setUploadingCover(false)
    }
  }

  const handleInspectionCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      await uploadInspectionCoverFile(file)
    } finally {
      event.target.value = ''
    }
  }

  const handleInspectionCoverDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (isInspectionLocked || uploadingCover || savingInsp) return

    const file = Array.from(event.dataTransfer.files).find(candidate =>
      candidate.type.startsWith('image/')
    )
    if (!file) return

    await uploadInspectionCoverFile(file)
  }

  const hasFrozenInspectorSnapshot = isInspectionLocked && !!frozenInspectorProfile
  // A locked inspection must never briefly display today's organization card
  // while its historical snapshot is loading or unavailable.
  const inspectorCardProfile = isInspectionLocked ? frozenInspectorProfile : inspectorProfile

  const inspectorName =
    inspectorCardProfile?.full_name || inspection.inspector_name || INSPECTOR_CARD.name
  const inspectorSbrLine1 = inspectorCardProfile?.sbr_group || INSPECTOR_CARD.sbrLine1
  const inspectorSbrLine2 = inspectorCardProfile?.sbr_status || INSPECTOR_CARD.sbrLine2
  const inspectorMemberNumber = inspectorCardProfile?.membership_number || INSPECTOR_CARD.memberNumber
  const inspectorCertificationNumber = inspectorCardProfile?.certification_number ?? null
  const inspectorCertificationLines = formatCertificationDisplayLines(
    inspectorCardProfile?.certification_items
  )
  const inspectorPhone = inspectorCardProfile?.phone || INSPECTOR_CARD.phone
  const inspectorEmail = inspectorCardProfile?.email || INSPECTOR_CARD.email
  const inspectorCompany = inspectorCardProfile?.company_name || INSPECTOR_CARD.company
  const inspectorOrgNumber = inspectorCardProfile?.company_orgno || INSPECTOR_CARD.orgNumber
  const inspectorAddressLine =
    inspectorCardProfile?.company_address
      ? [
          inspectorCardProfile.company_address,
          [inspectorCardProfile.company_postal_code, inspectorCardProfile.company_city]
            .filter(Boolean)
            .join(' '),
        ]
          .filter(Boolean)
          .join(', ')
      : INSPECTOR_CARD.addressLine
  const inspectorAvatarSrc = resolvePublicMediaUrl(inspectorProfile?.avatar_path)
  const inspectionCoverSrc = resolveInspectionCoverUrl(inspForm.cover_path, value => supabase.storage.from(COVER_IMAGE_BUCKET).getPublicUrl(value).data.publicUrl)
  const buildingContext = useObBuilding()
  const isApartmentObject = resolveObObjectType(inspForm.inspection_side as EditableInspectionSide, propForm.object_type) === 'apartment'

  const objectSection = (
        <ObFormSection title="Objekt" className="ob-property-object">

          {inspForm.inspection_side === 'status' && (
            <fieldset className="min-w-0 space-y-1" disabled={isInspectionLocked || changingObjectType || changingInspectionSide} aria-busy={changingObjectType}>
              <legend className="ob-form-label">Objekttyp</legend>
              <div className="flex flex-wrap gap-x-5">
                {(['property', 'apartment'] as const).map(objectType => (
                  <label key={objectType} className="ob-form-choice">
                    <input type="radio" name={`status-object-${inspection.id}`} className="h-3 w-3"
                      checked={isApartmentObject === (objectType === 'apartment')}
                      onChange={() => void handleStatusObjectTypeChange(objectType)} />
                    <span>{objectType === 'apartment' ? 'Lägenhet' : 'Fastighet'}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-gray-500">Ange vilken del som ska besiktigas under Omfattning, till exempel badrum.</p>
            </fieldset>
          )}

          <Field
            label="Adress"
            value={propForm.address ?? ''}
            onChange={v => handlePropChange('address', v)}
            onBlur={() => handlePropBlur('address')}
            readOnly={isInspectionLocked}
          />

          <div className="ob-form-pair">
            <Field
              label="Postnummer"
              value={propForm.postal_code ?? ''}
              onChange={v => handlePropChange('postal_code', v)}
              onBlur={() => handlePropBlur('postal_code')}
              readOnly={isInspectionLocked}
            />
            <Field
              label="Ort"
              value={propForm.city ?? ''}
              onChange={v => handlePropChange('city', v)}
              onBlur={() => handlePropBlur('city')}
              readOnly={isInspectionLocked}
            />
          </div>

          <Field
            label="Kommun"
            value={propForm.municipality ?? ''}
            onChange={v => handlePropChange('municipality', v)}
            onBlur={() => handlePropBlur('municipality')}
            readOnly={isInspectionLocked}
          />

          {!isApartmentObject ? (
            <>
              <Field
                label="Fastighetsbeteckning"
                value={propForm.cadastral_id ?? ''}
                onChange={v => handlePropChange('cadastral_id', v)}
                onBlur={() => handlePropBlur('cadastral_id')}
                readOnly={isInspectionLocked}
              />

              <Field
                label="Fastighetsägare"
                value={propForm.owner_name ?? ''}
                onChange={v => handlePropChange('owner_name', v)}
                onBlur={() => handlePropBlur('owner_name')}
                readOnly={isInspectionLocked}
              />
            </>
          ) : null}

          {isApartmentObject ? (
            <>
              <Field
                label={inspForm.inspection_side === 'status' ? 'Bostadsrättsförening (om tillämpligt)' : 'Bostadsrättsförening'}
                value={propForm.brf_name ?? ''}
                onChange={v => handlePropChange('brf_name', v)}
                onBlur={() => handlePropBlur('brf_name')}
                readOnly={isInspectionLocked}
              />
              <Field
                label="Lägenhetsnummer"
                value={propForm.apartment_number ?? ''}
                onChange={v => handlePropChange('apartment_number', v)}
                onBlur={() => handlePropBlur('apartment_number')}
                readOnly={isInspectionLocked}
              />
              <Field
                label={inspForm.inspection_side === 'status' ? 'Lägenhetsinnehavare (frivilligt)' : 'Bostadsrättsinnehavare'}
                value={propForm.apartment_holder_name ?? ''}
                onChange={v => handlePropChange('apartment_holder_name', v)}
                onBlur={() => handlePropBlur('apartment_holder_name')}
                readOnly={isInspectionLocked}
              />
            </>
          ) : null}

          {workspace && <ObBuildingOverview locked={isInspectionLocked} compact />}

          {!workspace && !buildingContext?.overview.structure && <div className="space-y-2">
            <div className="ob-form-label">Omslagsbild</div>
            <div
              onDragOver={event => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onDrop={event => void handleInspectionCoverDrop(event)}
              className={`relative block h-40 w-full overflow-hidden rounded-md border border-dashed border-gray-300 bg-gray-50 ${
                isInspectionLocked ? 'opacity-70' : 'transition hover:border-gray-500'
              }`}
            >
              {inspectionCoverSrc ? (
                <img
                  src={inspectionCoverSrc}
                  alt="Omslagsbild"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center ob-form-muted">
                  Släpp en bild här eller välj Kamera/Fil
                </div>
              )}
            </div>

            <input
              ref={coverCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              disabled={isInspectionLocked || uploadingCover || savingInsp}
              onChange={e => void handleInspectionCoverUpload(e)}
            />
            <input
              ref={coverLibraryInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              disabled={isInspectionLocked || uploadingCover || savingInsp}
              onChange={e => void handleInspectionCoverUpload(e)}
            />
            {!isInspectionLocked ? (
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => coverCameraInputRef.current?.click()}
                  disabled={uploadingCover || savingInsp}
                >
                  <Camera size={20} />Ta bild
                </button>
                <button
                  type="button"
                  onClick={() => coverLibraryInputRef.current?.click()}
                  disabled={uploadingCover || savingInsp}
                >
                  <ImageIcon size={20} />Välj bild
                </button>
                <ObCoverImageBank inspectionId={inspection.id} disabled={uploadingCover || savingInsp || isInspectionLocked}
                  onSelect={uploadInspectionCoverFile} />
              </div>
            ) : null}
            {uploadingCover ? (
              <p className="ob-form-muted">Laddar upp omslagsbild...</p>
            ) : null}
            {isInspectionLocked ? (
              <p className="ob-form-muted">
                Besiktningen är klar och omslagsbilden är låst.
              </p>
            ) : null}
          </div>}
          <ObFormSaveStatus saving={savingProp} />
        </ObFormSection>
  )
  const inspectionTypeField = (
          <fieldset className="min-w-0 space-y-1" disabled={changingInspectionSide || changingObjectType} aria-busy={changingInspectionSide}>
            <legend className="ob-form-label">Typ av uppdrag</legend>
            <div className="ob-property-type-options flex flex-wrap gap-x-5">
              <label className="ob-form-choice">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'buyer'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('buyer')}
                />
                <span>Köparbesiktning</span>
              </label>
              <label className="ob-form-choice">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'seller'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('seller')}
                />
                <span>Säljarbesiktning</span>
              </label>
              <label className="ob-form-choice">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'apartment'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('apartment')}
                />
                <span>Lägenhetsbesiktning</span>
              </label>
              <label className="ob-form-choice">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'status'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('status')}
                />
                <span>Statusbesiktning</span>
              </label>
            </div>
          </fieldset>
  )
  const customerFields = (
        <>
          <Field
            label="Uppdragsgivare"
            value={ordererForm.customer_name}
            onChange={v => handleOrdererChange('customer_name', v)}
            onBlur={() => void handleOrdererBlur('customer_name')}
            placeholder="Namn"
            readOnly={isInspectionLocked}
          />

          <Field
            label="Adress"
            value={ordererForm.customer_address}
            onChange={v => handleOrdererChange('customer_address', v)}
            onBlur={() => void handleOrdererBlur('customer_address')}
            placeholder="Gatuadress"
            readOnly={isInspectionLocked}
          />

          <div className="ob-form-pair">
            <Field
              label="Postnummer"
              value={ordererForm.customer_postal_code}
              onChange={v => handleOrdererChange('customer_postal_code', v)}
              onBlur={() => void handleOrdererBlur('customer_postal_code')}
              placeholder="123 45"
              readOnly={isInspectionLocked}
            />
            <Field
              label="Ort"
              value={ordererForm.customer_city}
              onChange={v => handleOrdererChange('customer_city', v)}
              onBlur={() => void handleOrdererBlur('customer_city')}
              placeholder="Ort"
              readOnly={isInspectionLocked}
            />
          </div>

          <div className="ob-form-pair">
            <Field
              label="Telefon"
              value={ordererForm.customer_phone}
              onChange={v => handleOrdererChange('customer_phone', v)}
              onBlur={() => void handleOrdererBlur('customer_phone')}
              placeholder="Telefonnummer"
              readOnly={isInspectionLocked}
            />
            <Field
              label="E-post"
              value={ordererForm.customer_email}
              onChange={v => handleOrdererChange('customer_email', v)}
              onBlur={() => void handleOrdererBlur('customer_email')}
              placeholder="namn@epost.se"
              readOnly={isInspectionLocked}
            />
          </div>

        </>
  )
  const assignmentNumberField = (
          <Field
            label="Uppdragsnummer"
            value={inspForm.assignment_number}
            onChange={v => handleInspChange('assignment_number', v)}
            onBlur={() => handleInspBlur('assignment_number')}
            placeholder="Skapas automatiskt när datum är satt"
            readOnly
          />
  )
  const scopeFields = (
          <div className="space-y-2">
            {!workspace && <div className="ob-form-label">Omfattning</div>}
            {inspForm.inspection_side === 'status' && <Field
              label="Besiktningens omfattning"
              value={inspForm.scope}
              onChange={value => handleInspChange('scope', value)}
              onBlur={() => handleInspBlur('scope')}
              placeholder="Till exempel badrum eller hela byggnaden"
              readOnly={isInspectionLocked}
            />}
            <div className="ob-property-scope-options space-y-1">
              {inspectionAddonLoading && hasInspectionAddonSnapshot === false ? (
                <div className="ob-form-muted">Laddar omfattning...</div>
              ) : hasInspectionAddonSnapshot ? (
                inspectionAddonOrders.map(row => (
                  <label key={row.id} className="ob-form-choice">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3 w-3"
                      checked={row.is_selected}
                      disabled={isInspectionLocked}
                      onChange={() => void handleInspectionAddonToggle(row)}
                    />
                    <span>{row.addon_name_snapshot}</span>
                  </label>
                ))
              ) : inspForm.inspection_side === 'status' ? null : (
                SCOPE_OPTIONS.map(opt => (
                  <label key={opt.key} className="ob-form-choice">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-3 w-3"
                      checked={selectedScopeLabels.includes(opt.label)}
                      disabled={isInspectionLocked}
                      onChange={() => void handleScopeToggle(opt.label)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))
              )}
            </div>
          </div>
  )
  const dateFields = (
          <div className="ob-form-pair mt-3">
            <Field
              label="Besiktningsdag"
              type="date"
              value={inspForm.date ?? ''}
              onChange={v => handleInspChange('date', v)}
              onBlur={() => handleInspBlur('date')}
              readOnly={isInspectionLocked}
            />
            <Field
              label="Tid (t.ex. 09:00)"
              value={inspForm.inspection_time}
              onChange={v => handleInspChange('inspection_time', v)}
              onBlur={() => handleInspBlur('inspection_time')}
              readOnly={isInspectionLocked}
            />
          </div>
  )
  const confirmationField = (
              <Field
                label="Uppdragsbekräftelse överlämnad"
                type="date"
                value={inspForm.assignment_confirmation_delivered_date}
                onChange={v =>
                  handleInspChange('assignment_confirmation_delivered_date', v)
                }
                onBlur={() =>
                  handleInspBlur('assignment_confirmation_delivered_date')
                }
                readOnly={isInspectionLocked}
              />
  )
  const attendeesFields = (
          <div className="space-y-3">
            {!workspace && <div className="ob-form-label">Närvarande</div>}

            <div className="ob-property-attendee-options space-y-1">
              {attendeeOptionsToShow.map(opt => (
                <label key={opt.key} className="ob-form-choice">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3 w-3"
                    checked={selectedAttendees.includes(opt.label)}
                    disabled={isInspectionLocked}
                    onChange={() => void handleAttendeeToggle(opt.label)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>

              <div className="space-y-1">
                <div className="ob-form-label">
                  Övriga närvarande (namn och roll)
                </div>
                <DebouncedTextarea
                  aria-label="Övriga närvarande (namn och roll)"
                  className={`w-full rounded-md border px-3 py-2 text-xs ${
                    isInspectionLocked ? 'bg-gray-100 text-gray-600' : ''
                  }`}
                  rows={2}
                  placeholder="T.ex. Anna Andersson (mäklare), Kalle Karlsson (besiktningsman säljare)"
                  value={inspForm.attendees_other}
                  disabled={isInspectionLocked}
                  draftKey={`ob:${inspection.id}:grunddata:attendees_other`}
                  onValueChange={value => handleInspChange('attendees_other', value)}
                  onSave={async value => {
                    await saveInspection(
                      { attendees_other: value || null },
                      { throwOnError: true }
                    )
                  }}
                />
              </div>

              {!workspace && confirmationField}

              <div className="mt-1 ob-form-muted">
                {inspForm.attendees && inspForm.attendees.trim() !== '' ? (
                  <>Registrerade närvarande (huvudroller): {inspForm.attendees}</>
                ) : (
                  'Inga huvudroller markerade ännu.'
              )}
            </div>
          </div>
  )
  const inspectorSection = (
        <section className="ob-form-section">
          <h2>Besiktningsman</h2>

          {inspectorAvatarSrc && !inspectorAvatarLoadError ? (
            <img
              src={inspectorAvatarSrc}
              alt="Bild på besiktningsman"
              className="h-20 w-20 rounded-full border border-gray-300 object-cover"
              onError={() => setInspectorAvatarLoadError(true)}
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gray-300 bg-gray-100 ob-form-muted">
              Ingen bild
            </div>
          )}

          <div className="space-y-1 text-sm text-gray-800">
            <div className="font-semibold">{inspectorName}</div>
            {inspectorCertificationLines.length > 0 ? (
              inspectorCertificationLines.map((line) => (
                <div key={line} className="ob-form-muted">
                  {line}
                </div>
              ))
            ) : (
              <>
                <div className="ob-form-muted">{inspectorSbrLine1}</div>
                <div className="ob-form-muted">{inspectorSbrLine2}</div>

                <div className="mt-2 ob-form-muted">Medlemsnummer: {inspectorMemberNumber}</div>
                {inspectorCertificationNumber ? (
                  <div className="ob-form-muted">
                    Certifieringsnummer: {inspectorCertificationNumber}
                  </div>
                ) : null}
              </>
            )}
            <div className="ob-form-muted">Telefon: {inspectorPhone}</div>
            <div className="ob-form-muted">E-post: {inspectorEmail}</div>

            <div className="mt-2 ob-form-muted">{inspectorCompany}</div>
            <div className="ob-form-muted">Org.nr: {inspectorOrgNumber}</div>
            <div className="ob-form-muted">{inspectorAddressLine}</div>
          </div>

          <p className="mt-2 ob-form-muted">
            {isInspectionLocked
              ? hasFrozenInspectorSnapshot
                ? 'Uppgifterna är låsta och hämtas från senaste sparade utlåtandeversion.'
                : 'Besiktningen är låst. Fryst besiktningsmannasnapshot saknas för denna äldre version.'
              : 'Uppgifterna hämtas från din personliga profil och företagsprofilen i besiktningens organisation.'}
          </p>
        </section>
  )

  return (
    <div className={`ob-form-root space-y-4${workspace ? ' ob-property-workspace ob-form-compact' : ''}`}>
      {isInspectionLocked ? (
        <div role="status" className="ob-form-notice">
          Besiktningen är låst. Grunddata visas i läsläge.
        </div>
      ) : null}
      {error && <p role="alert" className="ob-form-error">{error}</p>}
      {!workspace && <ObBuildingOverview locked={isInspectionLocked} />}
      <div className="ob-form-columns">
        {objectSection}
        {workspace ? <>
          <ObFormSection title="Uppdragsgivare" className="ob-property-customer">
            {customerFields}
            <ObFormSaveStatus saving={savingOrderer} />
          </ObFormSection>
          <ObFormSection title="Besiktningsuppdrag" className="ob-property-assignment">
            {inspectionTypeField}
            {dateFields}
            {assignmentNumberField}
            {confirmationField}
            <ObFormSaveStatus saving={savingInsp} />
          </ObFormSection>
          <div className="ob-property-details">
            <ObFormSection title="Omfattning">
              {scopeFields}
            </ObFormSection>
            <ObFormSection title="Närvarande">
              {attendeesFields}
            </ObFormSection>
          </div>
        </> : <>
          <section className="ob-form-section">
            <h2>Uppdragsgivare & besiktningsuppdrag</h2>
            {inspectionTypeField}
            {customerFields}
            {assignmentNumberField}
            {scopeFields}
            {dateFields}
            {attendeesFields}
            <ObFormSaveStatus saving={savingInsp || savingOrderer} />
          </section>
          {inspectorSection}
        </>}
      </div>
    </div>
  )
}

/** Enkel field-komponent för att slippa upprepning */
function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  multiline,
  readOnly = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: 'text' | 'date'
  multiline?: boolean
  readOnly?: boolean
}) {
  const id = useId()
  return (
    <ObFormField label={label} id={id}>
      {multiline ? (
        <DebouncedTextarea
          id={id}
          className={`w-full rounded-md border px-3 py-2 text-sm ${readOnly ? 'bg-gray-100 text-gray-600' : ''}`}
          value={value}
          onValueChange={onChange}
          onSave={nextValue => {
            onChange(nextValue)
            onBlur?.()
          }}
          placeholder={placeholder}
          rows={3}
          readOnly={readOnly}
          disabled={readOnly}
        />
      ) : (
        <input
          id={id}
          type={type}
          className={`w-full rounded-md border px-3 py-2 text-sm ${readOnly ? 'bg-gray-100 text-gray-600' : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          readOnly={readOnly}
          disabled={readOnly}
        />
      )}
    </ObFormField>
  )
}

