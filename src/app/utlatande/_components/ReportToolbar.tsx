'use client'

import Link from 'next/link'

type ReportToolbarProps = {
  backHref: string
}

export default function ReportToolbar({ backHref }: ReportToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3 text-sm text-gray-700 print:hidden">
      <div className="font-semibold text-gray-900">Utlåtande (testläge)</div>
      <div className="flex items-center gap-3">
        <Link href={backHref} className="text-sm text-gray-700 hover:underline">
          Tillbaka
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
        >
          Skriv ut / Spara som PDF
        </button>
      </div>
    </div>
  )
}
