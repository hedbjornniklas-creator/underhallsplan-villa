import { NextResponse } from 'next/server'
import {
  getOrganizationSwitcherContext,
  type OrganizationSwitcherSurface,
} from '@/lib/organizations/server'

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
      [...searchParams.keys()].some((key) => key !== 'orgId' && key !== 'surface') ||
      searchParams.getAll('orgId').length > 1 ||
      searchParams.getAll('surface').length !== 1
    ) {
      return jsonError('Begäran är ogiltig.', 400)
    }

    const surface = searchParams.get('surface')
    if (surface !== 'tu' && surface !== 'customers') {
      return jsonError('Begäran är ogiltig.', 400)
    }

    const context = await getOrganizationSwitcherContext(
      surface as OrganizationSwitcherSurface,
      searchParams.has('orgId') ? searchParams.get('orgId') : undefined
    )
    return NextResponse.json(context, { headers: RESPONSE_HEADERS })
  } catch (error) {
    const mapped = accessError(error)
    if (mapped) return mapped
    return jsonError('Organisationerna kunde inte hämtas.', 500)
  }
}
