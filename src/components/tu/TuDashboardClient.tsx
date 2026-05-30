'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  IdCard,
  ListChecks,
  Mail,
  Plus,
  Send,
  Settings,
  X,
} from 'lucide-react'
import Protected from '@/components/Protected'
import type { TuAssignmentListItem, TuInspectionSummary, TuInspectorProfileCard } from '@/lib/tu/server'

type TuFormState = {
  objectType: 'villa' | 'apartment'
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
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
  customerName: string
  customerEmail: string
  customerPhone: string
  date: string
  time: string
}

const EMPTY_TU_FORM: TuFormState = {
  objectType: 'villa',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  customerAddress: '',
  customerPostalCode: '',
  customerCity: '',
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
  objectType: 'villa',
  title: 'Teknisk utredning',
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
  customerName: '',
  customerEmail: '',
  customerPhone: '',
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

export default function TuDashboardClient({
  initialAssignments,
  initialInvestigations,
  inspectorProfile,
  initialError,
}: {
  initialAssignments: TuAssignmentListItem[]
  initialInvestigations: TuInspectionSummary[]
  inspectorProfile: TuInspectorProfileCard | null
  initialError: string | null
}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState(initialAssignments)
  const [investigations] = useState(initialInvestigations)
  const [form, setForm] = useState<TuFormState>(EMPTY_TU_FORM)
  const [scratchForm, setScratchForm] = useState<ScratchFormState>(EMPTY_SCRATCH_FORM)
  const [dialog, setDialog] = useState<'quick' | 'scratch' | null>(null)
  const [error, setError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const latestAssignments = useMemo(
    () => [...assignments].sort((a, b) => assignmentSortValue(b) - assignmentSortValue(a)).slice(0, 3),
    [assignments]
  )
  const acceptedAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status === 'ordered' && !assignment.inspection_id),
    [assignments]
  )
  const latestInvestigations = useMemo(() => investigations.slice(0, 3), [investigations])

  const updateForm = <K extends keyof TuFormState>(key: K, value: TuFormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateScratchForm = <K extends keyof ScratchFormState>(key: K, value: ScratchFormState[K]) => {
    setScratchForm((current) => ({ ...current, [key]: value }))
  }

  const submitAssignment = async (sendNow: boolean) => {
    const missingVillaObject = form.objectType === 'villa' && !form.cadastralId.trim()
    const missingApartmentObject =
      form.objectType === 'apartment' && (!form.brfName.trim() || !form.apartmentNumber.trim())

    if (sendNow && (missingVillaObject || missingApartmentObject)) {
      setError(
        form.objectType === 'apartment'
          ? 'Ange BRF och lägenhetsnummer innan utskick.'
          : 'Ange fastighetsbeteckning innan utskick.'
      )
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
                <StatPill label="Godkända" value={acceptedAssignments.length} />
                <StatPill label="Utredningar" value={investigations.length} />
              </div>
            </div>
          </header>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </div>
          ) : null}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            <ActionCard
              title="Skicka uppdragsbekräftelse"
              description="Snabbt utskick med omfattning, tid, pris, adress och kunduppgifter."
              icon={<Send size={22} aria-hidden />}
              actionLabel="Skicka"
              onAction={() => setDialog('quick')}
            />
            <LinkCard
              title="Uppdragsbekräftelser"
              description="Visa, filtrera och hantera skickade, godkända och arkiverade uppdrag."
              icon={<ListChecks size={22} aria-hidden />}
              href="/tu/assignments"
              footer={
                latestAssignments.length > 0
                  ? latestAssignments.map((assignment) => (
                      <MiniRow
                        key={assignment.id}
                        title={assignment.customer_name || assignment.customer_email}
                        meta={`${formatDate(assignment.preferred_date)} · ${statusLabel(assignment.status)}`}
                      />
                    ))
                  : 'Inga uppdragsbekräftelser ännu.'
              }
            />
            <ActionCard
              title="Starta utredning"
              description="Skapa en teknisk utredning från scratch när uppdragsbekräftelse inte behövs."
              icon={<Plus size={22} aria-hidden />}
              actionLabel="Ny utredning"
              onAction={() => setDialog('scratch')}
            />
            <LinkCard
              title="Utredningar"
              description="Öppna och fortsätt arbeta i pågående tekniska utredningar."
              icon={<FileText size={22} aria-hidden />}
              href="/tu/investigations"
              footer={
                latestInvestigations.length > 0
                  ? latestInvestigations.map((investigation) => (
                      <MiniRow
                        key={investigation.inspectionId}
                        title={investigation.title}
                        meta={`${formatDate(investigation.date)} · ${getInvestigationAddress(investigation)}`}
                      />
                    ))
                  : 'Inga utredningar ännu.'
              }
            />
            <ProfileCard profile={inspectorProfile} />
          </section>
        </div>

        {dialog === 'quick' ? (
          <QuickAssignmentDialog
            form={form}
            busy={busy}
            onClose={() => setDialog(null)}
            onChange={updateForm}
            onSubmit={submitAssignment}
          />
        ) : null}

        {dialog === 'scratch' ? (
          <ScratchInvestigationDialog
            form={scratchForm}
            busy={busy}
            onClose={() => setDialog(null)}
            onChange={updateScratchForm}
            onSubmit={createScratchInvestigation}
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

function ActionCard({
  title,
  description,
  icon,
  actionLabel,
  onAction,
}: {
  title: string
  description: string
  icon: React.ReactNode
  actionLabel: string
  onAction: () => void
}) {
  return (
    <CardShell>
      <CardHeading title={title} description={description} icon={icon} />
      <div className="mt-auto pt-5">
        <button
          type="button"
          onClick={onAction}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          {actionLabel}
        </button>
      </div>
    </CardShell>
  )
}

function LinkCard({
  title,
  description,
  icon,
  href,
  footer,
}: {
  title: string
  description: string
  icon: React.ReactNode
  href: string
  footer: React.ReactNode
}) {
  return (
    <CardShell>
      <CardHeading title={title} description={description} icon={icon} />
      <div className="mt-4 min-h-0 flex-1 space-y-2 overflow-hidden text-sm text-slate-600">
        {footer}
      </div>
      <div className="mt-5">
        <Link
          href={href}
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          Öppna lista
        </Link>
      </div>
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
          href="/settings"
          className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          <Settings size={16} aria-hidden />
          Öppna profil
        </Link>
      </div>
    </CardShell>
  )
}

function MiniRow({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="rounded-lg border border-violet-100 bg-violet-50/50 px-3 py-2">
      <p className="truncate text-sm font-medium text-slate-950">{title}</p>
      <p className="mt-0.5 truncate text-xs text-slate-600">{meta}</p>
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

function QuickAssignmentDialog({
  form,
  busy,
  onClose,
  onChange,
  onSubmit,
}: {
  form: TuFormState
  busy: string | null
  onClose: () => void
  onChange: <K extends keyof TuFormState>(key: K, value: TuFormState[K]) => void
  onSubmit: (sendNow: boolean) => void
}) {
  return (
    <DialogShell
      title="Skicka uppdragsbekräftelse"
      subtitle="Fyll det som behövs för att kunden ska kunna godkänna uppdraget."
      onClose={onClose}
    >
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Kundnamn" value={form.customerName} onChange={(value) => onChange('customerName', value)} />
        <Field
          label="Kundmejl *"
          value={form.customerEmail}
          onChange={(value) => onChange('customerEmail', value)}
          type="email"
        />
        <Field label="Telefon" value={form.customerPhone} onChange={(value) => onChange('customerPhone', value)} />
        <Field
          label="Kundadress"
          value={form.customerAddress}
          onChange={(value) => onChange('customerAddress', value)}
        />
        <Field
          label="Kund postnummer"
          value={form.customerPostalCode}
          onChange={(value) => onChange('customerPostalCode', value)}
        />
        <Field label="Kund ort" value={form.customerCity} onChange={(value) => onChange('customerCity', value)} />
      </div>

      <Textarea
        label="Utredningens omfattning *"
        value={form.scopeDescription}
        onChange={(value) => onChange('scopeDescription', value)}
        rows={4}
      />

      <ObjectTypeControl
        value={form.objectType}
        onChange={(value) => onChange('objectType', value)}
      />

      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Objektadress"
          value={form.propertyAddress}
          onChange={(value) => onChange('propertyAddress', value)}
        />
        <Field
          label="Objekt postnummer"
          value={form.propertyPostalCode}
          onChange={(value) => onChange('propertyPostalCode', value)}
        />
        <Field label="Objekt ort" value={form.propertyCity} onChange={(value) => onChange('propertyCity', value)} />
        <Field
          label="Kommun"
          value={form.propertyMunicipality}
          onChange={(value) => onChange('propertyMunicipality', value)}
        />
        {form.objectType === 'apartment' ? (
          <>
            <Field
              label="Bostadsrättsförening *"
              value={form.brfName}
              onChange={(value) => onChange('brfName', value)}
            />
            <Field
              label="Lägenhetsnummer *"
              value={form.apartmentNumber}
              onChange={(value) => onChange('apartmentNumber', value)}
            />
            <Field
              label="Bostadsrättsinnehavare"
              value={form.apartmentHolderName}
              onChange={(value) => onChange('apartmentHolderName', value)}
            />
          </>
        ) : (
          <>
            <Field
              label="Fastighetsbeteckning *"
              value={form.cadastralId}
              onChange={(value) => onChange('cadastralId', value)}
            />
            <Field
              label="Fastighetsägare"
              value={form.propertyOwnerName}
              onChange={(value) => onChange('propertyOwnerName', value)}
            />
          </>
        )}
        <Field
          label="Datum"
          value={form.preferredDate}
          onChange={(value) => onChange('preferredDate', value)}
          type="date"
        />
        <Field
          label="Tid"
          value={form.preferredTime}
          onChange={(value) => onChange('preferredTime', value)}
          type="time"
        />
        <Field
          label="Pris SEK *"
          value={form.priceAmount}
          onChange={(value) => onChange('priceAmount', value)}
          type="number"
        />
      </div>

      <Textarea
        label="Intern notering"
        value={form.notesInternal}
        onChange={(value) => onChange('notesInternal', value)}
        rows={3}
      />

      <div className="sticky bottom-0 mt-4 flex flex-col gap-2 border-t border-slate-200 bg-white pt-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={() => onSubmit(false)}
          disabled={busy === 'draft'}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
        >
          <Plus size={16} aria-hidden />
          Spara utkast
        </button>
        <button
          type="button"
          onClick={() => onSubmit(true)}
          disabled={busy === 'quick-send'}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300"
        >
          <Mail size={16} aria-hidden />
          {busy === 'quick-send' ? 'Skickar...' : 'Skicka'}
        </button>
      </div>
    </DialogShell>
  )
}

function ScratchInvestigationDialog({
  form,
  busy,
  onClose,
  onChange,
  onSubmit,
}: {
  form: ScratchFormState
  busy: string | null
  onClose: () => void
  onChange: <K extends keyof ScratchFormState>(key: K, value: ScratchFormState[K]) => void
  onSubmit: () => void
}) {
  return (
    <DialogShell
      title="Starta utredning"
      subtitle="Skapa en teknisk utredning utan uppdragsbekräftelse."
      onClose={onClose}
    >
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <Field label="Rubrik" value={form.title} onChange={(value) => onChange('title', value)} />
        <Field label="Kundnamn" value={form.customerName} onChange={(value) => onChange('customerName', value)} />
        <Field
          label="Kundmejl"
          value={form.customerEmail}
          onChange={(value) => onChange('customerEmail', value)}
          type="email"
        />
        <Field label="Telefon" value={form.customerPhone} onChange={(value) => onChange('customerPhone', value)} />
      </div>
      <Textarea
        label="Utredningens omfattning"
        value={form.scopeDescription}
        onChange={(value) => onChange('scopeDescription', value)}
        rows={4}
      />
      <ObjectTypeControl
        value={form.objectType}
        onChange={(value) => onChange('objectType', value)}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <Field
          label="Objektadress"
          value={form.propertyAddress}
          onChange={(value) => onChange('propertyAddress', value)}
        />
        <Field
          label="Postnummer"
          value={form.propertyPostalCode}
          onChange={(value) => onChange('propertyPostalCode', value)}
        />
        <Field label="Ort" value={form.propertyCity} onChange={(value) => onChange('propertyCity', value)} />
        <Field
          label="Kommun"
          value={form.propertyMunicipality}
          onChange={(value) => onChange('propertyMunicipality', value)}
        />
        {form.objectType === 'apartment' ? (
          <>
            <Field
              label="Bostadsrättsförening *"
              value={form.brfName}
              onChange={(value) => onChange('brfName', value)}
            />
            <Field
              label="Lägenhetsnummer *"
              value={form.apartmentNumber}
              onChange={(value) => onChange('apartmentNumber', value)}
            />
            <Field
              label="Bostadsrättsinnehavare"
              value={form.apartmentHolderName}
              onChange={(value) => onChange('apartmentHolderName', value)}
            />
          </>
        ) : (
          <>
            <Field
              label="Fastighetsbeteckning *"
              value={form.cadastralId}
              onChange={(value) => onChange('cadastralId', value)}
            />
            <Field
              label="Fastighetsägare"
              value={form.propertyOwnerName}
              onChange={(value) => onChange('propertyOwnerName', value)}
            />
          </>
        )}
        <Field label="Datum" value={form.date} onChange={(value) => onChange('date', value)} type="date" />
        <Field label="Tid" value={form.time} onChange={(value) => onChange('time', value)} type="time" />
      </div>
      <div className="sticky bottom-0 mt-4 flex justify-end border-t border-slate-200 bg-white pt-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy === 'scratch'}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-semibold text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300 sm:w-auto"
        >
          <CalendarDays size={16} aria-hidden />
          {busy === 'scratch' ? 'Skapar...' : 'Skapa utredning'}
        </button>
      </div>
    </DialogShell>
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'email' | 'date' | 'time' | 'number'
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  rows: number
}) {
  return (
    <label className="mt-3 block space-y-1">
      <span className="block text-xs font-medium text-slate-600">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-6 text-slate-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
    </label>
  )
}
