import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { ReportSnapshotPayloadV1 } from '../src/lib/report/reportSnapshotPayload'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '..')
const cache = new Map<string, { exports: unknown }>()
function load(file: string): unknown {
  if (cache.has(file)) return cache.get(file)!.exports
  const mod = { exports: {} }
  cache.set(file, mod)
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    esModuleInterop: true,
  } }).outputText
  new Function('require', 'module', 'exports', source)((name: string) => {
    if (name === '@/content/standardtexts/loadStandardText') return { loadStandardText: () => 'Syntetisk standardtext' }
    if (name === '@/lib/report/loadAppendixText') return { loadAppendixText: () => 'Syntetisk bilaga' }
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? resolve(root, 'src', name.slice(2)) : resolve(dirname(file), name)
      return load(`${target}.${existsSync(`${target}.tsx`) ? 'tsx' : 'ts'}`)
    }
    if (['react', 'react/jsx-runtime', 'lucide-react', 'next/link'].includes(name)) return require(name)
    throw new Error(`Unexpected dependency in snapshot renderer: ${name}`)
  }, mod, mod.exports)
  return mod.exports
}
const { snapshotWithBuildings } = load(resolve(root, 'test/fixtures/report-snapshot-buildings-data.ts')) as {
  snapshotWithBuildings: () => ReportSnapshotPayloadV1
}
const { default: View } = load(resolve(root, 'src/components/report/ReportSnapshotView.tsx')) as {
  default: ComponentType<{ snapshot: ReportSnapshotPayloadV1 }>
}
const render = (snapshot = snapshotWithBuildings()) => renderToStaticMarkup(createElement(View, { snapshot }))

test('the actual digital customer view renders every frozen building before the appendices', () => {
  const html = render()
  assert.equal((html.match(/data-snapshot-building=/g) ?? []).length, 2)
  for (const text of ['Huvudbyggnadens sparade taknotering', 'Huvudbyggnadens sparade köksnotering',
    'Garagets sparade taknotering', 'Garagets sparade köksnotering', 'Gästhusets sparade köksnotering',
    'Garagets frysta risktext', 'Garagets frysta FTU-text', 'Plan 0 - Garage', 'Plan 1 - Kontor',
    'Möblering: ', 'fullt möblerad', 'Byggnadsår: 2023', 'Endast den avtalade byggnadsdelen.']) {
    assert.ok(html.includes(text), `Missing frozen content: ${text}`)
  }
  assert.ok(html.indexOf('data-snapshot-building="garage"') > html.indexOf('Huvudbyggnadens sparade köksnotering'))
  assert.ok(html.indexOf('data-snapshot-building="guest-house"') > html.indexOf('data-snapshot-building="garage"'))
  assert.ok(html.indexOf('data-snapshot-building="guest-house"') < html.indexOf('>Bilagor</h2>'))
  assert.match(html, /alt="Byggnadsbild: Garage"/)
})

test('rendering never mutates the snapshot or fills empty risk and FTU from the catalogue', () => {
  const snapshot = snapshotWithBuildings()
  const before = JSON.stringify(snapshot)
  const freeze = (value: unknown) => {
    if (value && typeof value === 'object') {
      Object.values(value).forEach(freeze)
      Object.freeze(value)
    }
  }
  freeze(snapshot)
  const html = render(snapshot)
  assert.equal(JSON.stringify(snapshot), before)
  const guest = html.slice(html.indexOf('data-snapshot-building="guest-house"'), html.indexOf('>Bilagor</h2>'))
  assert.doesNotMatch(guest, />Risk:|>FTU:|Garagets frysta/)
  const intro = html.slice(html.indexOf('data-snapshot-building="garage"'), html.indexOf('>Förutsättningar</h3>'))
  assert.doesNotMatch(intro, />--<|>Risk:|>FTU:/)
})

test('snapshots without extra buildings keep their existing main building and appendices', () => {
  for (const appendices of [undefined, {}, { buildings: [] }, { buildings: null }]) {
    const snapshot = snapshotWithBuildings()
    Object.assign(snapshot.reportData.mock, { appendices })
    const html = render(snapshot)
    assert.doesNotMatch(html, /data-snapshot-building/)
    assert.match(html, /Huvudbyggnadens sparade köksnotering/)
    assert.match(html, /Bilaga 1 - Villkor/)
  }
})

test('older snapshots can omit optional building metadata and photos without hiding notes', () => {
  const snapshot = snapshotWithBuildings()
  Object.assign(snapshot.reportData.mock, { appendices: { buildings: [{
    name: 'Förråd', interior: { blocks: [{ title: 'Rum', noteText: 'Äldre sparad notering' }] },
  }] } })
  const html = render(snapshot)
  assert.match(html, /Förråd/)
  assert.match(html, /Äldre sparad notering/)
  assert.doesNotMatch(html, /alt="Byggnadsbild:/)
})

test('building names and note text remain escaped as data', () => {
  const snapshot = snapshotWithBuildings()
  Object.assign(snapshot.reportData.mock, { appendices: { buildings: [{
    name: '<script>injected()</script>', interior: { blocks: [{ noteText: '<img onerror="injected()">' }] },
  }] } })
  const html = render(snapshot)
  assert.doesNotMatch(html, /<script>|<img onerror/)
  assert.match(html, /&lt;script&gt;/)
})
