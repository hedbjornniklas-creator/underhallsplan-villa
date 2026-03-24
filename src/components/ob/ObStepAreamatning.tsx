'use client'

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react'
import type { Tables } from '@/types/supabase'

type Property = Tables<'properties'>
type Inspection = Tables<'inspections'>

type ObStepAreamatningProps = {
  property: Pick<Property, 'address' | 'city' | 'year_built'>
  inspection: Pick<Inspection, 'id' | 'assignment_number' | 'date'> & {
    locked_at?: string | null
  }
}

type AreaMeasurementRow = {
  id: string
  floor_or_part: string
  boarea_m2: string
  biarea_m2: string
}

type AreaMeasurementForm = {
  building_type: string
  building_year: string
  extension_note: string
  object_other: string
  measurement_instrument: string
  comment: string
  other_notes: string
  place_name: string
  signed_date: string
  rows: AreaMeasurementRow[]
}

type ProfileSnapshot = {
  full_name: string | null
  company_name: string | null
  membership_number: string | null
  sbr_status: string | null
  certification_number: string | null
  is_sbr_diplomerad_areamatning: boolean
}

const FIXED_TOLERANCE_LABEL = '+/-2 %'
const AREA_STANDARD_LABEL = 'Uppmätning enligt SVENSK STANDARD SS 21054:2020'

function createEmptyRow(index: number): AreaMeasurementRow {
  return {
    id: `row-${Date.now()}-${index}`,
    floor_or_part: '',
    boarea_m2: '',
    biarea_m2: '',
  }
}

function normalizeNumberInput(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

function toPayloadNumber(value: string) {
  const parsed = normalizeNumberInput(value)
  if (parsed === null) return null
  return Number(parsed.toFixed(2))
}

function displayM2(value: number) {
  return value.toLocaleString('sv-SE', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })
}

function toInitialForm(input: {
  measurement: Record<string, unknown> | null
  rows: Array<Record<string, unknown>>
  fallbackYearBuilt: number | null | undefined
  fallbackCity: string | null | undefined
  fallbackSignedDate: string | null | undefined
}): AreaMeasurementForm {
  const measurement = input.measurement
  const rows =
    input.rows.length > 0
      ? input.rows.map((row, index) => ({
          id: String(row.id ?? `row-${index}`),
          floor_or_part: String(row.floor_or_part ?? ''),
          boarea_m2:
            row.boarea_m2 === null || row.boarea_m2 === undefined ? '' : String(row.boarea_m2),
          biarea_m2:
            row.biarea_m2 === null || row.biarea_m2 === undefined ? '' : String(row.biarea_m2),
        }))
      : [createEmptyRow(0)]

  const propertyYear = typeof input.fallbackYearBuilt === 'number' ? String(input.fallbackYearBuilt) : ''
  const signedDate = input.fallbackSignedDate ?? ''

  return {
    building_type: String(measurement?.building_type ?? ''),
    building_year: String(measurement?.building_year ?? propertyYear),
    extension_note: String(measurement?.extension_note ?? ''),
    object_other: String(measurement?.object_other ?? ''),
    measurement_instrument: String(measurement?.measurement_instrument ?? ''),
    comment: String(measurement?.comment ?? ''),
    other_notes: String(measurement?.other_notes ?? ''),
    place_name: String(measurement?.place_name ?? input.fallbackCity ?? ''),
    signed_date: String(measurement?.signed_date ?? signedDate),
    rows,
  }
}

function formFingerprint(form: AreaMeasurementForm) {
  return JSON.stringify(form)
}

export default function ObStepAreamatning({ property, inspection }: ObStepAreamatningProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null)
  const isInspectionLocked = Boolean(inspection.locked_at)
  const [form, setForm] = useState<AreaMeasurementForm>({
    building_type: '',
    building_year: '',
    extension_note: '',
    object_other: '',
    measurement_instrument: '',
    comment: '',
    other_notes: '',
    place_name: property.city ?? '',
    signed_date: inspection.date ?? '',
    rows: [createEmptyRow(0)],
  })

  const hydratedRef = useRef(false)
  const lastSavedFingerprintRef = useRef('')

  useEffect(() => {
    let cancelled = false

    const loadAreaMeasurement = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/ob/inspections/${inspection.id}/area-measurement`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as
          | {
              unsupported?: boolean
              measurement?: Record<string, unknown> | null
              rows?: Array<Record<string, unknown>>
              profile?: ProfileSnapshot | null
              error?: string
            }
          | null

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Kunde inte läsa areamätning.')
        }

        if (cancelled) return
        const nextForm = toInitialForm({
          measurement: payload?.measurement ?? null,
          rows: Array.isArray(payload?.rows) ? payload.rows : [],
          fallbackYearBuilt: property.year_built,
          fallbackCity: property.city,
          fallbackSignedDate: inspection.date,
        })

        setUnsupported(payload?.unsupported === true)
        setProfile((payload?.profile as ProfileSnapshot | null) ?? null)
        setForm(nextForm)
        lastSavedFingerprintRef.current = formFingerprint(nextForm)
        hydratedRef.current = true
        setSaveState('idle')
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa areamätning.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadAreaMeasurement()

    return () => {
      cancelled = true
    }
  }, [inspection.id, inspection.date, property.city, property.year_built])

  const persistForm = useCallback(async (nextForm: AreaMeasurementForm) => {
    if (unsupported || isInspectionLocked) return
    setSaving(true)
    setSaveState('saving')
    setError(null)

    try {
      const response = await fetch(`/api/ob/inspections/${inspection.id}/area-measurement`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          building_type: nextForm.building_type,
          building_year: nextForm.building_year,
          extension_note: nextForm.extension_note,
          object_other: nextForm.object_other,
          measurement_instrument: nextForm.measurement_instrument,
          comment: nextForm.comment,
          other_notes: nextForm.other_notes,
          place_name: nextForm.place_name,
          signed_date: nextForm.signed_date,
          rows: nextForm.rows.map((row) => ({
            floor_or_part: row.floor_or_part,
            boarea_m2: toPayloadNumber(row.boarea_m2),
            biarea_m2: toPayloadNumber(row.biarea_m2),
          })),
        }),
      })

      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte spara areamätning.')
      }

      lastSavedFingerprintRef.current = formFingerprint(nextForm)
      setSaveState('saved')
    } catch (saveError) {
      setSaveState('idle')
      setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara areamätning.')
    } finally {
      setSaving(false)
    }
  }, [inspection.id, unsupported, isInspectionLocked])

  useEffect(() => {
    if (loading || !hydratedRef.current) return

    const nextFingerprint = formFingerprint(form)
    if (nextFingerprint === lastSavedFingerprintRef.current) return

    const timeoutId = window.setTimeout(() => {
      void persistForm(form)
    }, 700)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [form, loading, persistForm])

  const totals = useMemo(() => {
    const sum = form.rows.reduce(
      (acc, row) => ({
        boarea: acc.boarea + (normalizeNumberInput(row.boarea_m2) ?? 0),
        biarea: acc.biarea + (normalizeNumberInput(row.biarea_m2) ?? 0),
      }),
      { boarea: 0, biarea: 0 }
    )
    return {
      boarea: Number(sum.boarea.toFixed(2)),
      biarea: Number(sum.biarea.toFixed(2)),
    }
  }, [form.rows])

  const updateField = (field: Exclude<keyof AreaMeasurementForm, 'rows'>, value: string) => {
    if (isInspectionLocked) return
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const updateRow = (rowId: string, patch: Partial<AreaMeasurementRow>) => {
    if (isInspectionLocked) return
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    }))
  }

  const addRow = () => {
    if (isInspectionLocked) return
    setForm((prev) => ({
      ...prev,
      rows: [...prev.rows, createEmptyRow(prev.rows.length)],
    }))
  }

  const removeRow = (rowId: string) => {
    if (isInspectionLocked) return
    setForm((prev) => {
      const nextRows = prev.rows.filter((row) => row.id !== rowId)
      return {
        ...prev,
        rows: nextRows.length > 0 ? nextRows : [createEmptyRow(0)],
      }
    })
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-20">
      <section className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-emerald-50 p-4 shadow-sm md:p-6">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Bilaga
          </div>
          <h2 className="text-2xl font-semibold text-slate-900">Areamätning av boarea</h2>
          <p className="text-sm text-slate-700">
            Tilläggsuppdrag i samband med överlåtelsebesiktning. Data sparas löpande men skrivs
            inte ut i utlåtande/PDF.
          </p>
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border bg-white p-4 text-sm text-slate-600">Laddar areamätning...</section>
      ) : null}

      {unsupported ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Areamätning är inte aktiverad i databasen ännu. Kör migrationen innan registrering.
        </section>
      ) : null}

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </section>
      ) : null}

      {isInspectionLocked ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Besiktningen är låst. Areamätning är skrivskyddad.
        </section>
      ) : null}

      {!loading ? (
        <>
          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Objekt</h3>
              <div className="text-xs text-slate-500">
                {saveState === 'saving' ? 'Sparar...' : saveState === 'saved' ? 'Sparat' : ''}
              </div>
            </div>
            <div className="space-y-3">
              <ReadOnlyField label="Uppdragsnummer" value={inspection.assignment_number ?? '-'} />
              <ReadOnlyField label="Adress" value={property.address ?? '-'} />
              <TextInput
                label="Byggnadstyp"
                value={form.building_type}
                onChange={(value) => updateField('building_type', value)}
                disabled={isInspectionLocked}
              />
              <TextInput
                label="Byggår"
                value={form.building_year}
                onChange={(value) => updateField('building_year', value)}
                inputMode="numeric"
                disabled={isInspectionLocked}
              />
              <TextInput
                label="Tillbyggd"
                value={form.extension_note}
                onChange={(value) => updateField('extension_note', value)}
                placeholder="Ja/Nej eller fritext"
                disabled={isInspectionLocked}
              />
              <TextArea
                label="Övrigt"
                value={form.object_other}
                onChange={(value) => updateField('object_other', value)}
                rows={2}
                disabled={isInspectionLocked}
              />
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Mätning</h3>
            <div className="space-y-3">
              <TextInput
                label="Instrument (märke och modell)"
                value={form.measurement_instrument}
                onChange={(value) => updateField('measurement_instrument', value)}
                disabled={isInspectionLocked}
              />
              <ReadOnlyField label="Standard" value={AREA_STANDARD_LABEL} />
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Resultat</h3>
              <button
                type="button"
                onClick={addRow}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                disabled={unsupported || saving || isInspectionLocked}
              >
                Lägg till rad
              </button>
            </div>
            <div className="space-y-3">
              {form.rows.map((row, index) => (
                <div key={row.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-semibold text-slate-600">Rad {index + 1}</div>
                  <div className="space-y-2">
                    <TextInput
                      label="Våning/byggdel"
                      value={row.floor_or_part}
                      onChange={(value) => updateRow(row.id, { floor_or_part: value })}
                      disabled={isInspectionLocked}
                    />
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <TextInput
                        label={`Boarea (m²) ${FIXED_TOLERANCE_LABEL}`}
                        value={row.boarea_m2}
                        onChange={(value) => updateRow(row.id, { boarea_m2: value })}
                        inputMode="decimal"
                        disabled={isInspectionLocked}
                      />
                      <TextInput
                        label={`Biarea (m²) ${FIXED_TOLERANCE_LABEL}`}
                        value={row.biarea_m2}
                        onChange={(value) => updateRow(row.id, { biarea_m2: value })}
                        inputMode="decimal"
                        disabled={isInspectionLocked}
                      />
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        onClick={() => removeRow(row.id)}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                        disabled={form.rows.length === 1 || unsupported || saving || isInspectionLocked}
                      >
                        Ta bort rad
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Sammanfattning</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadOnlyField
                label="Total BOA"
                value={`${displayM2(totals.boarea)} m² ${FIXED_TOLERANCE_LABEL}`}
              />
              <ReadOnlyField
                label="Total BIA"
                value={`${displayM2(totals.biarea)} m² ${FIXED_TOLERANCE_LABEL}`}
              />
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Kommentar</h3>
            <div className="space-y-3">
              <TextArea
                label="Övriga kommentarer"
                value={form.comment}
                onChange={(value) => updateField('comment', value)}
                rows={3}
                disabled={isInspectionLocked}
              />
              <TextArea
                label="Övrigt"
                value={form.other_notes}
                onChange={(value) => updateField('other_notes', value)}
                rows={4}
                disabled={isInspectionLocked}
              />
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Signering</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TextInput
                  label="Ort"
                  value={form.place_name}
                  onChange={(value) => updateField('place_name', value)}
                  disabled={isInspectionLocked}
                />
                <TextInput
                  label="Datum"
                  value={form.signed_date}
                  onChange={(value) => updateField('signed_date', value)}
                  type="date"
                  disabled={isInspectionLocked}
                />
              </div>
              <ReadOnlyField label="Besiktningsbolag" value={profile?.company_name ?? '-'} />
              <ReadOnlyField label="Namn och efternamn" value={profile?.full_name ?? '-'} />
              {profile?.is_sbr_diplomerad_areamatning ? (
                <ReadOnlyField
                  label="Areamatning"
                  value="Av SBR Diplomerad Areamätare"
                />
              ) : (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Markera certifiering i Besiktningsman - profil om den ska visas här.
                </div>
              )}
              <ReadOnlyField label="Certifiering" value={profile?.sbr_status ?? '-'} />
              <ReadOnlyField
                label="Certifieringsnummer"
                value={profile?.certification_number ?? '-'}
              />
              <ReadOnlyField label="Medlemsnummer" value={profile?.membership_number ?? '-'} />
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900">
        {value || '-'}
      </div>
    </div>
  )
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  type = 'text',
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode']
  type?: 'text' | 'date'
  disabled?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        inputMode={inputMode}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
      />
    </label>
  )
}

function TextArea({
  label,
  value,
  onChange,
  rows,
  disabled,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows: number
  disabled?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-70"
      />
    </label>
  )
}
