'use client'

import { useCallback, useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, Printer } from 'lucide-react'

export default function TuPrintActions({
  backHref,
  autoPrint,
  printTitle = 'Teknisk utredning',
}: {
  backHref: string
  autoPrint: boolean
  printTitle?: string
}) {
  const printWithTitle = useCallback(() => {
    const previousTitle = document.title
    document.title = printTitle

    const restoreTitle = () => {
      document.title = previousTitle
      window.removeEventListener('afterprint', restoreTitle)
    }

    window.addEventListener('afterprint', restoreTitle)
    window.print()
    window.setTimeout(restoreTitle, 1000)
  }, [printTitle])

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
