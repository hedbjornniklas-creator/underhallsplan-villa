import { NextResponse } from 'next/server'
import { createPublicApplication, type CreatePublicApplicationInput } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const origin = new URL(request.url).origin
    const checks = body?.checks && typeof body.checks === 'object' ? (body.checks as Record<string, unknown>) : {}

    const result = await createPublicApplication(
      {
        brfSlug: String(body.brfSlug ?? ''),
        applicantName: String(body.applicantName ?? ''),
        applicantEmail: String(body.applicantEmail ?? ''),
        applicantPhone: typeof body.applicantPhone === 'string' ? body.applicantPhone : null,
        unitNumberInternal: typeof body.unitNumberInternal === 'string' ? body.unitNumberInternal : null,
        unitNumberSkatteverket:
          typeof body.unitNumberSkatteverket === 'string' ? body.unitNumberSkatteverket : null,
        description: String(body.description ?? ''),
        actionTypeKey: String(body.actionTypeKey ?? ''),
        checks: {
          affectsStructure: Boolean(checks.affectsStructure),
          affectsPlumbing: Boolean(checks.affectsPlumbing),
          affectsVentilation: Boolean(checks.affectsVentilation),
          affectsElectrical: Boolean(checks.affectsElectrical),
          affectsWetRoom: Boolean(checks.affectsWetRoom),
          affectsSurfaceOnly: Boolean(checks.affectsSurfaceOnly),
        },
      } satisfies CreatePublicApplicationInput,
      origin
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'BRF_NOT_FOUND') return jsonError('BRF hittades inte eller har inte publik ansökan aktiverad.', 404)
    if (message === 'APPLICANT_NAME_REQUIRED') return jsonError('Ange namn.', 400)
    if (message === 'APPLICANT_EMAIL_INVALID') return jsonError('Ange en giltig e-postadress.', 400)
    if (message === 'UNIT_NUMBER_REQUIRED') return jsonError('Ange lägenhetsnummer.', 400)
    if (message === 'DESCRIPTION_REQUIRED') return jsonError('Beskriv åtgärden.', 400)
    if (message === 'ACTION_TYPE_REQUIRED') return jsonError('Välj åtgärdstyp.', 400)
    return jsonError(message || 'Kunde inte skapa RenoApp-ärende.', 500)
  }
}
