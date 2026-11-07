import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/project-completion-preview')
await mkdir(output, { recursive: true })
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/project-completion-view.tsx'), output: { path: output, filename: 'view.js', publicPath: '/' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src') } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks/ProjectCompletion.tsx";\n@source "../components/tasks/ProjectInvoiceBasis.tsx";\n@source "../../test/fixtures/project-completion-view.tsx";')
const globalCss = await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })
const css = `${globalCss.css}\n${await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')}\n${await readFile('src/components/tasks/project-completion.css', 'utf8')}\nbody{margin:0;background:#fff;color:#252a2d;font-family:'Uppdrag Manrope',Arial,sans-serif}`
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'")
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (path === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(output, 'view.js'))); return }
  if (path === '/uppdrag/brand/manrope.ttf') { response.end(await readFile('public/uppdrag/brand/manrope.ttf')); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (path !== '/') { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Projektavslut · fiktivt test</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Fiktiv testvy: ${base}`)
if (process.argv.includes('--test')) {
  try { const { testProjectCompletion } = await import('../test/helpers/project-completion-browser.mjs'); await testProjectCompletion(base, output) }
  finally { await new Promise(ok => server.close(ok)) }
}
