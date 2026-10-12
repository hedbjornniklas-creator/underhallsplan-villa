// Local visual QA only: real components, synthetic responses, no external traffic.
import { readFile, mkdtemp } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'organization-create-preview-'))
const mock = resolve('test/fixtures/organization-create-mocks.tsx')
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/organization-create-view.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { 'next/link$': mock, 'next/navigation$': mock, '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const script = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const server = createServer((request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; base-uri 'none'; form-action 'self'")
  response.setHeader('Content-Type', request.url === '/view.js' ? 'application/javascript' : 'text/html; charset=utf-8')
  const redirected = request.url.startsWith('/settings/organisation?orgId=')
  response.end(request.url === '/view.js' ? script : `<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Skapa organisation · lokal test</title><style>${css}</style></head><body class="bg-slate-50 p-4 md:p-8">${redirected ? '<h1>Test klart: rätt organisationsprofil öppnad</h1><p>Organisation 00000000-0000-4000-8000-000000000001. Ingen riktig data skapad.</p>' : '<div id="root"></div><script src="/view.js"></script>'}</body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
console.log(`Local organization-create preview: http://127.0.0.1:${server.address().port}/`)
console.log('Modes: ?mobile, ?duplicate, ?retry. All writes are synthetic; no network API allowed.')
