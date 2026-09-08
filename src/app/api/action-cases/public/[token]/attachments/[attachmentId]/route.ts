import { NextResponse } from 'next/server'
import { createActionCasePortalAttachmentUrl } from '@/lib/action-cases/server'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ token: string; attachmentId: string }> }) {
  try {
    const { token, attachmentId } = await context.params
    return NextResponse.redirect(await createActionCasePortalAttachmentUrl(token, attachmentId))
  } catch {
    return NextResponse.json({ error: 'Filen finns inte eller länken saknar åtkomst.' }, { status: 404 })
  }
}
