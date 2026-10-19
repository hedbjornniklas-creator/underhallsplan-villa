import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { isValidElement, type ReactNode } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import ts from 'typescript'

function fixture(error?: unknown) {
  const checks: string[] = []
  const Recovery = () => null
  const Shell = () => null
  const dependencies: Record<string, unknown> = {
    'react/jsx-runtime': jsxRuntime,
    'next/navigation': { redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) } },
    '@/components/DashboardLayoutShell': { default: Shell },
    '@/components/auth/DashboardAccessRecovery': { default: Recovery },
    '@/lib/access/server': { requireProductAccess: async (product: string) => {
      checks.push(product)
      if (error !== undefined) throw error
    } },
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/app/(dashboard)/layout.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const mod = { exports: {} as { default: (props: { children: ReactNode }) => Promise<ReactNode> } }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`)
    return dependencies[name]
  }, mod, mod.exports)
  return { call: () => mod.exports.default({ children: 'private appointment content' }), checks, Recovery, Shell }
}

test('dashboard still requires product access before rendering any protected content', async () => {
  const f = fixture()
  const result = await f.call()
  assert.deepEqual(f.checks, ['dashboard'])
  assert.ok(isValidElement<{ children: ReactNode }>(result))
  assert.equal(result.type, f.Shell)
  assert.equal(result.props.children, 'private appointment content')
})

test('a missing session returns to the dashboard through the allowlisted login destination', async () => {
  const f = fixture(new Error('UNAUTHORIZED'))
  await assert.rejects(f.call(), /REDIRECT:\/login\?next=%2Fdashboard-v1/)
  assert.deepEqual(f.checks, ['dashboard'])
})

test('only genuine product denial gets permission wording; unexpected failures offer recovery without leaking details or data', async () => {
  for (const [error, reason] of [
    [new Error('PRODUCT_ACCESS_REQUIRED'), 'forbidden'],
    [new Error('Cookies can only be modified in a Server Action or Route Handler'), 'unavailable'],
    [new Error('Synthetic private database diagnostic'), 'unavailable'],
    ['Unknown failure', 'unavailable'],
  ] as const) {
    const f = fixture(error)
    const result = await f.call()
    assert.ok(isValidElement<{ reason: string }>(result))
    assert.equal(result.type, f.Recovery)
    assert.deepEqual(result.props, { reason })
    assert.deepEqual(f.checks, ['dashboard'])
  }
})
