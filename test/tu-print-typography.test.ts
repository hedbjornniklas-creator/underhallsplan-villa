import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/tu/TuPrintPagedDocument.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(`${source}\nexport { PartyRows };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const loaded = { exports: {} as { PartyRows: ComponentType<{ rows: Array<{ label: string; value: string }> }> } }
new Function('require', 'module', 'exports', code)(createRequire(import.meta.url), loaded, loaded.exports)

function renderRow(label: string, value: string) {
  return renderToStaticMarkup(createElement(loaded.exports.PartyRows, { rows: [{ label, value }] }))
}

test('inspector and customer email values use the same 12px type as ordinary contact values', () => {
  for (const [label, value] of [
    ['E-Post', 'inspector@example.test'],
    ['E-post', 'brf.boktryckaren1@example.test'],
    ['Telefon', '0700000000'],
  ]) {
    const html = renderRow(label, value)
    assert.match(html, /<dd class="[^"]*text-\[12px\]/u)
    assert.doesNotMatch(html, /text-\[10\.5px\]/u)
    assert.ok(html.includes(value))
  }
})

test('long email addresses wrap instead of becoming smaller or truncated', () => {
  const value = 'fornamn.efternamn.fastighetsforvaltning@bostadsrattsforening.example.test'
  const html = renderRow('E-post', value)
  assert.match(html, /<dd class="[^"]*min-w-0[^"]*text-\[12px\]/u)
  assert.match(html, /overflow-wrap:anywhere/u)
  assert.doesNotMatch(html, /text-\[10\.5px\]|truncate|overflow-hidden/u)
  assert.ok(html.includes(value))
})
