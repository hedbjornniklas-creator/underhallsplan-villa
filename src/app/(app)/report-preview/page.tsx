import Link from 'next/link'

export default function ReportPreviewPage() {
  return (
    <main className="p-6 space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-gray-900">Förhandsgranskning av rapport</h1>
        <p className="text-sm text-gray-600">
          Den här sidan länkar till den stabila test-renderingen av rapporten.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Link
          href="/debug/report"
          className="inline-flex items-center rounded-md bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-black"
        >
          Öppna debug-rapport
        </Link>
        <Link
          href="/debug/report"
          target="_blank"
          rel="noreferrer"
          className="text-sm text-gray-700 underline"
        >
          Öppna i ny flik
        </Link>
      </div>

      <div className="rounded-lg border bg-white p-3">
        <div className="text-xs text-gray-500">Inbäddad förhandsgranskning</div>
        <iframe
          title="Förhandsgranskning av rapport"
          src="/debug/report"
          className="mt-2 w-full rounded border"
          style={{ minHeight: '600px' }}
        />
      </div>
    </main>
  )
}
