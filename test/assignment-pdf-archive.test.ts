import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'

function load<T>(file: string, deps: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in deps) return deps[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, mod, mod.exports)
  return mod.exports as T
}
const pdf = Buffer.from('%PDF-1.4\nimmutable original\n%%EOF')
const sha = createHash('sha256').update(pdf).digest('hex')
const stored = { filename: 'Original.pdf', pdf_base64: pdf.toString('base64'), byte_length: pdf.length, pdf_sha256: sha, accepted_at: '2026-09-24T10:00:00Z' }
type Archive = {
  AssignmentPdfArchiveError: typeof Error
  getArchivedAssignmentPdf: (org: string, id: string) => Promise<{ pdf: Buffer; filename: string; sha256: string } | null>
  archiveAcceptedAssignmentPdf: (input: { orgId: string; assignmentId: string; acceptedAt: string; filename: string; pdf: Buffer }) => Promise<{ pdf: Buffer }>
}
function harness(row: typeof stored | null = stored, errorCode?: string) {
  let saved = row
  const calls: unknown[] = []
  const admin = { from(table: string) {
    calls.push(['from', table])
    const chain = {
      select(columns: string) { calls.push(['select', columns]); return chain },
      eq(key: string, value: unknown) { calls.push(['eq', key, value]); return chain },
      async maybeSingle() { return { data: table === 'assignment_acceptances' ? { id: 'acceptance-1' } : saved, error: errorCode ? { code: errorCode } : null } },
      async upsert(input: { filename: string; pdf_base64: string; accepted_at: string }, options: unknown) {
        calls.push(['insert', input, options])
        const buffer = Buffer.from(input.pdf_base64, 'base64')
        saved ??= { ...input, byte_length: buffer.length, pdf_sha256: createHash('sha256').update(buffer).digest('hex') }
        return { error: null }
      },
    }
    return chain
  } }
  const archive = load<Archive>('src/lib/assignments/acceptedPdfArchive.ts', {
    'server-only': {}, 'node:crypto': { createHash }, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
  })
  return { archive, calls }
}
test('read returns byte-identical original using only organization-scoped archive queries', async () => {
  const { archive, calls } = harness()
  const result = await archive.getArchivedAssignmentPdf('org-1', 'assignment-1')
  assert.deepEqual(result?.pdf, pdf)
  assert.equal(result?.sha256, sha)
  assert.deepEqual(calls, [['from', 'assignment_confirmation_pdfs'], ['select', 'filename,pdf_base64,pdf_sha256,byte_length,accepted_at'], ['eq', 'org_id', 'org-1'], ['eq', 'assignment_id', 'assignment-1']])
})
test('missing original is never generated from current data or a template', async () => {
  const { archive, calls } = harness(null)
  assert.equal(await archive.getArchivedAssignmentPdf('org-1', 'assignment-1'), null)
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === 'insert'), false)
})
for (const patch of [{ pdf_sha256: '0'.repeat(64) }, { byte_length: 999 }, { byte_length: 11 * 1024 * 1024 },
  { filename: 'bad\r\nInjected.pdf' }, { pdf_base64: Buffer.from('NOT A PDF').toString('base64') }, { accepted_at: 'invalid' }]) {
  test(`corrupt archive is blocked, not repaired: ${JSON.stringify(patch)}`, async () => {
    const { archive } = harness({ ...stored, ...patch })
    await assert.rejects(() => archive.getArchivedAssignmentPdf('org-1', 'assignment-1'), archive.AssignmentPdfArchiveError)
  })
}
for (const code of ['42P01', 'PGRST205']) {
  test(`missing database setup ${code} has an actionable error`, async () => {
    const { archive } = harness(null, code)
    await assert.rejects(() => archive.getArchivedAssignmentPdf('org-1', 'assignment-1'), /inte aktiverat/)
  })
}
const input = { orgId: 'org-1', assignmentId: 'assignment-1', acceptedAt: stored.accepted_at, filename: 'New.pdf', pdf: Buffer.from('%PDF-new-content') }
test('repeat archival reuses the first original, never overwrites it', async () => {
  const { archive, calls } = harness()
  assert.deepEqual((await archive.archiveAcceptedAssignmentPdf(input)).pdf, pdf)
  assert.equal(calls.some(c => Array.isArray(c) && c[0] === 'insert'), false)
})
test('new attachment is archived once and returned from the verified archive', async () => {
  const { archive, calls } = harness(null)
  assert.deepEqual((await archive.archiveAcceptedAssignmentPdf(input)).pdf, input.pdf)
  const inserts = calls.filter(c => Array.isArray(c) && c[0] === 'insert') as unknown[][]
  assert.equal(inserts.length, 1)
  assert.deepEqual(inserts[0][2], { onConflict: 'assignment_id', ignoreDuplicates: true })
  assert.ok(calls.some(c => Array.isArray(c) && c[0] === 'eq' && c[1] === 'accepted_at' && c[2] === stored.accepted_at))
})
test('an original cannot be reused for a different acceptance', async () => {
  const { archive } = harness()
  await assert.rejects(() => archive.archiveAcceptedAssignmentPdf({ ...input, acceptedAt: '2026-09-25T10:00:00Z' }))
})

test('PDF endpoint never imports a renderer, and returns the archived bytes', async () => {
  const { archive } = harness()
  let authError: string | null = null
  let type = 'OB'
  let found = true
  let reads = 0
  const route = load<{ GET: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response> }>('src/app/api/ob/assignments/[id]/pdf/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/assignments/acceptedPdfArchive': { ...archive, getArchivedAssignmentPdf: async (org: string, id: string) => {
      reads++; assert.equal(org, 'org-1'); assert.equal(id, 'assignment-1'); return found ? archive.getArchivedAssignmentPdf(org, id) : null
    } },
    '@/lib/assignments/server': {
      requireOrgContext: async () => { if (authError) throw new Error(authError); return { orgId: 'org-1' } },
      getAssignmentById: async (org: string, id: string) => { assert.equal(org, 'org-1'); assert.equal(id, 'assignment-1'); return { assignment_type: type } },
    },
  })
  const get = () => route.GET(new Request('https://example.test/pdf'), { params: Promise.resolve({ id: 'assignment-1' }) })
  const success = await get()
  assert.deepEqual(Buffer.from(await success.arrayBuffer()), pdf)
  assert.equal(success.headers.get('content-disposition'), 'attachment; filename="Original.pdf"')
  assert.equal(success.headers.get('cache-control'), 'private, no-store')
  assert.equal(success.headers.get('content-type'), 'application/pdf')
  found = false
  const missing = await get()
  assert.equal(missing.status, 404)
  assert.match(await missing.text(), /Historiska dokument återskapas inte/)
  const oldReads = reads
  for (const other of ['TU', 'EB', 'STATUS', 'UHP']) { type = other; assert.equal((await get()).status, 404) }
  for (const [error, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
    authError = error
    const response = await get()
    assert.equal(response.status, status)
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
  }
  assert.equal(reads, oldReads, 'unauthorized/module-mismatched calls must not read originals')
})

test('database migration enforces append-only originals and never backfills old documents', async () => {
  const db = new PGlite()
  const org = '11111111-1111-4111-8111-111111111111'
  const assignment = '22222222-2222-4222-8222-222222222222'
  const acceptance = '33333333-3333-4333-8333-333333333333'
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table organizations(id uuid primary key);
      create table assignments(id uuid primary key, org_id uuid, assignment_type text, accepted_at timestamptz, terms_version text, terms_document_hash text);
      create table assignment_acceptances(id uuid primary key, assignment_id uuid, org_id uuid, accepted_at timestamptz, payload jsonb, terms_version text, terms_document_hash text);
      create table assignment_addon_orders(id uuid, assignment_id uuid, org_id uuid, addon_name_snapshot text, price_amount_snapshot numeric, currency_snapshot text);
      grant usage on schema public to service_role;
      grant select on assignments,assignment_acceptances to service_role;
      insert into organizations values ('${org}');
      insert into assignments(id,org_id,assignment_type) values ('${assignment}','${org}','OB');
      insert into assignment_acceptances(id,assignment_id,org_id,accepted_at) values ('${acceptance}','${assignment}','${org}','${stored.accepted_at}');`)
    const sql = readFileSync(new URL('../docs/db/2026-09-24_01_ob_assignment_pdf_archive.sql', import.meta.url), 'utf8')
    await db.exec(sql)
    await db.exec(sql)
    assert.deepEqual((await db.query('select * from assignment_confirmation_pdfs')).rows, [])
    assert.deepEqual((await db.query('select * from assignment_confirmation_snapshots')).rows, [])
    await db.exec('set role service_role')
    const insert = `insert into assignment_confirmation_pdfs(assignment_id,org_id,acceptance_id,accepted_at,filename,pdf_base64) values ($1,$2,$3,$4,$5,$6)`
    const args = [assignment, org, acceptance, stored.accepted_at, stored.filename, stored.pdf_base64]
    await assert.rejects(() => db.query(insert, [assignment, '44444444-4444-4444-8444-444444444444', ...args.slice(2)]), /mismatch/)
    await db.query(insert, args)
    await db.query(insert + ' on conflict (assignment_id) do nothing', [...args.slice(0, 5), Buffer.from('%PDF-different').toString('base64')])
    assert.equal((await db.query<{ pdf_sha256: string }>('select pdf_sha256 from assignment_confirmation_pdfs')).rows[0].pdf_sha256, sha)
    await assert.rejects(() => db.exec("update assignment_confirmation_pdfs set filename='Changed.pdf'"), /permission denied/)
    await db.exec('reset role')
    await assert.rejects(() => db.exec("update assignment_confirmation_pdfs set filename='Changed.pdf'"), /immutable/)
    await assert.rejects(() => db.exec('delete from assignment_confirmation_pdfs'), /immutable/)
    await assert.rejects(() => db.exec('truncate assignment_confirmation_pdfs'), /immutable/)
    await assert.rejects(() => db.exec('delete from assignment_acceptances'), /foreign key/)
    const newAssignment = '55555555-5555-4555-8555-555555555555'
    const newAcceptance = '66666666-6666-4666-8666-666666666666'
    const text = 'Exactly approved text.\nSecond line.'
    const textHash = createHash('sha256').update(text).digest('hex')
    const source = { schemaVersion: 'ob-confirmation-v1', terms: { role: 'buyer', version: 'v1', text, documentHash: textHash },
      inspector: { fullName: 'Original inspector' }, issuerName: 'Original company' }
    await db.query('insert into assignments values ($1,$2,$3,$4,$5,$6)', [newAssignment, org, 'OB', stored.accepted_at, 'v1', textHash])
    await db.query('insert into assignment_addon_orders values ($1,$2,$3,$4,$5,$6)', [newAcceptance, newAssignment, org, 'Original addon', 500, 'SEK'])
    const acceptSql = 'insert into assignment_acceptances values ($1,$2,$3,$4,$5,$6,$7)'
    const acceptArgs = [newAcceptance, newAssignment, org, stored.accepted_at, { customer_name: 'Original customer', ob_document_source: source }, 'v1', textHash]
    await assert.rejects(() => db.query(acceptSql, [...acceptArgs.slice(0, 4), { ob_document_source: { ...source, terms: { ...source.terms, text: 'Changed text' } } }, ...acceptArgs.slice(5)]), /Invalid OB/)
    assert.equal((await db.query('select id from assignment_acceptances where id=$1', [newAcceptance])).rows.length, 0, 'invalid snapshot rolls back acceptance')
    await db.exec('grant insert on assignment_acceptances to authenticated, service_role; set role authenticated')
    await assert.rejects(() => db.query(acceptSql, acceptArgs), /require the server/)
    await db.exec('reset role; set role service_role')
    await db.query(acceptSql, acceptArgs)
    await db.exec('reset role')
    const snapshot = (await db.query<{ snapshot_payload: Record<string, unknown> }>('select snapshot_payload from assignment_confirmation_snapshots')).rows[0].snapshot_payload
    assert.deepEqual(snapshot.terms, source.terms)
    assert.deepEqual(snapshot.acceptancePayload, { customer_name: 'Original customer' })
    assert.deepEqual(snapshot.addonOrders, [{ name: 'Original addon', priceAmount: 500, currency: 'SEK' }])
    await db.exec("update assignments set terms_version='new'; update assignment_addon_orders set addon_name_snapshot='Changed addon'")
    assert.deepEqual((await db.query<{ snapshot_payload: unknown }>('select snapshot_payload from assignment_confirmation_snapshots')).rows[0].snapshot_payload, snapshot)
    for (const statement of ["update assignment_confirmation_snapshots set schema_version='new'", 'delete from assignment_confirmation_snapshots', 'truncate assignment_confirmation_snapshots']) {
      await assert.rejects(() => db.exec(statement), /immutable/)
    }
    await db.exec('set role service_role')
    await assert.rejects(() => db.exec('delete from assignment_confirmation_snapshots'), /permission denied/)
    await db.exec('reset role')
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(() => db.exec('select * from assignment_confirmation_pdfs'), /permission denied/)
      await assert.rejects(() => db.exec('select * from assignment_confirmation_snapshots'), /permission denied/)
      await db.exec('reset role')
    }
  } finally { await db.close() }
})
