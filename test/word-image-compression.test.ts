import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import JSZip from 'jszip'
import { xml2js } from 'xml-js'
// @ts-expect-error Node strip-types requires the explicit extension.
import { loadWordModule } from './helpers/load-word-report.ts'
import type { WordImage } from '../src/lib/report/word/buildWordReport'
import type { ReportSnapshotPayloadV1 } from '../src/lib/report/reportSnapshotPayload'

const { createWordImageLoader } = loadWordModule<{ createWordImageLoader: () => (url: string) => Promise<WordImage> }>(
  'src/lib/report/word/wordReportImages.ts')
const base = 'https://word-image-test.supabase.co'
const url = (index = 0) => `${base}/storage/v1/object/public/inspection-images/test/photo-${index}.png`

async function withPhoto(bytes: Buffer, run: () => Promise<void>) {
  const oldFetch = globalThis.fetch, oldBase = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = base
  globalThis.fetch = async (input, init) => {
    assert.ok(String(input).startsWith(base))
    assert.equal(init?.redirect, 'error')
    return new Response(new Uint8Array(bytes))
  }
  try { await run() } finally {
    globalThis.fetch = oldFetch
    if (oldBase === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = oldBase
  }
}

test('opaque photographs become substantially smaller JPEG Word copies without changing their source', async () => {
  const pixels = Buffer.allocUnsafe(2000 * 1400 * 3)
  let seed = 42
  for (let i = 0; i < pixels.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; pixels[i] = seed & 255 }
  const original = await sharp(pixels, { raw: { width: 2000, height: 1400, channels: 3 } }).png().toBuffer()
  const before = createHash('sha256').update(original).digest('hex')
  await withPhoto(original, async () => {
    const photo = await createWordImageLoader()(url())
    assert.equal(photo.format, 'jpg')
    assert.equal(photo.width, 1400)
    assert.equal(photo.height, 980)
    assert.ok(photo.data.length < original.length / 4, `${photo.data.length} vs ${original.length}`)
    assert.equal((await sharp(photo.data).metadata()).format, 'jpeg')
  })
  assert.equal(createHash('sha256').update(original).digest('hex'), before)
})

test('transparent images and local logos stay PNG, while small photos are not enlarged', async () => {
  const transparent = await sharp({ create: { width: 600, height: 300, channels: 4,
    background: { r: 30, g: 90, b: 130, alpha: 0.4 } } }).png().toBuffer()
  await withPhoto(transparent, async () => {
    const image = await createWordImageLoader()(url())
    assert.equal(image.format, 'png')
    assert.equal((await sharp(image.data).metadata()).hasAlpha, true)
    assert.deepEqual([image.width, image.height], [600, 300])
  })
  const small = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#6090b0' } }).jpeg().toBuffer()
  await withPhoto(small, async () => {
    const image = await createWordImageLoader()(url())
    assert.equal(image.format, 'jpg')
    assert.deepEqual([image.width, image.height], [640, 480])
  })
  const logo = await createWordImageLoader()('/report-assets/sbr-logo.png')
  assert.equal(logo.format, 'png')
})

test('phone orientation is applied before Word dimensions are returned', async () => {
  const original = await sharp({ create: { width: 2000, height: 1400, channels: 3, background: '#507090' } })
    .jpeg().withMetadata({ orientation: 6 }).toBuffer()
  await withPhoto(original, async () => {
    const image = await createWordImageLoader()(url())
    assert.deepEqual([image.width, image.height], [980, 1400])
    const metadata = await sharp(image.data).metadata()
    assert.equal(metadata.orientation, undefined)
    assert.deepEqual([metadata.width, metadata.height], [image.width, image.height])
  })
})

test('more than 64 MB of originals can produce a small report without removing the bounded source-download budget', async () => {
  const png = await sharp({ create: { width: 30, height: 20, channels: 3, background: '#507090' } }).png().toBuffer()
  const original = Buffer.concat([png, Buffer.alloc(9 * 1024 * 1024 - png.length)])
  await withPhoto(original, async () => {
    const loader = createWordImageLoader()
    let total = 0
    for (let i = 0; i < 28; i++) total += (await loader(url(i))).data.byteLength
    assert.ok(total < 1024 * 1024)
    await assert.rejects(loader(url(28)), /WORD_REPORT_TOO_LARGE/)
  })
})

test('the embedded-image budget still fails closed after compression', async () => {
  const png = await sharp({ create: { width: 3, height: 2, channels: 3, background: '#507090' } }).png().toBuffer()
  const converted = Buffer.alloc(33 * 1024 * 1024)
  const fakeSharp = () => {
    const chain: Record<string, unknown> = { metadata: async () => ({ hasAlpha: false, format: 'png' }),
      toBuffer: async () => ({ data: converted, info: { width: 1600, height: 1000 } }) }
    for (const name of ['rotate', 'resize', 'jpeg', 'png']) chain[name] = () => chain
    return chain
  }
  const { createWordImageLoader: create } = loadWordModule<{ createWordImageLoader: typeof createWordImageLoader }>(
    'src/lib/report/word/wordReportImages.ts', { sharp: fakeSharp })
  await withPhoto(png, async () => {
    const loader = create()
    await loader(url(1))
    await assert.rejects(loader(url(2)), /WORD_REPORT_TOO_LARGE/)
  })
})

test('Word embeds JPEG photos with the correct media type and keeps PNG-compatible existing loaders', async () => {
  const { buildWordReport } = loadWordModule<{ buildWordReport: (snapshot: ReportSnapshotPayloadV1,
    options: { loadImage: (url: string) => Promise<WordImage> }) => Promise<Buffer> }>('src/lib/report/word/buildWordReport.ts')
  const { snapshotWithBuildings } = loadWordModule<{ snapshotWithBuildings: () => ReportSnapshotPayloadV1 }>(
    'test/fixtures/report-snapshot-buildings-data.ts')
  const snapshot = snapshotWithBuildings()
  snapshot.reportSpec = [{ id: 'photos', startOnNewPage: false, blocks: [{ type: 'inspectionBlocks',
    itemsPath: 'mock.interior.blocks', marginTopMm: 0, marginBottomMm: 4 }] }]
  const jpeg = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#507090' } }).jpeg().toBuffer()
  const before = JSON.stringify(snapshot)
  let calls = 0
  const bytes = await buildWordReport(snapshot, { loadImage: async () => { calls++; return { data: jpeg, width: 400, height: 200, format: 'jpg' } } })
  const zip = await JSZip.loadAsync(bytes)
  const photo = Object.keys(zip.files).find(name => /^word\/media\/.+\.jpg$/.test(name))
  assert.ok(photo)
  assert.deepEqual(await zip.file(photo)!.async('nodebuffer'), jpeg)
  const contentTypes = xml2js(await zip.file('[Content_Types].xml')!.async('string'), { compact: true }) as {
    Types: { Default: { _attributes: { Extension: string; ContentType: string } }[] }
  }
  assert.ok(contentTypes.Types.Default.some(row => row._attributes.Extension === 'jpg' && row._attributes.ContentType === 'image/jpeg'))
  assert.equal(calls, 1)
  assert.equal(JSON.stringify(snapshot), before)
})
