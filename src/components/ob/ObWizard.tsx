'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import ObStepGrunddata from './ObStepGrunddata'
import ObStepHandlingar from './ObStepHandlingar'
import ObStepForutsattningar from './ObStepForutsattningar'
import ObStepUtsida from './ObStepUtsida'
import ObStepInsida from './ObStepInsida'
import type { Tables } from '@/types/supabase'

type DbInspection = Tables<'inspections'>
type DbProperty = Tables<'properties'>

export type ObWizardInspectionInput = DbInspection & {
  defect_disclosures?: string | null
  attendees_other?: string | null
}

export type ObWizardInspection = DbInspection & {
  defect_disclosures: string | null
  attendees_other: string | null
}

export type ObWizardPropertyInput = Partial<DbProperty> & Pick<DbProperty, 'id' | 'name'>
export type ObWizardProperty = DbProperty

export type TenureType = Tables<'properties'>['tenure_type']
export type DwellingType = Tables<'properties'>['dwelling_type']
export type InspectionSide = Tables<'inspections'>['inspection_side']

export type ObSectionKey =
  | 'overview'
  | 'delivery'
  | 'grunddata'
  | 'handlingar'
  | 'forutsattningar'
  | 'utsida'
  | 'insida'
  | 'risk'
  | 'ftu'

interface ObWizardProps {
  property: ObWizardPropertyInput
  inspection: ObWizardInspectionInput
  activeSection: ObSectionKey
  onPropertyUpdated?: (p: ObWizardProperty) => void
  onInspectionUpdated?: (i: ObWizardInspection) => void
}

type ReportDeliveryHistoryRow = {
  id: string
  recipient_email: string
  status: 'pending' | 'sent' | 'failed'
  sent_at: string | null
  created_at: string
  error_message: string | null
  subject: string
}

type ReportDeliveryMeta = {
  inspectionId: string
  inspectionStatus: string
  canSend: boolean
  reason: string | null
  defaultRecipientEmail: string | null
  ordererEmail: string | null
  history: ReportDeliveryHistoryRow[]
}

type ReportDeliverySendResponse = {
  inspectionId: string
  inspectionStatus: string
  deliveryMode: 'link_only' | 'link_pdf'
  publicLink: string
  primaryRecipientEmail: string
  defaultRecipientEmail: string | null
  ordererEmail: string | null
  sentRecipients: string[]
  failedRecipients: Array<{ email: string; error: string }>
  history: ReportDeliveryHistoryRow[]
  linkId: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isValidUuid = (value?: string | null) => !!value && UUID_RE.test(value)

function parseExtraRecipientsInput(value: string) {
  const unique = new Set<string>()
  value
    .split(/[\n,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .forEach((email) => unique.add(email))
  return Array.from(unique)
}

function isValidEmail(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value.trim())
}

export default function ObWizard({
  property,
  inspection,
  activeSection,
  onPropertyUpdated,
  onInspectionUpdated,
}: ObWizardProps) {
  const normalizedProperty = useMemo<ObWizardProperty>(
    () => ({
      id: property.id,
      name: property.name ?? '',
      address: property.address ?? null,
      area_m2: property.area_m2 ?? null,
      area_sqm: property.area_sqm ?? null,
      cadastral_id: property.cadastral_id ?? null,
      city: property.city ?? null,
      client_name: property.client_name ?? null,
      contact_person: property.contact_person ?? null,
      cover_path: property.cover_path ?? null,
      created_at: property.created_at ?? null,
      dwelling_type: property.dwelling_type ?? null,
      heating: property.heating ?? null,
      last_inspected: property.last_inspected ?? null,
      last_inspection_at: property.last_inspection_at ?? null,
      municipality: property.municipality ?? null,
      owner: property.owner ?? '',
      owner_name: property.owner_name ?? null,
      planning_status: property.planning_status ?? null,
      plot_area_m2: property.plot_area_m2 ?? null,
      postal_code: property.postal_code ?? null,
      property_type: property.property_type ?? null,
      roof_type: property.roof_type ?? null,
      status: property.status ?? null,
      tax_value: property.tax_value ?? null,
      tenure_type: property.tenure_type ?? null,
      type_code: property.type_code ?? null,
      ventilation: property.ventilation ?? null,
      year_built: property.year_built ?? null,
    }),
    [property]
  )

  // Säkerställ att attendees_other aldrig är undefined
  const normalizedInspection = useMemo<ObWizardInspection>(
    () => ({
      ...inspection,
      attendees_other: inspection.attendees_other ?? null,
      defect_disclosures: inspection.defect_disclosures ?? null,
    }),
    [inspection]
  )

  useEffect(() => {
    console.log('ObWizard activeSection =', activeSection)
  }, [activeSection])

  const propertyId = normalizedProperty.id ?? null
  const inspectionId = normalizedInspection.id ?? null
  const hasValidIds = isValidUuid(propertyId) && isValidUuid(inspectionId)

  const [deliveryMeta, setDeliveryMeta] = useState<ReportDeliveryMeta | null>(null)
  const [deliveryMetaLoading, setDeliveryMetaLoading] = useState(false)
  const [deliveryMetaError, setDeliveryMetaError] = useState<string | null>(null)
  const [primaryRecipientInput, setPrimaryRecipientInput] = useState('')
  const [extraRecipientsInput, setExtraRecipientsInput] = useState('')
  const [sendingReport, setSendingReport] = useState(false)
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [deliveryResult, setDeliveryResult] = useState<string | null>(null)

  useEffect(() => {
    if (activeSection !== 'delivery' || !hasValidIds || !inspectionId) return

    let cancelled = false

    const loadDeliveryMeta = async () => {
      setDeliveryMetaLoading(true)
      setDeliveryMetaError(null)

      try {
        const response = await fetch(`/api/ob/inspections/${inspectionId}/report-delivery`, {
          cache: 'no-store',
        })
        const payload = (await response.json().catch(() => null)) as
          | (ReportDeliveryMeta & { error?: string })
          | { error?: string }
          | null

        if (!response.ok) {
          throw new Error(
            (payload && 'error' in payload ? payload.error : null) ??
              'Kunde inte läsa utskicksstatus.'
          )
        }

        if (cancelled) return
        setDeliveryMeta(payload as ReportDeliveryMeta)
      } catch (error) {
        if (cancelled) return
        const message =
          error instanceof Error ? error.message : 'Kunde inte läsa utskicksstatus.'
        setDeliveryMetaError(message)
        setDeliveryMeta(null)
      } finally {
        if (!cancelled) setDeliveryMetaLoading(false)
      }
    }

    void loadDeliveryMeta()

    return () => {
      cancelled = true
    }
  }, [activeSection, hasValidIds, inspectionId])

  useEffect(() => {
    if (!deliveryMeta?.defaultRecipientEmail) return
    setPrimaryRecipientInput((prev) =>
      prev.trim() ? prev : deliveryMeta.defaultRecipientEmail ?? ''
    )
  }, [deliveryMeta?.defaultRecipientEmail])

  const handleSendInspectionReport = async () => {
    if (!hasValidIds || !inspectionId) return

    setSendingReport(true)
    setDeliveryError(null)
    setDeliveryResult(null)

    const extraRecipients = parseExtraRecipientsInput(extraRecipientsInput)

    try {
      const response = await fetch(`/api/ob/inspections/${inspectionId}/report-delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          primary_recipient: primaryRecipientInput,
          extra_recipients: extraRecipients,
        }),
      })

      const rawBody = await response.text()
      let payload: unknown = null
      if (rawBody) {
        try {
          payload = JSON.parse(rawBody)
        } catch {
          payload = null
        }
      }
      const parsedPayload = payload as
        | (ReportDeliverySendResponse & { error?: string })
        | { error?: string; failedRecipients?: Array<{ email: string; error: string }> }
        | null

      if (!response.ok) {
        const plainErrorText =
          parsedPayload == null && rawBody.trim()
            ? rawBody.trim().replace(/\s+/g, ' ').slice(0, 240)
            : null
        const statusHint =
          response.status === 504
            ? ' Tidsgränsen i servern nåddes (timeout).'
            : ` (HTTP ${response.status})`
        const baseError =
          (parsedPayload && 'error' in parsedPayload ? parsedPayload.error : null) ??
          plainErrorText ??
          `Kunde inte skicka utlåtandet.${statusHint}`
        const failedList =
          parsedPayload &&
          'failedRecipients' in parsedPayload &&
          Array.isArray(parsedPayload.failedRecipients)
            ? parsedPayload.failedRecipients
            : []
        const failedText =
          failedList.length > 0
            ? ` Misslyckade mottagare: ${failedList.map((row) => row.email).join(', ')}.`
            : ''
        throw new Error(`${baseError}${failedText}`)
      }

      const okPayload = parsedPayload as ReportDeliverySendResponse

      if (onInspectionUpdated && okPayload.inspectionStatus) {
        onInspectionUpdated({
          ...normalizedInspection,
          status: okPayload.inspectionStatus,
        } as ObWizardInspection)
      }

      setDeliveryMeta((prev) => ({
        inspectionId: okPayload.inspectionId,
        inspectionStatus: okPayload.inspectionStatus,
        canSend: prev?.canSend ?? true,
        reason: prev?.reason ?? null,
        defaultRecipientEmail: okPayload.defaultRecipientEmail ?? null,
        ordererEmail: okPayload.ordererEmail,
        history: okPayload.history ?? [],
      }))
      setPrimaryRecipientInput(okPayload.primaryRecipientEmail ?? '')

      const failedText =
        okPayload.failedRecipients.length > 0
          ? ` Vissa extra mottagare misslyckades: ${okPayload.failedRecipients
              .map((row) => row.email)
              .join(', ')}.`
          : ''
      setDeliveryResult(
        `Utlåtandet skickades till ${okPayload.sentRecipients.length} mottagare.${failedText} Länk: ${okPayload.publicLink}`
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte skicka utlåtandet.'
      setDeliveryError(message)
    } finally {
      setSendingReport(false)
    }
  }

  const reportHref = hasValidIds
    ? `/utlatande/${propertyId}/${inspectionId}`
    : ''
  const reportWebPreviewHref = hasValidIds
    ? `/rapport/preview/${inspectionId}`
    : ''
  const newTabHref = reportHref
  const autoPrintHref = hasValidIds ? `${reportHref}?autoprint=1` : ''
  const pdfV2Href = hasValidIds
    ? `/utlatande-v2/${propertyId}/${inspectionId}`
    : ''
  const iframeSrc = hasValidIds ? `${reportHref}?embed=1` : ''

  switch (activeSection) {
    case 'overview':
      {
        return (
          <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Granska utlåtande</h2>
            <p>
              Här visas utlåtandet i förhandsgranskning. Använd knapparna för att öppna i ny flik eller skriva ut.
            </p>
            
            {hasValidIds ? (
              <>
                <div className="flex flex-wrap items-center gap-2 print:hidden">
                  <Link
                    href={newTabHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                  >
                    Öppna i ny flik
                  </Link>
                  <Link
                    href={autoPrintHref}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-black"
                  >
                    Skriv ut
                  </Link>
                  <Link
                    href={pdfV2Href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm hover:bg-blue-100"
                  >
                    PDF V.2
                  </Link>
                </div>

                <div className="rounded-xl border bg-gray-100 p-3">
                  <div className="flex justify-center">
                    <div className="overflow-auto rounded-lg border border-gray-300 bg-white shadow">
                      <iframe
                        title="Utlåtande"
                        src={iframeSrc}
                        className="w-full"
                        style={{
                          width: '210mm',
                          maxWidth: '100%',
                          minHeight: '320mm',
                          border: '0',
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    Om förhandsgranskningen inte visas kan du{' '}
                    <Link href={reportHref} target="_blank" rel="noreferrer" className="underline">
                      öppna utlåtandet här
                    </Link>
                    .
                  </div>
                </div>
                <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-900">
                  Utskicket är flyttat till sektionen <strong>Skicka utlåtande</strong> i sidomenyn.
                </div>
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Utlåtande kan inte öppnas innan fastighet och besiktning är valda.
              </div>
            )}
          </div>
        )
      }

    case 'delivery':
      {
        return (
          <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Skicka utlåtande</h2>
            <p>
              Granska utlåtandet och skicka sedan som länk till en låst snapshotsida.
            </p>

            {hasValidIds ? (
              <>
                <div className="rounded-xl border bg-gray-100 p-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 print:hidden">
                    <Link
                      href={reportWebPreviewHref}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-semibold text-gray-800 shadow-sm hover:bg-gray-50"
                    >
                      Öppna webbgranskning i ny flik
                    </Link>
                  </div>

                  <div className="flex justify-center">
                    <div className="overflow-auto rounded-lg border border-gray-300 bg-white shadow">
                      <iframe
                        title="Utlåtande för granskning"
                        src={reportWebPreviewHref}
                        className="w-full"
                        style={{
                          width: '100%',
                          maxWidth: '100%',
                          minHeight: '540px',
                          border: '0',
                        }}
                      />
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-gray-600">
                    Om förhandsgranskningen inte visas kan du{' '}
                    <Link
                      href={reportWebPreviewHref}
                      target="_blank"
                      rel="noreferrer"
                      className="underline"
                    >
                      öppna utlåtandet här
                    </Link>
                    .
                  </div>
                </div>

                <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-3 space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">Skicka utlåtande</h3>
                    <p className="mt-1 text-xs text-gray-600">
                      Skicksatt: <strong>Lank</strong>. Ange huvudmottagare.
                    </p>
                  </div>

                  {deliveryMetaLoading ? (
                    <div className="rounded-md border border-gray-200 bg-white p-2 text-xs text-gray-600">
                      Hämtar mottagarinformation...
                    </div>
                  ) : null}

                  {deliveryMetaError ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      {deliveryMetaError}
                    </div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="space-y-1">
                      <span className="text-xs font-medium text-gray-700">Huvudmottagare (obligatorisk)</span>
                      <input
                        type="email"
                        value={primaryRecipientInput}
                        onChange={(event) => setPrimaryRecipientInput(event.target.value)}
                        placeholder="namn@epost.se"
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                      <div className="text-[11px] text-gray-500">
                        Beställare från uppdragsbekräftelse:{' '}
                        {deliveryMeta?.ordererEmail ? (
                          <span className="font-medium text-gray-700">{deliveryMeta.ordererEmail}</span>
                        ) : (
                          'Saknas'
                        )}
                      </div>
                    </label>

                    <label className="space-y-1">
                      <span className="text-xs font-medium text-gray-700">Extra mottagare</span>
                      <textarea
                        value={extraRecipientsInput}
                        onChange={(event) => setExtraRecipientsInput(event.target.value)}
                        rows={3}
                        placeholder="namn@epost.se, annan@epost.se"
                        className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </label>
                  </div>

                  {deliveryMeta && !deliveryMeta.canSend ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      {deliveryMeta.reason ?? 'Utskicket är låst för den här besiktningen.'}
                    </div>
                  ) : null}

                  {deliveryError ? (
                    <div className="rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700">
                      {deliveryError}
                    </div>
                  ) : null}

                  {deliveryResult ? (
                    <div className="rounded-md border border-green-200 bg-green-50 p-2 text-xs text-green-800">
                      {deliveryResult}
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleSendInspectionReport()}
                      disabled={
                        sendingReport ||
                        deliveryMetaLoading ||
                        !isValidEmail(primaryRecipientInput) ||
                        deliveryMeta?.canSend === false
                      }
                      className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {sendingReport ? 'Skickar utlåtande...' : 'Skicka utlåtande'}
                    </button>
                  </div>

                  {deliveryMeta?.history?.length ? (
                    <div className="rounded-md border border-gray-200 bg-white p-2">
                      <div className="mb-1 text-xs font-semibold text-gray-800">Senaste utskick</div>
                      <ul className="space-y-1 text-xs text-gray-700">
                        {deliveryMeta.history.slice(0, 5).map((row) => (
                          <li key={row.id} className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{row.recipient_email}</span>
                            <span
                              className={
                                row.status === 'sent'
                                  ? 'rounded bg-green-100 px-1.5 py-0.5 text-green-800'
                                  : row.status === 'failed'
                                    ? 'rounded bg-red-100 px-1.5 py-0.5 text-red-800'
                                    : 'rounded bg-gray-100 px-1.5 py-0.5 text-gray-700'
                              }
                            >
                              {row.status}
                            </span>
                            <span className="text-gray-500">
                              {row.sent_at
                                ? new Date(row.sent_at).toLocaleString('sv-SE')
                                : new Date(row.created_at).toLocaleString('sv-SE')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Utskicket kan inte användas innan fastighet och besiktning är valda.
              </div>
            )}
          </div>
        )
      }

    case 'grunddata':
      return (
        <ObStepGrunddata
          property={normalizedProperty}
          inspection={normalizedInspection}
          onPropertyUpdated={onPropertyUpdated}
          onInspectionUpdated={onInspectionUpdated}
        />
      )

    case 'handlingar':
      return (
        <ObStepHandlingar
          property={normalizedProperty}
          inspection={normalizedInspection}
        />
      )

    case 'forutsattningar':
      return (
        <ObStepForutsattningar
          property={normalizedProperty}
          inspection={normalizedInspection}
        />
      )

    case 'utsida':
      return <ObStepUtsida inspection={normalizedInspection} />

    case 'insida':
      return <ObStepInsida inspection={normalizedInspection} />

    case 'risk':
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-1">
          <h2 className="text-base font-semibold text-gray-900">Riskanalys</h2>
          <p>
            Riskanalys-steget kommer att kopplas till risk-/FTU-databasen.
          </p>
        </div>
      )

    case 'ftu':
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-700 space-y-1">
          <h2 className="text-base font-semibold text-gray-900">
            Fortsatt teknisk utredning (FTU)
          </h2>
          <p>
            Här kommer systemet sammanställa FTU-punkter utifrån risker.
          </p>
        </div>
      )

    default:
      return (
        <div className="rounded-xl border bg-white p-4 text-sm text-gray-600">
          <p>
            Steget{' '}
            <span className="font-mono">
              {activeSection ?? '(okänt värde)'}
            </span>{' '}
            är ännu inte byggt.
          </p>
        </div>
      )
  }
}



