import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
// @ts-expect-error Node's strip-types runner requires the file extension.
import { environmentalLoader } from './helpers/environmental-load.ts'
import type * as Protocol from '../src/lib/ob/environmentalProtocol'
import type * as Server from '../src/lib/ob/environmentalServer'
import type * as Route from '../src/app/api/ob/inspections/[id]/environmental/[kind]/route'
import type * as PublicRoute from '../src/app/api/reports/public/[token]/environmental-files/route'
import type * as FilesRoute from '../src/app/api/ob/inspections/[id]/environmental/[kind]/files/route'

const id = randomUUID(), orgId = randomUUID(), userId = randomUUID()
const context = { params: Promise.resolve({ id, kind: 'radon' }) }
test('API requires authentication before reading or writing and validates input before RPC', async () => {
  let calls = 0, authenticated = false
  const load = environmentalLoader({
    '@/lib/assignments/server': { requireOrgContext: async () => { if (!authenticated) throw Error('UNAUTHORIZED'); return { orgId, userId } } },
    './assignmentWorkflowServer': { obWorkflowRpc: async () => { calls++; return { revision: 1 } } },
    './roundMutationServer': { roundMutationError: () => [401, 'Unauthorized'] },
    '@/lib/supabase/admin': {},
  })
  const route = load<typeof Route>('src/app/api/ob/inspections/[id]/environmental/[kind]/route.ts')
  assert.equal((await route.GET(new Request('http://local/'), context)).status, 401)
  authenticated = true
  const patch = (body: string) => route.PATCH(new Request('http://local/', { method: 'PATCH', body }), context)
  assert.equal((await patch('{')).status, 400)
  assert.equal((await patch('x'.repeat(200001))).status, 413)
  assert.equal(calls, 0)
  const p = load<typeof Protocol>('src/lib/ob/environmentalProtocol.ts')
  assert.equal((await patch(JSON.stringify({ revision: 0, document: p.emptyProtocol() }))).status, 200)
  assert.equal(calls, 1)
})
test('conflict responses preserve an actionable 409', async () => {
  const load = environmentalLoader({ './assignmentWorkflowServer': {}, './roundMutationServer': {}, '@/lib/supabase/admin': {} })
  const server = load<typeof Server>('src/lib/ob/environmentalServer.ts')
  const response = server.environmentalError(Error('OB_ENV_CONFLICT'))
  assert.equal(response.status, 409); assert.equal((await response.json()).conflict, true)
})
test('uploads validate PDF and size, never overwrite or delete an original on a lost response', async () => {
  const uploads: { path: string; options: { upsert: boolean } }[] = []
  let failRegistration = false
  const load = environmentalLoader({
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId, userId }) },
    './assignmentWorkflowServer': { obWorkflowRpc: async (_: string, args: { p_operation: string }) => {
      if (args.p_operation === 'file' && failRegistration) throw Error('response lost')
      return { document: null, revision: 0, files: [] }
    } },
    './roundMutationServer': { roundMutationError: () => [503, 'Try again'] },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ storage: { from: () => ({
      upload: async (path: string, _bytes: unknown, options: { upsert: boolean }) => { uploads.push({ path, options }); return {} },
      remove: () => { throw Error('Original must not be deleted') },
    }) } }) },
  })
  const route = load<typeof FilesRoute>('src/app/api/ob/inspections/[id]/environmental/[kind]/files/route.ts')
  const upload = (file: File) => { const body = new FormData(); body.set('file', file); return route.POST(new Request('http://local/', { method: 'POST', body }), context) }
  assert.equal((await upload(new File(['not PDF'], 'Fake.pdf', { type: 'application/pdf' }))).status, 400)
  assert.equal((await upload(new File(['%PDF-test'], 'Fake.txt', { type: 'text/plain' }))).status, 400)
  assert.equal((await upload(new File([new Uint8Array(4 * 1024 * 1024 + 1)], 'Big.pdf', { type: 'application/pdf' }))).status, 400)
  assert.equal(uploads.length, 0)
  assert.equal((await upload(new File(['%PDF-test'], 'Original.pdf', { type: 'application/pdf' }))).status, 200)
  failRegistration = true
  assert.equal((await upload(new File(['%PDF-test'], 'Original.pdf', { type: 'application/pdf' }))).status, 503)
  assert.equal(uploads.length, 2); assert.notEqual(uploads[0].path, uploads[1].path)
  assert.ok(uploads.every(file => !file.options.upsert && file.path.startsWith(`${orgId}/${id}/radon/`)))
})
test('file downloads check the frozen hash and size', async () => {
  let bytes = Buffer.from('%PDF-test')
  const load = environmentalLoader({ './assignmentWorkflowServer': {}, './roundMutationServer': {},
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]) }) }) } }) },
  })
  const { environmentalFileResponse } = load<typeof Server>('src/lib/ob/environmentalServer.ts')
  const file = { id: randomUUID(), name: 'Lab.pdf', path: 'original', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
  const ok = await environmentalFileResponse(file)
  assert.equal(ok.status, 200); assert.match(ok.headers.get('content-disposition')!, /attachment/)
  bytes = Buffer.from('%PDF-edit')
  assert.equal((await environmentalFileResponse(file)).status, 503)
})
test('public attachment access resolves only an active link and its frozen file list', async () => {
  const file = { id: randomUUID(), name: 'Saved.pdf', path: `${orgId}/${id}/radon/test.pdf`, size: 1, sha256: 'a'.repeat(64) }
  let revoked = false, files = [file], requests = 0
  const load = environmentalLoader({
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => value },
    '@/lib/report/reportSnapshotPayload': { isReportSnapshotPayloadV1: () => true },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => ({ select: () => ({ eq: (_: string, token: string) => ({ maybeSingle: async () => ({ data: token === 'valid-token-1234567890' ? { inspection_id: id, org_id: orgId, revoked_at: revoked ? 'now' : null, snapshot_payload: { reportData: { mock: { appendices: { environmental: [{ files }] } } } } } : null }) }) }) }) }) },
    '@/lib/ob/environmentalServer': { environmentalFileResponse: async () => { requests++; return new Response('original') } },
  })
  const route = load<typeof PublicRoute>('src/app/api/reports/public/[token]/environmental-files/route.ts')
  const get = (fileId = file.id, token = 'valid-token-1234567890') => route.GET(new Request(`http://local/?file=${fileId}`), { params: Promise.resolve({ token }) })
  assert.equal((await get()).status, 200)
  assert.equal((await get(randomUUID())).status, 404)
  assert.equal((await get(file.id, 'invalid-token-123456789')).status, 404)
  revoked = true; assert.equal((await get()).status, 404)
  revoked = false; files = [{ ...file, path: 'another-inspection/original.pdf' }]; assert.equal((await get()).status, 404)
  files = []; assert.equal((await get()).status, 404)
  assert.equal(requests, 1)
})
