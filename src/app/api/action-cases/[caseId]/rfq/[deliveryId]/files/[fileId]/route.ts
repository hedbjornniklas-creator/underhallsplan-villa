import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getRfqInternalFileUrl } from '@/lib/action-cases/rfqDeliveryServer'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }

export async function GET(request: Request, context: { params: Promise<{ caseId: string; deliveryId: string; fileId: string }> }) {
  try {
    const { caseId, deliveryId, fileId } = await context.params
    const org = await requireOrgContext()
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: org.orgId })
    const url = await getRfqInternalFileUrl(org, caseId, deliveryId, fileId, new URL(request.url).searchParams.get('download') === '1')
    return NextResponse.redirect(url, { headers })
  } catch {
    return NextResponse.json({ error: 'Filen kunde inte öppnas.' }, { status: 404, headers })
  }
}
