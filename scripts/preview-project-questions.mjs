// Real question components, fictional local data, no database or email.
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/project-question-stability-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/project-question-stability.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    './project-questions.css': false, './uppdrag-theme.css': false,
    '@/lib/supabaseClient$': resolve('test/helpers/project-supabase-stub.ts'), '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString('errors-only'))) : ok()))
const cssSource = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";')
const globalCss = (await postcss([tailwind()]).process(cssSource, { from: resolve('src/app/globals.css') })).css
const css = globalCss + '\n' + await readFile('src/components/tasks/uppdrag-theme.css', 'utf8') + '\n' + await readFile('src/components/tasks/project-questions.css', 'utf8') +
  '\nbody{margin:0}.fixture-workspace{max-width:1280px;margin:auto;padding:24px}.fixture-controls{position:fixed;z-index:100;left:8px;top:8px;max-width:260px;background:white;border:1px solid #d5dcdd;padding:8px;font:12px Arial}.fixture-controls button{border:1px solid #d5dcdd;padding:6px;margin:3px}.fixture-controls summary{cursor:pointer}.fixture-controls:has(details:not([open])){max-width:160px}'
const assets = new Map([
  ['/view.js', { body: await readFile(resolve(output, 'view.js')), type: 'text/javascript' }],
  ['/uppdrag/brand/manrope.ttf', { body: await readFile('public/uppdrag/brand/manrope.ttf'), type: 'font/ttf' }],
])
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'none'; form-action 'none'; base-uri 'none'")
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  const asset = assets.get(path)
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (asset) { response.setHeader('Content-Type', asset.type); response.end(asset.body); return }
  if (path !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fragor och beslut - fiktivt funktionstest</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const portFlag = process.argv.indexOf('--port')
await new Promise(ok => server.listen(portFlag < 0 ? 0 : Number(process.argv[portFlag + 1]), '127.0.0.1', ok))
console.log(`Question stability preview: http://127.0.0.1:${server.address().port}/`)
