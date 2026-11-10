import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve, extname, sep } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import sharp from 'sharp'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { syncPdfJsAssets } from './sync-pdfjs-assets.mjs'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack'), output = resolve('tmp/project-supplier-preview')
await mkdir(output, { recursive: true })
await syncPdfJsAssets()
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/project-supplier-invoices-view.tsx'), output: { path: output, filename: 'view.js', publicPath: '/' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] } }, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks/ProjectSupplierInvoices.tsx";\n@source "../components/tasks/ProjectInvoiceBasis.tsx";\n@source "../../test/fixtures/project-supplier-invoices-view.tsx";')
const globalCss = await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })
let css = globalCss.css
for (const file of ['uppdrag-theme.css', 'project-supplier-invoices.css', 'supplier-invoice-pdf-preview.css', 'project-completion.css']) css += `\n${await readFile(`src/components/tasks/${file}`, 'utf8')}`
css += "\nbody{margin:0;background:#fff;color:#252a2d;font-family:'Uppdrag Manrope',Arial,sans-serif}"
const original = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><rect width="600" height="800" fill="white"/><g fill="#252A2D" font-family="Arial"><text x="40" y="70" font-size="28">FAKTURA · FIKTIVT TEST</text><text x="40" y="120" font-size="18">Testleverantör AB</text><text x="40" y="160" font-size="18">Fakturanummer F-123</text><text x="40" y="260" font-size="18">Material enligt beställning</text><text x="40" y="340" font-size="18">Exkl. moms: 10 000,00 kr</text><text x="40" y="380" font-size="18">Moms: 2 500,00 kr</text><text x="40" y="430" font-size="22">Totalt: 12 500,00 kr</text></g></svg>')).png().toBuffer()
const pdf = await PDFDocument.create(), font = await pdf.embedFont(StandardFonts.Helvetica), scanned = await pdf.embedJpg(await sharp(original).jpeg().toBuffer())
for (const title of ['FIKTIV FAKTURA F-301', 'SPECIFIKATION SIDA 2']) {
  const page = pdf.addPage([595, 842])
  page.drawRectangle({ x: 35, y: 750, width: 525, height: 40, color: rgb(.88, .93, .92) })
  page.drawText(title, { x: 45, y: 764, size: 22, font })
  page.drawText('Testleverantor AB - endast fiktiva uppgifter', { x: 45, y: 710, size: 13, font })
  page.drawText('Material 10 000 kr. Moms 2 500 kr. Totalt 12 500 kr.', { x: 45, y: 650, size: 13, font })
  if (title === 'SPECIFIKATION SIDA 2') page.drawImage(scanned, { x: 45, y: 80, width: 300, height: 400 })
}
const originalPdf = Buffer.from(await pdf.save())
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' blob:; connect-src 'self'; img-src 'self' blob: data:; frame-src 'self' blob:; base-uri 'none'")
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path === '/preview-invoice-basis-pdf' && req.method === 'POST') {
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 150000) throw Error('Too large') }
      const record = JSON.parse(raw), { normalizeInvoiceBasis } = await import('../src/lib/action-cases/projectCompletion.ts'), { renderInvoiceBasisPdf } = await import('../src/lib/action-cases/invoiceBasisPdf.ts')
      const bytes = await renderInvoiceBasisPdf({ ...record, body: normalizeInvoiceBasis(record.body) }, 'Fiktivt testprojekt')
      res.setHeader('Content-Type', 'application/pdf'); res.end(bytes)
    } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Det fiktiva PDF-underlaget är inte komplett.' })) }
    return
  }
  if (/^\/[a-zA-Z0-9_.-]+\.js$/.test(path)) {
    try { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(resolve(output, path.slice(1)))) }
    catch { res.writeHead(404); res.end() }
    return
  }
  if (path.startsWith('/vendor/pdfjs/')) {
    const root = resolve('public/vendor/pdfjs'), file = resolve('public', '.' + decodeURIComponent(path))
    if (!file.startsWith(root + sep)) { res.writeHead(404); res.end(); return }
    try { const bytes = await readFile(file); res.setHeader('Content-Type', extname(file) === '.mjs' ? 'text/javascript' : extname(file) === '.wasm' ? 'application/wasm' : 'application/octet-stream'); res.end(bytes) }
    catch { res.writeHead(404); res.end() }
    return
  }
  if (path === '/original.pdf') { res.setHeader('Content-Type', 'application/pdf'); res.end(originalPdf); return }
  if (path === '/uppdrag/brand/manrope.ttf') { res.end(await readFile('public/uppdrag/brand/manrope.ttf')); return }
  if (path.startsWith('/api/supplier-invoices/') || path === '/original.png') { res.setHeader('Content-Type', 'image/png'); res.end(original); return }
  if (path === '/favicon.ico') { res.writeHead(204); res.end(); return }
  if (path !== '/') { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leverantörsfakturor · fiktivt test</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Fiktiv testvy: ${base}`)
if (process.argv.includes('--test')) {
  try { const { testProjectSupplierInvoices } = await import('../test/helpers/project-supplier-invoices-browser.mjs'); await testProjectSupplierInvoices(base, output, original) }
  finally { await new Promise(ok => server.close(ok)) }
}
if (process.argv.includes('--test-pdf')) {
  try { const { testSupplierPdfPreview } = await import('../test/helpers/supplier-pdf-preview-browser.mjs'); await testSupplierPdfPreview(base, output, originalPdf) }
  finally { await new Promise(ok => server.close(ok)) }
}
