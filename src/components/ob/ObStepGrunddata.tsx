'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import type { Tables } from '@/types/supabase'

export type ObInspection = Tables<'inspections'>

type Property = Tables<'properties'>
type Inspection = ObInspection
type InspectionSide = Inspection['inspection_side'] // typiskt: 'buyer' | 'seller' | null

interface ObStepGrunddataProps {
  property: Property
  inspection: ObInspection
  onPropertyUpdated?: (p: Property) => void
  onInspectionUpdated?: (i: ObInspection) => void
}

// 🔹 Standardval för Omfattning – går lätt att ändra senare
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

// 🔹 Standardval för Närvarande (huvudroller)
const ATTENDEE_OPTIONS: { key: 'owner' | 'buyer'; label: string }[] = [
  { key: 'owner', label: 'Fastighetsägare' },
  { key: 'buyer', label: 'Köpare' },
]

// 🔹 Ägandeform-alternativ
const TENURE_OPTIONS: { value: NonNullable<Property['tenure_type']>; label: string }[] =
  [
    { value: 'freehold', label: 'Äganderätt' },
    { value: 'bostadsratt', label: 'Bostadsrätt' },
  ]

// 🔹 Typ av objekt
const DWELLING_OPTIONS: {
  value: NonNullable<Property['dwelling_type']>
  label: string
}[] = [
  { value: 'house', label: 'Hus (villa/radhus/parhus)' },
  { value: 'apartment', label: 'Lägenhet' },
]

// 🔹 Visitkort / besiktningsinfo (statisk tills vi kopplar mot profil)
const INSPECTOR_CARD = {
  name: 'Niklas Hedbjörn',
  sbrLine1: 'Medlem i SBR Överlåtelsebesiktningsgrupp',
  sbrLine2: 'Av SBR godkänd besiktningsman',
  memberNumber: '22015326',
  phone: '0735678716',
  email: 'niklas.h@bbsab.nu',
  company: 'Besiktningsbolaget Stockholm',
  orgNumber: '559281-0823',
  addressLine: 'Bryggvägen 7, 117 71 Stockholm',
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

// 🔹 Här bestämmer vi om kombinationen ska behandlas som villa-mall eller lägenhets-mall
function deriveFormKind(
  dwelling: Property['dwelling_type']
): 'villa' | 'lägenhet' | null {
  if (!dwelling) return null
  if (dwelling === 'house') return 'villa'
  if (dwelling === 'apartment') return 'lägenhet'
  return null
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
  // Lokalt formulär-state – vi utgår från inkommande props
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

  // 🔹 Autogenerera uppdragsnummer baserat på datum + löpnummer
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

  // Handlers för formulärfält – spara vid blur
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

  // 🔹 Checkboxar för omfattning
  const selectedScopeLabels = parseScopeLabels(inspForm.scope)

  const handleScopeToggle = async (label: string) => {
    const current = parseScopeLabels(inspForm.scope)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newScope = formatScopeLabels(next)
    setInspForm(prev => ({ ...prev, scope: newScope }))
    await saveInspection({ scope: newScope } as Partial<Inspection>)
  }

  // 🔹 Checkboxar för närvarande
  const selectedAttendees = parseAttendeeLabels(inspForm.attendees)

  const handleAttendeeToggle = async (label: string) => {
    const current = parseAttendeeLabels(inspForm.attendees)
    const next = current.includes(label) ? current.filter(l => l !== label) : [...current, label]
    const newAttendees = formatAttendeeLabels(next)
    setInspForm(prev => ({ ...prev, attendees: newAttendees }))
    await saveInspection({ attendees: newAttendees } as Partial<Inspection>)
  }

  // 🔹 Köpar-/säljarbesiktning – radioknappar
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

  // 🔹 Här räknar vi fram vilken mall som gäller (villa/lägenhet)
  const formKind = deriveFormKind(propForm.dwelling_type)

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-900">
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
              <option value="">Välj ägandeform…</option>
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
              <option value="">Välj typ…</option>
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
                  {formKind === 'villa' ? 'villamall' : 'lägenhetsmall'}
                </span>{' '}
                i utlåtandet.
              </>
            ) : (
              'Välj ägandeform och typ för att styra om utlåtandet följer villa- eller lägenhetsmall.'
            )}
          </p>

          {savingProp && <p className="mt-1 text-[11px] text-gray-400">Sparar objekt…</p>}
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
            placeholder="Skapas automatiskt när datum är satt (kan justeras)"
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
                <>Vald omfattning (sparas i utlåtandet): {inspForm.scope}</>
              ) : (
                'Ingen omfattning vald ännu.'
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

          {savingInsp && <p className="mt-1 text-[11px] text-gray-400">Sparar uppdrag…</p>}
        </section>

        {/* --- Kolumn 3: Besiktningsman (read-only) --- */}
        <section className="rounded-xl border bg-white p-4 space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Besiktningsman</h2>

          <div className="space-y-1 text-sm text-gray-800">
            <div className="font-semibold">{inspection.inspector_name || INSPECTOR_CARD.name}</div>
            <div className="text-xs text-gray-600">{INSPECTOR_CARD.sbrLine1}</div>
            <div className="text-xs text-gray-600">{INSPECTOR_CARD.sbrLine2}</div>

            <div className="mt-2 text-xs text-gray-600">Medlemsnummer: {INSPECTOR_CARD.memberNumber}</div>
            <div className="text-xs text-gray-600">Telefon: {INSPECTOR_CARD.phone}</div>
            <div className="text-xs text-gray-600">E-post: {INSPECTOR_CARD.email}</div>

            <div className="mt-2 text-xs text-gray-600">{INSPECTOR_CARD.company}</div>
            <div className="text-xs text-gray-600">Org.nr: {INSPECTOR_CARD.orgNumber}</div>
            <div className="text-xs text-gray-600">{INSPECTOR_CARD.addressLine}</div>
          </div>

          <p className="mt-2 text-xs text-gray-600">
            Uppgifterna om besiktningsmannen hämtas tills vidare från en statisk profil. Senare kan
            detta kopplas till dina inställningar under Settings.
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
