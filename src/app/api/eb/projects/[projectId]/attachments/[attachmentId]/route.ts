import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { EB_PROJECT_ATTACHMENTS_BUCKET, getEbProjectById, listEbProjectAttachments } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true') return true
    if (normalized === 'false') return false
  }
  return null
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
  if (message === 'EB_ATTACHMENT_NOT_FOUND') return jsonError('Bilagan hittades inte.', 404)
  if (message === 'EB_ATTACHMENT_INVALID_INPUT') return jsonError('Ogiltiga bilageuppgifter.', 400)
  if (message === 'EB_ATTACHMENT_NO_CHANGES') return jsonError('Inga bilageuppgifter att spara.', 400)
  if (message === 'EB_ATTACHMENT_LINKED_TO_AGREEMENT') {
    return jsonError('Handlingen är kopplad till ett avtal. Ta bort avtalskopplingen först.', 409)
  }
  return jsonError(fallback, 500)
}

async function assertAttachmentIsNotLinkedToAgreement(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>
  orgId: string
  projectId: string
  attachmentId: string
}) {
  const { data, error } = await input.admin
    .from('eb_project_agreement_attachment_links')
    .select('id')
    .eq('org_id', input.orgId)
    .eq('eb_project_id', input.projectId)
    .eq('attachment_id', input.attachmentId)
    .limit(1)

  if (error) {
    const text = [error.code, error.message, error.details].filter(Boolean).join(' ').toLowerCase()
    const relationMissing = text.includes('42p01') ||
      text.includes('relation') && text.includes('does not exist') ||
      text.includes('schema cache') && text.includes('table')
    // The relationship table is introduced by a separate migration. Existing
    // installations retain the old delete behavior until it has been applied.
    if (relationMissing) return
    throw new Error(error.message ?? 'Kunde inte kontrollera avtalskopplingar.')
  }

  if ((data ?? []).length > 0) {
    throw new Error('EB_ATTACHMENT_LINKED_TO_AGREEMENT')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; attachmentId: string }> }
) {
  try {
    const { projectId, attachmentId } = await context.params
    const org = await requireEbContext()
    const project = await getEbProjectById({ orgId: org.orgId, projectId })
    if (!project) throw new Error('EB_PROJECT_NOT_FOUND')

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const hasField = (field: string) => Object.prototype.hasOwnProperty.call(body, field)
    const includeInReport = hasField('includeInReport') ? toBoolean(body.includeInReport) : undefined
    if (includeInReport === null) throw new Error('EB_ATTACHMENT_INVALID_INPUT')
    const updates: Record<string, string | boolean | null> = {}
    if (hasField('title')) updates.title = toText(body.title) || null
    if (includeInReport !== undefined) updates.include_in_report = includeInReport
    if (hasField('littera')) updates.littera = toText(body.littera) || null
    if (hasField('documentDate')) updates.document_date = toText(body.documentDate) || null
    if (hasField('documentNumber')) updates.document_number = toText(body.documentNumber) || null
    if (hasField('documentNote')) updates.document_note = toText(body.documentNote) || null
    if (Object.keys(updates).length === 0) throw new Error('EB_ATTACHMENT_NO_CHANGES')
    const admin = createSupabaseAdminClient()

    const { data: attachment, error: fetchError } = await admin
      .from('eb_project_attachments')
      .select('id')
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('id', attachmentId)
      .maybeSingle()

    if (fetchError) {
      throw new Error(fetchError.message ?? 'Kunde inte läsa bilaga.')
    }
    if (!attachment?.id) {
      throw new Error('EB_ATTACHMENT_NOT_FOUND')
    }

    const { error: updateError } = await admin
      .from('eb_project_attachments')
      .update(updates)
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('id', attachmentId)

    if (updateError) {
      throw new Error(updateError.message ?? 'Kunde inte spara bilageuppgifter.')
    }

    const { data: touchedProject, error: touchError } = await admin
      .from('eb_projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('org_id', org.orgId)
      .eq('id', projectId)
      .select('id')
      .maybeSingle()
    if (touchError) {
      throw new Error(touchError.message ?? 'Kunde inte uppdatera entreprenadens ändringstid.')
    }
    if (!touchedProject) throw new Error('EB_PROJECT_NOT_FOUND')

    const [attachments, updatedProject] = await Promise.all([
      listEbProjectAttachments({ orgId: org.orgId, projectId }),
      getEbProjectById({ orgId: org.orgId, projectId }),
    ])
    if (!updatedProject) throw new Error('EB_PROJECT_NOT_FOUND')

    return NextResponse.json({ attachments, project: updatedProject })
  } catch (error) {
    return mapError(error, 'Kunde inte spara bilageuppgifter.')
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ projectId: string; attachmentId: string }> }
) {
  try {
    const { projectId, attachmentId } = await context.params
    const org = await requireEbContext()
    const project = await getEbProjectById({ orgId: org.orgId, projectId })
    if (!project) throw new Error('EB_PROJECT_NOT_FOUND')

    const admin = createSupabaseAdminClient()
    const { data: attachment, error: fetchError } = await admin
      .from('eb_project_attachments')
      .select('id,storage_bucket,file_path,thumbnail_file_path')
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('id', attachmentId)
      .maybeSingle()

    if (fetchError) {
      throw new Error(fetchError.message ?? 'Kunde inte läsa bilaga.')
    }
    if (!attachment?.id) {
      throw new Error('EB_ATTACHMENT_NOT_FOUND')
    }

    // Do not silently delete a file that is visible under Avtal. The database
    // has the same RESTRICT rule, so this precheck is only a friendly early
    // response rather than the sole protection against a concurrent link.
    await assertAttachmentIsNotLinkedToAgreement({
      admin,
      orgId: org.orgId,
      projectId,
      attachmentId,
    })

    const { error: deleteError } = await admin
      .from('eb_project_attachments')
      .delete()
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('id', attachmentId)

    if (deleteError) {
      const errorText = [deleteError.code, deleteError.message, deleteError.details]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (errorText.includes('23503') && errorText.includes('agreement_attachment')) {
        throw new Error('EB_ATTACHMENT_LINKED_TO_AGREEMENT')
      }
      throw new Error(deleteError.message ?? 'Kunde inte ta bort bilaga.')
    }

    // Delete the database record first. If storage cleanup ever fails, an
    // orphaned object is safer than a visible attachment whose PDF is gone.
    const storageBucket = String(attachment.storage_bucket ?? EB_PROJECT_ATTACHMENTS_BUCKET).trim()
    const filePaths = [attachment.file_path, attachment.thumbnail_file_path]
      .map((path) => String(path ?? '').trim())
      .filter(Boolean)
    const storageCleanupWarning = filePaths.length > 0
      ? Boolean((await admin.storage.from(storageBucket).remove(filePaths)).error)
      : false

    const { data: touchedProject, error: touchError } = await admin
      .from('eb_projects')
      .update({ updated_at: new Date().toISOString() })
      .eq('org_id', org.orgId)
      .eq('id', projectId)
      .select('id')
      .maybeSingle()
    if (touchError) {
      throw new Error(touchError.message ?? 'Kunde inte uppdatera entreprenadens ändringstid.')
    }
    if (!touchedProject) throw new Error('EB_PROJECT_NOT_FOUND')

    const [attachments, updatedProject] = await Promise.all([
      listEbProjectAttachments({ orgId: org.orgId, projectId }),
      getEbProjectById({ orgId: org.orgId, projectId }),
    ])
    if (!updatedProject) throw new Error('EB_PROJECT_NOT_FOUND')

    return NextResponse.json({ attachments, project: updatedProject, storageCleanupWarning })
  } catch (error) {
    return mapError(error, 'Kunde inte ta bort bilaga.')
  }
}
