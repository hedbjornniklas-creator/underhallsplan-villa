import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as AssignmentCustomerHttp from '../src/lib/assignment-customers/http'

function loadHttp() {
  const source = readFileSync(
    new URL('../src/lib/assignment-customers/http.ts', import.meta.url),
    'utf8'
  )
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name === 'server-only') return {}
      throw new Error(`Unexpected assignment-customer HTTP dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )
  return compiled.exports as typeof AssignmentCustomerHttp
}

const http = loadHttp()

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://hushub.se/api/tu/assignments', {
    method: 'POST',
    headers: {
      origin: 'https://hushub.se',
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body,
  })
}

test('same-origin and bounded JSON helpers are reusable by module routes', async () => {
  const candidate = request(JSON.stringify({ customerBinding: { mode: 'create' } }))
  assert.doesNotThrow(() => http.assertAssignmentCustomerSameOrigin(candidate))
  assert.deepEqual(await http.readAssignmentCustomerJson(candidate), {
    customerBinding: { mode: 'create' },
  })

  assert.throws(() =>
    http.assertAssignmentCustomerSameOrigin(
      request('{}', { origin: 'https://attacker.example' })
    )
  )
  await assert.rejects(
    http.readAssignmentCustomerJson(request('{}', { 'content-type': 'text/plain' })),
    { message: 'ASSIGNMENT_CUSTOMER_REQUEST_INVALID' }
  )
  await assert.rejects(http.readAssignmentCustomerJson(request('{')), {
    message: 'ASSIGNMENT_CUSTOMER_REQUEST_INVALID',
  })
  await assert.rejects(
    http.readAssignmentCustomerJson(
      request('{}', { 'content-length': String(16 * 1024 + 1) })
    ),
    { message: 'ASSIGNMENT_CUSTOMER_REQUEST_INVALID' }
  )
})

test('failure mapping is allowlisted and never reflects raw database or PII details', () => {
  assert.deepEqual(http.assignmentCustomerFailure(new Error('CUSTOMER_EMAIL_REQUIRED')), {
    code: 'ASSIGNMENT_CUSTOMER_REQUEST_FAILED',
    message: 'Kundkopplingen kunde inte hanteras just nu. Försök igen.',
    status: 500,
  })
  assert.equal(
    http.assignmentCustomerFailure(
      new Error('ASSIGNMENT_CUSTOMER_EMAIL_REQUIRED')
    ).status,
    422
  )

  const raw =
    'postgres duplicate private@example.test personnummer=900101-1234 access_token=secret'
  const failure = http.assignmentCustomerFailure(new Error(raw))
  assert.equal(failure.code, 'ASSIGNMENT_CUSTOMER_REQUEST_FAILED')
  assert.doesNotMatch(JSON.stringify(failure), /private@example|900101|access_token|postgres/i)
})
