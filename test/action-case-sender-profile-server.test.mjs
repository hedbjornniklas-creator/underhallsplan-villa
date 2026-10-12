import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import sharp from 'sharp'
import { normalizeContractSenderProfile } from '../src/lib/action-cases/contractSenderProfile.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3), profileId = id(4)
const selection = () => ({ requestId: id(5), revision: 1, profileId, profileVersion: 1, legalNameVersion: 1,
  organizationNumber: '559281-0823', confirmed: true })
function load(file, dependencies) {
  const compiled = { exports: {} }, code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in dependencies, name)
    return dependencies[name]
  }, compiled, compiled.exports)
  return compiled.exports
}
const http = load('src/lib/organizations/administrationHttp.ts', {})
function harness(options = {}) {
  const calls = [], reads = [], downloads = [], auth = [], workspaceReads = []
  let selected = Boolean(options.replay)
  const db = {
    from(table) {
      const row = { table, filters: [] }; reads.push(row)
      const result = () => {
        if (table === 'action_cases') return { data: options.caseMissing ? null : { id: caseId }, error: null }
        if (table === 'organization_sender_profiles') return { data: options.profileMissing ? null : { id: profileId, version: 1,
          logo_path: options.logoPath ?? `organizations/${ctx.orgId}/logo-${id(6)}.png` }, error: null }
        if (table === 'action_case_contract_senders') return { data: null, error: options.bindingMissing ? { code: '42P01' } : null }
        throw Error(`Unexpected table ${table}`)
      }
      const query = { select() { return query }, eq(...filter) { row.filters.push(filter); return query }, maybeSingle: async () => result() }
      return query
    },
    async rpc(name, args) {
      calls.push({ name, args })
      if (options.rpcError) return { data: null, error: options.rpcError }
      if (selected) return { data: { saved: true }, error: null }
      if (options.logo && args.p_logo_data_url === null) return { data: null, error: { message: 'CUSTOMER_SENDER_MEDIA' } }
      selected = true
      return { data: { saved: true }, error: null }
    },
    storage: { from(bucket) { return { async download(path) {
      downloads.push({ bucket, path })
      return { data: options.image ? new Blob([options.image]) : null, error: options.image ? null : { message: 'missing' } }
    } } } },
  }
  const server = load('src/lib/action-cases/contractSenderProfileServer.ts', {
    'server-only': {}, sharp: { default: sharp },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/organizations/senderProfiles': { async getOrganizationSenderWorkspace(orgId) {
      assert.equal(orgId, ctx.orgId)
      return { organization: { id: ctx.orgId, name: 'Existing', legalName: 'Legal AB', legalNameVersion: 1, organizationNumber: '559281-0823' },
        profiles: [{ id: profileId, orgId: ctx.orgId, name: 'Brand' }], migrationRequired: false }
    } },
    '@/lib/organizations/administrationHttp': http,
    './customerOffers': { offerId: value => { if (!http.isOrganizationUuid(value)) throw Error('CUSTOMER_OFFER_INVALID'); return value } },
    './contractSenderProfile': { normalizeContractSenderProfile },
  })
  const route = load('src/app/api/action-cases/[caseId]/sender-profile/route.ts', {
    '@/lib/action-cases/customerOffersHttp': {
      async customerOfferContext() { auth.push('auth+tasks'); if (options.authError) throw Error(options.authError); return ctx },
      customerOfferError(error) { return Response.json({ error: 'Bounded public error' }, { status: error.message === 'CUSTOMER_SENDER_SCHEMA' ? 503 : error.message === 'UNAUTHORIZED' ? 401 : 409 }) },
    },
    '@/lib/action-cases/customerOffersServer': { async getCustomerOfferWorkspace(context, project) {
      workspaceReads.push({ context, project }); if (options.readbackError) throw Error('CUSTOMER_OFFER_FAILED')
      return { revision: 2, draft: {}, offers: [] }
    } },
    '@/lib/action-cases/contractSenderProfileServer': server,
    '@/lib/organizations/administrationHttp': http,
  })
  return { server, route, calls, reads, downloads, auth, workspaceReads }
}
const params = { params: Promise.resolve({ caseId }) }
const request = (value = selection(), headers = {}) => new Request(`https://hushub.se/api/action-cases/${caseId}/sender-profile`, {
  method: 'POST', headers: { origin: 'https://hushub.se', 'content-type': 'application/json', ...headers }, body: JSON.stringify(value),
})

test('selection parser refuses client snapshots, actor/org claims, logos and stale/malformed version inputs', () => {
  const h = harness()
  for (const bad of [null, [], {}, ...['snapshot', 'logoDataUrl', 'userId', 'orgId'].map(key => ({ ...selection(), [key]: 'injected' })),
    { ...selection(), confirmed: false }, { ...selection(), requestId: 'bad' }, { ...selection(), profileId: 'bad' },
    ...[0, -1, '1', 1.5, 2147483647].map(revision => ({ ...selection(), revision })),
    { ...selection(), profileVersion: 0 }, { ...selection(), legalNameVersion: 0 }, { ...selection(), organizationNumber: null }]) {
    assert.throws(() => h.server.parseContractSenderSelection(bad), /CUSTOMER_SENDER_INVALID/)
  }
})

test('logo-free sender selection uses session context and only scalar confirmed request values', async () => {
  const h = harness()
  assert.deepEqual(await h.server.selectContractSenderProfile(ctx, caseId, selection()), { saved: true })
  assert.deepEqual(h.calls, [{ name: 'select_action_case_contract_sender', args: {
    p_org_id: ctx.orgId, p_case_id: caseId, p_user_id: ctx.userId, p_data: selection(), p_logo_data_url: null,
  } }])
  assert.equal(h.downloads.length, 0)
  assert.deepEqual(h.reads[0].filters, [['org_id', ctx.orgId], ['id', caseId]])
})

test('exact replay reconciles before reading current profile or downloading a changed/removed logo', async () => {
  const h = harness({ replay: true, logo: true, profileMissing: true })
  await h.server.selectContractSenderProfile(ctx, caseId, selection())
  assert.equal(h.calls.length, 1)
  assert.equal(h.reads.some(row => row.table === 'organization_sender_profiles'), false)
  assert.equal(h.downloads.length, 0)
})

test('logo is downloaded from same-org storage only and embedded as bounded decoded PNG with no mutable URL', async () => {
  const source = await sharp({ create: { width: 1600, height: 800, channels: 4, background: '#123456' } }).jpeg().toBuffer()
  const h = harness({ logo: true, image: source })
  await h.server.selectContractSenderProfile(ctx, caseId, selection())
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.downloads, [{ bucket: 'property-media', path: `organizations/${ctx.orgId}/logo-${id(6)}.png` }])
  const data = h.calls[1].args.p_logo_data_url
  assert.match(data, /^data:image\/png;base64,iVBORw0KGgo/u)
  assert.ok(data.length <= 200000)
  const image = await sharp(Buffer.from(data.split(',')[1], 'base64')).metadata()
  assert.equal(image.format, 'png'); assert.ok(image.width <= 800); assert.ok(image.height <= 300)
  assert.equal(image.exif, undefined)
})

test('foreign paths and unavailable images never become sender selections or arbitrary network requests', async () => {
  for (const logoPath of [`organizations/${id(99)}/logo-${id(6)}.png`, 'https://example.test/logo.png', `organizations/${ctx.orgId}/../logo.png`]) {
    const h = harness({ logo: true, logoPath })
    await assert.rejects(h.server.selectContractSenderProfile(ctx, caseId, selection()), /CUSTOMER_SENDER_MEDIA/)
    assert.equal(h.downloads.length, 0)
    assert.equal(h.calls.some(call => call.args.p_logo_data_url !== null), false)
  }
  const unavailable = harness({ logo: true })
  await assert.rejects(unavailable.server.selectContractSenderProfile(ctx, caseId, selection()), /CUSTOMER_SENDER_MEDIA/)
  assert.equal(unavailable.calls.some(call => call.args.p_logo_data_url !== null), false)
})

test('missing migration is read-only unavailable and fails closed on selection without any image IO', async () => {
  const h = harness({ bindingMissing: true, rpcError: { code: 'PGRST202' } })
  const workspace = await h.server.getContractSenderWorkspace(ctx, caseId)
  assert.equal(workspace.available, false); assert.deepEqual(workspace.profiles, []); assert.equal(workspace.selected, null)
  await assert.rejects(h.server.selectContractSenderProfile(ctx, caseId, selection()), /CUSTOMER_SENDER_SCHEMA/)
  assert.equal(h.downloads.length, 0)
})

test('dedicated API requires tasks context and same-origin bounded exact body; only success reads back workspace', async () => {
  const anonymous = harness({ authError: 'UNAUTHORIZED' })
  assert.equal((await anonymous.route.POST(request(), params)).status, 401)
  assert.equal(anonymous.calls.length, 0)
  const foreign = harness()
  const denied = await foreign.route.POST(request(selection(), { origin: 'https://attacker.test' }), params)
  assert.equal(denied.status, 403); assert.equal((await denied.json()).code, 'CUSTOMER_SENDER_FORBIDDEN')
  assert.equal(foreign.calls.length, 0)
  const h = harness(), response = await h.route.POST(request(), params)
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { saved: true, workspace: { revision: 2, draft: {}, offers: [] } })
  assert.match(response.headers.get('cache-control'), /private.*no-store/u)
  assert.deepEqual(h.auth, ['auth+tasks'])
  assert.deepEqual(h.workspaceReads, [{ context: ctx, project: caseId }])
})

test('committed selection with failed readback stays retryable and is never falsely reported as success', async () => {
  const h = harness({ readbackError: true })
  const failed = await h.route.POST(request(), params)
  assert.notEqual(failed.status, 200)
  assert.equal((await failed.json()).code, 'CUSTOMER_SENDER_FAILED')
  const retried = await h.route.POST(request(), params)
  assert.notEqual(retried.status, 200)
  assert.deepEqual(h.calls[0].args.p_data, h.calls[1].args.p_data)
})
