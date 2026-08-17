'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  FileText,
  IdCard,
  ListChecks,
  Loader2,
  Mail,
  Play,
  Plus,
  Send,
  Settings,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type {
  TuAssignmentListItem,
  TuInspectionSummary,
  TuInspectorProfileCard,
  TuReportTemplateOption,
} from '@/lib/tu/server'

type TuFormState = {
  objectType: 'villa' | 'apartment'
  customerAddressMatchesObject: boolean
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
  customerAddressMatchesObject: false,
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

function statusLabel(status: string | null) {
  if (status === 'draft') return 'Utkast'
  if (status === 'sent') return 'Skickad'
  if (status === 'ordered') return 'Godkänd'
  if (status === 'booked') return 'Bokad'
  if (status === 'completed') return 'Startad'
  if (status === 'cancelled') return 'Avbruten'
  if (status === 'expired') return 'Utgången länk'
  return status ?? 'Okänd'
}

function formatDate(value: string | null) {
  if (!value) return '-'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleDateString('sv-SE')
}

function assignmentSortValue(item: TuAssignmentListItem) {
  return new Date(item.updated_at ?? item.created_at).getTime()
}

function getInvestigationAddress(item: TuInspectionSummary) {
  const address = [item.propertyAddress, item.propertyCity].filter(Boolean).join(', ')
  const apartmentObject = [item.brfName, item.apartmentNumber ? `lgh ${item.apartmentNumber}` : null]
    .filter(Boolean)
    .join(', ')
  const objectReference = item.objectType === 'apartment' ? apartmentObject : item.cadastralId
  return [address, objectReference].filter(Boolean).join(' - ') || 'Adress saknas'
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

function canStartAssignmentInvestigation(item: TuAssignmentListItem) {
  return item.status === 'ordered' && !item.inspection_id && !item.archived_at
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function TuDashboardClient({
  initialAssignments,
  initialInvestigations,
  initialReportTemplates,
  inspectorProfile,
  initialError,
}: {
  initialAssignments: TuAssignmentListItem[]
  initialInvestigations: TuInspectionSummary[]
  initialReportTemplates: TuReportTemplateOption[]
  inspectorProfile: TuInspectorProfileCard | null
  initialError: string | null
}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState(initialAssignments)
  const [investigations] = useState(initialInvestigations)
  const [reportTemplates] = useState(initialReportTemplates)
  const [form, setForm] = useState<TuFormState>(EMPTY_TU_FORM)
  const [scratchForm, setScratchForm] = useState<ScratchFormState>(EMPTY_SCRATCH_FORM)
  const [dialog, setDialog] = useState<'quick' | 'scratch' | null>(null)
  const [selectedAssignment, setSelectedAssignment] = useState<TuAssignmentListItem | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
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

  const latestAssignments = useMemo(
    () => [...assignments].sort((a, b) => assignmentSortValue(b) - assignmentSortValue(a)).slice(0, 4),
    [assignments]
  )
  const startableAssignments = useMemo(
    () =>
      assignments
        .filter(canStartAssignmentInvestigation)
        .sort((a, b) => assignmentSortValue(b) - assignmentSortValue(a))
        .slice(0, 4),
    [assignments]
  )
  const acceptedAssignmentCount = useMemo(
    () => assignments.filter(canStartAssignmentInvestigation).length,
    [assignments]
  )
  const latestInvestigations = useMemo(() => investigations.slice(0, 4), [investigations])

  const updateForm = <K extends keyof TuFormState>(key: K, value: TuFormState[K]) => {
    setError(null)
    setForm((current) => {
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
    const missingVillaObject = form.objectType === 'villa' && !form.cadastralId.trim()
    const missingApartmentObject =
      form.objectType === 'apartment' && (!form.brfName.trim() || !form.apartmentNumber.trim())

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
    if (sendNow && (missingVillaObject || missingApartmentObject)) {
      setError(
        form.objectType === 'apartment'
          ? 'Ange BRF och lägenhetsnummer innan utskick.'
          : 'Ange fastighetsbeteckning innan utskick.'
      )
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

    setBusy(sendNow ? 'quick-send' : 'draft')
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(sendNow ? '/api/tu/assignments/quick-send' : '/api/tu/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skapa TU-uppdrag.')

      const assignmentResponse = await fetch('/api/tu/assignments', { cache: 'no-store' })
      const assignmentPayload = await assignmentResponse.json().catch(() => ({}))
      if (assignmentResponse.ok && Array.isArray(assignmentPayload.items)) {
        setAssignments(assignmentPayload.items)
      }

      setNotice(sendNow ? 'Uppdragsbekräftelsen är skickad.' : 'Uppdraget sparades som utkast.')
      setForm(EMPTY_TU_FORM)
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
        body: JSON.stringify(scratchForm),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skapa TU-utredning.')
      setScratchForm(EMPTY_SCRATCH_FORM)
      setDialog(null)
      router.push(`/tu/investigations/${payload.inspectionId}`)
    } catch (scratchError) {
      setError(scratchError instanceof Error ? scratchError.message : 'Kunde inte skapa TU-utredning.')
    } finally {
      setBusy(null)
    }
  }

  const startInvestigationFromAssignment = async (reportTemplateKey: string) => {
    if (!selectedAssignment || !canStartAssignmentInvestigation(selectedAssignment)) return
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
        body: JSON.stringify({ reportTemplateKey }),
      })
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; inspectionId?: string }
        | null
      if (!response.ok) throw new Error(payload?.error ?? 'Kunde inte starta utredning.')
      if (!payload?.inspectionId) throw new Error('Konverteringen saknar utrednings-id.')
      setSelectedAssignment(null)
      router.push(`/tu/investigations/${payload.inspectionId}`)
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Kunde inte starta utredning.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: 'linear-gradient(135deg, #fbf7ff 0%, #ffffff 52%, #f6f0ff 100%)',
          }}
        />

        <div className="relative mx-auto w-full max-w-7xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-3">
                <Link
                  href="/dashboard-v1"
                  aria-label="Tillbaka"
                  title="Tillbaka"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  <ArrowLeft size={16} strokeWidth={2} />
                </Link>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">TU</p>
                  <h1 className="text-2xl font-semibold text-slate-950">Tekniska utredningar</h1>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 sm:flex sm:items-center">
                <StatPill label="Uppdrag" value={assignments.length} />
                <StatPill label="Godkända" value={acceptedAssignmentCount} />
                <StatPill label="Utredningar" value={investigations.length} />
              </div>
            </div>
          </header>

          {error && !dialog && !selectedAssignment ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </div>
          ) : null}

          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <AssignmentConfirmationsCard
              assignments={latestAssignments}
              busy={busy}
              onOpenDialog={() => openCreationDialog('quick')}
              onStartAssignment={(assignment) => {
                setError(null)
                setSelectedAssignment(assignment)
              }}
            />
            <StartInvestigationCard
              acceptedAssignments={startableAssignments}
              busy={busy}
              onOpenDialog={() => openCreationDialog('scratch')}
              onStartAssignment={(assignment) => {
                setError(null)
                setSelectedAssignment(assignment)
              }}
            />
            <InvestigationsCard investigations={latestInvestigations} />
            <ProfileCard profile={inspectorProfile} />
          </section>
        </div>

        {dialog === 'quick' ? (
          <QuickAssignmentDialog
            form={form}
            busy={busy}
            error={error}
            onClose={() => {
              setError(null)
              setDialog(null)
            }}
            onChange={updateForm}
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

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
      <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700">
        {label}
      </span>
      <span className="text-base font-semibold text-slate-950">{value}</span>
    </div>
  )
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <article className="relative flex min-h-[260px] flex-col overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-4 shadow-xl ring-1 ring-black/5 backdrop-blur-md md:min-h-[300px] md:p-5">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-violet-600 to-fuchsia-400" />
      {children}
    </article>
  )
}

function CardHeading({
  title,
  description,
  icon,
}: {
  title: string
  description: string
  icon: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
        {icon}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold leading-snug text-slate-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
      </div>
    </div>
  )
}

function AssignmentConfirmationsCard({
  assignments,
  busy,
  onOpenDialog,
  onStartAssignment,
}: {
  assignments: TuAssignmentListItem[]
  busy: string | null
  onOpenDialog: () => void
  onStartAssignment: (assignment: TuAssignmentListItem) => void
}) {
  return (
    <CardShell>
      <CardHeading
        title="Uppdragsbekräftelser"
        description="Skicka ny bekräftelse och följ senaste uppdrag."
        icon={<ListChecks size={22} aria-hidden />}
      />
      <div className="mt-3">
        <button
          type="button"
          onClick={onOpenDialog}
          disabled={busy === 'quick-send'}
          aria-busy={busy === 'quick-send'}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          {busy === 'quick-send' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Send size={16} aria-hidden />}
          {busy === 'quick-send' ? 'Öppnar...' : 'Skicka uppdragsbekräftelse'}
        </button>
      </div>
      <div className="mt-3 min-h-0 flex-1 rounded-lg border border-violet-100 bg-white/70 p-2">
        {assignments.length > 0 ? (
          <ul className="h-full space-y-1 overflow-auto pr-1">
            {assignments.map((assignment) => (
              <AssignmentMiniRow
                key={assignment.id}
                assignment={assignment}
                onStartAssignment={onStartAssignment}
              />
            ))}
          </ul>
        ) : (
          <ListEmptyState>Inga uppdragsbekräftelser ännu.</ListEmptyState>
        )}
      </div>
      <CardFooterLink href="/tu/assignments" label="Öppna alla uppdrag" />
    </CardShell>
  )
}

function StartInvestigationCard({
  acceptedAssignments,
  busy,
  onOpenDialog,
  onStartAssignment,
}: {
  acceptedAssignments: TuAssignmentListItem[]
  busy: string | null
  onOpenDialog: () => void
  onStartAssignment: (assignment: TuAssignmentListItem) => void
}) {
  return (
    <CardShell>
      <CardHeading
        title="Starta utredning"
        description="Skapa från scratch eller från godkänd bekräftelse."
        icon={<Plus size={22} aria-hidden />}
      />
      <div className="mt-3">
        <button
          type="button"
          onClick={onOpenDialog}
          disabled={busy === 'scratch'}
          aria-busy={busy === 'scratch'}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          {busy === 'scratch' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
          {busy === 'scratch' ? 'Öppnar...' : 'Ny utredning'}
        </button>
      </div>
      <div className="mt-3 min-h-0 flex-1 rounded-lg border border-violet-100 bg-white/70 p-2">
        <h3 className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Godkända uppdrag
        </h3>
        {acceptedAssignments.length > 0 ? (
          <ul className="space-y-1 overflow-auto pr-1">
            {acceptedAssignments.map((assignment) => (
              <li key={assignment.id}>
                <button
                  type="button"
                  onClick={() => onStartAssignment(assignment)}
                  className="block w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-left transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
                >
                  <span className="block truncate text-xs font-medium text-slate-950">
                    {assignment.customer_name || assignment.customer_email}
                  </span>
                  <span className="block truncate text-[11px] text-slate-600">
                    {formatDate(assignment.preferred_date)} · {getAssignmentAddress(assignment)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <ListEmptyState>Inga godkända uppdrag att starta.</ListEmptyState>
        )}
      </div>
    </CardShell>
  )
}

function InvestigationsCard({ investigations }: { investigations: TuInspectionSummary[] }) {
  return (
    <CardShell>
      <CardHeading
        title="Mina utredningar"
        description="Öppna och fortsätt arbeta i utlåtanden."
        icon={<FileText size={22} aria-hidden />}
      />
      <div className="mt-3 min-h-0 flex-1 rounded-lg border border-violet-100 bg-white/70 p-2">
        {investigations.length > 0 ? (
          <ul className="h-full space-y-1 overflow-auto pr-1">
            {investigations.map((investigation) => (
              <InvestigationMiniRow key={investigation.inspectionId} investigation={investigation} />
            ))}
          </ul>
        ) : (
          <ListEmptyState>Inga utredningar ännu.</ListEmptyState>
        )}
      </div>
      <CardFooterLink href="/tu/investigations" label="Öppna alla utredningar" />
    </CardShell>
  )
}

function ProfileCard({ profile }: { profile: TuInspectorProfileCard | null }) {
  const [imageLoadError, setImageLoadError] = useState(false)
  const imageSrc = imageLoadError ? null : profile?.avatarUrl ?? profile?.logoUrl ?? null
  const name = profile?.fullName || 'Besiktningsman'
  const company = profile?.companyName || 'Profiluppgifter saknas'
  const address = [
    profile?.companyAddress,
    [profile?.companyPostalCode, profile?.companyCity].filter(Boolean).join(' '),
  ]
    .filter(Boolean)
    .join(', ')
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')

  return (
    <CardShell>
      <CardHeading
        title="Visitkort"
        description="Profil, logga, underskrift och behörigheter för utlåtanden."
        icon={<IdCard size={22} aria-hidden />}
      />
      <div className="mt-4 rounded-xl border border-violet-100 bg-violet-50/50 p-3">
        <div className="flex items-start gap-3">
          {imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt="Profilbild"
              className="h-14 w-14 shrink-0 rounded-full border border-white bg-white object-cover shadow-sm"
              onError={() => setImageLoadError(true)}
            />
          ) : (
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-violet-100 bg-white text-sm font-semibold text-violet-700 shadow-sm">
              {initials || 'TU'}
            </div>
          )}
          <div className="min-w-0 text-sm">
            <p className="truncate font-semibold text-slate-950">{name}</p>
            <p className="truncate text-slate-700">{company}</p>
            {profile?.email ? <p className="truncate text-xs text-slate-600">{profile.email}</p> : null}
            {profile?.phone ? <p className="truncate text-xs text-slate-600">{profile.phone}</p> : null}
          </div>
        </div>

        <div className="mt-3 space-y-1 text-xs leading-5 text-slate-600">
          {profile?.credentialLines.length ? (
            profile.credentialLines.slice(0, 3).map((line) => (
              <p key={line} className="truncate">
                {line}
              </p>
            ))
          ) : (
            <p>Inga behörigheter valda.</p>
          )}
          {profile?.companyOrgNo ? <p className="truncate">Org.nr: {profile.companyOrgNo}</p> : null}
          {address ? <p className="truncate">{address}</p> : null}
        </div>
      </div>
      <div className="mt-auto pt-5">
        <Link
          href="/ob/settings"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          <Settings size={16} aria-hidden />
          Öppna profil
        </Link>
      </div>
    </CardShell>
  )
}

function AssignmentMiniRow({
  assignment,
  onStartAssignment,
}: {
  assignment: TuAssignmentListItem
  onStartAssignment: (assignment: TuAssignmentListItem) => void
}) {
  const title = assignment.customer_name || assignment.customer_email
  const meta = `${formatDate(assignment.preferred_date)} · ${statusLabel(assignment.status)}`
  const address = getAssignmentAddress(assignment)

  if (assignment.inspection_id) {
    return (
      <li>
        <Link
          href={`/tu/investigations/${encodeURIComponent(assignment.inspection_id)}`}
          className="block rounded-md border border-slate-200 bg-white px-2 py-1.5 transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <span className="block truncate text-xs font-medium text-slate-950">{title}</span>
          <span className="block truncate text-[11px] text-slate-600">{meta}</span>
          <span className="mt-0.5 block truncate text-[10px] font-medium text-violet-700">
            Öppna utredning · {address}
          </span>
        </Link>
      </li>
    )
  }

  if (canStartAssignmentInvestigation(assignment)) {
    return (
      <li>
        <button
          type="button"
          onClick={() => onStartAssignment(assignment)}
          className="block w-full rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-left transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          <span className="block truncate text-xs font-medium text-slate-950">{title}</span>
          <span className="block truncate text-[11px] text-slate-700">{meta}</span>
          <span className="mt-0.5 block truncate text-[10px] font-semibold text-amber-800">
            Starta utredning · {address}
          </span>
        </button>
      </li>
    )
  }

  return (
    <li>
      <Link
        href="/tu/assignments"
        className="block rounded-md border border-slate-200 bg-white px-2 py-1.5 transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <span className="block truncate text-xs font-medium text-slate-950">{title}</span>
        <span className="block truncate text-[11px] text-slate-600">{meta}</span>
        <span className="mt-0.5 block truncate text-[10px] text-slate-500">{address}</span>
      </Link>
    </li>
  )
}

function InvestigationMiniRow({ investigation }: { investigation: TuInspectionSummary }) {
  return (
    <li>
      <Link
        href={`/tu/investigations/${encodeURIComponent(investigation.inspectionId)}`}
        className="block rounded-md border border-slate-200 bg-white px-2 py-1.5 transition hover:border-violet-200 hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <span className="block truncate text-xs font-medium text-slate-950">{investigation.title}</span>
        <span className="block truncate text-[11px] text-slate-600">
          {formatDate(investigation.date)} · {getInvestigationAddress(investigation)}
        </span>
        <span className="mt-0.5 block truncate text-[10px] font-medium text-violet-700">
          Öppna utlåtande
        </span>
      </Link>
    </li>
  )
}

function CardFooterLink({ href, label }: { href: string; label: string }) {
  return (
    <div className="mt-3">
      <Link
        href={href}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
      >
        {label}
        <ArrowRight size={15} aria-hidden />
      </Link>
    </div>
  )
}

function ListEmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[92px] items-center justify-center rounded-md border border-dashed border-violet-200 bg-violet-50/40 px-3 text-center text-xs text-slate-500">
      {children}
    </div>
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
  form,
  busy,
  error,
  onClose,
  onChange,
  onModeChange,
  onSubmit,
}: {
  form: TuFormState
  busy: string | null
  error: string | null
  onClose: () => void
  onChange: <K extends keyof TuFormState>(key: K, value: TuFormState[K]) => void
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
          <p className="mt-1 text-xs text-slate-600">Uppdragsbekräftelsen skickas till beställarens e-postadress.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Namn" value={form.customerName} onChange={(value) => onChange('customerName', value)} />
          <Field label="Beställarmejl" required value={form.customerEmail} onChange={(value) => onChange('customerEmail', value)} type="email" />
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
          <p className="mt-1 text-xs text-slate-600">Beskriv uppdraget och ange det pris som kunden ska godkänna.</p>
        </div>
        <Textarea label="Utredningens omfattning" required value={form.scopeDescription} onChange={(value) => onChange('scopeDescription', value)} rows={4} />
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Pris SEK" required value={form.priceAmount} onChange={(value) => onChange('priceAmount', value)} type="number" />
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
          disabled={busy === 'draft'}
          aria-busy={busy === 'draft'}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
        >
          {busy === 'draft' ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plus size={16} aria-hidden />}
          {busy === 'draft' ? 'Sparar...' : 'Spara utkast'}
          </button>
          <button
          type="button"
          onClick={() => onSubmit(true)}
          disabled={busy === 'quick-send'}
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
            Skicka uppdragsbekräftelse
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
