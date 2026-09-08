import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createActionCaseAttachmentUrl } from '@/lib/action-cases/server'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ caseId: string; attachmentId: string }> }) {
  try {
    const { caseId, attachmentId } = await context.params
    const org = await requireOrgContext()
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: org.orgId })
    const url = await createActionCaseAttachmentUrl({ orgId: org.orgId, userId: org.userId }, caseId, attachmentId)
    return NextResponse.redirect(url)
  } catch {
    return NextResponse.json({ error: 'Filen kunde inte öppnas.' }, { status: 404 })
  }
}
