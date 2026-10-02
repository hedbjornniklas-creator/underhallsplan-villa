import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/tu/TuInvestigationEditorClient.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const elements: ts.JsxElement[] = []
function collect(node: ts.Node) {
  if (ts.isJsxElement(node)) elements.push(node)
  ts.forEachChild(node, collect)
}
collect(ast)
const cover = elements.find((node) => node.openingElement.tagName.getText(ast) === 'section' &&
  node.openingElement.attributes.getText(ast).includes('aria-label="Omslagsbild"'))!
assert.ok(cover, 'The editor must expose a cover image section')
const chooseButton = elements.find((node) => node.openingElement.tagName.getText(ast) === 'button' &&
  node.getText(ast).includes('Välj från bildbanken'))!
assert.ok(chooseButton)
function buttonExpression(name: string) {
  const attribute = chooseButton.openingElement.attributes.properties.find((node) =>
    ts.isJsxAttribute(node) && node.name.getText(ast) === name)
  assert.ok(attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer))
  return attribute.initializer.expression!.getText(ast)
}

test('cover controls are near the report details instead of ordered after the entire report', () => {
  assert.doesNotMatch(cover.openingElement.attributes.getText(ast), /order-last/u)
  assert.ok(source.indexOf('>Rapportuppgifter</h2>') < cover.getStart(ast))
  assert.ok(cover.getEnd() < source.indexOf('>Utlåtandets delar</h2>'))
  assert.match(cover.getText(ast), /coverFileInputRef\.current\?\.click\(\)/u)
  assert.match(cover.getText(ast), /uploadImages\(files, 'cover'\)/u)
  assert.match(cover.getText(ast), /handleDropToSection\(event, 'cover'\)/u)
})

test('choose from image bank opens and scrolls to the existing bank without moving images', () => {
  const events: unknown[] = []
  const click = new Function('setImageBankOpen', 'imageBankRef', `return ${buttonExpression('onClick')}`)(
    (open: boolean) => events.push({ open }),
    { current: { scrollIntoView: (options: object) => events.push(options) } }
  ) as () => void
  click()
  assert.deepEqual(events, [{ open: true }, { behavior: 'smooth', block: 'start' }])
  assert.match(source, /<article ref=\{imageBankRef\}/u)
})

test('cover selection respects report locking, uploads in progress and empty image banks', () => {
  const disabled = new Function('locked', 'imageBusy', 'bankImages', `return ${buttonExpression('disabled')}`) as (
    locked: boolean, busy: boolean, images: object[]
  ) => boolean
  assert.equal(disabled(false, false, [{}]), false)
  assert.equal(disabled(true, false, [{}]), true)
  assert.equal(disabled(false, true, [{}]), true)
  assert.equal(disabled(false, false, []), true)
})

function reportFixture(withCover: boolean, withLogo: boolean) {
  return {
    createdAt: '2026-10-01T06:20:00Z',
    report: {
      header: { documentTitle: 'Fuktskadeutredning', objectIdentifierLabel: 'Objekt', objectIdentifier: 'Vind',
        projectType: 'Fuktskadeutredning', reportDate: '2026-10-01', address: 'Exempelvägen 1', assignmentNumber: 'TU test' },
      coverTitle: 'Fuktskadeutredning',
      companyLogoUrl: withLogo ? '/company-logo.png' : null, companyLogoAlt: 'Företagslogga',
      coverImage: withCover ? { id: 'cover', src: '/cover-photo.png', caption: 'Fastigheten' } : null,
      sections: [], parties: null, signature: null, appendixImages: [],
    },
  }
}
const publicSource = readFileSync(new URL('../src/components/tu/TuPublicReportSnapshotView.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(publicSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const loaded = { exports: {} as { default: ComponentType<{ snapshot: ReturnType<typeof reportFixture> }> } }
const require = createRequire(import.meta.url)
new Function('require', 'module', 'exports', code)((name: string) => {
  if (name === '@/components/tu/TuPublicReportToolbar') return { default: () => null }
  if (name === '@/components/tu/TuPrintPagedDocument') return { TuReportMeasurementTable: () => null }
  return require(name)
}, loaded, loaded.exports)

test('published reports without a cover do not display an empty image panel', () => {
  for (const withLogo of [true, false]) {
    const html = renderToStaticMarkup(createElement(loaded.exports.default, { snapshot: reportFixture(false, withLogo) }))
    assert.doesNotMatch(html, /Ingen omslagsbild|lg:grid-cols-\[1\.05fr_0\.95fr\]|aspect-\[4\/3\]/u)
    assert.equal((html.match(/<img /gu) ?? []).length, withLogo ? 1 : 0)
    if (withLogo) assert.match(html, /alt="Företagslogga"/u)
  }
})

test('published reports with a cover keep the photo, logo and full-size image link', () => {
  const html = renderToStaticMarkup(createElement(loaded.exports.default, { snapshot: reportFixture(true, true) }))
  assert.match(html, /lg:grid-cols-\[1\.05fr_0\.95fr\]/u)
  assert.match(html, /href="\/cover-photo\.png"/u)
  assert.match(html, /src="\/cover-photo\.png"/u)
  assert.match(html, /alt="Företagslogga"/u)
  assert.equal((html.match(/<img /gu) ?? []).length, 2)
})
