export type QuestionUploadEntry = {
  id: string; file: File; status: 'pending' | 'uploading' | 'done' | 'error'; error?: string; attachmentId?: string
  upload?: { bucket: string; filePath: string; token: string; contentType: string }; uploaded?: boolean
}

export async function runQuestionUploadBatch(entries: QuestionUploadEntry[], upload: (entry: QuestionUploadEntry) => Promise<string>, progress: (entries: QuestionUploadEntry[]) => void) {
  for (const entry of entries) {
    if (entry.status === 'done') continue
    entry.status = 'uploading'; entry.error = undefined; progress([...entries])
    try {
      if (!entry.file.size || entry.file.size > 25 * 1024 * 1024) throw new Error('Filen får vara högst 25 MB och får inte vara tom.')
      entry.attachmentId = await upload(entry); entry.status = 'done'
    } catch (error) { entry.status = 'error'; entry.error = error instanceof Error ? error.message : 'Filen kunde inte laddas upp.' }
    progress([...entries])
  }
  return entries
}
