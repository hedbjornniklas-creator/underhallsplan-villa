import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/ob-environmental-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/ob-environmental-preview.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    './ob-environmental.css': false, './mobile-round.css': false,
    '@/content/standardtexts/loadStandardText': resolve('test/fixtures/report-preview-texts.ts'),
    '@/lib/report/loadAppendixText': resolve('test/fixtures/report-preview-texts.ts'), '@': resolve('src'),
  } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const globalCss = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css
let css = globalCss
for (const name of ['mobile-round.css', 'inspection-layout.css', 'ob-forms.css', 'ob-environmental.css']) css += '\n' + (await readFile(`src/components/ob/${name}`, 'utf8')).replace(/^@import.*$/gm, '')
css += '\nbody{margin:0;background:#f4f6f8;color:#25313b;font-family:var(--obm-font)}.preview-banner{padding:6px 16px;background:#edf3fc;color:#245eb5;font-size:14px;text-align:center}.preview-heading{display:flex;align-items:center;justify-content:space-between;padding:16px 24px;gap:12px;flex-wrap:wrap;background:white;border-bottom:1px solid #d4dce4}.preview-heading img{width:140px;height:auto}.preview-heading button{padding:12px;color:#445eb5}.preview-heading button[aria-pressed=true]{border-bottom:2px solid #445eb5}.preview-form{max-width:1100px;margin:24px auto;background:white;padding:20px}.preview-heading nav{display:flex;flex-wrap:wrap}html[data-large-text]{font-size:200%}@media(max-width:639px){.preview-form{padding:16px;margin:0}}'
const assets = new Map()
for (const [url, file, type] of [
  ['/view.js', resolve(output, 'view.js'), 'text/javascript'],
  ['/ob/brand/manrope.ttf', 'public/ob/brand/manrope.ttf', 'font/ttf'],
  ['/report-assets/BesiktApp.png', 'public/report-assets/BesiktApp.png', 'image/png'],
  ['/report-assets/footer-mark.png', 'public/report-assets/footer-mark.png', 'image/png'],
]) assets.set(url, { body: await readFile(file), type })
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'")
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  const asset = assets.get(path)
  if (asset) { response.setHeader('Content-Type', asset.type); response.end(asset.body); return }
  if (path !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>ÖB tilläggsuppdrag · testuppgifter</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Synthetic environmental protocols: ${base}`)
if (process.argv.includes('--test')) {
  try { const { testEnvironmental } = await import('../test/helpers/ob-environmental-browser.mjs'); await testEnvironmental(base, output) }
  finally { server.close() }
}
