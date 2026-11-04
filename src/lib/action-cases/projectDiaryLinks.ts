import { createHmac, timingSafeEqual } from 'node:crypto'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { diaryUuid } from './projectDiary.ts'

export const DIARY_DEVICE_SECONDS = 365 * 24 * 60 * 60
export function diarySecret() {
  const key = process.env.PROJECT_DIARY_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key || key.length < 32) throw new Error('PROJECT_DIARY_CONFIG')
  return key
}
export function diaryLinkToken(id: string, nonce: string, key = diarySecret()) {
  if (!diaryUuid(id) || !diaryUuid(nonce)) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const payload = `${id}.${nonce}`
  return `${payload}.${createHmac('sha256', key).update(`HusHub:project-diary:v1:${payload}`).digest('base64url')}`
}
export function parseDiaryLink(token: string, key = diarySecret()) {
  const [id, nonce, signature, extra] = token.split('.')
  if (extra !== undefined || !diaryUuid(id) || !diaryUuid(nonce) || !/^[A-Za-z0-9_-]{43}$/.test(signature ?? '')) throw new Error('PROJECT_DIARY_NOT_FOUND')
  const expected = diaryLinkToken(id, nonce, key)
  if (Buffer.byteLength(expected) !== Buffer.byteLength(token) || !timingSafeEqual(Buffer.from(expected), Buffer.from(token))) throw new Error('PROJECT_DIARY_NOT_FOUND')
  return { id, nonce }
}
export const validDiaryDevice = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value)
export function diaryDeviceHash(token: string, device: string | undefined) {
  const { id, nonce } = parseDiaryLink(token)
  if (!validDiaryDevice(device)) throw new Error('PROJECT_DIARY_DEVICE')
  return createHmac('sha256', device).update(`HusHub:project-diary-device:v1:${id}:${nonce}`).digest('hex')
}
export function diaryCookie(token: string) { return `hh_diary_device_${parseDiaryLink(token).id.replaceAll('-', '')}` }
