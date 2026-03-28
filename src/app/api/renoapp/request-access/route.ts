import { NextResponse } from 'next/server'
import { createBrfRequest } from '@/lib/renoapp/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await createBrfRequest({
      name: String(body.name ?? ''),
      orgNumber: typeof body.orgNumber === 'string' ? body.orgNumber : null,
      address: typeof body.address === 'string' ? body.address : null,
      contactName: String(body.contactName ?? ''),
      contactEmail: String(body.contactEmail ?? ''),
      contactPhone: typeof body.contactPhone === 'string' ? body.contactPhone : null,
      message: typeof body.message === 'string' ? body.message : null,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'BRF_NAME_REQUIRED') return jsonError('Ange BRF-namn.', 400)
    if (message === 'ORG_NUMBER_INVALID') return jsonError('Ange organisationsnummer i formatet XXXXXX-XXXX.', 400)
    if (message === 'CONTACT_NAME_REQUIRED') return jsonError('Ange kontaktperson.', 400)
    if (message === 'CONTACT_EMAIL_INVALID') return jsonError('Ange en giltig e-postadress.', 400)
    return jsonError(message || 'Kunde inte skapa intresseanmälan.', 500)
  }
}
