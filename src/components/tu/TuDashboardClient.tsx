'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Play, Plus, RefreshCw, Send } from 'lucide-react'
import type { TuAssignmentListItem, TuInspectionSummary } from '@/lib/tu/server'

type TuFormState = {
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
  scopeDescription: string
  preferredDate: string
  preferredTime: string
  priceAmount: string
  notesInternal: string
}

type ScratchFormState = {
  title: string
  scopeDescription: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyOwnerName: string
  cadastralId: string
  customerName: string
  customerEmail: string
  customerPhone: string
  date: string
  time: string
}

const EMPTY_TU_FORM: TuFormState = {
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
  scopeDescription: '',
  preferredDate: '',
  preferredTime: '',
  priceAmount: '',
  notesInternal: '',
}

const EMPTY_SCRATCH_FORM: ScratchFormState = {
  title: 'Teknisk utredning',
  scopeDescription: '',
  propertyAddress: '',
  propertyPostalCode: '',
  propertyCity: '',
  propertyMunicipality: '',
  propertyOwnerName: '',
  cadastralId: '',
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
  if (status === 'completed') return 'Startad'
  if (status === 'cancelled') return 'Avbruten'
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

export default function TuDashboardClient({
  initialAssignments,
  initialInvestigations,
  initialError,
}: {
  initialAssignments: TuAssignmentListItem[]
  initialInvestigations: TuInspectionSummary[]
  initialError: string | null
}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState(initialAssignments)
  const [investigations, setInvestigations] = useState(initialInvestigations)
  const [form, setForm] = useState<TuFormState>(EMPTY_TU_FORM)
  const [scratchForm, setScratchForm] = useState<ScratchFormState>(EMPTY_SCRATCH_FORM)
  const [error, setError] = useState<string | null>(initialError)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const latestAssignments = useMemo(
    () => [...assignments].sort((a, b) => assignmentSortValue(b) - assignmentSortValue(a)).slice(0, 8),
    [assignments]
  )

  const updateForm = (key: keyof TuFormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const updateScratchForm = (key: keyof ScratchFormState, value: string) => {
    setScratchForm((current) => ({ ...current, [key]: value }))
  }

  const refresh = async () => {
    setBusy('refresh')
    setError(null)
    try {
      const [assignmentResponse, investigationResponse] = await Promise.all([
        fetch('/api/tu/assignments', { cache: 'no-store' }),
        fetch('/api/tu/investigations', { cache: 'no-store' }),
      ])
      const assignmentPayload = await assignmentResponse.json().catch(() => ({}))
      const investigationPayload = await investigationResponse.json().catch(() => ({}))
      if (!assignmentResponse.ok) throw new Error(assignmentPayload.error ?? 'Kunde inte hämta TU-uppdrag.')
      if (!investigationResponse.ok) {
        throw new Error(investigationPayload.error ?? 'Kunde inte hämta TU-utredningar.')
      }
      setAssignments(Array.isArray(assignmentPayload.items) ? assignmentPayload.items : [])
      setInvestigations(Array.isArray(investigationPayload.items) ? investigationPayload.items : [])
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Kunde inte uppdatera listorna.')
    } finally {
      setBusy(null)
    }
  }

  const submitAssignment = async (sendNow: boolean) => {
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
      setNotice(sendNow ? 'Uppdragsbekräftelsen är skickad.' : 'TU-uppdraget är sparat som utkast.')
      setForm(EMPTY_TU_FORM)
      await refresh()
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa TU-uppdrag.')
    } finally {
      setBusy(null)
    }
  }

  const sendAssignment = async (assignmentId: string) => {
    setBusy(`send:${assignmentId}`)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/tu/assignments/${assignmentId}/send`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte skicka TU-uppdrag.')
      setNotice('Uppdragsbekräftelsen är skickad.')
      await refresh()
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skicka TU-uppdrag.')
    } finally {
      setBusy(null)
    }
  }

  const convertAssignment = async (assignmentId: string) => {
    setBusy(`convert:${assignmentId}`)
    setError(null)
    setNotice(null)
    try {
      const response = await fetch(`/api/tu/assignments/${assignmentId}/convert`, { method: 'POST' })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error ?? 'Kunde inte starta TU-utredning.')
      router.push(`/tu/investigations/${payload.inspectionId}`)
    } catch (convertError) {
      setError(convertError instanceof Error ? convertError.message : 'Kunde inte starta TU-utredning.')
    } finally {
      setBusy(null)
    }
  }

  const createScratchInvestigation = async () => {
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
      router.push(`/tu/investigations/${payload.inspectionId}`)
    } catch (scratchError) {
      setError(scratchError instanceof Error ? scratchError.message : 'Kunde inte skapa TU-utredning.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-violet-50/40">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 md:px-6">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-violet-100 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">TU</p>
            <h1 className="text-2xl font-semibold tracking-tight text-gray-950">Tekniska utredningar</h1>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-600">
              Uppdragsbekräftelser, godkännande och utredningsutkast i ett fristående flöde.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={busy === 'refresh'}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-medium text-violet-800 shadow-sm hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
          >
            <RefreshCw size={16} aria-hidden />
            Uppdatera
          </button>
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

        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]">
          <div className="space-y-4 rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-gray-950">Snabb uppdragsbekräftelse</h2>
                <p className="text-sm text-gray-600">Fyll omfattning, tid, pris, adress och kunduppgifter.</p>
              </div>
              <Send size={20} className="text-violet-600" aria-hidden />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Kundnamn" value={form.customerName} onChange={(value) => updateForm('customerName', value)} />
              <Field
                label="Kundmejl *"
                value={form.customerEmail}
                onChange={(value) => updateForm('customerEmail', value)}
                type="email"
              />
              <Field label="Telefon" value={form.customerPhone} onChange={(value) => updateForm('customerPhone', value)} />
              <Field
                label="Kundadress"
                value={form.customerAddress}
                onChange={(value) => updateForm('customerAddress', value)}
              />
              <Field
                label="Kund postnummer"
                value={form.customerPostalCode}
                onChange={(value) => updateForm('customerPostalCode', value)}
              />
              <Field label="Kund ort" value={form.customerCity} onChange={(value) => updateForm('customerCity', value)} />
            </div>

            <Textarea
              label="Utredningens omfattning *"
              value={form.scopeDescription}
              onChange={(value) => updateForm('scopeDescription', value)}
              rows={4}
            />

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Objektadress"
                value={form.propertyAddress}
                onChange={(value) => updateForm('propertyAddress', value)}
              />
              <Field
                label="Fastighetsbeteckning"
                value={form.cadastralId}
                onChange={(value) => updateForm('cadastralId', value)}
              />
              <Field
                label="Objekt postnummer"
                value={form.propertyPostalCode}
                onChange={(value) => updateForm('propertyPostalCode', value)}
              />
              <Field label="Objekt ort" value={form.propertyCity} onChange={(value) => updateForm('propertyCity', value)} />
              <Field
                label="Kommun"
                value={form.propertyMunicipality}
                onChange={(value) => updateForm('propertyMunicipality', value)}
              />
              <Field
                label="Fastighetsägare"
                value={form.propertyOwnerName}
                onChange={(value) => updateForm('propertyOwnerName', value)}
              />
              <Field
                label="Datum"
                value={form.preferredDate}
                onChange={(value) => updateForm('preferredDate', value)}
                type="date"
              />
              <Field
                label="Tid"
                value={form.preferredTime}
                onChange={(value) => updateForm('preferredTime', value)}
                type="time"
              />
              <Field
                label="Pris SEK *"
                value={form.priceAmount}
                onChange={(value) => updateForm('priceAmount', value)}
                type="number"
              />
            </div>

            <Textarea
              label="Intern notering"
              value={form.notesInternal}
              onChange={(value) => updateForm('notesInternal', value)}
              rows={3}
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void submitAssignment(true)}
                disabled={busy === 'quick-send'}
                className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300"
              >
                <Send size={16} aria-hidden />
                Skicka uppdragsbekräftelse
              </button>
              <button
                type="button"
                onClick={() => void submitAssignment(false)}
                disabled={busy === 'draft'}
                className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-4 text-sm font-semibold text-violet-800 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
              >
                <Plus size={16} aria-hidden />
                Spara utkast
              </button>
            </div>
          </div>

          <div className="space-y-4 rounded-lg border border-violet-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-gray-950">Starta från scratch</h2>
              <p className="text-sm text-gray-600">Skapa en TU-utredning utan uppdragsbekräftelse.</p>
            </div>
            <Field label="Rubrik" value={scratchForm.title} onChange={(value) => updateScratchForm('title', value)} />
            <Textarea
              label="Utredningens omfattning"
              value={scratchForm.scopeDescription}
              onChange={(value) => updateScratchForm('scopeDescription', value)}
              rows={4}
            />
            <Field
              label="Objektadress"
              value={scratchForm.propertyAddress}
              onChange={(value) => updateScratchForm('propertyAddress', value)}
            />
            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Postnummer"
                value={scratchForm.propertyPostalCode}
                onChange={(value) => updateScratchForm('propertyPostalCode', value)}
              />
              <Field label="Ort" value={scratchForm.propertyCity} onChange={(value) => updateScratchForm('propertyCity', value)} />
              <Field
                label="Kommun"
                value={scratchForm.propertyMunicipality}
                onChange={(value) => updateScratchForm('propertyMunicipality', value)}
              />
              <Field
                label="Datum"
                value={scratchForm.date}
                onChange={(value) => updateScratchForm('date', value)}
                type="date"
              />
            </div>
            <Field label="Kundnamn" value={scratchForm.customerName} onChange={(value) => updateScratchForm('customerName', value)} />
            <button
              type="button"
              onClick={() => void createScratchInvestigation()}
              disabled={busy === 'scratch'}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300"
            >
              <FileText size={16} aria-hidden />
              Skapa utredning
            </button>
          </div>
        </section>

        <section className="grid gap-5 lg:grid-cols-2">
          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-950">Uppdragsbekräftelser</h2>
            {latestAssignments.length === 0 ? (
              <EmptyState text="Inga TU-uppdrag ännu." />
            ) : (
              latestAssignments.map((assignment) => (
                <article key={assignment.id} className="rounded-lg border border-violet-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-950">
                        {assignment.customer_name || assignment.customer_email}
                      </p>
                      <p className="mt-1 text-sm text-gray-600">
                        {assignment.property_address || assignment.preliminary_address || 'Ingen adress'}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatDate(assignment.preferred_date)} · {assignment.preferred_time || '-'} ·{' '}
                        {statusLabel(assignment.status)}
                      </p>
                    </div>
                    <span className="rounded-full border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-700">
                      {statusLabel(assignment.status)}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {assignment.inspection_id ? (
                      <button
                        type="button"
                        onClick={() => router.push(`/tu/investigations/${assignment.inspection_id}`)}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-medium text-violet-800 hover:bg-violet-50"
                      >
                        <FileText size={15} aria-hidden />
                        Öppna utredning
                      </button>
                    ) : null}
                    {assignment.status === 'draft' || assignment.status === 'sent' ? (
                      <button
                        type="button"
                        onClick={() => void sendAssignment(assignment.id)}
                        disabled={busy === `send:${assignment.id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-medium text-violet-800 hover:bg-violet-50 disabled:cursor-wait disabled:opacity-60"
                      >
                        <Send size={15} aria-hidden />
                        Skicka
                      </button>
                    ) : null}
                    {assignment.status === 'ordered' ? (
                      <button
                        type="button"
                        onClick={() => void convertAssignment(assignment.id)}
                        disabled={busy === `convert:${assignment.id}`}
                        className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-wait disabled:bg-violet-300"
                      >
                        <Play size={15} aria-hidden />
                        Starta utredning
                      </button>
                    ) : null}
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-950">Utredningar</h2>
            {investigations.length === 0 ? (
              <EmptyState text="Inga TU-utredningar ännu." />
            ) : (
              investigations.map((investigation) => (
                <article key={investigation.inspectionId} className="rounded-lg border border-violet-100 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-950">{investigation.title}</p>
                      <p className="mt-1 text-sm text-gray-600">
                        {investigation.propertyAddress || 'Ingen adress'} {investigation.propertyCity || ''}
                      </p>
                      <p className="mt-1 text-xs text-gray-500">
                        {formatDate(investigation.date)} · {investigation.inspectionTime || '-'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => router.push(`/tu/investigations/${investigation.inspectionId}`)}
                      className="inline-flex h-9 items-center gap-2 rounded-md bg-violet-600 px-3 text-sm font-medium text-white hover:bg-violet-700"
                    >
                      <FileText size={15} aria-hidden />
                      Öppna
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-dashed border-violet-200 bg-white/70 px-4 py-6 text-sm text-gray-500">
      {text}
    </div>
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
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
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
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <textarea
        value={value}
        rows={rows}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border border-gray-300 bg-white px-3 py-2 text-sm leading-6 text-gray-950 outline-none transition focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
      />
    </label>
  )
}
