import { NextResponse } from 'next/server'
import { isIP } from 'node:net'
import {
  consumeAssignmentToken,
  listAddonOffersForProfile,
  resolvePublicAssignmentByToken,
} from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  ASSIGNMENT_TERMS_VERSION,
  getAllAssignmentTermsDocuments,
  getAssignmentTermsDocument,
  parseAssignmentTermsRole,
} from '@/lib/assignments/terms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const TIME_REGEX = /^\d{2}:\d{2}(:\d{2})?$/
const HASH_REGEX = /^[0-9a-f]{64}$/

type PublicState = 'open' | 'used' | 'expired' | 'revoked' | 'outdated'

type PublicAssignmentSummary = {
  id: string
  status: string
  assignment_type: string
  responsible_profile_id: string | null
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_address: string | null
  preliminary_address: string | null
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
  orderer_role: string | null
  accepted_at: string | null
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

function toState(link: PublicLink): PublicState {
  const now = Date.now()
  const expiresAt = String(link.expires_at ?? '')
  const expired = expiresAt ? new Date(expiresAt).getTime() <= now : true
  const used = Boolean(link.used_at)
  const revoked = Boolean(link.revoked_at)
  const assignment = normalizeAssignment(link)
  const cancelled = assignment?.status?.toLowerCase() === 'cancelled'
  const outdated = !link.terms_version || link.terms_version !== ASSIGNMENT_TERMS_VERSION

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
    let inspector: PublicInspectorProfile | null = null
    let addonOffers: PublicAddonOffer[] = []
    let selectedAddonServiceIds: string[] = []

    if (assignment.responsible_profile_id) {
      const admin = createSupabaseAdminClient()
      const { data: inspectorData } = await admin
        .from('profiles')
        .select(
          'full_name,sbr_group,sbr_status,membership_number,certification_number,phone,email,company_name,company_orgno,company_address,company_postal_code,company_city,avatar_path'
        )
        .eq('id', assignment.responsible_profile_id)
        .maybeSingle()

      inspector = (inspectorData ?? null) as PublicInspectorProfile | null

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

    return NextResponse.json({
      state: toState(link as PublicLink),
      expiresAt: link.expires_at ?? null,
      usedAt: link.used_at ?? null,
      assignment,
      inspector,
      addonOffers,
      selectedAddonServiceIds,
      terms: {
        version: ASSIGNMENT_TERMS_VERSION,
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

    const ordererRoleRaw = typeof body.ordererRole === 'string' ? body.ordererRole.trim() : ''
    const termsRole = parseAssignmentTermsRole(ordererRoleRaw)
    if (!termsRole) {
      return jsonError('Välj om du är köpare, säljare eller lägenhetsköpare.', 400)
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

    const preferredDate = typeof body.preferredDate === 'string' ? body.preferredDate.trim() : ''
    if (!DATE_REGEX.test(preferredDate)) {
      return jsonError('Ange ett giltigt datum.', 400)
    }

    const preferredTime = typeof body.preferredTime === 'string' ? body.preferredTime.trim() : ''
    if (!TIME_REGEX.test(preferredTime)) {
      return jsonError('Ange en giltig tid.', 400)
    }

    const roleLabel =
      termsRole === 'buyer'
        ? 'Köpare'
        : termsRole === 'apartment'
          ? 'Lägenhet'
          : 'Säljare'

    const priceAmount = parsePrice(body.priceAmount)
    if (priceAmount === null) {
      return jsonError('Pris är obligatoriskt och måste vara giltigt.', 400)
    }

    const selectedAddonServiceIdsInput = body.selectedAddonServiceIds
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

    const payload = {
      customer_name: typeof body.customerName === 'string' ? body.customerName.trim() : null,
      customer_email: customerEmail,
      customer_phone: typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null,
      customer_address: typeof body.customerAddress === 'string' ? body.customerAddress.trim() : null,
      property_address: typeof body.propertyAddress === 'string' ? body.propertyAddress.trim() : null,
      property_municipality:
        typeof body.propertyMunicipality === 'string' ? body.propertyMunicipality.trim() : null,
      property_owner_name:
        typeof body.propertyOwnerName === 'string' ? body.propertyOwnerName.trim() : null,
      cadastral_id: typeof body.cadastralId === 'string' ? body.cadastralId.trim() : null,
      preferred_date: preferredDate,
      preferred_time: preferredTime,
      price_amount: priceAmount,
      currency: 'SEK',
      orderer_role: roleLabel,
      terms_document_hash: terms.documentHash,
      addon_service_ids: selectedAddonServiceIds,
    }

    await consumeAssignmentToken({
      token,
      termsVersion: terms.version,
      payload,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({
      ok: true,
      assignmentId: typeof body.assignmentId === 'string' ? body.assignmentId : null,
      termsVersion: terms.version,
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
