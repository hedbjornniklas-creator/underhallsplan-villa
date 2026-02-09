'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'

export default function UtlatandePdfV2Page() {
  const params = useParams()
  const propertyId = params?.propertyId as string
  const inspectionId = params?.inspectionId as string

  const [status, setStatus] = useState('Forbereder PDF V.2...')
  const [error, setError] = useState<string | null>(null)

  const apiUrl = useMemo(() => {
    if (!inspectionId) return ''
    const query = propertyId ? `?propertyId=${propertyId}` : ''
    return `/api/report-v2/${inspectionId}/pdf${query}`
  }, [inspectionId, propertyId])

  useEffect(() => {
    if (!apiUrl) return

    let cancelled = false
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 30000)

    const fetchPdf = async () => {
      try {
        setStatus('Skapar PDF V.2...')
        const response = await fetch(apiUrl, { signal: controller.signal })
        if (!response.ok) {
          throw new Error(`PDF V.2 misslyckades (${response.status})`)
        }
        const blob = await response.blob()
        if (cancelled) return
        const objectUrl = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = objectUrl
        link.target = '_blank'
        link.rel = 'noreferrer'
        link.click()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
        setStatus('PDF V.2 klar. Du kan stanga denna sida.')
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'PDF V.2 misslyckades.'
        setError(message)
        setStatus('PDF V.2 kunde inte skapas.')
      } finally {
        clearTimeout(timeout)
      }
    }

    fetchPdf()

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [apiUrl])

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="mx-auto max-w-xl px-6 py-10">
        <div className="rounded-xl border bg-white p-6 text-sm text-gray-700">
          <h1 className="text-base font-semibold text-gray-900">PDF V.2</h1>
          <p className="mt-2">{status}</p>
          {error && (
            <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              {error}
              <div className="mt-2">
                <a
                  href={apiUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold underline"
                >
                  Prova igen
                </a>
              </div>
            </div>
          )}
          <div className="mt-6">
            <Link href={`/properties/${propertyId}/ob/${inspectionId}`} className="text-xs text-blue-600 underline">
              Tillbaka till besiktningen
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
