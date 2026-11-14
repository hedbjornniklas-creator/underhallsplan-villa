export type ObDeliveryEvent = {
  id: string
  type: 'published' | 'sent' | 'pdf_ready' | 'unlocked' | 'locked' | 'completed'
  occurred_at: string
  actor_name: string | null
  recipient_email: string | null
  status: string | null
  detail: string | null
  report_id: string | null
  version: number | null
  report_active: boolean | null
}

export type ObDeliveryOverview = {
  publishedAt: string | null
  reportId: string | null
  version: number | null
  lockedAt: string | null
  lastSentAt: string | null
  lastRecipients: string[]
  historyIncomplete: boolean
}

export type ObDeliveryTimeline = {
  entries: ObDeliveryEvent[]
  nextCursor: string | null
  overview: ObDeliveryOverview
}

export function formatObDeliveryDate(value: string | null | undefined, seconds = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return '-'
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) }).format(new Date(value))
}

export function obDeliveryEventTitle(event: ObDeliveryEvent) {
  switch (event.type) {
    case 'published': return 'Publicerade utlåtande'
    case 'sent': return event.status === 'sent' ? 'Skickade utlåtande' : event.status === 'failed' ? 'Misslyckat utskick' : 'Utskick registrerat, resultat inväntas'
    case 'pdf_ready': return 'PDF färdig'
    case 'unlocked': return 'Låste upp för ändringar'
    case 'locked': return 'Låste besiktningen'
    case 'completed': return 'Klarmarkerade besiktningen'
  }
}

export function obReportVersionPdfHref(inspectionId: string, reportId: string, orgId?: string) {
  const query = new URLSearchParams({ report: reportId, archive: '1' })
  if (orgId) query.set('orgId', orgId)
  return `/api/ob/inspections/${encodeURIComponent(inspectionId)}/published-report?${query}`
}

export function mergeObDeliveryEvents(current: ObDeliveryEvent[], older: ObDeliveryEvent[]) {
  return [...new Map([...current, ...older].map(event => [event.id, event])).values()]
    .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
}
