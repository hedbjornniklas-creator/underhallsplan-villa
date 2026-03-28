'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

type InvitePreview = {
  state: 'open' | 'expired' | 'revoked' | 'accepted'
  invite: {
    email: string
    role: 'board' | 'admin'
    expiresAt: string
    acceptedAt: string | null
    revokedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  currentUser: {
    email: string | null
    matchesInvite: boolean
  }
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

export default function RenoAppInvitePage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [payload, setPayload] = useState<InvitePreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

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

  const handleAccept = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSubmitting(true)
    setActionError(null)

    try {
      const response = await fetch(`/api/renoapp/invites/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, password }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        accepted?: boolean
        createdUser?: boolean
        signInEmail?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(result.error ?? 'Kunde inte acceptera inviten.')
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
      setActionError(submitError instanceof Error ? submitError.message : 'Kunde inte acceptera inviten.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-4xl px-6 py-14 md:px-10">Laddar invite...</main>
  }

  if (error || !payload) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">{error ?? 'Inviten hittades inte.'}</div>
      </main>
    )
  }

  const requiresExistingLogin = payload.currentUser.email !== null && !payload.currentUser.matchesInvite

  return (
    <main className="mx-auto min-h-screen w-full max-w-5xl px-6 py-14 md:px-10">
      <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp Invite</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">{payload.brf.name}</h1>
          <p className="mt-4 text-base leading-8 text-stone-700">
            Du har blivit inbjuden som <strong>{payload.invite.role}</strong> till RenoApp för den här BRF:en.
          </p>
          <div className="mt-8 grid gap-4">
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-900">E-post</p>
              <p className="mt-2 text-sm text-stone-700">{payload.invite.email}</p>
            </div>
            <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
              <p className="text-sm font-semibold text-stone-900">Invite-status</p>
              <p className="mt-2 text-sm text-stone-700">{payload.state}</p>
              <p className="mt-2 text-xs text-stone-500">Giltig till {formatDateTime(payload.invite.expiresAt)}</p>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(160deg,rgba(244,240,233,0.92),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <h2 className="text-2xl font-semibold text-stone-900">Aktivera styrelsekonto</h2>

          {payload.state === 'accepted' ? (
            <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Inviten har redan använts. Logga in för att fortsätta.
            </div>
          ) : payload.state === 'expired' || payload.state === 'revoked' ? (
            <div className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
              Den här inviten är inte längre aktiv.
            </div>
          ) : requiresExistingLogin ? (
            <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Du är inloggad med {payload.currentUser.email}. Logga ut och logga in med {payload.invite.email}, eller
              öppna inviten i ett privat fönster.
            </div>
          ) : (
            <form onSubmit={handleAccept} className="mt-6 grid gap-4">
              {!payload.currentUser.matchesInvite ? (
                <>
                  <input value={fullName} onChange={(event) => setFullName(event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="Fullständigt namn" />
                  <input value={password} onChange={(event) => setPassword(event.target.value)} className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900" placeholder="Välj lösenord" type="password" />
                  <p className="text-xs text-stone-500">Minst 8 tecken. Kontot skapas endast för den inbjudna e-postadressen.</p>
                </>
              ) : (
                <div className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700">
                  Du är redan inloggad med rätt e-postadress. Klicka nedan för att acceptera inviten och koppla kontot till BRF:en.
                </div>
              )}

              {actionError ? <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{actionError}</div> : null}

              <div className="flex flex-wrap gap-3">
                <button type="submit" disabled={submitting} className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60">
                  {submitting ? 'Aktiverar...' : 'Acceptera invite'}
                </button>
                <Link href="/renoapp/login" className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100">
                  Gå till login
                </Link>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  )
}
