import { NextResponse } from 'next/server'
import {
  FORTNOX_RESPONSE_HEADERS,
  assertFortnoxSameOrigin,
  fortnoxFailure,
} from '@/lib/fortnox/http'
import { updateFortnoxOrganizationNumber } from '@/lib/fortnox/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 2048

function invalidBody() {
  return NextResponse.json(
    {
      error: 'Begäran innehåller inte ett giltigt organisationsnummer.',
      code: 'FORTNOX_REQUEST_INVALID',
    },
    { status: 400, headers: FORTNOX_RESPONSE_HEADERS }
  )
}

export async function PATCH(request: Request) {
  try {
    assertFortnoxSameOrigin(request)

    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (
      request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !==
        'application/json' ||
      !Number.isFinite(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_BODY_BYTES
    ) {
      return invalidBody()
    }

    let body: unknown
    try {
      const rawBody = await request.text()
      if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return invalidBody()
      body = JSON.parse(rawBody) as unknown
    } catch {
      return invalidBody()
    }

    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalidBody()
    const values = body as Record<string, unknown>
    if (
      Object.keys(values).some(
        (key) => key !== 'orgId' && key !== 'organizationNumber'
      ) ||
      typeof values.orgId !== 'string' ||
      values.orgId.length > 64 ||
      typeof values.organizationNumber !== 'string' ||
      values.organizationNumber.length > 32
    ) {
      return invalidBody()
    }

    const organizationNumber = await updateFortnoxOrganizationNumber(
      values.orgId,
      values.organizationNumber
    )
    return NextResponse.json(
      { organizationNumber },
      { headers: FORTNOX_RESPONSE_HEADERS }
    )
  } catch (error) {
    const failure = fortnoxFailure(error)
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers: FORTNOX_RESPONSE_HEADERS }
    )
  }
}
