export const DIARY_MAX_PHOTOS = 8
export const DIARY_MAX_PHOTO_BYTES = 8 * 1024 * 1024
export const DIARY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export type DiaryBody = { name: string; company: string; workDate: string; startTime: string; endTime: string; breakMinutes: number; text: string; itemId: string | null }
export type DiaryPhoto = { id: string; name: string; contentType: string; size: number; sha256: string }
export type DiaryCorrection = { id: string; text: string; actorName: string; createdAt: string }
export type DiaryEntry = { id: string; body: DiaryBody; itemTitle: string; authorEmail: string; actorMethod: 'internal_login' | 'email_code'; receivedAt: string; emailVerifiedAt: string | null; minutes: number; photos: DiaryPhoto[]; corrections: DiaryCorrection[] }
export type DiaryProject = { id: string; title: string }
export type DiarySession = { id: string; email: string; name: string; company: string; expiresAt: string }
export type DiaryPublicState = { project: DiaryProject; session: DiarySession | null; items: { id: string; title: string }[] }
export type DiaryWorkspace = { project: DiaryProject; canManage: boolean; managerAssigned: boolean; link: { active: boolean; revision: number; url: string | null; qrDataUrl: string | null }; entries: DiaryEntry[]; hasMore: boolean; items: { id: string; title: string }[]; authorId: string; authorName: string; authorEmail: string }
export const diaryUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
function invalid(): never { throw new Error('PROJECT_DIARY_INVALID') }
export const diaryToday = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
export function diaryEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (email.length > 254 || !/^[^\s@\x00-\x1f<>]+@[^\s@\x00-\x1f<>]+\.[^\s@\x00-\x1f<>]+$/.test(email)) invalid()
  return email
}
export function diaryText(value: unknown, max: number, required = true) {
  if (typeof value !== 'string' || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) invalid()
  const text = value.trim()
  if (required && !text) invalid()
  return text
}
export function diaryDate(value: unknown) {
  if (typeof value !== 'string' || !/^20\d\d-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) invalid()
  return value
}
export function diaryMinutes(body: Pick<DiaryBody, 'startTime' | 'endTime' | 'breakMinutes'>) {
  const minute = (time: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) : invalid()
  const span = minute(body.endTime) - minute(body.startTime)
  if (!Number.isInteger(body.breakMinutes) || body.breakMinutes < 0 || span <= 0 || body.breakMinutes >= span) invalid()
  return span - body.breakMinutes
}
export function normalizeDiaryBody(input: unknown, today = diaryToday()): DiaryBody {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid()
  const b = input as Record<string, unknown>
  const allowed = ['name', 'company', 'workDate', 'startTime', 'endTime', 'breakMinutes', 'text', 'itemId']
  if (Object.keys(b).some(key => !allowed.includes(key))) invalid()
  const body: DiaryBody = { name: diaryText(b.name, 160), company: diaryText(b.company, 160), workDate: diaryDate(b.workDate), startTime: diaryText(b.startTime, 5), endTime: diaryText(b.endTime, 5), breakMinutes: Number.isInteger(b.breakMinutes) ? b.breakMinutes as number : invalid(), text: diaryText(b.text, 6000), itemId: b.itemId === null ? null : diaryUuid(b.itemId) ? b.itemId.toLowerCase() : invalid() }
  if (body.workDate > today) invalid()
  diaryMinutes(body)
  return body
}
export function diaryEntryRequest(input: Record<string, unknown>, today = diaryToday()) {
  if (!diaryUuid(input.requestId) || !Array.isArray(input.photoIds) || input.photoIds.length > DIARY_MAX_PHOTOS || input.photoIds.some(id => !diaryUuid(id)) || new Set(input.photoIds).size !== input.photoIds.length) invalid()
  return { requestId: input.requestId.toLowerCase(), body: normalizeDiaryBody(input.body, today), photoIds: input.photoIds.map(id => String(id).toLowerCase()) }
}
export function diaryPhotoRequest(input: Record<string, unknown>) {
  if (!diaryUuid(input.id) || !DIARY_IMAGE_TYPES.includes(input.contentType as typeof DIARY_IMAGE_TYPES[number]) || !Number.isInteger(input.size) || Number(input.size) <= 0 || Number(input.size) > DIARY_MAX_PHOTO_BYTES) throw new Error('PROJECT_DIARY_PHOTO')
  return { id: input.id.toLowerCase(), name: diaryText(input.name, 250).replace(/[\r\n/\\]/g, '_'), contentType: input.contentType as string, size: Number(input.size) }
}
export function emptyDiaryBody(name = '', company = ''): DiaryBody {
  return { name, company, workDate: diaryToday(), startTime: '', endTime: '', breakMinutes: 0, text: '', itemId: null }
}
export const diaryDuration = (minutes: number) => `${Math.floor(minutes / 60)} tim ${minutes % 60} min`
