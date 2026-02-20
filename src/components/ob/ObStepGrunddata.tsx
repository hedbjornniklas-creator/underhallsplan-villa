'use client'

import { useEffect, useState } from 'react'
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

// Ã°Å¸â€Â¹ Standardval fÃƒÂ¶r Omfattning Ã¢â‚¬â€œ gÃƒÂ¥r lÃƒÂ¤tt att ÃƒÂ¤ndra senare
const SCOPE_OPTIONS: { key: string; label: string }[] = [
  { key: 'main_building', label: 'OkulÃƒÂ¤r besiktning av huvudbyggnaden' },
  { key: 'outbuildings', label: 'Besiktning av komplementbyggnader' },
  {
    key: 'moisture_risk',
    label: 'FuktmÃƒÂ¤tning eller fuktindikering av riskkonstruktion',
  },
  { key: 'area', label: 'AreamÃƒÂ¤tning' },
  { key: 'radon', label: 'Radonindikering' },
  { key: 'mould', label: 'MÃƒÂ¶gelprov' },
]

// Ã°Å¸â€Â¹ Standardval fÃƒÂ¶r NÃƒÂ¤rvarande (huvudroller)
const ATTENDEE_OPTIONS: { key: 'owner' | 'buyer'; label: string }[] = [
  { key: 'owner', label: 'FastighetsÃƒÂ¤gare' },
  { key: 'buyer', label: 'KÃƒÂ¶pare' },
]

// Ã°Å¸â€Â¹ Ãƒâ€žgandeform-alternativ
const TENURE_OPTIONS: { value: NonNullable<Property['tenure_type']>; label: string }[] =
  [
    { value: 'freehold', label: 'Ãƒâ€žganderÃƒÂ¤tt' },
    { value: 'bostadsratt', label: 'BostadsrÃƒÂ¤tt' },
  ]

// Ã°Å¸â€Â¹ Typ av objekt
const DWELLING_OPTIONS: {
  value: NonNullable<Property['dwelling_type']>
  label: string
}[] = [
  { value: 'house', label: 'Hus (villa/radhus/parhus)' },
  { value: 'apartment', label: 'LÃƒÂ¤genhet' },
]

// Ã°Å¸â€Â¹ Visitkort / besiktningsinfo (statisk tills vi kopplar mot profil)
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

// HjÃƒÂ¤lpare: tolka/spara listor som semikolon-separerad text
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

// Ã°Å¸â€Â¹ HÃƒÂ¤r bestÃƒÂ¤mmer vi om kombinationen ska behandlas som villa-mall eller lÃƒÂ¤genhets-mall
function deriveFormKind(
  dwelling: Property['dwelling_type']
): 'villa' | 'lÃƒÂ¤genhet' | null {
  if (!dwelling) return null
  if (dwelling === 'house') return 'villa'
  if (dwelling === 'apartment') return 'lÃƒÂ¤genhet'
  return null
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
  onPropertyUpdated,
  onInspectionUpdated,
}: ObStepGrunddataProps) {
  // Lokalt formulÃƒÂ¤r-state Ã¢â‚¬â€œ vi utgÃƒÂ¥r frÃƒÂ¥n inkommande props
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
  const [error, setError] = useState<string | null>(null)
  const [inspectorProfile, setInspectorProfile] = useState<InspectorProfile | null>(null)
  const [inspectorAvatarLoadError, setInspectorAvatarLoadError] = useState(false)

  // Om vi fÃƒÂ¥r nya props (t.ex. efter save utifrÃƒÂ¥n) uppdaterar vi lokalt state
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

  // HjÃƒÂ¤lpare: spara property-fÃƒÂ¤lt
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
      setError('Kunde inte spara objektets uppgifter i Ãƒâ€“B.')
      return
    }

    if (onPropertyUpdated) {
      onPropertyUpdated({ ...property, ...patch } as Property)
    }
  }

  // HjÃƒÂ¤lpare: spara inspection-fÃƒÂ¤lt
  const saveInspection = async (patch: Partial<Inspection>) => {
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
      return
    }

    if (data && onInspectionUpdated) {
      onInspectionUpdated(data as Inspection)
    }
  }

  // Ã°Å¸â€Â¹ Autogenerera uppdragsnummer baserat pÃƒÂ¥ datum + lÃƒÂ¶pnummer
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

  // Handlers fÃƒÂ¶r formulÃƒÂ¤rfÃƒÂ¤lt Ã¢â‚¬â€œ spara vid blur
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

  // Ã°Å¸â€Â¹ Checkboxar fÃƒÂ¶r omfattning
  const selectedScopeLabels = parseScopeLabels(inspForm.scope)

  const handleScopeToggle = async (label: string) => {
    const current = parseScopeLabels(inspForm.scope)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newScope = formatScopeLabels(next)
    setInspForm(prev => ({ ...prev, scope: newScope }))
    await saveInspection({ scope: newScope } as Partial<Inspection>)
  }

  // Ã°Å¸â€Â¹ Checkboxar fÃƒÂ¶r nÃƒÂ¤rvarande
  const selectedAttendees = parseAttendeeLabels(inspForm.attendees)

  const handleAttendeeToggle = async (label: string) => {
    const current = parseAttendeeLabels(inspForm.attendees)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newAttendees = formatAttendeeLabels(next)
    setInspForm(prev => ({ ...prev, attendees: newAttendees }))
    await saveInspection({ attendees: newAttendees } as Partial<Inspection>)
  }

  // Ã°Å¸â€Â¹ KÃƒÂ¶par-/sÃƒÂ¤ljarbesiktning Ã¢â‚¬â€œ radioknappar
  const handleInspectionSideChange = async (side: NonNullable<InspectionSide>) => {
    const patch: Partial<Inspection> = { inspection_side: side }

    // Om vi vÃƒÂ¤xlar till sÃƒÂ¤ljarbesiktning ska "KÃƒÂ¶pare" inte vara markerad
    if (side === 'seller') {
      const current = parseAttendeeLabels(inspForm.attendees)
      if (current.includes('KÃƒÂ¶pare')) {
        const next = current.filter(l => l !== 'KÃƒÂ¶pare')
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

  // Vilka nÃƒÂ¤rvarorutor vi ska visa: vid sÃƒÂ¤ljarbesiktning, ingen "KÃƒÂ¶pare"
  const attendeeOptionsToShow =
    inspForm.inspection_side === 'seller'
      ? ATTENDEE_OPTIONS.filter(opt => opt.key !== 'buyer')
      : ATTENDEE_OPTIONS

  // Ã°Å¸â€Â¹ HÃƒÂ¤r rÃƒÂ¤knar vi fram vilken mall som gÃƒÂ¤ller (villa/lÃƒÂ¤genhet)
  const formKind = deriveFormKind(propForm.dwelling_type)
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

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
        Grunduppgifter fÃƒÂ¶r objekt, uppdragsgivare och besiktningsman. Ãƒâ€žndringar sparas
        automatiskt nÃƒÂ¤r du lÃƒÂ¤mnar ett fÃƒÂ¤lt. Uppdragsnummer skapas automatiskt nÃƒÂ¤r
        besiktningsdatum ÃƒÂ¤r satt.
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
            label="FastighetsÃƒÂ¤gare"
            value={propForm.owner_name ?? ''}
            onChange={v => handlePropChange('owner_name', v)}
            onBlur={() => handlePropBlur('owner_name')}
          />

          <div className="space-y-1">
            <div className="text-xs font-medium text-gray-600">Ãƒâ€žgandeform</div>
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
              <option value="">VÃƒÂ¤lj ÃƒÂ¤gandeformÃ¢â‚¬Â¦</option>
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
              <option value="">VÃƒÂ¤lj typÃ¢â‚¬Â¦</option>
              {DWELLING_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <p className="mt-1 text-[11px] text-gray-500">
            {propForm.tenure_type && propForm.dwelling_type && formKind ? (
              <>
                Denna kombination behandlas som{' '}
                <span className="font-semibold">
                  {formKind === 'villa' ? 'villamall' : 'lÃƒÂ¤genhetsmall'}
                </span>{' '}
                i utlÃƒÂ¥tandet.
              </>
            ) : (
              'VÃƒÂ¤lj ÃƒÂ¤gandeform och typ fÃƒÂ¶r att styra om utlÃƒÂ¥tandet fÃƒÂ¶ljer villa- eller lÃƒÂ¤genhetsmall.'
            )}
          </p>

          {savingProp && <p className="mt-1 text-[11px] text-gray-400">Sparar objektÃ¢â‚¬Â¦</p>}
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
                <span>KÃƒÂ¶parbesiktning</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  className="h-3 w-3"
                  checked={inspForm.inspection_side === 'seller'}
                  onChange={() => void handleInspectionSideChange('seller')}
                />
                <span>SÃƒÂ¤ljarbesiktning</span>
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
            placeholder="T.ex. kÃƒÂ¶pare, sÃƒÂ¤ljare eller juridisk person"
          />

          <Field
            label="Uppdragsnummer"
            value={inspForm.assignment_number}
            onChange={v => handleInspChange('assignment_number', v)}
            onBlur={() => handleInspBlur('assignment_number')}
            placeholder="Skapas automatiskt nÃƒÂ¤r datum ÃƒÂ¤r satt (kan justeras)"
          />

          <div className="space-y-2">
            <div className="text-xs font-medium text-gray-600">Omfattning</div>
            <div className="space-y-1">
              {SCOPE_OPTIONS.map(opt => (
                <label key={opt.key} className="flex items-start gap-2 text-xs text-gray-700">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-3 w-3"
                    checked={selectedScopeLabels.includes(opt.label)}
                    onChange={() => void handleScopeToggle(opt.label)}
                  />
                  <span>{opt.label}</span>
                </label>
              ))}
            </div>
            <div className="mt-1 text-[11px] text-gray-500">
              {inspForm.scope && inspForm.scope.trim() !== '' ? (
                <>Vald omfattning (sparas i utlÃƒÂ¥tandet): {inspForm.scope}</>
              ) : (
                'Ingen omfattning vald ÃƒÂ¤nnu.'
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
            <div className="text-xs font-medium text-gray-600">NÃƒÂ¤rvarande</div>

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
                  Ãƒâ€“vriga nÃƒÂ¤rvarande (namn och roll)
                </div>
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-xs"
                  rows={2}
                  placeholder="T.ex. Anna Andersson (mÃƒÂ¤klare), Kalle Karlsson (besiktningsman sÃƒÂ¤ljare)"
                  value={inspForm.attendees_other}
                  onChange={e => handleInspChange('attendees_other', e.target.value)}
                  onBlur={() => handleInspBlur('attendees_other')}
                />
              </div>

              <Field
                label="UppdragsbekrÃƒÂ¤ftelse ÃƒÂ¶verlÃƒÂ¤mnad"
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
                  <>Registrerade nÃƒÂ¤rvarande (huvudroller): {inspForm.attendees}</>
                ) : (
                'Inga huvudroller markerade ÃƒÂ¤nnu.'
              )}
            </div>
          </div>

          {savingInsp && <p className="mt-1 text-[11px] text-gray-400">Sparar uppdragÃ¢â‚¬Â¦</p>}
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

/** Enkel field-komponent fÃƒÂ¶r att slippa upprepning */
function Field({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  type = 'text',
  multiline,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onBlur?: () => void
  placeholder?: string
  type?: 'text' | 'date'
  multiline?: boolean
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-gray-600">{label}</div>
      {multiline ? (
        <textarea
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          rows={3}
        />
      ) : (
        <input
          type={type}
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
        />
      )}
    </div>
  )
}
