import 'server-only'
import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { completeActionCaseUpload } from './server'
import { DIARY_BUCKET, getCurrentDiaryImage, type DiaryContext } from './projectDiaryServer'
import { DIARY_MAX_PHOTO_BYTES, diaryUuid } from './projectDiary'
import { diaryImageCaption } from './projectImageLibrary'
import { requireQuestionParticipant } from './questionDialogueServer'
import type { ActionCaseAttachmentView } from './contracts'

export async function attachDiaryImageToQuestion(ctx: DiaryContext, caseId: string, questionId: string, photoId: unknown): Promise<ActionCaseAttachmentView> {
  if (!diaryUuid(photoId)) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const sourceId = photoId.toLowerCase()
  await requireQuestionParticipant(ctx, caseId, questionId)
  const db = createSupabaseAdminClient()
  const question = await db.from('action_case_questions').select('body').eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('id', questionId).maybeSingle()
  if (question.error) throw new Error('PROJECT_QUESTION_FAILED')
  if (!question.data) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  if (question.data.body.status === 'closed') throw new Error('PROJECT_QUESTION_CLOSED')
  const bucket = 'project-question-files'
  // Stable, question-private destinations make a lost-response retry idempotent.
  const stem = `${ctx.orgId}/${caseId}/questions/${questionId}/diary-${sourceId}`
  const existing = async () => {
    const result = await db.from('action_case_attachments').select('id,file_name,title,content_type,file_size_bytes,created_at')
      .eq('org_id', ctx.orgId).eq('action_case_id', caseId).eq('question_id', questionId).eq('storage_bucket', bucket)
      .in('file_path', ['jpg', 'png', 'webp'].map(extension => `${stem}.${extension}`)).maybeSingle()
    if (result.error) throw new Error('PROJECT_QUESTION_FAILED')
    const file = result.data
    return file ? { id: file.id, fileName: file.file_name, title: file.title, contentType: file.content_type,
      fileSizeBytes: file.file_size_bytes, createdAt: file.created_at, type: 'image', actionCaseItemId: null, grantedParticipantIds: [] } as ActionCaseAttachmentView : null
  }
  const saved = await existing()
  if (saved) return saved
  const photo = await getCurrentDiaryImage(ctx, caseId, sourceId)
  const extension = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[photo.contentType]
  if (!extension || photo.size > DIARY_MAX_PHOTO_BYTES || photo.size <= 0) throw new Error('PROJECT_DIARY_PHOTO')
  const original = await db.storage.from(DIARY_BUCKET).download(`${ctx.orgId}/${caseId}/images/${photo.id}`)
  if (original.error || !original.data || original.data.size !== photo.size) throw new Error('PROJECT_DIARY_UPLOAD')
  const bytes = Buffer.from(await original.data.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== photo.sha256) throw new Error('PROJECT_DIARY_PHOTO')
  const path = `${stem}.${extension}`
  const copied = await db.storage.from(bucket).upload(path, bytes, { contentType: photo.contentType, upsert: false })
  if (copied.error) {
    const previous = await db.storage.from(bucket).download(path)
    if (previous.error || !previous.data || createHash('sha256').update(Buffer.from(await previous.data.arrayBuffer())).digest('hex') !== photo.sha256) throw new Error('PROJECT_DIARY_UPLOAD')
  }
  try {
    await completeActionCaseUpload(ctx, { caseId, questionId, filePath: path, fileName: photo.name,
      contentType: photo.contentType, fileSize: photo.size, title: diaryImageCaption(photo), participantIds: [] })
  } catch (error) { if (!(await existing())) throw error }
  // Never remove diary originals or a possibly committed private copy on error.
  const registered = await existing()
  if (!registered) throw new Error('PROJECT_QUESTION_FAILED')
  return registered
}
