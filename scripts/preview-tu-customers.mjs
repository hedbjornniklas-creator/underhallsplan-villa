import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/tu-customer-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/tu-customer-preview.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient': resolve('test/fixtures/ob-overview-client.ts'),
    'next/link': resolve('test/fixtures/tu-customer-navigation.tsx'),
    'next/navigation': resolve('test/fixtures/tu-customer-navigation.tsx'),
    '../ob/ob-overview.css': false, '../ob/ob-home.css': false, './tu-overview.css': false, '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const global = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const css = global.css + await readFile('src/components/ob/ob-overview.css', 'utf8') + await readFile('src/components/ob/ob-home.css', 'utf8') + await readFile('src/components/tu/tu-overview.css', 'utf8')
const js = await readFile(resolve(output, 'view.js'))
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; form-action 'none'")
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return }
  if (req.url === '/view.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(js); return }
  if (req.url === '/report-assets/BesiktApp.png' || req.url === '/ob/brand/manrope.ttf') {
    res.setHeader('Content-Type', req.url.endsWith('.png') ? 'image/png' : 'font/ttf'); res.end(await readFile('public' + req.url)); return
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>TU med testdata</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`TU customer preview (synthetic data only): ${base}/tu`)
if (process.argv.includes('--test')) {
  try { const { testTuCustomers } = await import('../test/helpers/tu-customer-browser.mjs'); await testTuCustomers(base, output) }
  finally { server.close() }
}
