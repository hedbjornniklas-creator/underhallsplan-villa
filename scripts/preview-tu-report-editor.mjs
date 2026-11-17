// Real report editor and save queue, synthetic data only. No database or outbound requests.
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/tu-assignment-preview/report-editor')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false, entry: {
    view: resolve('test/fixtures/tu-report-editor-preview.tsx'),
    feedback: resolve('test/fixtures/ob-draft-feedback.tsx'),
  },
  output: { path: output, filename: '[name].js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    'next/navigation': resolve('test/fixtures/tu-assignment-preview-shims.tsx'),
    'next/link': resolve('test/fixtures/ob-overview-navigation.tsx'),
    '@/lib/supabaseClient': resolve('test/fixtures/ob-overview-client.ts'), '@': resolve('src'),
  } },
  module: { rules: [
    { test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') },
    { test: /\.css$/, type: 'asset/source' },
  ] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const script = await readFile(resolve(output, 'view.js'))
const feedback = await readFile(resolve(output, 'feedback.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const feedbackCss = await readFile('src/components/ob/mobile-round.css', 'utf8')
const font = await readFile('public/ob/brand/manrope.ttf')
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'")
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (path === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return }
  if (path === '/feedback.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(feedback); return }
  if (path === '/ob/brand/manrope.ttf') { response.setHeader('Content-Type', 'font/ttf'); response.end(font); return }
  if (path === '/test-image.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#bfe3cf"/><text x="40" y="80" font-size="30">Syntetisk testbild</text></svg>'); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>TU rapportredigering - lokalt test</title><style>${css}\n${path === '/draft-feedback' ? feedbackCss : ''} body{margin:0;font-family:Arial,sans-serif}</style></head><body><div id="root"></div><script src="/${path === '/draft-feedback' ? 'feedback' : 'view'}.js"></script></body></html>`)
})
const portIndex = process.argv.indexOf('--port')
await new Promise((ok, fail) => { server.once('error', fail); server.listen(portIndex < 0 ? 0 : Number(process.argv[portIndex + 1]), '127.0.0.1', ok) })
console.log(`TU report editor: http://127.0.0.1:${server.address().port}/`)
if (process.argv.includes('--test')) {
  try {
    const { testTuReportEditor } = await import('../test/helpers/tu-report-editor-browser.mjs')
    await testTuReportEditor(`http://127.0.0.1:${server.address().port}`, output)
  } finally { server.close() }
}
