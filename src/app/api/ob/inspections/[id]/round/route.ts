import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { obWorkflowRpc } from '@/lib/ob/assignmentWorkflowServer'
import { roundFloorKeys, roundMutationError, validateRoundMutation } from '@/lib/ob/roundMutationServer'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    const text = await request.text()
    if (text.length > 100000) return NextResponse.json({ error: 'För mycket text i anropet.' }, { status: 413 })
    const body = JSON.parse(text)
    if (!validateRoundMutation(id, body)) return NextResponse.json({ error: 'Ogiltigt val.' }, { status: 400 })
    const args = { p_inspection_id: id, p_org_id: org.orgId, p_actor: org.userId }
    let floors: string[] = []
    if (body.operation === 'move' && body.payload.kind === 'room') {
      const floorContext = await obWorkflowRpc<Parameters<typeof roundFloorKeys>[0]>('ob_round_mutate', {
        ...args, p_operation: 'floor-context', p_payload: {},
      })
      floors = roundFloorKeys(floorContext)
    }
    const data = await obWorkflowRpc('ob_round_mutate', {
      ...args, p_operation: body.operation, p_payload: body.payload, p_floor_keys: floors,
    })
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ogiltigt anrop.' }, { status: 400 })
    const [status, message] = roundMutationError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
