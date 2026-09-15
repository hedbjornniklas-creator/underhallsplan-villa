import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { productionOrigin, protectKey, unseal, seal, digest } from './lib/ob-private-backup.mjs'

// Bearer URL is supplied on stdin, never committed, logged or sent to a search service.
const root = fileURLToPath(new URL('../', import.meta.url))
const input = []
for await (const chunk of process.stdin) {
  input.push(chunk)
  assert.ok(Buffer.concat(input).length < 2048, 'Invalid report URL input')
}
let key
try {
  const url = new URL(Buffer.concat(input).toString().trim())
  assert.equal(url.origin, 'https://hushub.se')
  assert.ok(!url.search && !url.hash && !url.username && !url.password)
  const match = url.pathname.match(/^\/rapport\/([a-zA-Z0-9_-]{20,128})$/)
  assert.ok(match, 'Expected user-provided report URL')
  const token = match[1]
  const pointer = JSON.parse(await readFile(join(root, '.cache/ob-release/production-backup-latest.json')))
  const keyFolder = dirname(resolve(pointer.folder))
  assert.equal(dirname(keyFolder), resolve(homedir(), '.codex/backups/hushub-ob'))
  key = protectKey(await readFile(join(keyFolder, 'key.dpapi')), true)
  const manifest = JSON.parse(unseal(await readFile(join(pointer.folder, 'backup-manifest.gcm')), key))
  assert.equal(manifest.project, productionOrigin)
  const rowsBytes = unseal(await readFile(join(pointer.folder, 'rows.gcm')), key)
  assert.equal(digest(rowsBytes), manifest.rows.sha256)
  const reports = JSON.parse(rowsBytes)['public.inspection_report_links'].filter(r => r.token_hash === digest(token))
  assert.equal(reports.length, 1, 'Link must match exactly one backed-up report')
  const report = reports[0]
  assert.equal(report.revoked_at, null, 'Backed-up link is revoked')
  assert.equal(report.pdf_status, 'ready')
  const asset = manifest.assets.find(a => a.bucket === report.pdf_storage_bucket && a.path === report.pdf_storage_path)
  assert.ok(asset, 'Original stored PDF must exist in the verified backup')
  const get = target => fetch(target, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(90000) })
  const page = await get(url)
  assert.equal(page.status, 200, 'Public report page must load anonymously')
  assert.match(page.headers.get('content-type'), /text\/html/)
  await page.body.cancel()
  const download = await get(url.origin + '/api/reports/public/' + token + '?download=1')
  assert.equal(download.status, 302, 'Public API must return a signed original PDF URL')
  const location = new URL(download.headers.get('location'))
  assert.equal(location.origin, productionOrigin)
  assert.equal(decodeURIComponent(location.pathname), '/storage/v1/object/sign/' + asset.bucket + '/' + asset.path)
  await download.body?.cancel()
  const response = await get(location)
  assert.equal(response.status, 200, 'Original PDF download must succeed')
  assert.match(response.headers.get('content-type'), /application\/pdf/)
  assert.ok(Number(response.headers.get('content-length')) <= 100000000)
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.length > 0 && bytes.length <= 100000000)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.equal(digest(bytes), report.pdf_sha256, 'Downloaded PDF differs from original report hash')
  assert.equal(digest(bytes), asset.sha256, 'Downloaded PDF differs from backup hash')
  assert.deepEqual(bytes, unseal(await readFile(join(pointer.folder, 'blobs', asset.sha256 + '.gcm')), key))
  const python = process.argv[2]
  assert.ok(python, 'Supply the verified local Python runtime path')
  const parse = spawnSync(python, ['-c', `import sys, io, json
from pypdf import PdfReader
r = PdfReader(io.BytesIO(sys.stdin.buffer.read()), strict=True)
assert not r.is_encrypted and len(r.pages) > 0
text_pages = sum(bool((p.extract_text() or '').strip()) for p in r.pages)
assert text_pages == len(r.pages)
print(json.dumps({'pages':len(r.pages),'readableTextPages':text_pages}))`],
  { input: bytes, windowsHide: true, timeout: 60000, maxBuffer: 1000000 })
  assert.equal(parse.status, 0, 'PDF parser must open and read every page')
  const run = { checkedAt: new Date().toISOString(), anonymousPageStatus: page.status,
    signedRedirectStatus: download.status, pdfStatus: response.status, ...JSON.parse(parse.stdout.toString()),
    bytes: bytes.length, originalAndBackupMatch: true, productionWrites: false, regenerated: false }
  const receipt = Buffer.from(JSON.stringify({ ...run, reportId: report.id, sha256: asset.sha256 }))
  const receiptPath = join(pointer.folder, 'legacy-public-link-' + Date.now() + '.gcm')
  await writeFile(receiptPath, seal(receipt, key), { flag: 'wx' })
  assert.deepEqual(unseal(await readFile(receiptPath), key), receipt)
  await writeFile(join(root, '.cache/ob-release/legacy-report-latest.json'), JSON.stringify(run, null, 2))
  console.log(JSON.stringify(run))
} catch (error) {
  // Fetch/parser errors can include private URLs. Do not print their raw cause.
  console.error(error instanceof assert.AssertionError ? error.message.split('\n')[0] : 'Legacy report verification failed; inspect locally without disclosing bearer URLs')
  process.exitCode = 1
} finally { key?.fill(0) }
