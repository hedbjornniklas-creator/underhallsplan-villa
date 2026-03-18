import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  isReportSnapshotPayloadV1,
  type ReportSnapshotPayloadV1,
} from '@/lib/report/pdfV2/renderStructuredPdfV2'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Besiktningsutlatande',
  robots: {
    index: false,
    follow: false,
  },
}

type SnapshotInspectionBlock = {
  title?: string | null
  noteText?: string | null
  riskText?: string | null
  ftuText?: string | null
  photoUrls?: string[] | null
  hasDeviations?: boolean | null
}

function toText(value: unknown, fallback = '--') {
  if (value === null || value === undefined) return fallback
  const normalized = String(value).trim()
  return normalized === '' ? fallback : normalized
}

function getByPath(root: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.').filter(Boolean)
  let current: unknown = root
  for (const part of parts) {
    if (!current || typeof current !== 'object' || !(part in current)) return null
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

function getTextByPath(root: Record<string, unknown>, path: string, fallback = '--') {
  return toText(getByPath(root, path), fallback)
}

function getBlockArrayByPath(root: Record<string, unknown>, path: string) {
  const value = getByPath(root, path)
  if (!Array.isArray(value)) return [] as SnapshotInspectionBlock[]
  return value as SnapshotInspectionBlock[]
}

function formatSnapshotTimestamp(value: string | null | undefined) {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE')
}

function renderBlocks(items: SnapshotInspectionBlock[]) {
  if (items.length === 0) {
    return <p className="text-sm text-gray-600">Inga noteringar.</p>
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => {
        const title = toText(item.title, 'Del')
        const note = toText(item.noteText, '--')
        const risk = toText(item.riskText, '')
        const ftu = toText(item.ftuText, '')
        const photos = Array.isArray(item.photoUrls) ? item.photoUrls.filter(Boolean) : []
        return (
          <article
            key={`${title}-${index}`}
            className="rounded-lg border border-gray-200 bg-white p-3"
          >
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{note}</p>
            {risk ? (
              <p className="mt-2 whitespace-pre-wrap text-xs text-rose-800">
                <span className="font-semibold">Risk:</span> {risk}
              </p>
            ) : null}
            {ftu ? (
              <p className="mt-1 whitespace-pre-wrap text-xs text-amber-800">
                <span className="font-semibold">FTU:</span> {ftu}
              </p>
            ) : null}
            {photos.length > 0 ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {photos.map((photoUrl, photoIndex) => (
                  <img
                    key={`${title}-${index}-photo-${photoIndex}`}
                    src={photoUrl}
                    alt={`Foto ${photoIndex + 1}`}
                    className="h-36 w-full rounded-md border border-gray-200 object-cover"
                  />
                ))}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const normalizedToken = token?.trim() ?? ''
  if (normalizedToken.length < 20) notFound()

  const admin = createSupabaseAdminClient()
  const tokenHash = hashAssignmentToken(normalizedToken)

  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,created_at,revoked_at,snapshot_payload')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Could not load report link.')
  }
  if (!data || data.revoked_at) notFound()

  const snapshot: ReportSnapshotPayloadV1 | null = isReportSnapshotPayloadV1(data.snapshot_payload)
    ? data.snapshot_payload
    : null

  const pdfInlineUrl = `/api/reports/public/${encodeURIComponent(normalizedToken)}`
  const pdfDownloadUrl = `${pdfInlineUrl}?download=1`

  if (!snapshot) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-slate-900">Besiktningsutlatande</h1>
          <p className="text-sm text-slate-700">
            Rapporten ar tillganglig som PDF.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={pdfInlineUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Oppna PDF
            </Link>
            <Link
              href={pdfDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Ladda ner PDF
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const mock = (snapshot.reportData?.mock ?? {}) as Record<string, unknown>
  const exteriorBlocks = getBlockArrayByPath(mock, 'exterior.blocks')
  const interiorBlocks = getBlockArrayByPath(mock, 'interior.blocks')
  const buildingDataText = getTextByPath(mock, 'buildingData.text', '')
  const riskText = getTextByPath(mock, 'risk.text', '')
  const ftuText = getTextByPath(mock, 'ftu.text', '')

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-6 md:py-8">
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Besiktningsutlatande</h1>
              <p className="mt-1 text-sm text-slate-600">
                Lanst och publicerat: {formatSnapshotTimestamp(snapshot.createdAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href={pdfInlineUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
              >
                Oppna PDF
              </Link>
              <Link
                href={pdfDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Ladda ner PDF
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Objekt</h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <dt className="text-xs text-slate-500">Fastighetsbeteckning</dt>
                <dd>{getTextByPath(mock, 'properties.cadastral_id')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Adress</dt>
                <dd>{getTextByPath(mock, 'properties.address')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Kommun</dt>
                <dd>{getTextByPath(mock, 'properties.municipality')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Fastighetsagare</dt>
                <dd>{getTextByPath(mock, 'properties.owner_name')}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Uppdragsgivare
            </h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <dt className="text-xs text-slate-500">Namn</dt>
                <dd>{getTextByPath(mock, 'inspections.client_name')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Uppdragsnummer</dt>
                <dd>{getTextByPath(mock, 'inspections.assignment_number')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Besiktningsdag</dt>
                <dd>{getTextByPath(mock, 'inspections.date_time')}</dd>
              </div>
            </dl>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Besiktningsman
            </h2>
            <dl className="mt-3 space-y-2 text-sm text-slate-700">
              <div>
                <dt className="text-xs text-slate-500">Namn</dt>
                <dd>{getTextByPath(mock, 'profile.full_name')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">E-post</dt>
                <dd>{getTextByPath(mock, 'profile.email')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Telefon</dt>
                <dd>{getTextByPath(mock, 'profile.phone')}</dd>
              </div>
            </dl>
          </article>
        </section>

        {buildingDataText ? (
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
              Byggnadsdata
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{buildingDataText}</p>
          </section>
        ) : null}

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Noteringar - byggnad utsida
          </h2>
          <div className="mt-3">{renderBlocks(exteriorBlocks)}</div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">
            Noteringar - byggnad insida
          </h2>
          <div className="mt-3">{renderBlocks(interiorBlocks)}</div>
        </section>

        {riskText ? (
          <section className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-rose-800">Risker</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-rose-900">{riskText}</p>
          </section>
        ) : null}

        {ftuText ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-800">
              Fortsatt teknisk utredning
            </h2>
            <p className="mt-2 whitespace-pre-wrap text-sm text-amber-900">{ftuText}</p>
          </section>
        ) : null}
      </div>
    </main>
  )
}
