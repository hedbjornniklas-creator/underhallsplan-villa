import { requireObInspectionContext, requireObInspectionReadContext } from '@/lib/ob/organizationBindings'
import { obOrganizationFailure, obRequestOrgId } from '@/lib/ob/organizationHttp'
import { ORGANIZATION_RESPONSE_HEADERS } from '@/lib/organizations/administrationHttp'
import { getObPublishedReportRecord } from '@/lib/ob/publishedReport'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { buildReportDataV2 } from '@/lib/report/pdfV2/buildReportDataV2'
import { buildReportSpec } from '@/lib/report/reportSpec'
import { createReportSnapshotPayloadV1 } from '@/lib/report/reportSnapshotPayload'
import { buildWordReport } from '@/lib/report/word/buildWordReport'
import { createWordImageLoader } from '@/lib/report/word/wordReportImages'
import { buildReportPdfFileName } from '@/lib/report/reportFileName'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120
const json = (error: string, status: number) => Response.json({ error }, { status, headers: ORGANIZATION_RESPONSE_HEADERS })

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const query = new URL(request.url).searchParams
    const reports = query.getAll('report')
    const drafts = query.getAll('draft')
    const published = reports.length === 1 && Boolean(reports[0]) && !drafts.length
    const draft = drafts.length === 1 && drafts[0] === '1' && !reports.length
    if (!published && !draft) return json('Välj en publicerad rapportversion eller ett aktuellt utkast.', 400)
    const orgId = obRequestOrgId(request)
    const access = published ? await requireObInspectionReadContext(id, orgId)
      : { ...await requireObInspectionContext(id, orgId), canEdit: true }
    const admin = createSupabaseAdminClient()
    let snapshot
    if (published) {
      const report = await getObPublishedReportRecord(admin, id, reports[0], access)
      if (!report) return json('Den publicerade rapportversionen kunde inte hittas. Ingen annan version har exporterats.', 404)
      snapshot = report.snapshot
    } else {
      const { data: inspection, error } = await admin.from('inspections').select('property_id,locked_at,status').eq('id', id).maybeSingle()
      if (error) throw error
      if (!inspection) return json('Besiktningen kunde inte hittas.', 404)
      if (inspection.locked_at || inspection.status === 'archived') return json('Ladda ner den publicerade versionen för ett låst eller arkiverat utlåtande.', 409)
      // Read-only build: never publish, freeze identity, update PDF status or send mail during export.
      const reportData = await buildReportDataV2({ inspectionId: id, propertyId: inspection.property_id }, undefined, { readOnly: true })
      const side = reportData.mock.inspections.side
      const appendices = reportData.mock.appendices
      snapshot = createReportSnapshotPayloadV1({ inspectionId: id, propertyId: inspection.property_id,
        inspectionSide: side, objectType: reportData.mock.properties.object_type, reportData,
        reportSpec: buildReportSpec({ layoutVersion: 2, inspectionSide: side, objectType: reportData.mock.properties.object_type,
          dynamicAppendices: { includeAreaMeasurement: appendices.area_measurement?.enabled === true,
            includeMoistureControl: appendices.moisture_control?.enabled === true,
            buildings: appendices.buildings, environmental: appendices.environmental } }),
      })
    }
    const bytes = await buildWordReport(snapshot, { loadImage: createWordImageLoader(), draft })
    const inspection = snapshot.reportData.mock.inspections
    const base = buildReportPdfFileName({ inspectionFamily: 'OB', inspectionSide: snapshot.inspectionSide,
      assignmentNumber: inspection?.assignment_number, inspectionDate: inspection?.date }).replace(/\.pdf$/, '')
    const fileName = `${base}${draft ? ' - utkast' : ''}.docx`
    return new Response(new Uint8Array(bytes), { headers: { ...ORGANIZATION_RESPONSE_HEADERS,
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'X-Content-Type-Options': 'nosniff',
    } })
  } catch (error) {
    const failure = obOrganizationFailure(error)
    if (failure) return failure
    const code = error instanceof Error ? error.message : ''
    if (code === 'WORD_REPORT_TOO_LARGE') return json('Utlåtandet är för stort för Word-export. Använd PDF eller kontakta support.', 413)
    if (code === 'WORD_REPORT_SPEC_MISSING') return json('Den här äldre rapportversionen saknar sparad rapportstruktur. Inget innehåll har hämtats från dagens besiktning.', 409)
    return json('Word-filen kunde inte skapas. Kontrollera att utlåtandets bilder kan hämtas och försök igen.', 503)
  }
}
