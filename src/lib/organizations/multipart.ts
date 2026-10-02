/** Bound the complete body before multipart parsing, including chunked requests. */
export async function readOrganizationMultipart(request: Request) {
  const maxBytes = 6 * 1024 * 1024
  const contentType = request.headers.get('content-type') ?? ''
  if (!/^multipart\/form-data\s*;/iu.test(contentType)) throw new Error('ORG_CONTENT_TYPE_INVALID')
  const declared = request.headers.get('content-length')
  if (declared && (!/^\d+$/u.test(declared) || Number(declared) > maxBytes)) throw new Error('ORG_REQUEST_TOO_LARGE')
  const reader = request.body?.getReader()
  if (!reader) throw new Error('ORG_INPUT_INVALID')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new Error('ORG_REQUEST_TOO_LARGE')
      }
      chunks.push(chunk.value)
    }
  } finally { reader.releaseLock() }
  const buffer = Buffer.concat(chunks)
  try { return await new Response(buffer, { headers: { 'Content-Type': contentType } }).formData() }
  catch { throw new Error('ORG_INPUT_INVALID') }
}
