import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires the explicit extension.
import { resolveObObjectType } from '../src/lib/ob/objectType.ts'

const source = readFileSync(new URL('../src/components/ob/ObStepGrunddata.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ObStepGrunddata.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let handlerSource = ''
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'handleStatusObjectTypeChange') {
    handlerSource = node.initializer!.getText(ast)
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert.ok(handlerSource)
const compiled = ts.transpileModule(`(${handlerSource})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

function fixture(options: {
  profile?: string; locked?: boolean; current?: string; readError?: boolean; saveResult?: boolean;
  assignments?: Array<{ status: string; accepted_at: string | null; last_sent_at?: string | null }>
} = {}) {
  const writes: unknown[] = [], values: unknown[] = [], acknowledged: unknown[] = [], errors: Array<string | null> = [], pending: boolean[] = []
  let reads = 0
  const props = {
    isInspectionLocked: options.locked ?? false, changingObjectType: false, changingInspectionSide: false,
    inspForm: { inspection_side: options.profile ?? 'status' },
    propForm: { object_type: options.current ?? '' }, inspection: { id: 'this-inspection' }, resolveObObjectType,
    setChangingObjectType: (value: boolean) => pending.push(value), setError: (value: string | null) => errors.push(value),
    supabase: { from(table: string) {
      assert.equal(table, 'assignments')
      return { select() { return { async eq(column: string, id: string) {
        reads++; assert.equal(column, 'inspection_id'); assert.equal(id, 'this-inspection')
        return { data: options.assignments ?? [], error: options.readError ? new Error('offline') : null }
      } } } }
    } },
    saveProperty: async (patch: unknown) => { writes.push(patch); return options.saveResult ?? true },
    setPropForm: (update: (previous: object) => object) => values.push(update({ apartment_number: '1201' })),
    acknowledgeProperty: (value: unknown) => acknowledged.push(value),
  }
  const run = new Function(...Object.keys(props), `return ${compiled}`)(...Object.values(props)) as (value: string) => Promise<void>
  return { run, writes, values, acknowledged, errors, pending, reads: () => reads }
}

test('Grunddata persists independent status object identity and preserves apartment details', async () => {
  const f = fixture()
  await f.run('apartment')
  assert.deepEqual(f.writes, [{ object_type: 'apartment' }])
  assert.deepEqual(f.values, [{ object_type: 'apartment', apartment_number: '1201' }])
  assert.deepEqual(f.acknowledged, [{ object_type: 'apartment' }])
  assert.deepEqual(f.pending, [true, false])
})

test('status object changes cannot reinterpret a sent or accepted confirmation', async () => {
  for (const assignment of [
    { status: 'sent', accepted_at: null }, { status: 'ordered', accepted_at: null },
    { status: 'booked', accepted_at: null }, { status: 'completed', accepted_at: null },
    { status: 'draft', accepted_at: '2026-10-02T08:00:00Z' },
    { status: 'expired', accepted_at: null, last_sent_at: '2026-10-02T08:00:00Z' },
  ]) {
    const f = fixture({ assignments: [assignment] })
    await f.run('apartment')
    assert.deepEqual(f.writes, [])
    assert.match(f.errors.at(-1)!, /ny uppdragsbekräftelse/)
  }
})

test('failed reads and writes never switch the displayed status object', async () => {
  const offline = fixture({ readError: true })
  await offline.run('apartment')
  assert.deepEqual(offline.writes, [])
  assert.match(offline.errors.at(-1)!, /inte ändrats/)
  const failed = fixture({ saveResult: false })
  await failed.run('apartment')
  assert.deepEqual(failed.values, [])
  assert.deepEqual(failed.acknowledged, [])
})

test('existing OB profiles, locked reports and unchanged selections do not write', async () => {
  for (const options of [{ profile: 'buyer' }, { profile: 'seller' }, { profile: 'apartment' }, { locked: true }, { current: 'apartment' }]) {
    const f = fixture(options)
    await f.run('apartment')
    assert.deepEqual(f.writes, [])
    assert.equal(f.reads(), 0)
  }
})

test('the inspection-local object marker survives the page and wizard without changing classification', () => {
  const wizard = readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8')
  const page = readFileSync(new URL('../src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx', import.meta.url), 'utf8')
  assert.match(wizard, /object_type: property.object_type \?\? null/)
  assert.match(page, /object_type: parseObObjectType\(snapshot\?\.object_type\)/)
  assert.match(source, /resolveObObjectType\(inspForm.inspection_side as EditableInspectionSide, propForm.object_type\)/)
  assert.match(source, /Lägenhetsinnehavare \(frivilligt\)/)
})
