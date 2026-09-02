'use client'

import { useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'

export default function TuPrintPreviewToolbar({
  backHref,
  printTitle,
}: {
  backHref: string
  printTitle: string
}) {
  const waitForPrintLayout = useCallback(async () => {
    const root = document.querySelector('[data-tu-print-pagination-ready]')
    if (!root || root.getAttribute('data-tu-print-pagination-ready') === '1') return

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
  }, [])

  const printDraft = useCallback(() => {
    void (async () => {
      await waitForPrintLayout()

      const previousTitle = document.title
      document.title = printTitle.trim() ? printTitle : '\u200B'

      const restoreTitle = () => {
        document.title = previousTitle
        window.removeEventListener('afterprint', restoreTitle)
      }

      window.addEventListener('afterprint', restoreTitle)
      window.print()
      window.setTimeout(restoreTitle, 1000)
    })()
  }, [printTitle, waitForPrintLayout])

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 print:hidden">
      <div className="flex flex-col gap-3 rounded-md border border-violet-200 bg-white p-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={backHref}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50"
          >
            <ArrowLeft size={16} aria-hidden />
            Till granskningen
          </Link>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-950">Förhandsgranskning av utkast</p>
            <p className="text-xs leading-5 text-gray-600">Ingenting fastställs, låses eller skickas från denna vy.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={printDraft}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 transition hover:bg-violet-50"
        >
          <Printer size={16} aria-hidden />
          Skriv ut utkast
        </button>
      </div>
    </div>
  )
}
