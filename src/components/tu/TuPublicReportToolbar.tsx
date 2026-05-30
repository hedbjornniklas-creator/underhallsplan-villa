'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { Download, Printer } from 'lucide-react'
import ReportShareButton from '@/components/report/ReportShareButton'

export default function TuPublicReportToolbar({
  shareEndpoint,
  shareUrl,
  pdfDownloadUrl,
}: {
  shareEndpoint: string
  shareUrl: string
  pdfDownloadUrl: string | null
}) {
  const printReport = useCallback(() => {
    const run = async () => {
      const root = document.querySelector('[data-tu-print-pagination-ready]')
      if (root && root.getAttribute('data-tu-print-pagination-ready') !== '1') {
        await new Promise<void>((resolve) => {
          let observer: MutationObserver | null = null
          const timeout = window.setTimeout(() => {
            observer?.disconnect()
            resolve()
          }, 5000)
          observer = new MutationObserver(() => {
            if (root.getAttribute('data-tu-print-pagination-ready') !== '1') return
            window.clearTimeout(timeout)
            observer?.disconnect()
            resolve()
          })
          observer.observe(root, { attributes: true, attributeFilter: ['data-tu-print-pagination-ready'] })
        })
      }
      window.print()
    }

    void run()
  }, [])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 print:hidden">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
          Digitalt utlåtande
        </p>
        <h1 className="text-lg font-semibold text-slate-950">Teknisk utredning</h1>
      </div>
      <div className="flex flex-wrap gap-2">
        <ReportShareButton shareEndpoint={shareEndpoint} shareUrl={shareUrl} />
        {pdfDownloadUrl ? (
          <Link
            href={pdfDownloadUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
          >
            <Download size={16} aria-hidden />
            Ladda ner PDF
          </Link>
        ) : null}
        <button
          type="button"
          onClick={printReport}
          className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
        >
          <Printer size={16} aria-hidden />
          Skriv ut / Spara PDF
        </button>
      </div>
    </div>
  )
}
