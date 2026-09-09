import { NextResponse } from 'next/server'
import {
  FORTNOX_RESPONSE_HEADERS,
  assertFortnoxSameOrigin,
  buildFortnoxSettingsRedirect,
  fortnoxCallbackStatus,
} from '@/lib/fortnox/http'
import { createFortnoxAuthorization } from '@/lib/fortnox/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 1024

export async function POST(request: Request) {
  let requestedOrgId: string | undefined

  try {
    assertFortnoxSameOrigin(request)
    const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
    const contentLength = Number(request.headers.get('content-length') ?? 0)
    if (
      contentType !== 'application/x-www-form-urlencoded' ||
      !Number.isFinite(contentLength) ||
      contentLength < 0 ||
      contentLength > MAX_BODY_BYTES
    ) {
      throw new Error('FORTNOX_REQUEST_INVALID')
    }

    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      throw new Error('FORTNOX_REQUEST_INVALID')
    }
    const form = new URLSearchParams(rawBody)
    if ([...form.keys()].some((key) => key !== 'orgId') || form.getAll('orgId').length !== 1) {
      throw new Error('FORTNOX_REQUEST_INVALID')
    }
    const orgId = form.get('orgId')
    if (typeof orgId !== 'string' || orgId.length > 64) {
      throw new Error('FORTNOX_REQUEST_INVALID')
    }
    requestedOrgId = orgId

    const authorizationUrl = await createFortnoxAuthorization(orgId)
    return NextResponse.redirect(authorizationUrl, {
      status: 303,
      headers: FORTNOX_RESPONSE_HEADERS,
    })
  } catch (error) {
    return NextResponse.redirect(
      buildFortnoxSettingsRedirect(
        request.url,
        fortnoxCallbackStatus(error),
        requestedOrgId
      ),
      { status: 303, headers: FORTNOX_RESPONSE_HEADERS }
    )
  }
}
