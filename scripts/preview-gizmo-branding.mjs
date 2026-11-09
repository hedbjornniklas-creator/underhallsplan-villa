import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import ts from 'typescript'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/gizmo-rebranding-preview')
await mkdir(output, { recursive: true })
const runtime = resolve('test/fixtures/gizmo-branding-runtime.tsx')
await new Promise((ok, fail) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/gizmo-branding-view.tsx'), output: { path: output, filename: 'view.js', publicPath: '/' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient$': runtime, '@/hooks/useProfile$': runtime, '@/components/organizations/ActiveOrganizationSwitcher$': runtime,
    'next/navigation': runtime, 'next/link': resolve('test/helpers/preview-link.tsx'), 'next/image': resolve('test/fixtures/gizmo-branding-image.tsx'),
    '@': resolve('src'),
  } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error || Error(stats.toString('errors-only'))) : ok()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/Topbar.tsx";\n@source "../components/tasks";\n@source "../../test/fixtures/gizmo-branding-view.tsx";')
const globalCss = await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })
const css = `${globalCss.css}\n${await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')}\nbody{margin:0;background:#fff;color:#252a2d;font-family:'Uppdrag Manrope',Arial,sans-serif}`
const module = { exports: {} }
const emailCode = ts.transpileModule(await readFile('src/lib/tasks/emailTemplates.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
new Function('require', 'module', 'exports', emailCode)(() => ({}), module, module.exports)
const email = module.exports.buildTaskEmailHtml({ previewText: 'Fiktivt test', eyebrow: 'Ny fråga', heading: 'Fråga att besvara', recipientName: 'Anna Exempel', lead: 'En fråga har delats med dig.', taskTitle: 'Fiktiv fråga', dueLabel: '10 november 2026 kl. 16:00', actionUrl: 'https://hushub.se/signe/fictitious-token' })
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const path = new URL(request.url, 'http://127.0.0.1').pathname
  if (path === '/view.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(output, 'view.js'))); return }
  if (path === '/email.html') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(email); return }
  const assetPaths = new Map([
    ['/uppdrag/brand/manrope.ttf', 'public/uppdrag/brand/manrope.ttf'], ['/uppdrag/brand/symbol.svg', 'public/uppdrag/brand/symbol.svg'],
    ['/report-assets/BesiktApp.png', 'public/report-assets/BesiktApp.png'],
  ])
  if (assetPaths.has(path)) { if (path.endsWith('.svg')) response.setHeader('Content-Type', 'image/svg+xml'); response.end(await readFile(assetPaths.get(path))); return }
  if (path === '/favicon.ico') { response.writeHead(204); response.end(); return }
  if (!['/', '/uppdrag', '/mina-uppdrag'].includes(path)) { response.writeHead(404); response.end(); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gizmo - fiktivt test</title><style>${css}</style></head><body><div id="root"></div><script src="/view.js"></script></body></html>`)
})
await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok) })
const base = `http://127.0.0.1:${server.address().port}`
console.log(`Fiktiv testvy: ${base}`)
if (process.argv.includes('--test')) {
  try { const { testGizmoBranding } = await import('../test/helpers/gizmo-branding-browser.mjs'); await testGizmoBranding(base, output) }
  finally { await new Promise(ok => server.close(ok)) }
}
