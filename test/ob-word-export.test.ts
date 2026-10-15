import assert from 'node:assert/strict'
import test from 'node:test'
import JSZip from 'jszip'
import { readFileSync } from 'node:fs'
// @ts-expect-error Node strip-types requires the explicit extension.
import { loadWordModule } from './helpers/load-word-report.ts'
import type { buildWordReport as Build, WordImage } from '../src/lib/report/word/buildWordReport.ts'
import type { buildReportSpec as Spec } from '../src/lib/report/reportSpec.ts'
import type { ReportSnapshotPayloadV1 } from '../src/lib/report/reportSnapshotPayload.ts'

const { buildWordReport } = loadWordModule<{ buildWordReport: typeof Build }>('src/lib/report/word/buildWordReport.ts')
const { buildReportSpec } = loadWordModule<{ buildReportSpec: typeof Spec }>('src/lib/report/reportSpec.ts')
const { snapshotWithBuildings } = loadWordModule<{ snapshotWithBuildings: () => ReportSnapshotPayloadV1 }>('test/fixtures/report-snapshot-buildings-data.ts')
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a12sAAAAASUVORK5CYII=', 'base64')
const loadImage = async (): Promise<WordImage> => ({ data: png, width: 400, height: 200 })
function fixture(side: 'buyer' | 'seller' | 'apartment' | 'status' = 'buyer') {
  const snapshot = snapshotWithBuildings()
  snapshot.inspectionSide = side
  snapshot.reportData.mock.inspections.assignment_number = '2026-0101-01'
  snapshot.reportData.mock.profile = { full_name: 'Fryst Besiktningsman', company_name: 'Fryst Företag AB',
    company_website: '', company_address: 'Sparad väg 1', company_postal_code: '12345', company_city: 'Teststad' }
  snapshot.reportData.mock.company = { logo_url: '/report-assets/BesiktApp.png' }
  snapshot.reportData.mock.documents = { provided: ['Energideklaration: Tillhandahållen\nSparad dokumentnotering'] }
  snapshot.reportData.mock.disclosures = { acquisition_text: 'Frysta ägaruppgifter', renovations: ['Renovering 2010'], property_faults: 'Fryst felupplysning' }
  if (side === 'status') snapshot.reportData.mock.status_report = {
    terms: 'EXAKT FRYSTA STATUSVILLKOR', assignmentNotice: 'FRYST STATUSUPPDRAG',
    visualConditions: 'FRYSTA FÖRUTSÄTTNINGAR', oralInformation: 'FRYSTA MUNTLIGA UPPGIFTER',
  }
  snapshot.reportSpec = buildReportSpec({ layoutVersion: 2, inspectionSide: side,
    dynamicAppendices: { buildings: snapshot.reportData.mock.appendices.buildings } })
  return snapshot
}

test('Word contains saved main/extra buildings, notes, risk/FTU, documents and appendices without mutating the snapshot', async () => {
  const snapshot = fixture()
  const before = JSON.stringify(snapshot)
  const loaded: string[] = []
  const bytes = await buildWordReport(snapshot, { loadImage: async url => { loaded.push(url); return loadImage() } })
  const zip = await JSZip.loadAsync(bytes)
  const xml = await zip.file('word/document.xml')!.async('string')
  for (const value of ['Utlåtande över överlåtelsebesiktning', 'Garage', 'Fryst Besiktningsman', 'Sparad dokumentnotering',
    'Garagets sparade taknotering', 'Garagets frysta risktext', 'Garagets frysta FTU-text',
    'Gästhusets sparade köksnotering', 'Renovering 2010', 'Fryst felupplysning', 'BILAGA 1', 'TEKNISKA MEDELLIVSLÄNGDER']) assert.ok(xml.includes(value), value)
  assert.ok(xml.includes('w:pageBreakBefore'))
  assert.ok(!xml.includes('# Format:'), 'internal lifespan text format comments are not report content')
  assert.ok(Object.keys(zip.files).some(name => name.startsWith('word/media/')))
  assert.ok(loaded.includes('/report-assets/sbr-logo.png'))
  assert.equal(loaded.filter(url => url === '/landing/besiktning-editorial-v2.png').length, 1, 'shared photos are loaded once')
  const footer = await zip.file('word/footer1.xml')!.async('string')
  assert.ok(footer.includes('Fryst Företag AB'))
  assert.ok(!footer.includes('hushub.se'), 'no invented website')
  assert.equal(JSON.stringify(snapshot), before)
})

test('status Word uses frozen terms/recommendations and does not introduce OB risk/FTU text', async () => {
  const snapshot = fixture('status')
  const note = snapshot.reportData.mock.interior.blocks[0]
  Object.assign(note, { recommendationText: 'FRYST REKOMMENDATION', commentText: 'FRYST KOMMENTAR', riskText: 'WRONG OB RISK', ftuText: 'WRONG OB FTU' })
  const zip = await JSZip.loadAsync(await buildWordReport(snapshot, { loadImage }))
  const xml = await zip.file('word/document.xml')!.async('string')
  for (const value of ['statusbesiktning', 'EXAKT FRYSTA STATUSVILLKOR', 'FRYST STATUSUPPDRAG', 'FRYST REKOMMENDATION', 'FRYST KOMMENTAR']) assert.ok(xml.includes(value), value)
  assert.ok(!xml.includes('WRONG OB'))
})

test('draft is marked, missing stored structure or unavailable images never silently produce an incomplete Word copy', async () => {
  const snapshot = fixture()
  const zip = await JSZip.loadAsync(await buildWordReport(snapshot, { loadImage, draft: true }))
  assert.ok((await zip.file('word/document.xml')!.async('string')).includes('UTKAST'))
  await assert.rejects(buildWordReport({ ...snapshot, reportSpec: [] }, { loadImage }), /WORD_REPORT_SPEC_MISSING/)
  await assert.rejects(buildWordReport(snapshot, { loadImage: async () => { throw Error('image failed') } }), /image failed/)
})

test('each report block type is handled explicitly and Word never reads the mutable note library', () => {
  const source = readFileSync('src/lib/report/word/buildWordReport.ts', 'utf8')
  assert.ok(!/control_outcomes|risk_templates|ftu_templates|supabase|fetch\(/.test(source))
})

const context = { params: Promise.resolve({ id: 'inspection' }) }
function harness(options: { denied?: boolean; colleague?: boolean; missing?: boolean; locked?: boolean; archived?: boolean; error?: string } = {}) {
  const snapshot = fixture()
  const calls = { snapshots: [] as string[], builds: 0, exports: [] as unknown[], orgs: [] as unknown[] }
  const access = async (_id: string, org: unknown, draft = false) => {
    calls.orgs.push(org)
    if (options.denied) throw Error('UNAUTHORIZED')
    if (draft && options.colleague) throw Error('OB_ORGANIZATION_FORBIDDEN')
    return { orgId: 'org', userId: 'user', canEdit: !options.colleague }
  }
  const http = loadWordModule<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts')
  const route = loadWordModule<{ GET: (req: Request, ctx: unknown) => Promise<Response> }>('src/app/api/ob/inspections/[id]/word/route.ts', {
    '@/lib/ob/organizationBindings': { requireObInspectionReadContext: access,
      requireObInspectionContext: (id: string, org: unknown) => access(id, org, true) },
    '@/lib/ob/publishedReport': { getObPublishedReportRecord: async (_db: unknown, _id: string, version: string) => {
      calls.snapshots.push(version); return options.missing ? null : { snapshot }
    } },
    '@/lib/organizations/administrationHttp': http,
    '@/lib/ob/organizationHttp': loadWordModule('src/lib/ob/organizationHttp.ts', { '@/lib/organizations/administrationHttp': http }),
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { property_id: 'property', locked_at: options.locked ? '2026-01-01' : null, status: options.archived ? 'archived' : 'draft' }, error: null,
    }) }) }) }) }) },
    '@/lib/report/pdfV2/buildReportDataV2': { buildReportDataV2: async (_params: unknown, _part: unknown, opts: unknown) => {
      assert.deepEqual(opts, { readOnly: true }); calls.builds++; return snapshot.reportData
    } },
    '@/lib/report/word/buildWordReport': { buildWordReport: async (value: unknown, opts: unknown) => {
      calls.exports.push({ value, opts }); if (options.error) throw Error(options.error); return Buffer.from('PK-frozen-word')
    } },
    '@/lib/report/word/wordReportImages': { createWordImageLoader: () => loadImage },
  })
  const get = (query: string) => route.GET(new Request(`https://hushub.se/api/ob/inspections/inspection/word?${query}`), context)
  return { get, calls, snapshot }
}

test('selected published Word uses only that frozen snapshot, including colleague read permission and frozen filename', async () => {
  for (const colleague of [false, true]) {
    const { get, calls, snapshot } = harness({ colleague })
    const result = await get('report=selected-version')
    assert.equal(result.status, 200)
    assert.equal(await result.text(), 'PK-frozen-word')
    assert.ok(result.headers.get('content-type')!.includes('wordprocessingml'))
    assert.ok(decodeURIComponent(result.headers.get('content-disposition')!).includes('2026-0101-01.docx'))
    assert.equal(result.headers.get('cache-control'), 'private, no-store, max-age=0')
    assert.deepEqual(calls.snapshots, ['selected-version'])
    assert.equal(calls.builds, 0)
    assert.equal((calls.exports[0] as { value: unknown }).value, snapshot)
  }
})

test('Word draft is explicit, read-only, owner-only and refused for locked or archived inspections', async () => {
  const { get, calls } = harness()
  const result = await get('draft=1')
  assert.equal(result.status, 200)
  assert.ok(decodeURIComponent(result.headers.get('content-disposition')!).includes(' - utkast.docx'))
  assert.equal(calls.builds, 1)
  assert.deepEqual(calls.snapshots, [])
  for (const opts of [{ colleague: true }, { locked: true }, { archived: true }]) {
    const h = harness(opts)
    assert.equal((await h.get('draft=1')).status, opts.colleague ? 403 : 409)
    assert.equal(h.calls.builds, 0)
    assert.equal(h.calls.exports.length, 0)
  }
})

test('missing/denied report, ambiguous query, size/asset failures fail closed without loading current data', async () => {
  for (const [opts, status] of [[{ denied: true }, 401], [{ missing: true }, 404],
    [{ error: 'WORD_REPORT_TOO_LARGE' }, 413], [{ error: 'WORD_REPORT_SPEC_MISSING' }, 409], [{ error: 'image unavailable' }, 503]] as const) {
    const h = harness(opts)
    assert.equal((await h.get('report=selected')).status, status)
    assert.equal(h.calls.builds, 0)
    if ('denied' in opts) assert.equal(h.calls.snapshots.length, 0)
  }
  for (const query of ['', 'report=a&report=b', 'report=a&draft=1', 'draft=1&draft=1', 'draft=0', 'report=']) {
    const h = harness()
    assert.equal((await h.get(query)).status, 400, query)
    assert.deepEqual(h.calls.orgs, [])
  }
})

test('Word image loader only accepts fixed public assets and this deployment storage, never external or traversal paths', () => {
  const { wordImageSource } = loadWordModule<{ wordImageSource: (input: string, base: string) => unknown }>('src/lib/report/word/wordReportImages.ts')
  const base = 'https://storage-project.supabase.co'
  const image = `${base}/storage/v1/object/public/inspection-images/owner/image.jpg`
  assert.deepEqual(wordImageSource(image, base), { remote: image })
  assert.deepEqual(wordImageSource('/report-assets/sbr-logo.png', base), { local: '/report-assets/sbr-logo.png' })
  for (const invalid of ['https://evil.test/image.png', 'http://127.0.0.1/secret', 'file:///etc/passwd',
    '//evil.test/a.jpg', '/report-assets/../secret.png', '/report-assets/%2e%2e/secret.png', '/.env',
    `${base}/storage/v1/object/public/other-bucket/secret`, `${base}/rest/v1/profiles`,
    `https://user:password@storage-project.supabase.co/storage/v1/object/public/inspection-images/image.jpg`]) {
    assert.throws(() => wordImageSource(invalid, base), invalid)
  }
})

test('image fetch is bounded, refuses redirects/failed assets, and normalizes local images with their aspect ratio intact', async () => {
  const { createWordImageLoader } = loadWordModule<{ createWordImageLoader: () => (input: string) => Promise<WordImage> }>('src/lib/report/word/wordReportImages.ts')
  const local = await createWordImageLoader()('/report-assets/sbr-logo.png')
  assert.ok(local.data.length > 0 && local.width > local.height)
  const oldFetch = globalThis.fetch
  const oldBase = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage-project.supabase.co'
  const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/inspection-images/photo.png`
  try {
    for (const response of [new Response('denied', { status: 403 }), new Response('too big', { headers: { 'Content-Length': String(11 * 1024 * 1024) } })]) {
      globalThis.fetch = async (_url, init) => {
        assert.equal(init?.redirect, 'error'); assert.equal(init?.cache, 'no-store')
        assert.ok(init?.signal); return response
      }
      await assert.rejects(createWordImageLoader()(url), /WORD_IMAGE_UNAVAILABLE/)
    }
    globalThis.fetch = async () => new Response(new Uint8Array(11 * 1024 * 1024))
    await assert.rejects(createWordImageLoader()(url), /WORD_REPORT_TOO_LARGE/)
  } finally {
    globalThis.fetch = oldFetch
    if (oldBase === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldBase
  }
})
