import { NextResponse } from 'next/server'
import { randomUUID, createHash } from 'node:crypto'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { environmentalArgs, environmentalCommand, environmentalError, environmentalFileResponse, ENVIRONMENTAL_BUCKET, type EnvironmentalState } from '@/lib/ob/environmentalServer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string; kind: string }> }
export async function GET(request: Request, context: Context) {
  try {
    const org = await requireOrgContext(), { id, kind } = await context.params
    const state = await environmentalCommand<EnvironmentalState>(environmentalArgs(id, kind, org), 'read')
    const file = state.files.find(file => file.id === new URL(request.url).searchParams.get('file'))
    if (!file) return NextResponse.json({ error: 'Bilagan hittades inte.' }, { status: 404 })
    return environmentalFileResponse(file)
  } catch (error) { return environmentalError(error) }
}
export async function POST(request: Request, context: Context) {
  try {
    const org = await requireOrgContext(), { id, kind } = await context.params
    const args = environmentalArgs(id, kind, org)
    await environmentalCommand(args, 'read')
    if (Number(request.headers.get('content-length')) > 4.25 * 1024 * 1024) return NextResponse.json({ error: 'Maximal filstorlek är 4 MB.' }, { status: 413 })
    const form = await request.formData(), file = form.get('file')
    if (!(file instanceof File) || file.type !== 'application/pdf' || !file.size || file.size > 4 * 1024 * 1024) {
      return NextResponse.json({ error: 'Välj en PDF-fil, högst 4 MB.' }, { status: 400 })
    }
    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.subarray(0, 5).toString() !== '%PDF-') return NextResponse.json({ error: 'Filen är inte en PDF.' }, { status: 400 })
    const fileId = randomUUID(), path = `${org.orgId}/${id}/${kind}/${fileId}.pdf`
    const metadata = { id: fileId, path, name: file.name.replace(/[\x00-\x1f\\/]/g, '_').slice(0, 200), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
    const admin = createSupabaseAdminClient()
    const { error } = await admin.storage.from(ENVIRONMENTAL_BUCKET).upload(path, bytes, { contentType: 'application/pdf', upsert: false })
    if (error) throw error
    // A lost RPC response does not prove registration failed. Never delete a possibly registered original.
    await environmentalCommand(args, 'file', metadata)
    // Files are immutable. Detaching from a draft never deletes a published original.
    return NextResponse.json({ file: metadata }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return environmentalError(error) }
}
