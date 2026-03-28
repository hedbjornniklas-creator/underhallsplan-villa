'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type InvitePreview = {
  state: 'open' | 'expired' | 'revoked' | 'accepted'
  invite: {
    email: string
    fullName: string | null
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

type UserState = {
  name: string
  email: string
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
}

type InputFieldProps = {
  label: string
  required?: boolean
  value: string
  onChange?: (value: string) => void
  placeholder?: string
  type?: string
  readOnly?: boolean
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode']
  className?: string
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
}

const EMPTY_USER: UserState = {
  name: '',
  email: '',
}

const MAX_ADDITIONAL_USERS = 3

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function toFormState(payload: InvitePreview): FormState {
  const generalEmail =
    payload.brf.generalEmail && payload.brf.generalEmail !== payload.invite.email ? payload.brf.generalEmail : ''

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
    primaryContactEmail: payload.brf.primaryContactEmail ?? payload.invite.email,
    primaryContactPhone: payload.brf.primaryContactPhone ?? '',
    unitCount: payload.brf.unitCount ? String(payload.brf.unitCount) : '',
    generalEmail,
    brfPhone: payload.brf.brfPhone ?? '',
    technicalContact: payload.brf.technicalContact ?? '',
  }
}

function toInviteUserName(payload: InvitePreview) {
  return payload.invite.fullName ?? payload.brf.primaryContactName ?? ''
}

function FieldLabel({ label, required = false }: { label: string; required?: boolean }) {
  return (
    <span className="mb-2 block text-sm font-semibold text-stone-800">
      {label}
      {required ? ' *' : ''}
    </span>
  )
}

function InputField({
  label,
  required = false,
  value,
  onChange,
  placeholder,
  type = 'text',
  readOnly = false,
  inputMode,
  className = '',
}: InputFieldProps) {
  return (
    <label className={`block ${className}`.trim()}>
      <FieldLabel label={label} required={required} />
      <input
        value={value}
        onChange={onChange ? (event) => onChange(event.target.value) : undefined}
        className={`w-full rounded-2xl border px-4 py-3 text-sm ${
          readOnly
            ? 'border-stone-200 bg-stone-100 text-stone-600'
            : 'border-stone-300 bg-white text-stone-900'
        }`}
        placeholder={placeholder}
        type={type}
        readOnly={readOnly}
        inputMode={inputMode}
      />
    </label>
  )
}

export default function RenoAppInvitePage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [payload, setPayload] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [inviteUserName, setInviteUserName] = useState('')
  const [additionalUsers, setAdditionalUsers] = useState<UserState[]>([])
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
          setInviteUserName(toInviteUserName(data))
          setAdditionalUsers([])
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

  const updateAdditionalUser = (index: number, field: keyof UserState, value: string) => {
    setAdditionalUsers((current) =>
      current.map((user, currentIndex) =>
        currentIndex === index
          ? {
              ...user,
              [field]: value,
            }
          : user
      )
    )
  }

  const addAdditionalUser = () => {
    setAdditionalUsers((current) =>
      current.length >= MAX_ADDITIONAL_USERS ? current : [...current, { ...EMPTY_USER }]
    )
  }

  const removeAdditionalUser = (index: number) => {
    setAdditionalUsers((current) => current.filter((_, currentIndex) => currentIndex !== index))
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
          inviteUserName,
          additionalUsers,
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
      <div className="grid gap-5">
        <section className="rounded-[28px] border border-stone-200/80 bg-white/94 p-5 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900 md:text-3xl">Slutför BRF-anslutning</h1>
          <p className="mt-2 text-sm leading-7 text-stone-600">
            Slutför uppgifterna för {payload.brf.name} och lägg till de första användarna innan BRF:en börjar arbeta i RenoApp.
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">BRF</p>
              <p className="mt-1 text-sm text-stone-700">{payload.brf.name}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">E-post</p>
              <p className="mt-1 break-all text-sm text-stone-700">{payload.invite.email}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Roll</p>
              <p className="mt-1 text-sm text-stone-700">Styrelsemedlem</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Giltig till</p>
              <p className="mt-1 text-sm text-stone-700">{formatDateTime(payload.invite.expiresAt)}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.96))] p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:p-8">
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
                    <InputField
                      label="Lösenord"
                      required
                      value={password}
                      onChange={setPassword}
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
                <InputField
                  label="BRF-namn"
                  required
                  value={form.name}
                  onChange={(value) => updateField('name', value)}
                  placeholder="BRF-namn *"
                />
                <InputField
                  label="Organisationsnummer"
                  required
                  value={form.orgNumber}
                  onChange={(value) => updateField('orgNumber', value)}
                  placeholder="Organisationsnummer *"
                />
                <InputField
                  label="Fastighetsbeteckning"
                  required
                  value={form.propertyDesignation}
                  onChange={(value) => updateField('propertyDesignation', value)}
                  className="md:col-span-2"
                  placeholder="Fastighetsbeteckning *"
                />
                <InputField
                  label="Gatuadress"
                  required
                  value={form.address}
                  onChange={(value) => updateField('address', value)}
                  className="md:col-span-2"
                  placeholder="Gatuadress *"
                />
                <InputField
                  label="Adressrad 2"
                  value={form.addressLine2}
                  onChange={(value) => updateField('addressLine2', value)}
                  className="md:col-span-2"
                  placeholder="C/o eller adressrad 2"
                />
                <InputField
                  label="Postnummer"
                  required
                  value={form.postalCode}
                  onChange={(value) => updateField('postalCode', value)}
                  inputMode="numeric"
                  placeholder="Postnummer *"
                />
                <InputField
                  label="Ort"
                  required
                  value={form.city}
                  onChange={(value) => updateField('city', value)}
                  placeholder="Ort *"
                />
                <InputField
                  label="Fakturaadress"
                  required
                  value={form.invoiceAddress}
                  onChange={(value) => updateField('invoiceAddress', value)}
                  className="md:col-span-2"
                  placeholder="Fakturaadress *"
                />
                <InputField
                  label="Faktura-e-post"
                  required
                  value={form.invoiceEmail}
                  onChange={(value) => updateField('invoiceEmail', value)}
                  placeholder="Faktura-e-post *"
                  type="email"
                />
                <InputField
                  label="Kontaktperson namn"
                  required
                  value={form.primaryContactName}
                  onChange={(value) => updateField('primaryContactName', value)}
                  placeholder="Kontaktperson namn *"
                />
                <InputField
                  label="Kontaktperson telefon"
                  required
                  value={form.primaryContactPhone}
                  onChange={(value) => updateField('primaryContactPhone', value)}
                  placeholder="Kontaktperson telefon *"
                />
                <InputField
                  label="Kontaktperson e-post"
                  required
                  value={form.primaryContactEmail}
                  onChange={(value) => updateField('primaryContactEmail', value)}
                  className="md:col-span-2"
                  placeholder="Kontaktperson e-post *"
                  type="email"
                />
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Steg 3</p>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">Första användare</h2>
                <p className="mt-2 text-sm leading-7 text-stone-600">
                  Personen som öppnat länken aktiveras direkt. Du kan samtidigt lägga till upp till tre extra
                  användare som får egna invite-länkar.
                </p>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <InputField
                    label="Första användare namn"
                    required
                    value={inviteUserName}
                    onChange={setInviteUserName}
                    placeholder="Första användare namn *"
                  />
                  <InputField
                    label="Första användare e-post"
                    required
                    value={payload.invite.email}
                    readOnly
                    placeholder="Första användare e-post *"
                    type="email"
                  />
                </div>

                <div className="mt-5 grid gap-4">
                  {additionalUsers.map((user, index) => (
                    <div
                      key={`additional-user-${index}`}
                      className="grid gap-4 rounded-2xl border border-stone-200 bg-white px-4 py-4 md:grid-cols-[1fr_1fr_auto]"
                    >
                      <InputField
                        label={`Extra användare ${index + 1} namn`}
                        value={user.name}
                        onChange={(value) => updateAdditionalUser(index, 'name', value)}
                        placeholder="Namn"
                      />
                      <InputField
                        label={`Extra användare ${index + 1} e-post`}
                        value={user.email}
                        onChange={(value) => updateAdditionalUser(index, 'email', value)}
                        placeholder="namn@exempel.se"
                        type="email"
                      />
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeAdditionalUser(index)}
                          className="w-full rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-700 transition hover:bg-stone-100"
                        >
                          Ta bort
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={addAdditionalUser}
                    disabled={additionalUsers.length >= MAX_ADDITIONAL_USERS}
                    className="rounded-full border border-stone-300 px-4 py-2.5 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Lägg till användare
                  </button>
                  <p className="text-xs text-stone-500">
                    {additionalUsers.length >= MAX_ADDITIONAL_USERS
                      ? 'Max tre extra användare i detta steg.'
                      : 'Extra användare får egna invite-länkar efter att BRF-anslutningen skickats in.'}
                  </p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Valfritt</p>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <InputField
                    label="Allmän BRF-e-post"
                    value={form.generalEmail}
                    onChange={(value) => updateField('generalEmail', value)}
                    placeholder="Allmän BRF-e-post"
                    type="email"
                  />
                  <InputField
                    label="BRF-telefon"
                    value={form.brfPhone}
                    onChange={(value) => updateField('brfPhone', value)}
                    placeholder="BRF-telefon"
                  />
                  <InputField
                    label="Fakturareferens"
                    value={form.invoiceReference}
                    onChange={(value) => updateField('invoiceReference', value)}
                    placeholder="Fakturareferens"
                  />
                  <InputField
                    label="Antal lägenheter"
                    value={form.unitCount}
                    onChange={(value) => updateField('unitCount', value)}
                    inputMode="numeric"
                    placeholder="Antal lägenheter"
                  />
                  <InputField
                    label="Teknisk förvaltare eller extern kontakt"
                    value={form.technicalContact}
                    onChange={(value) => updateField('technicalContact', value)}
                    placeholder="Teknisk förvaltare eller extern kontakt"
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
