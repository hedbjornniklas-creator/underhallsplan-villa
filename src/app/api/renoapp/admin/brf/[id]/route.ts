import { NextResponse } from 'next/server'
import { getBrfAdminDetail, updateBrfAdmin } from '@/lib/renoapp/brfAdmin'
import { brfApiError } from '@/lib/renoapp/brfApiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
export async function GET(_request: Request, context: Context) {
  try {
    return NextResponse.json(await getBrfAdminDetail((await context.params).id))
  } catch (error) { return brfApiError(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const body = await request.json() as Record<string, unknown>
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_ACTION')
    return NextResponse.json(await updateBrfAdmin((await context.params).id, body, new URL(request.url).origin))
  } catch (error) { return brfApiError(error) }
}
