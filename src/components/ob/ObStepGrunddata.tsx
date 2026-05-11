'use client'

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'
import { formatCertificationDisplayLines } from '@/lib/certifications/display'
import type { InspectorCertificationListItem } from '@/lib/certifications/profileSummary'
import {
  getNextInspectionAssignmentNumber,
  isInspectionAssignmentNumberForDate,
} from '@/lib/inspections/assignmentNumber'
import DebouncedTextarea from './DebouncedTextarea'

export type ObInspection = Tables<'inspections'>

type BaseProperty = Tables<'properties'>
type Property = BaseProperty & {
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
type InspectionSide = Inspection['inspection_side'] // typiskt: 'buyer' | 'seller' | null
type EditableInspectionSide = 'buyer' | 'seller' | 'apartment'
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

function resolveInspectionImageUrl(path: string | null | undefined) {
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

  return `${base}/storage/v1/object/public/${COVER_IMAGE_BUCKET}/${path}`
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

function normalizeInspectionSide(value: InspectionSide | string | null | undefined): EditableInspectionSide {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (normalized.includes('sell') || normalized.includes('salj')) return 'seller'
  if (
    normalized.includes('apt') ||
    normalized.includes('apartment') ||
    normalized.includes('lagenhet')
  ) {
    return 'apartment'
  }
  return 'buyer'
}

export default function ObStepGrunddata({
  property,
  inspection,
  onPropertyUpdated,
  onInspectionUpdated,
  onInspectionAddonSelectionChanged,
}: ObStepGrunddataProps) {
  // Lokalt formulär-state - vi utgår från inkommande props
  const [propForm, setPropForm] = useState({
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

  const [inspForm, setInspForm] = useState({
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
    inspection_side: normalizeInspectionSide(inspection.inspection_side),
  })
  const [ordererForm, setOrdererForm] = useState({
    customer_name: property.customer_name ?? inspection.client_name ?? '',
    customer_address: property.customer_address ?? '',
    customer_postal_code: property.customer_postal_code ?? '',
    customer_city: property.customer_city ?? '',
    customer_phone: property.customer_phone ?? '',
    customer_email: property.customer_email ?? '',
  })

  const [savingProp, setSavingProp] = useState(false)
  const [savingInsp, setSavingInsp] = useState(false)
  const [savingOrderer, setSavingOrderer] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

  // Om vi får nya props (t.ex. efter save utifrån) uppdaterar vi lokalt state
  useEffect(() => {
    setPropForm({
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
  }, [property])

  useEffect(() => {
    setInspForm({
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
      inspection_side: normalizeInspectionSide(inspection.inspection_side),
    })
  }, [inspection])

  useEffect(() => {
    setOrdererForm({
      customer_name: property.customer_name ?? inspection.client_name ?? '',
      customer_address: property.customer_address ?? '',
      customer_postal_code: property.customer_postal_code ?? '',
      customer_city: property.customer_city ?? '',
      customer_phone: property.customer_phone ?? '',
      customer_email: property.customer_email ?? '',
    })
  }, [property, inspection.client_name])

  useEffect(() => {
    let cancelled = false

    const loadInspectorProfile = async () => {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser()

      if (userError || !user || cancelled) return

      const { data, error: profileError } = await supabase
        .from('profiles')
        .select(
          'full_name,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path'
        )
        .eq('id', user.id)
        .maybeSingle()

      if (profileError || !data || cancelled) return

      const { summary } = await resolveInspectorCertificationSummary(supabase, {
        profileId: user.id,
      })

      if (cancelled) return
      setInspectorProfile({
        full_name: data.full_name ?? null,
        sbr_group: summary.sbr_group,
        sbr_status: summary.sbr_status,
        membership_number: summary.membership_number,
        certification_number: summary.certification_number,
        certification_items: summary.all_selected_items,
        phone: data.phone ?? null,
        email: data.email ?? null,
        company_name: data.company_name ?? null,
        company_orgno: data.company_orgno ?? null,
        company_address: data.company_address ?? null,
        company_postal_code: data.company_postal_code ?? null,
        company_city: data.company_city ?? null,
        avatar_path: data.avatar_path ?? null,
      })
    }

    void loadInspectorProfile()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadFrozenInspectorProfile = async () => {
      if (!isInspectionLocked) {
        setFrozenInspectorProfile(null)
        return
      }

      try {
        const response = await fetch(`/api/ob/inspections/${inspection.id}/frozen-inspector`, {
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
  }, [inspection.id, isInspectionLocked])

  useEffect(() => {
    let cancelled = false

    const loadInspectionAddons = async () => {
      setInspectionAddonLoading(true)
      try {
        const response = await fetch(`/api/ob/inspections/${inspection.id}/addon-orders`, {
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

        if ((inspection.scope ?? '').trim() === '' && rows.length > 0) {
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
  }, [inspection.id, inspection.scope, notifyAddonSelection])

  // Hjälpare: spara property-fält
  const saveProperty = async (patch: Partial<Property>) => {
    if (isInspectionLocked) return
    setError(null)
    setSavingProp(true)

    const payload = {
      inspection_id: inspection.id,
      ...patch,
    }

    const obSnapshotClient = supabase as unknown as SupabaseUpsertClient
    const { error: updErr } = await obSnapshotClient
      .from('ob_property_snapshot')
      .upsert(payload, { onConflict: 'inspection_id' })

    setSavingProp(false)

    if (updErr) {
      console.error(updErr)
      setError('Kunde inte spara objektets uppgifter i ÖB.')
      return
    }

    if (onPropertyUpdated) {
      onPropertyUpdated({ ...property, ...patch } as Property)
    }
  }

  // Hjälpare: spara inspection-fält
  const saveInspection = useCallback(async (patch: Partial<Inspection>): Promise<Inspection | null> => {
    if (isInspectionLocked) return null
    setError(null)
    setSavingInsp(true)

    const { error: updErr, data } = await supabase
      .from('inspections')
      .update(patch)
      .eq('id', inspection.id)
      .select('*')
      .single()

    setSavingInsp(false)

    if (updErr) {
      console.error(updErr)
      setError('Kunde inte spara uppdragsuppgifterna.')
      return null
    }

    if (data && onInspectionUpdated) {
      onInspectionUpdated(data as Inspection)
    }

    return (data as Inspection | null) ?? null
  }, [inspection.id, isInspectionLocked, onInspectionUpdated])

  const saveOrdererToAssignment = async (
    patch: Partial<{
      customer_name: string | null
      customer_address: string | null
      customer_postal_code: string | null
      customer_city: string | null
      customer_phone: string | null
      customer_email: string | null
    }>
  ) => {
    if (isInspectionLocked) return false
    if (!property.assignment_id) return false

    setError(null)
    setSavingOrderer(true)

    try {
      const response = await fetch(`/api/ob/assignments/${property.assignment_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const payload = (await response.json().catch(() => null)) as
        | { assignment?: Record<string, unknown>; error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte spara uppdragsgivarens uppgifter.')
      }

      const pickAssignmentValue = (
        field:
          | 'customer_name'
          | 'customer_address'
          | 'customer_postal_code'
          | 'customer_city'
          | 'customer_phone'
          | 'customer_email',
        fallback: string | null
      ) => {
        const serverValue = payload?.assignment?.[field]
        if (typeof serverValue === 'string') return serverValue
        if (serverValue === null) return null
        if (field in patch) return patch[field] ?? null
        return fallback
      }

      const nextPropertyPatch: Partial<Property> = {
        assignment_id: property.assignment_id,
        customer_name: pickAssignmentValue('customer_name', property.customer_name),
        customer_address: pickAssignmentValue('customer_address', property.customer_address),
        customer_postal_code: pickAssignmentValue(
          'customer_postal_code',
          property.customer_postal_code
        ),
        customer_city: pickAssignmentValue('customer_city', property.customer_city),
        customer_phone: pickAssignmentValue('customer_phone', property.customer_phone),
        customer_email: pickAssignmentValue('customer_email', property.customer_email),
      }

      if (onPropertyUpdated) {
        onPropertyUpdated({ ...property, ...nextPropertyPatch } as Property)
      }

      return true
    } catch (assignmentError) {
      console.error('Kunde inte spara uppdragsgivare till uppdragsbekräftelsen:', assignmentError)
      setError(
        assignmentError instanceof Error
          ? assignmentError.message
          : 'Kunde inte spara uppdragsgivarens uppgifter.'
      )
      return false
    } finally {
      setSavingOrderer(false)
    }
  }

  const saveOrdererFallbackToInspection = async (nextOrderer: typeof ordererForm) => {
    if (isInspectionLocked) return
    const customerName = normalizeTextOrNull(nextOrderer.customer_name)
    const customerPhone = normalizeTextOrNull(nextOrderer.customer_phone)
    const customerEmail = normalizeTextOrNull(nextOrderer.customer_email)

    if (customerEmail && !CUSTOMER_EMAIL_REGEX.test(customerEmail)) {
      setError('Ogiltig e-postadress för uppdragsgivare.')
      return
    }

    const clientContact = [customerPhone, customerEmail].filter(Boolean).join(' | ') || null
    const savedInspection = await saveInspection({
      client_name: customerName,
      client_contact: clientContact,
    } as Partial<Inspection>)

    if (!savedInspection || !onPropertyUpdated) return

    onPropertyUpdated({
      ...property,
      customer_name: customerName,
      customer_phone: customerPhone,
      customer_email: customerEmail,
    } as Property)
  }

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
      patch.inspection_side = (val as EditableInspectionSide) as InspectionSide
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

    if (property.assignment_id) {
      const assignmentPatch: Partial<{
        customer_name: string | null
        customer_address: string | null
        customer_postal_code: string | null
        customer_city: string | null
        customer_phone: string | null
        customer_email: string | null
      }> = {
        [field]: normalizedValue,
      }
      const saved = await saveOrdererToAssignment(assignmentPatch)
      if (!saved) return

      if (field === 'customer_name') {
        await saveInspection({ client_name: normalizedValue } as Partial<Inspection>)
      }
      if (field === 'customer_phone' || field === 'customer_email') {
        const customerPhone =
          field === 'customer_phone'
            ? normalizedValue
            : normalizeTextOrNull(ordererForm.customer_phone)
        const customerEmail =
          field === 'customer_email'
            ? normalizedValue
            : normalizeTextOrNull(ordererForm.customer_email)
        const clientContact = [customerPhone, customerEmail].filter(Boolean).join(' | ') || null
        await saveInspection({ client_contact: clientContact } as Partial<Inspection>)
      }
      return
    }

    if (field === 'customer_name' || field === 'customer_phone' || field === 'customer_email') {
      await saveOrdererFallbackToInspection({
        ...ordererForm,
        [field]: ordererForm[field],
      })
    }
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
      const response = await fetch(`/api/ob/inspections/${inspection.id}/addon-orders`, {
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

      const newScope = scopeFromInspectionAddons(persistedRows)
      setInspForm(prev => ({ ...prev, scope: newScope }))
      await saveInspection({ scope: newScope } as Partial<Inspection>)
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
    if (isInspectionLocked) return
    const patch: Partial<Inspection> = { inspection_side: side as InspectionSide }

    // Om vi växlar till säljarbesiktning ska "Köpare" inte vara markerad
    if (side === 'seller') {
      const current = parseAttendeeLabels(inspForm.attendees)
      if (current.includes('Köpare')) {
        const next = current.filter(l => l !== 'Köpare')
        const newAttendees = formatAttendeeLabels(next)
        patch.attendees = newAttendees
        setInspForm(prev => ({
          ...prev,
          inspection_side: side,
          attendees: newAttendees,
        }))
        await saveInspection(patch)
        return
      }
    }

    setInspForm(prev => ({ ...prev, inspection_side: side }))
    await saveInspection(patch)
  }

  // Vilka närvarorutor vi ska visa: vid säljarbesiktning, ingen "Köpare"
  const attendeeOptionsToShow =
    inspForm.inspection_side === 'seller'
      ? ATTENDEE_OPTIONS.filter(opt => opt.key !== 'buyer')
      : ATTENDEE_OPTIONS

  const hasLinkedAssignment = !!property.assignment_id

  const uploadInspectionCoverFile = async (file: File) => {
    if (isInspectionLocked) {
      setError('Besiktningen är klar. Omslagsbild kan inte ändras.')
      return
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

      const previousPath = inspForm.cover_path || null
      const saved = await saveInspection({ cover_path: filePath } as Partial<Inspection>)
      if (!saved) return

      setInspForm(prev => ({ ...prev, cover_path: saved.cover_path ?? filePath }))

      if (
        previousPath &&
        previousPath !== filePath &&
        !previousPath.startsWith('http://') &&
        !previousPath.startsWith('https://') &&
        !previousPath.startsWith('/')
      ) {
        const { error: removeError } = await supabase.storage
          .from(COVER_IMAGE_BUCKET)
          .remove([previousPath])
        if (removeError) {
          console.warn('Kunde inte ta bort tidigare omslagsbild:', removeError.message)
        }
      }
    } catch (e: unknown) {
      console.error('uploadInspectionCoverFile failed:', e)
      setError(e instanceof Error ? e.message : 'Kunde inte ladda upp omslagsbild.')
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
  const inspectorCardProfile = hasFrozenInspectorSnapshot ? frozenInspectorProfile : inspectorProfile

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
  const inspectionCoverSrc = resolveInspectionImageUrl(inspForm.cover_path || null)

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
        Grunduppgifter för objekt, uppdragsgivare och besiktningsman. Ändringar sparas
        automatiskt när du lämnar ett fält. Uppdragsnummer skapas automatiskt när
        besiktningsdatum är satt.
      </div>
      {isInspectionLocked ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Besiktningen är låst. Grunddata visas i läsläge.
        </div>
      ) : null}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Kolumn 1: Objekt --- */}
        <section className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Objekt</h2>

          <Field
            label="Adress"
            value={propForm.address ?? ''}
            onChange={v => handlePropChange('address', v)}
            onBlur={() => handlePropBlur('address')}
            readOnly={isInspectionLocked}
          />

          <div className="grid grid-cols-2 gap-3">
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

          {inspForm.inspection_side !== 'apartment' ? (
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

          {inspForm.inspection_side === 'apartment' ? (
            <>
              <Field
                label="Bostadsrättsförening"
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
                label="Bostadsrättsinnehavare"
                value={propForm.apartment_holder_name ?? ''}
                onChange={v => handlePropChange('apartment_holder_name', v)}
                onBlur={() => handlePropBlur('apartment_holder_name')}
                readOnly={isInspectionLocked}
              />
            </>
          ) : null}

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-600">Omslagsbild</div>
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
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
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
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                  disabled={uploadingCover || savingInsp}
                >
                  Kamera
                </button>
                <button
                  type="button"
                  onClick={() => coverLibraryInputRef.current?.click()}
                  className="rounded-full border border-gray-300 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-800 hover:bg-gray-50"
                  disabled={uploadingCover || savingInsp}
                >
                  Fil
                </button>
              </div>
            ) : null}
            {uploadingCover ? (
              <p className="text-[11px] text-gray-400">Laddar upp omslagsbild...</p>
            ) : null}
            {isInspectionLocked ? (
              <p className="text-[11px] text-gray-500">
                Besiktningen är klar och omslagsbilden är låst.
              </p>
            ) : null}
          </div>


          {savingProp && <p className="mt-1 text-[11px] text-gray-400">Sparar objekt...</p>}
        </section>

        {/* --- Kolumn 2: Uppdragsgivare & besiktningsuppdrag --- */}
        <section className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">
            Uppdragsgivare & besiktningsuppdrag
          </h2>

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600">Typ av uppdrag</div>
            <div className="flex flex-wrap gap-4 text-xs text-gray-700">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'buyer'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('buyer')}
                />
                <span>Köparbesiktning</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'seller'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('seller')}
                />
                <span>Säljarbesiktning</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'apartment'}
                  disabled={isInspectionLocked}
                  onChange={() => void handleInspectionSideChange('apartment')}
                />
                <span>Lägenhetsbesiktning</span>
              </label>
            </div>
          </div>

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
            readOnly={isInspectionLocked || !hasLinkedAssignment}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Postnummer"
              value={ordererForm.customer_postal_code}
              onChange={v => handleOrdererChange('customer_postal_code', v)}
              onBlur={() => void handleOrdererBlur('customer_postal_code')}
              placeholder="123 45"
              readOnly={isInspectionLocked || !hasLinkedAssignment}
            />
            <Field
              label="Ort"
              value={ordererForm.customer_city}
              onChange={v => handleOrdererChange('customer_city', v)}
              onBlur={() => void handleOrdererBlur('customer_city')}
              placeholder="Ort"
              readOnly={isInspectionLocked || !hasLinkedAssignment}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          {!hasLinkedAssignment ? (
            <div className="text-[11px] text-gray-500">
              Adress, postnummer och ort för uppdragsgivare kan redigeras när besiktningen är kopplad
              till en uppdragsbekräftelse.
            </div>
          ) : null}

          <Field
            label="Uppdragsnummer"
            value={inspForm.assignment_number}
            onChange={v => handleInspChange('assignment_number', v)}
            onBlur={() => handleInspBlur('assignment_number')}
            placeholder="Skapas automatiskt när datum är satt"
            readOnly
          />

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-600">Omfattning</div>
            <div className="space-y-1">
              {inspectionAddonLoading && hasInspectionAddonSnapshot === false ? (
                <div className="text-xs text-gray-500">Laddar omfattning...</div>
              ) : hasInspectionAddonSnapshot ? (
                inspectionAddonOrders.map(row => (
                  <label key={row.id} className="flex items-start gap-2 text-xs text-gray-700">
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
              ) : (
                SCOPE_OPTIONS.map(opt => (
                  <label key={opt.key} className="flex items-start gap-2 text-xs text-gray-700">
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

          <div className="grid grid-cols-2 gap-3 mt-3">
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

          <div className="mt-3 space-y-3">
            <div className="text-xs font-medium text-gray-600">Närvarande</div>

            <div className="space-y-1">
              {attendeeOptionsToShow.map(opt => (
                <label key={opt.key} className="flex items-start gap-2 text-xs text-gray-700">
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
                <div className="text-xs font-medium text-gray-600">
                  Övriga närvarande (namn och roll)
                </div>
                <DebouncedTextarea
                  className={`w-full rounded-md border px-3 py-2 text-xs ${
                    isInspectionLocked ? 'bg-gray-100 text-gray-600' : ''
                  }`}
                  rows={2}
                  placeholder="T.ex. Anna Andersson (mäklare), Kalle Karlsson (besiktningsman säljare)"
                  value={inspForm.attendees_other}
                  disabled={isInspectionLocked}
                  onValueChange={value => handleInspChange('attendees_other', value)}
                  onSave={value => void saveInspection({ attendees_other: value || null })}
                />
              </div>

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

              <div className="mt-1 text-[11px] text-gray-500">
                {inspForm.attendees && inspForm.attendees.trim() !== '' ? (
                  <>Registrerade närvarande (huvudroller): {inspForm.attendees}</>
                ) : (
                  'Inga huvudroller markerade ännu.'
              )}
            </div>
          </div>

          {(savingInsp || savingOrderer) && (
            <p className="mt-1 text-[11px] text-gray-400">Sparar uppdrag...</p>
          )}
        </section>

        {/* --- Kolumn 3: Besiktningsman (read-only) --- */}
        <section className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Besiktningsman</h2>

          {inspectorAvatarSrc && !inspectorAvatarLoadError ? (
            <img
              src={inspectorAvatarSrc}
              alt="Bild på besiktningsman"
              className="h-20 w-20 rounded-full border border-gray-300 object-cover"
              onError={() => setInspectorAvatarLoadError(true)}
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-gray-300 bg-gray-100 text-xs text-gray-500">
              Ingen bild
            </div>
          )}

          <div className="space-y-1 text-sm text-gray-800">
            <div className="font-semibold">{inspectorName}</div>
            {inspectorCertificationLines.length > 0 ? (
              inspectorCertificationLines.map((line) => (
                <div key={line} className="text-xs text-gray-600">
                  {line}
                </div>
              ))
            ) : (
              <>
                <div className="text-xs text-gray-600">{inspectorSbrLine1}</div>
                <div className="text-xs text-gray-600">{inspectorSbrLine2}</div>

                <div className="mt-2 text-xs text-gray-600">Medlemsnummer: {inspectorMemberNumber}</div>
                {inspectorCertificationNumber ? (
                  <div className="text-xs text-gray-600">
                    Certifieringsnummer: {inspectorCertificationNumber}
                  </div>
                ) : null}
              </>
            )}
            <div className="text-xs text-gray-600">Telefon: {inspectorPhone}</div>
            <div className="text-xs text-gray-600">E-post: {inspectorEmail}</div>

            <div className="mt-2 text-xs text-gray-600">{inspectorCompany}</div>
            <div className="text-xs text-gray-600">Org.nr: {inspectorOrgNumber}</div>
            <div className="text-xs text-gray-600">{inspectorAddressLine}</div>
          </div>

          <p className="mt-2 text-xs text-gray-600">
            {isInspectionLocked
              ? hasFrozenInspectorSnapshot
                ? 'Uppgifterna är låsta och hämtas från senaste sparade utlåtandeversion.'
                : 'Besiktningen är låst. Fryst besiktningsmannasnapshot saknas för denna äldre version.'
              : 'Uppgifterna hämtas från den inloggade besiktningsmannens profil.'}
          </p>
        </section>
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
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-gray-600">{label}</div>
      {multiline ? (
        <DebouncedTextarea
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
    </div>
  )
}

