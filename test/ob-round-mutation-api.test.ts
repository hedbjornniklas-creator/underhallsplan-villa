import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(
    readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name === 'next/server') return { NextResponse: Response }
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    compiled,
    compiled.exports,
  )
  return compiled.exports as T
}
const floors = load('src/lib/ob/overviewFloors.ts', {})
const helpers = load<typeof import('../src/lib/ob/roundMutationServer')>(
  'src/lib/ob/roundMutationServer.ts',
  { './overviewFloors': floors },
)
const id = randomUUID(),
  actor = randomUUID(),
  org = randomUUID(),
  note = randomUUID()
const context = { params: Promise.resolve({ id }) }
const payload = { kind: 'note', id: note }
const request = (body: unknown) =>
  new Request('http://localhost/api/test', {
    method: 'POST',
    body: JSON.stringify(body),
  })
function route(options: { authError?: string; rpcError?: string } = {}) {
  const calls: Array<Record<string, unknown>> = []
  const api = load<
    typeof import('../src/app/api/ob/inspections/[id]/round/route')
  >('src/app/api/ob/inspections/[id]/round/route.ts', {
    '@/lib/assignments/server': {
      requireOrgContext: async () => {
        if (options.authError) throw Error(options.authError)
        return { orgId: org, userId: actor }
      },
    },
    '@/lib/ob/roundMutationServer': helpers,
    '@/lib/ob/assignmentWorkflowServer': {
      obWorkflowRpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'ob_round_mutate')
        calls.push(args)
        if (options.rpcError) throw Error(options.rpcError)
        return args.p_operation === 'floor-context'
          ? { rooms: [{ floor_label: 'plan2' }], values: {}, groups: [] }
          : { token: 'result' }
      },
    },
  })
  return { api, calls }
}

test('round API validates input before RPC and never trusts caller actor, org or floor keys', async () => {
  const { api, calls } = route()
  for (const body of [
    null,
    {},
    { operation: 'floor-context', payload: {} },
    { operation: 'remove', payload },
    { operation: 'move', payload: { ...payload, requestId: randomUUID() } },
    {
      operation: 'image-note',
      payload: {
        imageId: randomUUID(),
        requestId: randomUUID(),
        token: 'a'.repeat(32),
        draft: { note: 4 },
      },
    },
  ]) {
    assert.equal((await api.POST(request(body), context)).status, 400)
  }
  assert.equal(
    (
      await api.POST(
        new Request('http://localhost', { method: 'POST', body: '{' }),
        context,
      )
    ).status,
    400,
  )
  assert.equal(
    (
      await api.POST(request({ operation: 'remove-preview', payload }), {
        params: Promise.resolve({ id: 'bad' }),
      })
    ).status,
    400,
  )
  assert.equal(calls.length, 0)
  const response = await api.POST(
    request({
      operation: 'remove-preview',
      payload,
      p_actor: randomUUID(),
      p_org_id: randomUUID(),
      p_floor_keys: ['plan99'],
    }),
    context,
  )
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(calls[0], {
    p_inspection_id: id,
    p_org_id: org,
    p_actor: actor,
    p_operation: 'remove-preview',
    p_payload: payload,
    p_floor_keys: [],
  })
  const move = {
    kind: 'room',
    id: randomUUID(),
    requestId: randomUUID(),
    from: { floor: 'plan1' },
    floor: 'plan2',
  }
  assert.equal(
    (
      await api.POST(
        request({ operation: 'move', payload: move, p_floor_keys: ['plan99'] }),
        context,
      )
    ).status,
    200,
  )
  assert.equal(calls[1].p_operation, 'floor-context')
  assert.ok((calls[2].p_floor_keys as string[]).includes('plan2'))
  assert.equal((calls[2].p_floor_keys as string[]).includes('plan99'), false)
})

test('round API guards authorization, locks, stale writes, request size and missing migration', async () => {
  for (const [error, status] of [
    ['UNAUTHORIZED', 401],
    ['ORG_MEMBERSHIP_REQUIRED', 403],
  ] as const) {
    const { api, calls } = route({ authError: error })
    assert.equal(
      (
        await api.POST(
          request({ operation: 'remove-preview', payload }),
          context,
        )
      ).status,
      status,
    )
    assert.equal(calls.length, 0)
  }
  for (const [error, status] of [
    ['OB_ROUND_FORBIDDEN', 403],
    ['OB_ROUND_STALE', 409],
    ['OB_ROUND_LOCKED', 409],
    ['OB_ROUND_PAUSED', 409],
    ['Could not find the function public.ob_round_mutate', 503],
    ['private server details', 500],
  ] as const) {
    const { api } = route({ rpcError: error })
    const response = await api.POST(
      request({ operation: 'remove-preview', payload }),
      context,
    )
    assert.equal(response.status, status)
    assert.equal(
      (await response.text()).includes('private server details'),
      false,
    )
  }
  const { api, calls } = route()
  assert.equal(
    (
      await api.POST(
        request({
          operation: 'remove-preview',
          payload,
          oversized: 'x'.repeat(100001),
        }),
        context,
      )
    ).status,
    413,
  )
  assert.equal(calls.length, 0)
})
