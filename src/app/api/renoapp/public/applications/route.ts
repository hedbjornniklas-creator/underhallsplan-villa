import { NextResponse } from 'next/server'
import { upsertPublicApplication, type CreatePublicApplicationInput } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const origin = new URL(request.url).origin
    const actionTypeKeys = Array.isArray(body.actionTypeKeys)
      ? body.actionTypeKeys.filter((value): value is string => typeof value === 'string')
      : typeof body.actionTypeKey === 'string' && body.actionTypeKey.trim()
        ? [body.actionTypeKey]
        : []
    const questionAnswers =
      body.questionAnswers && typeof body.questionAnswers === 'object' && !Array.isArray(body.questionAnswers)
        ? Object.fromEntries(
            Object.entries(body.questionAnswers as Record<string, unknown>).map(([questionKey, value]) => [
              questionKey,
              Array.isArray(value)
                ? value.filter((item): item is string => typeof item === 'string')
                : typeof value === 'string'
                  ? [value]
                  : [],
            ])
          )
        : {}
    const participantEntries = Array.isArray(body.participantEntries)
      ? body.participantEntries
          .map((item) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return null
            const row = item as Record<string, unknown>

            return {
              participantRoleId:
                typeof row.participantRoleId === 'string' ? row.participantRoleId : '',
              companyName: typeof row.companyName === 'string' ? row.companyName : null,
              orgNumber: typeof row.orgNumber === 'string' ? row.orgNumber : null,
              contactName: typeof row.contactName === 'string' ? row.contactName : null,
              email: typeof row.email === 'string' ? row.email : null,
              phone: typeof row.phone === 'string' ? row.phone : null,
              certificationReference:
                typeof row.certificationReference === 'string' ? row.certificationReference : null,
              hasVerifiedAuthorization:
                typeof row.hasVerifiedAuthorization === 'boolean' ? row.hasVerifiedAuthorization : false,
              acceptsResponsibility:
                typeof row.acceptsResponsibility === 'boolean' ? row.acceptsResponsibility : false,
            }
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
      : []

    const result = await upsertPublicApplication(
      {
        brfSlug: String(body.brfSlug ?? ''),
        draftToken: typeof body.draftToken === 'string' ? body.draftToken : null,
        mode: body.mode === 'draft' ? 'draft' : 'submit',
        applicantName: String(body.applicantName ?? ''),
        applicantEmail: String(body.applicantEmail ?? ''),
        applicantPhone: typeof body.applicantPhone === 'string' ? body.applicantPhone : null,
        unitNumberInternal: typeof body.unitNumberInternal === 'string' ? body.unitNumberInternal : null,
        unitNumberSkatteverket:
          typeof body.unitNumberSkatteverket === 'string' ? body.unitNumberSkatteverket : null,
        description: String(body.description ?? ''),
        replyMessage: typeof body.replyMessage === 'string' ? body.replyMessage : null,
        contractorName: typeof body.contractorName === 'string' ? body.contractorName : null,
        contractorOrgNumber: typeof body.contractorOrgNumber === 'string' ? body.contractorOrgNumber : null,
        contractorEmail: typeof body.contractorEmail === 'string' ? body.contractorEmail : null,
        contractorPhone: typeof body.contractorPhone === 'string' ? body.contractorPhone : null,
        contractorHasRequiredCertification:
          typeof body.contractorHasRequiredCertification === 'boolean'
            ? body.contractorHasRequiredCertification
            : false,
        participantEntries,
        actionTypeKeys,
        questionAnswers,
      } satisfies CreatePublicApplicationInput,
      origin
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'BRF_NOT_FOUND') {
      return jsonError('BRF hittades inte eller har inte publik ansokan aktiverad.', 404)
    }
    if (message === 'DRAFT_LINK_INVALID') {
      return jsonError('Utkastslanken ar inte langre giltig.', 409)
    }
    if (message === 'CASE_LOCKED') {
      return jsonError('Ärendet är låst för ändringar efter beslut.', 409)
    }
    if (message === 'APPLICANT_NAME_REQUIRED') return jsonError('Ange namn.', 400)
    if (message === 'APPLICANT_EMAIL_REQUIRED') return jsonError('Ange e-postadress.', 400)
    if (message === 'APPLICANT_EMAIL_INVALID') return jsonError('Ange en giltig e-postadress.', 400)
    if (message === 'APPLICANT_PHONE_REQUIRED') return jsonError('Ange telefon.', 400)
    if (message === 'UNIT_NUMBER_INTERNAL_REQUIRED') return jsonError('Ange internt lägenhetsnummer.', 400)
    if (message === 'UNIT_NUMBER_SKATTEVERKET_REQUIRED') return jsonError('Ange Skatteverkets lägenhetsnummer.', 400)
    if (message === 'UNIT_NUMBER_REQUIRED') return jsonError('Ange lagenhetsnummer.', 400)
    if (message === 'DESCRIPTION_REQUIRED') return jsonError('Beskriv atgarden.', 400)
    if (message === 'ACTION_TYPE_REQUIRED') return jsonError('Valj minst en renoveringstyp.', 400)
    if (message === 'QUESTION_REQUIRED') return jsonError('Besvara alla obligatoriska fragor.', 400)
    return jsonError(message || 'Kunde inte skapa RenoApp-arende.', 500)
  }
}
