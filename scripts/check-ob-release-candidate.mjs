import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, writeFile, symlink, open } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stagingEnvironment, validateStagingKeys } from './lib/ob-staging-app.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const scope = JSON.parse(await readFile(new URL('./release/ob-2026-09-14.json', import.meta.url)))
const keys = validateStagingKeys(JSON.parse(await readFile(join(root, '.cache/ob-staging-app/keys.json'))))
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
assert.equal(git(['rev-parse', 'origin/main']), scope.base, 'Main changed; review and re-pin the release scope')
assert.equal(scope.status, 'verification-only')
assert.equal(new Set(scope.files).size, scope.files.length)
for (const file of scope.files) {
  assert.ok(file.startsWith('src/') && !file.includes('..') && !file.includes('\\') && !file.includes('/renoapp/'), 'Only explicitly reviewed application files')
}
const output = join(root, '.cache/ob-release', `candidate-${Date.now()}`), app = join(output, 'app')
await mkdir(app, { recursive: true })
assert.equal(dirname(resolve(output)), resolve(root, '.cache/ob-release'))
const archive = join(output, 'baseline.tar')
git(['archive', '--format=tar', '--output', archive, scope.base])
execFileSync('tar', ['-xf', archive, '-C', app])
assert.ok((await readdir(app)).every(name => !name.startsWith('.env') || name.endsWith('.example')), 'Tracked environment file requires review')
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const manifest = { base: scope.base, head: git(['rev-parse', 'HEAD']), project: keys.url, app,
  createdAt: new Date().toISOString(), files: [], excluded: [], source: [], testsExitCode: null, buildExitCode: null,
  status: 'checking', productionApproved: false }
for (const file of scope.files) {
  const bytes = await readFile(join(root, file))
  await mkdir(dirname(join(app, file)), { recursive: true })
  await writeFile(join(app, file), bytes)
  manifest.files.push({ path: file, sha256: hash(bytes) })
}
const changed = [...new Set([...git(['diff', '--name-only', scope.base]).split('\n'),
  ...git(['ls-files', '--others', '--exclude-standard']).split('\n')])].filter(Boolean)
manifest.excluded = changed.filter(file => !scope.files.includes(file))
async function inventory(base, prefix = '') {
  const rows = []
  for (const entry of await readdir(join(base, prefix), { withFileTypes: true })) {
    const file = join(prefix, entry.name)
    if (entry.isDirectory()) rows.push(...await inventory(base, file))
    else { assert.ok(entry.isFile()); rows.push({ path: file.replaceAll('\\', '/'), sha256: hash(await readFile(join(base, file))) }) }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path))
}
manifest.source = await inventory(join(app, 'src'))
manifest.sourceSha256 = hash(JSON.stringify(manifest.source))
await writeFile(join(output, 'application-scope.json'), JSON.stringify(manifest, null, 2))
// These directories are verification support, not additional application changes.
for (const folder of ['test', 'docs', 'scripts']) await cp(join(root, folder), join(app, folder), {
  recursive: true,
  filter: source => !relative(root, source).toLowerCase().includes('renoapp'),
})
await symlink(join(root, 'node_modules'), join(app, 'node_modules'), 'junction')
await cp(join(app, 'next.config.ts'), join(app, 'next.base.ts'))
await writeFile(join(app, 'next.config.ts'), `import base from './next.base'
export default { ...base, images: { remotePatterns: [{ protocol: 'https', hostname: '${new URL(keys.url).hostname}', pathname: '/storage/v1/object/public/**' }] } }
`)
const env = { ...stagingEnvironment(process.env, keys, 57100), NODE_ENV: 'production' }
async function command(args, name) {
  const log = await open(join(output, name + '.log'), 'wx')
  const child = spawn(process.execPath, args, { cwd: app, env, stdio: ['ignore', log.fd, log.fd], windowsHide: true })
  try { return await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) }) }
  finally { await log.close() }
}
try {
  console.log(`Checking ${manifest.files.length} application changes on ${scope.base.slice(0, 7)}. Evidence: ${output}`)
  manifest.testsExitCode = await command(['--experimental-strip-types', '--test', '--test-concurrency=2', ...scope.tests], 'regression')
  assert.equal(manifest.testsExitCode, 0, 'Candidate regression failed; inspect regression.log')
  console.log('Candidate regression passed; building the isolated application.')
  manifest.buildExitCode = await command([join(root, 'node_modules/next/dist/bin/next'), 'build', app, '--webpack'], 'build')
  assert.equal(manifest.buildExitCode, 0, 'Candidate build failed; inspect build.log')
  assert.deepEqual(await inventory(join(app, 'src')), manifest.source, 'Candidate changed during verification')
  for (const file of manifest.files) assert.equal(hash(await readFile(join(root, file.path))), file.sha256, `Workspace changed: ${file.path}`)
  manifest.status = 'local-checks-passed'
} catch (error) { manifest.status = 'failed'; manifest.error = error.message; process.exitCode = 1 }
manifest.completedAt = new Date().toISOString()
await writeFile(join(output, 'application-scope.json'), JSON.stringify(manifest, null, 2))
await writeFile(join(root, '.cache/ob-release/candidate-latest.json'), JSON.stringify({ ...manifest, output }, null, 2))
console.log(JSON.stringify({ status: manifest.status, files: manifest.files.length, sourceSha256: manifest.sourceSha256,
  testsExitCode: manifest.testsExitCode, buildExitCode: manifest.buildExitCode, evidence: relative(root, output), error: manifest.error }))
