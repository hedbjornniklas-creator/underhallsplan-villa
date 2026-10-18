import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/tu-appendix-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/tu-appendix-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const source = await readFile('src/app/globals.css', 'utf8')
const globalCss = await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })
// A second preview applies the actual print overrides without opening the system print dialog.
const printCss = globalCss.css.replace(/@media print/g, '@media all')
const bundle = await readFile(resolve(output, 'view.js'))
const footer = await readFile('public/report-assets/BesiktApp.png')
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; form-action 'none'")
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); return }
  if (url.pathname === '/report-assets/BesiktApp.png') { response.setHeader('Content-Type', 'image/png'); response.end(footer); return }
  if (url.pathname !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  const css = url.searchParams.has('print') ? printCss : globalCss.css
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>TU bildbilaga - testdata</title><style>${css} body{margin:0;background:#e5e7eb;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
console.log(`TU appendix preview (synthetic only): http://127.0.0.1:${server.address().port}/`)
