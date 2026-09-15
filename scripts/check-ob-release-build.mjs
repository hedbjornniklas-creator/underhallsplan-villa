import assert from 'node:assert/strict'
import { cp, mkdir, readFile, writeFile, symlink } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { stagingEnvironment, validateStagingKeys } from './lib/ob-staging-app.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const folder = join(root, '.cache/ob-staging-app')
const keys = validateStagingKeys(JSON.parse(await readFile(join(folder, 'keys.json'), 'utf8')))
const app = join(folder, `release-build-${Date.now()}`)
await mkdir(app)
for (const file of ['src', 'public', 'package.json', 'tsconfig.json', 'postcss.config.mjs', 'next-env.d.ts']) {
  await cp(join(root, file), join(app, file), { recursive: true })
}
await symlink(join(root, 'node_modules'), join(app, 'node_modules'), 'junction')
await cp(join(root, 'next.config.ts'), join(app, 'next.base.ts'))
await writeFile(join(app, 'next.config.ts'), `import base from './next.base'
export default { ...base, images: { remotePatterns: [{ protocol: 'https', hostname: '${new URL(keys.url).hostname}', pathname: '/storage/v1/object/public/**' }] } }
`)
const env = { ...stagingEnvironment(process.env, keys, 57100), NODE_ENV: 'production' }
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, keys.url)
const startedAt = new Date().toISOString()
const child = spawn(process.execPath, [join(root, 'node_modules/next/dist/bin/next'), 'build', app, '--webpack'], {
  cwd: app, env, stdio: 'inherit', windowsHide: true,
})
child.on('error', error => { throw error })
const code = await new Promise(resolve => child.on('exit', resolve))
await writeFile(join(folder, 'release-build-latest.json'), JSON.stringify({ app, startedAt,
  completedAt: new Date().toISOString(), project: keys.url, exitCode: code, deployed: false }, null, 2))
process.exitCode = code ?? 1
