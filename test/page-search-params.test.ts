import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as jsxRuntime from 'react/jsx-runtime'

function loadPage(path: string, dependencies: Record<string, unknown>) {
  const compiled = { exports: {} }
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const available: Record<string, unknown> = { 'react/jsx-runtime': jsxRuntime, ...dependencies }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in available, name)
    return available[name]
  }, compiled, compiled.exports)
  return (compiled.exports as {
    default: (props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) => Promise<unknown>
  }).default
}

test('admin page awaits promised query values and preserves redirects and empty landing', async () => {
  const redirects: string[] = []
  const page = loadPage('../src/app/(app)/admin/page.tsx', {
    'next/navigation': { redirect: (url: string) => { redirects.push(url) } },
    './AdminLandingClient': { default: () => null },
  })
  await page({})
  await page({ searchParams: Promise.resolve({}) })
  assert.deepEqual(redirects, [])
  await page({ searchParams: Promise.resolve({ tab: 'settings & access' }) })
  await page({ searchParams: Promise.resolve({ tab: ['first', 'ignored'] }) })
  assert.deepEqual(redirects, [
    '/admin/besiktapp?tab=settings%20%26%20access', '/admin/besiktapp?tab=first',
  ])
})

test('standard text debug page resolves promised IDs with the existing default fallback', async () => {
  const selected: string[] = []
  const page = loadPage('../src/app/debug/standardtexts/page.tsx', {
    'next/link': { default: () => null },
    '@/content/standardtexts/loadStandardText': {
      loadStandardText: (id: string) => { selected.push(id); return 'Test text' },
    },
    '@/content/standardtexts/registry': {
      listStandardTextIds: () => ['FIRST', 'SECOND'],
      getStandardTextPath: (id: string) => id,
    },
  })
  await page({})
  await page({ searchParams: Promise.resolve({ id: 'SECOND' }) })
  await page({ searchParams: Promise.resolve({ id: ['SECOND', 'FIRST'] }) })
  await page({ searchParams: Promise.resolve({ id: 'UNKNOWN' }) })
  assert.deepEqual(selected, ['FIRST', 'SECOND', 'SECOND', 'FIRST'])
})
