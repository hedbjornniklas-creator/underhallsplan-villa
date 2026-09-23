export type OverviewAssignment = {
  id: string
  inspection_id: string | null
  status: string
  customer_name: string | null
  customer_email: string
  property_address: string | null
  preliminary_address: string | null
  property_city: string | null
  preferred_date: string | null
  accepted_at: string | null
  booked_at: string | null
  archived_at: string | null
  created_at: string
  approvalVerified: boolean
  activeLink: boolean
  linkIssue: boolean
}

export type OverviewInspection = {
  id: string
  property_id: string
  status: string | null
  date: string | null
  created_at: string
  assignment_number: string | null
  customer_name: string | null
  client_name: string | null
  address: string | null
  city: string | null
  snapshot_customer: string | null
}

export type OverviewWorkflow = {
  inspection_id: string
  current_assignment_id: string
  initial_assignment_id: string
  needsReview: boolean
  paused: boolean
  reason: string | null
}

export type ObOverviewItem = {
  id: string
  date: string | null
  createdAt: string
  address: string
  city: string
  customer: string
  assignmentNumber: string
  confirmation: string
  inspection: string
  confirmationHref: string | null
  inspectionHref: string | null
  confirmationAction: string
  attention: string[]
  closed: boolean
  archived: boolean
  marker: 'attention' | 'active' | 'closed' | 'neutral'
}

function first(...values: (string | null | undefined)[]) {
  return values.find(value => value?.trim())?.trim() ?? ''
}

function inspectionState(status: string | null) {
  switch (status?.trim().toLowerCase()) {
    case 'draft': case 'utkast': return { label: 'Utkast', closed: false, known: true }
    case 'ongoing': case 'in_progress': case 'pågående': case 'pågår':
      return { label: 'Pågår', closed: false, known: true }
    case 'completed': case 'done': case 'klar':
      return { label: 'Klar', closed: true, known: true }
    case 'archived': case 'arkiverad':
      return { label: 'Arkiverad', closed: true, known: true }
    default: return { label: 'Status saknas', closed: false, known: false }
  }
}

function makeItem(
  assignment: OverviewAssignment | undefined,
  inspection: OverviewInspection | undefined,
  workflow: OverviewWorkflow | undefined,
): ObOverviewItem {
  const attention: string[] = []
  let confirmation = assignment ? 'Okänd status' : 'Ingen kopplad'
  let confirmationAction = 'Öppna bekräftelse'
  if (assignment) {
    if (assignment.status === 'cancelled') confirmation = 'Avbokad'
    else if (assignment.status === 'expired') {
      confirmation = 'Länken har gått ut'
      attention.push('Förnya uppdragsbekräftelsen')
    } else if (assignment.status === 'draft') {
      confirmation = 'Utkast'
      attention.push('Färdigställ uppdragsbekräftelsen')
    } else if (assignment.accepted_at && assignment.approvalVerified) {
      if (assignment.booked_at && ['booked', 'completed'].includes(assignment.status)) {
        confirmation = 'Godkänd och accepterad'
        if (!inspection && !assignment.inspection_id && !workflow) confirmationAction = 'Starta besiktning'
      } else {
        confirmation = 'Godkänd av kund'
        attention.push('Acceptera uppdraget')
        confirmationAction = 'Acceptera uppdrag'
      }
    } else if (assignment.status === 'sent' && !assignment.accepted_at) {
      confirmation = assignment.activeLink ? 'Inväntar kund' : 'Länk behöver förnyas'
      if (!assignment.activeLink) attention.push('Förnya godkännandelänken')
    } else {
      confirmation = 'Godkännande behöver kontrolleras'
      attention.push('Kontrollera uppdragsbekräftelsen')
    }
    if (assignment.linkIssue) attention.push('Tekniskt fel i kundens länk')
    if (assignment.archived_at) confirmation = `Arkiverad · ${confirmation}`
  } else if (workflow) {
    confirmation = 'Bekräftelse ej tillgänglig'
    attention.push('Kontrollera aktuell uppdragsbekräftelse')
  }

  const state = inspection ? inspectionState(inspection.status) : null
  if (state && !state.known) attention.push('Kontrollera besiktningens status')
  if (workflow?.paused) attention.push(workflow.reason || 'Uppdragsbekräftelsen behöver uppdateras')
  else if (workflow?.needsReview && assignment?.approvalVerified && assignment.booked_at) {
    attention.push('Stäm av kundens uppgifter i besiktningen')
  }
  const linkedButUnavailable = !inspection && Boolean(assignment?.inspection_id || workflow)
  // A converted confirmation is not evidence that the inspection is finished.
  const closed = state?.closed ?? (!linkedButUnavailable && assignment?.status === 'cancelled')
  const archived = inspection
    ? ['archived', 'arkiverad'].includes(inspection.status?.toLowerCase() ?? '')
    : Boolean(assignment?.archived_at)
  return {
    id: inspection ? `inspection:${inspection.id}` : `assignment:${assignment!.id}`,
    date: first(inspection?.date, assignment?.preferred_date) || null,
    createdAt: inspection?.created_at ?? assignment!.created_at,
    address: first(inspection?.address, assignment?.property_address, assignment?.preliminary_address) || 'Adress saknas',
    city: first(inspection?.city, assignment?.property_city),
    customer: first(inspection?.customer_name, inspection?.client_name, inspection?.snapshot_customer,
      assignment?.customer_name, assignment?.customer_email) || 'Kund saknas',
    assignmentNumber: first(inspection?.assignment_number),
    confirmation,
    inspection: state?.label ?? (linkedButUnavailable ? 'Ej tillgänglig' : 'Ej startad'),
    confirmationHref: assignment ? `/ob/assignments/${assignment.id}` : null,
    inspectionHref: inspection ? `/properties/${inspection.property_id}/ob/${inspection.id}` : null,
    confirmationAction,
    attention: archived ? [] : [...new Set(attention)],
    closed: closed || archived,
    archived,
    marker: archived ? 'closed' : attention.length ? 'attention' : closed ? 'closed' : inspection ? 'active' : 'neutral',
  }
}

export function buildObOverview(
  assignments: OverviewAssignment[], inspections: OverviewInspection[], workflows: OverviewWorkflow[],
): ObOverviewItem[] {
  const assignmentMap = new Map(assignments.map(item => [item.id, item]))
  const inspectionMap = new Map(inspections.map(item => [item.id, item]))
  const workflowMap = new Map(workflows.map(item => [item.inspection_id, item]))
  const linked = new Map<string, OverviewAssignment[]>()
  for (const assignment of assignments) {
    if (assignment.inspection_id) {
      const group = linked.get(assignment.inspection_id) ?? []
      group.push(assignment)
      linked.set(assignment.inspection_id, group)
    }
  }
  const consumed = new Set<string>()
  const rows: ObOverviewItem[] = []
  // Workflow pointers, not dates/addresses, determine the current confirmation after reissue.
  for (const workflow of workflows) {
    const current = assignmentMap.get(workflow.current_assignment_id)
    const inspection = inspectionMap.get(workflow.inspection_id)
    for (const id of [workflow.initial_assignment_id, workflow.current_assignment_id,
      ...(linked.get(workflow.inspection_id) ?? []).map(item => item.id)]) consumed.add(id)
    if (current || inspection) rows.push(makeItem(current, inspection, workflow))
  }
  for (const inspection of inspections) {
    if (workflowMap.has(inspection.id)) continue
    const candidates = linked.get(inspection.id) ?? []
    // Do not silently discard an ambiguous linkage: keep the extra confirmations visible.
    const assignment = candidates.length === 1 ? candidates[0] : undefined
    if (assignment) consumed.add(assignment.id)
    rows.push(makeItem(assignment, inspection, undefined))
  }
  for (const assignment of assignments) {
    if (!consumed.has(assignment.id)) rows.push(makeItem(assignment, undefined, undefined))
  }
  return rows
}

export type OverviewFilter = 'all' | 'active' | 'closed'
export type OverviewSort = 'date-desc' | 'date-asc' | 'customer' | 'address'

export function selectObOverview(items: ObOverviewItem[], options: {
  search: string; filter: OverviewFilter; attentionOnly: boolean; showArchived: boolean; sort: OverviewSort
}) {
  const words = options.search.trim().toLocaleLowerCase('sv-SE').split(/\s+/).filter(Boolean)
  return items.filter(item => {
    if (!options.showArchived && item.archived) return false
    if (options.filter === 'active' && item.closed) return false
    if (options.filter === 'closed' && !item.closed) return false
    if (options.attentionOnly && item.attention.length === 0) return false
    const text = `${item.address} ${item.city} ${item.customer} ${item.assignmentNumber}`.toLocaleLowerCase('sv-SE')
    return words.every(word => text.includes(word))
  }).sort((a, b) => {
    if (options.sort === 'customer' || options.sort === 'address') {
      return a[options.sort].localeCompare(b[options.sort], 'sv-SE') || a.id.localeCompare(b.id)
    }
    if (!a.date !== !b.date) return a.date ? -1 : 1
    const order = (a.date ?? a.createdAt).localeCompare(b.date ?? b.createdAt)
    return (options.sort === 'date-asc' ? order : -order) || a.id.localeCompare(b.id)
  })
}
