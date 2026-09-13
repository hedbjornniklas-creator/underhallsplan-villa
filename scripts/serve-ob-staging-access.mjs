import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { digest, STAGING_PROJECT, REVIEW_SHA256 } from './lib/ob-staging-schema.mjs'

const files = new Map()
const guard = `DO $staging$ BEGIN
IF NOT EXISTS (SELECT 1 FROM ob_staging_control.installation WHERE singleton AND ready AND building_phase=4
AND project_ref='${STAGING_PROJECT}' AND source_sha256='${REVIEW_SHA256}') THEN RAISE EXCEPTION 'VERIFIED_STAGING_REQUIRED'; END IF;
END $staging$;
SET LOCAL app.inspection_access_hardening_approved='true';`
for (const name of ['2026-09-12_09_inspection_access_hardening.sql','2026-09-12_10_inspection_rpc_media_hardening.sql']) {
  const source = readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
  if ((source.match(/^begin;/gmi) ?? []).length !== 1) throw Error('Unexpected transaction')
  files.set(name, source.replace(/^begin;/mi, `BEGIN;\n${guard}`))
}
files.set('ob-staging-app-access.sql', readFileSync(new URL('./sql/ob-staging-app-access.sql', import.meta.url), 'utf8'))
const token = randomUUID()
const escape = value => value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
const server = createServer((req,res) => {
  const file = req.url?.startsWith(`/${token}/`) ? req.url.slice(token.length+2) : null
  if(req.method !== 'GET' || req.headers.host !== `127.0.0.1:${server.address().port}` || !files.has(file)) {res.writeHead(404);res.end();return}
  res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"})
  res.end(`<!doctype html><title>OB staging access rehearsal</title><h1>${file}</h1><p>${STAGING_PROJECT}</p><pre>${escape(files.get(file))}</pre>`)
})
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({baseUrl:`http://127.0.0.1:${server.address().port}/${token}/`,files:[...files].map(([name,sql])=>({name,sha256:digest(sql)}))})))
process.on('SIGINT',()=>server.close(()=>process.exit(0)))
