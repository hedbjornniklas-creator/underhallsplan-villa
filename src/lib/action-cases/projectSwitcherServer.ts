import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { ProjectSwitchOption } from './projectSwitcher'

export async function getProjectSwitchOptions(ctx: { orgId: string }): Promise<ProjectSwitchOption[]> {
  const projects: ProjectSwitchOption[] = [], db = createSupabaseAdminClient()
  for (let offset = 0; ; offset += 500) {
    const result = await db.from('action_cases').select('id,title,status').eq('org_id', ctx.orgId)
      .order('title').order('id').range(offset, offset + 499)
    if (result.error) throw new Error('PROJECT_SWITCHER_READ_FAILED')
    projects.push(...result.data || [])
    if ((result.data?.length ?? 0) < 500) return projects
  }
}
