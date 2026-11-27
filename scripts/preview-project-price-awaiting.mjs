import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/project-price-awaiting-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/project-price-awaiting-view.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks/ActionCaseCustomerPricing.tsx";\n@source "../components/tasks/CustomerContractPricing.tsx";\n@source "../components/tasks/CustomerOfferPricingSummary.tsx";\n@source "../../test/fixtures/project-price-awaiting-view.tsx";')
const { css } = await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })
const theme = await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; img-src 'self' data:; base-uri 'none'")
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  if (path === '/view.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(await readFile(resolve(output, 'view.js'))); return }
  if (path === '/uppdrag/brand/manrope.ttf') { res.end(await readFile('public/uppdrag/brand/manrope.ttf')); return }
  if (path !== '/') { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pris inväntas · fiktivt test</title><style>${css}\n${theme}\nbody{margin:0;background:#fff;color:#252a2d;font-family:'Uppdrag Manrope',Arial,sans-serif}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
console.log(`Fiktiv testvy: http://127.0.0.1:${server.address().port}`)
