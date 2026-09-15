import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compiled = ts.transpileModule(readFileSync(new URL(
  '../src/components/ob/ObBuildingOverview.tsx', import.meta.url
), 'utf8'), { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText

function renderOverview(buildings: { id: string; name: string }[], options: {
  dialog?: 'add' | 'activate' | 'edit'; active?: boolean; locked?: boolean
} = {}) {
  const active = options.active !== false
  const part = { id: 'part-main', building_id: 'building-main', name: 'Huvudbyggnad', category_key: null }
  const context = { inspectionId: 'inspection', overview: {
    available: true, structure: active ? { primary_part_id: part.id } : null,
    parts: active ? [part] : [], buildings, categories: [],
  } }
  let stateIndex = 0
  const loaded = { exports: {} as { default: (props: { locked: boolean }) => React.ReactNode } }
  // Render the actual JSX with controlled context/state; no network or mutations.
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name === 'react') return { ...React,
      useState: (initial: unknown) => [stateIndex++ === 0 && options.dialog ? { mode: options.dialog, part } : initial, () => {}],
      useRef: () => ({ current: '' }),
    }
    if (name === 'react/jsx-runtime') return require(name)
    if (name === 'lucide-react') return Object.fromEntries(['Building2', 'PenLine', 'Plus', 'Save', 'Trash2'].map(key => [key, () => null]))
    if (name === './ObBuildingContext') return { useObBuilding: () => context }
    if (name === './ObRoundSheet') return { default: ({ children }: { children: React.ReactNode }) => React.createElement('div', null, children) }
    if (['@/lib/ob/buildingStructure', '@/lib/ob/localTextDrafts', '@/lib/ob/roundImageUploadQueue',
      '@/lib/buildings/buildingPurpose', './ObBuildingPurposePicker', './mobile-round.css'].includes(name)) return {}
    throw Error(`Unexpected dependency: ${name}`)
  }, loaded, loaded.exports)
  return renderToStaticMarkup(loaded.exports.default({ locked: Boolean(options.locked) }))
}

test('white building overview sets a dark foreground for active, legacy and locked states', () => {
  for (const active of [false, true]) for (const locked of [false, true]) {
    const markup = renderOverview([], { active, locked })
    assert.match(markup, /<section[^>]*class="[^"]*bg-white[^\"]*text-gray-900/)
    assert.match(markup, /Huvudbyggnad/)
  }
})

test('new-building dialog omits the registry selector when there is no existing building to reuse', () => {
  const main = { id: 'building-main', name: 'Huvudbyggnad' }
  for (const options of [{ dialog: 'add' as const }, { dialog: 'activate' as const, active: false }]) {
    const markup = renderOverview(options.active === false ? [] : [main], options)
    assert.doesNotMatch(markup, /Byggnad p\u00e5 fastigheten|Registrera ny byggnad/)
    assert.match(markup, /Byggnadens namn/)
  }
})

test('registry selector retains new and reusable buildings but excludes those already in the inspection', () => {
  for (const dialog of ['add', 'activate'] as const) {
    const markup = renderOverview([
      { id: 'building-main', name: 'Huvudbyggnad' }, { id: 'building-garage', name: 'Garage' },
    ], { dialog })
    assert.match(markup, /<option value="" selected="">Registrera ny byggnad<\/option>/)
    assert.match(markup, /<option value="building-garage">Garage<\/option>/)
    assert.doesNotMatch(markup, /<option value="building-main"/)
  }
  assert.doesNotMatch(renderOverview([{ id: 'building-garage', name: 'Garage' }], { dialog: 'edit' }), /Byggnad p\u00e5 fastigheten/)
})
