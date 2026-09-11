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
const modelHelpers = load<typeof import('../src/lib/ob/floorModel')>('src/lib/ob/floorModel.ts', {})
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
function route(options: { authError?: string; rpcError?: string; model?: { levels: { level: number; name: string }[]; revision: number } } = {}) {
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
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({}) },
    '@/lib/ob/floorModelStore': { readObFloorModel: async () => options.model ?? null },
    '@/lib/ob/floorModel': load('src/lib/ob/floorModel.ts', {}),
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

test('floor helpers preserve old numbering and sort explicit negative/zero/positive levels numerically', () => {
  const old = floors as typeof import('../src/lib/ob/overviewFloors')
  assert.deepEqual(old.buildInteriorFloorKeysFromOverview({ floors: 3, basement: 'ja' }), ['k\u00e4llare','plan1','plan2','plan3'])
  const model = { revision: 1, levels: [{ level: 10, name: '' }, { level: -2, name: 'K\u00e4llare' }, { level: 0, name: 'Entr\u00e9plan' }, { level: 2, name: '' }] }
  assert.deepEqual(modelHelpers.floorModelKeys(model), ['plan-2','plan0','plan2','plan10'])
  assert.equal(modelHelpers.modelFloorLabel(model, 'plan0'), 'Plan 0 \u00b7 Entr\u00e9plan')
  assert.equal(modelHelpers.modelFloorLabel(model, 'ovrigt'), 'Allm\u00e4nt')
  assert.equal(modelHelpers.validFloorLevels(model.levels), true)
  assert.equal(modelHelpers.validFloorLevels([...model.levels, { level: 0, name: '' }]), false)
})

test('floor model reads only fall back for absent migration or absent model, never network/access errors', async () => {
  const store = load<typeof import('../src/lib/ob/floorModelStore')>('src/lib/ob/floorModelStore.ts', { './floorModel': modelHelpers })
  const read = (data: unknown, error: unknown) => store.readObFloorModel({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data, error }) }) }) }),
  } as unknown as Parameters<typeof store.readObFloorModel>[0], id)
  assert.equal(await read(null, { code: '42P01' }), null)
  assert.equal(await read(null, { code: 'PGRST205' }), null)
  assert.equal(await read(null, null), null)
  await assert.rejects(read(null, { code: '42501', message: 'denied' }))
  await assert.rejects(read(null, { message: 'network error' }))
  await assert.rejects(read({ revision: 1, levels: [] }, null))
})

test('building-data report uses the new labels and numeric ordering only with an explicit model', () => {
  const report = load<typeof import('../src/lib/report/buildingData')>('src/lib/report/buildingData.ts', {
    'server-only': {}, '@/content/standardtexts/loadStandardText': {}, '@/lib/ob/floorModel': modelHelpers,
  })
  const data = { items: [{ id: 'frame', key: 'structure' }], groups: [], options: [], selections: [
    { overview_item_id: 'frame', floor_key: 'plan1', values: { material: 'Wood' } },
    { overview_item_id: 'frame', floor_key: 'plan0', values: { material: 'Brick' } },
    { overview_item_id: 'frame', floor_key: 'plan-1', values: { material: 'Concrete' } },
  ] }
  assert.equal(report.buildBuildingDataMap({ ...data, selections: data.selections.slice(0, 1) })['Stomme:'], 'Plan 1: Wood')
  assert.equal(report.buildBuildingDataMap({ ...data, floorModel: { revision: 1, levels: [
    { level: 0, name: 'Entrance' }, { level: -1, name: 'Suterrang' }, { level: 1, name: '' },
  ] } })['Stomme:'], 'Plan -1 \u00b7 Suterrang: Concrete | Plan 0 \u00b7 Entrance: Brick | Plan 1: Wood')
})

test('new-model room moves only trust configured levels, not legacy overview inference', async () => {
  const { api, calls } = route({ model: { revision: 1, levels: [{ level: 0, name: '' }, { level: -1, name: '' }] } })
  const response = await api.POST(request({ operation: 'move', payload: { kind: 'room', id: randomUUID(), requestId: randomUUID(), from: { floor: 'plan0' }, floor: 'plan-1' } }), context)
  assert.equal(response.status, 200)
  assert.deepEqual(calls[1].p_floor_keys, ['ovrigt','plan-1','plan0'])
})

test('floor API uses authenticated identity, validates input and returns actionable conflicts', async () => {
  const calls: Record<string, unknown>[] = []
  let failure = ''
  const api = load<typeof import('../src/app/api/ob/inspections/[id]/floors/route')>('src/app/api/ob/inspections/[id]/floors/route.ts', {
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: org, userId: actor }) },
    '@/lib/ob/floorModel': modelHelpers,
    '@/lib/ob/roundMutationServer': helpers,
    '@/lib/ob/assignmentWorkflowServer': { obWorkflowRpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, 'ob_save_floor_model'); calls.push(args)
      if (failure) throw Error(failure)
      return { levels: args.p_levels, revision: 2 }
    } },
  })
  for (const body of [null, {}, { revision: 1, levels: [] }, { revision: 1, levels: [{ level: 1, name: '' }] }]) {
    assert.equal((await api.POST(request(body), context)).status, 400)
  }
  assert.equal(calls.length, 0)
  const body = { revision: 1, levels: [{ level: 0, name: 'Entrance' }], p_actor: randomUUID() }
  assert.equal((await api.POST(request(body), context)).status, 200)
  assert.equal(calls[0].p_actor, actor)
  assert.equal(calls[0].p_org_id, org)
  for (const error of ['OB_FLOOR_LEGACY','OB_FLOOR_IN_USE','OB_ROUND_STALE','OB_ROUND_LOCKED','OB_ROUND_PAUSED']) {
    failure = error
    assert.equal((await api.POST(request(body), context)).status, 409)
  }
})

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
