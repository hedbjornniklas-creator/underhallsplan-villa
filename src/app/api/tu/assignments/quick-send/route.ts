import { NextResponse } from 'next/server'
import {
  createTuAssignmentDraft,
  requireTuContext,
  sendTuAssignmentConfirmation,
} from '@/lib/tu/server'
import { AssignmentEmailSendError, isMissingEnvError } from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
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
  try {
    const context = await requireTuContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const customerEmail = text(body, 'customerEmail').toLowerCase()
    const invoiceEmail = text(body, 'invoiceEmail').toLowerCase()
    const scopeDescription = text(body, 'scopeDescription')
    const objectType = text(body, 'objectType') === 'apartment' ? 'apartment' : 'villa'
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
      scopeDescription,
      preferredDate: text(body, 'preferredDate') || null,
      preferredTime: text(body, 'preferredTime') || null,
      priceAmount: price,
      notesInternal: text(body, 'notesInternal') || null,
    })

    const sendResult = await sendTuAssignmentConfirmation({
      assignment,
      orgName: context.orgName,
      requestedByUserId: context.userId,
    })

    return NextResponse.json({
      assignmentId: assignment.id,
      status: 'sent',
      acceptUrl: sendResult.acceptUrl,
      expiresAt: sendResult.expiresAt,
    })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError

    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (error instanceof AssignmentEmailSendError) {
      return jsonError('Kunde inte skicka mejl just nu.', 502, { acceptUrl: error.acceptUrl })
    }
    if (isMissingEnvError(error)) {
      return jsonError('Servern saknar mejlkonfiguration i env.', 500)
    }
    if (message.includes('column') || message.includes('relation') || message.includes('does not exist')) {
      return jsonError('Databasen saknar senaste TU-migrationen.', 500)
    }
    return jsonError('Kunde inte skapa och skicka TU-uppdrag.', 500)
  }
}
