import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { AssignmentListItem } from '@/lib/assignments/server'
import type { TuAssignmentMessage, TuAssignmentProgress } from './assignmentProgress'

type LinkRow = { assignment_id: string; expires_at: string; used_at: string | null; revoked_at: string | null; created_at: string }
type ApprovalRow = { assignment_id: string; accepted_at: string }

// IDs must first be authorized as TU assignments in the selected organization.
export async function loadTuAssignmentProgress(orgId: string, assignments: Pick<AssignmentListItem, 'id' | 'accepted_at'>[]) {
  const result = new Map<string, TuAssignmentProgress>()
  const admin = createSupabaseAdminClient()
  for (let offset = 0; offset < assignments.length; offset += 100) {
    const batch = assignments.slice(offset, offset + 100)
    const ids = batch.map(item => item.id)
    const links: LinkRow[] = []
    const approvals: ApprovalRow[] = []
    let available = true
    // Supabase caps a response. Older assignments must not disappear behind a busy link history.
    for (const table of ['assignment_links', 'assignment_acceptances'] as const) {
      for (let from = 0; ; from += 500) {
        const response = await admin.from(table)
          .select(table === 'assignment_links' ? 'assignment_id,expires_at,used_at,revoked_at,created_at' : 'assignment_id,accepted_at')
          .eq('org_id', orgId).in('assignment_id', ids)
          .order(table === 'assignment_links' ? 'created_at' : 'accepted_at', { ascending: false })
          .order('id', { ascending: false }).range(from, from + 499)
        if (response.error) { available = false; console.error('[tu.assignments] progress unavailable', { orgId, table, error: response.error }); break }
        if (table === 'assignment_links') links.push(...((response.data ?? []) as unknown as LinkRow[]))
        else approvals.push(...((response.data ?? []) as unknown as ApprovalRow[]))
        if (!response.data || response.data.length < 500) break
      }
    }
    const workflows = await admin.from('tu_assignment_workflows').select('current_assignment_id')
      .eq('org_id', orgId).in('current_assignment_id', ids).range(0, 99)
    if (workflows.error) { available = false; console.error('[tu.assignments] workflow status unavailable', workflows.error) }
    for (const assignment of batch) {
      const link = links.find(item => item.assignment_id === assignment.id)
      result.set(assignment.id, {
        available,
        earlyStarted: workflows.data?.some(item => item.current_assignment_id === assignment.id) ?? false,
        approvalRecorded: approvals.some(item => item.assignment_id === assignment.id),
        approvalVerified: available && Boolean(assignment.accepted_at && approvals.some(item =>
          item.assignment_id === assignment.id && Date.parse(item.accepted_at) === Date.parse(assignment.accepted_at!))),
        linkState: !link ? 'missing' : link.used_at ? 'used' : link.revoked_at ? 'revoked'
          : Date.parse(link.expires_at) > Date.now() ? 'active' : 'expired',
        linkExpiresAt: link?.expires_at ?? null,
      })
    }
  }
  return result
}

export async function loadTuAssignmentMessages(orgId: string, assignmentId: string): Promise<TuAssignmentMessage[] | null> {
  const { data, error } = await createSupabaseAdminClient().from('outbound_messages')
    .select('id,created_at,sent_at,recipient_email,template_key,status')
    .eq('org_id', orgId).eq('assignment_id', assignmentId).order('created_at', { ascending: false }).limit(20)
  if (error) { console.error('[tu.assignments] messages unavailable', { assignmentId, error }); return null }
  return data ?? []
}
