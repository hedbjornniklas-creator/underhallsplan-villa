'use client'

import { useEffect, useState } from 'react'

type DashboardResponse = {
  accessibleBrfs: Array<{
    id: string
    name: string | null
    slug: string | null
    role: 'board' | 'admin'
  }>
  activeBrfId: string | null
  stats: {
    openCases: number
    needInfoCases: number
    preliminaryUnits: number
  }
}

type BrfApplyItem = {
  id: string
  name: string
  slug: string
  isPublicApplyEnabled: boolean
}

export default function RenoAppAppHomePage() {
  const [payload, setPayload] = useState<DashboardResponse | null>(null)
  const [brfItems, setBrfItems] = useState<BrfApplyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [applyLinkForm, setApplyLinkForm] = useState({ fullName: '', email: '' })
  const [sendingApplyLink, setSendingApplyLink] = useState(false)
  const [applyLinkSuccess, setApplyLinkSuccess] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadSummary = async () => {
      setLoading(true)
      setError(null)

      try {
        const [contextResponse, brfResponse] = await Promise.all([
          fetch('/api/renoapp/app/context', { cache: 'no-store' }),
          fetch('/api/renoapp/app/brf', { cache: 'no-store' }),
        ])
        const data = (await contextResponse.json().catch(() => ({}))) as DashboardResponse & { error?: string }
        const brfPayload = (await brfResponse.json().catch(() => ({}))) as {
          items?: BrfApplyItem[]
          error?: string
        }

        if (!contextResponse.ok) {
          throw new Error(data.error ?? 'Kunde inte läsa RenoApp-kontext.')
        }
        if (!brfResponse.ok) {
          throw new Error(brfPayload.error ?? 'Kunde inte läsa BRF-information.')
        }

        if (active) {
          const nextBrfs = (brfPayload.items ?? []).filter((item) => item.isPublicApplyEnabled)
          setPayload(data)
          setBrfItems(nextBrfs)
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-kontext.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadSummary()

    return () => {
      active = false
    }
  }, [])

  const handleSendApplyLink = async () => {
    setSendingApplyLink(true)
    setApplyLinkSuccess(null)
    setError(null)

    try {
      const response = await fetch('/api/renoapp/app/brf/apply-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brfId: payload?.activeBrfId ?? brfItems[0]?.id ?? '',
          ...applyLinkForm,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as {
        error?: string
        delivery?: { emailSent?: boolean; emailError?: string | null }
      }

      if (!response.ok) {
        throw new Error(result.error ?? 'Kunde inte skicka ansökningslänken.')
      }

      setApplyLinkForm((current) => ({ ...current, fullName: '', email: '' }))
      setApplyLinkSuccess('Ansökningslänken är skickad.')

      if (result.delivery?.emailError && !result.delivery.emailSent) {
        setError(result.delivery.emailError)
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Kunde inte skicka ansökningslänken.')
    } finally {
      setSendingApplyLink(false)
    }
  }

  const cards = [
    {
      title: 'Öppna ärenden',
      value: payload?.stats.openCases ?? 0,
      description: 'Submitted, review och conditional.',
    },
    {
      title: 'Väntar på komplettering',
      value: payload?.stats.needInfoCases ?? 0,
      description: 'Ärenden med status need_info.',
    },
    {
      title: 'Preliminära lägenheter',
      value: payload?.stats.preliminaryUnits ?? 0,
      description: 'BRF-lägenheter med status preliminary.',
    },
  ]

  return (
    <div className="grid gap-6">
      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {loading ? (
        <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          Laddar RenoApp-sammanfattning...
        </section>
      ) : (
        <div className="grid gap-6">
          <section className="grid gap-5 lg:grid-cols-3">
            {cards.map((card) => (
              <article
                key={card.title}
                className="rounded-[28px] border border-stone-200/80 bg-white/85 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
              >
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">
                  {card.title}
                </p>
                <p className="mt-4 text-5xl font-semibold tracking-tight text-stone-900">{card.value}</p>
                <p className="mt-3 text-sm leading-7 text-stone-700">{card.description}</p>
              </article>
            ))}
          </section>

          <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h2 className="text-2xl font-semibold text-stone-900">Skicka ansökningslänk</h2>
            <p className="mt-2 text-sm leading-7 text-stone-700">
              Skicka BRF:ens ansökningssida till en boende via mejl.
            </p>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">Namn</span>
                <input
                  value={applyLinkForm.fullName}
                  onChange={(event) => setApplyLinkForm((current) => ({ ...current, fullName: event.target.value }))}
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Namn"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-stone-800">E-post</span>
                <input
                  value={applyLinkForm.email}
                  onChange={(event) => setApplyLinkForm((current) => ({ ...current, email: event.target.value }))}
                  className="w-full rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="namn@exempel.se"
                  type="email"
                />
              </label>
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void handleSendApplyLink()}
                disabled={!(payload?.activeBrfId ?? brfItems[0]?.id) || sendingApplyLink}
                className="rounded-full border border-stone-300 bg-white px-4 py-3 text-sm font-semibold text-stone-900 transition hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sendingApplyLink ? 'Skickar...' : 'Skicka ansökningslänk'}
              </button>
              <p className="text-sm text-stone-600">
                BRF: {brfItems.find((item) => item.id === (payload?.activeBrfId ?? brfItems[0]?.id))?.name ?? '-'}
              </p>
              {applyLinkSuccess ? <p className="text-sm text-emerald-700">{applyLinkSuccess}</p> : null}
              {brfItems.length === 0 ? (
                <p className="text-sm text-stone-600">Ingen BRF med aktiv publik ansökan finns tillgänglig.</p>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
