import { NextResponse } from 'next/server'
import {
  deleteRenoAppAdminQuestion,
  listRenoAppAdminQuestions,
  saveRenoAppAdminQuestion,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listRenoAppAdminQuestions()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades for anvandaren.', 403)
    return jsonError(message || 'Kunde inte lasa fragor.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      question?: Record<string, unknown>
      options?: Array<Record<string, unknown>>
    }

    const item = await saveRenoAppAdminQuestion({
      question: {
        id: typeof body.question?.id === 'string' ? body.question.id : null,
        key: typeof body.question?.key === 'string' ? body.question.key : '',
        label: typeof body.question?.label === 'string' ? body.question.label : '',
        helpText: typeof body.question?.helpText === 'string' ? body.question.helpText : null,
        responseType:
          body.question?.responseType === 'multi_select' || body.question?.responseType === 'boolean'
            ? body.question.responseType
            : 'single_select',
        sortOrder:
          typeof body.question?.sortOrder === 'number'
            ? body.question.sortOrder
            : Number(body.question?.sortOrder ?? 100),
        isActive: typeof body.question?.isActive === 'boolean' ? body.question.isActive : true,
        metadata: body.question?.metadata ?? {},
      },
      options: (body.options ?? []).map((option) => ({
        id: typeof option.id === 'string' ? option.id : null,
        key: typeof option.key === 'string' ? option.key : '',
        label: typeof option.label === 'string' ? option.label : '',
        description: typeof option.description === 'string' ? option.description : null,
        sortOrder:
          typeof option.sortOrder === 'number' ? option.sortOrder : Number(option.sortOrder ?? 100),
        isActive: typeof option.isActive === 'boolean' ? option.isActive : true,
        metadata: option.metadata ?? {},
        triggers: Array.isArray(option.triggers)
          ? option.triggers
              .map((trigger) => {
                if (!trigger || typeof trigger !== 'object') return null
                const triggerRecord = trigger as Record<string, unknown>
                const triggerType =
                  triggerRecord.triggerType === 'document'
                    ? 'document'
                    : triggerRecord.triggerType === 'participant_role'
                      ? 'participant_role'
                      : triggerRecord.triggerType === 'review_flag'
                        ? 'review_flag'
                      : 'question'
                return {
                  triggerType,
                  questionId:
                    typeof triggerRecord.questionId === 'string' ? triggerRecord.questionId : null,
                  documentTypeId:
                    typeof triggerRecord.documentTypeId === 'string'
                      ? triggerRecord.documentTypeId
                      : null,
                  participantRoleId:
                    typeof triggerRecord.participantRoleId === 'string'
                      ? triggerRecord.participantRoleId
                      : null,
                  reviewFlagId:
                    typeof triggerRecord.reviewFlagId === 'string'
                      ? triggerRecord.reviewFlagId
                      : null,
                  sortOrder:
                    typeof triggerRecord.sortOrder === 'number'
                      ? triggerRecord.sortOrder
                      : Number(triggerRecord.sortOrder ?? 100),
                  isActive:
                    typeof triggerRecord.isActive === 'boolean' ? triggerRecord.isActive : true,
                }
              })
              .filter(
                (
                  trigger
                ): trigger is {
                  triggerType: 'question' | 'document' | 'participant_role' | 'review_flag'
                  questionId: string | null
                  documentTypeId: string | null
                  participantRoleId: string | null
                  reviewFlagId: string | null
                  sortOrder: number
                  isActive: boolean
                } => Boolean(trigger)
              )
          : [],
      })),
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'QUESTION_KEY_REQUIRED') return jsonError('Ange intern nyckel.', 400)
    if (message === 'QUESTION_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara fraga.', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''

    if (!id) {
      return jsonError('Ange vilken fraga som ska raderas.', 400)
    }

    await deleteRenoAppAdminQuestion(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    return jsonError(message || 'Kunde inte radera fraga.', 500)
  }
}
