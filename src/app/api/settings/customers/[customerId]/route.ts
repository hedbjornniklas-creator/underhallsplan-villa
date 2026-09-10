import { NextResponse } from 'next/server'
import {
  CUSTOMER_RESPONSE_HEADERS,
  assertCustomerSameOrigin,
  customerFailure,
  readCustomerJson,
} from '@/lib/customers/http'
import {
  setOrganizationCustomerActive,
  updateOrganizationCustomer,
} from '@/lib/customers/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ customerId: string }>
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    assertCustomerSameOrigin(request)
    const [{ customerId }, body] = await Promise.all([context.params, readCustomerJson(request)])
    const action = body.action
    const version = body.version
    let customer

    if (
      action === 'update' &&
      Object.keys(body).every((key) =>
        ['action', 'orgId', 'version', 'customer'].includes(key)
      ) &&
      Object.keys(body).length === 4
    ) {
      customer = await updateOrganizationCustomer(
        body.orgId,
        customerId,
        version,
        body.customer
      )
    } else if (
      action === 'set_active' &&
      Object.keys(body).every((key) =>
        ['action', 'orgId', 'version', 'isActive'].includes(key)
      ) &&
      Object.keys(body).length === 4
    ) {
      customer = await setOrganizationCustomerActive(
        body.orgId,
        customerId,
        version,
        body.isActive
      )
    } else {
      throw new Error('CUSTOMER_REQUEST_INVALID')
    }

    return NextResponse.json({ customer }, { headers: CUSTOMER_RESPONSE_HEADERS })
  } catch (error) {
    const failure = customerFailure(error)
    return NextResponse.json(
      { error: failure.message, code: failure.code },
      { status: failure.status, headers: CUSTOMER_RESPONSE_HEADERS }
    )
  }
}
