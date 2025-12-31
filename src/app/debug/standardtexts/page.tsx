import Link from 'next/link'
import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import { getStandardTextPath, listStandardTextIds, type StandardTextId } from '@/content/standardtexts/registry'

type PageProps = {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function StandardTextsDebugPage({ searchParams }: PageProps) {
  const ids = listStandardTextIds()
  const rawId = searchParams?.id
  const selectedId = Array.isArray(rawId) ? rawId[0] : rawId
  const activeId = ids.includes(selectedId as StandardTextId)
    ? (selectedId as StandardTextId)
    : ids[0]

  let content = ''
  let errorMessage = ''

  try {
    content = loadStandardText(activeId)
  } catch (error) {
    errorMessage = error instanceof Error ? error.message : 'Okänt fel vid inläsning.'
  }

  const filePath = getStandardTextPath(activeId)
  const charCount = content.length

  return (
    <main className="mx-auto w-full max-w-5xl p-6 text-sm text-gray-800">
      <h1 className="text-lg font-semibold text-gray-900">Standardtexter (debug)</h1>
      <p className="mt-1 text-sm text-gray-600">
        Välj en standardtext för att visa innehållet och validera pipeline.
      </p>

      <div className="mt-4 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="rounded-lg border bg-white p-3">
          <div className="text-xs font-semibold uppercase text-gray-500">Texter</div>
          <ul className="mt-2 space-y-1">
            {ids.map((id) => (
              <li key={id}>
                <Link
                  href={`/debug/standardtexts?id=${encodeURIComponent(id)}`}
                  className={`block rounded px-2 py-1 text-xs ${
                    id === activeId
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {id}
                </Link>
              </li>
            ))}
          </ul>
        </aside>

        <section className="rounded-lg border bg-white p-4">
          <div className="text-xs text-gray-500">Vald ID</div>
          <div className="text-sm font-semibold text-gray-900">{activeId}</div>

          <div className="mt-3 text-xs text-gray-500">Sökväg</div>
          <div className="text-xs text-gray-800">{filePath}</div>

          <div className="mt-3 text-xs text-gray-500">Antal tecken</div>
          <div className="text-xs text-gray-800">{charCount}</div>

          {errorMessage ? (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : (
            <pre className="mt-4 whitespace-pre-wrap rounded-md border bg-gray-50 p-3 text-xs text-gray-800">
              {content}
            </pre>
          )}
        </section>
      </div>
    </main>
  )
}
