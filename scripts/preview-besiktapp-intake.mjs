// Isolated UI preview with fictional contacts. No Supabase, mail or authentication calls.
// Interact through the supported browser tool. Stop this process when QA is complete.
import { readFile, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const require = createRequire(import.meta.url)
const { webpack } = require('next/dist/compiled/webpack/webpack')
const output = await mkdtemp(join(tmpdir(), 'besiktapp-intake-preview-'))
await new Promise((ok, fail) => webpack({
  mode: 'development', devtool: false,
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  entry: resolve('test/fixtures/besiktapp-interest-list.tsx'),
  output: { path: output, filename: 'view.js' },
  resolve: { extensions: ['.tsx', '.ts', '.js'], alias: { '@': resolve('src'), 'next/link$': resolve('test/helpers/preview-link.tsx') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }] },
}, (error, stats) => error || stats.hasErrors() ? fail(error ?? new Error(stats.toString('errors-only'))) : ok()))
const js = await readFile(join(output, 'view.js'))
const { css } = await postcss([tailwind()]).process(await readFile('src/app/globals.css', 'utf8'), { from: resolve('src/app/globals.css') })
const row = { id: 'f543b282-1bc6-401a-9f3c-ef4492187c62', name: 'Testperson – fiktiva uppgifter', company: 'Exempelföretaget',
  email: 'inspector@example.test', phone: '', message: 'Jag arbetar med överlåtelsebesiktningar och vill veta mer.',
  status: 'new', owner_name: '', follow_up_on: null, notification_state: 'failed', revision: 0,
  created_at: '2026-09-08T10:00:00Z', updated_at: '2026-09-08T10:00:00Z' }
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname === '/view.js') { response.setHeader('Content-Type', 'application/javascript'); response.end(js); return }
  if (url.pathname === '/api/admin/besiktapp-interest') {
    response.setHeader('Content-Type', 'application/json')
    if (request.method === 'PATCH') {
      let text = ''; for await (const chunk of request) text += chunk
      const patch = JSON.parse(text)
      if (patch.status === 'offered' || patch.revision !== row.revision) {
        response.statusCode = 409; response.end(JSON.stringify({ error: 'Testkonflikt: hämta listan igen innan du sparar.' })); return
      }
      Object.assign(row, patch, { revision: row.revision + 1 })
      response.end(JSON.stringify({ item: row })); return
    }
    const matches = ['all', row.status].includes(url.searchParams.get('status'))
    response.end(JSON.stringify({ items: matches ? [row] : [], total: matches ? 1 : 0 })); return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8')
  response.end(`<!doctype html><html lang="sv"><head><title>BesiktApp – lokal testlista</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="background:#f7f6f3"><div style="padding:12px;background:#fff1b8">Lokal testvy. Alla uppgifter är fiktiva. Status ”Tillgång erbjuden” simulerar en konflikt.</div><div id="root"></div><script src="/view.js"></script></body></html>`)
})
server.listen(0, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${server.address().port}`))
