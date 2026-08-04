import { NextResponse } from 'next/server'
import { createTuAssignmentDraft, listTuAssignments, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
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

export async function GET() {
  try {
    const context = await requireTuContext()
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
    const context = await requireTuContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const customerEmail = text(body, 'customerEmail').toLowerCase()
    const invoiceEmail = text(body, 'invoiceEmail').toLowerCase()
    const objectType = text(body, 'objectType') === 'apartment' ? 'apartment' : 'villa'
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
      cadastralId: objectType === 'villa' ? text(body, 'cadastralId') || null : null,
      brfName: objectType === 'apartment' ? text(body, 'brfName') || null : null,
      apartmentNumber: objectType === 'apartment' ? text(body, 'apartmentNumber') || null : null,
      apartmentHolderName: objectType === 'apartment' ? text(body, 'apartmentHolderName') || null : null,
      invoiceEmail: invoiceEmail || null,
      objectType,
      scopeDescription: text(body, 'scopeDescription') || null,
      preferredDate: text(body, 'preferredDate') || null,
      preferredTime: text(body, 'preferredTime') || null,
      priceAmount: price,
      notesInternal: text(body, 'notesInternal') || null,
    })

    return NextResponse.json({ assignment }, { status: 201 })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte skapa TU-uppdrag.', 500)
  }
}
