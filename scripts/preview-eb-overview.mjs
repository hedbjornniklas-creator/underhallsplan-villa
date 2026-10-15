import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/eb-overview-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/eb-overview-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/helpers/eb-overview-client.ts'),
    'next/link': resolve('test/helpers/eb-overview-navigation.tsx'),
    'next/navigation': resolve('test/helpers/eb-overview-navigation.tsx'), '@': resolve('src'),
  } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const sourceCss = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', `@import "tailwindcss" source(none);
@source "../components/eb";
@source "../components/besiktapp/GettingStarted.tsx";
@source "../components/ui";
@source "../../test/fixtures/eb-overview-preview.tsx";`)
const globalCss = await postcss([tailwind()]).process(sourceCss, { from: resolve('src/app/globals.css') })
const additionalCss = await Promise.all([
  'src/components/ob/ob-overview.css', 'src/components/ob/ob-home.css', 'src/components/eb/eb-overview.css',
].map(path => readFile(path, 'utf8').catch(error => error.code === 'ENOENT' ? '' : Promise.reject(error))))
const css = `${globalCss.css}\n${additionalCss.join('\n')}\n
body{margin:0;background:#f4f6f8;color:#25313b;font-family:ObOverviewManrope,sans-serif}
.preview-notice{padding:6px 16px;background:#edf3fc;color:#245eb5;font-size:14px;text-align:center}
.preview-header{display:flex;align-items:center;justify-content:space-between;padding:18px 24px;border-bottom:1px solid #d4dce4;background:white;gap:16px}
.preview-header img{width:140px;height:auto}.preview-header span{font-size:14px;min-width:0;overflow-wrap:anywhere}
html[data-large-text]{font-size:200%}
`
const assets = new Map()
for (const [url, file, type] of [
  ['/view.js', resolve(output, 'view.js'), 'text/javascript'],
  ['/ob/brand/manrope.ttf', 'public/ob/brand/manrope.ttf', 'font/ttf'],
  ['/report-assets/BesiktApp.png', 'public/report-assets/BesiktApp.png', 'image/png'],
]) assets.set(url, { body: await readFile(file), type })
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'")
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  const asset = assets.get(path)
  if (asset) { response.setHeader('Content-Type', asset.type); response.end(asset.body); return }
  if (path !== '/' && path !== '/eb') { response.writeHead(404); response.end('Preview: link opens an existing workflow in the real app.'); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>EB-besiktningar · testdata</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`EB overview preview (synthetic only): ${base}/eb`)
if (process.argv.includes('--test')) {
  try {
    const { testEbOverview } = await import('../test/helpers/eb-overview-browser.mjs')
    await testEbOverview(base, output)
  } finally { server.close() }
}
