'use client'

import Link from 'next/link'

type ReportToolbarProps = {
  backHref: string
}

export default function ReportToolbar({ backHref }: ReportToolbarProps) {
  const handlePrint = () => {
    const start = Date.now()
    const maxWaitMs = 15000
    const interval = setInterval(() => {
      const images = Array.from(document.querySelectorAll('img[data-report-track="1"]'))
      const allReady =
        images.length === 0 ||
        images.every(
          (img) =>
            img.getAttribute('data-report-ready') === '1' &&
            (img as HTMLImageElement).complete
        )

      if (allReady || Date.now() - start > maxWaitMs) {
        clearInterval(interval)
        window.print()
      }
    }, 200)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-white px-4 py-3 text-sm text-gray-700 print:hidden">
      <div className="font-semibold text-gray-900">Utlåtande (testläge)</div>
      <div className="flex items-center gap-3">
        <Link href={backHref} className="text-sm text-gray-700 hover:underline">
          Tillbaka
        </Link>
        <button
          type="button"
          onClick={handlePrint}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-black"
        >
          Skriv ut / Spara som PDF
        </button>
      </div>
    </div>
  )
}
