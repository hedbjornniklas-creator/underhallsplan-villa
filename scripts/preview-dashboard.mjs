import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

// Bundles the real dashboard UI against synthetic records. No auth, database,
// customer data, messages or production writes are available in this preview.
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/dashboard-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/dashboard-view.tsx'),
  output: { path: output, filename: 'view.js', publicPath: '/' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/fixtures/ob-overview-client.ts'),
    'next/link': resolve('test/helpers/dashboard-navigation.tsx'),
    'next/navigation': resolve('test/helpers/dashboard-navigation.tsx'),
    '@': resolve('src'),
  } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.module\.css$/, use: resolve('test/helpers/dashboard-css-loader.mjs') },
    { test: /\.css$/, exclude: /\.module\.css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const globalSource = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";',
  '@import "tailwindcss" source(none);\n@source "./(dashboard)/dashboard-v1";\n@source "../components/dashboard";\n@source "../../test/fixtures/dashboard-view.tsx";')
const globalCss = await postcss([tailwind()]).process(globalSource, { from: resolve('src/app/globals.css') })
const css = `${globalCss.css}\n${await readFile('src/app/(dashboard)/dashboard-v1/dashboard.css', 'utf8')}\n${await readFile('node_modules/leaflet/dist/leaflet.css', 'utf8')}\n
body{margin:0;background:#f4f6f8;color:#25313b;font-family:DashboardManrope,Arial,sans-serif}
.preview-notice{padding:6px 16px;background:#edf3fc;color:#245eb5;font-size:12px;text-align:center}
.preview-header{display:flex;align-items:center;justify-content:space-between;padding:12px 30px;border-bottom:1px solid #dbe3ea;background:white;gap:16px}
.preview-header a{color:#0e4854;text-decoration:none;font-size:23px;font-weight:800}.preview-header span{font-size:13px;min-width:0;overflow-wrap:anywhere}
`
const assets = new Map()
for (const [url, file, type] of [
  ['/ob/brand/manrope.ttf', 'public/ob/brand/manrope.ttf', 'font/ttf'],
  ['/landing/BesiktApp.png', 'public/landing/BesiktApp.png', 'image/png'],
]) assets.set(url, { body: await readFile(file), type })
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://tile.openstreetmap.org https://*.tile.openstreetmap.org; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'")
  const url = new URL(request.url, 'http://127.0.0.1')
  if (request.method !== 'GET') { response.writeHead(405); response.end('Preview writes are disabled'); return }
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return }
  const asset = assets.get(url.pathname)
  if (asset) { response.setHeader('Content-Type', asset.type); response.end(asset.body); return }
  if (/^\/[\w.-]+\.js$/.test(url.pathname)) {
    try { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(output, url.pathname.slice(1)))); return }
    catch { response.writeHead(404); response.end(); return }
  }
  if (url.pathname !== '/' && url.pathname !== '/dashboard-v1') { response.writeHead(404); response.end('Synthetic preview only'); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>HusHub dashboard · testdata</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Dashboard preview (synthetic only): ${base}/dashboard-v1`)
if (process.argv.includes('--test')) {
  try { const { testDashboard } = await import('../test/helpers/dashboard-browser.mjs'); await testDashboard(base, output) }
  finally { await new Promise(ok => server.close(ok)) }
}
