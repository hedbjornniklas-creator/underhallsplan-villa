import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  listEbInspectionDocuments,
  saveEbInspectionDocuments,
  type EbInspectionDocument,
  type EbInspectionDocumentStatus,
} from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toDocumentStatus(value: unknown): EbInspectionDocumentStatus {
  const status = toText(value)
  return status === 'present' || status === 'missing' || status === 'na' ? status : 'na'
}

function toInspectionDocument(value: unknown): EbInspectionDocument | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  const documentTypeId = toText(record.documentTypeId)
  const title = toText(record.title)
  const code = toText(record.code)
  if (!documentTypeId) return null

  return {
    id: toText(record.id) || null,
    documentTypeId,
    code,
    title,
    category: toText(record.category) || null,
    resultLabel: toText(record.resultLabel) || null,
    resultUnit: toText(record.resultUnit) || null,
    status: toDocumentStatus(record.status),
    documentDate: toText(record.documentDate) || null,
    note: toText(record.note) || null,
    sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : 100,
  }
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
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
  return jsonError(message || fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const documents = await listEbInspectionDocuments({
      orgId: org.orgId,
      projectId,
      inspectionId,
    })

    return NextResponse.json({ documents })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta granskade handlingar.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const documents = Array.isArray(body.documents)
      ? body.documents
          .map(toInspectionDocument)
          .filter((document): document is EbInspectionDocument => Boolean(document))
      : []

    const savedDocuments = await saveEbInspectionDocuments({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      documents,
    })

    return NextResponse.json({ documents: savedDocuments })
  } catch (error) {
    return mapError(error, 'Kunde inte spara granskade handlingar.')
  }
}
