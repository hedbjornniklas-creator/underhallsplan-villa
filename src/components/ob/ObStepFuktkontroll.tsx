'use client'

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type InputHTMLAttributes,
} from 'react'
import type { Tables } from '@/types/supabase'
import { formatCertificationDisplayLines } from '@/lib/certifications/display'
import type { InspectorCertificationListItem } from '@/lib/certifications/profileSummary'

type Property = Tables<'properties'>
type Inspection = Tables<'inspections'>

type ObStepFuktkontrollProps = {
  property: Pick<Property, 'address' | 'city' | 'heating' | 'ventilation'>
  inspection: Pick<Inspection, 'id' | 'assignment_number' | 'date'> & {
    locked_at?: string | null
  }
}

type MoistureMeasurementType = 'rf' | 'fk' | 'other'
type MoistureCriticalLevel = 'under' | 'over'

type MoistureControlRow = {
  id: string
  location_label: string
  building_part: string
  measurement_type: MoistureMeasurementType
  measurement_value: string
  temperature_c: string
  note: string
  critical_level: MoistureCriticalLevel
}

type MoistureControlForm = {
  building_type: string
  building_year: string
  extension_note: string
  heating: string
  ventilation: string
  object_other: string
  measurement_instrument: string
  comment: string
  rows: MoistureControlRow[]
}

type ProfileSnapshot = {
  full_name: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  phone: string | null
  email: string | null
  avatar_path: string | null
  sbr_group?: string | null
  sbr_status?: string | null
  membership_number?: string | null
  certification_number?: string | null
  certification_items?: InspectorCertificationListItem[]
}

type MoistureControlDefaults = {
  building_type: string | null
  building_year: string | null
  extension_note: string | null
  heating: string | null
  ventilation: string | null
}

type MoistureControlApiResponse = {
  unsupported?: boolean
  control?: Record<string, unknown> | null
  rows?: Array<Record<string, unknown>>
  profile?: ProfileSnapshot | null
  defaults?: MoistureControlDefaults | null
  error?: string
}

type RowDialogState = {
  mode: 'create' | 'edit'
  rowId: string | null
  data: MoistureControlRow
}

function createEmptyRow(index: number): MoistureControlRow {
  return {
    id: `row-${Date.now()}-${index}`,
    location_label: '',
    building_part: '',
    measurement_type: 'rf',
    measurement_value: '',
    temperature_c: '',
    note: '',
    critical_level: 'under',
  }
}

function normalizeNumberInput(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function toPayloadNumber(value: string, allowNegative = false) {
  const parsed = normalizeNumberInput(value)
  if (parsed === null) return null
  if (!allowNegative && parsed < 0) return null
  return Number(parsed.toFixed(2))
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

function toInitialForm(input: {
  control: Record<string, unknown> | null
  rows: Array<Record<string, unknown>>
  defaults: MoistureControlDefaults | null
  property: Pick<Property, 'heating' | 'ventilation'>
}): MoistureControlForm {
  const control = input.control
  const rows: MoistureControlRow[] = input.rows.map((row, index) => {
    const measurementType: MoistureMeasurementType =
      row.measurement_type === 'fk' || row.measurement_type === 'other' ? row.measurement_type : 'rf'
    const criticalLevel: MoistureCriticalLevel = row.critical_level === 'over' ? 'over' : 'under'

    return {
      id: String(row.id ?? `row-${index}`),
      location_label: String(row.location_label ?? ''),
      building_part: String(row.building_part ?? ''),
      measurement_type: measurementType,
      measurement_value:
        row.measurement_value === null || row.measurement_value === undefined
          ? ''
          : String(row.measurement_value),
      temperature_c:
        row.temperature_c === null || row.temperature_c === undefined ? '' : String(row.temperature_c),
      note: String(row.note ?? ''),
      critical_level: criticalLevel,
    }
  })

  return {
    building_type: String(control?.building_type ?? input.defaults?.building_type ?? ''),
    building_year: String(control?.building_year ?? input.defaults?.building_year ?? ''),
    extension_note: String(control?.extension_note ?? input.defaults?.extension_note ?? ''),
    heating: String(control?.heating ?? input.defaults?.heating ?? input.property.heating ?? ''),
    ventilation: String(
      control?.ventilation ?? input.defaults?.ventilation ?? input.property.ventilation ?? ''
    ),
    object_other: String(control?.object_other ?? ''),
    measurement_instrument: String(control?.measurement_instrument ?? ''),
    comment: String(control?.comment ?? ''),
    rows,
  }
}

function formFingerprint(form: MoistureControlForm) {
  return JSON.stringify(form)
}

function measurementTypeLabel(value: MoistureMeasurementType) {
  if (value === 'rf') return 'RF'
  if (value === 'fk') return 'FK'
  return 'Annat'
}

function criticalLevelLabel(value: MoistureCriticalLevel) {
  return value === 'over' ? 'Över kritisk nivå' : 'Under kritisk nivå'
}

export default function ObStepFuktkontroll({ property, inspection }: ObStepFuktkontrollProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [dialogState, setDialogState] = useState<RowDialogState>({
    mode: 'create',
    rowId: null,
    data: createEmptyRow(0),
  })
  const [dialogError, setDialogError] = useState<string | null>(null)
  const isInspectionLocked = Boolean(inspection.locked_at)
  const [form, setForm] = useState<MoistureControlForm>({
    building_type: '',
    building_year: '',
    extension_note: '',
    heating: property.heating ?? '',
    ventilation: property.ventilation ?? '',
    object_other: '',
    measurement_instrument: '',
    comment: '',
    rows: [],
  })

  const hydratedRef = useRef(false)
  const lastSavedFingerprintRef = useRef('')
  const nameFallbackId = useId()

  useEffect(() => {
    let cancelled = false

    const loadMoistureControl = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/ob/inspections/${inspection.id}/moisture-control`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as MoistureControlApiResponse | null

        if (!response.ok) {
          throw new Error(payload?.error ?? 'Kunde inte läsa fuktkontroll.')
        }

        if (cancelled) return
        const nextForm = toInitialForm({
          control: payload?.control ?? null,
          rows: Array.isArray(payload?.rows) ? payload.rows : [],
          defaults: payload?.defaults ?? null,
          property,
        })

        setUnsupported(payload?.unsupported === true)
        setProfile((payload?.profile as ProfileSnapshot | null) ?? null)
        setForm(nextForm)
        lastSavedFingerprintRef.current = formFingerprint(nextForm)
        hydratedRef.current = true
        setSaveState('idle')
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa fuktkontroll.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadMoistureControl()

    return () => {
      cancelled = true
    }
  }, [inspection.id, property.heating, property.ventilation])

  const persistForm = useCallback(
    async (nextForm: MoistureControlForm) => {
      if (unsupported || isInspectionLocked) return
      setSaving(true)
      setSaveState('saving')
      setError(null)

      try {
        const response = await fetch(`/api/ob/inspections/${inspection.id}/moisture-control`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            building_type: nextForm.building_type,
            building_year: nextForm.building_year,
            extension_note: nextForm.extension_note,
            heating: nextForm.heating,
            ventilation: nextForm.ventilation,
            object_other: nextForm.object_other,
            measurement_instrument: nextForm.measurement_instrument,
            comment: nextForm.comment,
            place_name: property.city ?? null,
            signed_date: inspection.date ?? null,
            rows: nextForm.rows.map((row) => ({
              location_label: row.location_label,
              building_part: row.building_part,
              measurement_type: row.measurement_type,
              measurement_value: toPayloadNumber(row.measurement_value),
              temperature_c: toPayloadNumber(row.temperature_c, true),
              note: row.note,
              critical_level: row.critical_level,
            })),
          }),
        })

        const payload = (await response.json().catch(() => null)) as { error?: string } | null
        if (!response.ok) {
          throw new Error(payload?.error ?? 'Kunde inte spara fuktkontroll.')
        }

        lastSavedFingerprintRef.current = formFingerprint(nextForm)
        setSaveState('saved')
      } catch (saveError) {
        setSaveState('idle')
        setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara fuktkontroll.')
      } finally {
        setSaving(false)
      }
    },
    [inspection.date, inspection.id, isInspectionLocked, property.city, unsupported]
  )

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

  const lockedPlaceName = property.city ?? '-'
  const lockedSignedDate = inspection.date ?? '-'
  const inspectorAvatarSrc = resolvePublicMediaUrl(profile?.avatar_path)
  const inspectorAddressLine = profile?.company_address
    ? [
        profile.company_address,
        [profile.company_postal_code, profile.company_city].filter(Boolean).join(' '),
      ]
        .filter(Boolean)
        .join(', ')
    : null

  const inspectorCardLines = useMemo(() => {
    const rows = formatCertificationDisplayLines(profile?.certification_items)
    if (rows.length > 0) return rows

    const fallbackRows: string[] = []
    if (profile?.sbr_group) fallbackRows.push(profile.sbr_group)
    if (profile?.sbr_status) fallbackRows.push(profile.sbr_status)
    if (profile?.membership_number) fallbackRows.push(`Medlemsnummer: ${profile.membership_number}`)
    if (profile?.certification_number)
      fallbackRows.push(`Certifieringsnummer: ${profile.certification_number}`)
    return fallbackRows
  }, [profile])

  const updateField = (field: Exclude<keyof MoistureControlForm, 'rows'>, value: string) => {
    if (isInspectionLocked) return
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const openCreateDialog = () => {
    if (isInspectionLocked) return
    setDialogError(null)
    setDialogState({
      mode: 'create',
      rowId: null,
      data: createEmptyRow(form.rows.length),
    })
    setIsDialogOpen(true)
  }

  const openEditDialog = (row: MoistureControlRow) => {
    if (isInspectionLocked) return
    setDialogError(null)
    setDialogState({
      mode: 'edit',
      rowId: row.id,
      data: { ...row },
    })
    setIsDialogOpen(true)
  }

  const updateDialogField = (field: keyof MoistureControlRow, value: string) => {
    setDialogState((prev) => ({
      ...prev,
      data: {
        ...prev.data,
        [field]: value,
      },
    }))
  }

  const saveDialogAndClose = () => {
    const normalizedLocation = dialogState.data.location_label.trim()
    if (!normalizedLocation) {
      setDialogError('Ange kontrollplats innan du sparar.')
      return
    }

    const nextRow: MoistureControlRow = {
      ...dialogState.data,
      location_label: normalizedLocation,
      building_part: dialogState.data.building_part.trim(),
      measurement_value: dialogState.data.measurement_value.trim(),
      temperature_c: dialogState.data.temperature_c.trim(),
      note: dialogState.data.note.trim(),
    }

    setForm((prev) => {
      if (dialogState.mode === 'edit' && dialogState.rowId) {
        return {
          ...prev,
          rows: prev.rows.map((row) => (row.id === dialogState.rowId ? nextRow : row)),
        }
      }
      return {
        ...prev,
        rows: [...prev.rows, nextRow],
      }
    })

    setIsDialogOpen(false)
    setDialogError(null)
  }

  const deleteRow = (rowId: string) => {
    if (isInspectionLocked) return
    setForm((prev) => ({
      ...prev,
      rows: prev.rows.filter((row) => row.id !== rowId),
    }))
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-20">
      <section className="p-1 md:rounded-3xl md:border md:border-sky-200 md:bg-gradient-to-br md:from-sky-50 md:via-white md:to-emerald-50 md:p-6 md:shadow-sm">
        <div className="space-y-1">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Bilaga</div>
          <h2 className="text-[32px] leading-[1.1] font-semibold text-slate-900 md:text-2xl">
            Fuktkontroll av riskkonstruktion
          </h2>
        </div>
      </section>

      {loading ? (
        <section className="rounded-2xl border bg-white p-4 text-sm text-slate-600">
          Laddar fuktkontroll...
        </section>
      ) : null}

      {unsupported ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Fuktkontroll är inte aktiverad i databasen ännu. Kör migrationen innan registrering.
        </section>
      ) : null}

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </section>
      ) : null}

      {isInspectionLocked ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Besiktningen är låst. Fuktkontroll är skrivskyddad.
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
              <PlainInfoRow label="Uppdragsnummer" value={inspection.assignment_number ?? '-'} />
              <PlainInfoRow label="Adress" value={property.address ?? '-'} />
              <PlainInfoRow label="Byggnadstyp" value={form.building_type || '-'} />
              <PlainInfoRow label="Byggår" value={form.building_year || '-'} />
              <PlainInfoRow label="Tillbyggd" value={form.extension_note || '-'} />
              <PlainInfoRow label="Uppvärmning" value={form.heating || '-'} />
              <PlainInfoRow label="Ventilation" value={form.ventilation || '-'} />
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
            <TextInput
              label="Instrument (märke och modell)"
              value={form.measurement_instrument}
              onChange={(value) => updateField('measurement_instrument', value)}
              disabled={isInspectionLocked}
            />
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
              Kontrollplatser
            </h3>

            <div className="space-y-2">
              {form.rows.map((row, index) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <button
                    type="button"
                    onClick={() => openEditDialog(row)}
                    className="w-full text-left"
                    disabled={isInspectionLocked}
                  >
                    <div className="text-xs font-semibold text-slate-700">Kontrollplats {index + 1}</div>
                    <div className="text-sm text-slate-900">{row.location_label}</div>
                    <div className="text-xs text-slate-600">
                      {row.building_part || '-'} · {measurementTypeLabel(row.measurement_type)}
                      {row.measurement_value ? ` · ${row.measurement_value}` : ''}
                      {row.temperature_c ? ` · ${row.temperature_c} °C` : ''}
                    </div>
                    <div className="text-xs text-slate-600">{criticalLevelLabel(row.critical_level)}</div>
                  </button>
                  {!isInspectionLocked ? (
                    <div className="mt-2 flex justify-end">
                      <button
                        type="button"
                        onClick={() => deleteRow(row.id)}
                        className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100"
                      >
                        Ta bort
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}

              <button
                type="button"
                onClick={openCreateDialog}
                className="flex w-full items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-3 py-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
                disabled={unsupported || saving || isInspectionLocked}
              >
                Lägg till kontrollplats
              </button>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
              Kritiska nivåer
            </h3>
            <div className="space-y-1 text-sm text-slate-700">
              <div>Kritiskt värde relativ fuktighet (RF): 75 %</div>
              <div>Kritiskt värde fuktkvot (FK): 17 %</div>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Kommentar</h3>
            <TextArea
              label="Kommentar"
              value={form.comment}
              onChange={(value) => updateField('comment', value)}
              rows={4}
              disabled={isInspectionLocked}
            />
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">Signering</h3>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 text-sm text-slate-800 sm:grid-cols-2">
                <PlainInfoRow label="Ort" value={lockedPlaceName} />
                <PlainInfoRow label="Datum" value={lockedSignedDate} />
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start gap-3">
                  {inspectorAvatarSrc ? (
                    <img
                      src={inspectorAvatarSrc}
                      alt="Bild på besiktningsman"
                      className="h-14 w-14 rounded-full border border-slate-300 object-cover"
                    />
                  ) : (
                    <div
                      aria-labelledby={nameFallbackId}
                      className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-300 bg-slate-100 text-[10px] text-slate-500"
                    >
                      Ingen bild
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-1">
                    <div id={nameFallbackId} className="text-sm font-semibold text-slate-900">
                      {profile?.full_name ?? '-'}
                    </div>
                    {inspectorCardLines.map((line) => (
                      <div key={line} className="text-xs text-slate-600">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 gap-2 text-sm text-slate-800 sm:grid-cols-2">
                  <PlainInfoRow label="Besiktningsbolag" value={profile?.company_name ?? '-'} />
                  <PlainInfoRow label="Org.nr" value={profile?.company_orgno ?? '-'} />
                  <PlainInfoRow label="Telefon" value={profile?.phone ?? '-'} />
                  <PlainInfoRow label="E-post" value={profile?.email ?? '-'} />
                </div>
                {inspectorAddressLine ? (
                  <div className="mt-2 text-xs text-slate-600">{inspectorAddressLine}</div>
                ) : null}
              </div>
            </div>
          </section>
        </>
      ) : null}

      {isDialogOpen ? (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/50 p-3 md:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-4 shadow-xl">
            <h3 className="text-base font-semibold text-slate-900">
              {dialogState.mode === 'create' ? 'Lägg till kontrollplats' : 'Redigera kontrollplats'}
            </h3>

            <div className="mt-3 space-y-3">
              <TextInput
                label="Kontrollplats (våningsplan/rum)"
                value={dialogState.data.location_label}
                onChange={(value) => updateDialogField('location_label', value)}
              />
              <TextInput
                label="Byggdel/kontrollpunkt"
                value={dialogState.data.building_part}
                onChange={(value) => updateDialogField('building_part', value)}
              />
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Mätmetod</span>
                <select
                  value={dialogState.data.measurement_type}
                  onChange={(event) =>
                    updateDialogField('measurement_type', event.target.value as MoistureMeasurementType)
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="rf">RF</option>
                  <option value="fk">FK</option>
                  <option value="other">Annat</option>
                </select>
              </label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <TextInput
                  label="Värde"
                  value={dialogState.data.measurement_value}
                  onChange={(value) => updateDialogField('measurement_value', value)}
                  inputMode="decimal"
                />
                <TextInput
                  label="Temperatur (°C)"
                  value={dialogState.data.temperature_c}
                  onChange={(value) => updateDialogField('temperature_c', value)}
                  inputMode="decimal"
                />
              </div>
              <TextArea
                label="Anteckning"
                value={dialogState.data.note}
                onChange={(value) => updateDialogField('note', value)}
                rows={2}
              />
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">Kritisk nivå</span>
                <select
                  value={dialogState.data.critical_level}
                  onChange={(event) =>
                    updateDialogField('critical_level', event.target.value as MoistureCriticalLevel)
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="under">Under kritisk nivå</option>
                  <option value="over">Över kritisk nivå</option>
                </select>
              </label>
            </div>

            {dialogError ? <p className="mt-3 text-xs text-rose-700">{dialogError}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIsDialogOpen(false)
                  setDialogError(null)
                }}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Avbryt
              </button>
              <button
                type="button"
                onClick={saveDialogAndClose}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700"
              >
                Spara och stäng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function PlainInfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="text-sm text-slate-900">{value || '-'}</div>
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
