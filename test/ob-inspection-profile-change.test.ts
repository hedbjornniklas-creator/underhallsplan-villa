import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'

const modulePath = '../src/lib/ob/inspectionProfileChange.ts'
const { getObProfileChangeConfirmation } = await import(modulePath) as typeof import('../src/lib/ob/inspectionProfileChange')

type Row = Record<string, string | null>
function clientFor(rows: Record<string, Row[]> = {}, options: { errorTable?: string; pageLimit?: number } = {}) {
  const calls: Array<{ table: string; columns: string; inspectionId: unknown; offset: number }> = []
  const client = {
    from(table: string) {
      let columns = ''
      let inspectionId: unknown
      return {
        select(value: string) { columns = value; return this },
        eq(column: string, value: unknown) {
          assert.equal(column, 'inspection_id', 'check the whole inspection, including all buildings')
          inspectionId = value
          return this
        },
        order(column: string, order: { ascending: boolean }) {
          assert.equal(column, 'id')
          assert.equal(order.ascending, true)
          return this
        },
        async range(start: number, end: number) {
          calls.push({ table, columns, inspectionId, offset: start })
          if (options.errorTable === table) return { data: null, error: new Error('Read failed') }
          const filtered = (rows[table] ?? []).filter(row => row.inspection_id === inspectionId)
          const size = Math.min(end - start + 1, options.pageLimit ?? Infinity)
          return { data: filtered.slice(start, start + size).map(row =>
            Object.fromEntries(columns.split(',').map(field => [field, row[field] ?? null]))), error: null }
        },
      }
    },
  } as unknown as SupabaseClient
  return { client, calls }
}

test('a new inspection changes to and from status without a confirmation', async () => {
  for (const next of ['status', 'buyer', 'seller', 'apartment'] as const) {
    const { client } = clientFor()
    assert.equal(await getObProfileChangeConfirmation(client, 'inspection', next), null)
  }
})

test('ordinary notes, selected outcomes and blank profile texts do not require a confirmation', async () => {
  const { client } = clientFor({
    inspection_control_items: [{ inspection_id: 'inspection', note: 'Spräckt kakelplatta.', selected_outcome_id: 'outcome',
      risk_text: ' \n ', ftu_text: null, recommendation_text: '\t', comment_text: '' }],
    inspection_exterior_observations: [{ inspection_id: 'inspection', note: 'Notering på utsidan.', risk_text: '', ftu_text: '' }],
  })
  assert.equal(await getObProfileChangeConfirmation(client, 'inspection', 'status'), null)
  assert.equal(await getObProfileChangeConfirmation(client, 'inspection', 'buyer'), null)
})

test('the warning depends on the destination profile, including legacy exterior text', async () => {
  for (const table of ['inspection_control_items', 'inspection_exterior_observations']) {
    for (const field of ['risk_text', 'ftu_text', 'recommendation_text', 'comment_text']) {
      const rows = { [table]: [{ inspection_id: 'inspection', [field]: 'Befintlig text' }] }
      const original = structuredClone(rows)
      const { client, calls } = clientFor(rows)
      const isObText = ['risk_text', 'ftu_text'].includes(field)
      const statusMessage = await getObProfileChangeConfirmation(client, 'inspection', 'status')
      const obMessage = await getObProfileChangeConfirmation(client, 'inspection', 'buyer')
      if (isObText) {
        assert.match(statusMessage!, /Byta till statusbesiktning\?.*sparas, men visas inte/)
        assert.equal(obMessage, null)
      } else {
        assert.equal(statusMessage, null)
        assert.match(obMessage!, /Byta till överlåtelsebesiktning\?.*sparas, men visas inte/)
      }
      assert.deepEqual(rows, original, 'checking never converts or removes saved text')
      assert.ok(calls.every(call => call.inspectionId === 'inspection'))
    }
  }
})

test('text in another building and beyond a server row limit still triggers confirmation', async () => {
  const { client, calls } = clientFor({ inspection_control_items: [
    { inspection_id: 'inspection', building_part_id: 'main', risk_text: '' },
    { inspection_id: 'inspection', building_part_id: 'main', risk_text: ' ' },
    { inspection_id: 'inspection', building_part_id: 'garage', risk_text: 'Sparad risk' },
  ] }, { pageLimit: 1 })
  assert.match((await getObProfileChangeConfirmation(client, 'inspection', 'status'))!, /Byta till statusbesiktning/)
  assert.deepEqual(calls.filter(call => call.table === 'inspection_control_items').map(call => call.offset), [0, 1, 2])
})

test('text belonging to another inspection does not trigger confirmation', async () => {
  const { client } = clientFor({ inspection_control_items: [{ inspection_id: 'another', risk_text: 'Annan besiktning' }] })
  assert.equal(await getObProfileChangeConfirmation(client, 'inspection', 'status'), null)
})

test('failed reads are not treated as an empty inspection', async () => {
  for (const errorTable of ['inspection_control_items', 'inspection_exterior_observations']) {
    const { client } = clientFor({}, { errorTable })
    await assert.rejects(getObProfileChangeConfirmation(client, 'inspection', 'status'), /Read failed/)
  }
})
