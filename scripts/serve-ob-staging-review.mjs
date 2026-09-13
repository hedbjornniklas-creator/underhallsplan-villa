import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { digest, STAGING_PROJECT } from './lib/ob-staging-schema.mjs'

// Temporary loopback-only transport of reviewed SQL to the browser's SQL editor.
const version = process.argv[2]
if (!/^staging-schema-v[1-9][0-9]*$/.test(version ?? '')) throw new Error('Explicit reviewed bundle version required')
const folder = fileURLToPath(new URL(`../.cache/inspection-schema-export/${version}/`, import.meta.url))
const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'))
if (manifest.targetProject !== STAGING_PROJECT) throw new Error('Wrong target')
const files = new Map()
function include(file, expectedHash) {
  const sql = readFileSync(join(folder, file), 'utf8')
  if (digest(sql) !== expectedHash) throw new Error(`Changed bundle file: ${file}`)
  files.set(file, sql)
}
include('00-bootstrap.sql', manifest.bootstrapSha256)
for (const p of manifest.parts) include(`${String(p.ordinal).padStart(2, '0')}-schema.sql`, p.sha256)
for (const p of manifest.buildingMigrations) include(p.file, p.sha256)
include(manifest.smoke.file, manifest.smoke.sha256)
const token = randomUUID()
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const server = createServer((req, res) => {
  const port = server.address().port
  const file = req.url?.startsWith(`/${token}/`) ? req.url.slice(token.length + 2) : null
  if (req.method !== 'GET' || req.headers.host !== `127.0.0.1:${port}` || !files.has(file)) {
    res.writeHead(404); res.end(); return
  }
  const sql = files.get(file)
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' })
  const links = [...files.keys()].map(name => `<a href="/${token}/${name}">${name}</a>`).join(' ')
  res.end(`<!doctype html><html><head><meta charset="utf-8"><title>Reviewed staging SQL</title></head><body><nav>${links}</nav><h1>${escape(file)}</h1><p>${STAGING_PROJECT}</p><pre id="sql">${escape(sql)}</pre></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ baseUrl: `http://127.0.0.1:${server.address().port}/${token}/`, files: [...files.keys()] })))
process.on('SIGINT', () => server.close(() => process.exit(0)))
