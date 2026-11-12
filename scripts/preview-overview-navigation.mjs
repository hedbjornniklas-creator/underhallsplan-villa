// Loopback-only preview of the real overview, using fictional reads and no database.
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/overview-navigation-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/overview-navigation.tsx'), output: { path: output, filename: 'view.js' }, plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })], resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] } }, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const globals = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../../test/fixtures/overview-navigation.tsx";')
const css = (await postcss([tailwind()]).process(globals, { from: resolve('src/app/globals.css') })).css + await readFile('src/components/tasks/uppdrag-theme.css', 'utf8') + await readFile('src/components/tasks/project-overview.css', 'utf8') + await readFile('src/components/tasks/project-completion.css', 'utf8')
const js = await readFile(resolve(output, 'view.js')), font = await readFile('public/uppdrag/brand/manrope.ttf')
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://127.0.0.1').pathname
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'none'; form-action 'none'; base-uri 'none'")
  if (req.method !== 'GET') { res.writeHead(405); return res.end() }
  if (path === '/view.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js) }
  if (path === '/uppdrag/brand/manrope.ttf') { res.setHeader('Content-Type', 'font/ttf'); return res.end(font) }
  if (path !== '/') { res.writeHead(404); return res.end() }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gizmo navigering - fiktivt test</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(ok => server.listen(0, '127.0.0.1', ok))
console.log(`Overview navigation preview: http://127.0.0.1:${server.address().port}/`)
