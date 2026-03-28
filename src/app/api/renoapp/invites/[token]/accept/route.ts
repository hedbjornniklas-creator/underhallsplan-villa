import { NextResponse } from 'next/server'
import { acceptBrfInvite } from '@/lib/renoapp/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await acceptBrfInvite(token, {
      password: typeof body.password === 'string' ? body.password : null,
      name: typeof body.name === 'string' ? body.name : null,
      orgNumber: typeof body.orgNumber === 'string' ? body.orgNumber : null,
      propertyDesignation: typeof body.propertyDesignation === 'string' ? body.propertyDesignation : null,
      address: typeof body.address === 'string' ? body.address : null,
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : null,
      postalCode: typeof body.postalCode === 'string' ? body.postalCode : null,
      city: typeof body.city === 'string' ? body.city : null,
      invoiceAddress: typeof body.invoiceAddress === 'string' ? body.invoiceAddress : null,
      invoiceEmail: typeof body.invoiceEmail === 'string' ? body.invoiceEmail : null,
      invoiceReference: typeof body.invoiceReference === 'string' ? body.invoiceReference : null,
      primaryContactName: typeof body.primaryContactName === 'string' ? body.primaryContactName : null,
      primaryContactEmail: typeof body.primaryContactEmail === 'string' ? body.primaryContactEmail : null,
      primaryContactPhone: typeof body.primaryContactPhone === 'string' ? body.primaryContactPhone : null,
      unitCount:
        typeof body.unitCount === 'string' || typeof body.unitCount === 'number' ? body.unitCount : null,
      generalEmail: typeof body.generalEmail === 'string' ? body.generalEmail : null,
      brfPhone: typeof body.brfPhone === 'string' ? body.brfPhone : null,
      technicalContact: typeof body.technicalContact === 'string' ? body.technicalContact : null,
      onboardingComment: typeof body.onboardingComment === 'string' ? body.onboardingComment : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'INVITE_NOT_FOUND') return jsonError('Inviten hittades inte.', 404)
    if (message === 'INVITE_ALREADY_ACCEPTED') return jsonError('Inviten har redan accepterats.', 409)
    if (message === 'INVITE_REVOKED') return jsonError('Inviten har återkallats.', 409)
    if (message === 'INVITE_EXPIRED') return jsonError('Inviten har gått ut.', 409)
    if (message === 'BRF_NAME_REQUIRED') return jsonError('Ange BRF-namn.', 400)
    if (message === 'FULL_NAME_REQUIRED') return jsonError('Ange huvudkontaktens namn.', 400)
    if (message === 'PASSWORD_TOO_SHORT') return jsonError('Lösenordet måste vara minst 8 tecken.', 400)
    if (message === 'ORG_NUMBER_INVALID') return jsonError('Ange organisationsnummer i formatet XXXXXX-XXXX.', 400)
    if (message === 'PROPERTY_DESIGNATION_REQUIRED') return jsonError('Ange fastighetsbeteckning.', 400)
    if (message === 'ADDRESS_REQUIRED') return jsonError('Ange gatuadress.', 400)
    if (message === 'POSTAL_CODE_INVALID') return jsonError('Ange postnummer i formatet 123 45.', 400)
    if (message === 'CITY_REQUIRED') return jsonError('Ange ort.', 400)
    if (message === 'INVOICE_ADDRESS_REQUIRED') return jsonError('Ange fakturaadress.', 400)
    if (message === 'INVOICE_EMAIL_INVALID') return jsonError('Ange giltig faktura-e-post.', 400)
    if (message === 'PRIMARY_CONTACT_NAME_REQUIRED') return jsonError('Ange huvudkontaktens namn.', 400)
    if (message === 'PRIMARY_CONTACT_EMAIL_INVALID') return jsonError('Invite-adressen är ogiltig.', 400)
    if (message === 'PRIMARY_CONTACT_PHONE_REQUIRED') return jsonError('Ange huvudkontaktens telefonnummer.', 400)
    if (message === 'UNIT_COUNT_INVALID') return jsonError('Ange antal lägenheter som ett positivt heltal.', 400)
    if (message === 'GENERAL_EMAIL_INVALID') return jsonError('Ange giltig allmän BRF-e-post.', 400)
    if (message === 'EXISTING_USER_LOGIN_REQUIRED') {
      return jsonError('E-postadressen har redan ett konto. Logga in först och öppna inviten igen.', 409)
    }
    if (message === 'INVITE_EMAIL_MISMATCH') {
      return jsonError('Du är inloggad med fel e-postadress för den här inviten.', 409)
    }
    return jsonError(message || 'Kunde inte acceptera invite.', 500)
  }
}
