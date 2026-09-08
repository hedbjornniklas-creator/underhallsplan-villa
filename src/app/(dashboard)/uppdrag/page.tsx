import { redirect } from 'next/navigation'
import TaskDashboardClient from '@/components/tasks/TaskDashboardClient'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getTaskWorkspace } from '@/lib/tasks/server'
import type { TaskWorkspace } from '@/lib/tasks/contracts'
import { getActionCaseWorkspace } from '@/lib/action-cases/server'
import type { ActionCaseWorkspace } from '@/lib/action-cases/contracts'

export const dynamic = 'force-dynamic'

export default async function TasksPage() {
  let initialWorkspace: TaskWorkspace | null = null
  let initialError: string | null = null
  let initialActionCases: ActionCaseWorkspace | null = null
  let initialActionCasesError: string | null = null

  try {
    const context = await requireOrgContext()
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'tasks',
      scopeType: 'organization',
      scopeId: context.orgId,
    })
    initialWorkspace = await getTaskWorkspace({
      orgId: context.orgId,
      userId: context.userId,
      isOrgAdmin: context.role === 'admin',
    })
    try {
      initialActionCases = await getActionCaseWorkspace({ orgId: context.orgId, userId: context.userId })
    } catch (error) {
      initialActionCasesError = error instanceof Error && error.message === 'ACTION_CASES_SCHEMA_REQUIRED'
        ? 'Kör databasmigrationen för åtgärdsärenden för att aktivera vyn.'
        : 'Kunde inte läsa åtgärdsärendena just nu.'
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect('/login')
    initialError = message === 'TASKS_SCHEMA_REQUIRED'
      ? 'Uppdrag-modulens databasmigration behöver köras innan sidan kan användas.'
      : 'Kunde inte läsa uppgifterna just nu.'
  }

  return <TaskDashboardClient initialWorkspace={initialWorkspace} initialError={initialError} initialActionCases={initialActionCases} initialActionCasesError={initialActionCasesError} />
}
