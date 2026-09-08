import { NextResponse } from 'next/server'
import { requireBrfAdminContext } from '@/lib/renoapp/brfAdminAccess'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseFlowMove } from '@/lib/renoapp/flowEditor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const errors: Record<string, [number, string]> = {
  UNAUTHORIZED: [401, 'Du behöver logga in igen.'],
  ADMIN_REQUIRED: [403, 'Endast HusHubs admin får ändra flöden.'],
  MODULE_ACCESS_REQUIRED: [403, 'Endast HusHubs admin får ändra flöden.'],
  PRODUCT_ACCESS_REQUIRED: [403, 'Endast HusHubs admin får ändra flöden.'],
  PROFILE_NOT_FOUND: [403, 'Ingen användarprofil hittades.'],
  FLOW_MOVE_INVALID: [400, 'Flytten är inte giltig.'],
  FLOW_MOVE_INVALID_TARGET: [400, 'Kortet kan inte kopplas till den valda platsen.'],
  FLOW_MOVE_SAME_PARENT: [400, 'Kortet är redan kopplat till den platsen.'],
  FLOW_MOVE_DUPLICATE: [409, 'Den kopplingen finns redan. Ingen flytt har gjorts.'],
  FLOW_MOVE_CYCLE: [409, 'Flytten skulle skapa en cirkel av frågor. Ingen flytt har gjorts.'],
  FLOW_MOVE_CUSTOM_SETTINGS: [409, 'Kopplingen har egna inställningar för obligatoriskt krav, fas eller anteckning som inte kan flyttas till ett svar utan att ändras. Redigera kopplingen först.'],
  FLOW_MOVE_STALE: [409, 'Flödet har ändrats. Ladda om flödesbyggaren och försök igen.'],
}

export async function POST(request: Request) {
  try {
    await requireBrfAdminContext()
    const move = parseFlowMove(await request.json().catch(() => null))
    const { data, error } = await createSupabaseAdminClient().rpc('renoapp_move_flow_connection', {
      p_source_kind: move.source.kind, p_source_id: move.source.id, p_source_parent_id: move.source.parentId,
      p_target_kind: move.target.kind, p_target_id: move.target.id,
      p_expected_version: move.version, p_apply: move.apply,
    })
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        return NextResponse.json({ error: 'Databasuppdateringen för flytt av kort behöver köras först.' }, { status: 503 })
      }
      if (errors[error.message]) throw new Error(error.message)
      return NextResponse.json({ error: 'Flytten kunde inte genomföras. Ladda om och försök igen.' }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (error) {
    const [status, message] = errors[error instanceof Error ? error.message : '']
      ?? [500, 'Flytten kunde inte genomföras.']
    return NextResponse.json({ error: message }, { status })
  }
}
