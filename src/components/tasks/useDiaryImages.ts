'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiaryImagePage } from '@/lib/action-cases/projectDiary'

export function useDiaryImages(caseId: string, active: boolean) {
  const [state, setState] = useState<DiaryImagePage & { caseId: string }>({ caseId, images: [], nextCursor: null })
  const [loading, setLoading] = useState(false), [error, setError] = useState('')
  const flight = useRef<AbortController | null>(null), sequence = useRef(0)
  const failedCursor = useRef<string | null>(null)
  const load = useCallback(async (cursor: string | null = null) => {
    const serial = ++sequence.current
    flight.current?.abort()
    const controller = new AbortController(); flight.current = controller
    setLoading(true); setError(''); failedCursor.current = cursor
    try {
      const response = await fetch(`/api/action-cases/${caseId}/diary/photos${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', signal: controller.signal })
      const next = await response.json()
      if (!response.ok) throw new Error(next.error || 'Dagboksbilderna kunde inte hämtas.')
      if (!Array.isArray(next.images) || (next.nextCursor !== null && typeof next.nextCursor !== 'string')) throw new Error('Dagboksbilderna kunde inte läsas. Försök igen.')
      if (serial !== sequence.current) return
      setState(current => ({ caseId, images: cursor && current.caseId === caseId ? [...new Map([...current.images, ...next.images].map(photo => [photo.id, photo])).values()] : next.images, nextCursor: next.nextCursor }))
    } catch (failure) { if (!controller.signal.aborted && serial === sequence.current) setError(failure instanceof Error ? failure.message : 'Dagboksbilderna kunde inte hämtas.') }
    finally { if (serial === sequence.current) setLoading(false) }
  }, [caseId])
  useEffect(() => {
    if (active) void load()
    // These refs intentionally hold the latest request, not a captured DOM node.
    const generation = sequence, request = flight
    return () => { ++generation.current; request.current?.abort() }
  }, [active, load])
  const data = state.caseId === caseId ? state : { images: [], nextCursor: null }
  return { ...data, loading, error, retry: () => load(failedCursor.current), refresh: () => load(), more: () => data.nextCursor ? load(data.nextCursor) : Promise.resolve() }
}
