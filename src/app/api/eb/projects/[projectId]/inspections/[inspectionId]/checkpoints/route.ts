import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { saveEbInspectionCheckpoints, type EbInspectionCheckpointStatus } from '@/lib/eb/server'

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
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
  if (message === 'EB_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  return jsonError(fallback, 500)
}

function toCheckpointRows(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .map((row) => {
      if (!row || typeof row !== 'object') return null
      const record = row as Record<string, unknown>
      const id = toText(record.id)
      const checkpointKey = toText(record.checkpointKey)
      if (!id && !checkpointKey) return null

      return {
        id: id || null,
        checkpointKey: checkpointKey || null,
        status: (toText(record.status) || null) as EbInspectionCheckpointStatus | null,
        comment: toText(record.comment) || null,
        noteId: toText(record.noteId) || null,
      }
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const checkpoints = await saveEbInspectionCheckpoints({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      checkpoints: toCheckpointRows(body.checkpoints),
    })

    return NextResponse.json({ checkpoints })
  } catch (error) {
    return mapError(error, 'Kunde inte spara EB-kontrollpunkter.')
  }
}
