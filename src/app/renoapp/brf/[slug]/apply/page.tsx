'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

type Requirement = {
  id: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  note: string | null
}

type ActionType = {
  id: string
  key: string
  label: string
  requirements: Requirement[]
}

type PublicConfigResponse = {
  brf: {
    id: string
    name: string
    slug: string
    applyIntroText: string | null
  }
  actionTypes: ActionType[]
}

type SubmitResult = {
  caseId: string
  caseNumber: string
  accessUrl: string
  emailSent: boolean
  emailError: string | null
}

type FormState = {
  applicantName: string
  applicantEmail: string
  applicantPhone: string
  unitNumberInternal: string
  unitNumberSkatteverket: string
  actionTypeKey: string
  description: string
  affectsStructure: boolean
  affectsPlumbing: boolean
  affectsVentilation: boolean
  affectsElectrical: boolean
  affectsWetRoom: boolean
  affectsSurfaceOnly: boolean
}

const INITIAL_FORM: FormState = {
  applicantName: '',
  applicantEmail: '',
  applicantPhone: '',
  unitNumberInternal: '',
  unitNumberSkatteverket: '',
  actionTypeKey: '',
  description: '',
  affectsStructure: false,
  affectsPlumbing: false,
  affectsVentilation: false,
  affectsElectrical: false,
  affectsWetRoom: false,
  affectsSurfaceOnly: false,
}

export default function RenoAppApplyPage() {
  const params = useParams<{ slug: string }>()
  const slug = typeof params?.slug === 'string' ? params.slug : 'okand-brf'
  const [config, setConfig] = useState<PublicConfigResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [submitting, setSubmitting] = useState(false)
  const [submitResult, setSubmitResult] = useState<SubmitResult | null>(null)

  useEffect(() => {
    let active = true

    const loadConfig = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/brf/${slug}/public`, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as PublicConfigResponse & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa BRF-konfiguration.')
        }

        if (!active) return
        setConfig(payload)
        setForm((current) => ({
          ...current,
          actionTypeKey: current.actionTypeKey || payload.actionTypes[0]?.key || '',
        }))
      } catch (fetchError) {
        if (!active) return
        setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa BRF-konfiguration.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadConfig()

    return () => {
      active = false
    }
  }, [slug])

  const selectedAction = useMemo(
    () => config?.actionTypes.find((action) => action.key === form.actionTypeKey) ?? null,
    [config, form.actionTypeKey]
  )

  const updateField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setSubmitResult(null)

    try {
      const response = await fetch('/api/renoapp/public/applications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brfSlug: slug,
          applicantName: form.applicantName,
          applicantEmail: form.applicantEmail,
          applicantPhone: form.applicantPhone,
          unitNumberInternal: form.unitNumberInternal,
          unitNumberSkatteverket: form.unitNumberSkatteverket,
          actionTypeKey: form.actionTypeKey,
          description: form.description,
          checks: {
            affectsStructure: form.affectsStructure,
            affectsPlumbing: form.affectsPlumbing,
            affectsVentilation: form.affectsVentilation,
            affectsElectrical: form.affectsElectrical,
            affectsWetRoom: form.affectsWetRoom,
            affectsSurfaceOnly: form.affectsSurfaceOnly,
          },
        }),
      })

      const payload = (await response.json().catch(() => ({}))) as SubmitResult & { error?: string }
      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte skicka ansökan.')
      }

      setSubmitResult(payload)
      setForm((current) => ({
        ...INITIAL_FORM,
        actionTypeKey: current.actionTypeKey,
      }))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skicka ansökan.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-5xl px-6 py-14 md:px-10">Laddar publik ansökan...</main>
  }

  if (error && !config) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">{error}</div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-14 md:px-10">
      <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/80 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Publik ansökan</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">{config?.brf.name ?? slug}</h1>
          <p className="mt-4 text-base leading-8 text-stone-700">
            {config?.brf.applyIntroText ??
              'Skicka in en renoveringsansökan utan konto. När ansökan registreras skapas kontakt, eventuell preliminär lägenhet och ett RenoApp-ärende med magic link.'}
          </p>

          {selectedAction ? (
            <div className="mt-8 rounded-3xl bg-stone-900 p-5 text-sm leading-7 text-stone-100">
              <p className="font-semibold">Dokument för {selectedAction.label}</p>
              {selectedAction.requirements.length === 0 ? (
                <p className="mt-2 text-stone-200">Inga dokumentkrav är ännu konfigurerade för denna åtgärdstyp.</p>
              ) : (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-stone-200">
                  {selectedAction.requirements.map((requirement) => (
                    <li key={requirement.id}>
                      {requirement.documentLabel}
                      {requirement.isRequired ? ' (obligatorisk)' : ' (valfri)'}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {submitResult ? (
            <div className="mt-8 rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-sm leading-7 text-emerald-950">
              <p className="font-semibold">Ansökan registrerad</p>
              <p className="mt-2">Ärendenummer: {submitResult.caseNumber}</p>
              <p className="mt-2">
                {submitResult.emailSent ? 'Åtkomstlänk skickad via mejl.' : 'Mejl skickades inte automatiskt i den här miljön.'}
              </p>
              <p className="mt-2 break-all">Åtkomstlänk: {submitResult.accessUrl}</p>
              {submitResult.emailError ? <p className="mt-2 text-amber-900">{submitResult.emailError}</p> : null}
            </div>
          ) : null}
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <h2 className="text-2xl font-semibold text-stone-900">Skicka ansökan</h2>
          <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
            <input
              value={form.applicantName}
              onChange={(event) => updateField('applicantName', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
              placeholder="Namn"
            />
            <input
              value={form.applicantEmail}
              onChange={(event) => updateField('applicantEmail', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
              placeholder="E-post"
              type="email"
            />
            <input
              value={form.applicantPhone}
              onChange={(event) => updateField('applicantPhone', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
              placeholder="Telefon"
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <input
                value={form.unitNumberInternal}
                onChange={(event) => updateField('unitNumberInternal', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
                placeholder="Internt lägenhetsnummer"
              />
              <input
                value={form.unitNumberSkatteverket}
                onChange={(event) => updateField('unitNumberSkatteverket', event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
                placeholder="Skatteverkets lägenhetsnummer"
              />
            </div>
            <select
              value={form.actionTypeKey}
              onChange={(event) => updateField('actionTypeKey', event.target.value)}
              className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
            >
              {config?.actionTypes.map((action) => (
                <option key={action.id} value={action.key}>
                  {action.label}
                </option>
              ))}
            </select>
            <textarea
              value={form.description}
              onChange={(event) => updateField('description', event.target.value)}
              className="min-h-36 rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 outline-none ring-0 transition focus:border-stone-500"
              placeholder="Beskriv åtgärden"
            />

            <div className="rounded-3xl border border-stone-200 bg-white/70 p-5">
              <p className="text-sm font-semibold text-stone-900">Teknisk påverkan</p>
              <div className="mt-3 grid gap-2 text-sm text-stone-700 sm:grid-cols-2">
                {[
                  ['affectsStructure', 'Bärande konstruktion'],
                  ['affectsPlumbing', 'VVS'],
                  ['affectsVentilation', 'Ventilation'],
                  ['affectsElectrical', 'El'],
                  ['affectsWetRoom', 'Våtrum'],
                  ['affectsSurfaceOnly', 'Endast ytskikt'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white px-3 py-2">
                    <input
                      checked={Boolean(form[key as keyof FormState])}
                      onChange={(event) => updateField(key as keyof FormState, event.target.checked as never)}
                      type="checkbox"
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </div>

            {error ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div> : null}

            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Skickar...' : 'Skicka ansökan'}
              </button>
              <Link href="/renoapp" className="rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100">
                Till RenoApp-start
              </Link>
            </div>
          </form>
        </section>
      </div>
    </main>
  )
}
