import { NextResponse } from 'next/server'
import {
  getAssignmentById,
  getProfileContact,
  listAssignmentAddonOrders,
  requireOrgContext,
  sendAssignmentOrderReceipt,
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
    let addonOrders: Awaited<ReturnType<typeof listAssignmentAddonOrders>> = []
    try {
      addonOrders = await listAssignmentAddonOrders({
        orgId: org.orgId,
        assignmentId: id,
      })
    } catch (addonError) {
      console.error('[assignments.get] failed to load addon orders', {
        assignmentId: id,
        error: addonError instanceof Error ? addonError.message : String(addonError),
      })
    }

    return NextResponse.json({ assignment, addonOrders })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte hÃ¤mta uppdrag.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const existing = await getAssignmentById(org.orgId, id)
    if (!existing) return jsonError('Uppdraget hittades inte.', 404)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const requestedStatusRaw = safeString(body.status)
    const requestedStatus = requestedStatusRaw ? requestedStatusRaw.toLowerCase() : null
    const bodyKeys = Object.keys(body)
    const isStatusOnlyPatch = bodyKeys.length === 1 && bodyKeys[0] === 'status'
    const allowOrderedToBookedTransition =
      existing.status === 'ordered' &&
      requestedStatus === 'booked' &&
      isStatusOnlyPatch

    if (
      (existing.status === 'sent' ||
        existing.status === 'ordered' ||
        existing.status === 'booked') &&
      !allowOrderedToBookedTransition
    ) {
      return jsonError('Skickad, beställd eller bokad uppdragsbekräftelse är låst för redigering.', 409)
    }
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

    const brfName = safeString(body.brf_name ?? body.brfName)
    if (brfName !== null || body.brf_name === '' || body.brfName === '') {
      patch.brf_name = brfName
    }

    const apartmentNumber = safeString(body.apartment_number ?? body.apartmentNumber)
    if (
      apartmentNumber !== null ||
      body.apartment_number === '' ||
      body.apartmentNumber === ''
    ) {
      patch.apartment_number = apartmentNumber
    }

    const apartmentHolderName = safeString(body.apartment_holder_name ?? body.apartmentHolderName)
    if (
      apartmentHolderName !== null ||
      body.apartment_holder_name === '' ||
      body.apartmentHolderName === ''
    ) {
      patch.apartment_holder_name = apartmentHolderName
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
      const allowed = ['draft', 'sent', 'ordered', 'booked', 'completed', 'expired', 'cancelled']
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

    const shouldSendBookingReceipt = existing.status === 'ordered' && patch.status === 'booked'

    const assignment = await updateAssignmentById({
      orgId: org.orgId,
      assignmentId: id,
      updatedBy: org.userId,
      patch,
    })
    let bookingEmailSent = false
    if (shouldSendBookingReceipt) {
      try {
        const responsibleProfile = await getProfileContact(assignment.responsible_profile_id)
        await sendAssignmentOrderReceipt({
          assignment,
          orgName: org.orgName,
          requestedByUserId: org.userId,
          responsibleEmail: responsibleProfile?.email ?? null,
        })
        bookingEmailSent = true
      } catch (mailError) {
        console.error('[assignments.patch] failed to send booking receipt', {
          assignmentId: id,
          error: mailError instanceof Error ? mailError.message : String(mailError),
        })
      }
    }

    return NextResponse.json({ assignment, bookingEmailSent })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    return jsonError('Kunde inte uppdatera uppdrag.', 500)
  }
}

