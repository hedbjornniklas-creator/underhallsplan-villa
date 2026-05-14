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
  return jsonError(message || fallback, 500)
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
      .select('id,storage_bucket,file_path')
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

    const storageBucket = String(attachment.storage_bucket ?? EB_PROJECT_ATTACHMENTS_BUCKET).trim()
    const filePath = String(attachment.file_path ?? '').trim()
    if (filePath) {
      const { error: removeError } = await admin.storage.from(storageBucket).remove([filePath])
      if (removeError) {
        throw new Error(removeError.message ?? 'Kunde inte ta bort filen.')
      }
    }

    const { error: deleteError } = await admin
      .from('eb_project_attachments')
      .delete()
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('id', attachmentId)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte ta bort bilaga.')
    }

    const attachments = await listEbProjectAttachments({
      orgId: org.orgId,
      projectId,
    })

    return NextResponse.json({ attachments })
  } catch (error) {
    return mapError(error, 'Kunde inte ta bort bilaga.')
  }
}
