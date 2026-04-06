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
  reviewFlags: Array<{
    id: string
    code: string
    label: string
    description: string | null
    severity: 'info' | 'warning' | 'high'
    category: string
    sourceType: 'answer_rule' | 'missing_document' | 'participant'
    sourceLabel: string | null
  }>
}

type StatusAction = 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected'

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function getActionLabel(status: StatusAction) {
  if (status === 'review') return 'Sätt till review'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'approved') return 'Godkänn'
  if (status === 'conditional') return 'Villkorat godkännande'
  return 'Avslå'
}

function reviewFlagTone(severity: 'info' | 'warning' | 'high') {
  if (severity === 'high') return 'border-rose-200 bg-rose-50 text-rose-900'
  if (severity === 'warning') return 'border-amber-200 bg-amber-50 text-amber-900'
  return 'border-sky-200 bg-sky-50 text-sky-900'
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
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          {'Tillbaka till ärenden'}
        </Link>
      </div>

      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="px-10 py-8">
          <div className="flex flex-wrap items-baseline gap-x-8 gap-y-2">
            <h1 className="text-[1.05rem] font-semibold tracking-[-0.03em] text-stone-900">
              Ärende {item.caseNumber}
            </h1>
            <p className="text-[1.05rem] font-normal tracking-[-0.03em] text-stone-600">{item.title}</p>
          </div>
        </div>

        <div className="border-t border-stone-200/80 px-10 py-8">
          <div className="grid gap-6 md:grid-cols-[1fr_1fr_1.15fr]">
            <div className="grid gap-1 md:border-r md:border-stone-200/80 md:pr-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Ansökningsdatum</p>
              <p className="text-[0.95rem] leading-none text-stone-500">{formatDateTime(item.submittedAt).split(' ')[0]}</p>
            </div>
            <div className="grid gap-1 md:border-r md:border-stone-200/80 md:pr-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Uppdaterad</p>
              <p className="text-[0.95rem] leading-none text-stone-500">{formatDateTime(item.updatedAt).split(' ')[0]}</p>
            </div>
            <div className="grid gap-1">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Status</p>
              <p className="text-[0.95rem] leading-none text-stone-800">{item.status}</p>
            </div>
          </div>
        </div>

        <div className="border-t border-stone-200/80 px-10 py-8">
          <div className="grid gap-8 lg:grid-cols-[1fr_1fr_1.15fr]">
            <div className="grid gap-8 md:col-span-2 md:grid-cols-[1fr_auto_1fr] md:items-start">
              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Sökande</p>
                <div className="grid gap-2 text-[1.1rem] leading-7 text-stone-700">
                  <p className="text-stone-800">{item.applicant.name ?? 'Okänd kontakt'}</p>
                  <p>{item.applicant.email ?? '-'}</p>
                  <p>{item.applicant.phone ?? '-'}</p>
                </div>
              </div>

              <div className="hidden h-full w-px bg-stone-200/80 md:block" />

              <div className="grid gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Lägenhet</p>
                <div className="grid gap-2 text-[1.1rem] leading-7 text-stone-700">
                  <p className="text-stone-800">Internt nr: {item.unit.unitNumberInternal ?? '-'}</p>
                  <p>Skatteverket: {item.unit.unitNumberSkatteverket ?? '-'}</p>
                </div>
              </div>
            </div>

            <div className="grid content-start gap-3 border-stone-200/80 lg:border-l lg:pl-8">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500">Beskrivning</p>
              <p className="min-h-[13.75rem] max-w-xl whitespace-pre-wrap text-[1.1rem] leading-8 text-stone-700">
                {item.description ?? 'Ingen beskrivning registrerad.'}
              </p>
              {item.blockedAt ? (
                <div className="pt-2 text-sm text-amber-900">
                  <p className="font-semibold">Ärendet är spärrat</p>
                  <p className="mt-2">Tidpunkt: {formatDateTime(item.blockedAt)}</p>
                  <p className="mt-1">Orsak: {item.blockedReason ?? 'Ingen orsak angiven.'}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-6">
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
                          {document.documentTypeLabel ?? 'Ingen typ vald'} · {document.status} · {formatDateTime(document.uploadedAt)}
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
            <h3 className="text-2xl font-semibold text-stone-900">Flaggor och risker</h3>
            {item.reviewFlags.length === 0 ? (
              <p className="mt-4 text-sm text-stone-700">Inga flaggor har identifierats i ärendet just nu.</p>
            ) : (
              <ul className="mt-4 space-y-3 text-sm">
                {item.reviewFlags.map((flag) => (
                  <li key={flag.id} className={`rounded-2xl border px-4 py-4 ${reviewFlagTone(flag.severity)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold">{flag.label}</p>
                      <span className="rounded-full border border-current/20 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em]">
                        {flag.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-xs uppercase tracking-[0.12em] opacity-80">{flag.category}</p>
                    {flag.description ? <p className="mt-2 leading-6">{flag.description}</p> : null}
                    {flag.sourceLabel ? <p className="mt-2 text-xs opacity-80">Källa: {flag.sourceLabel}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </article>

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
