import test from 'node:test'
import assert from 'node:assert/strict'
import { collectScopedRows } from '../scripts/lib/ob-restore-rehearsal.mjs'
import { collectScopedRowsBatched } from '../scripts/lib/ob-backup-scope.mjs'

test('batched backup matches original closure without reading siblings of shared ancestors', async () => {
  const data = { owner: [{ id: 1 }], inspection: [{ id: 1, owner: 1 }, { id: 2, owner: 1 }, { id: 3, owner: 1 }],
    note: [{ id: 1, inspection: 1 }, { id: 2, inspection: 2 }, { id: 3, inspection: 3 }],
    photo: [{ id: 1, note: 1 }, { id: 2, note: 2 }, { id: 3, note: 3 }] }
  const schema = { tables: Object.entries(data).map(([name, rows]) => ({ name, pk: ['id'], columns: Object.keys(rows[0]) })),
    fks: [{ from: 'inspection', to: 'owner', fromColumns: ['owner'], toColumns: ['id'] },
      { from: 'note', to: 'inspection', fromColumns: ['inspection'], toColumns: ['id'] },
      { from: 'photo', to: 'note', fromColumns: ['note'], toColumns: ['id'] }] }
  const roots = [{ table: 'inspection', filters: { id: 1 } }, { table: 'inspection', filters: { id: 2 } }]
  const read = async (table, filters) => data[table].filter(row => Object.entries(filters).every(([k, v]) => row[k] === v))
  const batch = async (table, filters) => data[table].filter(row => filters.some(f => Object.entries(f).every(([k, v]) => row[k] === v)))
  const result = await collectScopedRowsBatched(schema, batch, roots)
  assert.deepEqual(result, await collectScopedRows(schema, read, roots))
  assert.equal(result.inspection.length, 2)
  assert.equal(result.photo.length, 2)
  assert.deepEqual(result.owner, [{ id: 1 }])
})

test('batched backup follows composite keys, terminates cycles and bounds requests', async () => {
  const rows = Array.from({ length: 105 }, (_, id) => ({ id, org: 1, parent: id === 0 ? 1 : 0 }))
  const schema = { tables: [{ name: 'item', pk: ['id', 'org'], columns: ['id', 'org', 'parent'] }],
    fks: [{ from: 'item', to: 'item', fromColumns: ['parent', 'org'], toColumns: ['id', 'org'] }] }
  let requests = 0
  const result = await collectScopedRowsBatched(schema, async (table, filters) => {
    assert.ok(filters.length <= 50); requests++
    return rows.filter(row => filters.some(f => Object.entries(f).every(([k, v]) => row[k] === v)))
  }, [{ table: 'item', filters: { id: 0, org: 1 } }])
  assert.equal(result.item.length, 105)
  assert.ok(requests < 12)
})
