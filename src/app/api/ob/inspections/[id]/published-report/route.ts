import { NextResponse } from 'next/server'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import { requireObInspectionContext, requireObInspectionReadContext } from '@/lib/ob/organizationBindings'
import { getObPublishedReportRecord, obPublishedPdfStatus } from '@/lib/ob/publishedReport'
import { obOrganizationFailure, obRequestOrgId } from '@/lib/ob/organizationHttp'
import { readOrganizationJson, ORGANIZATION_RESPONSE_HEADERS } from '@/lib/organizations/administrationHttp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { buildReportPdfFileName } from '@/lib/report/reportFileName'
import { POST as sendPublicReportLink } from '@/app/api/reports/public/[token]/route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: ORGANIZATION_RESPONSE_HEADERS })

async function readReport(request: Request, context: Context, forSharing = false) {
  const { id } = await context.params
  const access = forSharing
    ? { ...await requireObInspectionContext(id, obRequestOrgId(request)), canEdit: true }
    : await requireObInspectionReadContext(id, obRequestOrgId(request))
  const reports = new URL(request.url).searchParams.getAll('report')
  if (reports.length !== 1) throw Error('ORG_REQUEST_INVALID')
  const admin = createSupabaseAdminClient()
  const report = await getObPublishedReportRecord(admin, id, reports[0], access)
  return report ? { admin, report } : null
}

export async function GET(request: Request, context: Context) {
  try {
    const result = await readReport(request, context)
    if (!result) return json({ error: 'Den publicerade rapportversionen kunde inte hittas.' }, 404)
    const { admin, report } = result
    const status = obPublishedPdfStatus(report)
    if (new URL(request.url).searchParams.get('status') === '1') return json({ status })
    if (status !== 'ready') return json({ error: status === 'failed' ? 'PDF-filen kunde inte skapas.' : 'PDF-filen förbereds fortfarande.' }, 409)
    const inspections = report.snapshot.reportData.mock.inspections
    const fileName = buildReportPdfFileName({ inspectionFamily: 'OB', inspectionSide: report.snapshot.inspectionSide,
      assignmentNumber: inspections?.assignment_number, inspectionDate: inspections?.date })
    if (report.pdfStorageBucket && report.pdfStoragePath) {
      const signed = await admin.storage.from(report.pdfStorageBucket).createSignedUrl(report.pdfStoragePath, 120, { download: fileName })
      if (signed.error || !signed.data?.signedUrl) return json({ error: 'PDF-filen kunde inte hämtas. Försök igen.' }, 503)
      return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: ORGANIZATION_RESPONSE_HEADERS })
    }
    const bytes = Buffer.from(report.pdfBase64, 'base64')
    if (bytes.subarray(0, 5).toString() !== '%PDF-') return json({ error: 'Den lagrade PDF-filen kunde inte läsas.' }, 503)
    return new Response(new Uint8Array(bytes), { headers: { ...ORGANIZATION_RESPONSE_HEADERS, 'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` } })
  } catch (error) { return obOrganizationFailure(error) ?? json({ error: 'Utlåtandet kunde inte hämtas.' }, 503) }
}

export async function POST(request: Request, context: Context) {
  try {
    const body = await readOrganizationJson(request)
    const result = await readReport(request, context, true)
    if (!result) return json({ error: 'Den publicerade rapportversionen kunde inte hittas.' }, 404)
    const base = new URL(process.env.APP_BASE_URL || request.url)
    let link: URL
    try { link = new URL(typeof body.publicUrl === 'string' ? body.publicUrl.trim() : '') }
    catch { return json({ error: 'Ange kundens fullständiga utlåtandelänk.' }, 400) }
    const match = link.pathname.match(/^\/rapport\/([A-Za-z0-9_-]{20,})\/?$/)
    if (link.origin !== base.origin || link.username || link.password || link.search || link.hash || !match ||
      hashAssignmentToken(match[1]) !== result.report.tokenHash) {
      return json({ error: 'Länken hör inte till den öppnade rapportversionen.' }, 400)
    }
    const shareUrl = `${base.origin}/rapport/${match[1]}`
    if (body.action === 'validate-link') return json({ shareUrl })
    if (body.action !== 'share') return json({ error: 'Ogiltig delningsbegäran.' }, 400)
    // Reuse the existing delivery limits and send the original public link, not a new snapshot.
    const response = await sendPublicReportLink(new Request(request.url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: body.email }),
    }), { params: Promise.resolve({ token: match[1] }) })
    for (const [key, value] of Object.entries(ORGANIZATION_RESPONSE_HEADERS)) response.headers.set(key, value)
    return response
  } catch (error) { return obOrganizationFailure(error) ?? json({ error: 'Utlåtandelänken kunde inte delas.' }, 503) }
}
