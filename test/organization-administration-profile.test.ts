import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Administration from '../src/lib/organizations/administration'
import type * as AdministrationTypes from '../src/lib/organizations/administrationTypes'
import type * as AdministrationHttp from '../src/lib/organizations/administrationHttp'
import type * as ProfileCard from '../src/lib/organizations/profileCard'
import type * as ProfileRoute from '../src/app/api/organizations/profile/route'
import type * as MemberRoute from '../src/app/api/organizations/member-profile/route'
import type * as Multipart from '../src/lib/organizations/multipart'

const ACTOR = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORG_FOREIGN = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const UPLOAD = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const compiledSources = new Map<string,string>()

function load<T>(file: string, dependencies: Record<string, unknown> = {}): T {
  const output = compiledSources.get(file) ?? ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  compiledSources.set(file,output)
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected dependency ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const domain = load('src/lib/fortnox/domain.ts')
const parsers = load<typeof AdministrationTypes>('src/lib/organizations/administrationTypes.ts', { '@/lib/fortnox/domain': domain })
const personalParser = load('src/lib/organizations/profileCardTypes.ts', { '@/lib/fortnox/domain': domain })
const http = load<typeof AdministrationHttp>('src/lib/organizations/administrationHttp.ts')
const multipart = load<typeof Multipart>('src/lib/organizations/multipart.ts')

type Row = Record<string, unknown>
type DbError = { code?: string; message: string }
type HarnessOptions = {
  authenticated?: boolean
  role?: 'admin' | 'inspector'
  active?: boolean
  missingSchema?: boolean
  modulesError?: DbError
  memberError?: DbError
  rpcError?: DbError
  rpcData?: unknown
  existingCard?: boolean
}

function harness(options: HarnessOptions = {}) {
  const queries: Array<{ table: string; columns: string; filters: Array<[string, unknown]> }> = []
  const writes: Array<{ name: string; args: Row }> = []
  const organizations: Row[] = [
    { id: ORG_A, name: 'BBSAB', organization_number: '559281-0823', profile_address: 'First street',
      profile_postal_code: '11111', profile_city: 'Stockholm', profile_website: 'https://bbsab.example/',
      profile_logo_path: null, profile_report_footer_text: 'Shared footer', profile_configured: true, profile_version: 2 },
    { id: ORG_B, name: 'SVEA', organization_number: null, profile_address: 'Second street',
      profile_postal_code: null, profile_city: 'Solna', profile_website: null,
      profile_logo_path: null, profile_report_footer_text: null, profile_configured: true, profile_version: 1 },
    { id: ORG_FOREIGN, name: 'Other company', organization_number: null, profile_configured: true, profile_version: 1 },
  ]
  const memberships: Row[] = [
    { org_id: ORG_A, profile_id: ACTOR, role: options.role ?? 'admin', is_active: options.active !== false, is_default: true, created_at: '2026-01-01' },
    { org_id: ORG_B, profile_id: ACTOR, role: 'inspector', is_active: true, is_default: false, created_at: '2026-02-01' },
    { org_id: ORG_FOREIGN, profile_id: OTHER, role: 'admin', is_active: true, is_default: true, created_at: '2026-01-01' },
  ]
  const profile: Row = { id: ACTOR, full_name: 'My personal name', email: 'mine@example.test', phone: null,
    avatar_path: null, signature_path: null, company_name: 'Old global company', company_orgno: null,
    company_address: null, company_postal_code: null, company_city: null, logo_path: null }
  let card: Row | null = options.existingCard ? { id: UPLOAD, org_id: ORG_A, profile_id: ACTOR,
    display_name: 'Saved name', title: null, phone: null, email: 'mine@example.test', avatar_path: null, signature_path: null,
    company_name: 'Old per-person company', company_orgno: null, company_address: null, company_postal_code: null,
    company_city: null, logo_path: null, report_footer_text: null, version: 4, created_at: null, updated_at: null } : null

  function from(table: string) {
    const query = { table, columns: '', filters: [] as Array<[string, unknown]> }
    queries.push(query)
    function response(single = false): { data: Row | Row[] | null; error: DbError | null } {
      if (table === 'org_members' && options.memberError) return { data: null, error: options.memberError }
      if (table === 'organization_enabled_modules' && options.modulesError) return { data: null, error: options.modulesError }
      if (table === 'organizations' && options.missingSchema && query.columns.includes('profile_address')) {
        return { data: null, error: { code: '42703', message: 'column organizations.profile_address does not exist' } }
      }
      const rows = table === 'org_members' ? memberships : table === 'organizations' ? organizations
        : table === 'organization_enabled_modules' ? [{ org_id: ORG_A, module_key: 'technical_investigations', is_active: true }]
        : table === 'profiles' ? [profile] : table === 'profile_org_cards' ? card ? [card] : [] : null
      if (!rows) throw new Error(`Unexpected table ${table}`)
      const filtered = rows.filter(row => query.filters.every(([key, value]) => row[key] === value))
      return { data: single ? filtered[0] ?? null : filtered, error: null }
    }
    const builder = {
      select(columns: string) { query.columns = columns; return builder },
      eq(key: string, value: unknown) { query.filters.push([key,value]); return builder },
      order() { return builder }, limit() { return builder },
      maybeSingle: async () => response(true), single: async () => response(true),
      then(resolve: (value: ReturnType<typeof response>) => unknown, reject?: (reason: unknown) => unknown) {
        return Promise.resolve(response()).then(resolve,reject)
      },
    }
    return builder
  }
  const db = {
    from,
    async rpc(name: string, args: Row) {
      writes.push({ name, args })
      if (options.rpcError) return { data: null, error: options.rpcError }
      if (Object.hasOwn(options, 'rpcData')) return { data: options.rpcData, error: null }
      if (name === 'organization_member_profile_save') {
        const personal = args.p_values as Row
        card = { id: UPLOAD, org_id: args.p_org, profile_id: args.p_actor, version: Number(args.p_expected_version)+1,
          display_name: personal.displayName, title: personal.title, phone: personal.phone, email: personal.email,
          avatar_path: personal.avatarPath, signature_path: personal.signaturePath, company_name: 'BBSAB', company_orgno: '559281-0823',
          company_address: 'First street', company_postal_code: '11111', company_city: 'Stockholm', logo_path: null,
          report_footer_text: 'Shared footer', created_at: null, updated_at: null }
      }
      return { data: { saved: true }, error: null }
    },
  }
  const dependencies = { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db } }
  const branding = load('src/lib/organizations/companyProfile.ts', dependencies)
  const administration = load<typeof Administration>('src/lib/organizations/administration.ts', {
    ...dependencies,
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: ACTOR } }, error: null }) } }) },
    './companyProfile': branding, './administrationTypes': parsers,
  })
  const cards = load<typeof ProfileCard>('src/lib/organizations/profileCard.ts', { ...dependencies, '@/lib/organizations/companyProfile': branding })
  const profileRoute = load<typeof ProfileRoute>('src/app/api/organizations/profile/route.ts', {
    '@/lib/organizations/administration': administration, '@/lib/organizations/administrationHttp': http,
  })
  const memberRoute = load<typeof MemberRoute>('src/app/api/organizations/member-profile/route.ts', {
    '@/lib/organizations/administration': administration, '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/profileCard': cards, '@/lib/organizations/profileCardTypes': personalParser,
  })
  return { administration, profileRoute, memberRoute, queries, writes, cards }
}

const companyValues = (patch: Row = {}) => ({ name: 'BBSAB', organizationNumber: '5592810823', address: null,
  postalCode: null, city: null, website: null, logoPath: null, reportFooterText: null, ...patch })
const personalValues = (patch: Row = {}) => ({ displayName: 'My name', title: null, phone: null,
  email: 'ME@example.test', avatarPath: null, signaturePath: null, ...patch })
function jsonRequest(path: string, body: unknown, headers: Record<string,string> = {}) {
  return new Request(`https://hushub.se${path}`, { method: 'PUT', headers: {
    origin: 'https://hushub.se', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers,
  }, body: JSON.stringify(body) })
}
const personalRequest = (patch: Row = {}, headers: Record<string,string> = {}) => jsonRequest('/api/organizations/member-profile',
  { orgId: ORG_A, expectedVersion: null, card: personalValues(), ...patch }, headers)
const profileRequest = (patch: Row = {}, headers: Record<string,string> = {}) => jsonRequest('/api/organizations/profile',
  { orgId: ORG_A, expectedVersion: 2, profile: companyValues(), ...patch }, headers)

test('company parser normalizes canonical identity and website, while rejecting missing or injected fields', () => {
  const parsed = parsers.parseOrganizationProfile(companyValues({ name: ' BBSAB ', website: 'bbsab.example', organizationNumber: '5592810823' }))
  assert.equal(parsed.name,'BBSAB'); assert.equal(parsed.organizationNumber,'559281-0823'); assert.equal(parsed.website,'https://bbsab.example/')
  for (const value of [null, [], { name: 'Only field' }, companyValues({ isAdmin: true }), companyValues({ name: '' }),
    companyValues({ organizationNumber:'111111-1111' }), companyValues({ city:123 }), companyValues({ name:'Injected\0name' }),
    companyValues({ website:'https://user:secret@example.test' }), companyValues({ website:'javascript:alert(1)' })]) {
    assert.throws(()=>parsers.parseOrganizationProfile(value),/ORG_INPUT_INVALID/)
  }
})

test('company website length is bounded after normalization and percent encoding', () => {
  assert.throws(()=>parsers.parseOrganizationProfile(companyValues({ website:`example.test/${'a'.repeat(486)}` })),/ORG_INPUT_INVALID/)
  assert.throws(()=>parsers.parseOrganizationProfile(companyValues({ website:`https://example.test/${'å'.repeat(200)}` })),/ORG_INPUT_INVALID/)
})

test('organization context is resolved through authenticated active membership, including explicit second organization', async () => {
  const h = harness()
  assert.equal((await h.administration.requireOrganizationContext()).organization.id,ORG_A)
  const second = await h.administration.requireOrganizationContext(ORG_B)
  assert.equal(second.organization.id,ORG_B); assert.equal(second.role,'inspector'); assert.equal(second.profileId,ACTOR)
  const selection = h.queries.filter(q=>q.table==='org_members').at(-1)
  assert.deepEqual(selection?.filters,[['profile_id',ACTOR],['is_active',true],['org_id',ORG_B]])
  await assert.rejects(h.administration.requireOrganizationContext(ORG_FOREIGN),/ORG_MEMBERSHIP_REQUIRED/)
  await assert.rejects(h.administration.requireOrganizationAdmin(ORG_B),/ORG_ADMIN_REQUIRED/)
  for (const invalid of [null,'',OTHER+'/../',42,{}]) await assert.rejects(h.administration.requireOrganizationContext(invalid),/ORG_SELECTION_INVALID/)
  await assert.rejects(harness({ authenticated:false }).administration.requireOrganizationContext(ORG_A),/UNAUTHORIZED/)
  await assert.rejects(harness({ active:false }).administration.requireOrganizationContext(ORG_A),/ORG_MEMBERSHIP_REQUIRED/)
})

test('missing shared-profile SQL exposes read-only legacy identity but fails closed for writes', async () => {
  const h = harness({ missingSchema:true })
  const context = await h.administration.requireOrganizationContext(ORG_A)
  assert.equal(context.migrationRequired,true); assert.equal(context.organization.configured,false); assert.deepEqual(context.modules,[])
  await assert.rejects(h.administration.requireOrganizationAdmin(ORG_A),/ORG_MIGRATION_REQUIRED/)
  const response = await h.memberRoute.PUT(personalRequest())
  assert.equal(response.status,503); assert.equal((await response.json()).code,'ORG_MIGRATION_REQUIRED')
  assert.equal(h.writes.length,0)
  await assert.rejects(harness({ modulesError:{ code:'42P01',message:'Missing table secret SQL' } }).administration.requireOrganizationContext(ORG_A),/ORG_MIGRATION_REQUIRED/)
})

test('company save uses authenticated actor and selected org; rejects inspector, stale input and foreign logo before RPC', async () => {
  const h = harness()
  const logo = `organizations/${ORG_A}/logo-${UPLOAD}.png`
  await h.administration.saveOrganizationProfile(ORG_A,2,companyValues({ logoPath:logo }))
  assert.deepEqual(h.writes[0],{ name:'organization_profile_save',args:{ p_actor:ACTOR,p_org:ORG_A,p_expected_version:2,
    p_values:parsers.parseOrganizationProfile(companyValues({ logoPath:logo })) } })
  for (const version of [null,0,-1,1.5,'2',Number.MAX_SAFE_INTEGER+1]) await assert.rejects(h.administration.saveOrganizationProfile(ORG_A,version,companyValues()),/ORG_INPUT_INVALID/)
  await assert.rejects(h.administration.saveOrganizationProfile(ORG_B,1,companyValues()),/ORG_ADMIN_REQUIRED/)
  await assert.rejects(h.administration.saveOrganizationProfile(ORG_FOREIGN,1,companyValues()),/ORG_MEMBERSHIP_REQUIRED/)
  for (const path of [`organizations/${ORG_B}/logo-${UPLOAD}.png`,`https://cdn.example/logo.png`,`organizations/${ORG_A}/../logo-${UPLOAD}.png`]) {
    await assert.rejects(h.administration.saveOrganizationProfile(ORG_A,2,companyValues({logoPath:path})),/ORG_INPUT_INVALID/)
  }
  assert.equal(h.writes.length,1)
})

test('company save requires positive RPC confirmation and preserves conflict without leaking internal error text', async () => {
  for (const rpcData of [null,{}, { saved:false }]) {
    await assert.rejects(harness({rpcData}).administration.saveOrganizationProfile(ORG_A,2,companyValues()),/ORG_PROFILE_SAVE_FAILED/)
  }
  const conflict = await harness({rpcError:{message:'ORG_CONFLICT'}}).profileRoute.PUT(profileRequest())
  assert.equal(conflict.status,409); assert.equal((await conflict.json()).code,'ORG_CONFLICT')
  const secret = await harness({rpcError:{message:'internal table secret token very-private'}}).profileRoute.PUT(profileRequest())
  assert.equal(secret.status,500); assert.doesNotMatch(await secret.text(),/internal|token|very-private/)
})

test('profile API requires one organization for GET and exact envelope/origin for PUT', async () => {
  const h = harness()
  const response = await h.profileRoute.GET(new Request(`https://hushub.se/api/organizations/profile?orgId=${ORG_B}`))
  assert.equal(response.status,200); assert.equal((await response.json()).workspace.organization.id,ORG_B)
  assert.match(response.headers.get('cache-control') ?? '',/private.*no-store/)
  for (const query of ['',`?orgId=${ORG_A}&orgId=${ORG_B}`,'?orgId=null']) {
    assert.equal((await h.profileRoute.GET(new Request(`https://hushub.se/api/organizations/profile${query}`))).status,400)
  }
  assert.equal((await h.profileRoute.PUT(profileRequest({ actorProfileId:OTHER }))).status,400)
  assert.equal((await h.profileRoute.PUT(profileRequest({}, {origin:'https://evil.example'}))).status,403)
  assert.equal((await h.profileRoute.PUT(profileRequest({}, {'sec-fetch-site':'cross-site'}))).status,403)
  assert.equal((await h.profileRoute.PUT(profileRequest({}, {'content-type':'text/plain'}))).status,415)
  assert.equal(h.writes.length,0)
})

test('member profile endpoint writes exactly six personal fields through self-scoped CAS RPC; null version becomes zero', async () => {
  const h = harness({role:'inspector'})
  const response = await h.memberRoute.PUT(personalRequest())
  assert.equal(response.status,200)
  assert.deepEqual(h.writes,[{name:'organization_member_profile_save',args:{p_actor:ACTOR,p_org:ORG_A,p_expected_version:0,
    p_values:{...personalValues(),email:'me@example.test'}}}])
  const body = await response.json()
  assert.equal(body.workspace.card.companyName,'BBSAB')
  assert.equal(body.workspace.profileId,ACTOR); assert.equal(body.workspace.version,1)
  assert.equal(h.queries.filter(q=>q.table==='profile_org_cards').every(q=>q.filters.some(([k,v])=>k==='profile_id'&&v===ACTOR)&&q.filters.some(([k,v])=>k==='org_id'&&v===ORG_A)),true)
  const stale = harness({existingCard:true})
  assert.equal((await stale.memberRoute.PUT(personalRequest({expectedVersion:3}))).status,409)
  assert.equal(stale.writes.length,0)
})

test('member profile route rejects corporate and actor injections, partial fields, invalid versions and inactive membership', async () => {
  const h = harness()
  for (const patch of [
    {profileId:OTHER}, {actorProfileId:OTHER}, {card:personalValues({companyName:'Forged'})}, {card:personalValues({logoPath:'forged'})},
    {card:{displayName:'Only name'}}, {card:[]}, {expectedVersion:0}, {expectedVersion:-1}, {expectedVersion:'4'},
  ]) assert.equal((await h.memberRoute.PUT(personalRequest(patch))).status,400)
  assert.equal((await h.memberRoute.PUT(personalRequest({orgId:ORG_FOREIGN}))).status,403)
  assert.equal((await harness({active:false}).memberRoute.PUT(personalRequest())).status,403)
  assert.equal((await harness({authenticated:false}).memberRoute.PUT(personalRequest())).status,401)
  assert.equal((await h.memberRoute.PUT(personalRequest({card:personalValues({signaturePath:`profiles/${OTHER}/organizations/${ORG_A}/signaturePath-${UPLOAD}.png`})}))).status,400)
  assert.equal(h.writes.length,0)
})

test('safe API failures never reflect unexpected database messages', async () => {
  const h = harness({memberError:{message:'sensitive query credentials token=123'}})
  const response = await h.profileRoute.GET(new Request(`https://hushub.se/api/organizations/profile?orgId=${ORG_A}`))
  assert.equal(response.status,500); assert.doesNotMatch(await response.text(),/sensitive|credentials|token=/)
  for (const value of ['constructor','toString','ORG_UNKNOWN_SECRET',new Error('raw postgres token secret')]) {
    const safe = http.organizationFailure(typeof value === 'string' ? new Error(value) : value)
    assert.equal(safe.status,500); assert.equal((await safe.json()).code,'ORG_REQUEST_FAILED')
  }
})

function streamRequest(chunks: Uint8Array[], headers: Record<string,string> = {}, cancel?: () => void) {
  let cursor = 0
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    if (cursor<chunks.length) controller.enqueue(chunks[cursor++])
    else controller.close()
  }, cancel })
  return new Request('https://hushub.se/api/organizations/profile/media', {
    method:'POST',headers:{'content-type':'multipart/form-data; boundary=org-test',...headers},body,duplex:'half',
  } as RequestInit)
}

test('multipart parser accepts valid chunked form data without a content-length', async () => {
  const bytes = new TextEncoder().encode('--org-test\r\nContent-Disposition: form-data; name="orgId"\r\n\r\nexample\r\n--org-test--\r\n')
  const form = await multipart.readOrganizationMultipart(streamRequest([bytes.subarray(0,19),bytes.subarray(19,71),bytes.subarray(71)]))
  assert.equal(form.get('orgId'),'example')
  const prefix = new TextEncoder().encode('--org-test\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n')
  const suffix = new TextEncoder().encode('\r\n--org-test--\r\n')
  const contents = new Uint8Array(6*1024*1024-prefix.length-suffix.length).fill(97)
  const boundary = await multipart.readOrganizationMultipart(streamRequest([prefix,contents,suffix]))
  assert.equal((boundary.get('file') as File).size,contents.length)
})

test('multipart parser rejects chunked bodies above six MiB despite absent or false content-length and cancels the stream', async () => {
  const headerVariants: Record<string, string>[] = [{}, {'content-length':'1'}]
  for (const headers of headerVariants) {
    let cancelled = false
    const chunks = Array.from({length:8},()=>new Uint8Array(1024*1024))
    await assert.rejects(multipart.readOrganizationMultipart(streamRequest(chunks,headers,()=>{ cancelled=true })),/ORG_REQUEST_TOO_LARGE/)
    assert.equal(cancelled,true)
  }
  await assert.rejects(multipart.readOrganizationMultipart(streamRequest([],{ 'content-length':String(6*1024*1024+1) })),/ORG_REQUEST_TOO_LARGE/)
  await assert.rejects(multipart.readOrganizationMultipart(streamRequest([],{ 'content-type':'application/json' })),/ORG_CONTENT_TYPE_INVALID/)
  await assert.rejects(multipart.readOrganizationMultipart(streamRequest([new TextEncoder().encode('bad form')])),/ORG_INPUT_INVALID/)
})
