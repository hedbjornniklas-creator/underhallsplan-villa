import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { obWorkflowRpc } from '@/lib/ob/assignmentWorkflowServer'
import { roundMutationError } from '@/lib/ob/roundMutationServer'
import { validFloorLevels } from '@/lib/ob/floorModel'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const org = await requireOrgContext()
    const { id } = await context.params
    const text = await request.text()
    if (text.length > 15000) return NextResponse.json({ error: 'Anropet inneh\u00e5ller f\u00f6r mycket text.' }, { status: 413 })
    const body = JSON.parse(text)
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) || !body || !Number.isInteger(body.revision) || body.revision < 1 || !validFloorLevels(body.levels)) {
      return NextResponse.json({ error: 'Kontrollera planens nummer och namn.' }, { status: 400 })
    }
    const data = await obWorkflowRpc('ob_save_floor_model', {
      p_inspection_id: id, p_org_id: org.orgId, p_actor: org.userId,
      p_revision: body.revision, p_levels: body.levels,
    })
    return NextResponse.json({ data }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Ogiltigt anrop.' }, { status: 400 })
    if (error instanceof Error && error.message === 'OB_ROUND_STALE') {
      return NextResponse.json({ error: 'Planindelningen har \u00e4ndrats. Ladda om sidan innan du f\u00f6rs\u00f6ker igen.' }, { status: 409 })
    }
    const [status, message] = roundMutationError(error)
    return NextResponse.json({ error: message }, { status })
  }
}
