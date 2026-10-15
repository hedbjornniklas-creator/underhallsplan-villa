import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires the explicit extension.
import { canEditObAssignment } from '../src/lib/ob/assignmentEditLock.ts'

test('only active, unissued drafts can be edited; early-start replacement links do not lock new drafts', () => {
  assert.equal(canEditObAssignment(null), false)
  assert.equal(canEditObAssignment(undefined), false)
  for (const status of ['sent', 'ordered', 'booked', 'completed', 'expired', 'cancelled', 'unknown']) {
    assert.equal(canEditObAssignment({ status }), false, status)
  }
  for (const key of ['accepted_at', 'last_sent_at', 'booked_at', 'archived_at']) {
    assert.equal(canEditObAssignment({ status: 'draft', [key]: '2026-10-15' }), false, key)
  }
  assert.equal(canEditObAssignment({ status: 'draft', accepted_at: null, last_sent_at: null }), true)
  const replacement = { status: 'draft', inspection_id: 'same-inspection', converted_at: '2026-10-15' }
  assert.equal(canEditObAssignment(replacement), true)
})

type UpdateInput = {
  orgId: string; assignmentId: string; updatedBy: string; requireUnissuedDraft?: boolean
  patch: { customer_name?: string; status?: string }
}

function serverHarness(result: { data: unknown; error: unknown }) {
  const filters: unknown[][] = []
  const writes: unknown[] = []
  const query = {
    update: (value: unknown) => { writes.push(value); return query },
    eq: (key: string, value: unknown) => { filters.push(['eq', key, value]); return query },
    is: (key: string, value: unknown) => { filters.push(['is', key, value]); return query },
    select: () => query,
    single: async () => result,
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/assignments/server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} as { updateAssignmentById: (input: UpdateInput) => Promise<unknown> } }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => ({
      from: (table: string) => { assert.equal(table, 'assignments'); return query },
    }) }
    if (name.startsWith('@/lib/')) return {} // Other workflows are not executed by this harness.
    throw Error('Unexpected dependency: ' + name)
  }, mod, mod.exports)
  return { update: mod.exports.updateAssignmentById, filters, writes }
}

const input: UpdateInput = { orgId: 'org', assignmentId: 'assignment', updatedBy: 'actor',
  requireUnissuedDraft: true, patch: { customer_name: 'New draft' } }

test('the actual update query checks draft status and issue markers atomically within the organization', async () => {
  const h = serverHarness({ data: { id: 'assignment' }, error: null })
  await h.update(input)
  assert.deepEqual(h.filters, [
    ['eq', 'org_id', 'org'], ['eq', 'id', 'assignment'], ['eq', 'status', 'draft'],
    ['is', 'last_sent_at', null], ['is', 'accepted_at', null],
    ['is', 'booked_at', null], ['is', 'archived_at', null],
  ])
  assert.deepEqual(h.writes, [{ customer_name: 'New draft', updated_by: 'actor' }])
})

test('no matching unissued draft is a conflict, while real database errors are preserved', async () => {
  for (const error of [null, { code: 'PGRST116', message: 'No matching row' }]) {
    await assert.rejects(serverHarness({ data: null, error }).update(input), /OB_ASSIGNMENT_CONTENT_LOCKED/)
  }
  await assert.rejects(serverHarness({ data: null, error: { code: '08000', message: 'Database unavailable' } }).update(input), /Database unavailable/)
})

test('existing non-OB consumers and lifecycle writes do not acquire the draft filter', async () => {
  const h = serverHarness({ data: { id: 'assignment' }, error: null })
  await h.update({ ...input, requireUnissuedDraft: undefined, patch: { status: 'booked' } })
  assert.deepEqual(h.filters, [['eq', 'org_id', 'org'], ['eq', 'id', 'assignment']])
  assert.ok((h.writes[0] as Record<string, unknown>).booked_at)
})
