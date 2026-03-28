import { NextResponse } from 'next/server'
import { listEditableRenoAppBrfs, updateEditableRenoAppBrf } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listEditableRenoAppBrfs()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    return jsonError(message || 'Kunde inte läsa BRF-data.', 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const item = await updateEditableRenoAppBrf({
      brfId: typeof body.brfId === 'string' ? body.brfId : '',
      name: typeof body.name === 'string' ? body.name : '',
      orgNumber: typeof body.orgNumber === 'string' ? body.orgNumber : '',
      propertyDesignation: typeof body.propertyDesignation === 'string' ? body.propertyDesignation : '',
      address: typeof body.address === 'string' ? body.address : '',
      addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : null,
      postalCode: typeof body.postalCode === 'string' ? body.postalCode : '',
      city: typeof body.city === 'string' ? body.city : '',
      generalEmail: typeof body.generalEmail === 'string' ? body.generalEmail : null,
      brfPhone: typeof body.brfPhone === 'string' ? body.brfPhone : null,
      invoiceAddress: typeof body.invoiceAddress === 'string' ? body.invoiceAddress : '',
      invoiceEmail: typeof body.invoiceEmail === 'string' ? body.invoiceEmail : '',
      invoiceReference: typeof body.invoiceReference === 'string' ? body.invoiceReference : null,
      primaryContactName: typeof body.primaryContactName === 'string' ? body.primaryContactName : '',
      primaryContactEmail: typeof body.primaryContactEmail === 'string' ? body.primaryContactEmail : '',
      primaryContactPhone: typeof body.primaryContactPhone === 'string' ? body.primaryContactPhone : '',
      unitCount:
        typeof body.unitCount === 'string' || typeof body.unitCount === 'number' ? body.unitCount : null,
      technicalContact: typeof body.technicalContact === 'string' ? body.technicalContact : null,
      applyIntroText: typeof body.applyIntroText === 'string' ? body.applyIntroText : null,
      isPublicApplyEnabled: Boolean(body.isPublicApplyEnabled),
      isPublicApplyListed: Boolean(body.isPublicApplyListed),
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'BRF_NOT_FOUND') return jsonError('BRF hittades inte.', 404)
    if (message === 'NAME_REQUIRED') return jsonError('Ange BRF-namn.', 400)
    if (message === 'ORG_NUMBER_INVALID') return jsonError('Ange organisationsnummer i formatet XXXXXX-XXXX.', 400)
    if (message === 'PROPERTY_DESIGNATION_REQUIRED') return jsonError('Ange fastighetsbeteckning.', 400)
    if (message === 'ADDRESS_REQUIRED') return jsonError('Ange gatuadress.', 400)
    if (message === 'POSTAL_CODE_INVALID') return jsonError('Ange postnummer i formatet 123 45.', 400)
    if (message === 'CITY_REQUIRED') return jsonError('Ange ort.', 400)
    if (message === 'INVOICE_ADDRESS_REQUIRED') return jsonError('Ange fakturaadress.', 400)
    if (message === 'INVOICE_EMAIL_INVALID') return jsonError('Ange giltig faktura-e-post.', 400)
    if (message === 'PRIMARY_CONTACT_NAME_REQUIRED') return jsonError('Ange kontaktpersonens namn.', 400)
    if (message === 'PRIMARY_CONTACT_EMAIL_INVALID') return jsonError('Ange giltig e-post för kontaktpersonen.', 400)
    if (message === 'PRIMARY_CONTACT_PHONE_REQUIRED') return jsonError('Ange kontaktpersonens telefon.', 400)
    if (message === 'GENERAL_EMAIL_INVALID') return jsonError('Ange giltig allmän BRF-e-post.', 400)
    if (message === 'UNIT_COUNT_INVALID') return jsonError('Antal lägenheter måste vara ett positivt heltal.', 400)
    return jsonError(message || 'Kunde inte uppdatera BRF.', 500)
  }
}
