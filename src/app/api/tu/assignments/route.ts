import { NextResponse } from 'next/server'
import {
  createTuAssignmentDraft,
  getTuAssignmentById,
  listTuAssignments,
  requireTuContext,
} from '@/lib/tu/server'
import {
  assignOrganizationCustomer,
  discardUnlinkedAssignmentDraft,
  parseAssignmentCustomerBinding,
} from '@/lib/assignment-customers/server'
import {
  ASSIGNMENT_CUSTOMER_RESPONSE_HEADERS,
  assertAssignmentCustomerSameOrigin,
  assignmentCustomerFailure,
  readAssignmentCustomerJson,
} from '@/lib/assignment-customers/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}) },
    { status, headers: ASSIGNMENT_CUSTOMER_RESPONSE_HEADERS }
  )
}

function text(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function parsePrice(value: string) {
  if (!value) return null
  const parsed = Number(value.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : Number.NaN
}

function mapAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_SELECTION_INVALID') return jsonError('Den valda organisationen är ogiltig.', 400)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  return null
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    if (
      [...searchParams.keys()].some((key) => key !== 'orgId') ||
      searchParams.getAll('orgId').length !== 1
    ) {
      return jsonError('Välj arbetsorganisation innan TU-uppdragen hämtas.', 400)
    }
    const context = await requireTuContext(searchParams.get('orgId'))
    const items = await listTuAssignments(context.orgId)
    return NextResponse.json({ items, org: { id: context.orgId, name: context.orgName } })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte hämta TU-uppdrag.', 500)
  }
}

export async function POST(request: Request) {
  try {
    assertAssignmentCustomerSameOrigin(request)
    const body = await readAssignmentCustomerJson(request)
    if (!Object.prototype.hasOwnProperty.call(body, 'orgId')) {
      return jsonError('Välj arbetsorganisation innan uppdraget sparas.', 400)
    }
    const context = await requireTuContext(body.orgId)
    const customerBinding = parseAssignmentCustomerBinding(body.customerBinding)
    const customerEmail = text(body, 'customerEmail').toLowerCase()
    const invoiceEmail = text(body, 'invoiceEmail').toLowerCase()
    const objectType = text(body, 'objectType') === 'apartment' ? 'apartment' : 'villa'
    const customerType = text(body, 'customerType') === 'business' ? 'business' : 'consumer'
    const price = parsePrice(text(body, 'priceAmount'))

    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig kundmejl.', 400)
    }
    if (invoiceEmail && !EMAIL_REGEX.test(invoiceEmail)) {
      return jsonError('Ange en giltig fakturae-post.', 400)
    }

    if (Number.isNaN(price)) {
      return jsonError('Ange ett giltigt pris.', 400)
    }
    if (customerBinding.mode === 'create' && !text(body, 'customerName')) {
      return jsonError('Ange kundens namn.', 400, 'CUSTOMER_NAME_REQUIRED')
    }

    const assignment = await createTuAssignmentDraft({
      orgId: context.orgId,
      createdBy: context.userId,
      responsibleProfileId: context.userId,
      customerEmail,
      customerName: text(body, 'customerName') || null,
      customerPhone: text(body, 'customerPhone') || null,
      customerPostalCode: text(body, 'customerPostalCode') || null,
      customerCity: text(body, 'customerCity') || null,
      customerAddress: text(body, 'customerAddress') || null,
      propertyAddress: text(body, 'propertyAddress') || null,
      propertyPostalCode: text(body, 'propertyPostalCode') || null,
      propertyCity: text(body, 'propertyCity') || null,
      propertyMunicipality: text(body, 'propertyMunicipality') || null,
      propertyOwnerName: text(body, 'propertyOwnerName') || null,
      cadastralId: objectType === 'villa' ? text(body, 'cadastralId') || null : null,
      brfName: objectType === 'apartment' ? text(body, 'brfName') || null : null,
      apartmentNumber: objectType === 'apartment' ? text(body, 'apartmentNumber') || null : null,
      apartmentHolderName: objectType === 'apartment' ? text(body, 'apartmentHolderName') || null : null,
      invoiceEmail: invoiceEmail || null,
      objectType,
      customerType,
      scopeDescription: text(body, 'scopeDescription') || null,
      preferredDate: text(body, 'preferredDate') || null,
      preferredTime: text(body, 'preferredTime') || null,
      priceAmount: price,
      notesInternal: text(body, 'notesInternal') || null,
    })

    let customerLink
    let linkedAssignment
    try {
      customerLink = await assignOrganizationCustomer(
        context.orgId,
        assignment.id,
        assignment.updated_at,
        customerBinding
      )
      linkedAssignment = await getTuAssignmentById(context.orgId, assignment.id)
      if (!linkedAssignment?.organization_customer_id) {
        throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
      }
    } catch (linkError) {
      await discardUnlinkedAssignmentDraft(
        context.orgId,
        assignment.id,
        assignment.updated_at
      ).catch(() => false)
      throw linkError
    }

    return NextResponse.json(
      { assignment: linkedAssignment, customer: customerLink.customer },
      { status: 201, headers: ASSIGNMENT_CUSTOMER_RESPONSE_HEADERS }
    )
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    const customerFailure = assignmentCustomerFailure(error)
    if (customerFailure.code !== 'ASSIGNMENT_CUSTOMER_REQUEST_FAILED') {
      return jsonError(customerFailure.message, customerFailure.status, customerFailure.code)
    }
    const message = error instanceof Error ? error.message : ''
    if (message.includes('column') || message.includes('relation') || message.includes('does not exist')) {
      return jsonError('Databasen saknar migrationen för uppdragens kundkoppling.', 503)
    }
    return jsonError('Kunde inte skapa TU-uppdrag.', 500)
  }
}
