import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'

const root = process.cwd(), output = resolve('tmp/gizmo-navigation-next')
await mkdir(output, { recursive: true })
await cp(resolve('test/fixtures/gizmo-navigation-next'), output, { recursive: true })
await mkdir(resolve(output, 'public'), { recursive: true })
await cp(resolve('public/uppdrag/brand'), resolve(output, 'public/uppdrag/brand'), { recursive: true })
const options = { windowsHide: true, stdio: 'inherit', env: { ...process.env, GIZMO_NAV_REPO_ROOT: root, NEXT_TELEMETRY_DISABLED: '1' } }
if (!process.argv.includes('--skip-build')) await new Promise((resolveBuild, reject) => {
  const build = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'build', output, '--webpack'], options)
  build.on('error', reject)
  build.on('exit', code => code === 0 ? resolveBuild() : reject(Error(`Fixture build failed: ${code}`)))
})
const socket = createServer()
await new Promise(resolveListen => socket.listen(0, '127.0.0.1', resolveListen))
const port = socket.address().port
await new Promise(resolveClose => socket.close(resolveClose))
const server = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', output, '--hostname', '127.0.0.1', '--port', String(port)], options)
server.on('error', error => { console.error(error); process.exitCode = 1 })
server.on('exit', code => { process.exitCode = code ?? 1 })
console.log(`Synthetic navigation preview: http://127.0.0.1:${port}/uppdrag?view=projects`)
