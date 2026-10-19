import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// Renders the actual recovery component with a synthetic local authentication
// SDK. This process serves GETs only and never connects to Supabase.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/session-recovery-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/session-recovery-view.tsx'),
  output: { path: output, filename: 'view.js', publicPath: '/' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/fixtures/session-recovery-client.ts'),
    '@/components/auth/PasswordAuthPanel': resolve('test/fixtures/session-recovery-password-panel.tsx'),
    './PublicFrame': resolve('test/fixtures/session-recovery-frame.tsx'),
    'next/link': resolve('test/helpers/session-recovery-navigation.tsx'),
    'next/navigation': resolve('test/helpers/session-recovery-navigation.tsx'),
    '@': resolve('src'),
  } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.module\.css$/, use: resolve('test/helpers/dashboard-css-loader.mjs') },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'")
  const url = new URL(request.url, 'http://127.0.0.1')
  if (request.method !== 'GET') { response.writeHead(405); response.end('Synthetic preview writes are disabled'); return }
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(output, 'view.js'))); return }
  const fixed = ['/', '/dashboard-v1', '/app', '/auth/session-unavailable', '/login', '/renoapp/login', '/mina-uppdrag/logga-in', '/mina-uppdrag']
  const modulePath = /^\/(?:ob|eb|tu|fuktsakerhet|uppdrag|properties|inspections|settings|admin)(?:\/[A-Za-z0-9_-]+)*$/.test(url.pathname)
  const renoPath = /^\/renoapp\/(?:app(?:\/[A-Za-z0-9_-]+)*|review\/[0-9a-f-]{36})$/i.test(url.pathname)
  const recipientPath = /^\/mina-uppdrag\/uppdrag\/[0-9a-f-]{36}$/i.test(url.pathname)
  if (!fixed.includes(url.pathname) && !modulePath && !renoPath && !recipientPath) { response.writeHead(404); response.end('Synthetic preview only'); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end('<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>HusHub · åtkomst · testvy</title><style>html{box-sizing:border-box}*,*::before,*::after{box-sizing:inherit}body{margin:0;font-family:Arial,sans-serif;color:#25313b;background:#f4f6f8}button,a{font:inherit}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>')
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Session recovery preview (synthetic only): ${base}/dashboard-v1`)
if (process.argv.includes('--test')) {
  try { const { testSessionRecovery } = await import('../test/helpers/session-recovery-browser.mjs'); await testSessionRecovery(base, output) }
  finally { await new Promise(ok => server.close(ok)) }
}
