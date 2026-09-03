import { NextResponse } from 'next/server'
import { isIP } from 'node:net'
import {
  consumeAssignmentToken,
  getAssignmentById,
  getProfileContact,
  listAddonOffersForProfile,
  resolvePublicAssignmentByToken,
  sendAssignmentAcceptedNotice,
} from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  getAllAssignmentTermsDocuments,
  getAssignmentTermsDocument,
  resolveAssignmentTermsRole,
} from '@/lib/assignments/terms'
import { isBaseAssignmentAddonKey } from '@/lib/assignments/addons'
import { resolveInspectorCertificationSummary } from '@/lib/certifications/profileResolver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/
const HASH_REGEX = /^[0-9a-f]{64}$/
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type PublicState = 'open' | 'used' | 'expired' | 'revoked' | 'outdated'

type PublicAssignmentSummary = {
  id: string
  status: string
  assignment_type: string
  responsible_profile_id: string | null
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_postal_code: string | null
  customer_city: string | null
  customer_address: string | null
  preliminary_address: string | null
  scope_description: string | null
  preferred_date: string | null
  preferred_time: string | null
  price_amount: number | null
  currency: string
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  property_municipality: string | null
  property_owner_name: string | null
  cadastral_id: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
  invoice_name: string | null
  invoice_address: string | null
  invoice_email: string | null
  personal_identity_number: string | null
  orderer_role: string | null
  accepted_at: string | null
  assignment_details: Record<string, unknown> | null
}

type PublicInspectorProfile = {
  full_name: string | null
  sbr_group: string | null
  sbr_status: string | null
  membership_number: string | null
  certification_number: string | null
  phone: string | null
  email: string | null
  company_name: string | null
  company_orgno: string | null
  company_address: string | null
  company_postal_code: string | null
  company_city: string | null
  avatar_path: string | null
}

type PublicAddonOffer = {
  addon_service_id: string
  key: string
  name: string
  description: string | null
  price_amount: number
  currency: string
}

type PublicLink = {
  id: string
  assignment_id: string
  org_id: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
  terms_version: string | null
  assignments: PublicAssignmentSummary | PublicAssignmentSummary[] | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeAssignment(row: PublicLink) {
  const assignmentValue = row.assignments
  if (!assignmentValue) return null
  if (Array.isArray(assignmentValue)) return assignmentValue[0] ?? null
  return assignmentValue
}

function normalizeClientIp(value: string | null) {
  if (!value) return null
  let candidate = value.trim()
  if (!candidate) return null

  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.split(':')[0] ?? candidate
  }

  const bracketedIpv6 = candidate.match(/^\[([0-9a-fA-F:]+)\]:(\d+)$/)
  if (bracketedIpv6?.[1]) {
    candidate = bracketedIpv6[1]
  }

  return isIP(candidate) ? candidate : null
}

function getClientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0] ?? null
    const normalized = normalizeClientIp(first)
    if (normalized) return normalized
  }

  return normalizeClientIp(request.headers.get('x-real-ip'))
}

function parsePrice(value: unknown) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null
    return Number(value.toFixed(2))
  }
  if (typeof value === 'string') {
    const normalized = Number(value.replace(',', '.').trim())
    if (!Number.isFinite(normalized) || normalized < 0) return null
    return Number(normalized.toFixed(2))
  }
  return null
}

function normalizeRoleText(value: string | null | undefined) {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function roleLooksLikeApartment(value: string | null | undefined) {
  const normalized = normalizeRoleText(value)
  return normalized.includes('lagenhet') || normalized.includes('apartment') || normalized.includes('apt')
}

function requiresConsumerEarlyStartConsent(preferredDate: string) {
  if (!DATE_REGEX.test(preferredDate)) return false
  const serviceDate = Date.parse(`${preferredDate}T23:59:59.999Z`)
  if (!Number.isFinite(serviceDate)) return false
  return serviceDate < Date.now() + 14 * 24 * 60 * 60 * 1000
}

function toState(link: PublicLink): PublicState {
  const now = Date.now()
  const expiresAt = String(link.expires_at ?? '')
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : true
  const used = Boolean(link.used_at)
  const revoked = Boolean(link.revoked_at)
  const assignment = normalizeAssignment(link)
  const cancelled = assignment?.status?.toLowerCase() === 'cancelled'
  const termsRole = assignment
    ? resolveAssignmentTermsRole({
        assignmentType: assignment.assignment_type,
        ordererRole: assignment.orderer_role,
        assignmentDetails: assignment.assignment_details,
      })
    : null
  const expectedTermsVersion = termsRole ? getAssignmentTermsDocument(termsRole).version : null
  const outdated = !link.terms_version || !expectedTermsVersion || link.terms_version !== expectedTermsVersion

  if (cancelled) return 'revoked'
  if (revoked) return 'revoked'
  if (expired) return 'expired'
  if (used) return 'used'
  if (outdated) return 'outdated'
  return 'open'
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    if (!token || token.length < 20) return jsonError('Ogiltig länk.', 400)

    const link = await resolvePublicAssignmentByToken(token)
    if (!link) return jsonError('Länken är ogiltig eller borttagen.', 404)

    const assignment = normalizeAssignment(link as PublicLink)
    if (!assignment) return jsonError('Uppdraget kunde inte hittas.', 404)

    const terms = getAllAssignmentTermsDocuments()
    const assignmentTermsRole = resolveAssignmentTermsRole({
      assignmentType: assignment.assignment_type,
      ordererRole: assignment.orderer_role,
      assignmentDetails: assignment.assignment_details,
    })
    const assignmentTerms = assignmentTermsRole
      ? getAssignmentTermsDocument(assignmentTermsRole)
      : terms.seller
    let inspector: PublicInspectorProfile | null = null
    let addonOffers: PublicAddonOffer[] = []
    let selectedAddonServiceIds: string[] = []

    if (assignment.responsible_profile_id) {
      const admin = createSupabaseAdminClient()
      const { data: inspectorData } = await admin
        .from('profiles')
        .select(
          'full_name,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path'
        )
        .eq('id', assignment.responsible_profile_id)
        .maybeSingle()

      const { summary } = await resolveInspectorCertificationSummary(admin, {
        profileId: assignment.responsible_profile_id,
        orgId: link.org_id,
      })

      inspector = inspectorData
        ? {
            full_name: inspectorData.full_name ?? null,
            sbr_group: summary.sbr_group,
            sbr_status: summary.sbr_status,
            membership_number: summary.membership_number,
            certification_number: summary.certification_number,
            phone: inspectorData.phone ?? null,
            email: inspectorData.email ?? null,
            company_name: inspectorData.company_name ?? null,
            company_orgno: inspectorData.company_orgno ?? null,
            company_address: inspectorData.company_address ?? null,
            company_postal_code: inspectorData.company_postal_code ?? null,
            company_city: inspectorData.company_city ?? null,
            avatar_path: inspectorData.avatar_path ?? null,
          }
        : null

      if (assignment.assignment_type !== 'TU' && assignment.assignment_type !== 'EB') {
        try {
          addonOffers = await listAddonOffersForProfile({
            orgId: link.org_id,
            profileId: assignment.responsible_profile_id,
          })
        } catch (addonError) {
          console.error('[assignments.accept] failed to load addon offers', {
            token_prefix: token.slice(0, 8),
            error: addonError instanceof Error ? addonError.message : String(addonError),
          })
        }

        const { data: addonOrderData } = await admin
          .from('assignment_addon_orders')
          .select('addon_service_id')
          .eq('assignment_id', assignment.id)
          .eq('org_id', link.org_id)

        selectedAddonServiceIds = ((addonOrderData ?? []) as Array<{ addon_service_id: string | null }>)
          .map((row) => row.addon_service_id)
          .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      }
    }

    return NextResponse.json({
      state: toState(link as PublicLink),
      expiresAt: link.expires_at ?? null,
      usedAt: link.used_at ?? null,
      assignment,
      inspector,
      addonOffers,
      selectedAddonServiceIds,
      terms: {
        version: assignmentTerms.version,
        documents: {
          seller: {
            hash: terms.seller.documentHash,
            text: terms.seller.text,
            templateId: terms.seller.templateId,
          },
          buyer: {
            hash: terms.buyer.documentHash,
            text: terms.buyer.text,
            templateId: terms.buyer.templateId,
          },
          apartment: {
            hash: terms.apartment.documentHash,
            text: terms.apartment.text,
            templateId: terms.apartment.templateId,
          },
          technical: {
            hash: terms.technical.documentHash,
            text: terms.technical.text,
            templateId: terms.technical.templateId,
          },
          construction: {
            hash: terms.construction.documentHash,
            text: terms.construction.text,
            templateId: terms.construction.templateId,
          },
          constructionBusiness: {
            hash: terms.constructionBusiness.documentHash,
            text: terms.constructionBusiness.text,
            templateId: terms.constructionBusiness.templateId,
          },
          constructionConsumer: {
            hash: terms.constructionConsumer.documentHash,
            text: terms.constructionConsumer.text,
            templateId: terms.constructionConsumer.templateId,
          },
        },
      },
    })
  } catch {
    return jsonError('Kunde inte läsa uppdragslänken.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  let tokenForLog = ''

  try {
    const { token } = await context.params
    tokenForLog = token
    if (!token || token.length < 20) return jsonError('Ogiltig länk.', 400)

    const link = await resolvePublicAssignmentByToken(token)
    if (!link) return jsonError('Länken är ogiltig eller borttagen.', 404)

    const assignment = normalizeAssignment(link as PublicLink)
    if (!assignment) return jsonError('Uppdraget kunde inte hittas.', 404)
    if (assignment.status?.toLowerCase() === 'cancelled') {
      return jsonError('Den här länken är inte längre aktiv.', 410)
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const termsAccepted = body.termsAccepted === true
    if (!termsAccepted) {
      return jsonError('Du måste acceptera villkoren.', 400)
    }

    const isTechnicalAssignment = assignment.assignment_type === 'TU'
    const isEbAssignment = assignment.assignment_type === 'EB'
    const termsRole = resolveAssignmentTermsRole({
      assignmentType: assignment.assignment_type,
      ordererRole: assignment.orderer_role,
      assignmentDetails: assignment.assignment_details,
    })
    if (!termsRole) {
      return jsonError('Välj om du är köpare, säljare eller lägenhetsköpare.', 409)
    }
    const terms = getAssignmentTermsDocument(termsRole)

    const termsVersion = typeof body.termsVersion === 'string' ? body.termsVersion.trim() : ''
    if (!termsVersion) return jsonError('Villkorsversion saknas.', 400)
    if (termsVersion !== terms.version) {
      return jsonError('Villkoren har uppdaterats. Begär en ny länk från besiktningsföretaget.', 409)
    }

    const termsDocumentHashRaw =
      typeof body.termsDocumentHash === 'string' ? body.termsDocumentHash.trim().toLowerCase() : ''
    if (!termsDocumentHashRaw || !HASH_REGEX.test(termsDocumentHashRaw)) {
      return jsonError('Dokumentfingeravtryck saknas eller är ogiltigt.', 400)
    }
    if (termsDocumentHashRaw !== terms.documentHash) {
      return jsonError('Villkorsdokumentet stämmer inte. Ladda om sidan och försök igen.', 409)
    }

    const customerEmail =
      typeof body.customerEmail === 'string' ? body.customerEmail.trim().toLowerCase() : ''
    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig e-postadress.', 400)
    }

    const preferredDate = isEbAssignment
      ? assignment.preferred_date?.trim() ?? ''
      : typeof body.preferredDate === 'string'
        ? body.preferredDate.trim()
        : ''
    if (!DATE_REGEX.test(preferredDate)) {
      return jsonError(
        isEbAssignment ? 'Besiktningsföretaget behöver ange ett giltigt datum.' : 'Ange ett giltigt datum.',
        400
      )
    }

    const preferredTime = isEbAssignment
      ? assignment.preferred_time?.trim() ?? ''
      : typeof body.preferredTime === 'string'
        ? body.preferredTime.trim()
        : ''
    if (!TIME_REGEX.test(preferredTime)) {
      return jsonError(
        isEbAssignment ? 'Besiktningsföretaget behöver ange en giltig tid.' : 'Ange en giltig tid.',
        400
      )
    }

    const isConsumerEbAssignment = termsRole === 'construction_consumer'
    const consumerWithdrawalAcknowledged = body.consumerWithdrawalAcknowledged === true
    const startDuringWithdrawalPeriod = body.startDuringWithdrawalPeriod === true
    const earlyStartConsentRequired =
      isConsumerEbAssignment && requiresConsumerEarlyStartConsent(preferredDate)

    if (isConsumerEbAssignment && !consumerWithdrawalAcknowledged) {
      return jsonError('Bekräfta att du har tagit del av informationen om ångerrätt.', 400)
    }
    if (earlyStartConsentRequired && !startDuringWithdrawalPeriod) {
      return jsonError(
        'Besiktningen infaller under ångerfristen. Du behöver uttryckligen begära att uppdraget får påbörjas under denna tid.',
        400
      )
    }

    const cadastralId = typeof body.cadastralId === 'string' ? body.cadastralId.trim() : ''
    const brfName = typeof body.brfName === 'string' ? body.brfName.trim() : ''
    const apartmentNumber = typeof body.apartmentNumber === 'string' ? body.apartmentNumber.trim() : ''
    const apartmentHolderName =
      typeof body.apartmentHolderName === 'string' ? body.apartmentHolderName.trim() : ''
    const propertyOwnerName =
      typeof body.propertyOwnerName === 'string' ? body.propertyOwnerName.trim() : ''
    const isApartmentObject = isTechnicalAssignment
      ? roleLooksLikeApartment(assignment.orderer_role) || Boolean(brfName || apartmentNumber)
      : termsRole === 'apartment'

    if (isApartmentObject) {
      if (!brfName || !apartmentNumber || (!isTechnicalAssignment && !apartmentHolderName)) {
        return jsonError('Ange BRF och lägenhetsnummer.', 400)
      }
    } else if (!cadastralId || (!isTechnicalAssignment && !isEbAssignment && !propertyOwnerName)) {
      return jsonError('Ange fastighetsbeteckning.', 400)
    }

    const roleLabel =
      termsRole === 'technical'
        ? isApartmentObject
          ? 'Teknisk utredning - Lägenhet'
          : 'Teknisk utredning - Villa'
        : termsRole === 'construction_consumer'
          ? 'Entreprenadbesiktning - Konsument'
        : termsRole === 'construction_business'
          ? 'Entreprenadbesiktning - Företag'
        : termsRole === 'construction'
          ? 'Entreprenadbesiktning'
        : termsRole === 'buyer'
          ? 'Köpare'
          : termsRole === 'apartment'
            ? 'Lägenhet'
            : 'Säljare'

    const priceAmount = parsePrice(assignment.price_amount)
    if (priceAmount === null) {
      return jsonError('Pris är obligatoriskt och måste vara giltigt.', 409)
    }

    const selectedAddonServiceIdsInput = isTechnicalAssignment || isEbAssignment ? [] : body.selectedAddonServiceIds
    let selectedAddonServiceIds: string[] = []
    if (selectedAddonServiceIdsInput !== undefined) {
      if (!Array.isArray(selectedAddonServiceIdsInput)) {
        return jsonError('Ogiltigt format för tilläggsuppdrag.', 400)
      }

      for (const value of selectedAddonServiceIdsInput) {
        if (typeof value !== 'string') {
          return jsonError('Ogiltigt format för tilläggsuppdrag.', 400)
        }
        const normalized = value.trim()
        if (normalized !== '') selectedAddonServiceIds.push(normalized)
      }

      selectedAddonServiceIds = [...new Set(selectedAddonServiceIds)]
    }

    if (selectedAddonServiceIds.length > 0) {
      const selectedUuidIds = selectedAddonServiceIds.filter((value) => UUID_REGEX.test(value))
      if (selectedUuidIds.length > 0) {
        const admin = createSupabaseAdminClient()
        const { data: selectedAddonRows, error: selectedAddonError } = await admin
          .from('settings_addon_services')
          .select('id,key')
          .in('id', selectedUuidIds)

        if (selectedAddonError) {
          throw new Error(selectedAddonError.message ?? 'Kunde inte verifiera tilläggsuppdrag.')
        }

        const baseAddonIds = new Set(
          ((selectedAddonRows ?? []) as Array<{ id: string; key: string | null }>)
            .filter((row) => isBaseAssignmentAddonKey(row.key))
            .map((row) => row.id)
        )

        selectedAddonServiceIds = selectedAddonServiceIds.filter((id) => !baseAddonIds.has(id))
      }
    }

    const payload = {
      customer_name: typeof body.customerName === 'string' ? body.customerName.trim() : null,
      customer_email: customerEmail,
      customer_phone: typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null,
      customer_postal_code:
        typeof body.customerPostalCode === 'string' ? body.customerPostalCode.trim() : null,
      customer_city: typeof body.customerCity === 'string' ? body.customerCity.trim() : null,
      customer_address: typeof body.customerAddress === 'string' ? body.customerAddress.trim() : null,
      property_address: typeof body.propertyAddress === 'string' ? body.propertyAddress.trim() : null,
      property_postal_code:
        typeof body.propertyPostalCode === 'string' ? body.propertyPostalCode.trim() : null,
      property_city: typeof body.propertyCity === 'string' ? body.propertyCity.trim() : null,
      property_municipality:
        typeof body.propertyMunicipality === 'string' ? body.propertyMunicipality.trim() : null,
      property_owner_name: isApartmentObject ? null : propertyOwnerName,
      cadastral_id: isApartmentObject ? null : cadastralId,
      brf_name: isApartmentObject ? brfName : null,
      apartment_number: isApartmentObject ? apartmentNumber : null,
      apartment_holder_name: isApartmentObject ? apartmentHolderName : null,
      scope_description:
        typeof body.scopeDescription === 'string' ? body.scopeDescription.trim() : assignment.scope_description,
      preferred_date: preferredDate,
      preferred_time: preferredTime,
      price_amount: priceAmount,
      currency: 'SEK',
      orderer_role: roleLabel,
      terms_document_hash: terms.documentHash,
      addon_service_ids: selectedAddonServiceIds,
      assignment_details:
        assignment.assignment_details && typeof assignment.assignment_details === 'object'
          ? assignment.assignment_details
          : {},
      consumer_withdrawal_acknowledged: isConsumerEbAssignment
        ? consumerWithdrawalAcknowledged
        : null,
      consumer_early_start_required: isConsumerEbAssignment ? earlyStartConsentRequired : null,
      consumer_early_start_requested: isConsumerEbAssignment
        ? startDuringWithdrawalPeriod
        : null,
    }

    await consumeAssignmentToken({
      token,
      termsVersion: terms.version,
      payload,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    // Keep customer postal code/city in sync even if RPC function is older in DB.
    const admin = createSupabaseAdminClient()
    const { error: contactUpdateError } = await admin
      .from('assignments')
      .update({
        customer_postal_code: payload.customer_postal_code,
        customer_city: payload.customer_city,
        property_owner_name: payload.property_owner_name,
        cadastral_id: payload.cadastral_id,
        brf_name: payload.brf_name,
        apartment_number: payload.apartment_number,
        apartment_holder_name: payload.apartment_holder_name,
        scope_description: payload.scope_description,
        orderer_role: payload.orderer_role,
      })
      .eq('org_id', link.org_id)
      .eq('id', assignment.id)

    if (contactUpdateError) {
      console.error('[assignments.accept] failed to update customer postal/city after consume', {
        assignmentId: assignment.id,
        orgId: link.org_id,
        error: contactUpdateError.message,
      })
    }

    let confirmationEmailSent = false
    try {
      const updatedAssignment = await getAssignmentById(link.org_id, assignment.id)
      if (updatedAssignment) {
        const responsibleProfile = await getProfileContact(updatedAssignment.responsible_profile_id)
        await sendAssignmentAcceptedNotice({
          assignment: updatedAssignment,
          orgName: null,
          requestedByUserId: updatedAssignment.responsible_profile_id,
          responsibleEmail: responsibleProfile?.email ?? null,
          acceptancePayload: payload,
        })
        confirmationEmailSent = true
      }
    } catch (mailError) {
      console.error('[assignments.accept] failed to send automatic confirmation email', {
        token_prefix: token.slice(0, 8),
        error: mailError instanceof Error ? mailError.message : String(mailError),
      })
    }

    return NextResponse.json({
      ok: true,
      assignmentId: typeof body.assignmentId === 'string' ? body.assignmentId : null,
      termsVersion: terms.version,
      confirmationEmailSent,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    const lowered = message.toLowerCase()

    console.error('[assignments.accept] unhandled error', {
      token_prefix: tokenForLog.slice(0, 8),
      message,
    })

    if (message.includes('token_not_valid_or_expired')) {
      return jsonError('Länken är ogiltig eller har gått ut.', 410)
    }
    if (message.includes('token_already_used')) {
      return jsonError('Länken är redan använd.', 409)
    }
    if (
      message.includes('terms_version_required_for_link') ||
      message.includes('terms_version_mismatch')
    ) {
      return jsonError('Villkoren har uppdaterats. Begär en ny länk från besiktningsföretaget.', 409)
    }
    if (message.includes('assignment_cancelled')) {
      return jsonError('Den här länken är inte längre aktiv.', 410)
    }
    if (message.includes('missing_terms_version')) {
      return jsonError('Villkorsversion saknas.', 400)
    }
    if (message.includes('missing_terms_document_hash') || message.includes('invalid_terms_document_hash')) {
      return jsonError('Dokumentfingeravtryck saknas eller är ogiltigt.', 400)
    }
    if (message.includes('invalid_addon_service_ids')) {
      return jsonError('Ogiltigt format för tilläggsuppdrag.', 400)
    }
    if (message.includes('invalid_selected_addon_services')) {
      return jsonError('Ett eller flera valda tilläggsuppdrag är inte tillgängliga.', 400)
    }
    if (message.includes('responsible_profile_missing')) {
      return jsonError('Uppdraget saknar ansvarig besiktningsman.', 409)
    }
    if (lowered.includes('invalid input syntax for type inet')) {
      return jsonError('Kunde inte verifiera anslutningsinformation. Försök igen.', 400)
    }
    if (
      lowered.includes('could not find the function public.consume_assignment_token') ||
      lowered.includes('schema cache')
    ) {
      return jsonError('Servern saknar senaste databasfunktion för godkännande.', 500)
    }
    if (lowered.includes('function digest(') && lowered.includes('does not exist')) {
      return jsonError('Servern saknar pgcrypto-konfiguration för godkännande.', 500)
    }

    return jsonError('Kunde inte acceptera uppdraget.', 500)
  }
}
