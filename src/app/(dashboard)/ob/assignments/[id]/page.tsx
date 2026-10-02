'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { AssignmentLinkIssueNotice } from '@/components/assignments/AssignmentLinkIssues'
import type { AssignmentLinkIssues } from '@/lib/assignments/linkIncidents'
import { ArrowLeft, BookOpen, ChevronsLeft } from 'lucide-react'
import Protected from '@/components/Protected'
import ObAssignmentWorkflowBoundary from '@/components/ob/ObAssignmentWorkflowBoundary'
import ObAcceptedAssignmentTerms from '@/components/ob/ObAcceptedAssignmentTerms'
import { ObFormField, ObFormSection } from '@/components/ob/ObFormPrimitives'
import '@/components/ob/ob-forms.css'
import '@/components/ob/ob-assignment-form.css'
import { validateObEarlyStartReason, type ObAssignmentWorkflow } from '@/lib/ob/assignmentWorkflow'
import { obInspectionProfileLabel, resolveObInspectionProfile, type ObInspectionProfileKey } from '@/lib/ob/inspectionProfile'

type AssignmentStatus =
  | 'draft'
  | 'sent'
  | 'ordered'
  | 'booked'
  | 'completed'
  | 'expired'
  | 'cancelled'
type AssignmentType = 'OB' | 'STATUS' | 'UHP' | 'EB'
type OrdererRole = ObInspectionProfileKey | ''

type AssignmentDetails = {
  id: string
  org_id: string
  status: AssignmentStatus
  archived_at: string | null
  assignment_type: AssignmentType
  assignment_details: Record<string, unknown> | null
  scope_description: string | null
  responsible_profile_id: string
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_postal_code: string | null
  customer_city: string | null
  customer_address: string | null
  preliminary_address: string | null
  preferred_date: string | null
  preferred_time: string | null
  price_amount: number | null
  currency: string
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  property_municipality: string | null
  property_owner_name: string | null
  cadastral_id: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
  invoice_name: string | null
  invoice_address: string | null
  orderer_role: string | null
  personal_identity_number: string | null
  notes_internal: string | null
  terms_version: string | null
  accepted_at: string | null
  booked_at: string | null
  property_id: string | null
  inspection_id: string | null
  converted_at: string | null
  created_at: string
  updated_at: string
  last_sent_at: string | null
}

type AssignmentAddonOrder = {
  id: string
  assignment_id: string
  org_id: string
  addon_service_id: string | null
  addon_key: string
  addon_name_snapshot: string
  price_amount_snapshot: number
  currency_snapshot: string
  created_at: string
}

type FormState = {
  assignmentType: AssignmentType
  status: AssignmentStatus
  cadastralId: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyOwnerName: string
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
  customerName: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  customerPhone: string
  customerEmail: string
  ordererRole: OrdererRole
  preferredDate: string
  preferredTime: string
  priceAmount: string
  statusCancellationFee: string
  scopeDescription: string
  invoiceName: string
  invoiceAddress: string
  personalIdentityNumber: string
  notesInternal: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonToErrorMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string') {
    return payload.error
  }
  return fallback
}

function roleToLabel(role: OrdererRole) {
  return role ? obInspectionProfileLabel(role) : ''
}

function assignmentStatusToLabel(status: AssignmentStatus) {
  switch (status) {
    case 'draft':
      return 'Utkast'
    case 'sent':
      return 'Skickad'
    case 'ordered':
      return 'Beställd'
    case 'booked':
      return 'Bokad'
    case 'completed':
      return 'Avklarad'
    case 'expired':
      return 'Utg\u00e5ngen'
    case 'cancelled':
      return 'Makulerad'
    default:
      return status
  }
}

function toFormState(assignment: AssignmentDetails): FormState {
  return {
    assignmentType: assignment.assignment_type,
    status: assignment.status,
    cadastralId: assignment.cadastral_id ?? '',
    propertyAddress: assignment.property_address ?? assignment.preliminary_address ?? '',
    propertyPostalCode: assignment.property_postal_code ?? '',
    propertyCity: assignment.property_city ?? '',
    propertyMunicipality: assignment.property_municipality ?? '',
    propertyOwnerName: assignment.property_owner_name ?? '',
    brfName: assignment.brf_name ?? '',
    apartmentNumber: assignment.apartment_number ?? '',
    apartmentHolderName: assignment.apartment_holder_name ?? '',
    customerName: assignment.customer_name ?? '',
    customerAddress: assignment.customer_address ?? '',
    customerPostalCode: assignment.customer_postal_code ?? '',
    customerCity: assignment.customer_city ?? '',
    customerPhone: assignment.customer_phone ?? '',
    customerEmail: assignment.customer_email ?? '',
    ordererRole: resolveObInspectionProfile(assignment) ?? '',
    preferredDate: assignment.preferred_date ?? '',
    preferredTime: assignment.preferred_time ?? '',
    priceAmount: assignment.price_amount !== null ? String(assignment.price_amount) : '',
    statusCancellationFee: assignment.assignment_details?.statusCancellationFee == null ? '' : String(assignment.assignment_details.statusCancellationFee),
    scopeDescription: assignment.scope_description ?? '',
    invoiceName: assignment.invoice_name ?? '',
    invoiceAddress: assignment.invoice_address ?? '',
    personalIdentityNumber: assignment.personal_identity_number ?? '',
    notesInternal: assignment.notes_internal ?? '',
  }
}

function formFingerprint(form: FormState) {
  return JSON.stringify(form)
}

export default function AssignmentDetailsPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const id = params.id

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [sending, setSending] = useState(false)
  const [booking, setBooking] = useState(false)
  const [converting, setConverting] = useState(false)
  const [earlyStartOpen, setEarlyStartOpen] = useState(false)
  const [earlyStartReason, setEarlyStartReason] = useState('')
  const [earlyStartConfirmed, setEarlyStartConfirmed] = useState(false)
  const earlyStartDialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (earlyStartOpen) earlyStartDialogRef.current?.showModal()
  }, [earlyStartOpen])
  const [reissuing, setReissuing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [assignment, setAssignment] = useState<AssignmentDetails | null>(null)
  const [addonOrders, setAddonOrders] = useState<AssignmentAddonOrder[]>([])
  const [linkIssues, setLinkIssues] = useState<AssignmentLinkIssues | null>(null)
  const [form, setForm] = useState<FormState | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const formRef = useRef<FormState | null>(null)
  const lastSavedFingerprintRef = useRef<string>('')

  useEffect(() => {
    formRef.current = form
  }, [form])

  const hasOrdererRole = Boolean(form?.ordererRole)
  const hasValidPrice = useMemo(() => {
    if (!form) return false
    const raw = form.priceAmount.trim()
    if (raw.length === 0) return false
    const parsed = Number(raw.replace(',', '.'))
    return Number.isFinite(parsed) && parsed >= 0
  }, [form])

  const canSend = assignment?.status === 'draft' && hasOrdererRole && hasValidPrice
  const canBook = assignment?.status === 'ordered' && !assignment.archived_at
  const canConvert = assignment?.status === 'booked' && !assignment.inspection_id
  const canStartEarly = assignment?.assignment_type === 'OB' && assignment.status === 'sent' && !assignment.inspection_id && !assignment.accepted_at && !assignment.archived_at
  const isSent = assignment?.status === 'sent'
  const isOrdered = assignment?.status === 'ordered'
  const isBookedLocked = assignment?.status === 'booked'
  const isEditingLocked = isSent || isOrdered || isBookedLocked
  const canReissue = isEditingLocked

  const loadAssignment = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      setSuccess(null)
      setAddonOrders([])

      const response = await fetch(`/api/ob/assignments/${id}`, { cache: 'no-store' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte hämta uppdraget.'))
      }

      const typedPayload = payload as {
        assignment: AssignmentDetails
        addonOrders?: AssignmentAddonOrder[]
        linkIssues?: AssignmentLinkIssues
      }
      const row = typedPayload.assignment
      const nextForm = toFormState(row)
      setAssignment(row)
      setAddonOrders(typedPayload.addonOrders ?? [])
      setLinkIssues(typedPayload.linkIssues ?? { available: false, items: [] })
      setForm(nextForm)
      lastSavedFingerprintRef.current = formFingerprint(nextForm)
      setSaveState('idle')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Kunde inte hämta uppdraget.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadAssignment()
  }, [loadAssignment])

  const handleWorkflowStatusChange = useCallback((workflow: ObAssignmentWorkflow) => {
    if (workflow.assignmentId === id && workflow.status !== assignment?.status) void loadAssignment()
  }, [id, assignment?.status, loadAssignment])

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
  }, [])

  const summary = useMemo(() => {
    if (!assignment) return null
    const approvedByCustomerAt = assignment.accepted_at
      ? new Date(assignment.accepted_at).toLocaleString('sv-SE')
      : 'Inte godkänd'
    const acceptedByInspectorAt = assignment.booked_at
      ? new Date(assignment.booked_at).toLocaleString('sv-SE')
      : 'Inte accepterad'
    const sentAt = assignment.last_sent_at
      ? new Date(assignment.last_sent_at).toLocaleString('sv-SE')
      : 'Ej skickad'
    return { approvedByCustomerAt, acceptedByInspectorAt, sentAt }
  }, [assignment])

  const addonSummary = useMemo(() => {
    const total = addonOrders.reduce((sum, row) => sum + row.price_amount_snapshot, 0)
    const currency = addonOrders[0]?.currency_snapshot || 'SEK'
    return {
      count: addonOrders.length,
      total: Number(total.toFixed(2)),
      currency,
    }
  }, [addonOrders])

  const updateField = (key: keyof FormState, value: string) => {
    if (isEditingLocked) return
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev))
  }

  const saveForm = useCallback(
    async (nextForm: FormState, options?: { silentValidation?: boolean }) => {
      if (isEditingLocked) return false
      const silentValidation = options?.silentValidation ?? false
      if (!EMAIL_REGEX.test(nextForm.customerEmail.trim())) {
        if (!silentValidation) setError('Ange en giltig kundmejl.')
        return false
      }

      const parsedPrice =
        nextForm.priceAmount.trim().length > 0
          ? Number(nextForm.priceAmount.trim().replace(',', '.'))
          : null
      if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
        if (!silentValidation) setError('Ange ett giltigt pris.')
        return false
      }
      const parsedCancellationFee = nextForm.statusCancellationFee.trim()
        ? Number(nextForm.statusCancellationFee.trim().replace(',', '.')) : null
      if (nextForm.ordererRole === 'status' && parsedCancellationFee !== null && (!Number.isFinite(parsedCancellationFee) || parsedCancellationFee < 0)) {
        if (!silentValidation) setError('Ange en giltig avbokningsavgift.')
        return false
      }

      try {
        setSaving(true)
        setSaveState('saving')
        setError(null)

        const response = await fetch(`/api/ob/assignments/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            assignment_type: nextForm.ordererRole === 'status' ? 'STATUS' : nextForm.assignmentType === 'STATUS' ? 'OB' : nextForm.assignmentType,
            status: nextForm.status,
            customer_name: nextForm.customerName,
            customer_email: nextForm.customerEmail,
            customer_phone: nextForm.customerPhone,
            customer_postal_code: nextForm.customerPostalCode,
            customer_city: nextForm.customerCity,
            customer_address: nextForm.customerAddress,
            property_address: nextForm.propertyAddress,
            property_postal_code: nextForm.propertyPostalCode,
            property_city: nextForm.propertyCity,
            preliminary_address: nextForm.propertyAddress,
            property_municipality: nextForm.propertyMunicipality,
            property_owner_name: nextForm.propertyOwnerName,
            cadastral_id: nextForm.cadastralId,
            brf_name: nextForm.brfName,
            apartment_number: nextForm.apartmentNumber,
            apartment_holder_name: nextForm.apartmentHolderName,
            preferred_date: nextForm.preferredDate,
            preferred_time: nextForm.preferredTime,
            price_amount: parsedPrice,
            ...(nextForm.ordererRole === 'status' ? { statusCancellationFee: parsedCancellationFee } : {}),
            ...(nextForm.ordererRole === 'status' ? { scopeDescription: nextForm.scopeDescription.trim() } : {}),
            currency: 'SEK',
            orderer_role: roleToLabel(nextForm.ordererRole),
            invoice_name: nextForm.invoiceName,
            invoice_address: nextForm.invoiceAddress,
            personal_identity_number: nextForm.personalIdentityNumber,
            notes_internal: nextForm.notesInternal,
          }),
        })

        const payload = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(jsonToErrorMessage(payload, 'Kunde inte spara uppdraget.'))
        }

        const updated = (payload as { assignment: AssignmentDetails }).assignment
        const requestFingerprint = formFingerprint(nextForm)
        const updatedForm = toFormState(updated)
        const updatedFingerprint = formFingerprint(updatedForm)
        const currentFingerprint = formRef.current ? formFingerprint(formRef.current) : ''

        setAssignment(updated)
        if (currentFingerprint === requestFingerprint) {
          setForm(updatedForm)
          formRef.current = updatedForm
          lastSavedFingerprintRef.current = updatedFingerprint
          setSaveState('saved')
        } else {
          lastSavedFingerprintRef.current = requestFingerprint
          setSaveState('idle')
        }
        return true
      } catch (saveError) {
        setSaveState('idle')
        setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara uppdraget.')
        return false
      } finally {
        setSaving(false)
      }
    },
    [id, isEditingLocked]
  )

  useEffect(() => {
    if (loading || !form || isEditingLocked || saving) return

    const nextFingerprint = formFingerprint(form)
    if (nextFingerprint === lastSavedFingerprintRef.current) return

    clearAutosaveTimer()

    setSaveState('idle')
    autosaveTimerRef.current = setTimeout(() => {
      void saveForm(form, { silentValidation: true })
    }, 650)

    return () => {
      clearAutosaveTimer()
    }
  }, [form, loading, saveForm, isEditingLocked, saving, clearAutosaveTimer])

  const handleSend = async () => {
    try {
      setSending(true)
      setError(null)
      setSuccess(null)
      clearAutosaveTimer()

      if (!form) {
        throw new Error('Uppdraget är inte färdigladdat.')
      }
      if (form.ordererRole === 'status' && !form.statusCancellationFee.trim()) {
        throw new Error('Ange avbokningsavgift för statusbesiktningen innan du skickar. Ange 0 om ingen avgift ska tas ut.')
      }
      if (form.ordererRole === 'status' && !form.scopeDescription.trim()) {
        throw new Error('Ange statusbesiktningens omfattning innan du skickar.')
      }

      const currentFingerprint = formFingerprint(form)
      if (currentFingerprint !== lastSavedFingerprintRef.current) {
        const saved = await saveForm(form)
        if (!saved) return
      }

      const response = await fetch(`/api/ob/assignments/${id}/send`, { method: 'POST' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte skicka uppdragsbekräftelsen.'))
      }
      await loadAssignment()
      setSuccess('Uppdragsbekräftelse skickad.')
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : 'Kunde inte skicka uppdragsbekräftelsen.'
      )
    } finally {
      setSending(false)
    }
  }

  const handleBook = async () => {
    try {
      setBooking(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/ob/assignments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'booked' }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte acceptera uppdraget.'))
      }

      const typedPayload = payload as { bookingEmailSent?: boolean } | null
      await loadAssignment()
      window.dispatchEvent(new Event('ob-assignment-workflow-updated'))
      if (typedPayload?.bookingEmailSent === false) {
        setSuccess('Uppdraget är nu accepterat. Mejlet kunde inte skickas automatiskt.')
      } else {
        setSuccess('Uppdraget är nu accepterat och bekräftelsemejl har skickats.')
      }
    } catch (bookError) {
      setError(bookError instanceof Error ? bookError.message : 'Kunde inte acceptera uppdraget.')
    } finally {
      setBooking(false)
    }
  }

  const handleConvert = async (early = false) => {
    if (assignment?.inspection_id && assignment.property_id) {
      router.push(`/properties/${assignment.property_id}/ob/${assignment.inspection_id}`)
      return
    }
    try {
      setConverting(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/ob/assignments/${id}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(early ? { earlyStartReason, confirmEarlyStart: earlyStartConfirmed } : {}),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte starta besiktning.'))
      }

      const body = payload as { propertyId?: string; inspectionId?: string }
      if (!body.propertyId || !body.inspectionId) {
        throw new Error('Konvertering saknar property/inspection-id.')
      }
      router.push(`/properties/${body.propertyId}/ob/${body.inspectionId}`)
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Kunde inte starta besiktning.')
    } finally {
      setConverting(false)
    }
  }

  const handleReissue = async () => {
    try {
      setReissuing(true)
      setError(null)
      setSuccess(null)

      const response = await fetch(`/api/ob/assignments/${id}/reissue`, {
        method: 'POST',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(jsonToErrorMessage(payload, 'Kunde inte skapa ny version.'))
      }

      const body = payload as { assignmentId?: string }
      if (!body.assignmentId) {
        throw new Error('Saknar id för ny uppdragsbekräftelse.')
      }
      router.push(`/ob/assignments/${body.assignmentId}`)
    } catch (reissueError) {
      setError(reissueError instanceof Error ? reissueError.message : 'Kunde inte skapa ny version.')
    } finally {
      setReissuing(false)
    }
  }
  return (
    <Protected>
      <main className="ob-form-shell ob-assignment-page">
        <div className="ob-assignment-shell space-y-4">
          <header className="ob-form-root ob-form-compact ob-assignment-header">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/ob')}
                aria-label="Till huvudsidan"
                title="Till huvudsidan"
                className="ob-assignment-nav"
              >
                <ChevronsLeft size={15} strokeWidth={2.2} />
              </button>
              <button
                type="button"
                onClick={() => router.push('/ob/assignments')}
                aria-label="Tillbaka"
                title="Tillbaka"
                className="ob-assignment-nav"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
              <h1>Uppdragsbekräftelse</h1>
              <div className="ob-assignment-actions">
                <span className="ob-assignment-save-status" role="status">
                  {saveState === 'saving' ? 'Sparar...' : saveState === 'saved' ? 'Sparat' : ''}
                </span>
                {assignment?.status === 'draft' ? (
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!canSend || sending || booking || converting || reissuing || saving || loading}
                    title="Skickar uppdragsbekräftelsen till kunden för godkännande."
                    className="obm-primary"
                  >
                    {sending ? 'Skickar...' : 'Skicka uppdragsbekräftelse'}
                  </button>
                ) : null}
                {canReissue ? (
                  <button
                    type="button"
                    onClick={() => void handleReissue()}
                    disabled={reissuing || sending || booking || converting || saving || loading}
                    title="Skapar en ny utkastversion baserad på befintliga uppgifter. Du kan redigera den och sedan skicka för nytt godkännande."
                  >
                    {reissuing ? 'Skapar ny...' : 'Skicka om uppdragsbekräftelse'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => void handleBook()}
                  disabled={!canBook || booking || sending || converting || reissuing || saving || loading}
                  title="Accepterar uppdraget som besiktningsman och skickar full beställningsbekräftelse."
                >
                  {booking ? 'Accepterar...' : 'Acceptera uppdrag'}
                </button>
                {!canStartEarly ? <button
                  type="button"
                  onClick={() => void handleConvert()}
                  disabled={(!canConvert && !assignment?.inspection_id) || converting || booking || sending || reissuing || saving || loading}
                  title="Startar besiktningen och öppnar besiktningsvyn."
                  className="obm-primary"
                >
                  {converting ? 'Startar...' : assignment?.inspection_id ? 'Öppna besiktning' : 'Starta besiktning'}
                </button> : null}
                {canStartEarly ? <button type="button" onClick={() => setEarlyStartOpen(true)}
                  disabled={converting || booking || sending || reissuing || saving || loading}
                >
                  Starta före godkännande
                </button> : null}
              </div>
            </div>
          </header>

          {earlyStartOpen ? <dialog ref={earlyStartDialogRef} aria-labelledby="early-start-title"
            onCancel={event => { if (converting) event.preventDefault(); else setEarlyStartOpen(false) }}
            className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg space-y-4 overflow-y-auto rounded-lg border border-amber-200 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40">
              <h2 id="early-start-title" className="text-lg font-semibold">Starta före kundens godkännande</h2>
              <p className="text-sm text-slate-700">Kundens godkännande saknas. Du kan dokumentera besiktningen. Slutmarkering, låsning och slutligt utlåtande är spärrade tills uppdraget är godkänt, accepterat och avstämt.</p>
              <label className="block text-sm font-medium">Anledning till tidig start
                <textarea autoFocus value={earlyStartReason} onChange={event => setEarlyStartReason(event.target.value)} maxLength={1000} disabled={converting}
                  className="mt-1 min-h-24 w-full rounded-lg border border-slate-300 p-2 text-slate-900" />
              </label>
              <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={earlyStartConfirmed} disabled={converting} onChange={event => setEarlyStartConfirmed(event.target.checked)} />
                Jag bekräftar att besiktningen startas innan kundens godkännande har registrerats.
              </label>
              {error ? <p role="alert" className="text-sm text-rose-700">{error}</p> : null}
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" disabled={converting} onClick={() => setEarlyStartOpen(false)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-700">Avbryt</button>
                <button type="button" disabled={converting || !earlyStartConfirmed || !validateObEarlyStartReason(earlyStartReason)} onClick={() => void handleConvert(true)}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 font-medium text-amber-900 hover:bg-amber-100 disabled:bg-slate-100 disabled:text-slate-600">
                  {converting ? 'Startar...' : 'Starta före godkännande'}
                </button>
              </div>
          </dialog> : null}
          {assignment?.inspection_id ? <ObAssignmentWorkflowBoundary key={assignment.inspection_id} inspectionId={assignment.inspection_id} onStatusChange={handleWorkflowStatusChange} /> : null}
          <AssignmentLinkIssueNotice issues={linkIssues} />

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}
          {success ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              {success}
            </div>
          ) : null}
          {isBookedLocked ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Uppdragsbekräftelsen är bokad och låst för redigering.
            </div>
          ) : isOrdered ? (
            <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3 text-sm text-indigo-800">
              Uppdragsbekräftelsen är beställd och låst för redigering. Klicka på Acceptera uppdrag eller Skicka om uppdragsbekräftelse.
            </div>
          ) : isSent ? (
            <div className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
              Uppdragsbekräftelsen är skickad och låst för redigering. Klicka på Skicka om uppdragsbekräftelse för att skapa en ny redigerbar version.
            </div>
          ) : null}

          {loading || !form || !assignment ? (
            <div role="status" className="py-5 text-sm text-gray-700">
              Laddar uppdrag...
            </div>
          ) : (
            <>
              <section className="ob-form-root ob-form-compact ob-assignment-form">
                <dl className="ob-assignment-summary">
                  <ReadOnly label="Status" value={assignmentStatusToLabel(assignment.status)} />
                  <ReadOnly label="Skickad" value={summary?.sentAt ?? '-'} />
                  <ReadOnly label="Godkänd (kund)" value={summary?.approvedByCustomerAt ?? '-'} />
                  <ReadOnly
                    label="Accepterad (besiktningsman)"
                    value={summary?.acceptedByInspectorAt ?? '-'}
                  />
                </dl>
                {['OB', 'STATUS'].includes(assignment.assignment_type) && assignment.accepted_at ? (
                  <a href="#approved-terms" className="inline-flex min-h-11 items-center gap-2 text-sm text-blue-700 underline underline-offset-4">
                    <BookOpen className="h-4 w-4" aria-hidden="true" />
                    Läs godkända villkor
                  </a>
                ) : null}
                <fieldset
                  className="ob-assignment-columns"
                  disabled={isEditingLocked || sending}
                  aria-label="Uppdragsdata"
                >
                  <ObFormSection title="Objekt">
                    <Field
                      label="Adress"
                      value={form.propertyAddress}
                      onChange={(value) => updateField('propertyAddress', value)}
                    />
                    <div className="ob-form-pair">
                      <Field
                        label="Postnummer"
                        value={form.propertyPostalCode}
                        onChange={(value) => updateField('propertyPostalCode', value)}
                      />
                      <Field
                        label="Ort"
                        value={form.propertyCity}
                        onChange={(value) => updateField('propertyCity', value)}
                      />
                    </div>
                    <Field
                      label="Kommun"
                      value={form.propertyMunicipality}
                      onChange={(value) => updateField('propertyMunicipality', value)}
                    />
                    {form.ordererRole === 'apartment' ? (
                      <>
                        <Field
                          label="Bostadsrättsförening"
                          value={form.brfName}
                          onChange={(value) => updateField('brfName', value)}
                        />
                        <Field
                          label="Lägenhetsnummer"
                          value={form.apartmentNumber}
                          onChange={(value) => updateField('apartmentNumber', value)}
                        />
                        <Field
                          label="Bostadsrättsinnehavare"
                          value={form.apartmentHolderName}
                          onChange={(value) => updateField('apartmentHolderName', value)}
                        />
                      </>
                    ) : (
                      <>
                        <Field
                          label="Fastighetsbeteckning"
                          value={form.cadastralId}
                          onChange={(value) => updateField('cadastralId', value)}
                        />
                        <Field
                          label="Fastighetsägare"
                          value={form.propertyOwnerName}
                          onChange={(value) => updateField('propertyOwnerName', value)}
                        />
                      </>
                    )}
                  </ObFormSection>

                  <ObFormSection title="Uppdragsgivare">
                    <Field
                      label="Namn"
                      value={form.customerName}
                      onChange={(value) => updateField('customerName', value)}
                    />
                    <Field
                      label="Adress"
                      value={form.customerAddress}
                      onChange={(value) => updateField('customerAddress', value)}
                    />
                    <div className="ob-form-pair">
                      <Field
                        label="Postnummer"
                        value={form.customerPostalCode}
                        onChange={(value) => updateField('customerPostalCode', value)}
                      />
                      <Field
                        label="Ort"
                        value={form.customerCity}
                        onChange={(value) => updateField('customerCity', value)}
                      />
                    </div>
                    <div className="ob-form-pair">
                      <Field
                        label="Telefon"
                        value={form.customerPhone}
                        onChange={(value) => updateField('customerPhone', value)}
                        type="tel"
                      />
                      <Field
                        label="E-post"
                        value={form.customerEmail}
                        onChange={(value) => updateField('customerEmail', value)}
                        type="email"
                      />
                    </div>
                  </ObFormSection>

                <ObFormSection title="Besiktningsuppdrag" className="ob-assignment-schedule">
                  <fieldset className="min-w-0 space-y-1">
                    <legend className="ob-form-label">Typ av uppdrag</legend>
                    <div className="flex flex-wrap gap-x-5">
                      <RoleChoice label="Köparbesiktning" active={form.ordererRole === 'buyer'} onChange={() => updateField('ordererRole', 'buyer')} />
                      <RoleChoice label="Säljarbesiktning" active={form.ordererRole === 'seller'} onChange={() => updateField('ordererRole', 'seller')} />
                      <RoleChoice label="Lägenhetsbesiktning" active={form.ordererRole === 'apartment'} onChange={() => updateField('ordererRole', 'apartment')} />
                      <RoleChoice label="Statusbesiktning" active={form.ordererRole === 'status'} onChange={() => updateField('ordererRole', 'status')} />
                    </div>
                  </fieldset>
                  {form.ordererRole === 'status' && <Field
                    label="Besiktningens omfattning *"
                    value={form.scopeDescription}
                    onChange={(value) => updateField('scopeDescription', value)}
                  />}
                  <div className="ob-form-pair">
                    <Field
                      label="Datum"
                      value={form.preferredDate}
                      onChange={(value) => updateField('preferredDate', value)}
                      type="date"
                    />
                    <Field
                      label="Tid"
                      value={form.preferredTime}
                      onChange={(value) => updateField('preferredTime', value)}
                      type="time"
                    />
                  </div>
                  <Field
                    label="Pris (SEK)"
                    value={form.priceAmount}
                    onChange={(value) => updateField('priceAmount', value)}
                    type="number"
                    step="0.01"
                    min="0"
                  />
                  {form.ordererRole === 'status' && <Field
                    label="Avbokningsavgift (SEK) *"
                    value={form.statusCancellationFee}
                    onChange={(value) => updateField('statusCancellationFee', value)}
                    type="number"
                    step="0.01"
                    min="0"
                  />}
                </ObFormSection>
                </fieldset>

                <ObFormSection title="Beställda tilläggsuppdrag">
                  {addonOrders.length === 0 ? (
                    <p className="text-sm text-gray-600">Inga tilläggsuppdrag är valda ännu.</p>
                  ) : (
                    <div className="space-y-3">
                      <div className="overflow-x-auto border-y border-gray-200">
                        <table className="min-w-full text-sm">
                          <thead>
                            <tr className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-600">
                              <th className="px-3 py-2">Tjänst</th>
                              <th className="px-3 py-2">Pris</th>
                            </tr>
                          </thead>
                          <tbody>
                            {addonOrders.map((order) => (
                              <tr key={order.id} className="border-t border-gray-100">
                                <td className="px-3 py-2 text-gray-900">{order.addon_name_snapshot}</td>
                                <td className="px-3 py-2 text-gray-800">
                                  {order.price_amount_snapshot.toLocaleString('sv-SE', {
                                    minimumFractionDigits: 0,
                                    maximumFractionDigits: 2,
                                  })}{' '}
                                  {order.currency_snapshot}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="py-2 text-sm">
                        Valda tilläggsuppdrag: <strong>{addonSummary.count}</strong>
                        {' · '}
                        Summa:{' '}
                        <strong>
                          {addonSummary.total.toLocaleString('sv-SE', {
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 2,
                          })}{' '}
                          {addonSummary.currency}
                        </strong>
                      </div>
                    </div>
                  )}
                </ObFormSection>
              </section>
              {['OB', 'STATUS'].includes(assignment.assignment_type) && assignment.accepted_at ? (
                <ObAcceptedAssignmentTerms
                  key={`${assignment.id}:${assignment.accepted_at}`}
                  assignmentId={assignment.id}
                />
              ) : null}
            </>
          )}
        </div>
      </main>
    </Protected>
  )
}

function RoleChoice({
  label,
  active,
  onChange,
}: {
  label: string
  active: boolean
  onChange: () => void
}) {
  return (
    <label className="ob-form-choice">
      <input type="radio" name="assignment-role" checked={active} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  step,
  min,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'date' | 'time' | 'email' | 'tel' | 'number'
  step?: string
  min?: string
}) {
  const id = useId()
  return (
    <ObFormField label={label} id={id}>
      <input
        id={id}
        type={type}
        value={value}
        step={step}
        min={min}
        onChange={(event) => onChange(event.target.value)}
      />
    </ObFormField>
  )
}

function ReadOnly({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <dt className="ob-form-label">{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}


