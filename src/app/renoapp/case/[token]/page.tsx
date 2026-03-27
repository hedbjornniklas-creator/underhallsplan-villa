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

export default function RenoAppCaseAccessPage() {
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
  }, [token, reloadKey])

  const canUpload = payload?.state === 'open' && payload.access.allowedActions.includes('upload_documents')

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
    return <main className="mx-auto min-h-screen max-w-4xl px-6 py-14 md:px-10">Laddar ärende...</main>
  }

  if (error || !payload) {
    return (
      <main className="mx-auto min-h-screen max-w-4xl px-6 py-14 md:px-10">
        <div className="rounded-[32px] border border-rose-200 bg-rose-50 p-8 text-rose-900">
          {error ?? 'Kunde inte läsa ärendet.'}
        </div>
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
            <p className="mt-2 text-xs text-stone-500">Giltig till {formatDateTime(payload.access.expiresAt)}</p>
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
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-stone-700">
            {payload.case.description ?? 'Ingen beskrivning registrerad.'}
          </p>
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
                  <p className="font-medium text-stone-900">{document.fileName ?? 'Dokument'}</p>
                  <p className="text-xs text-stone-500">
                    {document.status} · {formatDateTime(document.uploadedAt)}
                  </p>
                  {document.note ? <p className="mt-1">{document.note}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-8 rounded-3xl border border-stone-200 bg-white/70 p-6">
          <p className="text-sm font-semibold text-stone-900">Dokumentkrav</p>
          {payload.documentOptions.length === 0 ? (
            <p className="mt-3 text-sm text-stone-700">Inga dokumentkrav är registrerade för den valda åtgärden.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm text-stone-700">
              {payload.documentOptions.map((option) => (
                <li key={option.id} className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                  <p className="font-medium text-stone-900">
                    {option.label} {option.isRequired ? '(obligatorisk)' : '(valfri)'}
                  </p>
                  {option.description ? <p className="mt-1">{option.description}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {canUpload ? (
          <form onSubmit={handleUpload} className="mt-8 rounded-3xl border border-stone-200 bg-white/70 p-6">
            <p className="text-sm font-semibold text-stone-900">Ladda upp dokument</p>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-2 text-sm text-stone-700">
                <span>Dokumenttyp</span>
                <select
                  value={selectedDocumentTypeId}
                  onChange={(event) => setSelectedDocumentTypeId(event.target.value)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                >
                  <option value="">Välj dokumenttyp</option>
                  {payload.documentOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="grid gap-2 text-sm text-stone-700">
                <span>Fil</span>
                <input
                  key={formResetKey}
                  type="file"
                  accept=".pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
                />
              </label>

              <label className="grid gap-2 text-sm text-stone-700">
                <span>Kommentar</span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className="rounded-2xl border border-stone-300 bg-white px-4 py-3 text-sm text-stone-900"
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
                className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {uploading ? 'Laddar upp...' : 'Ladda upp dokument'}
              </button>
              <p className="self-center text-xs text-stone-500">
                Tillåtna filer: PDF, JPG, PNG, WEBP, HEIC, HEIF. Max 15 MB.
              </p>
            </div>
          </form>
        ) : null}

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
