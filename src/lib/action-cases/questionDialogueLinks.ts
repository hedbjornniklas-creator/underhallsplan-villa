import { createHmac, timingSafeEqual } from 'node:crypto'
import { questionUuid } from './projectQuestions'

function secret() {
  const key = process.env.PROJECT_QUESTION_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || key.length < 32) throw new Error('PROJECT_QUESTION_LINK_CONFIG')
  return key
}
// A persisted random nonce permits revocation without storing plaintext bearer links.
export function questionLinkToken(id: string, nonce: string, key = secret()) {
  if (!questionUuid(id) || !questionUuid(nonce)) throw new Error('PROJECT_QUESTION_INVALID')
  const payload = `${id}.${nonce}`
  return `${payload}.${createHmac('sha256', key).update(`HusHub:project-question:v1:${payload}`).digest('base64url')}`
}
export function parseQuestionLink(token: string, key = secret()) {
  const parts = token.split('.')
  if (parts.length !== 3 || !questionUuid(parts[0]) || !questionUuid(parts[1]) || !/^[A-Za-z0-9_-]{43}$/.test(parts[2])) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  const expected = questionLinkToken(parts[0], parts[1], key)
  if (Buffer.byteLength(expected) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(expected), Buffer.from(token))) throw new Error('PROJECT_QUESTION_NOT_FOUND')
  return { participantId: parts[0], nonce: parts[1] }
}
