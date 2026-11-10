import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { syncPdfJsAssets } from '../scripts/sync-pdfjs-assets.mjs'

test('PDF assets are self-hosted, version-matched and repeatably generated for development and production', async () => {
  const require = createRequire(import.meta.url), root = dirname(require.resolve('pdfjs-dist/package.json'))
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')), app = JSON.parse(await readFile('package.json', 'utf8'))
  const target = await syncPdfJsAssets(); assert.equal(target, await syncPdfJsAssets())
  assert.equal(app.dependencies['pdfjs-dist'], pkg.version)
  assert.match(app.scripts.prebuild, /sync-pdfjs-assets/); assert.match(app.scripts.predev, /sync-pdfjs-assets/)
  assert.deepEqual(await readFile(resolve(target, 'pdf.worker.min.mjs')), await readFile(resolve(root, 'build/pdf.worker.min.mjs')))
  for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) assert.ok((await readdir(resolve(target, name))).length > 0)
  assert.match(await readFile(resolve(target, 'LICENSE'), 'utf8'), /Apache License/)
})

test('invoice previews do not depend on the native PDF plugin or upload before valid registration', async () => {
  const panel = await readFile('src/components/tasks/ProjectSupplierInvoices.tsx', 'utf8'), view = await readFile('src/components/tasks/SupplierInvoicePdfPreview.tsx', 'utf8')
  assert.ok(!panel.includes('<iframe'))
  assert.match(panel, /SupplierInvoicePdfPreview source=\{pendingFile \|\| original\}/)
  assert.match(panel, /Vald fil, inte uppladdad/); assert.match(panel, /Fakturauppgifter saknas/)
  assert.match(panel, /pendingFile && revision > 0 && !autosave.dirty && !autosave.busy/)
  assert.match(view, /source.arrayBuffer\(\)/); assert.match(view, /cache: 'no-store'/); assert.match(view, /signal: AbortSignal.any/)
  assert.match(view, /task\?\.destroy/); assert.match(view, /task\?\.cancel/); assert.match(view, /8_000_000/)
  assert.ok(!/https?:\/\//.test(view), 'No CDN or external document service')
})
