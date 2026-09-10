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

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    if (
      [...searchParams.keys()].some((key) => key !== 'orgId') ||
      searchParams.getAll('orgId').length > 1 ||
      (searchParams.has('orgId') && !searchParams.get('orgId'))
    ) {
      throw new Error('CUSTOMER_REQUEST_INVALID')
    }
    const workspace = await getOrganizationCustomerWorkspace(
      searchParams.get('orgId') ?? undefined
    )
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
    if (
      Object.keys(body).length !== 2 ||
      !('orgId' in body) ||
      !('customer' in body)
    ) {
      throw new Error('CUSTOMER_REQUEST_INVALID')
    }
    const customer = await createOrganizationCustomer(body.orgId, body.customer)
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
