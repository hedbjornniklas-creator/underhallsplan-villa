// Synthetic, local-only HTTP backend for exercising the actual mounted editors.
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { projectFixture } from '../test/fixtures/project-workspace-data.ts'
import { actionCase } from '../test/fixtures/customer-offer-data.ts'

const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack')
const output = resolve('tmp/background-saving-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({ mode: 'development', devtool: false,
  entry: resolve('test/fixtures/background-saving-view.tsx'), output: { path: output, filename: 'view.js' },
  plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })],
  resolve: { extensions: ['.tsx','.ts','.js'], alias: { '@/lib/supabaseClient': resolve('test/helpers/project-supabase-stub.ts'), '@': resolve('src') } },
  module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] },
}, (error, stats) => error || stats.hasErrors() ? reject(error ?? Error(stats.toString('errors-only'))) : done()))
const source = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../components/ui";\n@source "../../test/fixtures/background-saving-view.tsx";')
const css = (await postcss([tailwind({ base: resolve('src') })]).process(source, { from: resolve('src/app/globals.css') })).css
const theme = (await readFile('src/components/tasks/uppdrag-theme.css', 'utf8')) + (await readFile('src/components/tasks/action-case-costs.css', 'utf8'))
await writeFile(resolve(output, 'view.css'), css + theme)
const workspace = projectFixture(actionCase), item = workspace.cases[0].items[0]
item.updatedAt = '2026-11-02T12:00:00.000001Z'
item.costLines = [
  { id: randomUUID(), category: 'material', description: 'Isolering', quantity: 10, unit: 'st', unitCost: 100, markupPercent: 20 },
  { id: randomUUID(), category: 'own_labor', description: 'Montage', quantity: 8, unit: 'tim', unitCost: 500, markupPercent: 20 },
].map((line, index) => ({ ...line, vatRate: 25, priceSource: 'manual', quantityBasis: 'provided', sourceUrl: null, notes: null, verified: false, sourceCheckedAt: null, sortOrder: index + 1, pricingMethod: 'direct', updatedAt: item.updatedAt }))
const history = [], completed = new Map()
let stamp = 1, delay = 0, fail = false
let schedule = { available: true, revision: 0, rows: [{ id: randomUUID(), title: 'Grund', phase: 'Mark', startDate: '', endDate: '', status: 'planned', sourceItemId: null }], sharedRows: [] }
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname
  const send = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)) }
  try {
    if (path === '/view.js' || path === '/view.css') { response.writeHead(200, { 'Content-Type': path.endsWith('.js') ? 'text/javascript' : 'text/css' }); response.end(await readFile(resolve(output, path.slice(1)))); return }
    if (path === '/fixture') { send(workspace); return }
    if (path === '/__test__/state') { send({ workspace, schedule, history }); return }
    if (path === '/__test__/slow') { delay = 8000; send({ ok: true }); return }
    if (path === '/__test__/fail') { fail = true; send({ ok: true }); return }
    if (request.method === 'GET' && path === '/api/action-cases') { send({ workspace }); return }
    if (path.endsWith('/schedule') && request.method === 'GET') { send(schedule); return }
    if (request.method === 'POST') {
      let raw = ''; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw), pause = delay, reject = fail
      delay = 0; fail = false
      if (pause) await new Promise(done => setTimeout(done, pause))
      if (reject) { send({ error: 'Simulerat sparfel. Dina ändringar är kvar.' }, 503); return }
      history.push(structuredClone(body))
      if (path.endsWith('/schedule')) {
        if (body.revision !== schedule.revision) { send({ error: 'Tidsplanen har ändrats i en annan flik.' }, 409); return }
        schedule = { ...schedule, revision: schedule.revision + 1, rows: body.rows,
          sharedRows: body.operation === 'share' ? structuredClone(body.rows) : body.operation === 'unshare' ? [] : schedule.sharedRows }
        send(schedule); return
      }
      const p = body.payload
      if (body.action === 'save_calculation') {
        if (completed.has(p.requestId)) { send(completed.get(p.requestId)); return }
        if (p.expectedUpdatedAt !== item.updatedAt) { send({ error: 'Momentet har ändrats. Dina ändringar är kvar.' }, 409); return }
        const d = p.data, index = item.costLines.findIndex(line => line.id === d.id)
        let partId
        if (p.operation === 'line') {
          const line = { ...(item.costLines[index] ?? { vatRate: 25, sortOrder: 500, pricingMethod: 'direct' }), ...d }
          if (index < 0) item.costLines.push(line); else item.costLines[index] = line
        } else if (p.operation === 'delete_line') item.costLines = item.costLines.filter(line => line.id !== d.id)
        else if (p.operation === 'complete') item.costLines[index].verified = d.complete
        else if (p.operation === 'lump_sum') item.lumpSum = d.lumpSum
        else if (p.operation === 'work_part') {
          partId = d.partId ?? randomUUID(); item.workParts ??= []
          const index = item.workParts.findIndex(part => part.id === partId), next = { id: partId, title: d.title, scope: d.scope, sortOrder: 100, updatedAt: item.updatedAt }
          if (index < 0) item.workParts.push(next); else item.workParts[index] = next
        } else if (p.operation === 'markup') item.costLines[index].markupPercent = d.markupPercent
        item.updatedAt = `2026-11-02T12:00:00.${String(++stamp).padStart(6,'0')}Z`
        const answer = structuredClone({ requestId: p.requestId, expectedUpdatedAt: p.expectedUpdatedAt, updatedAt: item.updatedAt, item, caseId: workspace.cases[0].id, caseStatus: 'pricing', ...(partId ? { partId } : {}) })
        completed.set(p.requestId, answer); send(answer); return
      }
      if (body.action === 'save_item_scope') {
        if (p.expectedUpdatedAt !== item.updatedAt) { send({ error: 'Momentet har ändrats.' }, 409); return }
        for (const key of ['title','scope','scopeConditions','scopeExclusions','scopeAdvice','scopeAttachmentIds']) if (key in p) item[key] = p[key]
        item.updatedAt = `2026-11-02T12:00:00.${String(++stamp).padStart(6,'0')}Z`
        send({ item, caseStatus: 'pricing' }); return
      }
      send({ error: 'Kommandot är inte implementerat i testmiljön.' }, 400); return
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<!doctype html><html lang="sv"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autosparning - fiktivt testprojekt</title><link rel="stylesheet" href="/view.css"><body><div id="root"></div><script src="/view.js"></script></body></html>')
  } catch (error) { send({ error: String(error) }, 500) }
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}`))
