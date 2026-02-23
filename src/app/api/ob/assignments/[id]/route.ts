import { NextResponse } from 'next/server'
import {
  getAssignmentById,
  requireOrgContext,
  type AssignmentStatus,
  type AssignmentType,
  updateAssignmentById,
} from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function safeString(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const assignment = await getAssignmentById(org.orgId, id)

    if (!assignment) return jsonError('Uppdraget hittades inte.', 404)
    return NextResponse.json({ assignment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte hämta uppdrag.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const patch: Parameters<typeof updateAssignmentById>[0]['patch'] = {}

    const customerEmail = safeString(body.customer_email ?? body.customerEmail)
    if (customerEmail !== null && !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ogiltig kundmejl.', 400)
    }

    if (customerEmail !== null) patch.customer_email = customerEmail.toLowerCase()

    const customerName = safeString(body.customer_name ?? body.customerName)
    if (customerName !== null || body.customer_name === '' || body.customerName === '') {
      patch.customer_name = customerName
    }

    const customerPhone = safeString(body.customer_phone ?? body.customerPhone)
    if (customerPhone !== null || body.customer_phone === '' || body.customerPhone === '') {
      patch.customer_phone = customerPhone
    }

    const customerAddress = safeString(body.customer_address ?? body.customerAddress)
    if (customerAddress !== null || body.customer_address === '' || body.customerAddress === '') {
      patch.customer_address = customerAddress
    }

    const preliminaryAddress = safeString(body.preliminary_address ?? body.preliminaryAddress)
    if (preliminaryAddress !== null || body.preliminary_address === '' || body.preliminaryAddress === '') {
      patch.preliminary_address = preliminaryAddress
    }

    const preferredDate = safeString(body.preferred_date ?? body.preferredDate)
    if (preferredDate !== null || body.preferred_date === '' || body.preferredDate === '') {
      patch.preferred_date = preferredDate
    }

    const preferredTime = safeString(body.preferred_time ?? body.preferredTime)
    if (preferredTime !== null || body.preferred_time === '' || body.preferredTime === '') {
      patch.preferred_time = preferredTime
    }

    const propertyAddress = safeString(body.property_address ?? body.propertyAddress)
    if (propertyAddress !== null || body.property_address === '' || body.propertyAddress === '') {
      patch.property_address = propertyAddress
    }

    const propertyPostalCode = safeString(body.property_postal_code ?? body.propertyPostalCode)
    if (propertyPostalCode !== null || body.property_postal_code === '' || body.propertyPostalCode === '') {
      patch.property_postal_code = propertyPostalCode
    }

    const propertyCity = safeString(body.property_city ?? body.propertyCity)
    if (propertyCity !== null || body.property_city === '' || body.propertyCity === '') {
      patch.property_city = propertyCity
    }

    const propertyMunicipality = safeString(body.property_municipality ?? body.propertyMunicipality)
    if (
      propertyMunicipality !== null ||
      body.property_municipality === '' ||
      body.propertyMunicipality === ''
    ) {
      patch.property_municipality = propertyMunicipality
    }

    const propertyOwnerName = safeString(body.property_owner_name ?? body.propertyOwnerName)
    if (propertyOwnerName !== null || body.property_owner_name === '' || body.propertyOwnerName === '') {
      patch.property_owner_name = propertyOwnerName
    }

    const cadastralId = safeString(body.cadastral_id ?? body.cadastralId)
    if (cadastralId !== null || body.cadastral_id === '' || body.cadastralId === '') {
      patch.cadastral_id = cadastralId
    }

    const invoiceName = safeString(body.invoice_name ?? body.invoiceName)
    if (invoiceName !== null || body.invoice_name === '' || body.invoiceName === '') {
      patch.invoice_name = invoiceName
    }

    const invoiceAddress = safeString(body.invoice_address ?? body.invoiceAddress)
    if (invoiceAddress !== null || body.invoice_address === '' || body.invoiceAddress === '') {
      patch.invoice_address = invoiceAddress
    }

    const ordererRole = safeString(body.orderer_role ?? body.ordererRole)
    if (ordererRole !== null || body.orderer_role === '' || body.ordererRole === '') {
      patch.orderer_role = ordererRole
    }

    const personalIdentityNumber = safeString(
      body.personal_identity_number ?? body.personalIdentityNumber
    )
    if (
      personalIdentityNumber !== null ||
      body.personal_identity_number === '' ||
      body.personalIdentityNumber === ''
    ) {
      patch.personal_identity_number = personalIdentityNumber
    }

    const notesInternal = safeString(body.notes_internal ?? body.notesInternal)
    if (notesInternal !== null || body.notes_internal === '' || body.notesInternal === '') {
      patch.notes_internal = notesInternal
    }

    const statusRaw = safeString(body.status)
    if (statusRaw) {
      const normalized = statusRaw.toLowerCase()
      const allowed = ['draft', 'sent', 'booked', 'completed', 'expired', 'cancelled']
      if (!allowed.includes(normalized)) return jsonError('Ogiltig status.', 400)
      patch.status = normalized as AssignmentStatus
    }

    const typeRaw = safeString(body.assignment_type ?? body.assignmentType)
    if (typeRaw) {
      const normalized = typeRaw.toUpperCase()
      if (!['OB', 'STATUS', 'UHP'].includes(normalized)) return jsonError('Ogiltig uppdragstyp.', 400)
      patch.assignment_type = normalized as AssignmentType
    }

    const responsibleProfileId = safeString(body.responsible_profile_id ?? body.responsibleProfileId)
    if (responsibleProfileId) {
      patch.responsible_profile_id = responsibleProfileId
    }

    const priceAmountRaw = body.price_amount ?? body.priceAmount
    if (priceAmountRaw !== undefined) {
      if (priceAmountRaw === null || priceAmountRaw === '') {
        patch.price_amount = null
      } else {
        const price = Number(priceAmountRaw)
        if (!Number.isFinite(price) || price < 0) return jsonError('Ogiltigt pris.', 400)
        patch.price_amount = price
      }
    }

    const currency = safeString(body.currency)
    if (currency !== null || body.currency === '') {
      patch.currency = currency ?? 'SEK'
    }

    if (Object.keys(patch).length === 0) {
      return jsonError('Ingen giltig uppdatering skickades.', 400)
    }

    const assignment = await updateAssignmentById({
      orgId: org.orgId,
      assignmentId: id,
      updatedBy: org.userId,
      patch,
    })

    return NextResponse.json({ assignment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte uppdatera uppdrag.', 500)
  }
}
