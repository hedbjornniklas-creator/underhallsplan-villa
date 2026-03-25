'use client'

import {
  type ChangeEvent,
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

type MoistureControlRowImage = {
  id: string
  moisture_control_row_id: string
  inspection_id: string
  org_id: string
  file_path: string
  sort_order: number
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
  row_images?: Array<Record<string, unknown>>
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
  const generatedId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `row-${Date.now()}-${index}`
  return {
    id: generatedId,
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

  return `${base}/storage/v1/object/public/inspection-images/${path}`
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
  return value === 'over' ? 'Ã–ver kritisk nivÃ¥' : 'Under kritisk nivÃ¥'
}

export default function ObStepFuktkontroll({ property, inspection }: ObStepFuktkontrollProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [unsupported, setUnsupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [profile, setProfile] = useState<ProfileSnapshot | null>(null)
  const [rowImages, setRowImages] = useState<Record<string, MoistureControlRowImage[]>>({})
  const [imageBusyByRowId, setImageBusyByRowId] = useState<Record<string, boolean>>({})
  const [persistedRowIds, setPersistedRowIds] = useState<Set<string>>(new Set())
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
          throw new Error(payload?.error ?? 'Kunde inte lÃ¤sa fuktkontroll.')
        }

        if (cancelled) return
        const nextForm = toInitialForm({
          control: payload?.control ?? null,
          rows: Array.isArray(payload?.rows) ? payload.rows : [],
          defaults: payload?.defaults ?? null,
          property,
        })
        const nextPersistedRowIds = new Set(
          (Array.isArray(payload?.rows) ? payload.rows : [])
            .map((row) => String((row as Record<string, unknown>).id ?? '').trim())
            .filter((value) => value.length > 0)
        )

        setUnsupported(payload?.unsupported === true)
        setProfile((payload?.profile as ProfileSnapshot | null) ?? null)
        setForm(nextForm)
        setPersistedRowIds(nextPersistedRowIds)
        const nextRowImages: Record<string, MoistureControlRowImage[]> = {}
        const rowImagesInput = Array.isArray(payload?.row_images) ? payload.row_images : []
        rowImagesInput.forEach((rawImage) => {
          const image = rawImage as Record<string, unknown>
          const rowId = String(image.moisture_control_row_id ?? '').trim()
          const imageId = String(image.id ?? '').trim()
          const filePath = String(image.file_path ?? '').trim()
          if (!rowId || !imageId || !filePath) return
          const sortOrder = Number(image.sort_order ?? 0)
          const nextImage: MoistureControlRowImage = {
            id: imageId,
            moisture_control_row_id: rowId,
            inspection_id: String(image.inspection_id ?? inspection.id),
            org_id: String(image.org_id ?? ''),
            file_path: filePath,
            sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
          }
          const bucket = nextRowImages[rowId] ?? []
          bucket.push(nextImage)
          nextRowImages[rowId] = bucket
        })
        Object.keys(nextRowImages).forEach((rowId) => {
          nextRowImages[rowId] = nextRowImages[rowId].sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
          )
        })
        setRowImages(nextRowImages)
        setImageBusyByRowId({})
        lastSavedFingerprintRef.current = formFingerprint(nextForm)
        hydratedRef.current = true
        setSaveState('idle')
      } catch (loadError) {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Kunde inte lÃ¤sa fuktkontroll.')
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
              id: row.id,
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

        const payload = (await response.json().catch(() => null)) as
          | { error?: string; rows?: Array<Record<string, unknown>> }
          | null
        if (!response.ok) {
          throw new Error(payload?.error ?? 'Kunde inte spara fuktkontroll.')
        }

        if (Array.isArray(payload?.rows)) {
          setPersistedRowIds(
            new Set(
              payload.rows
                .map((row) => String((row as Record<string, unknown>).id ?? '').trim())
                .filter((value) => value.length > 0)
            )
          )
          const rowIdMap = new Map<string, string>()
          payload.rows.forEach((rawRow, index) => {
            const row = rawRow as Record<string, unknown>
            const incomingId = String(nextForm.rows[index]?.id ?? '').trim()
            const savedId = String(row.id ?? '').trim()
            if (incomingId && savedId && incomingId !== savedId) {
              rowIdMap.set(incomingId, savedId)
            }
          })
          if (rowIdMap.size > 0) {
            setRowImages((prev) => {
              const next = { ...prev }
              rowIdMap.forEach((savedId, incomingId) => {
                if (incomingId === savedId) return
                const existing = next[incomingId] ?? []
                delete next[incomingId]
                next[savedId] = (next[savedId] ?? []).concat(
                  existing.map((image) => ({ ...image, moisture_control_row_id: savedId }))
                )
              })
              return next
            })
            setForm((prev) => ({
              ...prev,
              rows: prev.rows.map((row) => ({
                ...row,
                id: rowIdMap.get(row.id) ?? row.id,
              })),
            }))
          }
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

  const dialogRowId = dialogState.data.id
  const isDialogRowPersisted = persistedRowIds.has(dialogRowId)
  const dialogRowImages = dialogRowId ? rowImages[dialogRowId] ?? [] : []
  const isDialogImageBusy = dialogRowId ? Boolean(imageBusyByRowId[dialogRowId]) : false
  const isDialogImageDisabled =
    isInspectionLocked || unsupported || !isDialogRowPersisted || isDialogImageBusy

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
    setRowImages((prev) => {
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
    setImageBusyByRowId((prev) => {
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
    setPersistedRowIds((prev) => {
      if (!prev.has(rowId)) return prev
      const next = new Set(prev)
      next.delete(rowId)
      return next
    })
  }

  const setRowImageBusy = (rowId: string, isBusy: boolean) => {
    setImageBusyByRowId((prev) => {
      if (isBusy) return { ...prev, [rowId]: true }
      if (!prev[rowId]) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })
  }

  const handleUploadImageForRow = async (rowId: string, file: File) => {
    if (isInspectionLocked || unsupported) return
    if (!rowId) return

    try {
      setRowImageBusy(rowId, true)
      setError(null)

      const formData = new FormData()
      formData.set('row_id', rowId)
      formData.set('file', file)

      const response = await fetch(`/api/ob/inspections/${inspection.id}/moisture-control/images`, {
        method: 'POST',
        body: formData,
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; image?: Record<string, unknown> | null }
        | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte ladda upp bild.')
      }

      const rawImage = payload?.image
      const imageId = String(rawImage?.id ?? '').trim()
      const filePath = String(rawImage?.file_path ?? '').trim()
      if (!imageId || !filePath) return

      const sortOrder = Number(rawImage?.sort_order ?? 0)
      const nextImage: MoistureControlRowImage = {
        id: imageId,
        moisture_control_row_id: rowId,
        inspection_id: String(rawImage?.inspection_id ?? inspection.id),
        org_id: String(rawImage?.org_id ?? ''),
        file_path: filePath,
        sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
      }

      setRowImages((prev) => {
        const current = prev[rowId] ?? []
        const withoutSameId = current.filter((image) => image.id !== nextImage.id)
        return {
          ...prev,
          [rowId]: [...withoutSameId, nextImage].sort(
            (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
          ),
        }
      })
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Kunde inte ladda upp bild.')
    } finally {
      setRowImageBusy(rowId, false)
    }
  }

  const handleDeleteImageForRow = async (rowId: string, imageId: string) => {
    if (isInspectionLocked || unsupported) return
    if (!rowId || !imageId) return

    try {
      setRowImageBusy(rowId, true)
      setError(null)

      const response = await fetch(`/api/ob/inspections/${inspection.id}/moisture-control/images`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_id: imageId }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte ta bort bild.')
      }

      setRowImages((prev) => {
        const current = prev[rowId] ?? []
        const nextRowImages = current.filter((image) => image.id !== imageId)
        return {
          ...prev,
          [rowId]: nextRowImages,
        }
      })
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Kunde inte ta bort bild.')
    } finally {
      setRowImageBusy(rowId, false)
    }
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
          Fuktkontroll Ã¤r inte aktiverad i databasen Ã¤nnu. KÃ¶r migrationen innan registrering.
        </section>
      ) : null}

      {error ? (
        <section className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {error}
        </section>
      ) : null}

      {isInspectionLocked ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Besiktningen Ã¤r lÃ¥st. Fuktkontroll Ã¤r skrivskyddad.
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
              <PlainInfoRow label="ByggÃ¥r" value={form.building_year || '-'} />
              <PlainInfoRow label="Tillbyggd" value={form.extension_note || '-'} />
              <PlainInfoRow label="UppvÃ¤rmning" value={form.heating || '-'} />
              <PlainInfoRow label="Ventilation" value={form.ventilation || '-'} />
              <TextArea
                label="Ã–vrigt"
                value={form.object_other}
                onChange={(value) => updateField('object_other', value)}
                rows={2}
                disabled={isInspectionLocked}
              />
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">MÃ¤tning</h3>
            <TextInput
              label="Instrument (mÃ¤rke och modell)"
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
                      {row.building_part || '-'} Â· {measurementTypeLabel(row.measurement_type)}
                      {row.measurement_value ? ` Â· ${row.measurement_value}` : ''}
                      {row.temperature_c ? ` Â· ${row.temperature_c} Â°C` : ''}
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
                LÃ¤gg till kontrollplats
              </button>
            </div>
          </section>

          <section className="rounded-2xl border bg-white p-4 shadow-sm md:p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-700">
              Kritiska nivÃ¥er
            </h3>
            <div className="space-y-1 text-sm text-slate-700">
              <div>Kritiskt vÃ¤rde relativ fuktighet (RF): 75 %</div>
              <div>Kritiskt vÃ¤rde fuktkvot (FK): 17 %</div>
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
                      alt="Bild pÃ¥ besiktningsman"
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
              {dialogState.mode === 'create' ? 'LÃ¤gg till kontrollplats' : 'Redigera kontrollplats'}
            </h3>

            <div className="mt-3 space-y-3">
              <TextInput
                label="Kontrollplats (vÃ¥ningsplan/rum)"
                value={dialogState.data.location_label}
                onChange={(value) => updateDialogField('location_label', value)}
              />
              <TextInput
                label="Byggdel/kontrollpunkt"
                value={dialogState.data.building_part}
                onChange={(value) => updateDialogField('building_part', value)}
              />
              <label className="space-y-1">
                <span className="text-xs font-medium text-slate-600">MÃ¤tmetod</span>
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
                  label="VÃ¤rde"
                  value={dialogState.data.measurement_value}
                  onChange={(value) => updateDialogField('measurement_value', value)}
                  inputMode="decimal"
                />
                <TextInput
                  label="Temperatur (Â°C)"
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
                <span className="text-xs font-medium text-slate-600">Kritisk nivÃ¥</span>
                <select
                  value={dialogState.data.critical_level}
                  onChange={(event) =>
                    updateDialogField('critical_level', event.target.value as MoistureCriticalLevel)
                  }
                  className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                >
                  <option value="under">Under kritisk nivÃ¥</option>
                  <option value="over">Ã–ver kritisk nivÃ¥</option>
                </select>
              </label>
              {!isDialogRowPersisted ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Spara kontrollplatsen forst. Oppna dialogen igen for att lagga till bilder.
                </div>
              ) : null}

              <RowImagesSection
                rowId={dialogRowId}
                images={dialogRowImages}
                busy={isDialogImageBusy}
                disabled={isDialogImageDisabled}
                onUpload={(file) => {
                  if (!dialogRowId) return
                  void handleUploadImageForRow(dialogRowId, file)
                }}
                onDelete={(imageId) => {
                  if (!dialogRowId) return
                  void handleDeleteImageForRow(dialogRowId, imageId)
                }}
              />
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
                Spara och stÃ¤ng
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

type RowImagesSectionProps = {
  rowId: string
  images: MoistureControlRowImage[]
  busy: boolean
  disabled: boolean
  onUpload: (file: File) => void
  onDelete: (imageId: string) => void
}

function RowImagesSection({
  rowId,
  images,
  busy,
  disabled,
  onUpload,
  onDelete,
}: RowImagesSectionProps) {
  const cameraInputRef = useRef<HTMLInputElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (disabled) return
    const file = event.target.files?.[0]
    if (!file) return
    onUpload(file)
    event.target.value = ''
  }

  return (
    <section className="mt-3 space-y-2 border-t border-slate-200 pt-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold text-slate-700">Bilder (kontrollplats)</div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={disabled}
            className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Kamera
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="rounded-full border border-slate-300 bg-white px-2 py-0.5 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Fil
          </button>
        </div>
      </div>

      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        disabled={disabled}
      />

      {busy ? <div className="text-[11px] text-slate-500">Arbetar med bild...</div> : null}
      {images.length === 0 ? (
        <div className="text-[11px] text-slate-500">Inga bilder for denna kontrollplats.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => {
            const imageUrl = resolveInspectionImageUrl(image.file_path)
            if (!imageUrl) return null
            return (
              <div
                key={`${rowId}-${image.id}`}
                className="relative h-16 w-16 overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
              >
                <img src={imageUrl} alt="Kontrollplatsbild" className="h-full w-full object-cover" />
                {!disabled ? (
                  <button
                    type="button"
                    onClick={() => onDelete(image.id)}
                    className="absolute right-0.5 top-0.5 rounded-full bg-slate-900/75 px-1 text-[9px] text-white"
                  >
                    Ã—
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </section>
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
