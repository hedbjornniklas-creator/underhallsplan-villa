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
// Reusing a report may copy its photo files, as independent target-owned files.
export const maxDuration = 300

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
  if (message === 'EB_PROJECT_CLOSED') {
    return jsonError('Entreprenaden är arkiverad eller avbokad. Välj en aktiv entreprenad.', 409)
  }
  if (message === 'EB_PROJECT_PROPERTY_MISSING') {
    return jsonError('Entreprenaden saknar fastighetskoppling.', 409)
  }
  if (message === 'EB_REUSE_SOURCE_NOT_FOUND') {
    return jsonError('Den tidigare besiktningen hittades inte i denna entreprenad.', 404)
  }
  if (message === 'EB_REUSE_SOURCE_NOT_ELIGIBLE' || message === 'EB_REUSE_SOURCE_SNAPSHOT_INVALID') {
    return jsonError('Välj en fastställd, ej godkänd slutbesiktning som underlag. Uppdatera sidan om uppgifterna har ändrats.', 409)
  }
  if (message === 'EB_REUSE_MIGRATION_REQUIRED') {
    return jsonError('Funktionen för att återanvända en besiktning behöver aktiveras av administratören.', 503)
  }
  if (message === 'EB_REUSE_ROLLBACK_FAILED') {
    return jsonError('Besiktningen kunde inte skapas färdigt. Kontakta administratören innan du försöker igen.', 500)
  }
  return jsonError(fallback, 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (['reusePreviousInspection', 'includePreviousNotes'].some(key =>
      body[key] !== undefined && typeof body[key] !== 'boolean')) {
      return jsonError('Valen för tidigare besiktning måste vara ja eller nej.', 400)
    }
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
      reusePreviousInspection: body.reusePreviousInspection === true,
      includePreviousNotes: body.includePreviousNotes === true,
    })

    return NextResponse.json({ project }, { status: 201 })
  } catch (error) {
    return mapError(error, 'Kunde inte skapa besiktning.')
  }
}
