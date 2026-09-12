import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

type ProfileCardRoute = {
  PUT: (request: Request) => Promise<Response>
}

type RouteHarnessOptions = {
  saveError?: Error
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
    {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      throw new Error(`Unexpected profile-card route dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as T
}

const nextServer = {
  NextResponse: {
    json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init)
    },
  },
}

function routeHarness(options: RouteHarnessOptions = {}) {
  const contextCalls: unknown[] = []
  const parserCalls: unknown[] = []
  const saveCalls: unknown[] = []
  const workspaceCalls: unknown[] = []
  const values = {
    displayName: 'Anna Besiktningsman',
    title: null,
    phone: null,
    email: 'anna@example.test',
    companyName: 'Exempel Ingenjörer AB',
    companyOrgNo: null,
    companyAddress: null,
    companyPostalCode: null,
    companyCity: null,
    avatarPath: null,
    logoPath: null,
    signaturePath: null,
    reportFooterText: null,
  }
  const workspace = {
    profileId: PROFILE_ID,
    organization: { id: ORG_ID, name: 'Vald organisation', isDefault: false },
    role: 'inspector',
    configured: true,
    migrationRequired: false,
    version: 5,
    source: 'organization_card',
    card: values,
  }

  const route = load<ProfileCardRoute>('src/app/api/tu/profile-card/route.ts', {
    'next/server': nextServer,
    '@/lib/tu/server': {
      requireTuContext: async (orgId: unknown) => {
        contextCalls.push(orgId)
        return {
          userId: PROFILE_ID,
          orgId: ORG_ID,
          orgName: 'Vald organisation',
          role: 'inspector',
        }
      },
    },
    '@/lib/organizations/profileCardTypes': {
      parseOrganizationProfileCardValues: (card: unknown) => {
        parserCalls.push(card)
        return values
      },
    },
    '@/lib/organizations/profileCard': {
      saveOrganizationProfileCard: async (input: unknown) => {
        saveCalls.push(input)
        if (options.saveError) throw options.saveError
      },
      getOrganizationProfileWorkspace: async (input: unknown) => {
        workspaceCalls.push(input)
        return workspace
      },
    },
  })

  return {
    route,
    values,
    workspace,
    contextCalls,
    parserCalls,
    saveCalls,
    workspaceCalls,
  }
}

function request(
  body: string,
  headers: Record<string, string> = {}
) {
  return new Request('https://hushub.se/api/tu/profile-card', {
    method: 'PUT',
    headers: {
      origin: 'https://hushub.se',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body,
  })
}

function cardEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    orgId: ORG_ID,
    expectedVersion: 4,
    card: { displayName: 'Untrusted browser card' },
    ...overrides,
  }
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function assertPrivateNoStore(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /\bprivate\b/u)
  assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/u)
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
  assert.equal(response.headers.get('vary'), 'Cookie')
}

test('profile-card PUT derives both target and actor profile from authenticated TU context', async () => {
  const harness = routeHarness()
  const browserCard = cardEnvelope().card
  const response = await harness.route.PUT(request(JSON.stringify(cardEnvelope())))

  assert.equal(response.status, 200)
  assert.deepEqual(await json(response), { workspace: harness.workspace })
  assert.deepEqual(harness.contextCalls, [ORG_ID])
  assert.deepEqual(harness.parserCalls, [browserCard])
  assert.deepEqual(harness.saveCalls, [{
    orgId: ORG_ID,
    profileId: PROFILE_ID,
    actorProfileId: PROFILE_ID,
    expectedVersion: 4,
    values: harness.values,
  }])
  assert.deepEqual(harness.workspaceCalls, [{
    orgId: ORG_ID,
    orgName: 'Vald organisation',
    profileId: PROFILE_ID,
    role: 'inspector',
  }])
  assertPrivateNoStore(response)
})

test('profile-card PUT rejects cross-site, oversized and non-JSON requests before context work', async () => {
  const cases = [
    request(JSON.stringify(cardEnvelope()), { origin: 'https://attacker.test' }),
    request(JSON.stringify(cardEnvelope()), { 'sec-fetch-site': 'cross-site' }),
    request(JSON.stringify(cardEnvelope()), { 'content-type': 'text/plain' }),
    request(JSON.stringify(cardEnvelope()), { 'content-length': '64001' }),
  ]

  for (const candidate of cases) {
    const harness = routeHarness()
    const response = await harness.route.PUT(candidate)

    assert.ok([403, 413, 415].includes(response.status), `Unexpected status ${response.status}`)
    assert.deepEqual(harness.contextCalls, [])
    assert.deepEqual(harness.saveCalls, [])
    assertPrivateNoStore(response)
  }
})

test('profile-card PUT accepts only the exact versioned envelope', async () => {
  const invalidBodies: unknown[] = [
    null,
    [],
    { orgId: ORG_ID, expectedVersion: 4 },
    { orgId: ORG_ID, card: {} },
    cardEnvelope({ expectedVersion: 0 }),
    cardEnvelope({ expectedVersion: -1 }),
    cardEnvelope({ expectedVersion: 1.5 }),
    cardEnvelope({ expectedVersion: '4' }),
    cardEnvelope({ profileId: PROFILE_ID }),
    cardEnvelope({ actorProfileId: PROFILE_ID }),
  ]

  for (const body of invalidBodies) {
    const harness = routeHarness()
    const response = await harness.route.PUT(request(JSON.stringify(body)))

    assert.equal(response.status, 400)
    assert.equal((await json(response)).code, 'ORG_PROFILE_CARD_INPUT_INVALID')
    assert.deepEqual(harness.contextCalls, [])
    assert.deepEqual(harness.parserCalls, [])
    assert.deepEqual(harness.saveCalls, [])
    assertPrivateNoStore(response)
  }

  const malformedHarness = routeHarness()
  const malformedResponse = await malformedHarness.route.PUT(request('{'))
  assert.equal(malformedResponse.status, 400)
  assert.deepEqual(malformedHarness.contextCalls, [])
})

test('profile-card PUT maps optimistic conflicts but keeps unexpected diagnostics opaque', async () => {
  const conflict = routeHarness({ saveError: new Error('ORG_PROFILE_CARD_CONFLICT') })
  const conflictResponse = await conflict.route.PUT(request(JSON.stringify(cardEnvelope())))
  assert.equal(conflictResponse.status, 409)
  assert.equal((await json(conflictResponse)).code, 'ORG_PROFILE_CARD_CONFLICT')
  assertPrivateNoStore(conflictResponse)

  const diagnostic = 'access_token=secret private@example.test provider response'
  const unknown = routeHarness({ saveError: new Error(diagnostic) })
  const unknownResponse = await unknown.route.PUT(request(JSON.stringify(cardEnvelope())))
  const unknownBody = await json(unknownResponse)
  assert.equal(unknownResponse.status, 500)
  assert.equal(unknownBody.code, 'ORG_PROFILE_CARD_SAVE_FAILED')
  assert.doesNotMatch(JSON.stringify(unknownBody), /access_token|private@example|provider response/iu)
  assertPrivateNoStore(unknownResponse)
})

test('media API statically enforces organization context, image limits and isolated storage paths', () => {
  const source = readFileSync(
    new URL('../src/app/api/tu/profile-card/media/route.ts', import.meta.url),
    'utf8'
  ).replace(/\s+/gu, ' ')

  assert.match(source, /const ALLOWED_FIELDS = new Set\(\['avatarPath', 'logoPath', 'signaturePath'\]\)/u)
  assert.match(source, /searchParams\.getAll\('orgId'\)\.length !== 1/u)
  assert.match(source, /searchParams\.getAll\('field'\)\.length !== 1/u)
  assert.match(source, /const context = await requireTuContext\(searchParams\.get\('orgId'\)\)/u)
  assert.ok(
    source.indexOf('requireTuContext') < source.indexOf('await request.formData()'),
    'Membership and TU access must be checked before multipart parsing'
  )
  assert.match(source, /file\.size <= 0 \|\| file\.size > MAX_FILE_SIZE/u)
  assert.match(source, /const detected = detectImage\(buffer\)/u)
  assert.match(source, /sharp\(buffer, \{ failOn: 'error' \}\)\.metadata\(\)/u)
  assert.match(source, /width \* height > MAX_PIXEL_COUNT/u)
  assert.match(source, /'profiles', context\.userId, 'organizations', context\.orgId/u)
  assert.match(source, /upsert: false/u)
  assert.doesNotMatch(source, /searchParams\.get\('profileId'\)/u)
})

test('persistence and SQL contracts keep every card scoped to an active organization membership', () => {
  const server = readFileSync(
    new URL('../src/lib/organizations/profileCard.ts', import.meta.url),
    'utf8'
  ).replace(/\s+/gu, ' ')
  const sql = readFileSync(
    new URL('../docs/db/2026-09-12_07_profile_org_cards.sql', import.meta.url),
    'utf8'
  ).replace(/\s+/gu, ' ').toLowerCase()

  assert.match(server, /\.eq\('org_id', input\.orgId\) \.eq\('profile_id', input\.profileId\) \.eq\('version', input\.expectedVersion\)/u)
  assert.match(server, /org_id: input\.orgId, profile_id: input\.profileId/u)
  assert.match(server, /selectedMembership = memberships\.find\(\(membership\) => membership\.org_id === input\.orgId\)/u)
  assert.match(server, /if \(!selectedMembership\) throw new Error\('ORG_MEMBERSHIP_REQUIRED'\)/u)

  assert.match(sql, /unique \(org_id, profile_id\)/u)
  assert.match(sql, /foreign key \(org_id, profile_id\) references public\.org_members \(org_id, profile_id\)/u)
  assert.match(sql, /alter table public\.profile_org_cards force row level security/u)
  assert.match(sql, /profile_id = auth\.uid\(\) and public\.is_org_member\(org_id\)/u)
  assert.match(sql, /or public\.is_org_admin\(org_id\)/u)
  assert.match(sql, /using \(public\.is_org_admin\(org_id\)\)/u)
})
