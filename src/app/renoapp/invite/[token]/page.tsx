'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import {
  RENOAPP_BRF_TERMS_DOWNLOAD_URL,
  RENOAPP_BRF_TERMS_SUMMARY,
  RENOAPP_BRF_TERMS_TITLE,
  RENOAPP_BRF_TERMS_VERSION,
} from '@/lib/renoapp/brfTerms'

type InvitePreview = {
  mode: 'brf_onboarding' | 'member_invite'
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
    isPublicApplyEnabled: boolean
    isPublicApplyListed: boolean
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
  publicApplyMode: 'listed' | 'direct_link'
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
  publicApplyMode: 'direct_link',
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
    publicApplyMode: payload.brf.isPublicApplyListed ? 'listed' : 'direct_link',
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

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">{label}</p>
      <p className="mt-1 text-sm text-stone-700">{value}</p>
    </div>
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
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
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
          setTermsAccepted(false)
          setPassword('')
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

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
      window.location.reload()
    } finally {
      setSigningOut(false)
    }
  }

  const handleAccept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (payload?.mode === 'brf_onboarding' && !termsAccepted) {
      setActionError(`Du måste godkänna villkoren (version ${RENOAPP_BRF_TERMS_VERSION}) för att fortsätta.`)
      return
    }

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
          termsAccepted,
          termsVersion: RENOAPP_BRF_TERMS_VERSION,
          publicApplyMode: form.publicApplyMode,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        accepted?: boolean
        createdUser?: boolean
        signInEmail?: string
        error?: string
        mode?: InvitePreview['mode']
      }

      if (!response.ok) {
        const message =
          result.error ??
          (payload?.mode === 'member_invite'
            ? 'Kunde inte acceptera inbjudan.'
            : 'Kunde inte slutföra BRF-anslutningen.')
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
        submitError instanceof Error
          ? submitError.message
          : payload?.mode === 'member_invite'
            ? 'Kunde inte acceptera inbjudan.'
            : 'Kunde inte slutföra BRF-anslutningen.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-6xl px-6 py-14 md:px-10">Laddar inbjudan...</main>
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
  const isOnboardingInvite = payload.mode === 'brf_onboarding'

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
      <div className="grid gap-5">
        <section className="rounded-[28px] border border-stone-200/80 bg-white/94 p-5 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp</p>
            {payload.currentUser.email ? (
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {signingOut ? 'Loggar ut...' : 'Logga ut'}
              </button>
            ) : null}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-stone-900 md:text-3xl">
            {isOnboardingInvite ? 'Slutför BRF-anslutning' : 'Välkommen till styrelseportalen'}
          </h1>
          <p className="mt-2 text-sm leading-7 text-stone-600">
            {isOnboardingInvite
              ? `Slutför uppgifterna för ${payload.brf.name} och lägg till de första användarna innan BRF:en börjar arbeta i RenoApp.`
              : `Du har blivit inbjuden till styrelseportalen för ${payload.brf.name}. Acceptera inbjudan för att få tillgång till BRF:ens arbetsyta i RenoApp.`}
          </p>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard label="BRF" value={payload.brf.name} />
            <SummaryCard label="E-post" value={payload.invite.email} />
            <SummaryCard label="Roll" value="Styrelsemedlem" />
            <SummaryCard label="Giltig till" value={formatDateTime(payload.invite.expiresAt)} />
          </div>
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.96))] p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)] md:p-8">
          {payload.state === 'accepted' ? (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-800">
              <p className="font-semibold">Inviten har redan accepterats.</p>
              <p className="mt-1">
                {isOnboardingInvite
                  ? 'BRF-anslutningen är redan slutförd. Fortsätt till arbetsytan för att börja använda RenoApp.'
                  : 'Kontot är redan kopplat till BRF:en. Fortsätt till RenoApp för att börja arbeta.'}
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
              Den här inviten är inte längre aktiv. Kontakta RenoApp-teamet om du behöver en ny länk.
            </div>
          ) : requiresExistingLogin ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
              <div className="mt-4">
                <button
                  type="button"
                  onClick={handleSignOut}
                  disabled={signingOut}
                  className="rounded-full border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {signingOut ? 'Loggar ut...' : 'Logga ut'}
                </button>
              </div>
              Du är inloggad med {payload.currentUser.email}. Logga ut och öppna inviten igen med {payload.invite.email}.
            </div>
          ) : (
            <form onSubmit={handleAccept} className="grid gap-6">
              <div>
                <h2 className="mt-2 text-2xl font-semibold text-stone-900">
                  {needsPassword ? 'Aktivera kontot' : isOnboardingInvite ? 'Kontot är klart' : 'Bekräfta inbjudan'}
                </h2>
                {needsPassword ? (
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <InputField
                      label="Namn"
                      required
                      value={inviteUserName}
                      onChange={setInviteUserName}
                      placeholder="Ditt namn"
                    />
                    <InputField
                      label="Lösenord"
                      required
                      value={password}
                      onChange={setPassword}
                      placeholder="Välj lösenord"
                      type="password"
                    />
                    <p className="text-xs text-stone-500 md:col-span-2">Minst 8 tecken.</p>
                  </div>
                ) : (
                  <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700">
                    {isOnboardingInvite
                      ? 'Du är inloggad med rätt e-postadress. Fyll nu i BRF-uppgifterna nedan för att slutföra anslutningen.'
                      : 'Du är inloggad med rätt e-postadress och kan nu acceptera inbjudan.'}
                  </div>
                )}
              </div>

              {isOnboardingInvite ? (
                <>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Steg 2</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Obligatoriska BRF-uppgifter</h2>
                    <p className="mt-2 text-sm leading-7 text-stone-600">
                      De här uppgifterna behövs innan BRF:en kan börja arbeta i RenoApp.
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <InputField label="BRF-namn" required value={form.name} onChange={(value) => updateField('name', value)} />
                    <InputField
                      label="Organisationsnummer"
                      required
                      value={form.orgNumber}
                      onChange={(value) => updateField('orgNumber', value)}
                    />
                    <InputField
                      label="Fastighetsbeteckning"
                      required
                      value={form.propertyDesignation}
                      onChange={(value) => updateField('propertyDesignation', value)}
                      className="md:col-span-2"
                    />
                    <InputField
                      label="Gatuadress"
                      required
                      value={form.address}
                      onChange={(value) => updateField('address', value)}
                      className="md:col-span-2"
                    />
                    <InputField
                      label="Adressrad 2"
                      value={form.addressLine2}
                      onChange={(value) => updateField('addressLine2', value)}
                      className="md:col-span-2"
                    />
                    <InputField
                      label="Postnummer"
                      required
                      value={form.postalCode}
                      onChange={(value) => updateField('postalCode', value)}
                      inputMode="numeric"
                    />
                    <InputField label="Ort" required value={form.city} onChange={(value) => updateField('city', value)} />
                    <InputField
                      label="Fakturaadress"
                      required
                      value={form.invoiceAddress}
                      onChange={(value) => updateField('invoiceAddress', value)}
                      className="md:col-span-2"
                    />
                    <InputField
                      label="Faktura-e-post"
                      required
                      value={form.invoiceEmail}
                      onChange={(value) => updateField('invoiceEmail', value)}
                      type="email"
                    />
                    <InputField
                      label="Kontaktperson namn"
                      required
                      value={form.primaryContactName}
                      onChange={(value) => updateField('primaryContactName', value)}
                    />
                    <InputField
                      label="Kontaktperson telefon"
                      required
                      value={form.primaryContactPhone}
                      onChange={(value) => updateField('primaryContactPhone', value)}
                    />
                    <InputField
                      label="Kontaktperson e-post"
                      required
                      value={form.primaryContactEmail}
                      onChange={(value) => updateField('primaryContactEmail', value)}
                      className="md:col-span-2"
                      type="email"
                    />
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Steg 3</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Första användare</h2>
                    <p className="mt-2 text-sm leading-7 text-stone-600">
                      Personen som öppnat länken aktiveras direkt. Du kan samtidigt lägga till upp till tre extra användare som får egna invite-länkar.
                    </p>

                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      <div className="md:col-span-2">
                        <FieldLabel label="Hur boende får tillgång till ansökan" required />
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                            <div className="flex items-start gap-3">
                              <input
                                checked={form.publicApplyMode === 'listed'}
                                onChange={() => updateField('publicApplyMode', 'listed')}
                                type="radio"
                                name="publicApplyMode"
                                className="mt-1"
                              />
                              <div>
                                <p className="font-semibold text-stone-900">Synlig i öppen BRF-lista</p>
                                <p className="mt-1 leading-6 text-stone-600">
                                  Boende kan hitta BRF:en direkt på RenoApps ansökningssida utan att först få en separat länk.
                                </p>
                              </div>
                            </div>
                          </label>
                          <label className="rounded-2xl border border-stone-200 bg-white px-4 py-4 text-sm text-stone-700">
                            <div className="flex items-start gap-3">
                              <input
                                checked={form.publicApplyMode === 'direct_link'}
                                onChange={() => updateField('publicApplyMode', 'direct_link')}
                                type="radio"
                                name="publicApplyMode"
                                className="mt-1"
                              />
                              <div>
                                <p className="font-semibold text-stone-900">Endast via länk från styrelsen</p>
                                <p className="mt-1 leading-6 text-stone-600">
                                  BRF:en visas inte i den öppna listan. Boende behöver få rätt ansökningslänk direkt från styrelsen.
                                </p>
                              </div>
                            </div>
                          </label>
                        </div>
                      </div>
                      <InputField label="Första användare namn" required value={inviteUserName} onChange={setInviteUserName} />
                      <InputField label="Första användare e-post" required value={payload.invite.email} readOnly type="email" />
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
                          />
                          <InputField
                            label={`Extra användare ${index + 1} e-post`}
                            value={user.email}
                            onChange={(value) => updateAdditionalUser(index, 'email', value)}
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
                      <InputField label="Allmän BRF-e-post" value={form.generalEmail} onChange={(value) => updateField('generalEmail', value)} type="email" />
                      <InputField label="BRF-telefon" value={form.brfPhone} onChange={(value) => updateField('brfPhone', value)} />
                      <InputField label="Fakturareferens" value={form.invoiceReference} onChange={(value) => updateField('invoiceReference', value)} />
                      <InputField label="Antal lägenheter" value={form.unitCount} onChange={(value) => updateField('unitCount', value)} inputMode="numeric" />
                      <InputField
                        label="Teknisk förvaltare eller extern kontakt"
                        value={form.technicalContact}
                        onChange={(value) => updateField('technicalContact', value)}
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Steg 4</p>
                    <h2 className="mt-2 text-2xl font-semibold text-stone-900">Godkänn villkoren</h2>
                    <p className="mt-2 text-sm leading-7 text-stone-600">
                      BRF-anslutningen slutförs först när villkoren för RenoApp har godkänts av föreningen.
                    </p>

                    <div className="mt-4 rounded-2xl border border-stone-200 bg-white px-5 py-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-stone-900">{RENOAPP_BRF_TERMS_TITLE}</p>
                          <p className="mt-1 text-sm text-stone-600">Version {RENOAPP_BRF_TERMS_VERSION}</p>
                        </div>
                        <a
                          href={RENOAPP_BRF_TERMS_DOWNLOAD_URL}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                        >
                          Öppna villkor
                        </a>
                      </div>

                      <ul className="mt-4 space-y-2 text-sm leading-7 text-stone-700">
                        {RENOAPP_BRF_TERMS_SUMMARY.map((item) => (
                          <li key={item} className="pl-4 -indent-4">
                            • {item}
                          </li>
                        ))}
                      </ul>
                    </div>

                    <label className="mt-4 flex items-start gap-3 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm text-stone-800">
                      <input
                        checked={termsAccepted}
                        onChange={(event) => setTermsAccepted(event.target.checked)}
                        type="checkbox"
                        className="mt-1"
                      />
                      <span>
                        Jag har läst och godkänner BRF-villkoren för RenoApp (version {RENOAPP_BRF_TERMS_VERSION}).
                      </span>
                    </label>
                  </div>
                </>
              ) : null}

              {actionError ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {actionError}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="submit"
                  disabled={submitting || (isOnboardingInvite && !termsAccepted)}
                  className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting
                    ? isOnboardingInvite
                      ? 'Slutför...'
                      : 'Accepterar...'
                    : isOnboardingInvite
                      ? 'Slutför BRF-anslutning'
                      : 'Acceptera inbjudan till styrelseportalen'}
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
