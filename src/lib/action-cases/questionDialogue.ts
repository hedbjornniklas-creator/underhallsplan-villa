import { questionUuid, type QuestionParticipant } from './projectQuestions'

export type DialogueMessage = { id: string; participantId: string; actorName: string; actorMethod: 'internal_login' | 'personal_link'; operation: 'share' | 'reply'; text: string; createdAt: string; snapshot: { title: string; description: string } | null; files: Array<{ id: string; name: string }> }
export type QuestionDialogue = { questionId: string; version: number; sharedAt: string | null; snapshot: { title: string; description: string } | null; status: string; managerId?: string | null; canManage: boolean; viewerId: string; participants: QuestionParticipant[]; messages: DialogueMessage[]; deliveries: Array<{ id: string; name: string; status: string }> }
export function dialogueMutation(value: Record<string, unknown>) {
  const operation = String(value.operation)
  if (!['participants', 'share', 'reply'].includes(operation) || !questionUuid(value.requestId) || !Number.isSafeInteger(value.version) || Number(value.version) < 0) throw new Error('PROJECT_QUESTION_INVALID')
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  if (text.length > 12000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text) || (operation === 'reply' && !text)) throw new Error('PROJECT_QUESTION_INVALID')
  const fileIds = value.fileIds ?? []
  if (!Array.isArray(fileIds) || fileIds.length > 20 || !fileIds.every(questionUuid) || new Set(fileIds).size !== fileIds.length) throw new Error('PROJECT_QUESTION_FILES')
  const refs = value.participants ?? []
  if (!Array.isArray(refs) || refs.length > 30) throw new Error('PROJECT_QUESTION_INVALID')
  const participants = refs.map(p => {
    if (!p || !questionUuid(p.id) || !['profile', 'contact', 'customer'].includes(p.kind)) throw new Error('PROJECT_QUESTION_INVALID')
    return { id: String(p.id), kind: String(p.kind) }
  })
  if (new Set(participants.map(p => `${p.kind}:${p.id}`)).size !== participants.length) throw new Error('PROJECT_QUESTION_INVALID')
  if (operation === 'share' && value.confirmed !== true) throw new Error('PROJECT_QUESTION_INVALID')
  return { requestId: value.requestId, version: Number(value.version), operation, text: operation === 'reply' ? text : '', fileIds: operation === 'participants' ? [] : fileIds, participants: operation === 'participants' ? participants : [], confirmed: operation === 'share' }
}
