// Isolated UI QA: fictional users, mock API/auth, no Supabase calls or mail.
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'besiktapp-invitations-preview-'))
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/besiktapp-invitations.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient$': resolve('test/helpers/besikt-auth-preview.ts'),
    '@': resolve('src'), 'next/link$': resolve('test/helpers/preview-link.tsx'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const js = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const publicCss = await readFile('src/components/public/public.css', 'utf8')
const row = { id: 'f543b282-1bc6-401a-9f3c-ef4492187c62', email: 'person@example.test', full_name: 'Testperson',
  organization_id: null, organization_name: 'Exempelföretaget', modules: ['inspections'], status: 'pending',
  expires_at: new Date(Date.now() + 7 * 86400000).toISOString(), notification_state: 'accepted', revision: 0, created_at: new Date().toISOString() }
const rows = [row]
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (url.pathname.startsWith('/api/')) {
    response.setHeader('Content-Type', 'application/json')
    let body = ''; for await (const chunk of request) body += chunk
    const data = body ? JSON.parse(body) : {}
    if (url.pathname === '/api/admin/besiktapp-invitations') {
      if (request.method === 'GET') { response.end(JSON.stringify({ items: rows, total: rows.length, organizations: [] })); return }
      if (data.action === 'create') rows.unshift({ ...row, ...data, id: data.request_id })
      if (data.action === 'revoke') rows.find(item => item.id === data.id).status = 'revoked'
      response.end(JSON.stringify({ message: 'Simulerat: inbjudan sparad. Inget mejl har skickats.' })); return
    }
    if (data.token === 'b'.repeat(64)) { response.statusCode = 400; response.end(JSON.stringify({ error: 'Länken är ogiltig, återkallad eller har gått ut. Be om en ny inbjudan.' })); return }
    response.end(JSON.stringify(data.action === 'preview'
      ? { email: row.email, fullName: row.full_name, organization: row.organization_name, modules: row.modules, accepted: false }
      : { accepted: true, createdUser: Boolean(data.password), email: row.email })); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><title>BesiktApp – isolerad testvy</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${url.pathname.startsWith('/admin') ? '' : publicCss}</style></head><body class="public-site"><div style="padding:12px;background:#fff1b8">Lokal testvy. Fiktiva uppgifter. Inga konton skapas och inga mejl skickas.</div><div id="root"></div><script src="/view.js"></script></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}/admin-preview\nActivation: /besiktapp/aktivera#invite=${'a'.repeat(64)}\nExpired: use ${'b'.repeat(64)}`))
