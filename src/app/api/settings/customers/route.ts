import { NextResponse } from 'next/server'
import {
  CUSTOMER_RESPONSE_HEADERS,
  assertCustomerSameOrigin,
  customerFailure,
  readCustomerJson,
} from '@/lib/customers/http'
import {
  createOrganizationCustomer,
  getOrganizationCustomerWorkspace,
} from '@/lib/customers/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const workspace = await getOrganizationCustomerWorkspace()
    return NextResponse.json({ workspace }, { headers: CUSTOMER_RESPONSE_HEADERS })
  } catch (error) {
    const failure = customerFailure(error)
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers: CUSTOMER_RESPONSE_HEADERS }
    )
  }
}

export async function POST(request: Request) {
  try {
    assertCustomerSameOrigin(request)
    const body = await readCustomerJson(request)
    if (Object.keys(body).length !== 1 || !('customer' in body)) {
      throw new Error('CUSTOMER_REQUEST_INVALID')
    }
    const customer = await createOrganizationCustomer(body.customer)
    return NextResponse.json(
      { customer },
      { status: 201, headers: CUSTOMER_RESPONSE_HEADERS }
    )
  } catch (error) {
    const failure = customerFailure(error)
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers: CUSTOMER_RESPONSE_HEADERS }
    )
  }
}
