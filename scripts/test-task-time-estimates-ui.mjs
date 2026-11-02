// Actual task UI, synthetic browser-local persistence. No database or dispatch access.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/task-time-estimate-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/task-time-estimate-view.tsx'),
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) }),
    new webpack.NormalModuleReplacementPlugin(/^(?:@\/components\/Protected|\.\/ActionCaseWorkspace|\.\/TaskIssuerAnalyticsPanel)$/, resolve('test/fixtures/task-time-estimate-stub.tsx'))],
  output: { path: output, filename: 'view.js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const globals = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../components/ui/AppToastProvider.tsx";\n@source "../../test/fixtures/task-time-estimate-view.tsx";')
const { css } = await postcss([tailwind({ base: resolve('src') })]).process(globals, { from: resolve('src/app/globals.css') })
await writeFile(resolve(output, 'style.css'), css + await readFile('src/components/tasks/uppdrag-theme.css', 'utf8'))
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const file = path === '/view.js' ? resolve(output, 'view.js') : path === '/style.css' ? resolve(output, 'style.css') : path === '/uppdrag/brand/manrope.ttf' ? resolve('public/uppdrag/brand/manrope.ttf') : null
  if (file) { response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'font/ttf'); response.end(await readFile(file)); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (path === '/mobile') {
    response.end('<!doctype html><html><head><title>Mobiltest 390px, fiktiva uppgifter</title></head><body style="margin:0;background:#ddd"><iframe title="Mobilvy" src="/?suite=mobile" style="width:390px;height:844px;border:0;background:white"></iframe></body></html>')
    return
  }
  response.end('<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fiktiva uppgifter med tidsuppskattning</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/view.js"></script></body></html>')
})
server.listen(0, '127.0.0.1', () => console.log(`TEST_URL=http://127.0.0.1:${server.address().port}`))
