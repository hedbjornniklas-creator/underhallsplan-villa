import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { obWorkflowRpc } from './assignmentWorkflowServer'
import { roundMutationError } from './roundMutationServer'
import { isEnvironmentalKind, isUuid, type EnvironmentalFile, type EnvironmentalKind, type EnvironmentalProtocol } from './environmentalProtocol'

export const ENVIRONMENTAL_BUCKET = 'ob-environmental-files'
export type EnvironmentalState = { document: EnvironmentalProtocol | null; revision: number; files: EnvironmentalFile[] }
export function environmentalArgs(id: string, kind: string, org: { orgId: string; userId: string }) {
  if (!isUuid(id) || !isEnvironmentalKind(kind)) throw Error('OB_ENV_INVALID')
  return { p_inspection_id: id, p_kind: kind as EnvironmentalKind, p_org_id: org.orgId, p_actor: org.userId }
}
export function environmentalCommand<T>(args: ReturnType<typeof environmentalArgs>, operation: string, payload = {}) {
  return obWorkflowRpc<T>('ob_environmental_command', { ...args, p_operation: operation, p_payload: payload })
}
export function environmentalError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  const known: Record<string, [number, string]> = {
    OB_ENV_INVALID: [400, 'Ogiltigt protokoll eller bilaga.'],
    OB_ENV_CONFLICT: [409, 'Protokollet har ändrats i en annan flik eller på en annan enhet. Ditt utkast finns kvar.'],
  }
  const [status, text] = known[message] ?? (/ob_environmental_command|inspection_environmental/.test(message)
    ? [503, 'Databasstödet för radonindikering och mögelprov behöver aktiveras.'] : roundMutationError(error))
  return NextResponse.json({ error: text, conflict: message === 'OB_ENV_CONFLICT' }, { status, headers: { 'Cache-Control': 'no-store' } })
}
export async function environmentalFileResponse(file: EnvironmentalFile) {
  const { data, error } = await createSupabaseAdminClient().storage.from(ENVIRONMENTAL_BUCKET).download(file.path)
  if (error || !data) return NextResponse.json({ error: 'Originalfilen kunde inte hämtas.' }, { status: 503 })
  const bytes = Buffer.from(await data.arrayBuffer())
  if (bytes.length !== file.size || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    return NextResponse.json({ error: 'Originalfilen kunde inte verifieras.' }, { status: 503 })
  }
  return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf',
    'Content-Disposition': `attachment; filename="analysis.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } })
}
