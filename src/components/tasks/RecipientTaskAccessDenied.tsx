'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { AlertTriangle, ArrowRight, LoaderCircle, LogOut } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { recipientLoginUrl, recipientTaskPath } from '@/lib/tasks/recipientAuthPaths'
import { SigneMark } from './SigneMark'

type Props = {
  taskId: string
  signedInEmail: string | null
}

export default function RecipientTaskAccessDenied({ taskId, signedInEmail }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const switchAccount = async () => {
    setBusy(true)
    setError(null)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) {
      setError('Kunde inte logga ut. Försök igen.')
      setBusy(false)
      return
    }
    router.replace(recipientLoginUrl(recipientTaskPath(taskId)))
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh items-center bg-[#f6f4ef] px-4 py-10 text-slate-950">
      <section className="mx-auto w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5 sm:p-8">
        <SigneMark />
        <div className="mt-7 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
          <AlertTriangle size={23} aria-hidden="true" />
        </div>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.2em] text-amber-700">Mina uppdrag</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Uppdraget kan inte öppnas med detta konto</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Länken kan tillhöra ett annat mottagarkonto eller ha återkallats. Logga in med e-postadressen som meddelandet skickades till.
        </p>
        {signedInEmail ? (
          <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Inloggad som <strong>{signedInEmail}</strong>
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm font-medium text-rose-700" role="alert">{error}</p> : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void switchAccount()}
          className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? <LoaderCircle className="animate-spin" size={18} /> : <LogOut size={18} />}
          {busy ? 'Loggar ut…' : 'Logga in med ett annat konto'}
        </button>
        <Link
          href="/mina-uppdrag"
          className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Visa uppdragen för detta konto <ArrowRight size={17} />
        </Link>
      </section>
    </main>
  )
}
