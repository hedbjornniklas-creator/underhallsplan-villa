import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/supplier-invoices-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/supplier-invoices-view.tsx'),
  output: { path: output, filename: 'view.js', publicPath: '/' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks/SupplierInvoiceEditor.tsx";\n@source "../components/tasks/SupplierInvoiceWorkspace.tsx";\n@source "../components/ui/ActionButton.tsx";\n@source "../components/ui/AppToastProvider.tsx";\n@source "../../test/fixtures/supplier-invoices-view.tsx";')
const globalCss = await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })
const css = `${globalCss.css}\n${await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')}\nbody{margin:0;background:#f4f6f6;color:#252a2d;font-family:'Uppdrag Manrope',Arial,sans-serif}`
await writeFile(resolve(output, 'invoice.pdf'), '%PDF-1.7\nSynthetic UI file upload fixture\n')
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'; base-uri 'none'")
  const url = new URL(request.url, 'http://127.0.0.1')
  if (request.method !== 'GET') { response.writeHead(405); response.end('Only synthetic browser-side changes are available'); return }
  if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(output, 'view.js'))); return }
  if (url.pathname === '/uppdrag/brand/manrope.ttf') { response.setHeader('Content-Type', 'font/ttf'); response.end(await readFile('public/uppdrag/brand/manrope.ttf')); return }
  if (url.pathname !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leverantörsfakturor · testdata</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Supplier invoice preview (synthetic only): ${base}`)
if (process.argv.includes('--test')) {
  try { const { testSupplierInvoices } = await import('../test/helpers/supplier-invoices-browser.mjs'); await testSupplierInvoices(base, output) }
  finally { await new Promise((ok) => server.close(ok)) }
}
