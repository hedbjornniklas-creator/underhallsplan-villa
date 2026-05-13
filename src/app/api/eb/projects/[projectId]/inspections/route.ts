import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  createEbInspectionForProject,
  isEbInspectionVariant,
  type EbInspectionVariant,
} from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function mapError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') {
    return jsonError('Ingen organisationskoppling hittades.', 403)
  }
  if (message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('EB kräver egen modulbehörighet.', 403)
  }
  if (message === 'EB_PROJECT_NOT_FOUND') {
    return jsonError('Entreprenaden hittades inte.', 404)
  }
  if (message === 'EB_PROJECT_PROPERTY_MISSING') {
    return jsonError('Entreprenaden saknar fastighetskoppling.', 409)
  }
  return jsonError(message || fallback, 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const rawVariant = toText(body.variant).toUpperCase()
    const variant: EbInspectionVariant = isEbInspectionVariant(rawVariant)
      ? rawVariant
      : 'EB'

    const project = await createEbInspectionForProject({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      variant,
      parentInspectionId: toText(body.parentInspectionId) || null,
      inspectionDate: toText(body.inspectionDate) || null,
      inspectionTime: toText(body.inspectionTime) || null,
      meetingPlace: toText(body.meetingPlace) || null,
      startMeetingTime: toText(body.startMeetingTime) || null,
      finalMeetingTime: toText(body.finalMeetingTime) || null,
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    return mapError(error, 'Kunde inte skapa besiktning.')
  }
}
