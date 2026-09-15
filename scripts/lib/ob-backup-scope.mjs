import assert from 'node:assert/strict'
import { canonical } from './ob-restore-rehearsal.mjs'

// Same ownership boundary as collectScopedRows, but query a frontier of keys
// together. Shared ancestors never become roots for descendant traversal.
export async function collectScopedRowsBatched(schema, readBatch, roots, shared = []) {
  const tables = new Map(schema.tables.map(t => [t.name, t])), found = new Map(), queried = new Set()
  let total = 0
  function add(table, rows, queue) {
    const definition = tables.get(table)
    assert.ok(definition?.pk?.length, 'Unreviewed row key: ' + table)
    if (!found.has(table)) found.set(table, new Map())
    for (const row of rows) {
      assert.ok(Object.keys(row).every(k => definition.columns.includes(k)), 'Unreviewed column: ' + table)
      assert.ok(definition.pk.every(k => row[k] != null), 'Missing row key: ' + table)
      const id = canonical(definition.pk.map(k => row[k])), existing = found.get(table).get(id)
      if (existing) { assert.equal(canonical(existing), canonical(row), 'Source changed during backup'); continue }
      assert.ok(++total <= 10000, 'Scope row limit exceeded')
      found.get(table).set(id, row); queue.push({ table, row })
    }
  }
  async function fetchGroups(requests, queue) {
    const groups = new Map()
    for (const { table, filters } of requests) {
      const id = canonical({ table, filters })
      if (queried.has(id)) continue
      queried.add(id)
      if (!groups.has(table)) groups.set(table, [])
      groups.get(table).push(filters)
    }
    for (const [table, filters] of groups) {
      for (let i = 0; i < filters.length; i += 50) add(table, await readBatch(table, filters.slice(i, i + 50)), queue)
    }
  }
  const owned = []
  await fetchGroups(roots, owned)
  async function traverse(queue, direction) {
    let index = 0
    while (index < queue.length) {
      const frontier = queue.slice(index), requests = []
      index = queue.length
      for (const { table, row } of frontier) {
        for (const fk of schema.fks.filter(f => f[direction === 'down' ? 'to' : 'from'] === table)) {
          const parentColumns = direction === 'down' ? fk.toColumns : fk.fromColumns
          const childColumns = direction === 'down' ? fk.fromColumns : fk.toColumns
          if (parentColumns.some(k => row[k] == null)) continue
          requests.push({ table: direction === 'down' ? fk.from : fk.to,
            filters: Object.fromEntries(childColumns.map((k, i) => [k, row[parentColumns[i]]])) })
        }
      }
      await fetchGroups(requests, queue)
    }
  }
  await traverse(owned, 'down')
  const dependencies = [...owned]
  await fetchGroups(shared, dependencies)
  await traverse(dependencies, 'up')
  return Object.fromEntries([...found].sort(([a], [b]) => a.localeCompare(b)).map(([table, rows]) =>
    [table, [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row)]))
}
