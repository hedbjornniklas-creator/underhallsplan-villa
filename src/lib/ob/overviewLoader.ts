import type { SupabaseClient } from '@supabase/supabase-js'
import { buildObOverview, type OverviewAssignment, type OverviewInspection, type OverviewWorkflow } from './overview'

type Result = { data: unknown; error: { message: string } | null }
type Property = { id: string; address: string | null; city: string | null; client_name: string | null }
type Snapshot = { inspection_id: string; address: string | null; city: string | null; client_name: string | null }
type Workflow = Pick<OverviewWorkflow, 'inspection_id' | 'current_assignment_id' | 'initial_assignment_id'>
type Link = { id: string; assignment_id: string; expires_at: string; used_at: string | null; revoked_at: string | null }
type Acceptance = { id: string; assignment_id: string; accepted_at: string }
type Incident = { id: string; assignment_id: string }

export async function readOverviewPages<T>(page: (from: number, to: number) => PromiseLike<Result>): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 500) {
    const result = await page(offset, offset + 499)
    if (result.error) throw new Error(result.error.message)
    const data = result.data as T[] | null
    rows.push(...(data ?? []))
    if (!data || data.length < 500) return rows
  }
}

function chunks<T>(items: T[], size = 100) {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

// Assignments use the existing organization boundary. Inspections additionally retain
// the legacy list's property-owner boundary and the signed-in client's RLS policies.
export async function loadObOverview(input: {
  admin: SupabaseClient; userClient: SupabaseClient; orgId: string; userId: string; now?: number
}) {
  const { admin, userClient, orgId, userId } = input
  const now = input.now ?? Date.now()
  const assignments = await readOverviewPages<OverviewAssignment>((from, to) => admin.from('assignments')
    .select('id,inspection_id,status,customer_name,customer_email,property_address,preliminary_address,property_city,preferred_date,accepted_at,booked_at,archived_at,created_at')
    .eq('org_id', orgId).eq('assignment_type', 'OB').order('id').range(from, to))
  const properties = await readOverviewPages<Property>((from, to) => userClient.from('properties')
    .select('id,address,city,client_name').eq('owner', userId).order('id').range(from, to))
  const propertyMap = new Map(properties.map(property => [property.id, property]))
  const inspections: OverviewInspection[] = []
  for (const ids of chunks(properties.map(property => property.id))) {
    inspections.push(...await readOverviewPages<OverviewInspection>((from, to) => userClient.from('inspections')
      .select('id,property_id,status,date,created_at,assignment_number,customer_name,client_name')
      .eq('inspection_family', 'OB').in('property_id', ids).order('id').range(from, to)))
  }
  const snapshots: Snapshot[] = []
  for (const ids of chunks(inspections.map(inspection => inspection.id))) {
    snapshots.push(...await readOverviewPages<Snapshot>((from, to) => userClient.from('ob_property_snapshot')
      .select('inspection_id,address,city,client_name').in('inspection_id', ids).order('inspection_id').range(from, to)))
  }
  const snapshotMap = new Map(snapshots.map(snapshot => [snapshot.inspection_id, snapshot]))
  for (const inspection of inspections) {
    const property = propertyMap.get(inspection.property_id)
    const snapshot = snapshotMap.get(inspection.id)
    inspection.address = snapshot?.address ?? property?.address ?? null
    inspection.city = snapshot?.city ?? property?.city ?? null
    inspection.snapshot_customer = snapshot?.client_name ?? property?.client_name ?? null
  }
  const links: Link[] = [], acceptances: Acceptance[] = [], incidents: Incident[] = []
  for (const ids of chunks(assignments.map(assignment => assignment.id))) {
    links.push(...await readOverviewPages<Link>((from, to) => admin.from('assignment_links')
      .select('id,assignment_id,expires_at,used_at,revoked_at').in('assignment_id', ids).order('id').range(from, to)))
    acceptances.push(...await readOverviewPages<Acceptance>((from, to) => admin.from('assignment_acceptances')
      .select('id,assignment_id,accepted_at').in('assignment_id', ids).order('id').range(from, to)))
    incidents.push(...await readOverviewPages<Incident>((from, to) => admin.from('assignment_link_incidents')
      .select('id,assignment_id').eq('org_id', orgId).in('assignment_id', ids).is('resolved_at', null)
      .order('id').range(from, to)))
  }
  const activeLinks = new Set(links.filter(link => !link.used_at && !link.revoked_at && Date.parse(link.expires_at) > now)
    .map(link => link.assignment_id))
  const approvals = new Set(acceptances.map(acceptance => `${acceptance.assignment_id}:${Date.parse(acceptance.accepted_at)}`))
  const failures = new Set(incidents.map(incident => incident.assignment_id))
  for (const assignment of assignments) {
    assignment.activeLink = activeLinks.has(assignment.id)
    assignment.approvalVerified = Boolean(assignment.accepted_at &&
      approvals.has(`${assignment.id}:${Date.parse(assignment.accepted_at)}`))
    assignment.linkIssue = failures.has(assignment.id)
  }
  const workflowRows = await readOverviewPages<Workflow>((from, to) => admin.from('ob_assignment_workflows')
    .select('inspection_id,current_assignment_id,initial_assignment_id').eq('org_id', orgId).order('inspection_id').range(from, to))
  const assignmentIds = new Set(assignments.map(item => item.id))
  const inspectionIds = new Set(inspections.map(item => item.id))
  const workflows: OverviewWorkflow[] = []
  // Use the existing authoritative reconciliation logic, with bounded concurrency.
  for (const batch of chunks(workflowRows.filter(row => assignmentIds.has(row.current_assignment_id) || inspectionIds.has(row.inspection_id)), 4)) {
    workflows.push(...await Promise.all(batch.map(async row => {
      const result = await admin.rpc('ob_assignment_workflow_state', { p_inspection_id: row.inspection_id })
      if (result.error || !result.data) throw new Error('Kunde inte läsa aktuell uppdragsavstämning.')
      const state = result.data as { assignmentId: string; needsReview: boolean; paused: boolean; reason: string | null }
      // A reissue during the read must not produce a misleading mixed-version row.
      if (state.assignmentId !== row.current_assignment_id) throw new Error('Uppdraget ändrades medan listan lästes. Försök igen.')
      return { ...row, needsReview: state.needsReview, paused: state.paused, reason: state.reason }
    })))
  }
  return buildObOverview(assignments, inspections, workflows)
}
