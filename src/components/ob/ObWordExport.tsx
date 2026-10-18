'use client'

import { FileDown, LoaderCircle } from 'lucide-react'
import { useState } from 'react'

export default function ObWordExport({ href, published, disabled = false }: {
  href: string; published: boolean; disabled?: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const download = async () => {
    if (busy || disabled) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(href, { cache: 'no-store' })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        throw Error(payload?.error ?? 'Word-filen kunde inte hämtas. Försök igen.')
      }
      if (!response.headers.get('content-type')?.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document')) {
        throw Error('Word-filen kunde inte hämtas. Kontrollera att du fortfarande är inloggad.')
      }
      const blob = await response.blob()
      const encoded = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
      const filename = encoded ? decodeURIComponent(encoded).replace(/[\\/]/g, '-') : 'Utlåtande.docx'
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = filename
      document.body.append(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 30000)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Word-filen kunde inte hämtas.')
    } finally { setBusy(false) }
  }
  return <div className="min-w-0">
    <button type="button" className="ob-delivery-secondary inline-flex items-center gap-2" onClick={() => void download()}
      disabled={busy || disabled} aria-busy={busy}
      title={published ? 'Word-kopia av det senast publicerade utlåtandet' : 'Word-kopia av aktuellt utkast'}>
      {busy ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <FileDown size={18} aria-hidden="true" />}
      {busy ? 'Skapar Word-fil...' : 'Ladda ner Word'}
    </button>
    <span className="ml-2 text-xs text-gray-600">{published ? 'Publicerad version' : 'Aktuellt utkast'}</span>
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </div>
}
