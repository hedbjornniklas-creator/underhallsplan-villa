import type { TuAssignmentListItem, TuInspectionSummary } from './server'

export type TuOverviewInvestigation = TuInspectionSummary & { hasReadyPdf?: boolean }
export type TuOverviewFilter = 'all' | 'active' | 'closed'
export type TuOverviewSort = 'date-desc' | 'date-asc' | 'customer' | 'address'

export type TuOverviewItem = {
  id: string
  date: string | null
  updatedAt: string | null
  address: string
  city: string
  customer: string
  title: string
  confirmation: string
  investigationStatus: string
  investigationHref: string | null
  confirmationHref: string | null
  pdfHref: string | null
  startAssignment: TuAssignmentListItem | null
  attention: string[]
  archived: boolean
  closed: boolean
  searchText: string
}

const collator = new Intl.Collator('sv-SE', { sensitivity: 'base', numeric: true })
const text = (value: string | null | undefined) => value?.trim() || ''
const timestamp = (value: string | null) => value ? Date.parse(value) || 0 : 0

export function canStartTuOverviewAssignment(assignment: TuAssignmentListItem) {
  return assignment.status === 'ordered' && !assignment.inspection_id && !assignment.archived_at
}

function confirmationLabel(assignment: TuAssignmentListItem | null) {
  if (!assignment) return 'Utan bekräftelse'
  if (assignment.archived_at) return 'Arkiverad'
  if (assignment.status === 'cancelled') return 'Avbruten'
  if (assignment.status === 'expired') return 'Utgången länk'
  if (assignment.accepted_at || assignment.status === 'ordered') return 'Godkänd'
  if (assignment.status === 'booked') return 'Bokad'
  if (assignment.status === 'completed') return 'Utredning startad'
  if (assignment.status === 'sent') return 'Skickad'
  if (assignment.status === 'draft') return 'Utkast'
  return 'Okänd status'
}

function investigationLabel(investigation: TuOverviewInvestigation | null, linkedId: string | null) {
  if (!investigation) return linkedId ? 'Ej inläst' : 'Inte startad'
  if (investigation.reportLockedAt) return 'Låst'
  const status = investigation.status?.trim().toLowerCase()
  if (status === 'draft' || status === 'utkast') return 'Utkast'
  if (['completed', 'klar', 'done'].includes(status ?? '')) return 'Klar'
  return 'Pågående'
}

export function buildTuOverviewItems({ organizationId, assignments, investigations }: {
  organizationId: string
  assignments: TuAssignmentListItem[]
  investigations: TuOverviewInvestigation[]
}): TuOverviewItem[] {
  const scopedAssignments = assignments.filter(item => item.assignment_type === 'TU' && item.org_id === organizationId)
  const assignmentsById = new Map(scopedAssignments.map(item => [item.id, item]))
  const assignmentsByInspection = new Map(scopedAssignments.filter(item => item.inspection_id).map(item => [item.inspection_id, item]))
  const usedAssignments = new Set<string>()
  const url = (path: string) => `${path}?orgId=${encodeURIComponent(organizationId)}`

  function row(investigation: TuOverviewInvestigation | null, assignment: TuAssignmentListItem | null): TuOverviewItem {
    const inspectionId = investigation?.inspectionId || assignment?.inspection_id || null
    const address = text(investigation?.propertyAddress) || text(assignment?.property_address) || text(assignment?.preliminary_address)
    const city = text(investigation?.propertyCity) || text(assignment?.property_city)
    const customer = text(investigation?.customerName) || text(assignment?.customer_name) || text(investigation?.customerEmail) || text(assignment?.customer_email) || 'Kund saknas'
    const title = text(investigation?.title) || 'Teknisk utredning'
    const startAssignment = !inspectionId && assignment && canStartTuOverviewAssignment(assignment) ? assignment : null
    const attention = startAssignment ? ['Godkänt uppdrag att starta'] : []
    if (inspectionId && !investigation) attention.push('Utredningens status kunde inte läsas')
    const investigationStatus = investigationLabel(investigation, inspectionId)
    // Archiving a confirmation must not hide an investigation that is still in use.
    const archived = Boolean(assignment?.archived_at) && !inspectionId
    const closed = investigation
      ? ['Låst', 'Klar'].includes(investigationStatus)
      : !inspectionId && (archived || ['cancelled', 'expired'].includes(assignment?.status ?? ''))
    return {
      id: investigation ? `investigation:${investigation.inspectionId}` : `assignment:${assignment!.id}`,
      date: investigation?.date || assignment?.preferred_date || null,
      updatedAt: investigation?.updatedAt || investigation?.createdAt || assignment?.updated_at || assignment?.created_at || null,
      address: address || 'Adress saknas', city, customer, title,
      confirmation: confirmationLabel(assignment), investigationStatus,
      investigationHref: inspectionId ? url(`/tu/investigations/${encodeURIComponent(inspectionId)}`) : null,
      confirmationHref: assignment ? url(`/tu/assignments/${encodeURIComponent(assignment.id)}`) : null,
      pdfHref: investigation?.hasReadyPdf ? url(`/api/report-v2/${encodeURIComponent(investigation.inspectionId)}/pdf`) : null,
      startAssignment, attention, archived, closed,
      searchText: [address, city, customer, title, investigation?.assignmentNumber, investigation?.customerEmail,
        assignment?.customer_email, investigation?.cadastralId, assignment?.cadastral_id, investigation?.brfName,
        assignment?.brf_name, investigation?.apartmentNumber, assignment?.apartment_number,
        investigation?.scopeDescription, assignment?.scope_description].filter(Boolean).join(' ').toLocaleLowerCase('sv-SE'),
    }
  }

  const rows = investigations.map(investigation => {
    const assignment = (investigation.assignmentId ? assignmentsById.get(investigation.assignmentId) : null)
      ?? assignmentsByInspection.get(investigation.inspectionId) ?? null
    if (assignment) usedAssignments.add(assignment.id)
    return row(investigation, assignment)
  })
  for (const assignment of scopedAssignments) {
    if (!usedAssignments.has(assignment.id)) rows.push(row(null, assignment))
  }
  return rows
}

export function selectTuOverviewPage(items: TuOverviewItem[], options: {
  search: string; filter: TuOverviewFilter; sort: TuOverviewSort; attentionOnly: boolean
  showArchived: boolean; page: number; pageSize: number
}) {
  const words = options.search.trim().toLocaleLowerCase('sv-SE').split(/\s+/).filter(Boolean)
  const candidates = items.filter(item => (options.showArchived || !item.archived)
    && (!options.attentionOnly || item.attention.length > 0)
    && words.every(word => item.searchText.includes(word)))
  const counts = { all: candidates.length, active: candidates.filter(item => !item.closed).length, closed: candidates.filter(item => item.closed).length }
  const filtered = candidates.filter(item => options.filter === 'all' || (options.filter === 'closed' ? item.closed : !item.closed))
  filtered.sort((a, b) => {
    let comparison = 0
    if (options.sort === 'customer') comparison = collator.compare(a.customer, b.customer)
    else if (options.sort === 'address') comparison = collator.compare(a.address, b.address)
    else comparison = (timestamp(a.date || a.updatedAt) - timestamp(b.date || b.updatedAt)) * (options.sort === 'date-asc' ? 1 : -1)
    return comparison || collator.compare(a.id, b.id)
  })
  const pageSize = [10, 25, 50].includes(options.pageSize) ? options.pageSize : 10
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const page = Math.min(pages, Math.max(1, Math.trunc(options.page) || 1))
  const start = (page - 1) * pageSize
  return { items: filtered.slice(start, start + pageSize), total: filtered.length, counts, pages, page, start }
}
