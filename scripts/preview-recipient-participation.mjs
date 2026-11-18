// Actual portal/dialogue components; fictional data and no external requests.
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/recipient-participation-ui')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/recipient-participation-view.tsx'), output: { path: output, filename: 'view.js' },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    'server-only': false,
    '@/lib/supabaseClient$': resolve('test/fixtures/gizmo-branding-runtime.tsx'), 'next/navigation': resolve('test/fixtures/gizmo-branding-runtime.tsx'),
    'next/link': resolve('test/helpers/preview-link.tsx'), 'next/image': resolve('test/fixtures/gizmo-branding-image.tsx'), '@': resolve('src'),
  } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";')
let css = (await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })).css
for (const file of ['uppdrag-theme.css', 'project-questions.css', 'gizmo-recipient-layout.css']) css += await readFile(`src/components/tasks/${file}`, 'utf8')
const bundle = await readFile(resolve(output, 'view.js'))
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  response.setHeader('Cache-Control', 'no-store')
  if (request.method !== 'GET') { response.writeHead(405); response.end(); return }
  if (path === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle); return }
  if (path === '/uppdrag/brand/symbol.svg') { response.setHeader('Content-Type', 'image/svg+xml'); response.end(await readFile('public/uppdrag/brand/symbol.svg')); return }
  if (path === '/uppdrag/brand/manrope.ttf') { response.setHeader('Content-Type', 'font/ttf'); response.end(await readFile('public/uppdrag/brand/manrope.ttf')); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gizmo - fiktivt deltagartest</title><style>${css}</style></head><body><div id="root"></div><output id="fixture-counter"></output><script src="/view.js"></script></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(`TEST_URL=http://127.0.0.1:${server.address().port}`))
