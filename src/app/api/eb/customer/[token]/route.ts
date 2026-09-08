import { NextResponse } from 'next/server'
import { openEbCustomerLink } from '@/lib/eb/customerLinks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' }

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const path = await openEbCustomerLink((await context.params).token)
    if (!path) return new NextResponse('Beställarlänken är inte längre giltig. Kontakta besiktningsmannen för en ny personlig beställarlänk.', { status: 410, headers })
    return NextResponse.redirect(new URL(path, request.url), { status: 303, headers })
  } catch {
    return new NextResponse('Beställarlänken kan inte öppnas just nu. Försök igen om en stund.', { status: 503, headers })
  }
}
