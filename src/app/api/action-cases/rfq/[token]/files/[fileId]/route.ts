import { NextResponse } from 'next/server'
import { getRfqPublicFileUrl } from '@/lib/action-cases/rfqDeliveryServer'

export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }

export async function GET(request: Request, context: { params: Promise<{ token: string; fileId: string }> }) {
  try {
    const { token, fileId } = await context.params
    const url = await getRfqPublicFileUrl(token, fileId, new URL(request.url).searchParams.get('download') === '1')
    return NextResponse.redirect(url, { headers })
  } catch {
    return NextResponse.json({ error: 'Filen är inte tillgänglig. Kontakta avsändaren om länken har gått ut.' }, { status: 404, headers })
  }
}
