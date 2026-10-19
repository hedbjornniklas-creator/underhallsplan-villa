import 'server-only'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

type Context = { orgId: string; userId: string }
type ProjectNameRow = { id: string; title: string; updated_at: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function renameActionCase(ctx: Context, caseId: string, payload: Record<string, unknown>) {
  const title = typeof payload.title === 'string' ? payload.title.trim() : ''
  if (!uuid.test(caseId) || !title || title.length > 250 || /[\u0000-\u001f\u007f]/.test(title) || typeof payload.expectedTitle !== 'string' || !payload.expectedTitle.trim() || payload.expectedTitle.length > 10000)
    throw new Error('PROJECT_NAME_INVALID')
  const db = createSupabaseAdminClient()
  const read = async (): Promise<ProjectNameRow> => {
    const result = await db.from('action_cases').select('id,title,updated_at').eq('org_id', ctx.orgId).eq('id', caseId).maybeSingle()
    if (result.error) throw new Error('PROJECT_NAME_FAILED')
    if (!result.data) throw new Error('PROJECT_NAME_NOT_FOUND')
    return result.data
  }
  const view = (row: ProjectNameRow) => ({ id: row.id, title: row.title, updatedAt: row.updated_at })
  const current = await read()
  // Identical retries must also succeed after an uncertain response to a committed save.
  if (current.title === title) return view(current)
  if (current.title !== payload.expectedTitle) throw new Error('PROJECT_NAME_STALE')
  // Update the name only. Database timestamps are maintained by the existing trigger.
  const result = await db.from('action_cases').update({ title }).eq('org_id', ctx.orgId).eq('id', caseId)
    .eq('title', payload.expectedTitle).select('id,title,updated_at').maybeSingle()
  if (result.error) throw new Error('PROJECT_NAME_FAILED')
  if (result.data) return view(result.data)
  const latest = await read()
  if (latest.title === title) return view(latest)
  throw new Error('PROJECT_NAME_STALE')
}
