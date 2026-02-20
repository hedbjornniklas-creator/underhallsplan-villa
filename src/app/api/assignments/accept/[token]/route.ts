import { NextResponse } from 'next/server'
import { consumeAssignmentToken, resolvePublicAssignmentByToken } from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PublicAssignmentSummary = {
  id: string
  status: string
  assignment_type: string
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  preliminary_address: string | null
  preferred_date: string | null
  preferred_time: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  accepted_at: string | null
}

type PublicLink = {
  id: string
  assignment_id: string
  org_id: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
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

function getClientIp(request: Request) {
  const forwarded = request.headers.get('x-forwarded-for')
  if (!forwarded) return null
  return forwarded.split(',')[0]?.trim() || null
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

    const now = Date.now()
    const expiresAt = String(link.expires_at ?? '')
    const expired = expiresAt ? new Date(expiresAt).getTime() <= now : true
    const used = Boolean(link.used_at)
    const revoked = Boolean(link.revoked_at)

    return NextResponse.json({
      state: revoked ? 'revoked' : expired ? 'expired' : used ? 'used' : 'open',
      expiresAt: link.expires_at ?? null,
      usedAt: link.used_at ?? null,
      assignment,
    })
  } catch {
    return jsonError('Kunde inte läsa uppdragslänken.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    if (!token || token.length < 20) return jsonError('Ogiltig länk.', 400)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const termsAccepted = body.termsAccepted === true
    const termsVersionRaw = body.termsVersion
    const termsVersion =
      typeof termsVersionRaw === 'string' && termsVersionRaw.trim().length > 0
        ? termsVersionRaw.trim()
        : 'v1'

    if (!termsAccepted) {
      return jsonError('Du måste acceptera villkoren.', 400)
    }

    const payload = {
      customer_name: typeof body.customerName === 'string' ? body.customerName.trim() : null,
      customer_phone: typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null,
      property_address: typeof body.propertyAddress === 'string' ? body.propertyAddress.trim() : null,
      property_postal_code:
        typeof body.propertyPostalCode === 'string' ? body.propertyPostalCode.trim() : null,
      property_city: typeof body.propertyCity === 'string' ? body.propertyCity.trim() : null,
      cadastral_id: typeof body.cadastralId === 'string' ? body.cadastralId.trim() : null,
      invoice_name: typeof body.invoiceName === 'string' ? body.invoiceName.trim() : null,
      invoice_address: typeof body.invoiceAddress === 'string' ? body.invoiceAddress.trim() : null,
      orderer_role: typeof body.ordererRole === 'string' ? body.ordererRole.trim() : null,
      personal_identity_number:
        typeof body.personalIdentityNumber === 'string' ? body.personalIdentityNumber.trim() : null,
    }

    await consumeAssignmentToken({
      token,
      termsVersion,
      payload,
      ip: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message.includes('token_not_valid_or_expired')) {
      return jsonError('Länken är ogiltig eller har gått ut.', 410)
    }
    if (message.includes('token_already_used')) {
      return jsonError('Länken är redan använd.', 409)
    }
    if (message.includes('missing_terms_version')) {
      return jsonError('Villkorsversion saknas.', 400)
    }
    return jsonError('Kunde inte acceptera uppdraget.', 500)
  }
}
