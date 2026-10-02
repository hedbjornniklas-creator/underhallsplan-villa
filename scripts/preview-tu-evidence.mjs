import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/tu-evidence-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/tu-evidence-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const globalCss = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const css = `${globalCss.css}\nbody{margin:0;background:#f4f6f8;color:#25313b;font-family:Arial,sans-serif}`
const js = await readFile(resolve(output, 'view.js'))
const picture = await readFile('public/report-assets/BesiktApp.png')
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'")
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (path === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); return }
  if (path === '/fixture-image.png') { response.setHeader('Content-Type', 'image/png'); response.end(picture); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (path !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>TU testdata</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
const base = `http://127.0.0.1:${server.address().port}`
console.log(`TU evidence preview (synthetic only): ${base}`)
if (process.argv.includes('--test')) {
  try {
    const { testTuEvidence } = await import('../test/helpers/tu-evidence-browser.mjs')
    await testTuEvidence(base, output)
  } finally { server.close() }
}
