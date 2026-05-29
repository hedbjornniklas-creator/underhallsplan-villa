'use client'

import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'

export default function TuPrintActions({
  backHref,
  autoPrint,
  printTitle = '',
}: {
  backHref: string
  autoPrint: boolean
  printTitle?: string
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

  const printWithTitle = useCallback(() => {
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

  useEffect(() => {
    if (!autoPrint) return
    const timeout = window.setTimeout(() => printWithTitle(), 250)
    return () => window.clearTimeout(timeout)
  }, [autoPrint, printWithTitle])

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-4 print:hidden">
      <Link
        href={backHref}
        className="inline-flex h-10 items-center gap-2 rounded-md border border-violet-200 bg-white px-3 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-50"
      >
        <ArrowLeft size={16} aria-hidden />
        Till utlåtandet
      </Link>
      <button
        type="button"
        onClick={printWithTitle}
        className="inline-flex h-10 items-center gap-2 rounded-md bg-violet-700 px-3 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-800"
      >
        <Printer size={16} aria-hidden />
        Skriv ut / Spara som PDF
      </button>
    </div>
  )
}
