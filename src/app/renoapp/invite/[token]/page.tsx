'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type InvitePreview = {
  state: 'open' | 'expired' | 'revoked' | 'accepted'
  invite: {
    email: string
    role: 'board'
    expiresAt: string
    acceptedAt: string | null
    revokedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
    orgNumber: string | null
    propertyDesignation: string | null
    address: string | null
    addressLine2: string | null
    postalCode: string | null
    city: string | null
    invoiceAddress: string | null
    invoiceEmail: string | null
    invoiceReference: string | null
    primaryContactName: string | null
    primaryContactEmail: string | null
    primaryContactPhone: string | null
    unitCount: number | null
    generalEmail: string | null
    brfPhone: string | null
    technicalContact: string | null
    onboardingComment: string | null
    onboardingCompletedAt: string | null
  }
  currentUser: {
    email: string | null
    matchesInvite: boolean
  }
}

type FormState = {
  name: string
  orgNumber: string
  propertyDesignation: string
  address: string
  addressLine2: string
  postalCode: string
  city: string
  invoiceAddress: string
  invoiceEmail: string
  invoiceReference: string
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string
  unitCount: string
  generalEmail: string
  brfPhone: string
  technicalContact: string
  onboardingComment: string
}

const EMPTY_FORM: FormState = {
  name: '',
  orgNumber: '',
  propertyDesignation: '',
  address: '',
  addressLine2: '',
  postalCode: '',
  city: '',
  invoiceAddress: '',
  invoiceEmail: '',
  invoiceReference: '',
  primaryContactName: '',
  primaryContactEmail: '',
  primaryContactPhone: '',
  unitCount: '',
  generalEmail: '',
  brfPhone: '',
  technicalContact: '',
  onboardingComment: '',
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function toFormState(payload: InvitePreview): FormState {
  return {
    name: payload.brf.name ?? '',
    orgNumber: payload.brf.orgNumber ?? '',
    propertyDesignation: payload.brf.propertyDesignation ?? '',
    address: payload.brf.address ?? '',
    addressLine2: payload.brf.addressLine2 ?? '',
    postalCode: payload.brf.postalCode ?? '',
    city: payload.brf.city ?? '',
    invoiceAddress: payload.brf.invoiceAddress ?? payload.brf.address ?? '',
    invoiceEmail: payload.brf.invoiceEmail ?? '',
    invoiceReference: payload.brf.invoiceReference ?? '',
    primaryContactName: payload.brf.primaryContactName ?? '',
    primaryContactEmail: payload.invite.email,
    primaryContactPhone: payload.brf.primaryContactPhone ?? '',
    unitCount: payload.brf.unitCount ? String(payload.brf.unitCount) : '',
    generalEmail: payload.brf.generalEmail ?? '',
    brfPhone: payload.brf.brfPhone ?? '',
    technicalContact: payload.brf.technicalContact ?? '',
    onboardingComment: payload.brf.onboardingComment ?? '',
  }
}

export default function RenoAppInvitePage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [payload, setPayload] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [requiresManualLogin, setRequiresManualLogin] = useState(false)

  useEffect(() => {
    let active = true

    const loadInvite = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/invites/${token}`, { cache: 'no-store' })
        const data = (await response.json().catch(() => ({}))) as InvitePreview & { error?: string }

        if (!response.ok) {
          throw new Error(data.error ?? 'Kunde inte läsa inviten.')
        }

        if (active) {
          setPayload(data)
          setForm(toFormState(data))
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa inviten.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    if (token) {
      void loadInvite()
    } else {
      setLoading(false)
      setError('Ogiltig invite-länk.')
    }

    return () => {
      active = false
    }
  }, [token])

  const updateField = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const handleAccept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setActionError(null)
    setRequiresManualLogin(false)

    try {
      const response = await fetch(`/api/renoapp/invites/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          password,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        accepted?: boolean
        createdUser?: boolean
        signInEmail?: string
        error?: string
      }

      if (!response.ok) {
        const message = result.error ?? 'Kunde inte slutföra BRF-anslutningen.'
        if (response.status === 409 && message.includes('Logga in först')) {
          setRequiresManualLogin(true)
        }
        throw new Error(message)
      }

      if (result.createdUser && result.signInEmail) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: result.signInEmail,
          password,
        })

        if (signInError) {
          throw new Error('Kontot skapades, men automatisk inloggning misslyckades. Logga in manuellt.')
        }
      }

      router.replace('/renoapp/app')
    } catch (submitError) {
      setActionError(
        submitError instanceof Error ? submitError.message : 'Kunde inte slutföra BRF-anslutningen.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-6xl px-6 py-14 md:px-10">Laddar anslutning...</main>
  }

  if (error || !payload) {
    return (
      <main className="mx-auto min-h-screen max-w-5xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          {error ?? 'Inviten hittades inte.'}
        </div>
      </main>
    )
  }

  const requiresExistingLogin = payload.currentUser.email !== null && !payload.currentUser.matchesInvite
  const needsPassword = !payload.currentUser.matchesInvite

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/92 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Slutför BRF-anslutning</h1>
          <p className="mt-4 text-base leading-8 text-stone-700">
            Den här länken används för att aktivera styrelsekontot och fylla i de uppgifter som krävs innan
            BRF:en är klar i RenoApp.
          </p>

          <div className="mt-8 grid gap-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-900">BRF</p>
              <p className="mt-2 text-sm text-stone-700">{payload.brf.name}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-900">Inbjuden e-post</p>
              <p className="mt-2 break-all text-sm text-stone-700">{payload.invite.email}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-900">Roll</p>
              <p className="mt-2 text-sm text-stone-700">Styrelsemedlem</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-900">Invite-status</p>
              <p className="mt-2 text-sm text-stone-700">{payload.state}</p>
              <p className="mt-2 text-xs text-stone-500">Giltig till {formatDateTime(payload.invite.expiresAt)}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.96))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          {payload.state === 'accepted' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
              <p className="font-semibold">Inviten har redan accepterats.</p>
              <p className="mt-1">
                {payload.brf.onboardingCompletedAt
                  ? 'BRF-anslutningen är redan slutförd. Fortsätt till arbetsytan för att börja använda RenoApp.'
                  : 'Kontot är redan kopplat till BRF:en. Om uppgifterna inte blev klara tidigare behöver anslutningen kompletteras från admin.'}
              </p>
              <div className="mt-4">
                <Link
                  href="/renoapp/app"
                  className="inline-flex rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
                >
                  Öppna RenoApp
                </Link>
              </div>
            </div>
          ) : payload.state === 'expired' || payload.state === 'revoked' ? (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-800">
              Den här inviten är inte längre aktiv. Kontakta HusHub om du behöver en ny länk.
            </div>
          ) : requiresExistingLogin ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              Du är inloggad med {payload.currentUser.email}. Logga ut och öppna inviten igen med {payload.invite.email}.
            </div>
          ) : (
            <form onSubmit={handleAccept} className="grid gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Steg 1</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                  {needsPassword ? 'Aktivera kontot' : 'Kontot är klart'}
                </h2>
                {needsPassword ? (
                  <div className="mt-4 grid gap-4">
                    <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                      Kontot skapas för <strong>{payload.invite.email}</strong>.
                    </div>
                    <input
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                      placeholder="Välj lösenord"
                      type="password"
                    />
                    <p className="text-xs text-stone-500">Minst 8 tecken.</p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                    Du är inloggad med rätt e-postadress. Fyll nu i BRF-uppgifterna nedan för att slutföra anslutningen.
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Steg 2</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">Obligatoriska BRF-uppgifter</h2>
                <p className="mt-2 text-sm leading-7 text-stone-600">
                  De här uppgifterna behövs innan BRF:en kan börja arbeta i RenoApp.
                </p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <input
                  value={form.name}
                  onChange={(event) => updateField('name', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="BRF-namn *"
                />
                <input
                  value={form.orgNumber}
                  onChange={(event) => updateField('orgNumber', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Organisationsnummer *"
                />
                <input
                  value={form.propertyDesignation}
                  onChange={(event) => updateField('propertyDesignation', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                  placeholder="Fastighetsbeteckning *"
                />
                <input
                  value={form.address}
                  onChange={(event) => updateField('address', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                  placeholder="Gatuadress *"
                />
                <input
                  value={form.addressLine2}
                  onChange={(event) => updateField('addressLine2', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                  placeholder="C/o eller adressrad 2"
                />
                <input
                  value={form.postalCode}
                  onChange={(event) => updateField('postalCode', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  inputMode="numeric"
                  placeholder="Postnummer *"
                />
                <input
                  value={form.city}
                  onChange={(event) => updateField('city', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Ort *"
                />
                <textarea
                  value={form.invoiceAddress}
                  onChange={(event) => updateField('invoiceAddress', event.target.value)}
                  className="min-h-[110px] rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                  placeholder="Fakturaadress *"
                />
                <input
                  value={form.invoiceEmail}
                  onChange={(event) => updateField('invoiceEmail', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Faktura-e-post *"
                  type="email"
                />
                <input
                  value={form.unitCount}
                  onChange={(event) => updateField('unitCount', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  inputMode="numeric"
                  placeholder="Antal lägenheter *"
                />
                <input
                  value={form.primaryContactName}
                  onChange={(event) => updateField('primaryContactName', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Huvudkontakt namn *"
                />
                <input
                  value={form.primaryContactPhone}
                  onChange={(event) => updateField('primaryContactPhone', event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Huvudkontakt telefon *"
                />
                <input
                  value={form.primaryContactEmail}
                  readOnly
                  className="rounded-2xl border border-stone-200 bg-stone-100 px-4 py-3 text-sm text-stone-600 md:col-span-2"
                  placeholder="Huvudkontakt e-post *"
                  type="email"
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Valfritt</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <input
                    value={form.generalEmail}
                    onChange={(event) => updateField('generalEmail', event.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                    placeholder="Allmän BRF-e-post"
                    type="email"
                  />
                  <input
                    value={form.brfPhone}
                    onChange={(event) => updateField('brfPhone', event.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                    placeholder="BRF-telefon"
                  />
                  <input
                    value={form.invoiceReference}
                    onChange={(event) => updateField('invoiceReference', event.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                    placeholder="Fakturareferens"
                  />
                  <input
                    value={form.technicalContact}
                    onChange={(event) => updateField('technicalContact', event.target.value)}
                    className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                    placeholder="Teknisk förvaltare eller extern kontakt"
                  />
                  <textarea
                    value={form.onboardingComment}
                    onChange={(event) => updateField('onboardingComment', event.target.value)}
                    className="min-h-[110px] rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900 md:col-span-2"
                    placeholder="Kommentar till onboarding"
                  />
                </div>
              </div>

              {actionError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Slutför...' : 'Slutför BRF-anslutning'}
                </button>
                {requiresManualLogin ? (
                  <Link
                    href="/renoapp/login"
                    className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                  >
                    Logga in med rätt konto
                  </Link>
                ) : null}
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
