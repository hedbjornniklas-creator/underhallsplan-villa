export const APPLICATION_LOAD_ERROR = 'Din ansökan kunde inte laddas just nu. Försök igen om en stund.'

// Only initial GET reads may be retried. Never use this helper for saves or email delivery.
export async function loadPublicApplicationJson<T>(url: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    let retryable = true
    let message = APPLICATION_LOAD_ERROR
    try {
      signal.throwIfAborted()
      const response = await fetch(url, {
        method: 'GET', cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      })
      retryable = [408, 429, 500, 502, 503, 504].includes(response.status)
      if (response.ok) {
        retryable = true
        return await response.json() as T
      }
      // Do not expose provider responses, HTML gateway errors or internal database messages.
      message = response.status === 404
        ? 'Ansökan eller föreningen kunde inte hittas. Kontrollera att du har öppnat hela länken från mejlet.'
        : APPLICATION_LOAD_ERROR
      throw new Error(message)
    } catch {
      signal.throwIfAborted()
      if (!retryable || attempt === 2) {
        throw new Error(message)
      }
      await new Promise(resolve => setTimeout(resolve, 300 * (attempt + 1)))
    }
  }
  throw new Error(APPLICATION_LOAD_ERROR)
}
