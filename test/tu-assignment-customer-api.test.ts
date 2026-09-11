import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as AssignmentCustomerDomain from '../src/lib/assignment-customers/domain'
import type * as AssignmentCustomerHttp from '../src/lib/assignment-customers/http'

type TuRoute = {
  POST: (request: Request) => Promise<Response>
}

type HarnessOptions = {
  bindingError?: Error
  contextError?: Error
  linked?: boolean
  sendError?: Error
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const ASSIGNMENT_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'
const DRAFT_UPDATED_AT = '2026-09-11T10:15:30.123Z'
const LINKED_UPDATED_AT = '2026-09-11T10:15:31.456Z'
const tuServerSource = readFileSync(
  new URL('../src/lib/tu/server.ts', import.meta.url),
  'utf8'
)
const requireTuContextSource = tuServerSource.slice(
  tuServerSource.indexOf('export async function requireTuContext'),
  tuServerSource.indexOf('export async function listTuAssignments')
)

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      throw new Error(`Unexpected TU route dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )
  return compiled.exports as T
}

const domain = load<typeof AssignmentCustomerDomain>(
  'src/lib/assignment-customers/domain.ts',
  {
    '@/lib/customers/domain': {
      normalizeOrganizationCustomerIdentity(value: string, type: string) {
        const digits = value.replace(/\D/gu, '')
        if (type === 'business' && digits.length === 10) {
          return `${digits.slice(0, 6)}-${digits.slice(6)}`
        }
        if (type === 'private' && (digits.length === 10 || digits.length === 12)) {
          const short = digits.slice(-10)
          return `${short.slice(0, 6)}-${short.slice(6)}`
        }
        return null
      },
    },
  }
)

const http = load<typeof AssignmentCustomerHttp>(
  'src/lib/assignment-customers/http.ts',
  { 'server-only': {} }
)

const nextServer = {
  NextResponse: {
    json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init)
    },
  },
}

class AssignmentEmailSendError extends Error {
  acceptUrl: string

  constructor(message: string, acceptUrl: string) {
    super(message)
    this.acceptUrl = acceptUrl
  }
}

function harness(routePath: string, options: HarnessOptions = {}) {
  const calls: Array<{ name: string; value?: unknown }> = []
  const assignment = {
    id: ASSIGNMENT_ID,
    updated_at: DRAFT_UPDATED_AT,
    organization_customer_id: null,
  }
  const linkedAssignment = {
    ...assignment,
    updated_at: LINKED_UPDATED_AT,
    organization_customer_id: options.linked === false ? null : CUSTOMER_ID,
  }
  const customer = {
    id: CUSTOMER_ID,
    customerNumber: '1001',
    version: 1,
    created: true,
  }

  const tuServer = {
    async requireTuContext(requestedOrgId?: unknown) {
      calls.push({ name: 'context', value: requestedOrgId })
      if (options.contextError) throw options.contextError
      return {
        orgId: ORG_ID,
        userId: USER_ID,
        orgName: 'TU Pilot',
      }
    },
    async createTuAssignmentDraft(input: unknown) {
      calls.push({ name: 'create', value: input })
      return assignment
    },
    async getTuAssignmentById(orgId: string, assignmentId: string) {
      calls.push({ name: 'refetch', value: [orgId, assignmentId] })
      return linkedAssignment
    },
    async sendTuAssignmentConfirmation(input: unknown) {
      calls.push({ name: 'send', value: input })
      if (options.sendError) throw options.sendError
      return {
        acceptUrl: 'https://hushub.se/uppdrag/test-token',
        expiresAt: '2026-09-18T10:15:31.456Z',
      }
    },
  }

  const assignmentCustomerServer = {
    parseAssignmentCustomerBinding: domain.parseAssignmentCustomerBinding,
    async assignOrganizationCustomer(...args: unknown[]) {
      calls.push({ name: 'bind', value: args })
      if (options.bindingError) throw options.bindingError
      return {
        assignmentId: ASSIGNMENT_ID,
        assignmentUpdatedAt: LINKED_UPDATED_AT,
        customer,
      }
    },
    async discardUnlinkedAssignmentDraft(...args: unknown[]) {
      calls.push({ name: 'discard', value: args })
      return options.linked !== false
    },
  }

  const dependencies: Record<string, unknown> = {
    'next/server': nextServer,
    '@/lib/tu/server': tuServer,
    '@/lib/assignment-customers/server': assignmentCustomerServer,
    '@/lib/assignment-customers/http': http,
  }
  if (routePath.includes('quick-send')) {
    dependencies['@/lib/assignments/server'] = {
      AssignmentEmailSendError,
      isMissingEnvError: () => false,
    }
  }

  return {
    calls,
    route: load<TuRoute>(routePath, dependencies),
  }
}

function validBody() {
  return {
    orgId: ORG_ID,
    customerBinding: {
      mode: 'create',
      customerType: 'private',
      identityNumber: null,
    },
    customerType: 'consumer',
    customerName: 'Ny TU-kund',
    customerEmail: 'kund@example.test',
    customerPhone: '0701234567',
    customerAddress: 'Kundgatan 1',
    customerPostalCode: '111 22',
    customerCity: 'Stockholm',
    objectType: 'villa',
    propertyAddress: 'Objektgatan 2',
    propertyPostalCode: '222 33',
    propertyCity: 'Uppsala',
    cadastralId: 'Test 1:2',
    scopeDescription: 'Utred fuktskadan.',
    priceAmount: '12500',
  }
}

function request(
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  return new Request(`https://hushub.se${path}`, {
    method: 'POST',
    headers: {
      origin: 'https://hushub.se',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

async function json(response: Response) {
  return (await response.json()) as Record<string, unknown>
}

function callNames(calls: Array<{ name: string }>) {
  return calls.map((call) => call.name)
}

test('TU draft POST creates, binds with the persisted id/version and refetches the linked row', async () => {
  const setup = harness('src/app/api/tu/assignments/route.ts')
  const response = await setup.route.POST(
    request('/api/tu/assignments', validBody())
  )

  assert.equal(response.status, 201)
  assert.deepEqual(callNames(setup.calls), ['context', 'create', 'bind', 'refetch'])
  assert.deepEqual(setup.calls[0], { name: 'context', value: ORG_ID })
  assert.deepEqual(setup.calls[2], {
    name: 'bind',
    value: [
      ORG_ID,
      ASSIGNMENT_ID,
      DRAFT_UPDATED_AT,
      { mode: 'create', customerType: 'private', identityNumber: null },
    ],
  })
  assert.deepEqual(setup.calls[3], {
    name: 'refetch',
    value: [ORG_ID, ASSIGNMENT_ID],
  })

  const body = await json(response)
  assert.deepEqual(body.assignment, {
    id: ASSIGNMENT_ID,
    updated_at: LINKED_UPDATED_AT,
    organization_customer_id: CUSTOMER_ID,
  })
  assert.deepEqual(body.customer, {
    id: CUSTOMER_ID,
    customerNumber: '1001',
    version: 1,
    created: true,
  })
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
})

test('TU quick-send binds and refetches before it sends the linked assignment', async () => {
  const setup = harness('src/app/api/tu/assignments/quick-send/route.ts')
  const response = await setup.route.POST(
    request('/api/tu/assignments/quick-send', validBody())
  )

  assert.equal(response.status, 200)
  assert.match(response.headers.get('cache-control') ?? '', /no-store/)
  assert.deepEqual(callNames(setup.calls), [
    'context',
    'create',
    'bind',
    'refetch',
    'send',
  ])
  assert.deepEqual(setup.calls[0], { name: 'context', value: ORG_ID })
  assert.deepEqual(setup.calls[2].value, [
    ORG_ID,
    ASSIGNMENT_ID,
    DRAFT_UPDATED_AT,
    { mode: 'create', customerType: 'private', identityNumber: null },
  ])
  assert.deepEqual(setup.calls[3].value, [ORG_ID, ASSIGNMENT_ID])
  assert.deepEqual(setup.calls[4].value, {
    assignment: {
      id: ASSIGNMENT_ID,
      updated_at: LINKED_UPDATED_AT,
      organization_customer_id: CUSTOMER_ID,
    },
    orgName: 'TU Pilot',
    requestedByUserId: USER_ID,
  })

  assert.deepEqual(await json(response), {
    assignmentId: ASSIGNMENT_ID,
    status: 'sent',
    acceptUrl: 'https://hushub.se/uppdrag/test-token',
    expiresAt: '2026-09-18T10:15:31.456Z',
    customer: {
      id: CUSTOMER_ID,
      customerNumber: '1001',
      version: 1,
      created: true,
    },
  })
})

test('TU quick-send never sends mail when binding fails or the refetch is not linked', async () => {
  const bindingFailure = harness(
    'src/app/api/tu/assignments/quick-send/route.ts',
    { bindingError: new Error('ASSIGNMENT_CUSTOMER_INACTIVE') }
  )
  const failedBindingResponse = await bindingFailure.route.POST(
    request('/api/tu/assignments/quick-send', validBody())
  )

  assert.equal(failedBindingResponse.status, 409)
  assert.equal((await json(failedBindingResponse)).code, 'ASSIGNMENT_CUSTOMER_INACTIVE')
  assert.deepEqual(callNames(bindingFailure.calls), ['context', 'create', 'bind', 'discard'])
  assert.deepEqual(bindingFailure.calls[3].value, [
    ORG_ID,
    ASSIGNMENT_ID,
    DRAFT_UPDATED_AT,
  ])
  assert.ok(!callNames(bindingFailure.calls).includes('send'))

  const missingLink = harness(
    'src/app/api/tu/assignments/quick-send/route.ts',
    { linked: false }
  )
  const missingLinkResponse = await missingLink.route.POST(
    request('/api/tu/assignments/quick-send', validBody())
  )
  assert.equal(missingLinkResponse.status, 500)
  assert.deepEqual(callNames(missingLink.calls), [
    'context',
    'create',
    'bind',
    'refetch',
    'discard',
  ])
  assert.ok(!callNames(missingLink.calls).includes('send'))
})

test('a mail failure returns the saved assignment and cannot invite a duplicate submit', async () => {
  const setup = harness('src/app/api/tu/assignments/quick-send/route.ts', {
    sendError: new AssignmentEmailSendError(
      'provider details',
      'https://hushub.se/uppdrag/retry-token'
    ),
  })
  const response = await setup.route.POST(
    request('/api/tu/assignments/quick-send', validBody())
  )

  assert.equal(response.status, 202)
  assert.deepEqual(callNames(setup.calls), [
    'context',
    'create',
    'bind',
    'refetch',
    'send',
  ])
  const body = await json(response)
  assert.equal(body.assignmentId, ASSIGNMENT_ID)
  assert.equal(body.status, 'delivery_failed')
  assert.equal(body.deliveryFailed, true)
  assert.equal(body.acceptUrl, 'https://hushub.se/uppdrag/retry-token')
  assert.doesNotMatch(JSON.stringify(body), /provider details/)
  assert.deepEqual(body.customer, {
    id: CUSTOMER_ID,
    customerNumber: '1001',
    version: 1,
    created: true,
  })
})

test('both TU POST routes reject missing/invalid bindings before creating a draft', async () => {
  const routes = [
    {
      file: 'src/app/api/tu/assignments/route.ts',
      path: '/api/tu/assignments',
    },
    {
      file: 'src/app/api/tu/assignments/quick-send/route.ts',
      path: '/api/tu/assignments/quick-send',
    },
  ]
  const invalidBindings = [
    undefined,
    { mode: 'existing', customerId: 'not-a-uuid', customerVersion: 1 },
    {
      mode: 'create',
      customerType: 'private',
      identityNumber: null,
      email: 'must-not-be-a-selector@example.test',
    },
  ]

  for (const candidate of routes) {
    for (const customerBinding of invalidBindings) {
      const setup = harness(candidate.file)
      const body = validBody() as Record<string, unknown>
      if (customerBinding === undefined) delete body.customerBinding
      else body.customerBinding = customerBinding

      const response = await setup.route.POST(request(candidate.path, body))
      assert.equal(response.status, 400, `${candidate.file}: ${JSON.stringify(customerBinding)}`)
      assert.ok(!callNames(setup.calls).includes('create'))
      assert.ok(!callNames(setup.calls).includes('bind'))
    }
  }
})

test('both TU POST routes reject missing or invalid orgId before creating a draft', async () => {
  for (const candidate of [
    {
      file: 'src/app/api/tu/assignments/route.ts',
      path: '/api/tu/assignments',
    },
    {
      file: 'src/app/api/tu/assignments/quick-send/route.ts',
      path: '/api/tu/assignments/quick-send',
    },
  ]) {
    const missingSetup = harness(candidate.file)
    const missingBody = validBody() as Record<string, unknown>
    delete missingBody.orgId

    const missingResponse = await missingSetup.route.POST(
      request(candidate.path, missingBody)
    )
    assert.equal(missingResponse.status, 400)
    assert.deepEqual(missingSetup.calls, [])

    const invalidSetup = harness(candidate.file, {
      contextError: new Error('ORG_SELECTION_INVALID'),
    })
    const invalidBody = { ...validBody(), orgId: 'not-a-uuid' }
    const invalidResponse = await invalidSetup.route.POST(
      request(candidate.path, invalidBody)
    )

    assert.equal(invalidResponse.status, 400)
    assert.deepEqual(invalidSetup.calls, [
      { name: 'context', value: 'not-a-uuid' },
    ])
    assert.equal((await json(invalidResponse)).error, 'Den valda organisationen är ogiltig.')
  }
})

test('both TU POST routes reject cross-origin requests before context or draft creation', async () => {
  for (const candidate of [
    {
      file: 'src/app/api/tu/assignments/route.ts',
      path: '/api/tu/assignments',
    },
    {
      file: 'src/app/api/tu/assignments/quick-send/route.ts',
      path: '/api/tu/assignments/quick-send',
    },
  ]) {
    const setup = harness(candidate.file)
    const response = await setup.route.POST(
      request(candidate.path, validBody(), { origin: 'https://attacker.example' })
    )

    assert.equal(response.status, 403)
    assert.deepEqual(setup.calls, [])
    assert.equal((await json(response)).code, 'ASSIGNMENT_CUSTOMER_ORIGIN_FORBIDDEN')
  }
})

test('TU access accepts global access or access scoped to the exact organization', () => {
  assert.match(
    requireTuContextSource,
    /export async function requireTuContext\(requestedOrgId\?: unknown\)[\s\S]*?const context = await requireOrgContext\(requestedOrgId\)[\s\S]*?hasCurrentUserAccess\(\{[\s\S]*?scopeType: 'organization',[\s\S]*?scopeId: context\.orgId/
  )
  assert.match(
    requireTuContextSource,
    /hasCurrentUserAccess\(\{[\s\S]*?moduleKey: 'technical_investigations',[\s\S]*?scopeType: 'global'/
  )
  assert.match(
    requireTuContextSource,
    /if \(hasOrganizationAccess \|\| hasGlobalAccess\) return context/
  )
  assert.match(
    requireTuContextSource,
    /if \(requestedOrgId !== undefined\) throw new Error\('MODULE_ACCESS_REQUIRED'\)/
  )
})
