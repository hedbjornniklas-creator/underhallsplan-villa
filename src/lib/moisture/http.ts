import 'server-only'

import { NextResponse } from 'next/server'
import { getMoistureError } from '@/lib/moisture/domain'

const MAX_BODY_BYTES = 64 * 1024

class MoistureRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function moistureJson(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export function moistureErrorResponse(error: unknown) {
  const result = error instanceof MoistureRequestError
    ? { status: error.status, message: error.message }
    : getMoistureError(error)
  return moistureJson({
    error: result.message,
    ...('fieldErrors' in result && result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}),
  }, result.status)
}

export async function readMoistureBody(request: Request): Promise<unknown> {
  const origin = request.headers.get('origin')
  if (
    request.headers.get('sec-fetch-site') === 'cross-site' ||
    (origin && origin !== new URL(request.url).origin)
  ) {
    throw new MoistureRequestError('Begäran måste skickas från Hushub.', 403)
  }
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new MoistureRequestError('Begäran måste innehålla JSON.', 415)
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new MoistureRequestError('Uppgifterna är för stora. Förkorta texten och försök igen.', 413)
  }

  const reader = request.body?.getReader()
  if (!reader) throw new MoistureRequestError('Begäran saknar uppgifter.', 400)
  const decoder = new TextDecoder()
  let size = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new MoistureRequestError('Uppgifterna är för stora. Förkorta texten och försök igen.', 413)
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    body += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(body)
  } catch {
    throw new MoistureRequestError('Begäran innehåller ogiltiga uppgifter.', 400)
  }
}
