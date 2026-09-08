import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  abortActionCaseUpload,
  addActionCaseItem,
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
  updateActionCaseCostLine,
  applyActionCaseCostSuggestions,
} from '@/lib/action-cases/server'
import { generateActionCaseCosts } from '@/lib/action-cases/costingAiServer'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

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
  const aiErrors: Record<string, [number, string]> = {
    ACTION_CASE_AI_SCOPE_REQUIRED: [400, 'Spara arbetets omfattning innan du skapar ett kalkylförslag.'],
    ACTION_CASE_AI_SCOPE_TOO_LONG: [400, 'Underlaget är för stort. Avgränsa åtgärdens omfattning.'],
    ACTION_CASE_AI_STALE: [409, 'Omfattningen eller kalkylen har ändrats. Skapa ett nytt förslag.'],
    ACTION_CASE_AI_NOT_FOUND: [404, 'Förslaget finns inte längre. Uppdatera ärendet.'],
    ACTION_CASE_AI_NOT_CONFIGURED: [503, 'AI-tjänsten är inte konfigurerad för kalkyler ännu.'],
    ACTION_CASE_AI_TIMEOUT: [504, 'AI-förslaget tog för lång tid. Inga kalkylrader ändrades. Försök igen.'],
    ACTION_CASE_AI_RATE_LIMIT: [429, 'AI-tjänsten är upptagen. Vänta en stund och försök igen.'],
    ACTION_CASE_AI_INVALID: [502, 'AI kunde inte skapa ett användbart förslag. Inga kalkylrader ändrades. Försök igen.'],
    ACTION_CASE_AI_FAILED: [502, 'Kalkylförslaget kunde inte skapas. Försök igen.'],
    ACTION_CASE_AI_SAVE_FAILED: [500, 'AI-förslaget kunde inte sparas. Inga kalkylrader ändrades.'],
  }
  if (aiErrors[code]) return NextResponse.json({ error: aiErrors[code][1], code }, { status: aiErrors[code][0] })
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
    let itemId: string | undefined
    let upload: Awaited<ReturnType<typeof createActionCaseSignedUpload>> | undefined
    if (action === 'create_case') await createActionCase(ctx, payload)
    else if (action === 'update_item') await updateActionCaseItem(ctx, payload)
    else if (action === 'add_item') itemId = await addActionCaseItem(ctx, payload)
    else if (action === 'add_participant') await addActionCaseParticipant(ctx, payload)
    else if (action === 'create_signed_upload') upload = await createActionCaseSignedUpload(ctx, payload)
    else if (action === 'abort_upload') await abortActionCaseUpload(ctx, payload)
    else if (action === 'complete_upload') await completeActionCaseUpload(ctx, payload)
    else if (action === 'update_attachment_grants') await updateActionCaseAttachmentGrants(ctx, payload)
    else if (action === 'delete_attachment') await deleteActionCaseAttachment(ctx, payload)
    else if (action === 'issue_participant_link') accessUrl = await issueActionCaseParticipantLink(ctx, payload, new URL(request.url).origin)
    else if (action === 'create_cost_line') await createActionCaseCostLine(ctx, payload)
    else if (action === 'delete_cost_line') await deleteActionCaseCostLine(ctx, payload)
    else if (action === 'update_cost_line') await updateActionCaseCostLine(ctx, payload)
    else if (action === 'generate_cost_suggestions') await generateActionCaseCosts(ctx, payload)
    else if (action === 'apply_cost_suggestions') await applyActionCaseCostSuggestions(ctx, payload)
    else throw new Error('ACTION_CASE_ACTION_INVALID')
    return NextResponse.json({ workspace: await getActionCaseWorkspace(ctx), accessUrl, upload, itemId })
  } catch (error) { return errorResponse(error) }
}
