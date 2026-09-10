import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the explicit extension.
import { validateObEarlyStartReason } from '../src/lib/ob/assignmentWorkflow.ts'

type Context = { params: Promise<{ id: string; inspectionId: string }> }
type Route = { POST: (request: Request, context: Context) => Promise<Response>; GET: (request: Request, context: Context) => Promise<Response> }
function load(path: string, dependencies: Record<string, unknown>): Route {
  const output = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name === 'next/server') return { NextResponse: Response, after: () => assert.fail('No background job while blocked') }
    if (name === 'node:crypto') return { randomUUID }
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as Route
}
const context = { params: Promise.resolve({ id: 'test-inspection', inspectionId: 'test-inspection' }) }
const org = { orgId: 'test-org', userId: 'test-actor' }
const request = (body: unknown) => new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) })
const deniedWorkflow = { canDeliver: false, reason: 'Inväntar kundens godkännande.' }
const workflowDependency = {
  getObAssignmentWorkflow: async () => deniedWorkflow,
  obWorkflowError: (error: unknown) => error instanceof Error && error.message === 'OB_ASSIGNMENT_FORBIDDEN' ? [403, 'Endast ansvarig besiktningsman eller administratör.'] : null,
}

test('early start requires explicit confirmation and reason; actor/org are taken from the session', async () => {
  const calls: unknown[] = []
  const route = load('src/app/api/ob/assignments/[id]/convert/route.ts', {
    '@/lib/assignments/server': { requireOrgContext: async () => org, convertAssignmentToInspection: async (input: unknown) => { calls.push(input); return { inspectionId: 'started' } } },
    '@/lib/ob/assignmentWorkflowServer': workflowDependency,
    '@/lib/ob/assignmentWorkflow': { validateObEarlyStartReason },
  })
  for (const body of [{ earlyStartReason: 'A valid reason' }, { earlyStartReason: '', confirmEarlyStart: true }]) {
    assert.equal((await route.POST(request(body), context)).status, 400)
  }
  assert.equal(calls.length, 0)
  assert.equal((await route.POST(request({ earlyStartReason: '  A valid reason  ', confirmEarlyStart: true, orgId: 'forged', actor: 'forged' }), context)).status, 200)
  assert.deepEqual(calls, [{ orgId: org.orgId, assignmentId: 'test-inspection', requestedByUserId: org.userId, earlyStartReason: 'A valid reason' }])
})

test('review requires explicit confirmation and a version token; forbidden actors get HTTP403', async () => {
  let writes = 0
  const route = load('src/app/api/ob/inspections/[id]/assignment-workflow/route.ts', {
    '@/lib/assignments/server': { requireOrgContext: async () => org },
    '@/lib/ob/assignmentWorkflowServer': { ...workflowDependency, obWorkflowRpc: async () => { writes++; throw new Error('OB_ASSIGNMENT_FORBIDDEN') } },
  })
  assert.equal((await route.POST(request({ reviewToken: 'token' }), context)).status, 400)
  assert.equal((await route.POST(new Request('http://localhost/api/test', { method: 'POST', body: '{' }), context)).status, 400)
  assert.equal(writes, 0)
  assert.equal((await route.POST(request({ reviewToken: 'token', confirmed: true }), context)).status, 403)
  assert.equal(writes, 1)
})

function readOnlyAdmin() {
  return { from: (table: string) => {
    assert.ok(['inspections', 'assignments'].includes(table), `Blocked delivery must not access ${table}`)
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({ error: null, data: table === 'inspections' ? {
        id: 'test-inspection', status: 'draft', inspection_family: 'OB', property_id: 'test-property',
      } : { id: 'test-assignment', org_id: org.orgId, customer_email: 'customer@example.invalid' } }),
      update: () => assert.fail('No update while delivery blocked'),
      insert: () => assert.fail('No insertion while delivery blocked'),
    }
    return query
  } }
}

test('all final delivery actions stop before writes, PDF generation or mail', async () => {
  const previous = process.env.REPORT_TIMING_LOGS
  process.env.REPORT_TIMING_LOGS = '0'
  try {
    const dependencies: Record<string, unknown> = {
      '@/lib/supabase/admin': { createSupabaseAdminClient: readOnlyAdmin },
      '@/lib/assignments/server': { requireOrgContext: async () => org },
      '@/lib/ob/assignmentWorkflowServer': workflowDependency,
    }
    for (const path of ['assignments/tokens', 'assignments/mailer', 'report/pdfJobs', 'report/reportSnapshotPayload', 'report/pdfV2/buildReportDataV2', 'report/reportSpec', 'inspections/reportEmailTemplates']) dependencies[`@/lib/${path}`] = {}
    const route = load('src/app/api/ob/inspections/[id]/report-delivery/route.ts', dependencies)
    for (const action of ['complete_only', 'send_open', 'send_and_complete', 'regenerate_pdf']) {
      const response = await route.POST(request({ action }), context)
      assert.equal(response.status, 409, action)
      assert.equal((await response.json()).error, deniedWorkflow.reason)
    }
  } finally {
    if (previous === undefined) delete process.env.REPORT_TIMING_LOGS
    else process.env.REPORT_TIMING_LOGS = previous
  }
})

test('stored final PDF cannot be downloaded before approval and review', async () => {
  const source = readFileSync(new URL('../src/app/api/report-v2/[inspectionId]/pdf/route.ts', import.meta.url), 'utf8')
  const dependencies: Record<string, unknown> = {}
  for (const [, name] of source.matchAll(/from '([^']+)'/g)) dependencies[name] = {}
  Object.assign(dependencies, {
    '@/lib/supabase/admin': { createSupabaseAdminClient: readOnlyAdmin },
    '@/lib/assignments/server': { requireOrgContext: async () => org },
    '@/lib/ob/assignmentWorkflowServer': workflowDependency,
  })
  const route = load('src/app/api/report-v2/[inspectionId]/pdf/route.ts', dependencies)
  const response = await route.GET(new Request('http://localhost/api/test'), context)
  assert.equal(response.status, 409)
  assert.equal(await response.text(), deniedWorkflow.reason)
})
