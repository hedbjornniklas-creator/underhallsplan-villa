import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'

// Integration check: run explicitly after `npm run build`. Read only trace
// manifests and filesystem metadata, never source files or browser profiles.
const repoRoot = process.cwd()
const serverRoot = join(repoRoot, '.next/server')
const normalize = (path: string) => {
  const absolute = resolve(path.replace(/[\\/]/g, sep))
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}
const repoRelative = (path: string) => relative(normalize(repoRoot), normalize(path)).replace(/\\/g, '/')

function filesUnder(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : []
  })
}

function requireBuild() {
  assert.ok(existsSync(serverRoot) && statSync(serverRoot).isDirectory(),
    'Missing .next/server; run npm run build before this integration test')
}

function tracedFiles(manifest: string): string[] {
  assert.ok(existsSync(manifest), `Missing build trace: ${repoRelative(manifest)}`)
  const trace: unknown = JSON.parse(readFileSync(manifest, 'utf8'))
  assert.ok(trace && typeof trace === 'object' && 'files' in trace && Array.isArray(trace.files),
    `Invalid build trace: ${repoRelative(manifest)}`)
  return trace.files.map((file: unknown) => {
    assert.equal(typeof file, 'string')
    return normalize(resolve(dirname(manifest), (file as string).replace(/[\\/]/g, sep)))
  })
}

test('production traces exclude repository scratch, output, documentation, test and script files', () => {
  requireBuild()
  const manifests = filesUnder(serverRoot).filter(path => path.endsWith('.nft.json'))
  assert.ok(manifests.length > 0, 'The build produced no server trace manifests')
  const contaminated: string[] = []
  for (const manifest of manifests) {
    const forbidden = tracedFiles(manifest).find(path => /^(tmp|output|docs|test|scripts)(\/|$)/i.test(repoRelative(path)))
    if (forbidden) contaminated.push(`${repoRelative(manifest)} -> ${repoRelative(forbidden)}`)
  }
  assert.equal(contaminated.length, 0,
    `Found unrelated repository artifacts in ${contaminated.length} server traces. Examples:\n${contaminated.slice(0, 5).join('\n')}`)
})

test('report consumers retain existing files, all standard texts and the PDF worker Chromium assets', () => {
  requireBuild()
  const reportTrace = join(serverRoot, 'app/api/report-v2/[inspectionId]/pdf/route.js.nft.json')
  const workerTrace = join(serverRoot, 'app/api/cron/reports/pdf/route.js.nft.json')
  const reportFiles = new Set(tracedFiles(reportTrace))
  const workerFiles = new Set(tracedFiles(workerTrace))
  for (const [manifest, files] of [[reportTrace, reportFiles], [workerTrace, workerFiles]] as const) {
    assert.ok(files.size > 0, `Empty consumer trace: ${repoRelative(manifest)}`)
    const missing = [...files].filter(path => !existsSync(path))
    assert.equal(missing.length, 0,
      `${repoRelative(manifest)} references missing files:\n${missing.slice(0, 5).map(repoRelative).join('\n')}`)
  }
  const texts = filesUnder(join(repoRoot, 'src/content/standardtexts')).filter(path => path.endsWith('.txt'))
  assert.ok(texts.length > 0, 'No standard-text assets were found')
  for (const text of texts) {
    assert.ok(reportFiles.has(normalize(text)), `Report trace omits standard text: ${repoRelative(text)}`)
  }
  const chromiumRoot = join(repoRoot, 'node_modules/@sparticuz/chromium/bin')
  const chromiumAssets = filesUnder(chromiumRoot).filter(path => path.endsWith('.br'))
  assert.equal(chromiumAssets.length, 4, 'Expected all four installed Chromium compressed assets')
  for (const asset of chromiumAssets) {
    assert.ok(statSync(asset).size > 0, `Empty Chromium asset: ${repoRelative(asset)}`)
    assert.ok(workerFiles.has(normalize(asset)), `PDF worker trace omits Chromium asset: ${repoRelative(asset)}`)
  }
})
