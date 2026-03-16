import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function listInspectionAddonOrders(orgId: string, inspectionId: string) {
  const admin = createSupabaseAdminClient() as any
  const { data, error } = await admin
    .from('inspection_addon_orders')
    .select(
      'id,inspection_id,org_id,assignment_addon_order_id,addon_service_id,addon_key,addon_name_snapshot,sort_order,price_amount_snapshot,currency_snapshot,is_selected,selected_source,created_at,updated_at'
    )
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .order('sort_order', { ascending: true })
    .order('addon_name_snapshot', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta tilläggsuppdrag för besiktningen.')
  }

  return Array.isArray(data) ? data : []
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const addonOrders = await listInspectionAddonOrders(org.orgId, id)
    return NextResponse.json({ addonOrders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte hämta tilläggsuppdrag.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const body = (await request.json().catch(() => null)) as
      | {
          addon_key?: unknown
          is_selected?: unknown
        }
      | null

    const addonKey =
      typeof body?.addon_key === 'string' ? body.addon_key.trim() : ''
    const isSelected = body?.is_selected

    if (!addonKey) {
      return jsonError('Ogiltig addon_key.', 400)
    }
    if (typeof isSelected !== 'boolean') {
      return jsonError('Ogiltigt värde för is_selected.', 400)
    }

    const admin = createSupabaseAdminClient() as any
    const { data: updatedRows, error: updateError } = await admin
      .from('inspection_addon_orders')
      .update({
        is_selected: isSelected,
        selected_source: 'inspection',
      })
      .eq('org_id', org.orgId)
      .eq('inspection_id', id)
      .eq('addon_key', addonKey)
      .select('id')

    if (updateError) {
      throw new Error(updateError.message ?? 'Kunde inte uppdatera tilläggsuppdrag.')
    }

    if (!Array.isArray(updatedRows) || updatedRows.length === 0) {
      return jsonError('Tilläggsuppdrag hittades inte.', 404)
    }

    const addonOrders = await listInspectionAddonOrders(org.orgId, id)
    return NextResponse.json({ addonOrders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError(message || 'Kunde inte uppdatera tilläggsuppdrag.', 500)
  }
}
