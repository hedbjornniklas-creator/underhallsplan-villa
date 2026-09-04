import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  getEbProjectById,
  isEbProjectAgreementAttachmentLinksAvailable,
  listEbProjectAgreementAttachmentLinks,
  listEbProjectAttachments,
  refreshEbProjectReportSources,
  replaceEbProjectAgreementAttachmentLinks,
  type EbProjectAgreementAttachmentLinkInput,
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
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_PROJECT_CONFLICT') {
    return jsonError('Entreprenaden har ändrats. Ladda om sidan och försök igen.', 409)
  }
  if (message === 'EB_AGREEMENT_ATTACHMENT_INVALID') {
    return jsonError('Varje avtalsfil måste ha en avtalsrad och en handling.', 400)
  }
  if (message === 'EB_AGREEMENT_KEY_NOT_FOUND') {
    return jsonError('Avtalsraden finns inte sparad ännu. Spara den innan du kopplar en handling.', 409)
  }
  if (message === 'EB_AGREEMENT_ATTACHMENT_NOT_FOUND') {
    return jsonError('Handlingen finns inte i denna entreprenads dokumentbank.', 404)
  }
  if (message === 'EB_AGREEMENT_ATTACHMENT_LINKS_UNAVAILABLE') {
    return jsonError('Databasuppdateringen för avtalskopplingar saknas. Kör den senaste EB-migreringen.', 503)
  }
  return jsonError(fallback, 500)
}

async function loadAgreementAttachments(input: { orgId: string; projectId: string }) {
  const [links, attachments, available] = await Promise.all([
    listEbProjectAgreementAttachmentLinks(input),
    listEbProjectAttachments(input),
    isEbProjectAgreementAttachmentLinksAvailable(input),
  ])

  // The link object contains the selected document too. `documents` is the
  // full reusable project document bank for a file picker in the Avtal tab.
  return {
    available,
    links,
    documents: attachments.filter((attachment) => attachment.attachmentType === 'document'),
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    return NextResponse.json(await loadAgreementAttachments({ orgId: org.orgId, projectId }))
  } catch (error) {
    return mapError(error, 'Kunde inte hämta avtalsfiler.')
  }
}

/**
 * Replaces the complete set of links for this project. Files themselves stay
 * in eb_project_attachments, so this endpoint never uploads or duplicates a
 * physical document.
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    if (!Array.isArray(body.links)) {
      return jsonError('Skicka avtalskopplingar som en lista.', 400)
    }
    const hasExpectedUpdatedAt = Object.prototype.hasOwnProperty.call(body, 'expectedUpdatedAt')
    if (!hasExpectedUpdatedAt) {
      return jsonError('Entreprenadens aktuella version saknas. Ladda om sidan och försök igen.', 400)
    }
    const expectedUpdatedAt = toText(body.expectedUpdatedAt) || null

    await replaceEbProjectAgreementAttachmentLinks({
      orgId: org.orgId,
      projectId,
      links: body.links as EbProjectAgreementAttachmentLinkInput[],
      expectedUpdatedAt,
    })

    const project = await getEbProjectById({ orgId: org.orgId, projectId })
    if (!project) throw new Error('EB_PROJECT_NOT_FOUND')

    const [attachments, reportSourceRefresh] = await Promise.all([
      loadAgreementAttachments({ orgId: org.orgId, projectId }),
      // Attachment links are persisted separately from project fields. Rebuild
      // active report workspaces so SBR 10 and the delivery snapshot use the
      // newly linked agreement documents immediately.
      refreshEbProjectReportSources(
        {
          orgId: org.orgId,
          requestedByUserId: org.userId,
          project,
        },
        { forceContentRefresh: true }
      ),
    ])

    return NextResponse.json({ ...attachments, project, reportSourceRefresh })
  } catch (error) {
    return mapError(error, 'Kunde inte spara avtalsfiler.')
  }
}
