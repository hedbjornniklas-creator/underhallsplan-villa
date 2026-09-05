'use client'

import Link from 'next/link'
import { Download, FileText } from 'lucide-react'
import PublicReportPdfDownload, {
  type PublicReportPdfStatus,
} from '@/components/report/PublicReportPdfDownload'
import ReportShareButton from '@/components/report/ReportShareButton'

export type TuPublicDeliveryDocumentLink = {
  id: string
  title: string | null
  fileName: string | null
  contentType: string | null
  fileSizeBytes: number | null
  createdAt: string | null
  downloadUrl: string
}

function formatFileSize(value: number | null | undefined) {
  if (!value || value < 1) return null
  if (value < 1024 * 1024) return `${Math.ceil(value / 1024)} kB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export default function TuPublicReportToolbar({
  shareEndpoint,
  shareUrl,
  pdfDownloadUrl,
  pdfStatus,
  pdfStatusEndpoint,
  deliveryDocuments = [],
}: {
  shareEndpoint: string | null
  shareUrl: string | null
  pdfDownloadUrl: string | null
  pdfStatus?: PublicReportPdfStatus | null
  pdfStatusEndpoint?: string | null
  deliveryDocuments?: TuPublicDeliveryDocumentLink[]
}) {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
            Digitalt utlåtande
          </p>
          <h1 className="text-lg font-semibold text-slate-950">Teknisk utredning</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {shareEndpoint && shareUrl ? (
            <ReportShareButton shareEndpoint={shareEndpoint} shareUrl={shareUrl} />
          ) : null}
          <PublicReportPdfDownload
            downloadUrl={pdfDownloadUrl}
            initialStatus={pdfStatus}
            statusEndpoint={pdfStatusEndpoint}
            tone="violet"
          />
        </div>
      </div>

      {deliveryDocuments.length > 0 ? (
        <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-950">Underlag</h2>
              <p className="text-xs text-slate-500">
                Dokument som ingår i leveransen och kan laddas ner från den här länken.
              </p>
            </div>
            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-1 text-xs font-medium text-violet-800">
              {deliveryDocuments.length} dokument
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {deliveryDocuments.map((document) => {
              const label = document.title?.trim() || document.fileName?.trim() || 'Underlag'
              const size = formatFileSize(document.fileSizeBytes)
              return (
                <Link
                  key={document.id}
                  href={document.downloadUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-h-12 items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm transition hover:border-violet-200 hover:bg-violet-50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FileText size={16} className="shrink-0 text-violet-700" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate font-semibold text-slate-900">{label}</span>
                      {size ? <span className="block text-xs text-slate-500">{size}</span> : null}
                    </span>
                  </span>
                  <Download size={16} className="shrink-0 text-violet-700" aria-hidden />
                </Link>
              )
            })}
          </div>
        </section>
      ) : null}
    </div>
  )
}
