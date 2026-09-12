import { NextResponse } from 'next/server'
import {
  getOrganizationProfileWorkspace,
  saveOrganizationProfileCard,
} from '@/lib/organizations/profileCard'
import { parseOrganizationProfileCardValues } from '@/lib/organizations/profileCardTypes'
import { requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  Pragma: 'no-cache',
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie',
}

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: RESPONSE_HEADERS }
  )
}

function assertSameOrigin(request: Request) {
  const expectedOrigin = new URL(request.url).origin
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')?.toLowerCase()
  if (origin && origin !== expectedOrigin) throw new Error('ORG_PROFILE_CARD_FORBIDDEN')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new Error('ORG_PROFILE_CARD_FORBIDDEN')
  }
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401, message)
  if (message === 'ORG_SELECTION_INVALID') {
    return jsonError('Den valda organisationen är ogiltig.', 400, message)
  }
  if (message === 'ORG_MEMBERSHIP_REQUIRED' || message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('Du saknar TU-behörighet i den valda organisationen.', 403, message)
  }
  if (message === 'ORG_PROFILE_CARD_FORBIDDEN') {
    return jsonError('Begäran kommer från fel webbplats.', 403, message)
  }
  if (message === 'ORG_PROFILE_CARD_ADMIN_REQUIRED') {
    return jsonError('Du saknar behörighet att ändra den här företagsprofilen.', 403, message)
  }
  if (message === 'ORG_PROFILE_CARD_REQUIRED_FIELDS') {
    return jsonError('Namn och företag är obligatoriska.', 400, message)
  }
  if (message === 'ORG_PROFILE_CARD_EMAIL_INVALID') {
    return jsonError('Ange en giltig e-postadress.', 400, message)
  }
  if (message === 'ORG_PROFILE_CARD_ORGNO_INVALID') {
    return jsonError('Ange ett giltigt svenskt organisationsnummer.', 400, message)
  }
  if (message === 'ORG_PROFILE_CARD_INPUT_INVALID') {
    return jsonError('Företagsprofilen innehåller ogiltiga uppgifter.', 400, message)
  }
  if (message === 'ORG_PROFILE_CARD_MIGRATION_REQUIRED') {
    return jsonError('SQL 07 måste köras innan företagsprofilen kan sparas.', 409, message)
  }
  if (message === 'ORG_PROFILE_CARD_CONFLICT') {
    return jsonError(
      'Företagsprofilen har ändrats i en annan flik. Ladda om sidan innan du sparar igen.',
      409,
      message
    )
  }
  return null
}

export async function PUT(request: Request) {
  try {
    assertSameOrigin(request)
    const contentType = request.headers.get('content-type')?.toLowerCase() ?? ''
    if (!contentType.startsWith('application/json')) {
      return jsonError('Begäran måste vara JSON.', 415, 'ORG_PROFILE_CARD_INPUT_INVALID')
    }

    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (Number.isFinite(contentLength) && contentLength > 64_000) {
      return jsonError('Företagsprofilen är för stor.', 413, 'ORG_PROFILE_CARD_INPUT_INVALID')
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (
      !body ||
      Object.keys(body).length !== 3 ||
      !Object.prototype.hasOwnProperty.call(body, 'orgId') ||
      !Object.prototype.hasOwnProperty.call(body, 'card') ||
      !Object.prototype.hasOwnProperty.call(body, 'expectedVersion') ||
      !(
        body.expectedVersion === null ||
        (typeof body.expectedVersion === 'number' &&
          Number.isSafeInteger(body.expectedVersion) &&
          body.expectedVersion > 0)
      )
    ) {
      return jsonError('Begäran är ogiltig.', 400, 'ORG_PROFILE_CARD_INPUT_INVALID')
    }

    const context = await requireTuContext(body.orgId)
    const values = parseOrganizationProfileCardValues(body.card)
    await saveOrganizationProfileCard({
      orgId: context.orgId,
      profileId: context.userId,
      actorProfileId: context.userId,
      expectedVersion: body.expectedVersion as number | null,
      values,
    })
    const workspace = await getOrganizationProfileWorkspace({
      orgId: context.orgId,
      orgName: context.orgName,
      profileId: context.userId,
      role: context.role,
    })

    return NextResponse.json({ workspace }, { headers: RESPONSE_HEADERS })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Företagsprofilen kunde inte sparas.', 500, 'ORG_PROFILE_CARD_SAVE_FAILED')
  }
}
