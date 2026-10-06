import { requireObContext } from '@/lib/ob/organizationBindings'
import { obRequestOrgId, obOrganizationFailure } from '@/lib/ob/organizationHttp'
import { readOrganizationJson } from '@/lib/organizations/administrationHttp'
import { resolveObReportIdentity } from '@/lib/ob/reportIdentity'
import { NextResponse } from 'next/server'
import { parseObObjectType } from '@/lib/ob/objectType'
import { AssignmentEmailSendError, type AssignmentType, buildBaseUrl, createAssignment, isMissingEnvError, sendAssignmentConfirmation } from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

export async function POST(request: Request) {
  try {
    const context = await requireObContext(obRequestOrgId(request, true), true)
    const body = await readOrganizationJson(request, { maxBytes: 64000 })
    const assignmentTypeRaw = String(body.assignmentType ?? 'OB').toUpperCase()
    if (!['OB', 'STATUS'].includes(assignmentTypeRaw)) return jsonError('Välj ÖB eller statusbesiktning.', 400)
    const assignmentType = assignmentTypeRaw as AssignmentType
    if (body.orgId !== undefined && body.orgId !== context.orgId) throw new Error('OB_ORGANIZATION_MISMATCH')
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
    const objectType = parseObObjectType(body.objectType)
    if (assignmentType === 'STATUS' && !objectType) {
      return jsonError('Välj om statusbesiktningen avser fastighet eller lägenhet.', 400)
    }
    const cancellationFeeRaw = body.statusCancellationFee
    const cancellationFee = cancellationFeeRaw === undefined || cancellationFeeRaw === null || cancellationFeeRaw === ''
      ? null : Number(String(cancellationFeeRaw).replace(',', '.'))
    if (assignmentType === 'STATUS' && (cancellationFee === null || !Number.isFinite(cancellationFee) || cancellationFee < 0)) {
      return jsonError('Ange avbokningsbeloppet enligt uppdragsbekräftelsen (0 kr är tillåtet).', 400)
    }
    const preferredDate = String(body.preferredDate ?? '').trim()
    const preferredTime = String(body.preferredTime ?? '').trim()
    const priceAmountRaw = String(body.priceAmount ?? '').trim()
    const parsedPrice = priceAmountRaw === '' ? null : Number(priceAmountRaw.replace(',', '.'))
    const notesInternal = String(body.notesInternal ?? '').trim()
    const responsibleProfileId = String(body.responsibleProfileId ?? context.userId).trim()
    if (responsibleProfileId !== context.userId) throw new Error('OB_ORGANIZATION_FORBIDDEN')
    if (assignmentType === 'STATUS' && !String(body.scopeDescription ?? '').trim()) {
      return jsonError('Ange vad statusbesiktningen omfattar.', 400)
    }

    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig mejladress.', 400)
    }

    if (parsedPrice === null) {
      return jsonError('Pris är obligatoriskt innan utskick.', 400)
    }

    if (parsedPrice !== null && (!Number.isFinite(parsedPrice) || parsedPrice < 0)) {
      return jsonError('Ange ett giltigt pris.', 400)
    }

    // Validate the exact issuer before creating a draft for this send action.
    // A missing company/person profile must not leave a new orphan on each retry.
    await resolveObReportIdentity({
      orgId: context.orgId, profileId: context.userId,
      locked: false, frozenProfile: null, frozenCompany: null,
    })
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
      preliminaryAddress: preliminaryAddress || propertyAddress || null,
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
      ...(assignmentType === 'STATUS' ? { scopeDescription: String(body.scopeDescription ?? '').trim() || null } : {}),
      ...(assignmentType === 'STATUS' ? { assignmentDetails: { statusCancellationFee: cancellationFee, objectType } } : {}),
    })
    const sendResult = await sendAssignmentConfirmation({
      assignment,
      orgName: context.orgName,
      requestedByUserId: context.userId,
      responsibleEmail: null,
      baseUrl: buildBaseUrl(),
    })

    return NextResponse.json({
      assignmentId: assignment.id,
      status: 'sent',
      acceptUrl: sendResult.acceptUrl,
      expiresAt: sendResult.expiresAt,
    })
  } catch (error) {
    const organizationFailure = obOrganizationFailure(error)
    if (organizationFailure) return organizationFailure

    const message = error instanceof Error ? error.message : 'Okant fel.'

    if (message === 'UNAUTHORIZED') {
      console.warn('[assignments.quick-send] unauthorized')
      return jsonError('Inte inloggad.', 401)
    }

    if (message === 'ORG_MEMBERSHIP_REQUIRED') {
      console.warn('[assignments.quick-send] org membership required')
      return jsonError('Ingen organisationskoppling hittades.', 403)
    }

    if (message === 'ORDERER_ROLE_REQUIRED') {
      return jsonError('Valj uppdragsgivare (Säljare, Köpare eller Lägenhet) innan utskick.', 400)
    }

    if (message === 'PRICE_REQUIRED') {
      return jsonError('Ange pris (SEK) innan utskick.', 400)
    }
    if (message === 'STATUS_CANCELLATION_FEE_REQUIRED') {
      return jsonError('Ange avbokningsbeloppet enligt uppdragsbekräftelsen (0 kr är tillåtet).', 400)
    }
    if (message === 'STATUS_OBJECT_TYPE_INVALID') {
      return jsonError('Välj om statusbesiktningen avser fastighet eller lägenhet.', 400)
    }
    if (message === 'STATUS_OBJECT_TYPE_NOT_CONFIGURED') {
      return jsonError('Objekttyp för statusbesiktning är inte aktiverad på servern. Kontakta administratören.', 503)
    }

    if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      console.error('[assignments.quick-send] missing env', { env: 'SUPABASE_SERVICE_ROLE_KEY' })
      return jsonError('Servern saknar SUPABASE_SERVICE_ROLE_KEY i env.', 500)
    }

    if (message.includes('RESEND_API_KEY')) {
      console.error('[assignments.quick-send] missing env', { env: 'RESEND_API_KEY' })
      return jsonError('Servern saknar RESEND_API_KEY i env.', 500)
    }

    if (error instanceof AssignmentEmailSendError) {
      console.error('[assignments.quick-send] resend failed', {
        error: message,
        acceptUrl: error.acceptUrl,
      })
      return jsonError('Kunde inte skicka mejl just nu.', 502, { acceptUrl: error.acceptUrl })
    }

    if (isMissingEnvError(error)) {
      console.error('[assignments.quick-send] missing env', { error: message })
      return jsonError('Servern saknar mejlkonfiguration i env.', 500)
    }

    const schemaMismatch =
      message.includes('does not exist') ||
      message.includes('relation') ||
      message.includes('column')

    if (schemaMismatch) {
      console.error('[assignments.quick-send] schema mismatch', { error: message })
      return jsonError(
        'Databasen saknar fält/tabeller som krävs för uppdragsbekräftelser. Kör senaste SQL-migrationer.',
        500
      )
    }

    if (message.startsWith('Kunde inte ')) {
      console.error('[assignments.quick-send] handled domain error', { error: message })
      return jsonError(message, 500)
    }

    console.error('[assignments.quick-send] unhandled error', { error: message })
    return jsonError('Kunde inte skapa och skicka uppdragsbekraftelse.', 500)
  }
}
