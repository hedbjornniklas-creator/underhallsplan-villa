'use client'

import Link from 'next/link'
import GettingStarted from '@/components/besiktapp/GettingStarted'
import AssignmentCustomerSelector, {
  type AssignmentCustomerBinding,
} from '@/components/customers/AssignmentCustomerSelector'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CalendarDays,
  IdCard,
  FilePlus2,
  Loader2,
  Mail,
  Play,
  Plus,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import PendingLink from '@/components/ui/PendingLink'
import TuOverview from './TuOverview'
import { canStartTuOverviewAssignment, type TuOverviewInvestigation } from '@/lib/tu/overview'
import '../ob/ob-home.css'
import type { OrganizationCustomer } from '@/lib/customers/domain'
import { normalizeOrganizationCustomerIdentity } from '@/lib/customers/domain'
import { tuReportAuthoringModeLabel } from '@/lib/tu/authoring'
import type {
  TuAssignmentListItem,
  TuInspectionSummary,
  TuInspectorProfileCard,
  TuReportTemplateOption,
} from '@/lib/tu/server'

type TuFormState = {
  objectType: 'villa' | 'apartment'
  customerType: 'consumer' | 'business'
  customerAddressMatchesObject: boolean
  customerIdentityNumber: string
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  invoiceEmail: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyOwnerName: string
  cadastralId: string
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
  scopeDescription: string
  preferredDate: string
  preferredTime: string
  priceAmount: string
  notesInternal: string
}

type ScratchFormState = {
  reportTemplateKey: string
  objectType: 'villa' | 'apartment'
  title: string
  scopeDescription: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyOwnerName: string
  cadastralId: string
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
  customerAddressMatchesObject: boolean
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  invoiceEmail: string
  date: string
  time: string
}

const EMPTY_TU_FORM: TuFormState = {
  objectType: 'villa',
  customerType: 'consumer',
  customerAddressMatchesObject: false,
  customerIdentityNumber: '',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  customerAddress: '',
  customerPostalCode: '',
  customerCity: '',
  invoiceEmail: '',
  propertyAddress: '',
  propertyPostalCode: '',
  propertyCity: '',
  propertyMunicipality: '',
  propertyOwnerName: '',
  cadastralId: '',
  brfName: '',
  apartmentNumber: '',
  apartmentHolderName: '',
  scopeDescription: '',
  preferredDate: '',
  preferredTime: '',
  priceAmount: '',
  notesInternal: '',
}

const EMPTY_SCRATCH_FORM: ScratchFormState = {
  reportTemplateKey: '',
  objectType: 'villa',
  title: '',
  scopeDescription: '',
  propertyAddress: '',
  propertyPostalCode: '',
  propertyCity: '',
  propertyMunicipality: '',
  propertyOwnerName: '',
  cadastralId: '',
  brfName: '',
  apartmentNumber: '',
  apartmentHolderName: '',
  customerAddressMatchesObject: false,
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  customerAddress: '',
  customerPostalCode: '',
  customerCity: '',
  invoiceEmail: '',
  date: '',
  time: '',
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function getAssignmentAddress(item: TuAssignmentListItem) {
  const line = item.property_address ?? item.preliminary_address
  const postalCity = [item.property_postal_code, item.property_city].filter(Boolean).join(' ')
  const apartmentObject = [item.brf_name, item.apartment_number ? `lgh ${item.apartment_number}` : null]
    .filter(Boolean)
    .join(', ')
  const address = [line, postalCity].filter(Boolean).join(', ')
  const objectReference = apartmentObject || item.cadastral_id
  return [address, objectReference].filter(Boolean).join(' - ') || 'Adress saknas'
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function organizationUrl(path: string, organizationId: string) {
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}orgId=${encodeURIComponent(organizationId)}`
}

const CUSTOMER_BINDING_FORM_KEYS = new Set<keyof TuFormState>([
  'customerType',
  'customerIdentityNumber',
  'customerAddressMatchesObject',
  'customerName',
  'customerEmail',
  'customerPhone',
  'customerAddress',
  'customerPostalCode',
  'customerCity',
  'invoiceEmail',
])

const CUSTOMER_ADDRESS_SOURCE_KEYS = new Set<keyof TuFormState>([
  'propertyAddress',
  'propertyPostalCode',
  'propertyCity',
])

export default function TuDashboardClient({
  organizationId,
  organizationName,
  initialAssignments,
  initialInvestigations,
  initialReportTemplates,
  inspectorProfile,
  initialError,
}: {
  organizationId: string
  organizationName: string | null
  initialAssignments: TuAssignmentListItem[]
  initialInvestigations: TuInspectionSummary[]
  initialReportTemplates: TuReportTemplateOption[]
  inspectorProfile: TuInspectorProfileCard | null
  initialError: string | null
}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState(initialAssignments)
  const [investigations, setInvestigations] = useState<TuOverviewInvestigation[]>(initialInvestigations)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState(initialError)
  const overviewRequest = useRef<AbortController | null>(null)
  const [reportTemplates] = useState(initialReportTemplates)
  const [form, setForm] = useState<TuFormState>(EMPTY_TU_FORM)
  const [scratchForm, setScratchForm] = useState<ScratchFormState>(EMPTY_SCRATCH_FORM)
  const [dialog, setDialog] = useState<'quick' | 'scratch' | null>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<TuAssignmentListItem | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [customerBinding, setCustomerBinding] = useState<AssignmentCustomerBinding | null>(null)
  const savedCustomerAddressRef = useRef({
    customerAddress: '',
    customerPostalCode: '',
    customerCity: '',
  })
  const savedScratchCustomerAddressRef = useRef({
    customerAddress: '',
    customerPostalCode: '',
    customerCity: '',
  })

  const refreshOverview = useCallback(async () => {
    overviewRequest.current?.abort()
    const controller = new AbortController()
    overviewRequest.current = controller
    setOverviewLoading(true)
    try {
      const [assignmentResponse, investigationResponse] = await Promise.all([
        fetch(organizationUrl('/api/tu/assignments', organizationId), { cache: 'no-store', signal: controller.signal }),
        fetch(organizationUrl('/api/tu/investigations', organizationId), { cache: 'no-store', signal: controller.signal }),
      ])
      const [assignmentPayload, investigationPayload] = await Promise.all([
        assignmentResponse.json(), investigationResponse.json(),
      ])
      if (!assignmentResponse.ok || !investigationResponse.ok
        || assignmentPayload.org?.id !== organizationId || investigationPayload.org?.id !== organizationId
        || !Array.isArray(assignmentPayload.items) || !Array.isArray(investigationPayload.items)) {
        throw new Error('Overview unavailable')
      }
      if (controller.signal.aborted) return
      // Update both halves together so a converted assignment cannot appear twice during refresh.
      setAssignments(assignmentPayload.items)
      setInvestigations(investigationPayload.items)
      setOverviewError(null)
    } catch {
      if (!controller.signal.aborted) setOverviewError('Kunde inte uppdatera uppdragslistan. Försök igen.')
    } finally {
      if (overviewRequest.current === controller) {
        overviewRequest.current = null
        setOverviewLoading(false)
      }
    }
  }, [organizationId])

  useEffect(() => {
    void refreshOverview()
    return () => { overviewRequest.current?.abort(); overviewRequest.current = null }
  }, [refreshOverview])

  const cancelOverviewRefresh = () => {
    overviewRequest.current?.abort()
    overviewRequest.current = null
    setOverviewLoading(false)
  }

  const updateForm = <K extends keyof TuFormState>(key: K, value: TuFormState[K]) => {
    setError(null)
    if (
      CUSTOMER_BINDING_FORM_KEYS.has(key) ||
      (form.customerAddressMatchesObject && CUSTOMER_ADDRESS_SOURCE_KEYS.has(key))
    ) {
      setCustomerBinding(null)
    }
    setForm((current) => {
      if (key === 'customerType') {
        return {
          ...current,
          customerType: value as TuFormState['customerType'],
          customerIdentityNumber: '',
        }
      }
      if (key === 'customerAddressMatchesObject') {
        if (value) {
          savedCustomerAddressRef.current = {
            customerAddress: current.customerAddress,
            customerPostalCode: current.customerPostalCode,
            customerCity: current.customerCity,
          }
          return {
            ...current,
            customerAddressMatchesObject: true,
            customerAddress: current.propertyAddress,
            customerPostalCode: current.propertyPostalCode,
            customerCity: current.propertyCity,
          }
        }

        return {
          ...current,
          customerAddressMatchesObject: false,
          ...savedCustomerAddressRef.current,
        }
      }

      const next = { ...current, [key]: value }
      if (!current.customerAddressMatchesObject) return next

      if (key === 'propertyAddress') next.customerAddress = value as string
      if (key === 'propertyPostalCode') next.customerPostalCode = value as string
      if (key === 'propertyCity') next.customerCity = value as string
      return next
    })
  }

  const useExistingCustomer = (customer: OrganizationCustomer) => {
    savedCustomerAddressRef.current = {
      customerAddress: customer.address ?? '',
      customerPostalCode: customer.postalCode ?? '',
      customerCity: customer.city ?? '',
    }
    setForm((current) => ({
      ...current,
      customerType: customer.customerType === 'business' ? 'business' : 'consumer',
      customerIdentityNumber: customer.identityNumber ?? '',
      customerAddressMatchesObject: false,
      customerName: customer.name,
      customerEmail: customer.email ?? '',
      customerPhone: customer.phone ?? '',
      customerAddress: customer.address ?? '',
      customerPostalCode: customer.postalCode ?? '',
      customerCity: customer.city ?? '',
      invoiceEmail: customer.invoiceSameAsCustomer ? '' : customer.invoiceEmail ?? '',
    }))
  }

  const updateScratchForm = <K extends keyof ScratchFormState>(key: K, value: ScratchFormState[K]) => {
    setError(null)
    setScratchForm((current) => {
      if (key === 'customerAddressMatchesObject') {
        if (value) {
          savedScratchCustomerAddressRef.current = {
            customerAddress: current.customerAddress,
            customerPostalCode: current.customerPostalCode,
            customerCity: current.customerCity,
          }
          return {
            ...current,
            customerAddressMatchesObject: true,
            customerAddress: current.propertyAddress,
            customerPostalCode: current.propertyPostalCode,
            customerCity: current.propertyCity,
          }
        }

        return {
          ...current,
          customerAddressMatchesObject: false,
          ...savedScratchCustomerAddressRef.current,
        }
      }

      const next = { ...current, [key]: value }
      if (!current.customerAddressMatchesObject) return next

      if (key === 'propertyAddress') next.customerAddress = value as string
      if (key === 'propertyPostalCode') next.customerPostalCode = value as string
      if (key === 'propertyCity') next.customerCity = value as string
      return next
    })
  }

  const updateScratchTemplate = (reportTemplateKey: string) => {
    setError(null)
    setScratchForm((current) => {
      const previousTemplate = reportTemplates.find((template) => template.key === current.reportTemplateKey)
      const nextTemplate = reportTemplates.find((template) => template.key === reportTemplateKey)
      const shouldUseTemplateTitle =
        !current.title.trim() ||
        current.title === previousTemplate?.documentTitle ||
        current.title === 'Teknisk utredning'

      return {
        ...current,
        reportTemplateKey,
        title: shouldUseTemplateTitle && nextTemplate ? nextTemplate.documentTitle : current.title,
      }
    })
  }

  const openCreationDialog = (nextDialog: 'quick' | 'scratch') => {
    setError(null)
    setNotice(null)
    setDialog(nextDialog)
  }

  const switchToDirectCreation = () => {
    setScratchForm((current) => ({
      ...current,
      objectType: form.objectType,
      scopeDescription: form.scopeDescription,
      propertyAddress: form.propertyAddress,
      propertyPostalCode: form.propertyPostalCode,
      propertyCity: form.propertyCity,
      propertyMunicipality: form.propertyMunicipality,
      propertyOwnerName: form.propertyOwnerName,
      cadastralId: form.cadastralId,
      brfName: form.brfName,
      apartmentNumber: form.apartmentNumber,
      apartmentHolderName: form.apartmentHolderName,
      customerAddressMatchesObject: form.customerAddressMatchesObject,
      customerName: form.customerName,
      customerEmail: form.customerEmail,
      customerPhone: form.customerPhone,
      customerAddress: form.customerAddress,
      customerPostalCode: form.customerPostalCode,
      customerCity: form.customerCity,
      invoiceEmail: form.invoiceEmail,
      date: form.preferredDate,
      time: form.preferredTime,
    }))
    openCreationDialog('scratch')
  }

  const switchToConfirmation = () => {
    setCustomerBinding(null)
    setForm((current) => ({
      ...current,
      objectType: scratchForm.objectType,
      scopeDescription: scratchForm.scopeDescription,
      propertyAddress: scratchForm.propertyAddress,
      propertyPostalCode: scratchForm.propertyPostalCode,
      propertyCity: scratchForm.propertyCity,
      propertyMunicipality: scratchForm.propertyMunicipality,
      propertyOwnerName: scratchForm.propertyOwnerName,
      cadastralId: scratchForm.cadastralId,
      brfName: scratchForm.brfName,
      apartmentNumber: scratchForm.apartmentNumber,
      apartmentHolderName: scratchForm.apartmentHolderName,
      customerAddressMatchesObject: scratchForm.customerAddressMatchesObject,
      customerName: scratchForm.customerName,
      customerEmail: scratchForm.customerEmail,
      customerPhone: scratchForm.customerPhone,
      customerAddress: scratchForm.customerAddress,
      customerPostalCode: scratchForm.customerPostalCode,
      customerCity: scratchForm.customerCity,
      invoiceEmail: scratchForm.invoiceEmail,
      preferredDate: scratchForm.date,
      preferredTime: scratchForm.time,
    }))
    openCreationDialog('quick')
  }

  const submitAssignment = async (sendNow: boolean) => {

    if (!form.customerEmail.trim() || !EMAIL_REGEX.test(form.customerEmail.trim())) {
      setError('Ange en giltig beställarmejl.')
      setNotice(null)
      return
    }
    if (form.invoiceEmail.trim() && !EMAIL_REGEX.test(form.invoiceEmail.trim())) {
      setError('Ange en giltig fakturae-post.')
      setNotice(null)
      return
    }
    const customerIdentityType = form.customerType === 'business' ? 'business' : 'private'
    const normalizedIdentity = normalizeOrganizationCustomerIdentity(
      form.customerIdentityNumber,
      customerIdentityType
    )
    if (form.customerType === 'business' && !normalizedIdentity) {
      setError('Ange ett giltigt organisationsnummer innan kunden kopplas.')
      setNotice(null)
      return
    }
    if (form.customerType === 'consumer' && form.customerIdentityNumber.trim() && !normalizedIdentity) {
      setError('Personnumret har inte ett giltigt format.')
      setNotice(null)
      return
    }
    if (!customerBinding) {
      setError('Välj en befintlig kund eller bekräfta att en ny kund ska skapas.')
      setNotice(null)
      return
    }
    if (customerBinding.mode === 'create' && !form.customerName.trim()) {
      setError('Ange kundens namn innan en ny kund skapas.')
      setNotice(null)
      return
    }
    if (sendNow && !form.scopeDescription.trim()) {
      setError('Beskriv vad den tekniska utredningen ska omfatta.')
      setNotice(null)
      return
    }
    if (sendNow && !form.priceAmount.trim()) {
      setError('Ange pris innan uppdragsbekräftelsen skickas.')
      setNotice(null)
      return
    }

    cancelOverviewRefresh()
    setBusy(sendNow ? 'quick-send' : 'draft')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(sendNow ? '/api/tu/assignments/quick-send' : '/api/tu/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orgId: organizationId,
          ...form,
          customerBinding:
            customerBinding.mode === 'create'
              ? {
                  ...customerBinding,
                  identityNumber: normalizedIdentity,
                }
              : customerBinding,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skapa TU-uppdrag.')

      const assignmentResponse = await fetch(
        organizationUrl('/api/tu/assignments', organizationId),
        { cache: 'no-store' }
      )
      const assignmentPayload = await assignmentResponse.json().catch(() => ({}))
      if (
        assignmentResponse.ok &&
        assignmentPayload.org?.id === organizationId &&
        Array.isArray(assignmentPayload.items)
      ) {
        setAssignments(assignmentPayload.items)
      }

      setNotice(
        sendNow && payload.deliveryFailed === true
          ? 'Uppdraget och kunden sparades, men mejlet kunde inte skickas. Försök igen från det sparade uppdraget.'
          : sendNow
            ? 'Uppdragsbekräftelsen är skickad.'
            : 'Uppdraget sparades som utkast.'
      )
      setForm(EMPTY_TU_FORM)
      setCustomerBinding(null)
      setDialog(null)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa TU-uppdrag.')
    } finally {
      setBusy(null)
    }
  }

  const createScratchInvestigation = async () => {
    if (!scratchForm.reportTemplateKey.trim()) {
      setError('Välj en mall innan utredningen skapas.')
      setNotice(null)
      return
    }

    if (!scratchForm.customerEmail.trim() || !EMAIL_REGEX.test(scratchForm.customerEmail.trim())) {
      setError('Ange en giltig kontaktmejl.')
      setNotice(null)
      return
    }
    if (scratchForm.invoiceEmail.trim() && !EMAIL_REGEX.test(scratchForm.invoiceEmail.trim())) {
      setError('Ange en giltig fakturae-post.')
      setNotice(null)
      return
    }

    const missingVillaObject = scratchForm.objectType === 'villa' && !scratchForm.cadastralId.trim()
    const missingApartmentObject =
      scratchForm.objectType === 'apartment' &&
      (!scratchForm.brfName.trim() || !scratchForm.apartmentNumber.trim())

    if (missingVillaObject || missingApartmentObject) {
      setError(
        scratchForm.objectType === 'apartment'
          ? 'Ange BRF och lägenhetsnummer innan utredningen startas.'
          : 'Ange fastighetsbeteckning innan utredningen startas.'
      )
      setNotice(null)
      return
    }

    setBusy('scratch')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch('/api/tu/investigations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: organizationId, ...scratchForm }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skapa TU-utredning.')
      setScratchForm(EMPTY_SCRATCH_FORM)
      setDialog(null)
      router.push(
        organizationUrl(`/tu/investigations/${payload.inspectionId}`, organizationId)
      )
    } catch (scratchError) {
      setError(scratchError instanceof Error ? scratchError.message : 'Kunde inte skapa TU-utredning.')
    } finally {
      setBusy(null)
    }
  }

  const startInvestigationFromAssignment = async (reportTemplateKey: string) => {
    if (!selectedAssignment || !canStartTuOverviewAssignment(selectedAssignment)) return
    if (!reportTemplateKey.trim()) {
      setError('Välj en mall innan utredningen startas.')
      setNotice(null)
      return
    }

    setBusy(`assignment-${selectedAssignment.id}`)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/tu/assignments/${selectedAssignment.id}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: organizationId, reportTemplateKey }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; inspectionId?: string }
        | null
      if (!response.ok) throw new Error(payload?.error ?? 'Kunde inte starta utredning.')
      if (!payload?.inspectionId) throw new Error('Konverteringen saknar utrednings-id.')
      setSelectedAssignment(null)
      router.push(
        organizationUrl(`/tu/investigations/${payload.inspectionId}`, organizationId)
      )
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Kunde inte starta utredning.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Protected>
      <main className="obo-home min-h-screen">
        <div className="obo-home-inner mx-auto w-full p-4 md:p-6">
          <GettingStarted module="tu" onStart={() => openCreationDialog('scratch')} heading={<>
            <Link href="/dashboard-v1" aria-label="Tillbaka" title="Tillbaka"
              className="inline-flex items-center justify-center rounded border border-gray-300 bg-white text-gray-700">
              <ArrowLeft size={20} aria-hidden />
            </Link>
            <div className="min-w-0 flex-1">
              <h1>Tekniska utredningar</h1>
              <p className="mt-1 text-sm text-gray-600">{organizationName || 'Vald arbetsorganisation'}</p>
            </div>
          </>} />

          <section className="obh" aria-label="TU-åtgärder">
            <div className="obh-actions">
              <button type="button" className="obh-primary" disabled={Boolean(busy)} onClick={() => openCreationDialog('scratch')}>
                <Plus size={20} aria-hidden /><span>Ny utredning</span>
              </button>
              <button type="button" disabled={Boolean(busy)} onClick={() => openCreationDialog('quick')}>
                <FilePlus2 size={20} aria-hidden /><span>Skapa uppdragsbekräftelse</span>
              </button>
              <nav className="obh-list-links" aria-label="TU-listor och profil">
                <PendingLink href={organizationUrl('/tu/assignments', organizationId)} autoPending pendingLabel="Öppnar bekräftelser...">Alla uppdragsbekräftelser</PendingLink>
                <PendingLink href={organizationUrl('/tu/investigations', organizationId)} autoPending pendingLabel="Öppnar utredningar...">Alla utredningar</PendingLink>
                <PendingLink href={organizationUrl('/settings/profil', organizationId)} autoPending pendingLabel="Öppnar visitkort..."
                  icon={<IdCard size={18} aria-hidden />}>Visitkort</PendingLink>
              </nav>
            </div>
          </section>

          {inspectorProfile && !inspectorProfile.organizationConfigured && <p className="mt-4 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Spara ett eget visitkort för den här organisationen innan du skickar TU-dokument.
          </p>}
          {error && !dialog && !selectedAssignment ? (
            <div role="alert" className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div>
          ) : null}
          {notice ? (
            <div role="status" className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>
          ) : null}

          <TuOverview
            organizationId={organizationId}
            assignments={assignments}
            investigations={investigations}
            loading={overviewLoading}
            error={overviewError}
            busy={Boolean(busy)}
            onRefresh={() => { void refreshOverview() }}
            onStartAssignment={(assignment) => {
              setError(null)
              setSelectedAssignment(assignment)
            }}
          />
        </div>

        {dialog === 'quick' ? (
          <QuickAssignmentDialog
            organizationId={organizationId}
            form={form}
            customerBinding={customerBinding}
            busy={busy}
            error={error}
            onClose={() => {
              setError(null)
              setDialog(null)
            }}
            onChange={updateForm}
            onCustomerBindingChange={setCustomerBinding}
            onUseCustomer={useExistingCustomer}
            onModeChange={switchToDirectCreation}
            onSubmit={submitAssignment}
          />
        ) : null}

        {dialog === 'scratch' ? (
          <ScratchInvestigationDialog
            form={scratchForm}
            reportTemplates={reportTemplates}
            busy={busy}
            error={error}
            onClose={() => {
              setError(null)
              setDialog(null)
            }}
            onChange={updateScratchForm}
            onTemplateChange={updateScratchTemplate}
            onModeChange={switchToConfirmation}
            onSubmit={createScratchInvestigation}
          />
        ) : null}

        {selectedAssignment ? (
          <StartFromAssignmentDialog
            assignment={selectedAssignment}
            reportTemplates={reportTemplates}
            busy={busy === `assignment-${selectedAssignment.id}`}
            error={error}
            onClose={() => {
              setError(null)
              setSelectedAssignment(null)
            }}
            onSubmit={startInvestigationFromAssignment}
          />
        ) : null}
      </main>
    </Protected>
  )
}


function StartFromAssignmentDialog({
  assignment,
  reportTemplates,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  assignment: TuAssignmentListItem
  reportTemplates: TuReportTemplateOption[]
  busy: boolean
  error: string | null
  onClose: () => void
  onSubmit: (reportTemplateKey: string) => void
}) {
  const [reportTemplateKey, setReportTemplateKey] = useState('')
  const canSubmit = Boolean(reportTemplateKey.trim()) && reportTemplates.length > 0

  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        className="w-full rounded-t-2xl border border-violet-100 bg-white p-4 shadow-2xl sm:max-w-md sm:rounded-2xl"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Starta utredning?</h2>
            <p className="mt-1 text-sm text-slate-600">
              En teknisk utredning skapas från uppdragsbekräftelsen.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <X size={16} />
          </button>
        </header>

        <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2 text-sm text-slate-700">
          <p className="truncate">
            <span className="font-medium text-slate-950">Kund:</span>{' '}
            {assignment.customer_name || assignment.customer_email}
          </p>
          <p className="truncate">
            <span className="font-medium text-slate-950">Objekt:</span>{' '}
            {getAssignmentAddress(assignment)}
          </p>
          <p>
            <span className="font-medium text-slate-950">Datum:</span>{' '}
            {formatDate(assignment.preferred_date)}
          </p>
        </div>

        <TemplateSelect
          label="Mall för utlåtandet"
          required
          value={reportTemplateKey}
          templates={reportTemplates}
          disabled={busy}
          onChange={setReportTemplateKey}
        />

        <DialogError message={error} />
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={() => onSubmit(reportTemplateKey)}
            disabled={busy || !canSubmit}
            aria-busy={busy}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300"
          >
            {busy ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Play size={15} aria-hidden />}
            {busy ? 'Startar...' : 'Starta utredning'}
          </button>
        </div>
      </section>
    </div>
  )
}

function DialogShell({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-950/55 p-0 sm:items-center sm:p-4">
      <section
        role="dialog"
        aria-modal="true"
        className="max-h-[92vh] w-full overflow-auto rounded-t-2xl border border-violet-100 bg-white p-4 shadow-2xl sm:max-w-3xl sm:rounded-2xl sm:p-5"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Stäng"
            title="Stäng"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          >
            <X size={16} />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function DialogError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div role="alert" className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
      {message}
    </div>
  )
}

function QuickAssignmentDialog({
  organizationId,
  form,
  customerBinding,
  busy,
  error,
  onClose,
  onChange,
  onCustomerBindingChange,
  onUseCustomer,
  onModeChange,
  onSubmit,
}: {
  organizationId: string
  form: TuFormState
  customerBinding: AssignmentCustomerBinding | null
  busy: string | null
  error: string | null
  onClose: () => void
  onChange: <K extends keyof TuFormState>(key: K, value: TuFormState[K]) => void
  onCustomerBindingChange: (value: AssignmentCustomerBinding | null) => void
  onUseCustomer: (customer: OrganizationCustomer) => void
  onModeChange: () => void
  onSubmit: (sendNow: boolean) => void
}) {
  return (
    <DialogShell
      title="Ny teknisk utredning"
      subtitle="Välj vad som ska hända när uppgifterna är ifyllda."
      onClose={onClose}
    >
      <CreationModePicker mode="confirmation" onChange={onModeChange} />
      <p className="mt-2 text-xs text-slate-500">
        <span className="font-semibold text-rose-600">*</span> Obligatoriskt för att skicka. Ett ofullständigt
        uppdrag kan fortfarande sparas som utkast.
      </p>
      <section className="mt-4 border-b border-slate-200 pb-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Objekt</h3>
          <p className="mt-1 text-xs text-slate-600">Ange först uppgifterna om den fastighet eller lägenhet som ska utredas.</p>
        </div>
        <ObjectTypeControl value={form.objectType} onChange={(value) => onChange('objectType', value)} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Objektadress" value={form.propertyAddress} onChange={(value) => onChange('propertyAddress', value)} />
          <Field label="Postnummer" value={form.propertyPostalCode} onChange={(value) => onChange('propertyPostalCode', value)} />
          <Field label="Ort" value={form.propertyCity} onChange={(value) => onChange('propertyCity', value)} />
          <Field label="Kommun" value={form.propertyMunicipality} onChange={(value) => onChange('propertyMunicipality', value)} />
          {form.objectType === 'apartment' ? (
            <>
              <Field label="Bostadsrättsförening" value={form.brfName} onChange={(value) => onChange('brfName', value)} />
              <Field label="Lägenhetsnummer" value={form.apartmentNumber} onChange={(value) => onChange('apartmentNumber', value)} />
              <Field label="Bostadsrättsinnehavare" value={form.apartmentHolderName} onChange={(value) => onChange('apartmentHolderName', value)} />
            </>
          ) : (
            <>
              <Field label="Fastighetsbeteckning" value={form.cadastralId} onChange={(value) => onChange('cadastralId', value)} />
              <Field label="Fastighetsägare" value={form.propertyOwnerName} onChange={(value) => onChange('propertyOwnerName', value)} />
            </>
          )}
        </div>
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Beställare</h3>
          <p className="mt-1 text-xs text-slate-600">Uppdragsbekräftelsen skickas till beställarens e-postadress.</p>
        </div>
        <CustomerTypeControl
          value={form.customerType}
          onChange={(value) => onChange('customerType', value)}
        />
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Namn" value={form.customerName} onChange={(value) => onChange('customerName', value)} />
          <Field label="Beställarmejl" required value={form.customerEmail} onChange={(value) => onChange('customerEmail', value)} type="email" />
          <Field label="Telefon" value={form.customerPhone} onChange={(value) => onChange('customerPhone', value)} />
          <Field
            label={
              form.customerType === 'business'
                ? 'Organisationsnummer'
                : 'Personnummer (valfritt)'
            }
            required={form.customerType === 'business'}
            value={form.customerIdentityNumber}
            onChange={(value) => onChange('customerIdentityNumber', value)}
          />
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2.5 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={form.customerAddressMatchesObject}
            onChange={(event) => onChange('customerAddressMatchesObject', event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          <span>
            <span className="block font-medium">Beställarens adress är samma som objektets</span>
            <span className="mt-0.5 block text-xs text-slate-600">Adress, postnummer och ort hämtas från objektuppgifterna.</span>
          </span>
        </label>
        {form.customerAddressMatchesObject ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {[form.propertyAddress, [form.propertyPostalCode, form.propertyCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Objektadress saknas.'}
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Beställaradress" value={form.customerAddress} onChange={(value) => onChange('customerAddress', value)} />
            <Field label="Postnummer" value={form.customerPostalCode} onChange={(value) => onChange('customerPostalCode', value)} />
            <Field label="Ort" value={form.customerCity} onChange={(value) => onChange('customerCity', value)} />
          </div>
        )}
        <AssignmentCustomerSelector
          organizationId={organizationId}
          value={customerBinding}
          draft={{
            customerType: form.customerType,
            identityNumber: form.customerIdentityNumber,
            name: form.customerName,
            email: form.customerEmail,
            phone: form.customerPhone,
            address: form.customerAddress,
            postalCode: form.customerPostalCode,
            city: form.customerCity,
            invoiceEmail: form.invoiceEmail,
          }}
          disabled={busy !== null}
          onChange={onCustomerBindingChange}
          onUseCustomer={onUseCustomer}
        />
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Uppdrag</h3>
          <p className="mt-1 text-xs text-slate-600">Beskriv uppdraget och ange det pris som kunden ska godkänna.</p>
        </div>
        <Textarea label="Utredningens omfattning" required value={form.scopeDescription} onChange={(value) => onChange('scopeDescription', value)} rows={4} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field
            label={form.customerType === 'consumer' ? 'Pris inkl. moms, SEK' : 'Pris, SEK'}
            required
            value={form.priceAmount}
            onChange={(value) => onChange('priceAmount', value)}
            type="number"
          />
        </div>
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Besiktning</h3>
          <p className="mt-1 text-xs text-slate-600">Önskat datum och tid kan lämnas tomma om besiktningen bokas senare.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Datum" value={form.preferredDate} onChange={(value) => onChange('preferredDate', value)} type="date" />
          <Field label="Tid" value={form.preferredTime} onChange={(value) => onChange('preferredTime', value)} type="time" />
        </div>
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Fakturering</h3>
          <p className="mt-1 text-xs text-slate-600">Ange endast en fakturae-post om fakturan ska gå till en annan adress.</p>
        </div>
        <Field label="Fakturae-post" value={form.invoiceEmail} onChange={(value) => onChange('invoiceEmail', value)} type="email" />
      </section>

      <section className="py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Intern notering</h3>
          <p className="mt-1 text-xs text-slate-600">Syns inte för kunden.</p>
        </div>
        <Textarea label="Notering" value={form.notesInternal} onChange={(value) => onChange('notesInternal', value)} rows={3} />
      </section>

      <div className="sticky bottom-0 mt-4 border-t border-slate-200 bg-white pt-3">
        <DialogError message={error} />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
          type="button"
          onClick={() => onSubmit(false)}
          disabled={busy !== null}
          aria-busy={busy === 'draft'}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
        >
          {busy === 'draft' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
          {busy === 'draft' ? 'Sparar...' : 'Spara utkast'}
          </button>
          <button
          type="button"
          onClick={() => onSubmit(true)}
          disabled={busy !== null}
          aria-busy={busy === 'quick-send'}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300"
        >
          {busy === 'quick-send' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Mail size={16} aria-hidden />}
            {busy === 'quick-send' ? 'Skickar...' : 'Skicka uppdragsbekräftelse'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

function ScratchInvestigationDialog({
  form,
  reportTemplates,
  busy,
  error,
  onClose,
  onChange,
  onTemplateChange,
  onModeChange,
  onSubmit,
}: {
  form: ScratchFormState
  reportTemplates: TuReportTemplateOption[]
  busy: string | null
  error: string | null
  onClose: () => void
  onChange: <K extends keyof ScratchFormState>(key: K, value: ScratchFormState[K]) => void
  onTemplateChange: (reportTemplateKey: string) => void
  onModeChange: () => void
  onSubmit: () => void
}) {
  const canSubmit = Boolean(form.reportTemplateKey.trim() && form.customerEmail.trim()) && reportTemplates.length > 0

  return (
    <DialogShell
      title="Ny teknisk utredning"
      subtitle="Välj vad som ska hända när uppgifterna är ifyllda."
      onClose={onClose}
    >
      <CreationModePicker mode="direct" onChange={onModeChange} />
      <p className="mt-2 text-xs text-slate-500">
        <span className="font-semibold text-rose-600">*</span> Obligatoriskt för att skapa utredningen.
      </p>
      <TemplateSelect
        label="Mall för utlåtandet"
        required
        value={form.reportTemplateKey}
        templates={reportTemplates}
        disabled={busy === 'scratch'}
        onChange={onTemplateChange}
      />

      <div className="mt-4">
        <Field label="Dokumentrubrik" value={form.title} onChange={(value) => onChange('title', value)} />
      </div>

      <section className="mt-4 border-b border-slate-200 pb-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Objekt</h3>
          <p className="mt-1 text-xs text-slate-600">Ange först uppgifterna om den fastighet eller lägenhet som ska utredas.</p>
        </div>
        <ObjectTypeControl value={form.objectType} onChange={(value) => onChange('objectType', value)} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Objektadress" value={form.propertyAddress} onChange={(value) => onChange('propertyAddress', value)} />
          <Field label="Postnummer" value={form.propertyPostalCode} onChange={(value) => onChange('propertyPostalCode', value)} />
          <Field label="Ort" value={form.propertyCity} onChange={(value) => onChange('propertyCity', value)} />
          <Field label="Kommun" value={form.propertyMunicipality} onChange={(value) => onChange('propertyMunicipality', value)} />
          {form.objectType === 'apartment' ? (
            <>
              <Field label="Bostadsrättsförening" required value={form.brfName} onChange={(value) => onChange('brfName', value)} />
              <Field label="Lägenhetsnummer" required value={form.apartmentNumber} onChange={(value) => onChange('apartmentNumber', value)} />
              <Field label="Bostadsrättsinnehavare" value={form.apartmentHolderName} onChange={(value) => onChange('apartmentHolderName', value)} />
            </>
          ) : (
            <>
              <Field label="Fastighetsbeteckning" required value={form.cadastralId} onChange={(value) => onChange('cadastralId', value)} />
              <Field label="Fastighetsägare" value={form.propertyOwnerName} onChange={(value) => onChange('propertyOwnerName', value)} />
            </>
          )}
        </div>
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Beställare</h3>
          <p className="mt-1 text-xs text-slate-600">Kontaktmejlet används när utlåtandet ska levereras.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Namn" value={form.customerName} onChange={(value) => onChange('customerName', value)} />
          <Field label="Kontaktmejl" required value={form.customerEmail} onChange={(value) => onChange('customerEmail', value)} type="email" />
          <Field label="Telefon" value={form.customerPhone} onChange={(value) => onChange('customerPhone', value)} />
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2.5 text-sm text-slate-800">
          <input
            type="checkbox"
            checked={form.customerAddressMatchesObject}
            onChange={(event) => onChange('customerAddressMatchesObject', event.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
          />
          <span>
            <span className="block font-medium">Beställarens adress är samma som objektets</span>
            <span className="mt-0.5 block text-xs text-slate-600">Adress, postnummer och ort hämtas från objektuppgifterna.</span>
          </span>
        </label>
        {form.customerAddressMatchesObject ? (
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            {[form.propertyAddress, [form.propertyPostalCode, form.propertyCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Objektadress saknas.'}
          </div>
        ) : (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <Field label="Beställaradress" value={form.customerAddress} onChange={(value) => onChange('customerAddress', value)} />
            <Field label="Postnummer" value={form.customerPostalCode} onChange={(value) => onChange('customerPostalCode', value)} />
            <Field label="Ort" value={form.customerCity} onChange={(value) => onChange('customerCity', value)} />
          </div>
        )}
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Uppdrag</h3>
          <p className="mt-1 text-xs text-slate-600">Beskriv vad utredningen ska omfatta. Uppgiften kan kompletteras senare.</p>
        </div>
        <Textarea label="Utredningens omfattning" value={form.scopeDescription} onChange={(value) => onChange('scopeDescription', value)} rows={4} />
      </section>

      <section className="border-b border-slate-200 py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Besiktning</h3>
          <p className="mt-1 text-xs text-slate-600">Datum och tid kan lämnas tomma och fyllas i när besiktningen är bokad.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Datum" value={form.date} onChange={(value) => onChange('date', value)} type="date" />
          <Field label="Tid" value={form.time} onChange={(value) => onChange('time', value)} type="time" />
        </div>
      </section>

      <section className="py-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-950">Fakturering</h3>
          <p className="mt-1 text-xs text-slate-600">Ange endast en fakturae-post om fakturan ska gå till en annan adress.</p>
        </div>
        <Field label="Fakturae-post" value={form.invoiceEmail} onChange={(value) => onChange('invoiceEmail', value)} type="email" />
      </section>

      <div className="sticky bottom-0 mt-4 border-t border-slate-200 bg-white pt-3">
        <DialogError message={error} />
        <div className="flex justify-end">
          <button
          type="button"
          onClick={onSubmit}
          disabled={busy === 'scratch' || !canSubmit}
          aria-busy={busy === 'scratch'}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300 sm:w-auto"
        >
          {busy === 'scratch' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <CalendarDays size={16} aria-hidden />}
          {busy === 'scratch' ? 'Skapar...' : 'Skapa utredning'}
          </button>
        </div>
      </div>
    </DialogShell>
  )
}

function TemplateSelect({
  label,
  value,
  templates,
  disabled,
  required = false,
  onChange,
}: {
  label: string
  value: string
  templates: TuReportTemplateOption[]
  disabled?: boolean
  required?: boolean
  onChange: (value: string) => void
}) {
  const selectedTemplate = templates.find((template) => template.key === value) ?? null

  return (
    <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
      <label className="space-y-1">
        <span className="block text-xs font-medium text-slate-600">
          {label}
          {required ? <span className="ml-0.5 text-rose-600" aria-hidden>*</span> : null}
        </span>
        <select
          value={value}
          required={required}
          aria-required={required}
          disabled={disabled || templates.length === 0}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100 disabled:bg-slate-100 disabled:text-slate-500"
        >
          <option value="">Välj mall...</option>
          {templates.map((template) => (
            <option key={template.key} value={template.key}>
              {template.title}
            </option>
          ))}
        </select>
      </label>
      {selectedTemplate ? (
        <div className="mt-2 text-xs leading-5 text-slate-600">
          <p>
            <span className="font-semibold text-slate-800">Dokument:</span> {selectedTemplate.documentTitle}
          </p>
          <p>
            <span className="font-semibold text-slate-800">Projekttyp:</span> {selectedTemplate.projectType}
          </p>
          <p>
            <span className="font-semibold text-slate-800">Arbetssätt:</span>{' '}
            {tuReportAuthoringModeLabel(selectedTemplate.authoringMode)}
          </p>
          {selectedTemplate.description ? <p>{selectedTemplate.description}</p> : null}
        </div>
      ) : templates.length === 0 ? (
        <div className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
          Det finns inga aktiva TU-mallar. Lägg in standardmallar i admin innan nya utredningar skapas.
        </div>
      ) : (
        <p className="mt-2 text-xs leading-5 text-slate-500">
          Mallen väljs bara vid skapande och kopieras sedan till utlåtandet.
        </p>
      )}
    </div>
  )
}

function CreationModePicker({
  mode,
  onChange,
}: {
  mode: 'confirmation' | 'direct'
  onChange: () => void
}) {
  const confirmationActive = mode === 'confirmation'

  return (
    <fieldset className="mt-4">
      <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-600">
        Vad vill du göra?
      </legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={confirmationActive}
          onClick={confirmationActive ? undefined : onChange}
          className={`min-h-[76px] rounded-lg border px-3 py-3 text-left transition ${
            confirmationActive
              ? 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
              : 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40'
          }`}
        >
          <span className={`block text-sm font-semibold ${confirmationActive ? 'text-violet-900' : 'text-slate-900'}`}>
            Skapa uppdragsbekräftelse
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-600">
            Kunden får uppdraget för godkännande innan utredningen startas.
          </span>
        </button>
        <button
          type="button"
          aria-pressed={!confirmationActive}
          onClick={confirmationActive ? onChange : undefined}
          className={`min-h-[76px] rounded-lg border px-3 py-3 text-left transition ${
            confirmationActive
              ? 'border-slate-200 bg-white hover:border-violet-300 hover:bg-violet-50/40'
              : 'border-violet-500 bg-violet-50 ring-2 ring-violet-100'
          }`}
        >
          <span className={`block text-sm font-semibold ${confirmationActive ? 'text-slate-900' : 'text-violet-900'}`}>
            Starta utredning direkt
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-600">
            Utredningen skapas direkt utan att en bekräftelse skickas först.
          </span>
        </button>
      </div>
    </fieldset>
  )
}

function ObjectTypeControl({
  value,
  onChange,
}: {
  value: 'villa' | 'apartment'
  onChange: (value: 'villa' | 'apartment') => void
}) {
  return (
    <fieldset className="mt-3 space-y-1">
      <legend className="text-xs font-medium text-slate-600">Objekttyp</legend>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {[
          { value: 'villa' as const, label: 'Villa' },
          { value: 'apartment' as const, label: 'Lägenhet' },
        ].map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={
                active
                  ? 'rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-sm'
                  : 'rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white'
              }
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function CustomerTypeControl({
  value,
  onChange,
}: {
  value: 'consumer' | 'business'
  onChange: (value: 'consumer' | 'business') => void
}) {
  return (
    <fieldset className="mb-3 space-y-1">
      <legend className="text-xs font-medium text-slate-600">
        Beställartyp<span className="ml-0.5 text-rose-600" aria-hidden>*</span>
      </legend>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1">
        {[
          { value: 'consumer' as const, label: 'Privatperson' },
          { value: 'business' as const, label: 'Företag/organisation' },
        ].map((option) => {
          const active = value === option.value
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={
                active
                  ? 'rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white shadow-sm'
                  : 'rounded-md px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-white'
              }
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'date' | 'time' | 'number'
  required?: boolean
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="ml-0.5 text-rose-600" aria-hidden>*</span> : null}
      </span>
      <input
        type={type}
        value={value}
        required={required}
        aria-required={required}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
    </label>
  )
}

function Textarea({
  label,
  value,
  onChange,
  rows,
  required = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows: number
  required?: boolean
}) {
  return (
    <label className="mt-3 block space-y-1">
      <span className="block text-xs font-medium text-slate-600">
        {label}
        {required ? <span className="ml-0.5 text-rose-600" aria-hidden>*</span> : null}
      </span>
      <textarea
        value={value}
        rows={rows}
        required={required}
        aria-required={required}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
    </label>
  )
}
