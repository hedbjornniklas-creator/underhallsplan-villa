export const SIGNED_CONTRACT_MAX_BYTES = 20_000_000

export type SignedContractUpload = {
  bucket: string; filePath: string; token: string; contentType: string; ticket: string
}
export type SignedContractUploadAttempt = { file: File; revision: number; upload?: SignedContractUpload; uploaded?: boolean }

export function signedContractFileIssue(file: { name: string; type: string; size: number }) {
  if (!file.name || file.name.length > 250 || !/\.pdf$/i.test(file.name) || file.type && file.type !== 'application/pdf') return 'Välj en PDF-fil.'
  if (file.size < 100) return 'PDF-filen är tom eller för liten.'
  if (file.size > SIGNED_CONTRACT_MAX_BYTES) return 'PDF-filen får vara högst 20 MB.'
  return ''
}

export async function signedContractResponse(response: Response): Promise<Record<string, any>> {
  let result: Record<string, any> | null = null
  try { const value = JSON.parse(await response.text()); if (value && typeof value === 'object' && !Array.isArray(value)) result = value } catch { /* Infrastructure errors may be plain text or HTML. */ }
  if (!response.ok || !result) {
    const fallback = response.status === 413 ? 'PDF-filen kunde inte laddas upp via servern. Ladda om sidan och försök igen med den nya uppladdningen.'
      : response.status === 401 ? 'Din inloggning har gått ut. Logga in igen och välj PDF-filen på nytt.'
      : response.status === 429 ? 'För många försök. Vänta en stund och försök igen. Din PDF är kvar.'
      : 'Uppladdningen kunde inte bekräftas. Din PDF är kvar. Försök igen.'
    throw new Error(typeof result?.error === 'string' ? result.error : fallback)
  }
  return result
}

export async function uploadSignedContract(url: string, attempt: SignedContractUploadAttempt, storage: {
  from(bucket: string): { uploadToSignedUrl(path: string, token: string, file: File, options: { contentType: string }): PromiseLike<{ error: unknown }> }
}, request: typeof fetch = fetch) {
  const issue = signedContractFileIssue(attempt.file)
  if (issue) throw new Error(issue)
  const post = async (body: Record<string, unknown>) => signedContractResponse(await request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(150000), body: JSON.stringify(body),
  }))
  if (!attempt.upload) {
    const prepared = await post({ operation: 'prepare', revision: attempt.revision, confirmed: true,
      fileName: attempt.file.name, fileSizeBytes: attempt.file.size, contentType: 'application/pdf' })
    if (!prepared.upload?.ticket || !prepared.upload.token || !prepared.upload.filePath || !prepared.upload.bucket) throw new Error('Uppladdningen kunde inte förberedas. Försök igen.')
    attempt.upload = prepared.upload
  }
  const upload = attempt.upload!
  if (!attempt.uploaded) {
    const result = await storage.from(upload.bucket).uploadToSignedUrl(upload.filePath, upload.token, attempt.file, { contentType: 'application/pdf' })
    if (result.error) {
      // The storage write may have succeeded even if its acknowledgement was lost.
      try { return await post({ operation: 'complete', ticket: upload.ticket, revision: attempt.revision, confirmed: true }) }
      catch { throw new Error('PDF-uppladdningen kunde inte bekräftas. Filen och din bekräftelse är kvar. Försök igen.') }
    }
    attempt.uploaded = true
  }
  return post({ operation: 'complete', ticket: upload.ticket, revision: attempt.revision, confirmed: true })
}
