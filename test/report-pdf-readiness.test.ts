import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = ts.createSourceFile('renderPreviewPdf.ts', readFileSync(
  new URL('../src/lib/report/pdfV2/renderPreviewPdf.ts', import.meta.url), 'utf8'
), ts.ScriptTarget.Latest, true)
const declaration = source.statements.find(statement => ts.isVariableStatement(statement)
  && statement.declarationList.declarations.some(item => item.name.getText(source) === 'isReportReady'))
assert.ok(declaration)
const compiled = ts.transpileModule(declaration.getText(source), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText

class Image {
  complete = true
  naturalWidth = 1732
  naturalHeight = 1577
  src = '/cover.jpg'
  currentSrc = '/cover.jpg'
  attributes: Record<string, string> = {}
  decode = async () => {}
  getAttribute(name: string) { return this.attributes[name] ?? null }
}

function harness(images: Image[] = [new Image()]) {
  const state = { images, paginationReady: '1', hasRoot: true }
  const querySelectorAll = (selector: string) => selector === 'img'
    ? state.images : state.images.filter(image => image.getAttribute('data-report-track') === '1')
  const root = { querySelectorAll, getAttribute: () => state.paginationReady }
  const document = { querySelector: () => state.hasRoot ? root : null, querySelectorAll }
  const ready = new Function('document', 'HTMLImageElement', `${compiled}; return isReportReady;`)(document, Image)
  return { state, ready: ready as () => Promise<boolean> }
}

test('an untracked cover with known dimensions must finish downloading before PDF capture', async () => {
  const image = new Image()
  image.complete = false
  assert.equal(await harness([image]).ready(), false)
})

test('a ready marker cannot bypass an incomplete tracked image', async () => {
  const image = new Image()
  image.attributes = { 'data-report-track': '1', 'data-report-ready': '1' }
  image.complete = false
  assert.equal(await harness([image]).ready(), false)
})

test('untracked cover, logo and footer images all have to load and decode', async () => {
  for (const src of ['/cover.jpg', '/logo.png', '/footer.png']) {
    const image = new Image()
    image.src = image.currentSrc = src
    image.naturalWidth = 0
    assert.equal(await harness([new Image(), image]).ready(), false)
    image.naturalWidth = 100
    image.decode = async () => { throw Error('Invalid image') }
    assert.equal(await harness([new Image(), image]).ready(), false)
  }
})

test('a failed photo replaced by a loaded transparent fallback must not be published', async () => {
  const image = new Image()
  image.attributes = { 'data-report-track': '1', 'data-report-ready': '1', 'data-report-failed': '1' }
  assert.equal(await harness([image]).ready(), false)
})

test('complete cached images are decoded before the report becomes ready', async () => {
  let decoded = 0
  const images = [new Image(), new Image()]
  for (const image of images) image.decode = async () => { decoded++ }
  assert.equal(await harness(images).ready(), true)
  assert.equal(decoded, 2)
})

test('reports without images still require completed pagination', async () => {
  const h = harness([])
  h.state.hasRoot = false
  assert.equal(await h.ready(), false)
  h.state.hasRoot = true
  h.state.paginationReady = '0'
  assert.equal(await h.ready(), false)
  h.state.paginationReady = '1'
  assert.equal(await h.ready(), true)
})

test('a changed source or image list during decode requires another readiness check', async () => {
  const image = new Image()
  image.decode = async () => { image.currentSrc = '/replacement.jpg' }
  assert.equal(await harness([image]).ready(), false)
  const added = harness()
  added.state.images[0].decode = async () => { added.state.images = [...added.state.images, new Image()] }
  assert.equal(await added.ready(), false)
})

test('pagination invalidated during decode must settle again', async () => {
  const h = harness()
  h.state.images[0].decode = async () => { h.state.paginationReady = '0' }
  assert.equal(await h.ready(), false)
})
