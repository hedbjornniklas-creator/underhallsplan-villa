import { NextResponse } from 'next/server'
import {
  FORTNOX_RESPONSE_HEADERS,
  buildFortnoxSettingsRedirect,
  fortnoxCallbackStatus,
} from '@/lib/fortnox/http'
import {
  completeFortnoxAuthorization,
  fortnoxCallbackFailureOrganizationId,
} from '@/lib/fortnox/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)

  try {
    const states = url.searchParams.getAll('state')
    const codes = url.searchParams.getAll('code')
    const providerErrors = url.searchParams.getAll('error')
    if (
      states.length !== 1 ||
      codes.length > 1 ||
      providerErrors.length > 1 ||
      (codes.length === 1) === (providerErrors.length === 1)
    ) {
      throw new Error('FORTNOX_CALLBACK_INVALID')
    }

    const result = await completeFortnoxAuthorization({
      state: states[0],
      code: codes[0] ?? null,
      providerError: providerErrors[0] ?? null,
    })

    return NextResponse.redirect(
      buildFortnoxSettingsRedirect(request.url, 'connected', result.orgId),
      { status: 303, headers: FORTNOX_RESPONSE_HEADERS }
    )
  } catch (error) {
    return NextResponse.redirect(
      buildFortnoxSettingsRedirect(
        request.url,
        fortnoxCallbackStatus(error),
        fortnoxCallbackFailureOrganizationId(error)
      ),
      { status: 303, headers: FORTNOX_RESPONSE_HEADERS }
    )
  }
}
