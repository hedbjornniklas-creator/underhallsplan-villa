import { NextResponse } from 'next/server'
import { requireBrfAdminContext } from '@/lib/renoapp/brfAdminAccess'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseFlowEdit } from '@/lib/renoapp/flowEditor'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const errors: Record<string, [number, string]> = {
  UNAUTHORIZED: [401, 'Du behöver logga in igen.'],
  ADMIN_REQUIRED: [403, 'Endast HusHubs admin får ändra flöden.'],
  MODULE_ACCESS_REQUIRED: [403, 'Endast HusHubs admin får ändra flöden.'],
  PRODUCT_ACCESS_REQUIRED: [403, 'Endast HusHubs admin får ändra flöden.'],
  PROFILE_NOT_FOUND: [403, 'Ingen användarprofil hittades.'],
  FLOW_MOVE_INVALID: [400, 'Ändringen är inte giltig.'],
  FLOW_MOVE_INVALID_TARGET: [400, 'Kortet kan inte kopplas till den valda platsen.'],
  FLOW_MOVE_SAME_PARENT: [400, 'Kortet är redan kopplat till den platsen.'],
  FLOW_MOVE_DUPLICATE: [409, 'Kortet är redan kopplat till den platsen. Ingen ändring har gjorts.'],
  FLOW_MOVE_CYCLE: [409, 'Kopplingen skulle skapa en cirkel av frågor. Ingen ändring har gjorts.'],
  FLOW_MOVE_CUSTOM_SETTINGS: [409, 'Kopplingen har egna inställningar för obligatoriskt krav, fas eller anteckning som inte kan kopplas till ett svar utan att ändras. Redigera kopplingen först.'],
  FLOW_MOVE_STALE: [409, 'Flödet har ändrats. Ladda om flödesbyggaren och försök igen.'],
}

export async function POST(request: Request) {
  try {
    await requireBrfAdminContext()
    const move = parseFlowEdit(await request.json().catch(() => null))
    const { data, error } = await createSupabaseAdminClient().rpc(move.operation === 'move' ? 'renoapp_move_flow_connection' : 'renoapp_edit_flow_connection', {
      ...(move.operation === 'move' ? {} : { p_operation: move.operation }),
      p_source_kind: move.source.kind, p_source_id: move.source.id, p_source_parent_id: move.source.parentId,
      p_target_kind: move.target?.kind ?? null, p_target_id: move.target?.id ?? null,
      p_expected_version: move.version, p_apply: move.apply,
    })
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        return NextResponse.json({ error: 'Databasuppdateringen för flödeskopplingar behöver köras först.' }, { status: 503 })
      }
      if (errors[error.message]) throw new Error(error.message)
      return NextResponse.json({ error: 'Ändringen kunde inte genomföras. Ladda om och kontrollera flödet.' }, { status: 500 })
    }
    return NextResponse.json(data)
  } catch (error) {
    const [status, message] = errors[error instanceof Error ? error.message : '']
      ?? [500, 'Ändringen kunde inte genomföras.']
    return NextResponse.json({ error: message }, { status })
  }
}
