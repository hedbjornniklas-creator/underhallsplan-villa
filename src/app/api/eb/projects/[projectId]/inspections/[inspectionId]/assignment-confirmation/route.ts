import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { isMissingEnvError, requireOrgContext } from '@/lib/assignments/server'
import {
  AssignmentEmailSendError,
  getEbAssignmentConfirmation,
  reissueEbAssignmentConfirmation,
  saveEbAssignmentConfirmation,
  sendEbAssignmentConfirmation,
  type SaveEbAssignmentConfirmationInput,
} from '@/lib/eb/assignmentConfirmationServer'
import type { EbAssignmentDetails } from '@/lib/eb/assignmentConfirmationTypes'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function optionalText(value: unknown) {
  return text(value) || null
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : null
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function parseInput(
  body: Record<string, unknown>,
  context: { orgId: string; userId: string; projectId: string; inspectionId: string }
): SaveEbAssignmentConfirmationInput {
  const detailsValue = body.details
  const details =
    detailsValue && typeof detailsValue === 'object' && !Array.isArray(detailsValue)
      ? (detailsValue as Partial<EbAssignmentDetails>)
      : {}

  return {
    orgId: context.orgId,
    requestedByUserId: context.userId,
    projectId: context.projectId,
    inspectionId: context.inspectionId,
    customerName: optionalText(body.customerName),
    customerEmail: text(body.customerEmail).toLowerCase(),
    customerPhone: optionalText(body.customerPhone),
    customerAddress: optionalText(body.customerAddress),
    customerPostalCode: optionalText(body.customerPostalCode),
    customerCity: optionalText(body.customerCity),
    propertyAddress: optionalText(body.propertyAddress),
    propertyPostalCode: optionalText(body.propertyPostalCode),
    propertyCity: optionalText(body.propertyCity),
    propertyMunicipality: optionalText(body.propertyMunicipality),
    propertyDesignation: optionalText(body.propertyDesignation),
    propertyOwnerName: optionalText(body.propertyOwnerName),
    scopeDescription: optionalText(body.scopeDescription),
    preferredDate: optionalText(body.preferredDate),
    preferredTime: optionalText(body.preferredTime),
    priceAmount: optionalNumber(body.priceAmount),
    currency: text(body.currency).toUpperCase() || 'SEK',
    invoiceName: optionalText(body.invoiceName),
    invoiceOrgNo: optionalText(body.invoiceOrgNo),
    invoiceEmail: optionalText(body.invoiceEmail)?.toLowerCase() ?? null,
    invoiceAddress: optionalText(body.invoiceAddress),
    details,
  }
}

function mapError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
  if (message === 'EB_ASSIGNMENT_NOT_FOUND') return jsonError('Uppdragsbekräftelsen hittades inte.', 404)
  if (message === 'EB_ASSIGNMENT_LOCKED') {
    return jsonError('Den skickade uppdragsbekräftelsen är låst. Skapa en ny version för ändringar.', 409)
  }
  if (message === 'EB_ASSIGNMENT_REISSUE_NOT_ALLOWED') {
    return jsonError('Den här uppdragsbekräftelsen kan inte ersättas med en ny version.', 409)
  }
  if (message === 'CUSTOMER_EMAIL_REQUIRED') return jsonError('Ange mottagarens e-postadress.', 400)
  if (message === 'PROPERTY_DESIGNATION_REQUIRED') return jsonError('Ange fastighetsbeteckning.', 400)
  if (message === 'INSPECTION_SCHEDULE_REQUIRED') return jsonError('Ange datum och tid för besiktningen.', 400)
  if (message === 'SCOPE_REQUIRED') return jsonError('Beskriv uppdragets omfattning.', 400)
  if (message === 'PRICE_REQUIRED') return jsonError('Ange pris eller timpris.', 400)
  if (error instanceof AssignmentEmailSendError) {
    return jsonError('Uppdragsbekräftelsen sparades men mejlet kunde inte skickas.', 502, {
      acceptUrl: error.acceptUrl,
    })
  }
  if (isMissingEnvError(error)) return jsonError('Servern saknar mejlkonfiguration.', 500)
  if (message.includes('assignment_details') || message.includes('eb_assignment_confirmations')) {
    return jsonError('Databasen saknar senaste migrationen för EB-uppdragsbekräftelser.', 500)
  }
  return jsonError(fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const confirmation = await getEbAssignmentConfirmation({
      orgId: org.orgId,
      projectId,
      inspectionId,
    })
    return NextResponse.json({ confirmation })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta uppdragsbekräftelsen.')
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const input = parseInput(body, {
      orgId: org.orgId,
      userId: org.userId,
      projectId,
      inspectionId,
    })
    const confirmation = await saveEbAssignmentConfirmation(input)
    return NextResponse.json({ confirmation })
  } catch (error) {
    return mapError(error, 'Kunde inte spara uppdragsbekräftelsen.')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const input = parseInput(body, {
      orgId: org.orgId,
      userId: org.userId,
      projectId,
      inspectionId,
    })
    if (!input.customerEmail || !EMAIL_REGEX.test(input.customerEmail)) {
      return jsonError('Ange en giltig mottagaradress.', 400)
    }
    if (input.invoiceEmail && !EMAIL_REGEX.test(input.invoiceEmail)) {
      return jsonError('Ange en giltig faktura-e-postadress.', 400)
    }
    const result = await sendEbAssignmentConfirmation({ ...input, orgName: org.orgName })
    return NextResponse.json(result)
  } catch (error) {
    return mapError(error, 'Kunde inte skicka uppdragsbekräftelsen.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (body.action !== 'reissue') return jsonError('Okänd åtgärd.', 400)
    const confirmation = await reissueEbAssignmentConfirmation({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    })
    return NextResponse.json({ confirmation })
  } catch (error) {
    return mapError(error, 'Kunde inte skapa en ny version.')
  }
}
