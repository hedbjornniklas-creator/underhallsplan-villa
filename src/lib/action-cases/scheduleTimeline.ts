import { scaleUtc } from 'd3-scale'
import { utcDay, utcMonday, utcMonth, utcYear } from 'd3-time'
import { utcFormat } from 'd3-time-format'
import type { ProjectScheduleRow } from './projectSchedule'

export type ScheduleScale = 'week' | 'month'
export function scheduleDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? date : null
}
export function scheduleDays(row: Pick<ProjectScheduleRow, 'startDate' | 'endDate'>) {
  const start = scheduleDate(row.startDate), end = scheduleDate(row.endDate)
  return start && end && +end >= +start ? utcDay.count(start, end) + 1 : null
}
export function scheduleDateLabel(value: string) {
  const date = scheduleDate(value)
  return date ? new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date) : '–'
}

// UTC calendar intervals keep date-only planning stable across DST and time zones.
export function scheduleTimeline(rows: ProjectScheduleRow[], mode: ScheduleScale) {
  const dates = rows.flatMap(row => [scheduleDate(row.startDate), scheduleDate(row.endDate)]).filter((date): date is Date => Boolean(date))
  if (!dates.length) return null
  const first = new Date(Math.min(...dates.map(Number))), last = new Date(Math.max(...dates.map(Number)))
  const years = utcYear.count(first, last)
  const interval = years > 10 ? utcYear.every(Math.max(1, Math.ceil(years / 80)))!
    : mode === 'month' ? utcMonth : utcMonday.every(Math.max(1, Math.ceil(utcDay.count(first, last) / (7 * 156))))!
  const start = interval.floor(first), end = interval.ceil(utcDay.offset(last, 1))
  const ticks = interval.range(start, end)
  const width = Math.max(640, ticks.length * (mode === 'month' || years > 10 ? 100 : 76))
  const scale = scaleUtc().domain([start, end]).range([0, 100]).clamp(true)
  const monthFormat = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const bandInterval = years > 5 ? utcYear.every(Math.max(1, Math.ceil(years / 60)))! : utcMonth
  const bandStarts = [start, ...bandInterval.range(bandInterval.ceil(start), end).filter(date => +date !== +start)]
  const bands = bandStarts.map((date, index) => ({
    label: years > 5 ? String(date.getUTCFullYear()) : monthFormat.format(date),
    left: scale(date), width: scale(bandStarts[index + 1] ?? end) - scale(date),
  }))
  return {
    width, start, end, scale, bands,
    ticks: ticks.map((date, index) => ({ date: date.toISOString(), left: scale(date), width: scale(ticks[index + 1] ?? end) - scale(date),
      label: years > 10 ? String(date.getUTCFullYear()) : mode === 'month' ? new Intl.DateTimeFormat('sv-SE', { month: 'short', timeZone: 'UTC' }).format(date) : `v ${utcFormat('%V')(date)}` })),
    bars: rows.map(row => {
      const from = scheduleDate(row.startDate), to = scheduleDate(row.endDate)
      if (from && to && +to >= +from) return { id: row.id, left: scale(from), width: scale(utcDay.offset(to, 1)) - scale(from), kind: 'range' as const }
      if (from && to) return { id: row.id, left: 0, width: 0, kind: 'invalid' as const }
      const date = from ?? to
      return { id: row.id, left: date ? scale(date) : 0, width: 0, kind: date ? 'partial' as const : 'unplanned' as const }
    }),
  }
}
