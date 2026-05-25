'use client'

import { useMemo, useState } from 'react'

type ReportShareButtonProps = {
  shareEndpoint: string
  shareUrl: string
}

function isValidEmail(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value.trim())
}

export default function ReportShareButton({ shareEndpoint, shareUrl }: ReportShareButtonProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const normalizedEmail = email.trim().toLowerCase()
  const canSend = isValidEmail(normalizedEmail) && !sending
  const absoluteShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return shareUrl
    if (shareUrl.startsWith('http://') || shareUrl.startsWith('https://')) return shareUrl
    return `${window.location.origin}${shareUrl.startsWith('/') ? shareUrl : `/${shareUrl}`}`
  }, [shareUrl])

  const handleClose = () => {
    if (sending) return
    setOpen(false)
    setError(null)
    setSuccess(null)
  }

  const handleSend = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch(shareEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalizedEmail }),
      })
      const payload = (await response.json().catch(() => null)) as { error?: string } | null

      if (!response.ok) {
        throw new Error(payload?.error ?? 'Kunde inte skicka länken.')
      }

      setSuccess(`Länken skickades till ${normalizedEmail}.`)
      setEmail('')
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skicka länken.')
    } finally {
      setSending(false)
    }
  }

  const handleCopy = async () => {
    if (!navigator.clipboard) return
    setCopying(true)
    setError(null)
    try {
      await navigator.clipboard.writeText(absoluteShareUrl)
      setSuccess('Länken kopierades.')
    } catch {
      setError('Kunde inte kopiera länken.')
    } finally {
      setCopying(false)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
      >
        Dela utlåtande
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Dela utlåtande</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Skicka en länk till detta utlåtande.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={sending}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Stäng
              </button>
            </div>

            <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-slate-700">E-postadress</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="namn@epost.se"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
            </label>

            {error ? (
              <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </p>
            ) : null}

            {success ? (
              <p className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {success}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!canSend}
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-100 disabled:text-indigo-700"
              >
                {sending ? 'Skickar...' : 'Skicka länk'}
              </button>
              <button
                type="button"
                onClick={() => void handleCopy()}
                disabled={copying}
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {copying ? 'Kopierar...' : 'Kopiera länk'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
