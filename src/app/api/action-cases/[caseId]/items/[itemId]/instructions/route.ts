import { NextResponse } from 'next/server'
import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { getWorkInstructions, getWorkInstructionHistory, saveWorkInstructions, uploadWorkInstructionFile } from '@/lib/action-cases/workInstructionsServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ caseId: string; itemId: string }> }
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
function failure(error: unknown) {
  const code = error instanceof Error ? error.message : ''
  const errors: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Logga in för att öppna instruktionerna.'], MODULE_ACCESS_REQUIRED: [403, 'Du saknar åtkomst till Gizmo.'],
    WORK_INSTRUCTIONS_FORBIDDEN: [403, 'Du saknar behörighet till instruktionerna.'], WORK_INSTRUCTIONS_NOT_FOUND: [404, 'Momentet kunde inte hittas.'],
    WORK_INSTRUCTIONS_INVALID: [400, 'Kontrollera instruktionstexten och valda filer.'], WORK_INSTRUCTIONS_FILES: [409, 'En vald fil är inte tillgänglig för momentet. Dina ändringar finns kvar.'],
    WORK_INSTRUCTIONS_STALE: [409, 'Instruktionerna har ändrats i en annan flik. Din text finns kvar. Hämta den sparade versionen innan du fortsätter.'],
    WORK_INSTRUCTIONS_REQUEST_CONFLICT: [409, 'Sparningen gäller andra uppgifter. Hämta den sparade versionen innan du fortsätter.'],
    WORK_INSTRUCTIONS_SCHEMA: [503, 'Instruktioner behöver aktiveras i databasen. Övriga momentet påverkas inte.'], WORK_INSTRUCTIONS_CLOSED: [409, 'Projektet är avslutat eller avbrutet. Instruktionerna är skrivskyddade.'],
    ACTION_CASE_FILE_TOO_LARGE: [400, 'Välj en fil, högst 25 MB.'], ACTION_CASE_FILE_INVALID: [400, 'Välj en bild, PDF, Word-, Excel- eller textfil.'],
  }
  const [status, message] = errors[code] || [500, 'Åtgärden kunde inte bekräftas. Dina uppgifter finns kvar. Försök igen med samma uppgifter.']
  return json({ error: message, code: errors[code] ? code : 'WORK_INSTRUCTIONS_FAILED' }, status)
}
async function body(request: Request) {
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) throw new Error('WORK_INSTRUCTIONS_FORBIDDEN')
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []
  let size = 0
  if (!reader) throw new Error('WORK_INSTRUCTIONS_INVALID')
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 100000) { await reader.cancel(); throw new Error('WORK_INSTRUCTIONS_INVALID') } chunks.push(part.value) }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    return value as Record<string, unknown>
  } catch { throw new Error('WORK_INSTRUCTIONS_INVALID') }
}
export async function GET(request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), { caseId, itemId } = await route.params, search = new URL(request.url).searchParams
    return json(search.has('history') ? await getWorkInstructionHistory(ctx, caseId, itemId, search.get('before')) : await getWorkInstructions(ctx, caseId, itemId))
  } catch (error) { return failure(error) }
}
export async function POST(request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), { caseId, itemId } = await route.params, data = await body(request)
    if (data.operation === 'prepare' || data.operation === 'complete') return json(await uploadWorkInstructionFile(ctx, caseId, itemId, data))
    return json(await saveWorkInstructions(ctx, caseId, itemId, data))
  } catch (error) { return failure(error) }
}
