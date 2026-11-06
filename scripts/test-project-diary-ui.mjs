// Loopback-only synthetic transport; real components, validation, QR and image decoder.
// No production database, mail provider, personal data or customer access.
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { randomUUID, createHash } from 'node:crypto'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import QRCode from 'qrcode'
import { DIARY_PHOTO_PART_BYTES, diaryPersonEntryRequest, diaryRevisionRequest, diaryPersonInput, diaryMinutes, diaryPhotoRequest, diaryToday } from '../src/lib/action-cases/projectDiary.ts'
import { validateDiaryImage } from '../src/lib/action-cases/projectDiaryImage.ts'
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack'), output = resolve('tmp/project-diary-ui')
await mkdir(output, { recursive: true })
await new Promise((done, reject) => webpack({ mode: 'development', devtool: false, entry: resolve('test/fixtures/project-diary-view.tsx'), output: { path: output, filename: 'view.js' }, plugins: [new webpack.DefinePlugin({ 'process.env': JSON.stringify({ NODE_ENV: 'development' }) })], resolve: { extensions: ['.tsx','.ts','.js'], alias: { '@': resolve('src') } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: resolve('test/helpers/transpile-loader.mjs') }, { test: /\.css$/, type: 'asset/source' }] } }, (error, stats) => error || stats.hasErrors() ? reject(error || Error(stats.toString('errors-only'))) : done()))
const globals = (await readFile('src/app/globals.css', 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);\n@source "../components/tasks";\n@source "../../test/fixtures/project-diary-view.tsx";')
const { css: base } = await postcss([tailwind({ base: resolve('src') })]).process(globals, { from: resolve('src/app/globals.css') })
const css = base + await readFile('src/components/tasks/uppdrag-theme.css', 'utf8') + await readFile('src/components/tasks/project-diary.css', 'utf8'), js = await readFile(resolve(output, 'view.js'))
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, project = { id: id(1), title: 'Björkängen · Fiktivt dagboksprojekt' }, items = [{ id: id(2), title: 'Mark och grund' }, { id: id(3), title: 'Invändiga arbeten' }]
let active = true, revision = 1, token = randomUUID(), member = false, fail = false, failPhoto = false, failRevision = false, blockDirect = false, blockParts = false
const transferring = new Set(), metrics = { prepared: 0, completed: 0, maxConcurrent: 0, relayedParts: 0, maxPartBytes: 0 }
const people = [{ id: id(8), name: 'Anna Exempel', company: 'Exempelbygg AB' }, { id: id(9), name: 'Erik Test', company: 'Testmontage AB' }]
const uploads = new Map(), entries = [{ id: id(20), body: { name: 'Anna Exempel', company: 'Exempelbygg AB', workDate: diaryToday(), startTime: '07:00', endTime: '15:30', breakMinutes: 30, text: 'Förberett underlag i hallen och monterat reglar. Avstämt placering av genomföringar med arbetsledaren.', itemId: id(3) }, itemTitle: 'Invändiga arbeten', authorEmail: 'anna@example.invalid', actorMethod: 'email_code', emailVerifiedAt: new Date().toISOString(), receivedAt: new Date().toISOString(), minutes: 480, photos: [], corrections: [] }]
const requests = new Map()
const history = new Map(), revisionRequests = new Map()
const photoMetadata = p => ({ id: p.id, name: p.name, size: p.size, contentType: p.contentType, sha256: p.sha256 })
const version = (entry, actorName, createdAt) => ({ revision: entry.revision || 0, body: structuredClone(entry.body), itemTitle: entry.itemTitle, minutes: entry.minutes, photos: entry.photos.map(photoMetadata), actorName, createdAt })
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`), origin = url.origin
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)) }
  try {
    const publicUrl = `${origin}/dagbok/${token}`, device = req.headers.cookie?.includes(`diary_preview=${token}`)
    const state = { project, people, items }
    if (url.pathname === '/view.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(js) }
    if (url.pathname === '/style.css') { res.writeHead(200, { 'Content-Type': 'text/css' }); return res.end(css) }
    if (url.pathname.startsWith('/uppdrag/brand/')) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(await readFile(resolve('public', url.pathname.slice(1)))) }
    if (url.pathname === '/fixture') return send({ project, public: state, publicUrl })
    if (url.pathname === '/test/control' && req.method === 'POST') { const d = JSON.parse(await body(req)); fail = Boolean(d.fail); failPhoto = Boolean(d.failPhoto); member = Boolean(d.member); failRevision = Boolean(d.failRevision); blockDirect = Boolean(d.blockDirect); blockParts = Boolean(d.blockParts); if (d.expire) entries[0].receivedAt = new Date(Date.now() - 49 * 3600000).toISOString(); return send({ ok: true }) }
    if (url.pathname === '/test/metrics') return send({ ...metrics, transferring: transferring.size, entryCount: entries.length, latestPhotoCount: entries[0].photos.length })
    const internal = url.pathname.startsWith(`/api/action-cases/${project.id}/diary`), external = url.pathname.startsWith(`/api/dagbok/${token}`)
    if (internal || external) {
      if (external && !active) return send({ error: 'QR-länken är stängd.' }, 404)
      if (req.method === 'GET') {
        const photoId = url.pathname.split('/').at(-1)
        if (internal && photoId !== 'diary' && uploads.has(photoId)) { const p = uploads.get(photoId); res.writeHead(200, { 'Content-Type': p.contentType }); return res.end(p.bytes) }
        if (external) { res.setHeader('Set-Cookie', `diary_preview=${token}; HttpOnly; SameSite=Lax; Path=/`); return send(state) }
        if (url.searchParams.has('history')) {
          const entry = entries.find(e => e.id === url.searchParams.get('history')); if (!entry) return send({ error: 'Saknas' }, 404)
          let versions = [...(history.get(entry.id) || [version(entry, entry.body.name, entry.receivedAt)])].reverse()
          if (url.searchParams.has('beforeRevision')) versions = versions.filter(v => v.revision < Number(url.searchParams.get('beforeRevision')))
          return send({ versions: versions.slice(0,20), nextBeforeRevision: versions.length > 20 ? versions[19].revision : null })
        }
        const filtered = entries.filter(e => (!url.searchParams.get('from') || e.body.workDate >= url.searchParams.get('from')) && (!url.searchParams.get('to') || e.body.workDate <= url.searchParams.get('to')) && (!url.searchParams.get('person') || e.body.name.toLowerCase().includes(url.searchParams.get('person').toLowerCase())) && (!url.searchParams.get('item') || e.body.itemId === url.searchParams.get('item')))
        return send({ project, people, items, canManage: !member, managerAssigned: true, authorId: id(5), authorName: 'Testledare', authorEmail: 'ledare@example.invalid', link: { active, revision, url: !member && active ? publicUrl : null, qrDataUrl: !member && active ? await QRCode.toDataURL(publicUrl, { width: 360, margin: 4, errorCorrectionLevel: 'M' }) : null }, entries: filtered.map(e => ({ ...e, revision: e.revision || 0, editUntil: new Date(Date.parse(e.receivedAt) + 48 * 3600000).toISOString(), canEdit: !member && Date.now() < Date.parse(e.receivedAt) + 48 * 3600000, photos: e.photos.map(photoMetadata) })), hasMore: false, nextCursor: null })
      }
      if (url.pathname.includes('/parts/')) {
        if (external && !device) return send({ error: 'Öppna dagboken igen.' }, 401)
        if (blockParts) return send({ error: 'Anslutningen avbröts. Texten finns kvar. Försök igen.' }, 503)
        const [photoId, index] = url.pathname.split('/photos/')[1].split('/parts/'), p = uploads.get(photoId), bytes = await body(req, false)
        if (!p || !/^[0-3]$/.test(index) || bytes.length !== Math.min(DIARY_PHOTO_PART_BYTES, p.size - Number(index) * DIARY_PHOTO_PART_BYTES)) return send({ error: 'Fel bilddel.' }, 400)
        p.parts ??= []; p.parts[Number(index)] = bytes; metrics.relayedParts++; metrics.maxPartBytes = Math.max(metrics.maxPartBytes, bytes.length)
        return send({ id: p.id, part: Number(index) })
      }
      const d = JSON.parse(await body(req))
      if (['request_code','verify_code','logout'].includes(d.operation)) return send({ error: 'Ladda om dagboken för att välja person.' }, 410)
      if (external && !device) return send({ error: 'Öppna dagboken igen.' }, 401)
      if (d.operation === 'person') { const p = diaryPersonInput(d); let found = people.find(old => old.name.toLocaleLowerCase('sv') === p.name.toLocaleLowerCase('sv') && old.company.toLocaleLowerCase('sv') === p.company.toLocaleLowerCase('sv')); if (!found) { found = { id: randomUUID(), ...p }; people.push(found) } return send(found) }
      if (d.operation === 'link' && internal && !member) { if (d.expectedRevision !== revision) return send({ error: 'QR-länken har ändrats.' }, 409); active = d.active; revision++; token = randomUUID(); return send({ active, revision }) }
      if (d.operation === 'prepare') { const p = diaryPhotoRequest(d); uploads.set(p.id, { ...uploads.get(p.id), ...p }); transferring.add(p.id); metrics.prepared++; metrics.maxConcurrent = Math.max(metrics.maxConcurrent,transferring.size); return send({ id: p.id, uploadUrl: `${origin}/upload/${p.id}`, ready: Boolean(uploads.get(p.id).sha256) }) }
      if (d.operation === 'complete' || d.operation === 'complete_relay') {
        try {
          if (failPhoto) { failPhoto = false; throw Error('Simulerat bildfel. Försök igen.') }
          const p = uploads.get(d.id); if (d.operation === 'complete_relay') p.bytes = Buffer.concat(p.parts || []); if (!p.bytes) return send({ error: 'Bilden har inte nått lagringen.' }, 400); await validateDiaryImage(p.bytes, p.contentType, p.size); p.sha256 = createHash('sha256').update(p.bytes).digest('hex'); metrics.completed++; return send({ id: p.id, name: p.name })
        } finally { transferring.delete(d.id) }
      }
      if (d.operation === 'entry') {
        const normalized = diaryPersonEntryRequest(d), p = people.find(p => p.id === normalized.personId); if (!p) return send({ error: 'Välj person.' }, 400); normalized.body.name = p.name; normalized.body.company = p.company; const key = JSON.stringify(normalized)
        if (requests.has(normalized.requestId)) { const old = requests.get(normalized.requestId); if (old.key !== key) return send({ error: 'Konflikt' }, 409); return send(old.receipt) }
        const receipt = { id: d.requestId, minutes: diaryMinutes(normalized.body), receivedAt: new Date().toISOString() }
        entries.unshift({ id: receipt.id, personId: normalized.personId, body: normalized.body, itemTitle: items.find(i => i.id === normalized.body.itemId)?.title || '', authorEmail: external ? '' : 'ledare@example.invalid', actorMethod: external ? 'qr_selection' : 'internal_login', emailVerifiedAt: null, receivedAt: receipt.receivedAt, minutes: receipt.minutes, photos: normalized.photoIds.map(id => uploads.get(id)), corrections: [] })
        requests.set(d.requestId, { key, receipt })
        if (fail) { fail = false; return send({ error: 'Simulerat osäkert svar. Försök igen med samma uppgifter.' }, 503) }
        return send(receipt)
      }
      if (d.operation === 'revision' && internal && !member) {
        const normalized = diaryRevisionRequest(d), e = entries.find(e => e.id === normalized.entryId), key = JSON.stringify(normalized)
        if (!e) return send({ error: 'Anteckningen saknas.', definite: true }, 404)
        if (revisionRequests.has(normalized.requestId)) { const prior = revisionRequests.get(normalized.requestId); if (prior.key !== key) return send({ error: 'Konflikt.', definite: true }, 409); return send(prior.receipt) }
        if (Date.now() >= Date.parse(e.receivedAt) + 48 * 3600000) return send({ error: 'De 48 timmarna för redigering har gått ut. Lägg till en rättelse i stället.', definite: true }, 409)
        if (normalized.expectedRevision !== (e.revision || 0)) return send({ error: 'Anteckningen har ändrats i en annan flik.', definite: true }, 409)
        if (normalized.body.name !== e.body.name || normalized.body.company !== e.body.company) return send({ error: 'Person kan inte ändras.', definite: true }, 400)
        if (!history.has(e.id)) history.set(e.id, [version(e, e.body.name, e.receivedAt)])
        const photos = normalized.photoIds.map(id => e.photos.find(p => p.id === id) || uploads.get(id)); if (photos.some(p => !p)) return send({ error: 'Bild saknas.', definite: true }, 400)
        e.body = normalized.body; e.photos = photos; e.minutes = diaryMinutes(e.body); e.itemTitle = items.find(i => i.id === e.body.itemId)?.title || ''; e.revision = (e.revision || 0) + 1; e.editedAt = new Date().toISOString(); e.editedBy = 'Testledare'
        history.get(e.id).push(version(e, 'Testledare', e.editedAt))
        const receipt = { id: normalized.requestId, entryId: e.id, revision: e.revision, minutes: e.minutes, receivedAt: e.receivedAt, editedAt: e.editedAt }
        revisionRequests.set(normalized.requestId, { key, receipt })
        if (failRevision) { failRevision = false; return send({ error: 'Simulerat osäkert sparsvar. Försök igen.' }, 503) }
        return send(receipt)
      }
      if (d.operation === 'correction' && internal && !member) { const e = entries.find(e => e.id === d.entryId); if (!e.corrections.some(c => c.id === d.requestId)) e.corrections.push({ id: d.requestId, text: d.text, actorName: 'Testledare', createdAt: new Date().toISOString() }); return send({ id: d.requestId }) }
      return send({ error: 'Inte tillåtet' }, 403)
    }
    if (url.pathname.startsWith('/upload/') && req.method === 'PUT') { if (blockDirect) return send({ error: 'Synthetic blocked direct upload' }, 503); const p = uploads.get(url.pathname.split('/').at(-1)); p.bytes = await body(req, false); res.writeHead(200); return res.end() }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Referrer-Policy': 'no-referrer' }); res.end('<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dagbok · Fiktivt testprojekt</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/view.js"></script></body></html>')
  } catch (error) { send({ error: error.message, definite: true }, 400) }
})
async function body(req, text = true) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const bytes = Buffer.concat(chunks); return text ? bytes.toString('utf8') : bytes }
server.listen(Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7)) || 0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}`; await writeFile(resolve(output, 'url.txt'), url); console.log(url)
  if (process.argv.includes('--test-upload')) {
    try { const { testDiaryUpload } = await import('../test/helpers/diary-upload-browser.mjs'); await testDiaryUpload(url, output) }
    catch (error) { console.error(error); process.exitCode = 1 }
    finally { server.closeAllConnections(); server.close() }
  }
})
