import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function compile(file, dependencies) {
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] ?? {}, mod, mod.exports)
  return mod.exports
}

function directory(failure) {
  const reads = []
  const tables = {
    organization_contacts: [{ id: 'contact-a', name: 'Acme', company_name: 'Acme AB', email: 'acme@example.test', is_active: false }],
    org_members: [{ profile_id: 'allowed' }, { profile_id: 'no-module' }],
    profiles: [{ id: 'allowed', full_name: 'Zara', email: 'zara@example.test' }, { id: 'no-module', full_name: 'Hidden' }],
  }
  const db = { from(table) {
    assert.ok(table in tables, `Directory must not load ${table}`)
    const read = { table, filters: [] }; reads.push(read)
    const chain = {
      select() { return chain }, eq(...args) { read.filters.push(args); return chain },
      in(...args) { read.filters.push(args); return chain }, order() { return chain },
      then(resolve) { return Promise.resolve({ data: tables[table], error: failure === table ? { message: 'unavailable' } : null }).then(resolve) },
    }
    return chain
  } }
  const server = compile('../src/lib/tasks/server.ts', {
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    './domain': { DEFAULT_TASK_AUTOMATION_LIMITS: {} },
    './dateTime': { normalizeTaskTimeZone: () => 'Europe/Stockholm' },
    './internalAccess': { getInternalTaskModuleAccessProfileIds: async (input) => {
      assert.deepEqual(input, { orgId: 'org-a', profileIds: ['allowed', 'no-module'] })
      return new Set(['allowed'])
    } },
  })
  return { reads, load: () => server.getTaskPeople({ orgId: 'org-a', userId: 'user-a', isOrgAdmin: false }) }
}

test('project directory retains contact and module-access rules without reading task history', async () => {
  const { reads, load } = directory()
  const people = await load()
  assert.deepEqual(people.map(({ id, kind, name, isActive }) => ({ id, kind, name, isActive })), [
    { id: 'contact-a', kind: 'contact', name: 'Acme', isActive: false },
    { id: 'allowed', kind: 'profile', name: 'Zara', isActive: true },
  ])
  assert.equal(people[0].companyName, 'Acme AB')
  assert.deepEqual(reads.find((r) => r.table === 'organization_contacts').filters, [['org_id', 'org-a']])
  assert.deepEqual(reads.find((r) => r.table === 'org_members').filters, [['org_id', 'org-a'], ['is_active', true]])
  assert.deepEqual(reads.find((r) => r.table === 'profiles').filters, [['id', ['allowed', 'no-module']]])
})

test('directory failures are not presented as an empty successful contact list', async () => {
  for (const table of ['organization_contacts', 'org_members', 'profiles']) await assert.rejects(directory(table).load())
})

test('project links and route boundaries follow the shared feedback standard', () => {
  const list = readFileSync(new URL('../src/components/tasks/ActionCaseProjectList.tsx', import.meta.url), 'utf8')
  assert.match(list, /PendingLink autoPending/)
  assert.match(list, /Öppnar projekt/)
  assert.doesNotMatch(list, /<a className="gizmo-project-row"/)
  for (const route of ['loading.tsx', '[caseId]/loading.tsx']) {
    const source = readFileSync(new URL(`../src/app/(dashboard)/uppdrag/${route}`, import.meta.url), 'utf8')
    assert.match(source, /role="status"/)
    assert.match(source, /aria-busy="true"/)
  }
  const error = readFileSync(new URL('../src/app/(dashboard)/uppdrag/error.tsx', import.meta.url), 'utf8')
  assert.match(error, /ActionButton busy=/)
  assert.match(error, /router\.refresh\(\)/)
  assert.match(error, /reset\(\)/)
})
