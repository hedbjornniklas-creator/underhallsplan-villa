import { NextResponse } from 'next/server'
import {
  createAssignment,
  listAssignmentsByOrg,
  requireOrgContext,
  type AssignmentType,
} from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const context = await requireOrgContext()
    const items = await listAssignmentsByOrg(context.orgId)

    return NextResponse.json({
      items,
      org: {
        id: context.orgId,
        name: context.orgName,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte hämta uppdrag.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireOrgContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const assignmentTypeRaw = String(body.assignmentType ?? 'OB').toUpperCase()
    const assignmentType = (['OB', 'STATUS', 'UHP', 'EB'].includes(assignmentTypeRaw)
      ? assignmentTypeRaw
      : 'OB') as AssignmentType
    const customerEmail = String(body.customerEmail ?? '').trim().toLowerCase()
    const customerName = String(body.customerName ?? '').trim()
    const customerPhone = String(body.customerPhone ?? '').trim()
    const customerPostalCode = String(body.customerPostalCode ?? '').trim()
    const customerCity = String(body.customerCity ?? '').trim()
    const customerAddress = String(body.customerAddress ?? '').trim()
    const preliminaryAddress = String(body.preliminaryAddress ?? '').trim()
    const propertyAddress = String(body.propertyAddress ?? '').trim()
    const propertyPostalCode = String(body.propertyPostalCode ?? '').trim()
    const propertyCity = String(body.propertyCity ?? '').trim()
    const propertyMunicipality = String(body.propertyMunicipality ?? '').trim()
    const propertyOwnerName = String(body.propertyOwnerName ?? '').trim()
    const cadastralId = String(body.cadastralId ?? '').trim()
    const brfName = String(body.brfName ?? '').trim()
    const apartmentNumber = String(body.apartmentNumber ?? '').trim()
    const apartmentHolderName = String(body.apartmentHolderName ?? '').trim()
    const ordererRole = String(body.ordererRole ?? '').trim()
    const preferredDate = String(body.preferredDate ?? '').trim()
    const preferredTime = String(body.preferredTime ?? '').trim()
    const priceAmountRaw = String(body.priceAmount ?? '').trim()
    const parsedPrice =
      priceAmountRaw === '' ? null : Number(priceAmountRaw.replace(',', '.'))
    const notesInternal = String(body.notesInternal ?? '').trim()
    const responsibleProfileId = String(body.responsibleProfileId ?? context.userId).trim()

    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig kundmejl.', 400)
    }

    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      return jsonError('Ange ett giltigt pris.', 400)
    }

    const assignment = await createAssignment({
      orgId: context.orgId,
      createdBy: context.userId,
      responsibleProfileId: responsibleProfileId || context.userId,
      assignmentType,
      customerEmail,
      customerName: customerName || null,
      customerPhone: customerPhone || null,
      customerPostalCode: customerPostalCode || null,
      customerCity: customerCity || null,
      customerAddress: customerAddress || null,
      preliminaryAddress: preliminaryAddress || null,
      propertyAddress: propertyAddress || preliminaryAddress || null,
      propertyPostalCode: propertyPostalCode || null,
      propertyCity: propertyCity || null,
      propertyMunicipality: propertyMunicipality || null,
      propertyOwnerName: propertyOwnerName || null,
      cadastralId: cadastralId || null,
      brfName: brfName || null,
      apartmentNumber: apartmentNumber || null,
      apartmentHolderName: apartmentHolderName || null,
      ordererRole: ordererRole || null,
      preferredDate: preferredDate || null,
      preferredTime: preferredTime || null,
      priceAmount: parsedPrice,
      currency: 'SEK',
      notesInternal: notesInternal || null,
    })

    return NextResponse.json({ assignment }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte skapa uppdrag.', 500)
  }
}
