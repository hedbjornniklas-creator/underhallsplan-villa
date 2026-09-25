import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name === 'next/server') return { NextResponse: Response }
    assert.ok(name in dependencies, name)
    return dependencies[name]
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const helpers = load('src/lib/ob/roundMutationServer.ts', {
  './overviewFloors': load('src/lib/ob/overviewFloors.ts', {}),
})
const id = randomUUID(), actor = randomUUID(), orgId = randomUUID(), part = randomUUID()
const context = { params: Promise.resolve({ id }) }
function setup(error?: string, authError?: string) {
  const calls: Record<string, unknown>[] = []
  const api = load<typeof import('../src/app/api/ob/inspections/[id]/image-trash/route')>(
    'src/app/api/ob/inspections/[id]/image-trash/route.ts', {
      '@/lib/ob/roundMutationServer': helpers,
      '@/lib/assignments/server': { requireOrgContext: async () => {
        if (authError) throw Error(authError)
        return { orgId, userId: actor }
      } },
      '@/lib/ob/assignmentWorkflowServer': { obWorkflowRpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'ob_round_image_trash'); calls.push(args)
        if (error) throw Error(error)
        return { items: [], nextCursor: null }
      } },
    })
  return { api, calls }
}
const request = (body?: unknown, query = '') => new Request('http://localhost/trash' + query,
  body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) })

test('trash API uses authenticated identities and validates scoped pagination and restore payload', async () => {
  const { api, calls } = setup(), cursor = randomUUID()
  const response = await api.GET(request(undefined, `?partId=${part}&beforeEventId=${cursor}`), context)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(calls[0], { p_inspection_id: id, p_actor: actor, p_org_id: orgId,
    p_part_id: part, p_operation: 'list', p_payload: { beforeEventId: cursor } })
  const payload = { eventId: randomUUID(), requestId: randomUUID() }
  assert.equal((await api.POST(request({ ...payload, p_actor: 'forged' }), context)).status, 200)
  assert.deepEqual(calls[1].p_payload, payload)
  assert.equal(calls[1].p_actor, actor)
})

test('invalid trash requests and unauthenticated requests never call the database', async () => {
  const { api, calls } = setup()
  for (const query of ['?partId=bad', '?beforeEventId=bad'])
    assert.equal((await api.GET(request(undefined, query), context)).status, 400)
  assert.equal((await api.GET(request(), { params: Promise.resolve({ id: 'bad' }) })).status, 400)
  for (const payload of [null, [], {}, { eventId: randomUUID(), requestId: 'bad' }])
    assert.equal((await api.POST(request(payload), context)).status, 400)
  assert.equal((await api.POST(request('x'.repeat(2050)), context)).status, 413)
  assert.equal((await api.POST(new Request('http://localhost', { method: 'POST', body: '{' }), context)).status, 400)
  assert.equal(calls.length, 0)
  const denied = setup(undefined, 'UNAUTHORIZED')
  assert.equal((await denied.api.GET(request(), context)).status, 401)
  assert.equal(denied.calls.length, 0)
})

test('trash API returns actionable safe errors including unavailable migration', async () => {
  for (const [error, status] of [
    ['OB_TRASH_NOT_FOUND', 404], ['OB_TRASH_EXPIRED', 409], ['OB_TRASH_FILE_MISSING', 409],
    ['OB_ROUND_LOCKED', 409], ['OB_ROUND_FORBIDDEN', 403],
    ['Could not find the function public.ob_round_image_trash in the schema cache', 503],
    ['private secret database detail', 500],
  ] as const) {
    const { api } = setup(error)
    const result = await api.GET(request(), context)
    assert.equal(result.status, status)
    assert.equal(result.headers.get('Cache-Control'), 'no-store')
    assert.ok(!(await result.text()).includes(error))
  }
})
