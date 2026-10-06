import { requireObContext } from '@/lib/ob/organizationBindings'
import { obOrganizationFailure, obRequestOrgId, obRequestPropertyId } from '@/lib/ob/organizationHttp'
import { isOrganizationUuid, ORGANIZATION_RESPONSE_HEADERS, readOrganizationJson } from '@/lib/organizations/administrationHttp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function checkRpcError(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (['42P01', '42703', '42883', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    throw new Error('OB_ORGANIZATION_MIGRATION_REQUIRED')
  }
  // Only the shared fixed allowlist can translate database messages to a response.
  throw new Error(error.message ?? 'OB_INSPECTION_REQUEST_FAILED')
}

function fail(error: unknown) {
  return obOrganizationFailure(error) ?? Response.json({ error: 'Besiktningen kunde inte hanteras. Försök igen.' }, {
    status: 500, headers: ORGANIZATION_RESPONSE_HEADERS,
  })
}

export async function GET(request: Request) {
  try {
    const context = await requireObContext(obRequestOrgId(request, true), true)
    const propertyId = obRequestPropertyId(request)
    const { data, error } = await createSupabaseAdminClient().rpc('ob_list_organization_inspections', {
      p_org_id: context.orgId, p_actor: context.userId, p_property_id: propertyId ?? null,
    })
    checkRpcError(error)
    if (!Array.isArray(data) || data.some(row => !row || !isOrganizationUuid(row.id) || !isOrganizationUuid(row.property_id) ||
      (propertyId !== undefined && row.property_id !== propertyId) || typeof row.hasReadyPdf !== 'boolean') ||
      new Set(data.map(row => row.id)).size !== data.length) throw new Error('OB_ORGANIZATION_READ_FAILED')
    return Response.json({ inspections: data, orgId: context.orgId }, { headers: ORGANIZATION_RESPONSE_HEADERS })
  } catch (error) { return fail(error) }
}

export async function POST(request: Request) {
  try {
    const context = await requireObContext(obRequestOrgId(request, true), true)
    const body = await readOrganizationJson(request)
    if (Object.keys(body).some(key => key !== 'propertyId') ||
      (body.propertyId !== undefined && !isOrganizationUuid(body.propertyId))) throw new Error('ORG_REQUEST_INVALID')
    const { data, error } = await createSupabaseAdminClient().rpc('ob_create_organization_inspection', {
      p_org_id: context.orgId, p_actor: context.userId,
      p_property_id: typeof body.propertyId === 'string' ? body.propertyId.toLowerCase() : null,
    })
    checkRpcError(error)
    if (!data || !isOrganizationUuid(data.inspectionId) || !isOrganizationUuid(data.propertyId) || data.orgId !== context.orgId ||
      (body.propertyId !== undefined && data.propertyId !== String(body.propertyId).toLowerCase())) throw new Error('OB_ORGANIZATION_READ_FAILED')
    return Response.json({ inspectionId: data.inspectionId, propertyId: data.propertyId, orgId: context.orgId }, {
      status: 201, headers: ORGANIZATION_RESPONSE_HEADERS,
    })
  } catch (error) { return fail(error) }
}
