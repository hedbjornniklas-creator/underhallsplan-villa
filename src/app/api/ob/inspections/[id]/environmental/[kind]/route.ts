import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { environmentalArgs, environmentalCommand, environmentalError, type EnvironmentalState } from '@/lib/ob/environmentalServer'
import { parseEnvironmentalProtocol } from '@/lib/ob/environmentalProtocol'

export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; kind: string }> }
export async function GET(_request: Request, context: Context) {
  try {
    const org = await requireOrgContext(), { id, kind } = await context.params
    return NextResponse.json(await environmentalCommand<EnvironmentalState>(environmentalArgs(id, kind, org), 'read'), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return environmentalError(error) }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const org = await requireOrgContext(), { id, kind } = await context.params
    const args = environmentalArgs(id, kind, org)
    const text = await request.text()
    if (text.length > 200000) return NextResponse.json({ error: 'Protokollet är för stort.' }, { status: 413 })
    let body, document
    try {
      body = JSON.parse(text)
      if (!Number.isSafeInteger(body.revision) || body.revision < 0) throw Error('Ogiltig version.')
      document = parseEnvironmentalProtocol(body.document, args.p_kind)
    } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Ogiltigt protokoll.' }, { status: 400 }) }
    return NextResponse.json(await environmentalCommand(args, 'save', { document, revision: body.revision }), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return environmentalError(error) }
}
