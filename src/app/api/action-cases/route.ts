import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createActionCase, getActionCaseWorkspace, updateActionCaseItem } from '@/lib/action-cases/server'

export const dynamic = 'force-dynamic'

async function context() {
  const org = await requireOrgContext()
  await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: org.orgId })
  return { orgId: org.orgId, userId: org.userId }
}

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'ACTION_CASE_UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Inte inloggad.', code }, { status: 401 })
  if (code === 'MODULE_ACCESS_REQUIRED') return NextResponse.json({ error: 'Du saknar behörighet till Uppdrag.', code }, { status: 403 })
  if (code === 'ACTION_CASE_REQUIRED_FIELDS') return NextResponse.json({ error: 'Fyll i titel, beställare och objektadress.', code }, { status: 400 })
  if (code === 'ACTION_CASE_ITEM_REQUIRED') return NextResponse.json({ error: 'Lägg till minst en åtgärd.', code }, { status: 400 })
  if (code === 'ACTION_CASES_SCHEMA_REQUIRED') return NextResponse.json({ error: 'Databasmigrationen för åtgärdsärenden behöver köras.', code }, { status: 503 })
  return NextResponse.json({ error: 'Åtgärdsärendet kunde inte hanteras just nu.', code }, { status: 500 })
}

export async function GET() {
  try { return NextResponse.json({ workspace: await getActionCaseWorkspace(await context()) }) }
  catch (error) { return errorResponse(error) }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload = body.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {}
    const ctx = await context()
    if (action === 'create_case') await createActionCase(ctx, payload)
    else if (action === 'update_item') await updateActionCaseItem(ctx, payload)
    else throw new Error('ACTION_CASE_ACTION_INVALID')
    return NextResponse.json({ workspace: await getActionCaseWorkspace(ctx) })
  } catch (error) { return errorResponse(error) }
}
