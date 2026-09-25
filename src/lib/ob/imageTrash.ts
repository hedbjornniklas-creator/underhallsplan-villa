import type { RoundImage } from '@/components/ob/ObStepRunda'

export type TrashedRoundImage = {
  eventId: string
  deletedAt: string
  expiresAt: string
  daysRemaining: number
  image: RoundImage
}
export type ImageTrashPage = { items: TrashedRoundImage[]; nextCursor: string | null }
export type ImageRestoreResult = { image: RoundImage | null }

export async function requestImageTrash<T>(inspectionId: string, partId: string | null,
  options: { beforeEventId?: string } | { eventId: string; requestId: string }): Promise<T> {
  const query = new URLSearchParams()
  if (partId) query.set('partId', partId)
  const restore = 'eventId' in options
  if (!restore && options.beforeEventId) query.set('beforeEventId', options.beforeEventId)
  const response = await fetch(`/api/ob/inspections/${encodeURIComponent(inspectionId)}/image-trash?${query}`, {
    method: restore ? 'POST' : 'GET', cache: 'no-store',
    ...(restore ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(options) } : {}),
  })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || result.error) throw Error(result?.error || 'Papperskorgen kunde inte nås. Försök igen.')
  return result.data as T
}
