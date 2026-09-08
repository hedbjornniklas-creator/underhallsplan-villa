import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  abortActionCaseUpload,
  addActionCaseParticipant,
  completeActionCaseUpload,
  createActionCase,
  createActionCaseCostLine,
  createActionCaseSignedUpload,
  deleteActionCaseAttachment,
  getActionCaseWorkspace,
  issueActionCaseParticipantLink,
  deleteActionCaseCostLine,
  updateActionCaseAttachmentGrants,
  updateActionCaseItem,
} from '@/lib/action-cases/server'

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
  if (code === 'ACTION_CASE_PARTICIPANT_INVALID') return NextResponse.json({ error: 'Ange namn och e-post eller telefon för underentreprenören.', code }, { status: 400 })
  if (code === 'ACTION_CASE_FILE_TOO_LARGE') return NextResponse.json({ error: 'Filen är för stor. Maximal storlek är 25 MB.', code }, { status: 400 })
  if (code === 'ACTION_CASE_FILE_INVALID') return NextResponse.json({ error: 'Filtypen stöds inte eller filuppgifterna är ogiltiga.', code }, { status: 400 })
  if (code === 'ACTION_CASE_FILE_UPLOAD_INCOMPLETE') return NextResponse.json({ error: 'Uppladdningen blev inte komplett. Försök igen.', code }, { status: 409 })
  if (code === 'ACTION_CASE_NOT_FOUND') return NextResponse.json({ error: 'Åtgärdsärendet kunde inte hittas.', code }, { status: 404 })
  if (code === 'ACTION_CASE_FILE_NOT_FOUND') return NextResponse.json({ error: 'Filen kunde inte hittas.', code }, { status: 404 })
  if (code === 'ACTION_CASE_COST_LINE_INVALID') return NextResponse.json({ error: 'Kontrollera kalkylradens beskrivning, mängd, pris och påslag.', code }, { status: 400 })
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
    let accessUrl: string | undefined
    let upload: Awaited<ReturnType<typeof createActionCaseSignedUpload>> | undefined
    if (action === 'create_case') await createActionCase(ctx, payload)
    else if (action === 'update_item') await updateActionCaseItem(ctx, payload)
    else if (action === 'add_participant') await addActionCaseParticipant(ctx, payload)
    else if (action === 'create_signed_upload') upload = await createActionCaseSignedUpload(ctx, payload)
    else if (action === 'abort_upload') await abortActionCaseUpload(ctx, payload)
    else if (action === 'complete_upload') await completeActionCaseUpload(ctx, payload)
    else if (action === 'update_attachment_grants') await updateActionCaseAttachmentGrants(ctx, payload)
    else if (action === 'delete_attachment') await deleteActionCaseAttachment(ctx, payload)
    else if (action === 'issue_participant_link') accessUrl = await issueActionCaseParticipantLink(ctx, payload, new URL(request.url).origin)
    else if (action === 'create_cost_line') await createActionCaseCostLine(ctx, payload)
    else if (action === 'delete_cost_line') await deleteActionCaseCostLine(ctx, payload)
    else throw new Error('ACTION_CASE_ACTION_INVALID')
    return NextResponse.json({ workspace: await getActionCaseWorkspace(ctx), accessUrl, upload })
  } catch (error) { return errorResponse(error) }
}
