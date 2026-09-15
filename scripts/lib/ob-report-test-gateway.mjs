import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

export function allowReportTestPath(path, { linkId, token, imageUrls = [] }, search = '') {
  let decoded
  try { decoded = decodeURIComponent(path) } catch { return false }
  if (path === '/api/image-proxy') {
    const params = new URLSearchParams(search)
    return params.getAll('url').length === 1 && imageUrls.includes(params.get('url'))
      && [...params.keys()].every(key => ['url', 'max', 'q'].includes(key))
  }
  const staticAssets = ['/report-assets/footer-mark.png', '/report-assets/cover-illustration.svg',
    '/report-assets/sbr-logo.png', '/landing/Hushub_favicon.png', '/favicon.ico']
  return /^\/_next\/static\/[a-zA-Z0-9_./+()\[\]-]+$/.test(decoded) && !decoded.split('/').some(p => p === '..' || p === '.')
    || staticAssets.includes(path)
    || Boolean(linkId && path === '/internal/report-render/' + linkId)
    || Boolean(token && path === '/api/reports/public/' + token)
}

export async function startReportTestGateway({ root, output, target, identity }) {
  const binary = join(root, '.cache/ob-staging-app/bin/cloudflared-2026.9.1.exe')
  assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),
    '2837888cc0f5d58f15b6dc478376de90b4d3ba5241c7947455d1e0a0df429712')
  assert.match(target, /^http:\/\/127\.0\.0\.1:\d+$/)
  const expires = Date.now() + 15 * 60000, realFetch = globalThis.fetch
  let publicOrigin, tunnel
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://placeholder.invalid')
      if (!publicOrigin || request.headers.host !== new URL(publicOrigin).host || Date.now() >= expires
        || !['GET', 'HEAD'].includes(request.method) || !allowReportTestPath(url.pathname, identity(), url.search)) {
        response.writeHead(404).end(); return
      }
      const headers = { ...request.headers, host: new URL(target).host }
      delete headers.cookie; delete headers.authorization; delete headers.connection
      const upstream = await realFetch(target + url.pathname + url.search, {
        method: request.method, headers, redirect: 'manual', signal: AbortSignal.timeout(90000) })
      const outgoing = Object.fromEntries(upstream.headers)
      delete outgoing['content-encoding']; delete outgoing['content-length']; delete outgoing['transfer-encoding']; delete outgoing['set-cookie']
      response.writeHead(upstream.status, outgoing)
      response.end(Buffer.from(await upstream.arrayBuffer()))
    } catch { if (!response.headersSent) response.writeHead(502); response.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const close = async () => {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    if (tunnel && tunnel.exitCode === null) {
      const exited = new Promise(resolve => tunnel.once('exit', resolve))
      tunnel.kill(); await exited
    }
  }
  try {
    const home = join(output, 'tunnel-home'); await mkdir(home)
    const system = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(SystemRoot|WINDIR|COMSPEC|PATH|PATHEXT|TEMP|TMP)$/i.test(key)))
    tunnel = spawn(binary, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:' + server.address().port],
      { cwd: output, env: { ...system, USERPROFILE: home, HOME: home }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let text = '', spawnError
    const consume = chunk => {
      text = (text + chunk.toString()).slice(-16000)
      publicOrigin ??= text.match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+){2,}\.trycloudflare\.com/)?.[0]
    }
    tunnel.stdout.on('data', consume); tunnel.stderr.on('data', consume)
    tunnel.on('error', error => { spawnError = error })
    for (let attempt = 0; !publicOrigin; attempt++) {
      assert.ok(!spawnError && tunnel.exitCode === null && attempt < 90, 'Isolated report HTTPS entry failed to start')
      await delay(1000)
    }
    return { origin: publicOrigin, close }
  } catch (error) { await close(); throw error }
}
