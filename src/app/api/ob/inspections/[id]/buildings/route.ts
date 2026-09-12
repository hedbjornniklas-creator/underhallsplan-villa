import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { obWorkflowRpc } from '@/lib/ob/assignmentWorkflowServer'
import { roundFloorKeys, roundMutationError, roundMutationRpcOperation } from '@/lib/ob/roundMutationServer'
import { isBuildingId, validateBuildingCommand } from '@/lib/ob/buildingCommands'
import { EMPTY_BUILDING_OVERVIEW } from '@/lib/ob/buildingStructure'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const errors: Record<string, string> = {
  OB_BUILDING_DISABLED: 'Byggnadsstödet är inte aktiverat ännu.',
  OB_BUILDING_NOT_ACTIVE: 'Byggnadsindelningen behöver bekräftas först.',
  OB_BUILDING_CLIENT_REQUIRED: 'Denna vy kan inte spara i en besiktning med byggnadsindelning. Öppna den nya rundan.',
  OB_BUILDING_REQUIRED: 'Välj byggnad innan du sparar.',
  OB_BUILDING_PRIMARY: 'Huvudbyggnaden kan inte tas bort.',
  OB_BUILDING_NOT_EMPTY: 'Byggnaden innehåller uppgifter och kan inte tas bort.',
  OB_BUILDING_REPORT_STALE: 'Underlaget har ändrats. Granska och skapa rapporten igen.',
}
async function handle(request: Request, context: Context) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    if (!isBuildingId(id)) throw new SyntaxError()
    const args = { p_inspection_id: id, p_org_id: org.orgId, p_actor: org.userId }
    if (request.method === 'GET') {
      const admin = createSupabaseAdminClient()
      const { data: inspection, error: accessError } = await admin.from('inspections').select('id,properties!inner(owner)').eq('id', id).maybeSingle()
      if (accessError || !inspection || (inspection as unknown as { properties: { owner: string } }).properties.owner !== org.userId) throw Error('OB_ROUND_FORBIDDEN')
      const { data, error } = await admin.rpc('ob_building_get' as never, args as never)
      if (error) {
        if (error.code === 'PGRST202' || error.code === '42883') {
          const check = await admin.from('ob_inspection_structure' as never).select('inspection_id').eq('inspection_id', id).maybeSingle()
          if ((!check.error && !check.data) || check.error && ['PGRST205','42P01'].includes(check.error.code))
            return NextResponse.json({ data: EMPTY_BUILDING_OVERVIEW }, { headers: { 'Cache-Control': 'no-store' } })
        }
        throw Error(error.message)
      }
      return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const raw = await request.text()
    if (raw.length > 150000) return NextResponse.json({ error: 'För mycket data i anropet.' }, { status: 413 })
    const body: unknown = JSON.parse(raw)
    if (!validateBuildingCommand(id, body)) throw new SyntaxError()
    let data: unknown
    if (body.operation === 'round') {
      const payload = body.payload
      const partArgs = { ...args, p_part_id: payload.partId }
      let floors: string[] = []
      if (payload.operation === 'move' && payload.kind === 'room') {
        const floorContext = await obWorkflowRpc<Parameters<typeof roundFloorKeys>[0]>('ob_building_round_mutate', {
          ...partArgs, p_part_id: payload.targetBuildingPartId ?? payload.partId, p_operation: 'floor-context', p_payload: {},
        })
        floors = roundFloorKeys(floorContext)
      }
      data = await obWorkflowRpc('ob_building_round_mutate', {
        ...partArgs, p_operation: roundMutationRpcOperation(String(payload.operation), payload), p_payload: payload, p_floor_keys: floors,
      })
    } else {
      const rowWrite = body.operation === 'row' || body.operation === 'rows'
      data = await obWorkflowRpc(rowWrite ? body.operation === 'rows' ? 'ob_building_write_rows' : 'ob_building_write_row' : 'ob_building_command', {
        ...args, ...(rowWrite ? {} : { p_operation: body.operation }), p_payload: body.payload,
      })
    }
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Kontrollera byggnadsuppgifterna.' }, { status: 400 })
    const key = error instanceof Error ? error.message : ''
    const [status, message] = errors[key] ? [409, errors[key]] : roundMutationError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
export const GET = handle
export const POST = handle
