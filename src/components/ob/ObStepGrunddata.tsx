'use client'

import { useEffect, useState, type ChangeEvent } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'

export type ObInspection = Tables<'inspections'>

type Property = Tables<'properties'>
type Inspection = ObInspection
type InspectionSide = Inspection['inspection_side'] // typiskt: 'buyer' | 'seller' | null
type InspectorProfile = {
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
}

interface ObStepGrunddataProps {
  property: Property
  inspection: ObInspection
  onPropertyUpdated?: (p: Property) => void
  onInspectionUpdated?: (i: ObInspection) => void
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

// Ägandeform-alternativ
const TENURE_OPTIONS: { value: NonNullable<Property['tenure_type']>; label: string }[] =
  [
    { value: 'freehold', label: 'Äganderätt' },
    { value: 'bostadsratt', label: 'Bostadsrätt' },
  ]

// Typ av objekt
const DWELLING_OPTIONS: {
  value: NonNullable<Property['dwelling_type']>
  label: string
}[] = [
  { value: 'house', label: 'Hus (villa/radhus/parhus)' },
  { value: 'apartment', label: 'Lägenhet' },
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

export default function ObStepGrunddata({
  property,
  inspection,
  onPropertyUpdated,
  onInspectionUpdated,
}: ObStepGrunddataProps) {
  // Lokalt formulär-state - vi utgår från inkommande props
  const [propForm, setPropForm] = useState({
    cadastral_id: property.cadastral_id ?? '',
    address: property.address ?? '',
    postal_code: property.postal_code ?? '',
    city: property.city ?? '',
    municipality: property.municipality ?? '',
    owner_name: property.owner_name ?? '',
    tenure_type: property.tenure_type ?? null,
    dwelling_type: property.dwelling_type ?? null,
  })

  const [inspForm, setInspForm] = useState({
    status: normalizeInspectionStatus(inspection.status),
    cover_path: inspection.cover_path ?? '',
    client_name: inspection.client_name ?? '',
    assignment_number: inspection.assignment_number ?? '',
    assignment_confirmation_delivered_date:
      inspection.assignment_confirmation_delivered_date ?? '',
    scope: inspection.scope ?? '',
    date: inspection.date ?? '',
    inspection_time: inspection.inspection_time ?? '',
    attendees: inspection.attendees ?? '',
    attendees_other: inspection.attendees_other ?? '',
    inspection_side: (inspection.inspection_side ?? 'buyer') as NonNullable<InspectionSide>,
  })

  const [savingProp, setSavingProp] = useState(false)
  const [savingInsp, setSavingInsp] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inspectorProfile, setInspectorProfile] = useState<InspectorProfile | null>(null)
  const [inspectorAvatarLoadError, setInspectorAvatarLoadError] = useState(false)
  const [inspectionAddonOrders, setInspectionAddonOrders] = useState<InspectionAddonOrder[]>([])
  const [inspectionAddonLoading, setInspectionAddonLoading] = useState(false)

  // Om vi får nya props (t.ex. efter save utifrån) uppdaterar vi lokalt state
  useEffect(() => {
    setPropForm({
      cadastral_id: property.cadastral_id ?? '',
      address: property.address ?? '',
      postal_code: property.postal_code ?? '',
      city: property.city ?? '',
      municipality: property.municipality ?? '',
      owner_name: property.owner_name ?? '',
      tenure_type: property.tenure_type ?? null,
      dwelling_type: property.dwelling_type ?? null,
    })
  }, [property])

  useEffect(() => {
    setInspForm({
      status: normalizeInspectionStatus(inspection.status),
      cover_path: inspection.cover_path ?? '',
      client_name: inspection.client_name ?? '',
      assignment_number: inspection.assignment_number ?? '',
      assignment_confirmation_delivered_date:
        inspection.assignment_confirmation_delivered_date ?? '',
      scope: inspection.scope ?? '',
      date: inspection.date ?? '',
      inspection_time: inspection.inspection_time ?? '',
      attendees: inspection.attendees ?? '',
      attendees_other: inspection.attendees_other ?? '',
      inspection_side: (inspection.inspection_side ?? 'buyer') as NonNullable<InspectionSide>,
    })
  }, [inspection])

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
          'full_name,sbr_group,sbr_status,membership_number,certification_number,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path'
        )
        .eq('id', user.id)
        .maybeSingle()

      if (profileError || !data || cancelled) return

      setInspectorProfile(data as InspectorProfile)
    }

    void loadInspectorProfile()

    return () => {
      cancelled = true
    }
  }, [])

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
        if (!cancelled) setInspectionAddonOrders([])
      } finally {
        if (!cancelled) setInspectionAddonLoading(false)
      }
    }

    void loadInspectionAddons()

    return () => {
      cancelled = true
    }
  }, [inspection.id, inspection.scope])

  // Hjälpare: spara property-fält
  const saveProperty = async (patch: Partial<Property>) => {
    setError(null)
    setSavingProp(true)

    const payload = {
      inspection_id: inspection.id,
      ...patch,
    }

    const { error: updErr } = await (supabase as any)
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
  const saveInspection = async (patch: Partial<Inspection>): Promise<Inspection | null> => {
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
  }

  // Autogenerera uppdragsnummer baserat på datum + löpnummer
  useEffect(() => {
    const maybeGenerateAssignmentNumber = async () => {
      if (inspection.assignment_number && inspection.assignment_number !== '') return
      if (!inspection.date) return

      const baseDate = inspection.date // YYYY-MM-DD
      const parts = baseDate.split('-')
      if (parts.length !== 3) return

      const [year, month, day] = parts
      if (!year || !month || !day) return

      const dateKey = `${year}-${month}${day}`

      try {
        const { data, error } = await supabase
          .from('inspections')
          .select('assignment_number, date')
          .eq('date', baseDate)

        if (error) {
          console.error('Kunde inte generera uppdragsnummer:', error)
          return
        }

        let maxSeq = 0
        ;(data || []).forEach((row: any) => {
          const num = row.assignment_number as string | null
          if (!num) return
          const prefix = `${dateKey}-`
          if (!num.startsWith(prefix)) return
          const suffix = num.slice(prefix.length)
          const parsed = parseInt(suffix, 10)
          if (!isNaN(parsed) && parsed > maxSeq) maxSeq = parsed
        })

        const next = maxSeq + 1
        const seqStr = next.toString().padStart(2, '0')
        const newNumber = `${dateKey}-${seqStr}`

        await saveInspection({ assignment_number: newNumber } as Partial<Inspection>)
        setInspForm(prev => ({ ...prev, assignment_number: newNumber }))
      } catch (err) {
        console.error('Fel vid generering av uppdragsnummer:', err)
      }
    }

    void maybeGenerateAssignmentNumber()
  }, [inspection.id, inspection.assignment_number, inspection.date])

  // Handlers för formulärfält - spara vid blur
  const handlePropChange = (
    field: keyof typeof propForm,
    value: string | Property['tenure_type'] | Property['dwelling_type']
  ) => {
    setPropForm(prev => ({ ...prev, [field]: value }))
  }

  const handlePropBlur = (field: keyof typeof propForm) => {
    const rawVal = propForm[field]
    const val = rawVal === '' ? null : (rawVal as any)

    const patch: Partial<Property> = {}
    if (field === 'cadastral_id') patch.cadastral_id = val
    if (field === 'address') patch.address = val
    if (field === 'postal_code') patch.postal_code = val
    if (field === 'city') patch.city = val
    if (field === 'municipality') patch.municipality = val
    if (field === 'owner_name') patch.owner_name = val
    if (field === 'tenure_type') patch.tenure_type = val
    if (field === 'dwelling_type') patch.dwelling_type = val

    if (Object.keys(patch).length > 0) void saveProperty(patch)
  }

  const handleInspChange = (field: keyof typeof inspForm, value: string) => {
    setInspForm(prev => ({ ...prev, [field]: value }))
  }

  const handleInspBlur = (field: keyof typeof inspForm) => {
    const val = inspForm[field] || null
    const patch: Partial<Inspection> = {}

    if (field === 'status') patch.status = val as any
    if (field === 'client_name') patch.client_name = val as any
    if (field === 'assignment_number') patch.assignment_number = val as any
    if (field === 'assignment_confirmation_delivered_date') {
      patch.assignment_confirmation_delivered_date = val as any
    }
    if (field === 'scope') patch.scope = val as any
    if (field === 'date') patch.date = val as any
    if (field === 'inspection_time') patch.inspection_time = val as any
    if (field === 'attendees') patch.attendees = val as any
    if (field === 'attendees_other') patch.attendees_other = val as any

    if (field === 'inspection_side') {
      patch.inspection_side = (val as any) as InspectionSide
    }

    if (Object.keys(patch).length > 0) void saveInspection(patch)
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
    const nextSelected = !row.is_selected
    const optimisticRows = inspectionAddonOrders.map(current =>
      current.id === row.id ? { ...current, is_selected: nextSelected } : current
    )
    setInspectionAddonOrders(optimisticRows)

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

      const newScope = scopeFromInspectionAddons(persistedRows)
      setInspForm(prev => ({ ...prev, scope: newScope }))
      await saveInspection({ scope: newScope } as Partial<Inspection>)
    } catch (addonUpdateError) {
      console.error('Kunde inte uppdatera tilläggsuppdrag:', addonUpdateError)
      setInspectionAddonOrders(prev =>
        prev.map(current =>
          current.id === row.id ? { ...current, is_selected: row.is_selected } : current
        )
      )
      setError(
        addonUpdateError instanceof Error
          ? addonUpdateError.message
          : 'Kunde inte uppdatera tilläggsuppdrag.'
      )
    }
  }

  const handleScopeToggle = async (label: string) => {
    const current = parseScopeLabels(inspForm.scope)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newScope = formatScopeLabels(next)
    setInspForm(prev => ({ ...prev, scope: newScope }))
    await saveInspection({ scope: newScope } as Partial<Inspection>)
  }

  // Checkboxar för närvarande
  const selectedAttendees = parseAttendeeLabels(inspForm.attendees)

  const handleAttendeeToggle = async (label: string) => {
    const current = parseAttendeeLabels(inspForm.attendees)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newAttendees = formatAttendeeLabels(next)
    setInspForm(prev => ({ ...prev, attendees: newAttendees }))
    await saveInspection({ attendees: newAttendees } as Partial<Inspection>)
  }

  // Köpar-/säljarbesiktning - radioknappar
  const handleInspectionSideChange = async (side: NonNullable<InspectionSide>) => {
    const patch: Partial<Inspection> = { inspection_side: side }

    // Om vi växlar till säljarbesiktning ska "Köpare" inte vara markerad
    if (side === 'seller') {
      const current = parseAttendeeLabels(inspForm.attendees)
      if (current.includes('Köpare')) {
        const next = current.filter(l => l !== 'Köpare')
        const newAttendees = formatAttendeeLabels(next)
        patch.attendees = newAttendees as any
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

  const isInspectionLocked = normalizeInspectionStatus(inspForm.status) === 'completed'

  const handleInspectionCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (isInspectionLocked) {
      setError('Besiktningen är klar. Omslagsbild kan inte ändras.')
      event.target.value = ''
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
    } catch (e: any) {
      console.error('handleInspectionCoverUpload failed:', e)
      setError(e?.message ?? 'Kunde inte ladda upp omslagsbild.')
    } finally {
      setUploadingCover(false)
      event.target.value = ''
    }
  }

  const inspectorName = inspectorProfile?.full_name || inspection.inspector_name || INSPECTOR_CARD.name
  const inspectorSbrLine1 = inspectorProfile?.sbr_group || INSPECTOR_CARD.sbrLine1
  const inspectorSbrLine2 = inspectorProfile?.sbr_status || INSPECTOR_CARD.sbrLine2
  const inspectorMemberNumber =
    inspectorProfile?.membership_number || INSPECTOR_CARD.memberNumber
  const inspectorCertificationNumber = inspectorProfile?.certification_number ?? null
  const inspectorPhone = inspectorProfile?.phone || INSPECTOR_CARD.phone
  const inspectorEmail = inspectorProfile?.email || INSPECTOR_CARD.email
  const inspectorCompany = inspectorProfile?.company_name || INSPECTOR_CARD.company
  const inspectorOrgNumber = inspectorProfile?.company_orgno || INSPECTOR_CARD.orgNumber
  const inspectorAddressLine =
    inspectorProfile?.company_address
      ? [
          inspectorProfile.company_address,
          [inspectorProfile.company_postal_code, inspectorProfile.company_city]
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

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* --- Kolumn 1: Objekt --- */}
        <section className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Objekt</h2>

          <Field
            label="Fastighetsbeteckning"
            value={propForm.cadastral_id ?? ''}
            onChange={v => handlePropChange('cadastral_id', v)}
            onBlur={() => handlePropBlur('cadastral_id')}
          />

          <Field
            label="Adress"
            value={propForm.address ?? ''}
            onChange={v => handlePropChange('address', v)}
            onBlur={() => handlePropBlur('address')}
          />

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Postnummer"
              value={propForm.postal_code ?? ''}
              onChange={v => handlePropChange('postal_code', v)}
              onBlur={() => handlePropBlur('postal_code')}
            />
            <Field
              label="Ort"
              value={propForm.city ?? ''}
              onChange={v => handlePropChange('city', v)}
              onBlur={() => handlePropBlur('city')}
            />
          </div>

          <Field
            label="Kommun"
            value={propForm.municipality ?? ''}
            onChange={v => handlePropChange('municipality', v)}
            onBlur={() => handlePropBlur('municipality')}
          />

          <Field
            label="Fastighetsägare"
            value={propForm.owner_name ?? ''}
            onChange={v => handlePropChange('owner_name', v)}
            onBlur={() => handlePropBlur('owner_name')}
          />

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600">Ägandeform</div>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={propForm.tenure_type ?? ''}
              onChange={e =>
                handlePropChange(
                  'tenure_type',
                  (e.target.value || null) as Property['tenure_type']
                )
              }
              onBlur={() => handlePropBlur('tenure_type')}
            >
              <option value="">Välj ägandeform...</option>
              {TENURE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600">Typ av objekt</div>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={propForm.dwelling_type ?? ''}
              onChange={e =>
                handlePropChange(
                  'dwelling_type',
                  (e.target.value || null) as Property['dwelling_type']
                )
              }
              onBlur={() => handlePropBlur('dwelling_type')}
            >
              <option value="">Välj typ...</option>
              {DWELLING_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-600">Omslagsbild</div>
            <label
              className={`group relative block h-40 w-full overflow-hidden rounded-md border border-gray-300 bg-gray-50 ${isInspectionLocked ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}`}
            >
              {inspectionCoverSrc ? (
                <img
                  src={inspectionCoverSrc}
                  alt="Omslagsbild"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-gray-500">
                  Ingen omslagsbild vald
                </div>
              )}

              {!isInspectionLocked ? (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/45 text-xs font-medium text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
                  {inspectionCoverSrc ? 'Byt omslagsbild' : 'Ladda upp omslagsbild'}
                </span>
              ) : null}

              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={isInspectionLocked || uploadingCover || savingInsp}
                onChange={e => void handleInspectionCoverUpload(e)}
              />
            </label>
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
                  onChange={() => void handleInspectionSideChange('buyer')}
                />
                <span>Köparbesiktning</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'seller'}
                  onChange={() => void handleInspectionSideChange('seller')}
                />
                <span>Säljarbesiktning</span>
              </label>
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600">Status</div>
            <select
              className="w-full rounded-md border px-3 py-2 text-sm"
              value={inspForm.status}
              onChange={e => handleInspChange('status', e.target.value)}
              onBlur={() => handleInspBlur('status')}
            >
              <option value="draft">Utkast</option>
              <option value="ongoing">P&aring;g&aring;ende</option>
              <option value="completed">Klar</option>
              <option value="archived">Arkiverad</option>
            </select>
          </div>

          <Field
            label="Uppdragsgivare"
            value={inspForm.client_name}
            onChange={v => handleInspChange('client_name', v)}
            onBlur={() => handleInspBlur('client_name')}
            placeholder="T.ex. köpare, säljare eller juridisk person"
          />

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
            />
            <Field
              label="Tid (t.ex. 09:00)"
              value={inspForm.inspection_time}
              onChange={v => handleInspChange('inspection_time', v)}
              onBlur={() => handleInspBlur('inspection_time')}
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
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-xs"
                  rows={2}
                  placeholder="T.ex. Anna Andersson (mäklare), Kalle Karlsson (besiktningsman säljare)"
                  value={inspForm.attendees_other}
                  onChange={e => handleInspChange('attendees_other', e.target.value)}
                  onBlur={() => handleInspBlur('attendees_other')}
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
              />

              <div className="mt-1 text-[11px] text-gray-500">
                {inspForm.attendees && inspForm.attendees.trim() !== '' ? (
                  <>Registrerade närvarande (huvudroller): {inspForm.attendees}</>
                ) : (
                  'Inga huvudroller markerade ännu.'
              )}
            </div>
          </div>

          {savingInsp && <p className="mt-1 text-[11px] text-gray-400">Sparar uppdrag...</p>}
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
            <div className="text-xs text-gray-600">{inspectorSbrLine1}</div>
            <div className="text-xs text-gray-600">{inspectorSbrLine2}</div>

            <div className="mt-2 text-xs text-gray-600">Medlemsnummer: {inspectorMemberNumber}</div>
            {inspectorCertificationNumber ? (
              <div className="text-xs text-gray-600">
                Certifieringsnummer: {inspectorCertificationNumber}
              </div>
            ) : null}
            <div className="text-xs text-gray-600">Telefon: {inspectorPhone}</div>
            <div className="text-xs text-gray-600">E-post: {inspectorEmail}</div>

            <div className="mt-2 text-xs text-gray-600">{inspectorCompany}</div>
            <div className="text-xs text-gray-600">Org.nr: {inspectorOrgNumber}</div>
            <div className="text-xs text-gray-600">{inspectorAddressLine}</div>
          </div>

          <p className="mt-2 text-xs text-gray-600">{'Uppgifterna h\u00e4mtas fr\u00e5n den inloggade besiktningsmannens profil.'}</p>
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
        <textarea
          className={`w-full rounded-md border px-3 py-2 text-sm ${readOnly ? 'bg-gray-100 text-gray-600' : ''}`}
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={3}
          readOnly={readOnly}
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
        />
      )}
    </div>
  )
}

