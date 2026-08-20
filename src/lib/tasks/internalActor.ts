import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { TaskAttachmentActor } from './attachments'

export async function requireInternalTaskActor(input: {
  orgId: string
  userId: string
  isOrgAdmin: boolean
  taskId: string
}) {
  const admin = createSupabaseAdminClient()
  const [{ data: task, error: taskError }, { data: profile, error: profileError }] = await Promise.all([
    admin
      .from('operational_tasks')
      .select('id,issuer_profile_id,assignee_profile_id,status')
      .eq('id', input.taskId)
      .eq('org_id', input.orgId)
      .is('archived_at', null)
      .maybeSingle(),
    admin.from('profiles').select('full_name,email').eq('id', input.userId).maybeSingle(),
  ])
  if (taskError) throw new Error(taskError.message ?? 'TASK_READ_FAILED')
  if (profileError) throw new Error(profileError.message ?? 'TASK_PROFILE_READ_FAILED')
  if (!task) throw new Error('TASK_NOT_FOUND')
  if (['ready_for_review', 'approved', 'cancelled'].includes(String(task.status))) {
    throw new Error('TASK_ATTACHMENT_LOCKED')
  }
  if (
    !input.isOrgAdmin &&
    task.issuer_profile_id !== input.userId &&
    task.assignee_profile_id !== input.userId
  ) {
    throw new Error('TASK_ATTACHMENT_FORBIDDEN')
  }
  const actor: TaskAttachmentActor = {
    type: 'profile',
    profileId: input.userId,
    name: profile?.full_name?.trim() || profile?.email?.trim() || 'Intern användare',
  }
  return { task, actor }
}

export async function requireInternalTaskViewer(input: {
  orgId: string
  userId: string
  isOrgAdmin: boolean
  taskId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('operational_tasks')
    .select('id,parent_task_id,issuer_profile_id,assignee_profile_id')
    .eq('org_id', input.orgId)
    .is('archived_at', null)
  if (error) throw new Error('TASK_READ_FAILED')
  const rows = data ?? []
  const target = rows.find((row) => row.id === input.taskId)
  if (!target) throw new Error('TASK_NOT_FOUND')
  if (input.isOrgAdmin) return target

  const byId = new Map(rows.map((row) => [String(row.id), row]))
  const children = new Map<string, typeof rows>()
  for (const row of rows) {
    if (!row.parent_task_id) continue
    const list = children.get(String(row.parent_task_id)) ?? []
    list.push(row)
    children.set(String(row.parent_task_id), list)
  }
  const visible = new Set<string>()
  const addDescendants = (taskId: string) => {
    for (const child of children.get(taskId) ?? []) {
      if (visible.has(String(child.id))) continue
      visible.add(String(child.id))
      addDescendants(String(child.id))
    }
  }
  for (const row of rows) {
    if (row.issuer_profile_id !== input.userId && row.assignee_profile_id !== input.userId) continue
    visible.add(String(row.id))
    addDescendants(String(row.id))
    let ancestor = row.parent_task_id ? byId.get(String(row.parent_task_id)) : null
    while (ancestor) {
      visible.add(String(ancestor.id))
      ancestor = ancestor.parent_task_id ? byId.get(String(ancestor.parent_task_id)) : null
    }
  }
  if (!visible.has(input.taskId)) throw new Error('TASK_ATTACHMENT_FORBIDDEN')
  return target
}
