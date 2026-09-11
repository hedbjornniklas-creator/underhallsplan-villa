import { NextResponse } from 'next/server'
import {
  FORTNOX_RESPONSE_HEADERS,
  assertFortnoxSameOrigin,
  fortnoxFailure,
} from '@/lib/fortnox/http'
import { exportOrganizationCustomerToFortnox } from '@/lib/fortnox/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 1024

type RouteContext = {
  params: Promise<{ customerId: string }>
}

async function readExportBody(request: Request) {
  const mediaType = request.headers
    .get('content-type')
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase()
  const declaredLength = request.headers.get('content-length')
  const contentLength = declaredLength === null ? null : Number(declaredLength)

  if (
    mediaType !== 'application/json' ||
    (contentLength !== null &&
      (!Number.isFinite(contentLength) || contentLength < 0 || contentLength > MAX_BODY_BYTES))
  ) {
    throw new Error('FORTNOX_REQUEST_INVALID')
  }

  const raw = await request.text()
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new Error('FORTNOX_REQUEST_TOO_LARGE')
  }

  let value: unknown
  try {
    value = JSON.parse(raw) as unknown
  } catch {
    throw new Error('FORTNOX_REQUEST_INVALID')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('FORTNOX_REQUEST_INVALID')
  }

  const body = value as Record<string, unknown>
  if (
    Object.keys(body).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(body, 'orgId') ||
    !Object.prototype.hasOwnProperty.call(body, 'version')
  ) {
    throw new Error('FORTNOX_REQUEST_INVALID')
  }
  return body
}

export async function POST(request: Request, context: RouteContext) {
  try {
    assertFortnoxSameOrigin(request)
    const [{ customerId }, body] = await Promise.all([
      context.params,
      readExportBody(request),
    ])
    const customer = await exportOrganizationCustomerToFortnox(
      body.orgId,
      customerId,
      body.version
    )
    return NextResponse.json({ customer }, { headers: FORTNOX_RESPONSE_HEADERS })
  } catch (error) {
    const failure = fortnoxFailure(error)
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers: FORTNOX_RESPONSE_HEADERS }
    )
  }
}
