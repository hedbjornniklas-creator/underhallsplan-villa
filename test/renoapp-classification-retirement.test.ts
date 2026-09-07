import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const migration = read('docs/db/2026-09-07_05_renoapp_retire_technical_classification.sql')
const confirmedMigration = migration.replace('code_is_deployed boolean := false', 'code_is_deployed boolean := true')
  .replace('backup_is_verified boolean := false', 'backup_is_verified boolean := true')
const db = new PGlite()

function functions<T>(file: string, names: string[], dependencies: Record<string, unknown> = {}): T {
  const ast = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true)
  const nodes = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
  assert.equal(nodes.length, names.length)
  const code = ts.transpileModule(nodes.map(node => node.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function('exports', ...Object.keys(dependencies), `${code}; return ${names[0]}`)(
    {}, ...Object.values(dependencies)
  ) as T
}

before(async () => {
  await db.exec(`
    create table renovation_action_types (
      id uuid primary key default gen_random_uuid(), category_id uuid, key text not null unique,
      label text not null, description text, risk_level text not null default 'medium',
      contractor_requirement text not null default 'none', sort_order integer not null default 100,
      is_active boolean not null default true,
      implies_structure boolean not null default false, implies_plumbing boolean not null default false,
      implies_ventilation boolean not null default false, implies_electrical boolean not null default false,
      implies_wet_room boolean not null default false, implies_surface_only boolean not null default false
    );
    create table renovation_cases (id uuid primary key default gen_random_uuid(), title text, risk_level text);
    create table renovation_case_checks (
      id uuid primary key default gen_random_uuid(), case_id uuid unique references renovation_cases(id),
      affects_structure boolean, affects_plumbing boolean, affects_ventilation boolean,
      affects_electrical boolean, affects_wet_room boolean, affects_surface_only boolean,
      created_at timestamptz, updated_at timestamptz
    );
    create function renoapp_set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at := now(); return new; end; $$;
    create trigger checks_timestamp before update on renovation_case_checks
      for each row execute function renoapp_set_updated_at();
    insert into renovation_cases(title, risk_level) values ('Existing application', 'high');
    insert into renovation_case_checks(case_id, affects_electrical) select id, true from renovation_cases;
  `)
})
after(async () => { await db.close() })

test('board summary uses unique selected titles, ignores old flags and retains the legacy title fallback', () => {
  const summary = functions<(item: object) => string[]>(
    'src/app/renoapp/app/cases/[id]/RenoAppCaseDecisionView.tsx', ['buildCaseSummaryChips'], {
      displayText: (value: string) => value,
      getCaseSubtitle: (item: { actionType: { label: string } }) => item.actionType.label,
    }
  )
  const legacy = { actionType: { label: 'Riva vagg' }, checks: { affectsElectrical: true, affectsStructure: true } }
  assert.deepEqual(summary(legacy), ['Riva vagg'])
  assert.deepEqual(summary({ ...legacy, actionTypes: [
    { label: 'Kok' }, { label: 'Elinstallationer' }, { label: 'Kok' },
  ] }), ['Kok', 'Elinstallationer'])
})

test('active application code has no retired schema references or legacy creation path', () => {
  function scan(directory: URL) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory)
      if (entry.isDirectory()) scan(path)
      else if (/\.tsx?$/.test(entry.name)) assert.doesNotMatch(readFileSync(path, 'utf8'),
        /renovation_case_checks|implies_(structure|plumbing|ventilation|electrical|wet_room|surface_only)|implies(Structure|Plumbing|Ventilation|Electrical|WetRoom|SurfaceOnly)|createPublicApplication\(/,
        path.pathname)
    }
  }
  scan(new URL('../src/', import.meta.url))
})

test('existing case details load without the checks table and still enforce the BRF scope', async () => {
  const tables: Record<string, object[]> = {
    renovation_cases: [{ id: 'case', brf_id: 'brf', action_type_id: 'action',
      title: 'Existing application', risk_level: 'high', status: 'review' }],
    brf_associations: [{ id: 'brf', name: 'Test BRF', slug: 'test' }],
    renovation_action_types: [{ id: 'action', key: 'electrical', label: 'Electrical' }],
    renovation_case_documents: [], renovation_case_decisions: [], case_access_links: [],
    renoapp_action_type_participant_roles: [], renoapp_case_requirement_decisions: [],
  }
  const admin = { from: (table: string) => {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`)
    const query = { select: () => query, eq: () => query, order: () => query,
      maybeSingle: async () => ({ data: tables[table][0] ?? null, error: null }),
      then: (done: (value: unknown) => unknown) => done({ data: tables[table], error: null }),
    }
    return query
  } }
  const empty = async () => []
  const load = functions<(id: string, brfs: string[]) => Promise<{
    id: string; riskLevel: string; actionTypes: object[]; documents: object[]; checks?: unknown
  }>>('src/lib/renoapp/server.ts', ['loadRenoAppCaseDetail'], {
    createSupabaseAdminClient: () => admin,
    listCaseActionTypes: empty, listCaseQuestionAnswers: empty, listActiveApplyQuestions: empty,
    listCaseParticipants: empty, listActiveParticipantRoles: empty, listActiveReviewFlags: empty,
    listActiveReviewFlagLinks: empty, listCaseMessages: empty, listRequirements: empty,
    listActiveDocumentTypes: empty, buildCaseReviewFlags: () => [], buildCaseUnderlagItems: () => [],
    getLatestCompletion: async () => null, getCaseRulesAcceptance: async () => null,
    loadActiveActionTypesByIds: async (_admin: object, ids: string[]) => {
      assert.deepEqual(ids, ['action'])
      return [{ id: 'action', key: 'electrical', label: 'Electrical', sort_order: 100 }]
    },
  })
  const item = await load('case', ['brf'])
  assert.equal(item.id, 'case')
  assert.equal(item.riskLevel, 'high')
  assert.deepEqual(item.actionTypes, [{ id: 'action', key: 'electrical', label: 'Electrical' }])
  assert.deepEqual(item.documents, [])
  assert.equal(Object.hasOwn(item, 'checks'), false)
  await assert.rejects(load('case', ['other-brf']), /CASE_NOT_FOUND/)
})

test('repository cleanup is blocked by default without removing data', async () => {
  assert.match(migration, /code_is_deployed boolean := false/)
  assert.match(migration, /backup_is_verified boolean := false/)
  await assert.rejects(db.exec(migration), /Deploy the classification-free code/)
  await db.exec('rollback')
  assert.equal((await db.query('select * from renovation_case_checks')).rows.length, 1)
})

test('unconfirmed cleanup refuses to remove data', async () => {
  for (const confirmation of ['code_is_deployed', 'backup_is_verified']) {
    const unconfirmedMigration = confirmedMigration.replace(
      `${confirmation} boolean := true`, `${confirmation} boolean := false`
    )
    await assert.rejects(db.exec(unconfirmedMigration), /Deploy the classification-free code/)
    await db.exec('rollback')
    assert.equal((await db.query('select * from renovation_case_checks')).rows.length, 1)
  }
})

test('cleanup refuses unknown columns and dependent views without partially deleting columns', async () => {
  await db.exec('alter table renovation_case_checks add column unexpected_data text')
  await assert.rejects(db.exec(confirmedMigration), /unexpected columns/)
  await db.exec('rollback; alter table renovation_case_checks drop column unexpected_data')
  await db.exec('create view existing_integration as select implies_electrical from renovation_action_types')
  await assert.rejects(db.exec(confirmedMigration), /depend/)
  await db.exec('rollback')
  await db.query('select implies_structure from renovation_action_types')
  await db.exec('drop view existing_integration')
})

// Run the real admin save/read functions against PostgreSQL, both with and without
// the retired columns. Unexpected tables and columns fail instead of using mocks.
test('admin create/update and action reads work before and after cleanup, preserving risk and contractor settings', async () => {
  const identifier = (value: string) => {
    assert.match(value, /^[a-z_]+$/)
    return value
  }
  const admin = { from: (table: string) => {
    assert.equal(table, 'renovation_action_types')
    let operation = 'select', columns = '*', payload: Record<string, unknown> = {}
    const filters: Array<{ column: string; values: unknown[] }> = []
    async function execute() {
      const values: unknown[] = []
      const parameter = (value: unknown) => { values.push(value); return `$${values.length}` }
      let sql = ''
      if (operation === 'insert') {
        sql = `insert into ${table} (${Object.keys(payload).map(identifier).join(',')}) values (${Object.values(payload).map(parameter).join(',')})`
      } else if (operation === 'update') {
        sql = `update ${table} set ${Object.entries(payload).map(([key, value]) => `${identifier(key)} = ${parameter(value)}`).join(',')}`
      } else sql = `select ${columns} from ${table}`
      if (filters.length) sql += ` where ${filters.map(filter => `${identifier(filter.column)} in (${filter.values.map(parameter).join(',')})`).join(' and ')}`
      if (operation !== 'select') sql += ` returning ${columns}`
      return { data: (await db.query(sql, values)).rows, error: null }
    }
    const query = {
      select: (value: string) => { columns = value.split(',').map(identifier).join(','); return query },
      insert: (value: Record<string, unknown>) => { operation = 'insert'; payload = value; return query },
      update: (value: Record<string, unknown>) => { operation = 'update'; payload = value; return query },
      eq: (column: string, value: unknown) => { filters.push({ column, values: [value] }); return query },
      in: (column: string, values: unknown[]) => { filters.push({ column, values }); return query },
      order: () => query,
      single: async () => { const result = await execute(); return { ...result, data: result.data[0] } },
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => execute().then(resolve, reject),
    }
    return query
  } }
  const dependencies = { createSupabaseAdminClient: () => admin, requireRenoAppAdminProfile: async () => ({ id: 'admin' }) }
  const save = functions<(input: object) => Promise<{ id: string; riskLevel: string; contractorRequirement: string }>>(
    'src/lib/renoapp/server.ts', ['saveRenoAppAdminActionType', 'normalizeText', 'assertRequiredText'], dependencies)
  const load = functions<(admin: object, keys: string[]) => Promise<Array<{ risk_level: string }>>>(
    'src/lib/renoapp/server.ts', ['loadActiveActionTypesByKeys', 'normalizeText'])
  const risk = functions<(types: object[]) => string>('src/lib/renoapp/server.ts', ['computeRiskLevelFromActionTypes'])
  for (const stage of ['before', 'after']) {
    if (stage === 'after') {
      await db.exec(confirmedMigration)
      await db.exec(confirmedMigration)
    }
    const saved = await save({ key: `electrical_${stage}`, label: 'Electrical', riskLevel: 'medium',
      contractorRequirement: 'authorized_electrician', impliesElectrical: true })
    assert.equal(saved.riskLevel, 'medium')
    assert.equal(saved.contractorRequirement, 'authorized_electrician')
    assert.equal(Object.hasOwn(saved, 'impliesElectrical'), false)
    const updated = await save({ id: saved.id, label: 'Electrical updated', riskLevel: 'high' })
    assert.equal(updated.riskLevel, 'high')
    assert.equal(updated.contractorRequirement, 'authorized_electrician')
    const types = await load(admin, [`electrical_${stage}`])
    assert.equal(types.length, 1)
    assert.equal(risk([...types, { risk_level: 'low' }]), 'high')
  }
  assert.deepEqual((await db.query('select title, risk_level from renovation_cases')).rows,
    [{ title: 'Existing application', risk_level: 'high' }])
  assert.equal((await db.query('select * from renovation_action_types')).rows.length, 2)
  const { rows } = await db.query<{ retired: string | null; shared_function: string }>(
    "select to_regclass('public.renovation_case_checks') as retired, to_regprocedure('public.renoapp_set_updated_at()') as shared_function")
  assert.equal(rows[0].retired, null)
  assert.ok(rows[0].shared_function)
})
