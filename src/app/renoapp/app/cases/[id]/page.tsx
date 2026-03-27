'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

type CaseDetail = {
  id: string
  caseNumber: string
  title: string
  description: string | null
  status: string
  riskLevel: string | null
  submittedAt: string
  updatedAt: string
  blockedAt: string | null
  blockedReason: string | null
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    id: string | null
    key: string | null
    label: string | null
  }
  applicant: {
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
  checks: {
    affectsStructure: boolean
    affectsPlumbing: boolean
    affectsVentilation: boolean
    affectsElectrical: boolean
    affectsWetRoom: boolean
    affectsSurfaceOnly: boolean
  } | null
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
  documents: Array<{
    id: string
    documentTypeId: string | null
    documentTypeLabel: string | null
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  requirements: Array<{
    id: string
    documentTypeId: string
    documentKey: string
    documentLabel: string
    documentDescription: string | null
    isRequired: boolean
    note: string | null
    sortOrder: number
  }>
  decisions: Array<{
    id: string
    decision: string
    conditions: string | null
    reason: string | null
    decidedAt: string
  }>
  accessLinks: Array<{
    id: string
    email: string
    scope: string
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }>
}

type StatusAction = 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected'

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function formatListLabel(value: string) {
  return value.replaceAll('_', ' ')
}

function getActionLabel(status: StatusAction) {
  if (status === 'review') return 'Sätt till review'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'approved') return 'Godkänn'
  if (status === 'conditional') return 'Villkorat godkännande'
  return 'Avslå'
}

export default function RenoAppCaseDetailPage() {
  const params = useParams<{ id: string }>()
  const caseId = typeof params?.id === 'string' ? params.id : ''
  const [item, setItem] = useState<CaseDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionSuccess, setActionSuccess] = useState<string | null>(null)
  const [selectedStatus, setSelectedStatus] = useState<StatusAction>('review')
  const [reason, setReason] = useState('')
  const [conditions, setConditions] = useState('')

  useEffect(() => {
    let active = true

    const loadCase = async () => {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/renoapp/app/cases/${caseId}`, { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as { item?: CaseDetail; error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-ärendet.')
        }

        if (active) {
          setItem(payload.item ?? null)
        }
      } catch (fetchError) {
        if (active) {
          setError(fetchError instanceof Error ? fetchError.message : 'Kunde inte läsa RenoApp-ärendet.')
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    if (caseId) {
      void loadCase()
    } else {
      setLoading(false)
      setError('Ogiltigt RenoApp-ärende.')
    }

    return () => {
      active = false
    }
  }, [caseId, reloadKey])

  const handleStatusSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!caseId) {
      setActionError('Ogiltigt RenoApp-ärende.')
      return
    }

    setSubmitting(true)
    setActionError(null)
    setActionSuccess(null)

    try {
      const response = await fetch(`/api/renoapp/app/cases/${caseId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: selectedStatus,
          reason,
          conditions,
        }),
      })
      const payload = (await response.json().catch(() => ({}))) as { item?: CaseDetail; error?: string }

      if (!response.ok) {
        throw new Error(payload.error ?? 'Kunde inte uppdatera RenoApp-ärendet.')
      }

      setItem(payload.item ?? null)
      setActionSuccess('Ärendet uppdaterades.')
      setReason('')
      setConditions('')
      setReloadKey((current) => current + 1)
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'Kunde inte uppdatera RenoApp-ärendet.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 text-sm text-stone-600 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        Laddar RenoApp-ärende...
      </div>
    )
  }

  if (error || !item) {
    return (
      <div className="grid gap-6">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          Tillbaka till ärenden
        </Link>
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          {error ?? 'Kunde inte läsa RenoApp-ärendet.'}
        </div>
      </div>
    )
  }

  const checkItems = [
    ['Påverkar stomme', item.checks?.affectsStructure ?? false],
    ['Påverkar VVS', item.checks?.affectsPlumbing ?? false],
    ['Påverkar ventilation', item.checks?.affectsVentilation ?? false],
    ['Påverkar el', item.checks?.affectsElectrical ?? false],
    ['Påverkar våtrum', item.checks?.affectsWetRoom ?? false],
    ['Endast ytskikt', item.checks?.affectsSurfaceOnly ?? false],
  ] as const

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          Tillbaka till ärenden
        </Link>
        <span className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800">
          {item.status}
        </span>
      </div>

      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">{item.brf.name ?? 'BRF'}</p>
        <h2 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">{item.caseNumber}</h2>
        <p className="mt-3 text-lg text-stone-800">{item.title}</p>
        <p className="mt-4 max-w-3xl whitespace-pre-wrap text-sm leading-8 text-stone-700">
          {item.description ?? 'Ingen beskrivning registrerad.'}
        </p>

        <div className="mt-8 grid gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Åtgärd</p>
            <p className="mt-2 text-sm text-stone-700">{item.actionType.label ?? 'Ej angiven'}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Risknivå</p>
            <p className="mt-2 text-sm text-stone-700">{item.riskLevel ?? '-'}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Inskickad</p>
            <p className="mt-2 text-sm text-stone-700">{formatDateTime(item.submittedAt)}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
            <p className="text-sm font-semibold text-stone-900">Senast uppdaterad</p>
            <p className="mt-2 text-sm text-stone-700">{formatDateTime(item.updatedAt)}</p>
          </div>
        </div>

        {item.blockedAt ? (
          <div className="mt-6 rounded-3xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
            <p className="font-semibold">Ärendet är spärrat</p>
            <p className="mt-2">Tidpunkt: {formatDateTime(item.blockedAt)}</p>
            <p className="mt-1">Orsak: {item.blockedReason ?? 'Ingen orsak angiven.'}</p>
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-6">
          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Sökande och lägenhet</h3>
            <div className="mt-6 grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
                <p className="text-sm font-semibold text-stone-900">Sökande</p>
                <p className="mt-3 text-sm leading-7 text-stone-700">
                  {item.applicant.name ?? 'Okänd kontakt'}
                  <br />
                  {item.applicant.email ?? '-'}
                  <br />
                  {item.applicant.phone ?? '-'}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-stone-50 p-5">
                <p className="text-sm font-semibold text-stone-900">Lägenhet</p>
                <p className="mt-3 text-sm leading-7 text-stone-700">
                  Internt nr: {item.unit.unitNumberInternal ?? '-'}
                  <br />
                  Skatteverket: {item.unit.unitNumberSkatteverket ?? '-'}
                  <br />
                  Status: {item.unit.status ?? '-'}
                </p>
              </div>
            </div>

            <div className="mt-6 rounded-3xl border border-stone-200 bg-white/70 p-6">
              <p className="text-sm font-semibold text-stone-900">Aktuella kontaktkopplingar</p>
              {item.currentContacts.length === 0 ? (
                <p className="mt-3 text-sm text-stone-700">Inga aktuella kontakter är kopplade till lägenheten ännu.</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm text-stone-700">
                  {item.currentContacts.map((contact) => (
                    <li key={contact.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                      <p className="font-medium text-stone-900">{contact.name ?? 'Okänd kontakt'}</p>
                      <p>{contact.email ?? '-'}</p>
                      <p className="text-xs uppercase tracking-[0.12em] text-stone-500">
                        {formatListLabel(contact.relationshipType)} · {formatListLabel(contact.verificationStatus)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </article>

          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Dokument och krav</h3>
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <div className="rounded-3xl border border-stone-200 bg-stone-50 p-6">
                <p className="text-sm font-semibold text-stone-900">Inkomna dokument</p>
                {item.documents.length === 0 ? (
                  <p className="mt-3 text-sm text-stone-700">Inga dokument har laddats upp ännu.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm text-stone-700">
                    {item.documents.map((document) => (
                      <li key={document.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="font-medium text-stone-900">{document.fileName ?? 'Dokument'}</p>
                        <p className="text-xs text-stone-500">
                          {document.documentTypeLabel ?? 'Ingen typ vald'} · {document.status} ·{' '}
                          {formatDateTime(document.uploadedAt)}
                        </p>
                        {document.note ? <p className="mt-1">{document.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="rounded-3xl border border-stone-200 bg-stone-50 p-6">
                <p className="text-sm font-semibold text-stone-900">Dokumentkrav</p>
                {item.requirements.length === 0 ? (
                  <p className="mt-3 text-sm text-stone-700">Inga dokumentkrav är konfigurerade för åtgärden ännu.</p>
                ) : (
                  <ul className="mt-3 space-y-2 text-sm text-stone-700">
                    {item.requirements.map((requirement) => (
                      <li key={requirement.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                        <p className="font-medium text-stone-900">
                          {requirement.documentLabel} {requirement.isRequired ? '(obligatorisk)' : '(valfri)'}
                        </p>
                        {requirement.documentDescription ? <p className="mt-1">{requirement.documentDescription}</p> : null}
                        {requirement.note ? <p className="mt-1 text-xs text-stone-500">{requirement.note}</p> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </article>
        </div>

        <div className="grid gap-6">
          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Styrelseåtgärd</h3>
            <form onSubmit={handleStatusSubmit} className="mt-6 grid gap-4">
              <label className="grid gap-2 text-sm text-stone-700">
                <span>Ny status</span>
                <select
                  value={selectedStatus}
                  onChange={(event) => setSelectedStatus(event.target.value as StatusAction)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                >
                  <option value="review">Review</option>
                  <option value="need_info">Need info</option>
                  <option value="approved">Approved</option>
                  <option value="conditional">Conditional</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>

              <label className="grid gap-2 text-sm text-stone-700">
                <span>Motivering</span>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Obligatoriskt vid avslag, valfritt i övriga fall."
                />
              </label>

              <label className="grid gap-2 text-sm text-stone-700">
                <span>Villkor</span>
                <textarea
                  value={conditions}
                  onChange={(event) => setConditions(event.target.value)}
                  rows={4}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                  placeholder="Obligatoriskt vid villkorat beslut."
                />
              </label>

              {actionError ? <p className="text-sm text-rose-700">{actionError}</p> : null}
              {actionSuccess ? <p className="text-sm text-emerald-700">{actionSuccess}</p> : null}

              <button
                type="submit"
                disabled={submitting}
                className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? 'Sparar...' : getActionLabel(selectedStatus)}
              </button>
            </form>
          </article>

          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Tekniska checks</h3>
            <ul className="mt-6 space-y-2 text-sm text-stone-700">
              {checkItems.map(([label, value]) => (
                <li key={label} className="flex items-center justify-between rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                  <span>{label}</span>
                  <span className="font-semibold text-stone-900">{value ? 'Ja' : 'Nej'}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Access links</h3>
            {item.accessLinks.length === 0 ? (
              <p className="mt-4 text-sm text-stone-700">Inga access links finns ännu.</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm text-stone-700">
                {item.accessLinks.map((link) => (
                  <li key={link.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <p className="font-medium text-stone-900">{link.email}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] text-stone-500">{link.scope}</p>
                    <p className="mt-2 text-xs text-stone-500">Giltig till {formatDateTime(link.expiresAt)}</p>
                    <p className="text-xs text-stone-500">Senast använd {formatDateTime(link.lastUsedAt)}</p>
                    {link.revokedAt ? <p className="text-xs text-rose-700">Återkallad {formatDateTime(link.revokedAt)}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Beslutshistorik</h3>
            {item.decisions.length === 0 ? (
              <p className="mt-4 text-sm text-stone-700">Inga beslut har registrerats ännu.</p>
            ) : (
              <ul className="mt-4 space-y-2 text-sm text-stone-700">
                {item.decisions.map((decision) => (
                  <li key={decision.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                    <p className="font-medium text-stone-900">{decision.decision}</p>
                    <p className="mt-1 text-xs text-stone-500">{formatDateTime(decision.decidedAt)}</p>
                    {decision.reason ? <p className="mt-2">{decision.reason}</p> : null}
                    {decision.conditions ? <p className="mt-2 text-xs text-stone-500">Villkor: {decision.conditions}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </article>
        </div>
      </section>
    </div>
  )
}
