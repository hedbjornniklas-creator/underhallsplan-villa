'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LockKeyhole, LoaderCircle } from 'lucide-react'

export default function EbOwnerAccessVerifier({ endpoint, expired = false }: { endpoint: string; expired?: boolean }) {
  const router = useRouter()
  const codeId = useId()
  const codeInput = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (challengeId && !busy && !expired) codeInput.current?.focus()
  }, [challengeId, busy, expired])

  async function submit(action: 'request_owner_code' | 'verify_owner_code' | 'renew_owner_link') {
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
        body: JSON.stringify({ action, payload: action === 'verify_owner_code' ? { challengeId, code } : {} }),
      })
      const payload = await response.json()
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Svaret kunde inte läsas. Försök igen.')
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Försök igen om en stund.')
      if (action === 'verify_owner_code') {
        if (payload.verified !== true) throw new Error('Koden kunde inte verifieras. Kontrollera koden eller begär en ny.')
        setCode('')
        router.refresh()
      } else {
        if (action === 'request_owner_code') {
          if (typeof payload.challengeId !== 'string' || !payload.challengeId.trim()) {
            throw new Error('Koden kunde inte begäras. Försök igen om en stund.')
          }
          setChallengeId(payload.challengeId)
          setCode('')
        }
        setMessage(typeof payload.message === 'string' ? payload.message : 'Kontrollera beställarens e-post.')
      }
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
      <p className="mt-3 text-sm leading-6 text-slate-600">
        {expired
          ? 'Den här länken har gått ut. Du kan begära en ny länk till beställarens verifierade e-postadress. Ingen ny beställning eller avgift skapas.'
          : 'Verifiera åtkomsten med en engångskod som skickas till beställarens verifierade e-postadress. Kunduppgifter och åtgärder visas först efter verifiering.'}
      </p>
      {!expired && challengeId ? <form className="mt-6 space-y-4" onSubmit={event => {
        event.preventDefault()
        void submit('verify_owner_code')
      }}>
        <label className="block text-sm font-medium text-slate-900" htmlFor={codeId}>Engångskod</label>
        <input ref={codeInput} id={codeId} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required
          disabled={busy} className="min-h-12 w-full rounded-lg border border-slate-300 px-3 text-lg tracking-widest text-slate-950" />
        <button type="submit" disabled={busy || code.length !== 6}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-emerald-800 px-4 font-semibold text-white disabled:opacity-60">
          {busy && <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />} Öppna portalen
        </button>
      </form> : null}
      <button type="button" disabled={busy} onClick={() => void submit(expired ? 'renew_owner_link' : 'request_owner_code')}
        className={`mt-5 min-h-12 w-full rounded-lg px-4 text-sm font-semibold disabled:opacity-60 ${challengeId ? 'border border-slate-300 text-slate-700' : 'bg-emerald-800 text-white'}`}>
        {busy ? 'Vänta…' : expired ? 'Skicka en ny personlig länk' : challengeId ? 'Skicka en ny kod' : 'Skicka engångskod'}
      </button>
      {message && <p role="status" className="mt-4 text-sm leading-6 text-slate-600">{message}</p>}
      {error && <p role="alert" className="mt-4 text-sm leading-6 text-red-700">{error}</p>}
      <p className="mt-6 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Dela inte engångskoden. Entreprenörer får egna begränsade länkar från portalen.</p>
    </section>
  </main>
}
