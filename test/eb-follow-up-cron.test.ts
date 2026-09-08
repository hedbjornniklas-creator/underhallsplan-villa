import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('mail cron rejects missing/wrong credentials before any mail work and bounds the batch', async () => {
  const source = ts.transpileModule(read('src/app/api/cron/eb/follow-up/route.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} as { GET: (request: Request) => Promise<Response> } }
  const calls: number[] = []
  const isolatedEnv: Record<string, string | undefined> = {}
  new Function('require', 'module', 'exports', 'process', source)((name: string) => {
    if (name === '@/lib/eb/followUpDelivery') return { processEbFollowUpEmails: async (limit: number) => {
      calls.push(limit); return { claimed: 3, sent: 2, failed: 1 }
    } }
    if (['node:crypto', 'next/server'].includes(name)) return require(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports, { env: isolatedEnv })
  const request = (authorization?: string) => new Request('https://example.invalid/api/cron/eb/follow-up', {
    headers: authorization ? { authorization } : {},
  })
  assert.equal((await compiled.exports.GET(request())).status, 503)
  isolatedEnv.CRON_SECRET = 'isolated-test-secret-only'
  assert.equal((await compiled.exports.GET(request())).status, 401)
  assert.equal((await compiled.exports.GET(request('Bearer incorrect'))).status, 401)
  assert.equal((await compiled.exports.GET(request('Bearer isolated-test-secret-onlx'))).status, 401)
  assert.deepEqual(calls, [])
  const result = await compiled.exports.GET(request('Bearer isolated-test-secret-only'))
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await result.json(), { ok: true, claimed: 3, sent: 2, failed: 1, mayHaveMore: true })
  assert.deepEqual(calls, [3])
})

test('scheduler migration is repeatable, validates Vault config and exposes no secrets in status', async () => {
  const db = new PGlite()
  try {
    // Isolated stand-ins only: net.http_get records arguments instead of making
    // any network call, and there is no access to the actual Supabase Vault.
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema vault; create schema net; create schema cron;
      create table vault.secrets (name text, decrypted_secret text, updated_at timestamptz default now());
      create view vault.decrypted_secrets as select * from vault.secrets;
      create table net.test_requests (id bigint generated always as identity, url text, headers jsonb);
      create function net.http_get(url text, headers jsonb, timeout_milliseconds integer) returns bigint language sql as $$
        insert into net.test_requests(url,headers) values ($1,$2) returning id;
      $$;
      create table net._http_response (id bigint, status_code integer, timed_out boolean, created timestamptz);
      create table cron.job (jobid bigint, jobname text, active boolean);
    `)
    const migration = read('docs/db/2026-09-07_09_eb_follow_up_mail_cron.sql')
    await db.exec(migration)
    await db.exec(migration)
    await assert.rejects(db.query('select public.invoke_eb_follow_up_mail_cron()'), /CONFIGURATION_MISSING_OR_INVALID/)
    await db.exec(`insert into vault.secrets(name,decrypted_secret) values
      ('hushub_report_pdf_endpoint_url','https://example.invalid/api/cron/reports/pdf'),
      ('hushub_report_pdf_cron_secret','test-cron-secret-not-real');`)
    const dispatched = await db.query<{ result: { status: string } }>('select public.invoke_eb_follow_up_mail_cron() as result')
    assert.equal(dispatched.rows[0].result.status, 'requested')
    const recorded = await db.query<{ url: string; headers: { Authorization: string } }>('select * from net.test_requests')
    assert.equal(recorded.rows[0].url, 'https://example.invalid/api/cron/eb/follow-up')
    assert.equal(recorded.rows[0].headers.Authorization, 'Bearer test-cron-secret-not-real')
    await db.exec(`insert into cron.job values (7,'hushub-eb-follow-up-mail-v1',true);
      insert into net._http_response values(1,200,false,now());`)
    const status = await db.query<{ result: { active: boolean; lastCompletedHttpStatus: number } }>('select public.eb_follow_up_mail_cron_status() as result')
    assert.equal(status.rows[0].result.active, true)
    assert.equal(status.rows[0].result.lastCompletedHttpStatus, 200)
    assert.doesNotMatch(JSON.stringify(status.rows), /secret-not-real|Authorization|example\.invalid/)
    await db.exec(`insert into vault.secrets(name,decrypted_secret) values ('hushub_eb_follow_up_endpoint_url','http://example.invalid/api/cron/eb/follow-up');`)
    await assert.rejects(db.query('select public.invoke_eb_follow_up_mail_cron()'), /CONFIGURATION_MISSING_OR_INVALID/)
    await db.exec('set role anon')
    await assert.rejects(db.query('select public.invoke_eb_follow_up_mail_cron()'), /permission denied/)
    await assert.rejects(db.query('select * from public.eb_follow_up_cron_requests'), /permission denied/)
  } finally { await db.close() }
})
