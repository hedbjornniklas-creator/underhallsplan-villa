import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createScratchTuInvestigation, listTuInvestigations, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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
  if (message === 'ORG_SELECTION_INVALID') return jsonError('Den valda organisationen är ogiltig.', 400)
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

async function listLatestReportLinks(orgId: string, inspectionIds: string[]) {
  if (inspectionIds.length === 0) return new Map<string, ReportLinkPdfLite>()

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('inspection_id,pdf_base64,pdf_storage_bucket,pdf_storage_path,pdf_status,created_at')
    .eq('org_id', orgId)
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

async function listPublishedReportLinks(orgId: string, inspectionIds: string[]) {
  const result = new Map<string, { resendUsesSameLink: boolean; revisionNumber: number }>()
  if (inspectionIds.length === 0) return result
  const admin = createSupabaseAdminClient()
  const revisions = await admin
    .from('tu_report_revisions')
    .select('inspection_id,published_link_id,revision_number')
    .eq('org_id', orgId)
    .eq('status', 'published')
    .in('inspection_id', inspectionIds)
  if (revisions.error) {
    console.error('[api/tu/investigations] failed to read published revisions', revisions.error)
    return result
  }
  const rows = (revisions.data ?? []) as Array<{ inspection_id: string; published_link_id: string | null; revision_number: number }>
  const linkIds = rows.map((row) => row.published_link_id).filter((id): id is string => Boolean(id))
  if (linkIds.length === 0) return result
  const links = await admin
    .from('inspection_report_links')
    .select('id,tu_token_ciphertext')
    .eq('org_id', orgId)
    .is('revoked_at', null)
    .in('id', linkIds)
  let linkRows: Array<{ id: string; tu_token_ciphertext: string | null }> = []
  if (links.error && String(links.error.message ?? '').includes('tu_token_ciphertext')) {
    const fallback = await admin
      .from('inspection_report_links')
      .select('id')
      .eq('org_id', orgId)
      .is('revoked_at', null)
      .in('id', linkIds)
    if (fallback.error) {
      console.error('[api/tu/investigations] failed to read published report links', fallback.error)
      return result
    }
    linkRows = (fallback.data ?? []).map((row) => ({ id: row.id, tu_token_ciphertext: null }))
  } else if (links.error) {
    console.error('[api/tu/investigations] failed to read published report links', links.error)
    return result
  } else {
    linkRows = (links.data ?? []) as Array<{ id: string; tu_token_ciphertext: string | null }>
  }
  const byId = new Map(linkRows.map((row) => [row.id, row]))
  for (const revision of rows) {
    const link = revision.published_link_id ? byId.get(revision.published_link_id) : null
    if (link) result.set(revision.inspection_id, {
      resendUsesSameLink: Boolean(link.tu_token_ciphertext),
      revisionNumber: revision.revision_number,
    })
  }
  return result
}

export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams
    if (
      [...searchParams.keys()].some((key) => key !== 'orgId') ||
      searchParams.getAll('orgId').length !== 1
    ) {
      return jsonError('Välj arbetsorganisation innan TU-utredningarna hämtas.', 400)
    }
    const context = await requireTuContext(searchParams.get('orgId'))
    const items = await listTuInvestigations(context.orgId)
    const inspectionIds = items.map((item) => item.inspectionId)
    const [reportLinks, publishedLinks] = await Promise.all([
      listLatestReportLinks(context.orgId, inspectionIds),
      listPublishedReportLinks(context.orgId, inspectionIds),
    ])
    return NextResponse.json({
      org: { id: context.orgId, name: context.orgName },
      items: items.map((item) => ({
        ...item,
        hasReadyPdf: hasReadyPdf(reportLinks.get(item.inspectionId)),
        hasPublishedLink: publishedLinks.has(item.inspectionId),
        resendUsesSameLink: publishedLinks.get(item.inspectionId)?.resendUsesSameLink ?? false,
        publishedRevisionNumber: publishedLinks.get(item.inspectionId)?.revisionNumber ?? null,
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
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!Object.prototype.hasOwnProperty.call(body, 'orgId')) {
      return jsonError('Välj arbetsorganisation innan utredningen skapas.', 400)
    }
    const context = await requireTuContext(body.orgId)
    const objectType = text(body, 'objectType') === 'apartment' ? 'apartment' : 'villa'
    const customerEmail = text(body, 'customerEmail').toLowerCase()
    const invoiceEmail = text(body, 'invoiceEmail').toLowerCase()

    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig kontaktmejl.', 400)
    }
    if (invoiceEmail && !EMAIL_REGEX.test(invoiceEmail)) {
      return jsonError('Ange en giltig fakturae-post.', 400)
    }

    const result = await createScratchTuInvestigation({
      orgId: context.orgId,
      createdBy: context.userId,
      reportTemplateKey: text(body, 'reportTemplateKey') || null,
      responsibleProfileId: context.userId,
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
      customerEmail,
      customerPhone: text(body, 'customerPhone') || null,
      customerAddress: text(body, 'customerAddress') || null,
      customerPostalCode: text(body, 'customerPostalCode') || null,
      customerCity: text(body, 'customerCity') || null,
      invoiceEmail: invoiceEmail || null,
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
