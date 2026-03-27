'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type CaseAccessResponse = {
  state: 'open' | 'expired' | 'revoked'
  access: {
    scope: string
    allowedActions: string[]
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  case: {
    id: string
    caseNumber: string
    title: string
    description: string | null
    status: string
    riskLevel: string | null
    submittedAt: string
    blockedAt: string | null
    blockedReason: string | null
    actionType: {
      key: string
      label: string
    } | null
  }
  contact: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
  }
  unit: {
    id: string | null
    unitNumberInternal: string | null
    unitNumberSkatteverket: string | null
    status: string | null
  }
  documents: Array<{
    id: string
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
}

export default function RenoAppCaseAccessPage() {
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [payload, setPayload] = useState<CaseAccessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const loadCase = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/case-access/${token}`, { cache: 'no-store' })
        const data = (await response.json().catch(() => ({}))) as CaseAccessResponse & { error?: string }

        if (!response.ok) {
          throw new Error(data.error ?? 'Kunde inte läsa ärendet.')
        }

        if (active) {
          setPayload(data)
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa ärendet.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    if (token) {
      void loadCase()
    } else {
      setLoading(false)
      setError('Länken är ogiltig.')
    }

    return () => {
      active = false
    }
  }, [token])

  if (loading) {
    return <main className="mx-auto min-h-screen max-w-4xl px-6 py-14 md:px-10">Laddar ärende...</main>
  }

  if (error || !payload) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">{error ?? 'Kunde inte läsa ärendet.'}</div>
      </main>
    )
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-6 py-14 md:px-10">
      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Magic Link</p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">{payload.case.caseNumber}</h1>
        <p className="mt-4 text-base leading-8 text-stone-700">{payload.case.title}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Status</p>
            <p className="mt-2 text-sm text-stone-700">{payload.state === 'open' ? payload.case.status : payload.state}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Tillåtet via länken</p>
            <p className="mt-2 text-sm text-stone-700">{payload.access.allowedActions.join(', ')}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">BRF</p>
            <p className="mt-2 text-sm text-stone-700">{payload.brf.name}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Åtgärd</p>
            <p className="mt-2 text-sm text-stone-700">{payload.case.actionType?.label ?? 'Ej angiven'}</p>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-stone-200 bg-white/70 p-6">
          <p className="text-sm font-semibold text-stone-900">Beskrivning</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-700">{payload.case.description ?? 'Ingen beskrivning registrerad.'}</p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="rounded-3xl border border-stone-200 bg-white/70 p-6">
            <p className="text-sm font-semibold text-stone-900">Kontakt</p>
            <p className="mt-3 text-sm leading-7 text-stone-700">
              {payload.contact.name ?? 'Okänd kontakt'}
              <br />
              {payload.contact.email ?? '-'}
              <br />
              {payload.contact.phone ?? '-'}
            </p>
          </div>
          <div className="rounded-3xl border border-stone-200 bg-white/70 p-6">
            <p className="text-sm font-semibold text-stone-900">Lägenhet</p>
            <p className="mt-3 text-sm leading-7 text-stone-700">
              Internt nr: {payload.unit.unitNumberInternal ?? '-'}
              <br />
              Skatteverket: {payload.unit.unitNumberSkatteverket ?? '-'}
              <br />
              Status: {payload.unit.status ?? '-'}
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-3xl border border-stone-200 bg-white/70 p-6">
          <p className="text-sm font-semibold text-stone-900">Dokument</p>
          {payload.documents.length === 0 ? (
            <p className="mt-3 text-sm text-stone-700">Inga dokument är uppladdade ännu.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-stone-700">
              {payload.documents.map((document) => (
                <li key={document.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                  {document.fileName ?? 'Dokument'} · {document.status}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/renoapp" className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100">
            Till RenoApp-start
          </Link>
          <Link href={`/renoapp/brf/${payload.brf.slug}/apply`} className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700">
            Ny ansökan
          </Link>
        </div>
      </section>
    </main>
  )
}
