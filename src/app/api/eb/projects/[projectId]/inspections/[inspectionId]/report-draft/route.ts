import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  getEbInspectionReport,
  refreshEbReportInspectorSource,
  refreshEbReportProjectSource,
  resetEbReportDraftSection,
  saveEbReportDraft,
  type EbReportNoteHeading,
  type EbReportDraftSection,
} from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
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
  if (message === 'EB_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'EB_REPORT_DRAFT_EMPTY') {
    return jsonError('Inga giltiga ändringar för utlåtandeutkastet skickades.', 400)
  }
  if (message === 'EB_REPORT_NOTE_HEADINGS_INVALID') {
    return jsonError('En eller flera noteringsrubriker är ogiltiga.', 400)
  }
  if (message === 'EB_REPORT_NOTE_HEADING_ANCHOR_INVALID') {
    return jsonError('En noteringsrubrik hänvisar till en notering som inte finns.', 400)
  }
  if (message === 'EB_REPORT_DRAFT_VERSION_REQUIRED') {
    return jsonError('Utlåtandet behöver läsas in på nytt innan rubriker kan sparas.', 409)
  }
  if (message === 'EB_REPORT_DRAFT_CONFLICT') {
    return jsonError('Utlåtandet ändrades samtidigt i en annan vy. Ladda om sidan innan du fortsätter.', 409)
  }
  if (message === 'EB_REPORT_SECTION_NOT_EDITABLE') {
    return jsonError('Den automatiska sektionen kan inte återställas manuellt.', 400)
  }
  if (message === 'EB_REPORT_SECTION_NOT_FOUND') return jsonError('Utlåtandesektionen hittades inte.', 404)
  return jsonError(fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const report = await getEbInspectionReport({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    })

    return NextResponse.json({ report })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta utlåtandeutkast.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as {
      sections?: unknown
      noteHeadings?: unknown
      expectedUpdatedAt?: unknown
    }
    const sections = Array.isArray(body.sections)
      ? (body.sections as EbReportDraftSection[])
      : undefined
    const noteHeadings = Array.isArray(body.noteHeadings)
      ? (body.noteHeadings as EbReportNoteHeading[])
      : undefined
    const hasExpectedUpdatedAt = Object.prototype.hasOwnProperty.call(
      body,
      'expectedUpdatedAt'
    )
    if (
      hasExpectedUpdatedAt &&
      body.expectedUpdatedAt !== null &&
      typeof body.expectedUpdatedAt !== 'string'
    ) {
      return jsonError('Ogiltig versionsinformation för utlåtandet.', 400)
    }
    const reportDraft = await saveEbReportDraft({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      sections,
      noteHeadings,
      ...(hasExpectedUpdatedAt
        ? { expectedUpdatedAt: body.expectedUpdatedAt as string | null }
        : {}),
    })

    return NextResponse.json({ reportDraft })
  } catch (error) {
    return mapError(error, 'Kunde inte spara utlåtandeutkast.')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown
      sectionKey?: unknown
    }
    const commonInput = {
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    }

    if (body.action === 'refresh_project') {
      const report = await refreshEbReportProjectSource(commonInput)
      return NextResponse.json({ report })
    }

    if (body.action === 'refresh_inspector') {
      const report = await refreshEbReportInspectorSource(commonInput)
      return NextResponse.json({ report })
    }

    if (body.action === 'reset_section') {
      const sectionKey = typeof body.sectionKey === 'string' ? body.sectionKey.trim() : ''
      if (!sectionKey) return jsonError('Ange vilken sektion som ska återställas.', 400)
      const reportDraft = await resetEbReportDraftSection({ ...commonInput, sectionKey })
      return NextResponse.json({ reportDraft })
    }

    return jsonError('Okänd åtgärd för utlåtandeutkastet.', 400)
  } catch (error) {
    return mapError(error, 'Kunde inte uppdatera utlåtandeutkastets grunduppgifter.')
  }
}
