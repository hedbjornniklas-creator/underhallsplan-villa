'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import Protected from '@/components/Protected'

type AssignmentType = 'OB' | 'STATUS' | 'UHP'
type TermsVariant = 'seller' | 'buyer' | 'apartment'

type NewAssignmentClientProps = {
  sellerTemplate: string
  buyerTemplate: string
  apartmentTemplate: string
}

type FormState = {
  assignmentType: AssignmentType
  customerName: string
  customerEmail: string
  customerPhone: string
  preliminaryAddress: string
  preferredDate: string
  preferredTime: string
  notesInternal: string
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const INITIAL_FORM: FormState = {
  assignmentType: 'OB',
  customerName: '',
  customerEmail: '',
  customerPhone: '',
  preliminaryAddress: '',
  preferredDate: '',
  preferredTime: '',
  notesInternal: '',
}

export default function NewAssignmentClient({
  sellerTemplate,
  buyerTemplate,
  apartmentTemplate,
}: NewAssignmentClientProps) {
  const router = useRouter()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [termsVariant, setTermsVariant] = useState<TermsVariant>('seller')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeTemplate =
    termsVariant === 'seller'
      ? sellerTemplate
      : termsVariant === 'buyer'
        ? buyerTemplate
        : apartmentTemplate

  const trimmedEmail = form.customerEmail.trim().toLowerCase()
  const canCreate = useMemo(() => EMAIL_REGEX.test(trimmedEmail), [trimmedEmail])

  const updateField = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleCreate = async () => {
    if (!canCreate) {
      setError('Ange en giltig kundmejl innan du skapar uppdraget.')
      return
    }

    try {
      setCreating(true)
      setError(null)

      const response = await fetch('/api/ob/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentType: form.assignmentType,
          customerName: form.customerName.trim(),
          customerEmail: trimmedEmail,
          customerPhone: form.customerPhone.trim(),
          preliminaryAddress: form.preliminaryAddress.trim(),
          preferredDate: form.preferredDate,
          preferredTime: form.preferredTime,
          notesInternal: form.notesInternal.trim(),
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        assignment?: { id?: string }
      }

      if (!response.ok || !payload.assignment?.id) {
        throw new Error(payload.error ?? 'Kunde inte skapa uppdrag.')
      }

      router.push(`/ob/assignments/${payload.assignment.id}`)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Kunde inte skapa uppdrag.')
    } finally {
      setCreating(false)
    }
  }

  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 70% at 50% 0%, rgba(219,234,254,0.5) 0%, rgba(219,234,254,0) 60%), linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 42%, #60a5fa 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/10 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-6xl space-y-4 p-4 md:p-6">
          <header className="rounded-2xl border border-white/30 bg-white/10 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => router.push('/ob/assignments')}
                aria-label="Tillbaka"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-white/50 bg-white/15 text-white transition hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </button>
              <h1 className="text-2xl font-semibold text-white drop-shadow-sm">Ny uppdragsbekräftelse</h1>
              <div className="ml-auto">
                <button
                  type="button"
                  onClick={() => void handleCreate()}
                  disabled={creating || !canCreate}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-white/95 px-3 py-2 text-sm font-medium text-gray-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creating ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      Skapar...
                    </>
                  ) : (
                    'Skapa utkast'
                  )}
                </button>
              </div>
            </div>
          </header>

          {error ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</div>
          ) : null}

          <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Grunduppgifter</h2>

            <div className="grid gap-3 md:grid-cols-3">
              <SelectField
                label="Typ"
                value={form.assignmentType}
                onChange={(value) => updateField('assignmentType', value as AssignmentType)}
                options={[
                  { value: 'OB', label: 'Överlåtelsebesiktning' },
                  { value: 'STATUS', label: 'Statusbesiktning' },
                  { value: 'UHP', label: 'Underhållsplan' },
                ]}
              />
              <Field
                label="Datum"
                type="date"
                value={form.preferredDate}
                onChange={(value) => updateField('preferredDate', value)}
              />
              <Field
                label="Tid"
                type="time"
                value={form.preferredTime}
                onChange={(value) => updateField('preferredTime', value)}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Kundnamn"
                value={form.customerName}
                onChange={(value) => updateField('customerName', value)}
              />
              <Field
                label="Kundmejl *"
                value={form.customerEmail}
                onChange={(value) => updateField('customerEmail', value)}
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <Field
                label="Kundtelefon"
                value={form.customerPhone}
                onChange={(value) => updateField('customerPhone', value)}
              />
              <Field
                label="Preliminär adress"
                value={form.preliminaryAddress}
                onChange={(value) => updateField('preliminaryAddress', value)}
              />
            </div>

            <Field
              label="Intern anteckning"
              value={form.notesInternal}
              onChange={(value) => updateField('notesInternal', value)}
            />
          </section>

          <section className="space-y-4 rounded-2xl border border-white/30 bg-white/90 p-4 shadow-sm backdrop-blur md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">Juridisk text</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTermsVariant('seller')}
                  className={
                    termsVariant === 'seller'
                      ? 'rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50'
                  }
                >
                  Säljare
                </button>
                <button
                  type="button"
                  onClick={() => setTermsVariant('buyer')}
                  className={
                    termsVariant === 'buyer'
                      ? 'rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50'
                  }
                >
                  Köpare
                </button>
                <button
                  type="button"
                  onClick={() => setTermsVariant('apartment')}
                  className={
                    termsVariant === 'apartment'
                      ? 'rounded-md border border-indigo-600 bg-indigo-600 px-3 py-1 text-xs font-medium text-white'
                      : 'rounded-md border border-gray-200 bg-white px-3 py-1 text-xs text-gray-700 hover:bg-gray-50'
                  }
                >
                  Lägenhet
                </button>
              </div>
            </div>

            <div className="rounded-xl border border-gray-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-600">Malltext</p>
              <pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-700">
                {activeTemplate}
              </pre>
            </div>
          </section>
        </div>
      </main>
    </Protected>
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
  type?: 'text' | 'date' | 'time'
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: Array<{ value: string; label: string }>
}) {
  return (
    <label className="space-y-1">
      <span className="block text-xs font-medium text-gray-600">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}
