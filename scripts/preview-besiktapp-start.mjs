// Isolated UI preview; mock profile reads and no write APIs.
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'besiktapp-start-preview-'))
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/besiktapp-start.tsx'), output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient$': resolve('test/helpers/besikt-start-preview.ts'),
    '@': resolve('src'), 'next/link$': resolve('test/helpers/preview-link.tsx'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const js = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const server = createServer((request, response) => {
  if (request.url === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><title>BesiktApp – test av startguide</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#f8fafc"><div id="root"></div><script src="/view.js"></script></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}/?module=ob\nOptions: module=eb|tu, scenario=complete|error, user=another, besiktStart=ob|eb|tu`))
