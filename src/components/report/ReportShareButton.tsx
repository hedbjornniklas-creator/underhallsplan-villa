'use client'

import { useId, useMemo, useState } from 'react'

type ReportShareButtonProps = {
  shareEndpoint: string
  shareUrl: string
  requireCustomerLink?: boolean
}

function isValidEmail(value: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(value.trim())
}

export default function ReportShareButton({ shareEndpoint, shareUrl, requireCustomerLink = false }: ReportShareButtonProps) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [sending, setSending] = useState(false)
  const [copying, setCopying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [customerLink, setCustomerLink] = useState('')
  const titleId = useId()

  const normalizedEmail = email.trim().toLowerCase()
  const canSend = isValidEmail(normalizedEmail) && !sending && !copying && (!requireCustomerLink || Boolean(customerLink.trim()))
  const absoluteShareUrl = useMemo(() => {
    if (typeof window === 'undefined') return shareUrl
    if (shareUrl.startsWith('http://') || shareUrl.startsWith('https://')) return shareUrl
    return `${window.location.origin}${shareUrl.startsWith('/') ? shareUrl : `/${shareUrl}`}`
  }, [shareUrl])

  const handleClose = () => {
    if (sending || copying) return
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
        body: JSON.stringify({ email: normalizedEmail, ...(requireCustomerLink ? { action: 'share', publicUrl: customerLink.trim() } : {}) }),
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
      let url = absoluteShareUrl
      if (requireCustomerLink) {
        const response = await fetch(shareEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'validate-link', publicUrl: customerLink.trim() }) })
        const result = await response.json().catch(() => null) as { shareUrl?: string; error?: string } | null
        if (!response.ok || !result?.shareUrl) throw new Error(result?.error || 'Kundlänken kunde inte verifieras.')
        url = result.shareUrl
      }
      await navigator.clipboard.writeText(url)
      setSuccess('Länken kopierades.')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Kunde inte kopiera länken.')
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id={titleId} className="text-base font-semibold text-slate-900">Dela utlåtande</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Skicka en länk till detta utlåtande.
                </p>
              </div>
              <button
                type="button"
                onClick={handleClose}
                disabled={sending || copying}
                className="rounded-md px-2 py-1 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Stäng
              </button>
            </div>

            {requireCustomerLink && <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-slate-700">Kundens utlåtandelänk</span>
              <input type="url" value={customerLink} disabled={sending || copying}
                onChange={event => { setCustomerLink(event.target.value); setError(null); setSuccess(null) }}
                placeholder="https://hushub.se/rapport/…"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm" />
              <span className="block text-xs text-slate-600">Den ursprungliga kundlänken behövs för denna rapportversion.</span>
            </label>}
            <label className="mt-4 block space-y-1">
              <span className="text-xs font-medium text-slate-700">E-postadress</span>
              <input
                type="email"
                value={email}
                disabled={sending || copying}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="namn@epost.se"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 sm:text-sm"
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
                disabled={copying || sending || (requireCustomerLink && !customerLink.trim())}
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
