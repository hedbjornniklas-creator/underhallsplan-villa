// Real Gizmo components with fictional, loopback-only requests. No live data or mail.
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import sharp from 'sharp'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/diary-image-library-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/diary-image-library.tsx'), output: { path: output, filename: 'view.js' }, plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })], resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@/lib/supabaseClient$': resolve('test/helpers/project-supabase-stub.ts'), 'next/image$': resolve('test/fixtures/diary-image-library-next-image.tsx'), '@': resolve('src') } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] } }, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const globals = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../../test/fixtures/diary-image-library.tsx";')
const css = (await postcss([tailwind()]).process(globals, { from: resolve('src/app/globals.css') })).css + await readFile('src/components/tasks/uppdrag-theme.css', 'utf8') + await readFile('src/components/tasks/project-questions.css', 'utf8')
const js = await readFile(resolve(output, 'view.js'))
const images = await Promise.all(['renovering-editorial-v2.png', 'besiktning-editorial-v2.png'].map(name => sharp(resolve('public/landing', name)).resize(700, 500, { fit: 'cover' }).jpeg().toBuffer()))
const font = await readFile('public/uppdrag/brand/manrope.ttf')
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1')
  res.setHeader('Cache-Control', 'no-store')
  if (url.pathname === '/view.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js) }
  if (url.pathname === '/uppdrag/brand/manrope.ttf') { res.setHeader('Content-Type', 'font/ttf'); return res.end(font) }
  if (url.pathname.startsWith('/api/action-cases/')) { res.setHeader('Content-Type', 'image/jpeg'); return res.end(images[Number(url.pathname.at(-1)) % 2]) }
  if (url.pathname !== '/') { res.writeHead(404); return res.end() }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dagboksbilder - fiktivt test</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
const flag = process.argv.indexOf('--port')
await new Promise(ok => server.listen(flag >= 0 ? Number(process.argv[flag + 1]) : 0, '127.0.0.1', ok))
console.log(`Diary image library preview: http://127.0.0.1:${server.address().port}/`)
