// Real UI with synthetic in-browser requests only. No database or real email.
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'contract-sender-preview-'))
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/customer-contract-sender-profile-view.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const script = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'self'")
  response.setHeader('Content-Type', request.url === '/view.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  response.end(request.url === '/view.js' ? script : `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Avtalets avsändarprofil · lokalt test</title><style>${css}</style></head><body class="bg-slate-50 p-4 md:p-8"><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
console.log(`Contract sender profile preview: http://127.0.0.1:${server.address().port}/`)
console.log('Modes: ?mobile, ?retry, ?selected, ?dirty, ?locked, ?migration. No real data or API requests.')
