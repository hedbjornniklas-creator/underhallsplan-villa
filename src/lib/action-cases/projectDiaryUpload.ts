// @ts-expect-error Node strip-types tests require the explicit extension.
import { DIARY_PHOTO_PART_BYTES } from './projectDiary.ts'

type Photo = { id: string; name: string; size: number; contentType: string; file: Blob }
type Options = { endpoint: string; photo: Photo; signal: AbortSignal; onProgress?: (message: string) => void; fetcher?: typeof fetch; timeoutMs?: number }
type Result = { id?: string; ready?: boolean; uploadUrl?: string; error?: string; code?: string }

export async function uploadDiaryPhoto({ endpoint, photo, signal, onProgress, fetcher = fetch, timeoutMs = 35000 }: Options) {
  async function request(url: string | URL, options: RequestInit) {
    signal.throwIfAborted()
    const controller = new AbortController(), abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try { return await fetcher(url, { ...options, signal: controller.signal }) }
    finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
  async function post(operation: string, data: Record<string, unknown> = {}) {
    const response = await request(`${endpoint}/photos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, id: photo.id, ...data }) })
    const result: Result = await response.json().catch(() => ({}))
    return { response, result }
  }
  function confirmed({ response, result }: Awaited<ReturnType<typeof post>>) {
    if (!response.ok || result.id !== photo.id) throw new Error(result.error || 'Bilden kunde inte bekräftas. Försök igen.')
  }
  try {
    onProgress?.('Förbereder bilden…')
    const prepared = await post('prepare', { name: photo.name, size: photo.size, contentType: photo.contentType })
    if (!prepared.response.ok) throw new Error(prepared.result.error || 'Bilden kunde inte förberedas. Försök igen.')
    if (prepared.result.id !== photo.id) throw new Error('Bildens uppladdning kunde inte bekräftas.')
    if (prepared.result.ready) return
    const url = new URL(prepared.result.uploadUrl || '')
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Uppladdningsadressen kunde inte godkännas.')

    // Keep stable bytes while Android's gallery releases its original file handle.
    let bytes: ArrayBuffer
    try { bytes = await photo.file.arrayBuffer() }
    catch { throw new Error('Bilden kunde inte läsas från telefonen. Välj bilden igen.') }
    if (bytes.byteLength !== photo.size) throw new Error('Bildfilen har ändrats. Välj bilden igen.')
    const image = new Blob([bytes], { type: photo.contentType })
    onProgress?.('Laddar upp bilden…')
    let uploaded = false
    try {
      const response = await request(url, { method: 'PUT', body: image, redirect: 'error', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { 'Content-Type': photo.contentType, 'x-upsert': 'false' } })
      uploaded = response.ok
    } catch { signal.throwIfAborted() }
    if (uploaded) { onProgress?.('Kontrollerar bilden…'); confirmed(await post('complete')); return }

    // A lost storage response may still have committed the entire original.
    const existing = await post('complete')
    if (existing.response.ok) { confirmed(existing); return }
    if ([401, 403, 404, 429].includes(existing.response.status)) throw new Error(existing.result.error || 'Uppladdningen kunde inte godkännas.')
    const count = Math.ceil(photo.size / DIARY_PHOTO_PART_BYTES)
    for (let index = 0; index < count; index++) {
      onProgress?.(`Laddar upp via Hushub · ${index + 1}/${count}`)
      const part = image.slice(index * DIARY_PHOTO_PART_BYTES, Math.min(photo.size, (index + 1) * DIARY_PHOTO_PART_BYTES))
      const response = await request(`${endpoint}/photos/${photo.id}/parts/${index}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: part })
      const result = await response.json().catch(() => ({}))
      if (!response.ok || result.id !== photo.id || result.part !== index) throw new Error(result.error || 'Bilden kunde inte skickas via Hushub. Försök igen.')
    }
    onProgress?.('Kontrollerar bilden…')
    confirmed(await post('complete_relay'))
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof TypeError || error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Anslutningen avbröts. Texten finns kvar. Kontrollera uppkopplingen och tryck på Försök igen.')
    }
    throw error
  }
}
