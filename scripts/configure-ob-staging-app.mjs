import { createServer } from 'node:http'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { stagingUrl, validateStagingKeys } from './lib/ob-staging-app.mjs'

// One-time UI clipboard bridge. Key values are never printed or served back.
const root = fileURLToPath(new URL('../.cache/ob-staging-app/', import.meta.url))
await mkdir(root, { recursive: true })
const token = randomUUID()
let saved = false
const server = createServer(async (req, res) => {
  const origin = `http://127.0.0.1:${server.address().port}`
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'")
  res.setHeader('X-Content-Type-Options', 'nosniff')
  if (req.headers.host !== new URL(origin).host || req.url !== `/${token}` || saved) {
    res.writeHead(404); res.end(); return
  }
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end(`<!doctype html><title>OB staging configuration</title><h1>hushub-ob-test</h1><p>${stagingUrl}</p><form method="post" autocomplete="off"><p><label>Publishable key <input type="password" name="anonKey" autocomplete="off" required></label></p><p><label>Secret key <input type="password" name="serviceKey" autocomplete="off" required></label></p><button>Save staging configuration</button></form>`)
    return
  }
  if (req.method !== 'POST' || req.headers.origin !== origin) { res.writeHead(403); res.end(); return }
  try {
    let body = ''
    for await (const chunk of req) {
      body += chunk
      if (body.length > 4096) throw Error('Payload too large')
    }
    const form = new URLSearchParams(body)
    const keys = validateStagingKeys({ url: stagingUrl, anonKey: form.get('anonKey'), serviceKey: form.get('serviceKey') })
    await writeFile(`${root}/keys.json`, JSON.stringify(keys), { flag: 'wx', mode: 0o600 })
    saved = true
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.end('<!doctype html><title>Staging configured</title><h1>Configuration saved privately</h1>')
    console.log('Staging configuration saved. No key values logged.')
    server.close()
  } catch {
    res.writeHead(400); res.end('Configuration rejected; existing configuration is never overwritten.')
  }
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/${token}`))
