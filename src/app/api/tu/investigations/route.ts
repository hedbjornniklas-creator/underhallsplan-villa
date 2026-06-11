import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createScratchTuInvestigation, listTuInvestigations, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ReportLinkPdfLite = {
  inspection_id: string
  pdf_base64: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
  pdf_status: string | null
  created_at: string | null
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function text(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function mapAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_REPORT_TEMPLATE_REQUIRED') return jsonError('Välj en mall innan utredningen skapas.', 400)
  if (message === 'TU_REPORT_TEMPLATE_NOT_FOUND') return jsonError('Den valda TU-mallen är inte aktiv eller saknas.', 404)
  if (message === 'TU_REPORT_TEMPLATE_EMPTY') return jsonError('Den valda TU-mallen saknar sektioner.', 409)
  return null
}

function normalizePdfStatus(value: string | null | undefined): 'pending' | 'processing' | 'ready' | 'failed' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

function hasReadyPdf(row: ReportLinkPdfLite | null | undefined) {
  if (!row) return false
  const hasStoredPdf =
    String(row.pdf_storage_bucket ?? '').trim().length > 0 &&
    String(row.pdf_storage_path ?? '').trim().length > 0
  const hasLegacyPdf = String(row.pdf_base64 ?? '').trim().length > 0
  return normalizePdfStatus(row.pdf_status) === 'ready' && (hasStoredPdf || hasLegacyPdf)
}

async function listLatestReportLinks(inspectionIds: string[]) {
  if (inspectionIds.length === 0) return new Map<string, ReportLinkPdfLite>()

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('inspection_id,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,created_at')
    .in('inspection_id', inspectionIds)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[api/tu/investigations] failed to read report link PDF status', {
      error: error.message ?? error,
    })
    return new Map<string, ReportLinkPdfLite>()
  }

  const latestByInspectionId = new Map<string, ReportLinkPdfLite>()
  for (const row of (Array.isArray(data) ? data : []) as ReportLinkPdfLite[]) {
    if (!latestByInspectionId.has(row.inspection_id)) {
      latestByInspectionId.set(row.inspection_id, row)
    }
  }

  return latestByInspectionId
}

export async function GET() {
  try {
    const context = await requireTuContext()
    const items = await listTuInvestigations(context.orgId)
    const reportLinks = await listLatestReportLinks(items.map((item) => item.inspectionId))
    return NextResponse.json({
      items: items.map((item) => ({
        ...item,
        hasReadyPdf: hasReadyPdf(reportLinks.get(item.inspectionId)),
      })),
    })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte hämta TU-utredningar.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireTuContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const objectType = text(body, 'objectType') === 'apartment' ? 'apartment' : 'villa'

    const result = await createScratchTuInvestigation({
      orgId: context.orgId,
      createdBy: context.userId,
      reportTemplateKey: text(body, 'reportTemplateKey') || null,
      responsibleProfileId: text(body, 'responsibleProfileId') || context.userId,
      title: text(body, 'title') || null,
      scopeDescription: text(body, 'scopeDescription') || null,
      propertyAddress: text(body, 'propertyAddress') || null,
      propertyPostalCode: text(body, 'propertyPostalCode') || null,
      propertyCity: text(body, 'propertyCity') || null,
      propertyMunicipality: text(body, 'propertyMunicipality') || null,
      propertyOwnerName: text(body, 'propertyOwnerName') || null,
      cadastralId: objectType === 'villa' ? text(body, 'cadastralId') || null : null,
      brfName: objectType === 'apartment' ? text(body, 'brfName') || null : null,
      apartmentNumber: objectType === 'apartment' ? text(body, 'apartmentNumber') || null : null,
      apartmentHolderName: objectType === 'apartment' ? text(body, 'apartmentHolderName') || null : null,
      objectType,
      customerName: text(body, 'customerName') || null,
      customerEmail: text(body, 'customerEmail') || null,
      customerPhone: text(body, 'customerPhone') || null,
      customerAddress: text(body, 'customerAddress') || null,
      customerPostalCode: text(body, 'customerPostalCode') || null,
      customerCity: text(body, 'customerCity') || null,
      date: text(body, 'date') || null,
      time: text(body, 'time') || null,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte skapa TU-utredning.', 500)
  }
}
