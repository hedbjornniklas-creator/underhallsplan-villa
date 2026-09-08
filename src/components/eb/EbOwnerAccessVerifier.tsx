'use client'

import { useRef, useState } from 'react'
import { LockKeyhole } from 'lucide-react'

/** Expired private links can only be replaced by mailing the immutable buyer. */
export default function EbOwnerAccessVerifier({ endpoint }: { endpoint: string }) {
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  async function renew() {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError('')
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch(endpoint, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'renew_owner_link', payload: {} }),
      })
      const payload = await response.json()
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Svaret kunde inte läsas. Försök igen.')
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Försök igen om en stund.')
      setMessage(typeof payload.message === 'string' ? payload.message : 'Kontrollera beställarens e-post.')
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== 'AbortError' ? cause.message : 'Anropet tog för lång tid. Försök igen.')
    } finally {
      clearTimeout(timeout)
      busyRef.current = false
      setBusy(false)
    }
  }
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
    <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <LockKeyhole aria-hidden="true" className="mb-5 h-8 w-8 text-emerald-800" />
      <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Din personliga åtgärdsportal</h1>
      <p className="mt-3 text-sm leading-6 text-slate-600">Den här länken har gått ut. Du kan begära en ny länk till beställarens registrerade e-postadress. Ingen ny beställning eller avgift skapas.</p>
      <button type="button" disabled={busy} onClick={() => void renew()}
        className="mt-5 min-h-12 w-full rounded-lg bg-emerald-800 px-4 text-sm font-semibold text-white disabled:opacity-60">
        {busy ? 'Vänta…' : 'Skicka en ny personlig länk'}
      </button>
      {message && <p role="status" className="mt-4 text-sm leading-6 text-slate-600">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error}</p>}
      <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Dela inte din personliga länk. Entreprenörer får egna begränsade länkar från portalen.</p>
    </section>
  </main>
}
