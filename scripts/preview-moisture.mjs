import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/moisture-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  entry: resolve('test/fixtures/moisture-preview.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    './moisture.css': false,
    'next/link': resolve('test/helpers/moisture-preview-link.tsx'),
    'next/image': resolve('test/helpers/moisture-preview-next.tsx'),
    'next/navigation': resolve('test/helpers/moisture-preview-next.tsx'),
    '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const globalCss = (await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })).css
const css = globalCss + '\n' + await readFile('src/components/moisture/moisture.css', 'utf8') +
  '\nbody{margin:0}.synthetic-banner{padding:8px 16px;background:#edf3fc;color:#245eb5;font:14px Arial;text-align:center}html[data-large-text]{font-size:200%}'
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
  if (path !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fuktsäkerhet · förhandsvisning</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const index = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(index < 0 ? 0 : Number(process.argv[index + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Fuktsäkerhet, syntetisk förhandsvisning: ${base}`)
if (process.argv.includes('--test')) {
  try { const { testMoisturePreview } = await import('../test/helpers/moisture-preview-browser.mjs'); await testMoisturePreview(base, output) }
  finally { server.close() }
}
