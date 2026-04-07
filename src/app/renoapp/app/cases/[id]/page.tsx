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
  underlag: Array<{
    id: string
    category: 'document' | 'participant'
    label: string
    checked: boolean
    documentId: string | null
    summary: string[]
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
  messages: Array<{
    id: string
    type: 'request_for_info' | 'applicant_reply' | 'document_uploaded' | 'decision' | 'status_change'
    authorRole: 'board' | 'applicant' | 'system'
    authorName: string | null
    message: string | null
    createdAt: string
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

function formatStatusLabel(status: string) {
  if (status === 'draft') return 'Utkast'
  if (status === 'submitted') return 'Inskickad'
  if (status === 'need_info') return 'Komplettering krävs'
  if (status === 'review') return 'Under granskning'
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional') return 'Villkorad'
  if (status === 'rejected') return 'Avslagen'
  return status
}

function getMessageTitle(type: CaseDetail['messages'][number]['type']) {
  if (type === 'request_for_info') return 'Styrelsen begär komplettering'
  if (type === 'applicant_reply') return 'Medlemmen skickade komplettering'
  if (type === 'document_uploaded') return 'Dokument uppladdat'
  if (type === 'decision') return 'Beslut registrerat'
  return 'Status uppdaterad'
}

function getMessageAuthorLabel(role: CaseDetail['messages'][number]['authorRole']) {
  if (role === 'board') return 'Styrelsen'
  if (role === 'applicant') return 'Sökande'
  return 'Systemet'
}

function getBoardActionSubmitLabel(status: StatusAction) {
  if (status === 'review') return 'Sätt under granskning'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'approved') return 'Godkänn'
  if (status === 'conditional') return 'Godkänn med villkor'
  return 'Registrera avslag'
}

function getBoardStatusLabel(status: string) {
  if (status === 'draft') return 'Utkast'
  if (status === 'submitted') return 'Under granskning'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'review') return 'Under granskning'
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional') return 'Godkänd med villkor'
  if (status === 'rejected') return 'Avslag'
  return status
}

function getBoardStatusOptionLabel(status: StatusAction) {
  if (status === 'review') return 'Under granskning'
  if (status === 'need_info') return 'Begär komplettering'
  if (status === 'approved') return 'Godkänd'
  if (status === 'conditional') return 'Godkänd med villkor'
  return 'Avslag'
}

function isChecklistSummaryChecked(line: string) {
  const normalized = line.trim().toLowerCase()
  return normalized.endsWith('finns')
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
  const [selectedStatus, setSelectedStatus] = useState<StatusAction>('need_info')
  const [reason, setReason] = useState('')
  const [conditions, setConditions] = useState('')
  const [historyExpanded, setHistoryExpanded] = useState(false)

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
  const isDraftCase = item.status === 'draft'
  const documentUnderlag = item.underlag.filter((row) => row.category === 'document')
  const participantUnderlag = item.underlag.filter((row) => row.category === 'participant')

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/renoapp/app/cases" className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline">
          {'Tillbaka till ärenden'}
        </Link>
      </div>

      <section className="rounded-[32px] border border-stone-200/80 bg-white/85 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="px-8 py-3">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <h1 className="text-sm font-semibold text-stone-900">
              Ärende {item.caseNumber}
            </h1>
            <p className="text-sm text-stone-600">{item.title}</p>
          </div>
        </div>

        <div className="border-t border-stone-200/80 px-8 py-3">
          <div className="grid gap-y-3 md:grid-cols-3">
            <div className="grid gap-0.5 md:border-r md:border-stone-200/80 md:pr-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{'Ans\u00f6kningsdatum'}</p>
              <p className="text-sm text-stone-500">{formatDateTime(item.submittedAt).split(' ')[0]}</p>
            </div>
            <div className="grid gap-0.5 md:border-r md:border-stone-200/80 md:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Uppdaterad</p>
              <p className="text-sm text-stone-500">{formatDateTime(item.updatedAt).split(' ')[0]}</p>
            </div>
            <div className="grid gap-0.5 md:pl-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Status</p>
              <p className="text-sm text-stone-800">{getBoardStatusLabel(item.status)}</p>
            </div>

            <div className="md:col-span-3 -mx-8 border-t border-stone-200/80" />

            <div className="grid gap-0.5 md:border-r md:border-stone-200/80 md:pr-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{'S\u00f6kande'}</p>
              <div className="grid gap-0.5 text-sm leading-5 text-stone-700">
                <p className="text-stone-800">{item.applicant.name ?? 'Ok\u00e4nd kontakt'}</p>
                <p>{item.applicant.email ?? '-'}</p>
                <p>{item.applicant.phone ?? '-'}</p>
              </div>
            </div>

            <div className="grid gap-0.5 md:border-r md:border-stone-200/80 md:px-6">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">{'L\u00e4genhet'}</p>
              <div className="grid gap-0.5 text-sm leading-5 text-stone-700">
                <p className="text-stone-800">Internt nr: {item.unit.unitNumberInternal ?? '-'}</p>
                <p>Skatteverket: {item.unit.unitNumberSkatteverket ?? '-'}</p>
              </div>
            </div>

            <div className="hidden md:block md:border-r md:border-stone-200/80" />

            <div className="md:col-span-3 -mx-8 border-t border-stone-200/80" />

            <div className="grid content-start gap-0.5 md:col-span-3">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-stone-500">Beskrivning</p>
              <p className="whitespace-pre-wrap text-sm leading-5 text-stone-700">
                {item.description ?? 'Ingen beskrivning registrerad.'}
              </p>
              {item.blockedAt ? (
                <div className="pt-1 text-sm leading-6 text-amber-900">
                  <p className="font-semibold">{'\u00c4rendet \u00e4r sp\u00e4rrat'}</p>
                  <p>Tidpunkt: {formatDateTime(item.blockedAt)}</p>
                  <p className="mt-1">Orsak: {item.blockedReason ?? 'Ingen orsak angiven.'}</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-2xl font-semibold text-stone-900">Styrelseåtgärd</h3>
          {!isDraftCase ? (
            <div className="flex flex-wrap gap-2">
              {(
                ['need_info', 'approved', 'conditional', 'rejected'] as StatusAction[]
              ).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setSelectedStatus(status)}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition ${
                    selectedStatus === status
                      ? 'border-stone-400 bg-stone-200 text-stone-900'
                      : 'border-stone-300 bg-white text-stone-700 hover:bg-stone-100'
                  }`}
                >
                  {getBoardStatusOptionLabel(status)}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {isDraftCase ? (
          <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
            Ärendet är fortfarande ett utkast. Styrelsen kan inte agera förrän medlemmen har skickat in ansökan.
          </div>
        ) : (
          <form onSubmit={handleStatusSubmit} className="mt-6 grid gap-4">
            <label className="grid gap-2 text-sm text-stone-700">
              <span>{selectedStatus === 'need_info' ? 'Begäran om komplettering' : 'Motivering'}</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                placeholder={
                  selectedStatus === 'need_info'
                    ? 'Skriv vad medlemmen behöver komplettera. Texten skickas i mejlet och sparas i ärendet.'
                    : 'Obligatoriskt vid avslag, valfritt i övriga fall.'
                }
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
              className="rounded-full border border-stone-400 bg-stone-200 px-4 py-2 text-sm font-semibold text-stone-900 transition hover:bg-stone-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? 'Sparar...' : getBoardActionSubmitLabel(selectedStatus)}
            </button>
          </form>
        )}
      </article>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="grid gap-6">
          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <h3 className="text-2xl font-semibold text-stone-900">Underlag</h3>
            {item.underlag.length === 0 ? (
              <p className="mt-4 text-sm text-stone-700">Inga underlag eller dokumentkrav finns registrerade ännu.</p>
            ) : (
              <div className="mt-6 grid gap-6">
                <div>
                  <p className="text-sm font-semibold text-stone-900">Underlag</p>
                  <ul className="mt-3 divide-y divide-stone-200 rounded-3xl border border-stone-200 bg-stone-50">
                    {documentUnderlag.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm text-stone-700">
                        <input
                          type="checkbox"
                          checked={row.checked}
                          readOnly
                          className="h-4 w-4 rounded border-stone-300 text-stone-500 accent-stone-500"
                        />
                        <span className="min-w-0 flex-1 text-stone-900">{row.label}</span>
                        {row.documentId ? (
                          <a
                            href={`/api/renoapp/app/cases/${item.id}/documents/${row.documentId}`}
                            className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline"
                          >
                            Ladda ner
                          </a>
                        ) : (
                          <span className="text-xs text-stone-400">Saknas</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>

                <div>
                  <p className="text-sm font-semibold text-stone-900">Entreprenörer och konsulter</p>
                  {participantUnderlag.length === 0 ? (
                    <p className="mt-3 text-sm text-stone-700">Inga entreprenörer eller konsulter efterfrågas i ärendet.</p>
                  ) : (
                    <div className="mt-3 grid gap-3">
                      {participantUnderlag.map((row) => (
                        <div key={row.id} className="rounded-3xl border border-stone-200 bg-stone-50 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                              <input
                                type="checkbox"
                                checked={row.checked}
                                readOnly
                                className="h-4 w-4 rounded border-stone-300 text-stone-500 accent-stone-500"
                              />
                              <p className="text-sm font-semibold text-stone-900">{row.label}</p>
                            </div>
                            {row.documentId ? (
                              <a
                                href={`/api/renoapp/app/cases/${item.id}/documents/${row.documentId}`}
                                className="text-sm font-semibold text-stone-700 underline-offset-4 hover:underline"
                              >
                                Ladda ner försäkringsbevis
                              </a>
                            ) : null}
                          </div>
                          <ul className="mt-3 grid gap-1 pl-7 text-sm text-stone-700">
                            {row.summary.map((line) => (
                              <li key={line} className="flex items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={isChecklistSummaryChecked(line)}
                                  readOnly
                                  className="h-4 w-4 rounded border-stone-300 text-stone-500 accent-stone-500"
                                />
                                <span>{line}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </article>
        </div>

        <div className="grid gap-6">
          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
            <button
              type="button"
              onClick={() => setHistoryExpanded((current) => !current)}
              className="flex w-full items-center justify-between text-left"
            >
              <h3 className="text-2xl font-semibold text-stone-900">Ärendehistorik</h3>
              <span className="text-sm font-semibold text-stone-600">{historyExpanded ? 'Visa mindre' : 'Visa mer'}</span>
            </button>
            {historyExpanded ? (
              item.messages.length === 0 ? (
                <p className="mt-4 text-sm text-stone-700">Ingen kommunikation har registrerats ännu.</p>
              ) : (
                <ul className="mt-4 space-y-2 text-sm text-stone-700">
                  {item.messages.map((message) => (
                    <li key={message.id} className="rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium text-stone-900">{getMessageTitle(message.type)}</p>
                        <p className="text-xs text-stone-500">{formatDateTime(message.createdAt)}</p>
                      </div>
                      <p className="mt-1 text-xs uppercase tracking-[0.12em] text-stone-500">
                        {getMessageAuthorLabel(message.authorRole)}
                        {message.authorName ? `: ${message.authorName}` : ''}
                      </p>
                      {message.message ? <p className="mt-2 whitespace-pre-wrap">{message.message}</p> : null}
                    </li>
                  ))}
                </ul>
              )
            ) : null}
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
