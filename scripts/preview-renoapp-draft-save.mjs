// Isolated browser regression fixture: no live database or email calls.
import { readFile, mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/renoapp-draft-save')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({
  mode: 'development', devtool: false, entry: resolve('test/fixtures/renoapp-draft-save.tsx'),
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    react: resolve('node_modules/react'), 'react-dom': resolve('node_modules/react-dom'),
    '@': resolve('src'), 'next/navigation': resolve('test/fixtures/renoapp-draft-navigation.ts'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const { css: base } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const css = base + await readFile('src/components/renoapp/renoapp-theme.css', 'utf8')
const js = await readFile(resolve(output, 'view.js'))
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  if (path.startsWith('/api/')) { response.writeHead(500); response.end('Unexpected request'); return }
  if (path === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  const asset = new Map([['/renoapp/brand/logo.svg', ['logo.svg', 'image/svg+xml']], ['/renoapp/brand/manrope.ttf', ['manrope.ttf', 'font/ttf']]]).get(path)
  if (asset) { response.setHeader('Content-Type', asset[1]); response.end(await readFile(resolve('public/renoapp/brand', asset[0]))); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css} #fixture-result { display: block; overflow-wrap: anywhere; }</style></head><body><aside><label><input id="fixture-fail" type="checkbox">Simulera sparfel</label><output id="fixture-result"></output></aside><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
console.log(`Mock-only draft fixture: http://127.0.0.1:${server.address().port}/renoapp/brf/test/apply`)
