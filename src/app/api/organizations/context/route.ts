import { NextResponse } from 'next/server'
import {
  getOrganizationSwitcherContext,
  type OrganizationSwitcherSurface,
} from '@/lib/organizations/server'
import { requireObAssignmentContext, requireObInspectionContext } from '@/lib/ob/organizationBindings'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: RESPONSE_HEADERS })
}

function accessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_SELECTION_INVALID') {
    return jsonError('Den valda organisationen är ogiltig.', 400)
  }
  if (message === 'CUSTOMER_ORGANIZATION_INVALID') {
    return jsonError('Den valda organisationen är ogiltig.', 400)
  }
  if (message === 'OB_ORGANIZATION_MISMATCH') {
    return jsonError('Uppdraget tillhör en annan organisation. Öppna det från rätt organisations uppdragslista.', 409)
  }
  if (message === 'OB_ORGANIZATION_UNASSIGNED' || message === 'OB_ORGANIZATION_MIGRATION_REQUIRED') {
    return jsonError('Besiktningens organisationskoppling behöver kontrolleras av en administratör.', 409)
  }
  if (message === 'OB_ORGANIZATION_FORBIDDEN' || message === 'OB_ASSIGNMENT_FORBIDDEN') {
    return jsonError('Du saknar behörighet till uppdraget.', 403)
  }
  if (message === 'OB_ASSIGNMENT_NOT_FOUND') return jsonError('ÖB-uppdraget kunde inte hittas.', 404)
  if (
    message === 'ORG_MEMBERSHIP_REQUIRED' ||
    message === 'MODULE_ACCESS_REQUIRED' ||
    message === 'PRODUCT_ACCESS_REQUIRED' ||
    message === 'CUSTOMER_ORGANIZATION_MEMBER_REQUIRED'
  ) {
    return jsonError('Du saknar behörighet till den valda organisationen.', 403)
  }
  return null
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    if (
      [...searchParams.keys()].some((key) => !['orgId', 'surface', 'inspectionId', 'assignmentId'].includes(key)) ||
      searchParams.getAll('orgId').length > 1 ||
      searchParams.getAll('inspectionId').length > 1 ||
      searchParams.getAll('assignmentId').length > 1 ||
      searchParams.getAll('surface').length !== 1
    ) {
      return jsonError('Begäran är ogiltig.', 400)
    }

    const surface = searchParams.get('surface')
    if (surface !== 'tu' && surface !== 'moisture' && surface !== 'customers' && surface !== 'settings' && surface !== 'ob') {
      return jsonError('Begäran är ogiltig.', 400)
    }

    const inspectionId = searchParams.get('inspectionId')
    const assignmentId = searchParams.get('assignmentId')
    if ((inspectionId !== null && !isOrganizationUuid(inspectionId)) ||
        (assignmentId !== null && !isOrganizationUuid(assignmentId)) ||
        (inspectionId !== null && assignmentId !== null) ||
        (surface !== 'ob' && (inspectionId !== null || assignmentId !== null))) {
      return jsonError('Begäran är ogiltig.', 400)
    }
    const requestedOrgId = searchParams.has('orgId') ? searchParams.get('orgId') : undefined
    // Existing links resolve their persisted entity organization before the
    // switcher runs. Never label an old inspection with today's default org.
    const entity = inspectionId !== null
      ? await requireObInspectionContext(inspectionId, requestedOrgId)
      : assignmentId !== null ? await requireObAssignmentContext(assignmentId, requestedOrgId) : null

    const context = await getOrganizationSwitcherContext(
      surface as OrganizationSwitcherSurface,
      entity?.orgId ?? requestedOrgId
    )
    return NextResponse.json(context, { headers: RESPONSE_HEADERS })
  } catch (error) {
    const mapped = accessError(error)
    if (mapped) return mapped
    return jsonError('Organisationerna kunde inte hämtas.', 500)
  }
}
