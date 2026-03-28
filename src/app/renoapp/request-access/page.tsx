'use client'

import { useState } from 'react'

type FormState = {
  name: string
  orgNumber: string
  address: string
  contactName: string
  contactEmail: string
  contactPhone: string
  message: string
}

type SubmitResult = {
  id: string
  status: 'pending'
  receipt: {
    emailSent: boolean
    emailError: string | null
  }
}

const INITIAL_FORM: FormState = {
  name: '',
  orgNumber: '',
  address: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  message: '',
}

const ORG_NUMBER_PATTERN = /^\d{6}-\d{4}$/

function formatOrgNumber(value: string) {
  const digits = value.replace(/\D/g, '').slice(0, 10)
  if (digits.length <= 6) return digits
  return `${digits.slice(0, 6)}-${digits.slice(6)}`
}

export default function RenoAppRequestAccessPage() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formattedOrgNumber = formatOrgNumber(form.orgNumber)

    if (!ORG_NUMBER_PATTERN.test(formattedOrgNumber)) {
      setError('Ange organisationsnummer i formatet XXXXXX-XXXX.')
      setSuccess(false)
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccess(false)
    setSubmitResult(null)

    try {
      const response = await fetch('/api/renoapp/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          orgNumber: formattedOrgNumber,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as SubmitResult & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte skicka intresseanmälan.')
      }

      setSuccess(true)
      setSubmitResult(payload)
      setForm(INITIAL_FORM)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skicka intresseanmälan.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-14 md:px-10">
      <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Anslut BRF</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Ansök om att ansluta RenoApp</h1>
          <p className="mt-4 text-base leading-8 text-stone-700">
            BRF kan inte registrera sig fritt i MVP. Skicka en intresseanmälan så granskar admin förfrågan och skickar
            sedan en invite till styrelsen vid godkännande.
          </p>
          <div className="mt-8 rounded-3xl border border-stone-200 bg-stone-50 p-6">
            <p className="text-sm font-semibold text-stone-900">Det här händer sedan</p>
            <ol className="mt-3 space-y-2 text-sm leading-7 text-stone-700">
              <li>1. Förfrågan registreras som pending.</li>
              <li>2. Admin granskar uppgifterna.</li>
              <li>3. Vid godkännande skapas BRF och invite skickas till styrelsen.</li>
              <li>4. Styrelsen aktiverar sitt konto via säker länk.</li>
            </ol>
          </div>
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <h2 className="text-2xl font-semibold text-stone-900">Skicka intresseanmälan</h2>
          <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
            <input value={form.name} onChange={(event) => updateField('name', event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="BRF-namn" />
            <input
              value={form.orgNumber}
              onChange={(event) => updateField('orgNumber', formatOrgNumber(event.target.value))}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
              placeholder="Organisationsnummer, t.ex. 769600-1234"
              inputMode="numeric"
              autoComplete="off"
              maxLength={11}
              pattern="^\d{6}-\d{4}$"
              title="Ange organisationsnummer i formatet XXXXXX-XXXX."
              required
            />
            <input value={form.address} onChange={(event) => updateField('address', event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="Adress" />
            <div className="grid gap-4 sm:grid-cols-2">
              <input value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="Kontaktperson" />
              <input value={form.contactEmail} onChange={(event) => updateField('contactEmail', event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="E-post" type="email" />
            </div>
            <input value={form.contactPhone} onChange={(event) => updateField('contactPhone', event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="Telefon" />
            <textarea value={form.message} onChange={(event) => updateField('message', event.target.value)} className="min-h-32 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="Kort beskrivning eller frågor" />
            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}
            {success ? (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                <p>Intresseanmälan skickades. Admin behöver godkänna BRF innan någon invite kan skickas.</p>
                {submitResult?.receipt.emailSent ? (
                  <p className="mt-1">Bekräftelsemejl skickades till kontaktadressen.</p>
                ) : submitResult?.receipt.emailError ? (
                  <p className="mt-1 text-amber-900">Bekräftelsemejl kunde inte skickas: {submitResult.receipt.emailError}</p>
                ) : null}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={submitting} className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60">
                {submitting ? 'Skickar...' : 'Skicka intresseanmälan'}
              </button>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
