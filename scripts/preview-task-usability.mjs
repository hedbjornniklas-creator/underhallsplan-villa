// Real components, fictional data and local-only API replacements. Never sends mail.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import ts from 'typescript'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/task-usability-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({ mode: 'development', devtool: false,
  entry: { recipient: resolve('test/fixtures/task-recipient-usability-view.tsx'), question: resolve('test/fixtures/question-recipient-view.tsx'), dashboard: resolve('test/fixtures/task-time-estimate-view.tsx'), details: resolve('test/fixtures/task-details-view.tsx') },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) }),
    new webpack.NormalModuleReplacementPlugin(/^(?:@\/components\/Protected|\.\/ActionCaseWorkspace|\.\/TaskIssuerAnalyticsPanel|\.\/SupplierInvoiceWorkspace)$/, resolve('test/fixtures/task-time-estimate-stub.tsx'))],
  output: { path: output, filename: '[name].js' }, resolve: { extensions: ['.tsx', '.ts', '.js'], alias: {
    '@/lib/supabaseClient$': resolve('test/fixtures/gizmo-branding-runtime.tsx'), 'next/navigation': resolve('test/fixtures/gizmo-branding-runtime.tsx'),
    'next/link': resolve('test/helpers/preview-link.tsx'), 'next/image': resolve('test/fixtures/gizmo-branding-image.tsx'), '@': resolve('src'),
  } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const globals = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../components/ui/AppToastProvider.tsx";\n@source "../../test/fixtures/task-recipient-usability-view.tsx";\n@source "../../test/fixtures/task-time-estimate-view.tsx";')
const { css } = await postcss([tailwind()]).process(globals, { from: resolve('src/app/globals.css') })
await writeFile(resolve(output, 'style.css'), css + await readFile('src/components/tasks/uppdrag-theme.css', 'utf8') + await readFile('src/components/tasks/project-questions.css', 'utf8') + await readFile('src/components/tasks/gizmo-recipient-layout.css', 'utf8'))
const loaded = { exports: {} }
new Function('require', 'module', 'exports', ts.transpileModule(await readFile('src/lib/tasks/emailTemplates.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(() => ({}), loaded, loaded.exports)
const email = loaded.exports.buildTaskEmailHtml({ previewText: 'Anna Exempel har tilldelat dig uppdraget.', eyebrow: 'Nytt uppdrag', heading: 'Kontrollera leveransen av innerdörrar', recipientName: 'Bo Exempel', lead: 'Anna Exempel har tilldelat dig följande uppdrag.', taskTitle: 'Kontrollera leveransen av innerdörrar', contextLabel: 'Fiktivt testprojekt', dueLabel: '15 januari 2027 kl. 16:00', instruction: 'Öppna uppdraget utan att logga in och bekräfta mottagandet. Svara där så att dialogen sparas i Gizmo. Vanliga mejlsvar sparas inte automatiskt i uppdraget.', actionUrl: '#fiktivt-test', actionLabel: 'Öppna uppdraget', notice: 'Den direkta uppdragslänken är personlig. Vidarebefordra den inte till någon annan.' })
const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store')
  const path = new URL(request.url, 'http://localhost').pathname
  const assets = new Map([['/recipient.js', resolve(output, 'recipient.js')], ['/question.js', resolve(output, 'question.js')], ['/dashboard.js', resolve(output, 'dashboard.js')], ['/details.js', resolve(output, 'details.js')], ['/style.css', resolve(output, 'style.css')], ['/uppdrag/brand/manrope.ttf', resolve('public/uppdrag/brand/manrope.ttf')], ['/uppdrag/brand/symbol.svg', resolve('public/uppdrag/brand/symbol.svg')]])
  if (assets.has(path)) { response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.svg') ? 'image/svg+xml' : 'font/ttf'); response.end(await readFile(assets.get(path))); return }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (path === '/email') { response.end(email); return }
  response.end(`<!doctype html><html lang="sv"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gizmo - fiktivt användbarhetstest</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/${path === '/dashboard' ? 'dashboard' : path === '/details' ? 'details' : path === '/question' ? 'question' : 'recipient'}.js"></script></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(`TEST_URL=http://127.0.0.1:${server.address().port}`))
