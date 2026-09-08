export const INTEREST_STATUSES = {
  new: 'Ny', contacted: 'Kontaktad', offered: 'Tillgång erbjuden', activated: 'Aktiverad', closed: 'Avslutad',
} as const
export type InterestStatus = keyof typeof INTEREST_STATUSES
export type TrackedInterest = {
  id: string; name: string; email: string; company: string; phone: string; message: string
  status: InterestStatus; owner_name: string; follow_up_on: string | null
  notification_state: 'pending' | 'accepted' | 'failed'
  created_at: string; updated_at: string; revision: number
}
export const TRACKING_PAGE_SIZE = 30
export function isInterestStatus(value: unknown): value is InterestStatus {
  return typeof value === 'string' && Object.hasOwn(INTEREST_STATUSES, value)
}
export function validateInterestUpdate(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const value = body as Record<string, unknown>
  if (typeof value.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) return null
  if (!isInterestStatus(value.status)) return null
  if (typeof value.owner_name !== 'string' || value.owner_name.length > 120 || /[\u0000-\u001f\u007f]/.test(value.owner_name)) return null
  if (typeof value.revision !== 'number' || !Number.isInteger(value.revision) || value.revision < 0 || value.revision >= 2147483647) return null
  if (value.follow_up_on !== null) {
    if (typeof value.follow_up_on !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.follow_up_on)) return null
    const parsed = new Date(`${value.follow_up_on}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value.follow_up_on) return null
  }
  return { id: value.id, status: value.status, owner_name: value.owner_name.trim(), follow_up_on: value.follow_up_on as string | null, revision: value.revision }
}
