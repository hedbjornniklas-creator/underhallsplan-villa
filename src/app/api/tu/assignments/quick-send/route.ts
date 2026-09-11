import { NextResponse } from 'next/server'
import {
  createTuAssignmentDraft,
  getTuAssignmentById,
  requireTuContext,
  sendTuAssignmentConfirmation,
} from '@/lib/tu/server'
import { AssignmentEmailSendError } from '@/lib/assignments/server'
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

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json(
    { error: message, ...(extra ?? {}) },
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
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  return null
}

export async function POST(request: Request) {
  let savedAssignmentId: string | null = null
  let savedCustomer: {
    id: string
    customerNumber: string
    version: number
    created: boolean
  } | null = null

  try {
    assertAssignmentCustomerSameOrigin(request)
    const context = await requireTuContext()
    const body = await readAssignmentCustomerJson(request)
    const customerBinding = parseAssignmentCustomerBinding(body.customerBinding)
    const customerEmail = text(body, 'customerEmail').toLowerCase()
    const invoiceEmail = text(body, 'invoiceEmail').toLowerCase()
    const scopeDescription = text(body, 'scopeDescription')
    const objectType = text(body, 'objectType') === 'apartment' ? 'apartment' : 'villa'
    const customerType = text(body, 'customerType') === 'business' ? 'business' : 'consumer'
    const cadastralId = text(body, 'cadastralId')
    const brfName = text(body, 'brfName')
    const apartmentNumber = text(body, 'apartmentNumber')
    const price = parsePrice(text(body, 'priceAmount'))

    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig kundmejl.', 400)
    }
    if (invoiceEmail && !EMAIL_REGEX.test(invoiceEmail)) {
      return jsonError('Ange en giltig fakturae-post.', 400)
    }
    if (!scopeDescription) {
      return jsonError('Beskriv vad den tekniska utredningen ska omfatta.', 400)
    }
    if (objectType === 'apartment' && (!brfName || !apartmentNumber)) {
      return jsonError('Ange BRF och lägenhetsnummer.', 400)
    }
    if (objectType === 'villa' && !cadastralId) {
      return jsonError('Ange fastighetsbeteckning.', 400)
    }
    if (price === null || Number.isNaN(price)) {
      return jsonError('Pris är obligatoriskt innan utskick.', 400)
    }
    if (customerBinding.mode === 'create' && !text(body, 'customerName')) {
      return jsonError('Ange kundens namn.', 400, { code: 'CUSTOMER_NAME_REQUIRED' })
    }

    const assignment = await createTuAssignmentDraft({
      orgId: context.orgId,
      createdBy: context.userId,
      responsibleProfileId: text(body, 'responsibleProfileId') || context.userId,
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
      cadastralId: objectType === 'villa' ? cadastralId || null : null,
      brfName: objectType === 'apartment' ? brfName || null : null,
      apartmentNumber: objectType === 'apartment' ? apartmentNumber || null : null,
      apartmentHolderName: objectType === 'apartment' ? text(body, 'apartmentHolderName') || null : null,
      invoiceEmail: invoiceEmail || null,
      objectType,
      customerType,
      scopeDescription,
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

    savedAssignmentId = linkedAssignment.id
    savedCustomer = customerLink.customer

    const sendResult = await sendTuAssignmentConfirmation({
      assignment: linkedAssignment,
      orgName: context.orgName,
      requestedByUserId: context.userId,
    })

    return NextResponse.json(
      {
        assignmentId: assignment.id,
        status: 'sent',
        acceptUrl: sendResult.acceptUrl,
        expiresAt: sendResult.expiresAt,
        customer: customerLink.customer,
      },
      { headers: ASSIGNMENT_CUSTOMER_RESPONSE_HEADERS }
    )
  } catch (error) {
    if (savedAssignmentId && savedCustomer) {
      return NextResponse.json(
        {
          assignmentId: savedAssignmentId,
          status: 'delivery_failed',
          deliveryFailed: true,
          warning:
            'Uppdraget sparades och kunden kopplades, men mejlet kunde inte skickas. Försök igen från det sparade uppdraget.',
          customer: savedCustomer,
          ...(error instanceof AssignmentEmailSendError
            ? { acceptUrl: error.acceptUrl }
            : {}),
        },
        { status: 202, headers: ASSIGNMENT_CUSTOMER_RESPONSE_HEADERS }
      )
    }

    const accessError = mapAccessError(error)
    if (accessError) return accessError

    const message = error instanceof Error ? error.message : 'Okänt fel.'
    const customerFailure = assignmentCustomerFailure(error)
    if (customerFailure.code !== 'ASSIGNMENT_CUSTOMER_REQUEST_FAILED') {
      return jsonError(customerFailure.message, customerFailure.status, {
        code: customerFailure.code,
      })
    }
    if (message.includes('column') || message.includes('relation') || message.includes('does not exist')) {
      return jsonError('Databasen saknar senaste TU-migrationen.', 500)
    }
    return jsonError('Kunde inte skapa och skicka TU-uppdrag.', 500)
  }
}
