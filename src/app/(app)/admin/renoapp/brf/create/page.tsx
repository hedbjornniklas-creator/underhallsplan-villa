'use client'

import Link from 'next/link'
import { useState } from 'react'
import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'

type CreateResult = {
  brf: {
    id: string
    name: string
    slug: string
  }
  invite: {
    email: string
    role: 'board'
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  }
}

export default function RenoAppAdminCreateBrfPage() {
  const { isAdmin, loading } = useProfile()
  const [name, setName] = useState('')
  const [orgNumber, setOrgNumber] = useState('')
  const [address, setAddress] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<CreateResult | null>(null)

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)
    setResult(null)

    try {
      const response = await fetch('/api/renoapp/admin/brf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          orgNumber,
          address,
          email,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as CreateResult & { error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte skapa BRF.')
      }

      setResult(payload)
      setName('')
      setOrgNumber('')
      setAddress('')
      setEmail('')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Kunde inte skapa BRF.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Protected>
      <main className="mx-auto w-full max-w-5xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp Admin</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Skapa BRF och skicka länk</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            Använd den här sidan för att manuellt skapa en BRF och skicka en aktiveringslänk till första
            styrelsemedlemmen.
          </p>
        </section>

        {loading ? (
          <div className="mt-6 rounded-3xl border border-stone-200 bg-white/85 p-6 text-sm text-stone-600">
            Laddar behörighet...
          </div>
        ) : !isAdmin ? (
          <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            Adminbehörighet krävs.
          </div>
        ) : (
          <section className="mt-6 rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <form className="grid gap-4" onSubmit={handleSubmit}>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="BRF-namn"
              />
              <input
                value={orgNumber}
                onChange={(event) => setOrgNumber(event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Organisationsnummer"
              />
              <input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="Adress"
              />
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder="E-postadress för styrelsemedlem"
                type="email"
              />

              {error ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                  {error}
                </div>
              ) : null}
              {result ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  <p className="font-semibold">{result.brf.name} skapades.</p>
                  <p className="mt-1">Slug: {result.brf.slug}</p>
                  <p className="mt-1 break-all">Länk: {result.invite.inviteUrl}</p>
                  <p className="mt-1">
                    {result.invite.emailSent ? 'Det kombinerade invite-mejlet skickades.' : 'Invite skapad utan mejlutskick.'}
                  </p>
                  {result.invite.emailError ? <p className="mt-1 text-amber-900">{result.invite.emailError}</p> : null}
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Skapar...' : 'Skapa BRF'}
                </button>
                <Link
                  href="/admin/renoapp"
                  className="rounded-full border border-stone-300 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  Till adminstart
                </Link>
              </div>
            </form>
          </section>
        )}
      </main>
    </Protected>
  )
}
