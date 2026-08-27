export const DEFAULT_TASK_TIME_ZONE = 'Europe/Stockholm'

export type TaskDateTimeInput = {
  date: string
  time: string
}

type ZonedDateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const DATE_INPUT_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_INPUT_PATTERN = /^(\d{2}):(\d{2})(?::(\d{2}))?$/

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat('sv-SE', { timeZone }).format(0)
    return true
  } catch {
    return false
  }
}

export function normalizeTaskTimeZone(timeZone?: string | null) {
  const normalized = timeZone?.trim()
  return normalized && isValidTimeZone(normalized)
    ? normalized
    : DEFAULT_TASK_TIME_ZONE
}

function zonedParts(value: Date | number, timeZone: string): ZonedDateTimeParts | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  )
  if (
    !Number.isInteger(values.year)
    || !Number.isInteger(values.month)
    || !Number.isInteger(values.day)
    || !Number.isInteger(values.hour)
    || !Number.isInteger(values.minute)
    || !Number.isInteger(values.second)
  ) return null

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  }
}

function parseTaskDateTimeInput(dateValue: string, timeValue: string): ZonedDateTimeParts | null {
  const dateMatch = DATE_INPUT_PATTERN.exec(dateValue)
  const timeMatch = TIME_INPUT_PATTERN.exec(timeValue)
  if (!dateMatch || !timeMatch) return null

  const parts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] ?? 0),
  }
  const validationDate = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  ))
  if (
    parts.year < 1
    || parts.hour > 23
    || parts.minute > 59
    || parts.second > 59
    || validationDate.getUTCFullYear() !== parts.year
    || validationDate.getUTCMonth() !== parts.month - 1
    || validationDate.getUTCDate() !== parts.day
  ) return null

  return parts
}

function sameParts(left: ZonedDateTimeParts | null, right: ZonedDateTimeParts) {
  return Boolean(
    left
    && left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second
  )
}

function zoneOffsetAt(epoch: number, timeZone: string) {
  const parts = zonedParts(epoch, timeZone)
  if (!parts) return null
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  ) - Math.floor(epoch / 1000) * 1000
}

/**
 * Converts a wall-clock date and time in an IANA zone to one UTC instant.
 * For the repeated hour when daylight saving time ends, the earlier instant
 * is selected. Non-existent local times return null.
 */
export function taskDateTimeInputToIso(
  dateValue: string,
  timeValue: string,
  timeZone?: string | null
) {
  const desired = parseTaskDateTimeInput(dateValue, timeValue)
  if (!desired) return null

  const zone = normalizeTaskTimeZone(timeZone)
  const wallClockAsUtc = Date.UTC(
    desired.year,
    desired.month - 1,
    desired.day,
    desired.hour,
    desired.minute,
    desired.second
  )
  const offsets = new Set<number>()
  for (const probe of [wallClockAsUtc - 36 * 60 * 60 * 1000, wallClockAsUtc, wallClockAsUtc + 36 * 60 * 60 * 1000]) {
    const offset = zoneOffsetAt(probe, zone)
    if (offset !== null) offsets.add(offset)
  }

  const candidates = [...offsets]
    .map((offset) => wallClockAsUtc - offset)
    .filter((candidate) => sameParts(zonedParts(candidate, zone), desired))
    .sort((left, right) => left - right)
  return candidates.length > 0 ? new Date(candidates[0]).toISOString() : null
}

export function taskIsoToDateTimeInput(
  value: string | number | Date,
  timeZone?: string | null
): TaskDateTimeInput | null {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = zonedParts(date, normalizeTaskTimeZone(timeZone))
  if (!parts) return null
  return {
    date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`,
  }
}

export function taskTodayDateInput(timeZone?: string | null) {
  return taskIsoToDateTimeInput(new Date(), timeZone)?.date ?? ''
}

export function addTaskDateInputDays(value: string, days: number) {
  const match = DATE_INPUT_PATTERN.exec(value)
  if (!match || !Number.isInteger(days)) return ''
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function formatTaskDateTime(
  value: string | number | Date,
  timeZone?: string | null,
  style: 'long' | 'compact' = 'long'
) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  const zone = normalizeTaskTimeZone(timeZone)
  if (style === 'compact') {
    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone,
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date)
  }
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: zone,
    dateStyle: 'long',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(date)
}

export function taskTimeZoneLabel(timeZone?: string | null) {
  const zone = normalizeTaskTimeZone(timeZone)
  return zone === 'Europe/Stockholm' ? 'svensk tid' : zone
}
