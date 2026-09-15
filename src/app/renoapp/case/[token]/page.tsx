'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'

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
  documentOptions: Array<{
    id: string
    label: string
    description: string | null
    isRequired: boolean
  }>
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function statusLabel(value: string | null) {
  const labels: Record<string, string> = {
    draft: 'Utkast', new_application: 'Inskickad', submitted: 'Inskickad',
    review: 'Hos styrelsen för granskning', ready_for_review: 'Klar för granskning',
    need_info: 'Komplettering begärd', approved: 'Godkänd',
    conditional: 'Godkänd med villkor', approved_with_conditions: 'Godkänd med villkor',
    rejected: 'Avslag', expired: 'Länken har gått ut', revoked: 'Länken är återkallad',
    active: 'Aktiv', inactive: 'Inaktiv', uploaded: 'Uppladdat',
  }
  return value ? labels[value] ?? value : '-'
}

export default function RenoAppCaseAccessPage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const [payload, setPayload] = useState<CaseAccessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null)
  const [selectedDocumentTypeId, setSelectedDocumentTypeId] = useState('')
  const [note, setNote] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [formResetKey, setFormResetKey] = useState(0)

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
          if (data.state === 'open' && data.case.status === 'need_info' && data.brf.slug) {
            router.replace(`/renoapp/brf/${encodeURIComponent(data.brf.slug)}/apply?draft=${encodeURIComponent(token)}`)
          }
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
  }, [token, reloadKey, router])

  const canUpload = payload?.state === 'open' && payload.case.status === 'draft' && payload.access.allowedActions.includes('upload_documents')

  const handleUpload = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!token) {
      setUploadError('Länken är ogiltig.')
      return
    }

    if (!file) {
      setUploadError('Välj en fil att ladda upp.')
      return
    }

    setUploading(true)
    setUploadError(null)
    setUploadSuccess(null)

    try {
      const formData = new FormData()
      formData.append('file', file)
      if (selectedDocumentTypeId) formData.append('document_type_id', selectedDocumentTypeId)
      if (note.trim()) formData.append('note', note.trim())

      const response = await fetch(`/api/renoapp/case-access/${token}/documents`, {
        method: 'POST',
        body: formData,
      })
      const responsePayload = (await response.json().catch(() => ({}))) as { error?: string }

      if (!response.ok) {
        throw new Error(responsePayload.error ?? 'Kunde inte ladda upp dokumentet.')
      }

      setUploadSuccess('Dokumentet laddades upp.')
      setSelectedDocumentTypeId('')
      setNote('')
      setFile(null)
      setFormResetKey((current) => current + 1)
      setReloadKey((current) => current + 1)
    } catch (submitError) {
      setUploadError(submitError instanceof Error ? submitError.message : 'Kunde inte ladda upp dokumentet.')
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return <main className="reno-case-access">Laddar ärende...</main>
  }

  if (error || !payload) {
    return (
      <main className="reno-case-access">
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-8 text-rose-900">
          {error ?? 'Kunde inte läsa ärendet.'}
        </div>
      </main>
    )
  }

  return (
    <main className="reno-case-access bg-white">
      <section className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--reno-muted)]">Din renoveringsansökan</p>
        <h1 className="mt-2 font-bold tabular-nums text-[var(--reno-ink)]">{payload.case.caseNumber}</h1>
        <p className="mt-2 text-base leading-6 text-[var(--reno-muted)]">{payload.case.title}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="min-w-0 border-t border-[var(--reno-line)] py-4">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">Status</p>
            <p className="mt-2 text-sm text-[var(--reno-muted)]">{statusLabel(payload.state === 'open' ? payload.case.status : payload.state)}</p>
          </div>
          <div className="min-w-0 border-t border-[var(--reno-line)] py-4">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">Din ärendelänk</p>
            <p className="mt-2 text-sm text-[var(--reno-muted)]">{payload.state !== 'open'
              ? statusLabel(payload.state)
              : canUpload ? 'Visa ansökan och ladda upp dokument' : 'Visa ansökan'}</p>
            <p className="mt-2 text-xs text-[var(--reno-muted)]">Giltig till {formatDateTime(payload.access.expiresAt)}</p>
          </div>
          <div className="min-w-0 border-t border-[var(--reno-line)] py-4">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">BRF</p>
            <p className="mt-2 text-sm text-[var(--reno-muted)]">{payload.brf.name}</p>
          </div>
          <div className="min-w-0 border-t border-[var(--reno-line)] py-4">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">Åtgärd</p>
            <p className="mt-2 text-sm text-[var(--reno-muted)]">{payload.case.actionType?.label ?? 'Ej angiven'}</p>
          </div>
        </div>

        <div className="reno-case-access-section mt-4">
          <p className="text-sm font-semibold text-[var(--reno-ink)]">Beskrivning</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-[var(--reno-muted)]">
            {payload.case.description ?? 'Ingen beskrivning registrerad.'}
          </p>
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <div className="reno-case-access-section">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">Kontakt</p>
            <p className="mt-3 text-sm leading-7 text-[var(--reno-muted)]">
              {payload.contact.name ?? 'Okänd kontakt'}
              <br />
              {payload.contact.email ?? '-'}
              <br />
              {payload.contact.phone ?? '-'}
            </p>
          </div>
          <div className="reno-case-access-section">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">Lägenhet</p>
            <p className="mt-3 text-sm leading-7 text-[var(--reno-muted)]">
              Internt nr: {payload.unit.unitNumberInternal ?? '-'}
              <br />
              Skatteverket: {payload.unit.unitNumberSkatteverket ?? '-'}
              <br />
              Status: {statusLabel(payload.unit.status)}
            </p>
          </div>
        </div>

        <div className="reno-case-access-section mt-4">
          <p className="text-sm font-semibold text-[var(--reno-ink)]">Dokument</p>
          {payload.documents.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--reno-muted)]">Inga dokument är uppladdade ännu.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-[var(--reno-muted)]">
              {payload.documents.map((document) => (
                <li key={document.id} className="border-b border-[var(--reno-line)] py-3 last:border-b-0">
                  <p className="font-medium text-[var(--reno-ink)]">{document.fileName ?? 'Dokument'}</p>
                  <p className="text-xs text-[var(--reno-muted)]">
                    {statusLabel(document.status)} · {formatDateTime(document.uploadedAt)}
                  </p>
                  {document.note ? <p className="mt-1">{document.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="reno-case-access-section mt-4">
          <p className="text-sm font-semibold text-[var(--reno-ink)]">Dokumentkrav</p>
          {payload.documentOptions.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--reno-muted)]">Inga dokumentkrav är registrerade för den valda åtgärden.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-[var(--reno-muted)]">
              {payload.documentOptions.map((option) => (
                <li key={option.id} className="border-b border-[var(--reno-line)] py-3 last:border-b-0">
                  <p className="font-medium text-[var(--reno-ink)]">
                    {option.label} {option.isRequired ? '(obligatorisk)' : '(valfri)'}
                  </p>
                  {option.description ? <p className="mt-1">{option.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canUpload ? (
          <form onSubmit={handleUpload} className="reno-case-access-section mt-4">
            <p className="text-sm font-semibold text-[var(--reno-ink)]">Ladda upp dokument</p>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm text-[var(--reno-muted)]">
                <span>Dokumenttyp</span>
                <select
                  value={selectedDocumentTypeId}
                  onChange={(event) => setSelectedDocumentTypeId(event.target.value)}
                  className="reno-field border bg-white px-3 py-3 text-[var(--reno-ink)]"
                >
                  <option value="">Välj dokumenttyp</option>
                  {payload.documentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-[var(--reno-muted)]">
                <span>Fil</span>
                <input
                  key={formResetKey}
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="reno-field border bg-white px-3 py-3 text-[var(--reno-ink)]"
                />
              </label>

              <label className="grid gap-2 text-sm text-[var(--reno-muted)]">
                <span>Kommentar</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className="reno-field border bg-white px-3 py-3 text-[var(--reno-ink)]"
                  placeholder="Valfri kommentar till dokumentet"
                />
              </label>
            </div>

            {uploadError ? <p className="mt-4 text-sm text-rose-700">{uploadError}</p> : null}
            {uploadSuccess ? <p className="mt-4 text-sm text-emerald-700">{uploadSuccess}</p> : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="submit"
                disabled={uploading}
                className="reno-button"
              >
                {uploading ? 'Laddar upp...' : 'Ladda upp dokument'}
              </button>
              <p className="self-center text-xs text-[var(--reno-muted)]">
                Tillåtna filer: PDF, JPG, PNG, WEBP, HEIC, HEIF. Max 15 MB.
              </p>
            </div>
          </form>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/renoapp" className="reno-button-secondary">
            Till RenoApp-start
          </Link>
          <Link href={`/renoapp/brf/${payload.brf.slug}/apply`} className="reno-button">
            Ny ansökan
          </Link>
        </div>
      </section>
    </main>
  )
}
