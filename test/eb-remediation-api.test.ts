import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

type Route = {
  POST: (request: Request, context: { params: Promise<{ token: string }> }) => Promise<Response>
}

function tokenRoute(errorMessage: string): Route {
  const path = 'src/app/api/eb/remediation/[token]/route.ts'
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name === 'next/server') return { NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) } }
    if (name === '@/lib/eb/customerSession') return { assertEbCustomerRequestOrigin: () => undefined }
    if (name === '@/lib/eb/ownerAuth' || name === '@/lib/eb/followUpServer') return {}
    if (name === '@/lib/eb/remediation') return {
      performEbRemediationTokenAction: async () => { throw new Error(errorMessage) },
      getEbRemediationWorkspaceByToken: async () => { throw new Error('Unexpected read') },
    }
    throw new Error(`Unexpected dependency ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as Route
}

async function actionError(message: string) {
  return tokenRoute(message).POST(new Request('https://example.test/api/eb/remediation/private', {
    method: 'POST', body: JSON.stringify({ action: 'status', payload: {} }),
  }), { params: Promise.resolve({ token: 'private-token' }) })
}

test('a conflicting edit is HTTP409 with recoverable draft guidance, not a false success', async () => {
  const response = await actionError('EB_REMEDIATION_CONFLICT')
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /osparade text finns kvar/)
})

test('paid completion asks for photo OR explanation; legacy photo requirement is unchanged', async () => {
  const paid = await actionError('EB_REMEDIATION_COMPLETION_EVIDENCE_REQUIRED')
  assert.equal(paid.status, 400)
  assert.match((await paid.json()).error, /åtgärdsbild eller en förklarande kommentar/)
  const legacy = await actionError('EB_REMEDIATION_COMPLETION_IMAGE_REQUIRED')
  assert.equal(legacy.status, 400)
  assert.match((await legacy.json()).error, /minst en åtgärdsbild/)
})

test('view-only recipient and paused-order writes are denied', async () => {
  assert.equal((await actionError('EB_REMEDIATION_ACTION_FORBIDDEN')).status, 403)
  const response = await actionError('EB_FOLLOW_UP_ORDER_INACTIVE')
  assert.equal(response.status, 403)
  assert.match((await response.json()).error, /historik finns kvar/)
})

test('withdrawing an order requires an explicit confirmation and returns actionable HTTP400', async () => {
  const response = await actionError('EB_FOLLOW_UP_WITHDRAWAL_CONFIRMATION_REQUIRED')
  assert.equal(response.status, 400)
  assert.match((await response.json()).error, /Kontrollera beställningen och bekräfta/)
})

test('expired and revoked access remain HTTP410', async () => {
  assert.equal((await actionError('EB_REMEDIATION_ACCESS_EXPIRED')).status, 410)
  assert.equal((await actionError('EB_REMEDIATION_ACCESS_REVOKED')).status, 410)
})

test('unexpected service errors do not leak database or private context', async () => {
  const response = await actionError('PRIVATE_DATABASE_ERROR: buyer@example.test relation missing')
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /PRIVATE|buyer@example|relation/)
})
