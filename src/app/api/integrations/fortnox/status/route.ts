import { NextResponse } from 'next/server'
import {
  FORTNOX_RESPONSE_HEADERS,
  fortnoxFailure,
} from '@/lib/fortnox/http'
import { getFortnoxSettings } from '@/lib/fortnox/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    return NextResponse.json(await getFortnoxSettings(), {
      headers: FORTNOX_RESPONSE_HEADERS,
    })
  } catch (error) {
    const failure = fortnoxFailure(error)
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers: FORTNOX_RESPONSE_HEADERS }
    )
  }
}
