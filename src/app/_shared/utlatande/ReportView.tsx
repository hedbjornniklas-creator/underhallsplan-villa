import { loadStandardText } from '@/content/standardtexts/loadStandardText'
import {
  getStandardTextPath,
  listStandardTextIds,
  type StandardTextId,
} from '@/content/standardtexts/registry'

type ReportViewProps = {
  propertyId?: string | null
  inspectionId?: string | null
}

type SectionData = {
  id: StandardTextId
  path: string
  content: string
  error: string | null
  charCount: number
}

export default function ReportView({ propertyId, inspectionId }: ReportViewProps) {
  const ids = listStandardTextIds()

  const sections: SectionData[] = ids.map((id) => {
    const path = getStandardTextPath(id)
    let content = ''
    let error: string | null = null

    try {
      content = loadStandardText(id)
    } catch (err) {
      error = err instanceof Error ? err.message : 'Okänt fel vid inläsning.'
    }

    return {
      id,
      path,
      content,
      error,
      charCount: content.length,
    }
  })

  const hasIds = Boolean(propertyId) && Boolean(inspectionId)

  return (
    <div className="mx-auto w-full max-w-4xl bg-white p-6 shadow-sm print:shadow-none">
      <header className="mb-6 border-b pb-4">
        <h1 className="text-xl font-semibold text-gray-900">Utlåtande – standardtexter</h1>
        <p className="text-sm text-gray-600">
          Testläge för att verifiera rendering, sidbrytningar och filinläsning.
        </p>
        {hasIds ? (
          <div className="mt-2 text-xs text-gray-500">
            Fastighet: {propertyId} · Besiktning: {inspectionId}
          </div>
        ) : (
          <div className="mt-2 text-xs text-red-600">
            Parametrar saknas. Kontrollera att länken innehåller giltiga ID:n.
          </div>
        )}
      </header>

      <div className="space-y-6">
        {sections.map((section) => (
          <section key={section.id} className="break-inside-avoid">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="text-base font-semibold text-gray-900">{section.id}</h2>
              <span className="text-xs text-gray-500">Tecken: {section.charCount}</span>
            </div>
            <div className="text-xs text-gray-500">Sökväg: {section.path}</div>
            {section.error ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {section.error}
              </div>
            ) : (
              <pre className="mt-2 whitespace-pre-wrap rounded-md border bg-gray-50 p-3 text-xs text-gray-800">
                {section.content}
              </pre>
            )}
          </section>
        ))}
      </div>
    </div>
  )
}
