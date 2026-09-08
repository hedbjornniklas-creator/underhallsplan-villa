import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
// @ts-expect-error Node strip-types uses explicit extensions.
import * as start from '../src/lib/besiktapp/gettingStarted.ts'

const require = createRequire(import.meta.url)
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function loadComponent(path: string, react = React) {
  const compiled = { exports: {} as { default: React.ComponentType<Record<string, unknown>> } }
  const code = ts.transpileModule(source(path), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)((key: string) => {
    if (key === 'react') return react
    if (key === 'react/jsx-runtime') return require(key)
    if (key === 'next/link') return { default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => React.createElement('a', props, children) }
    if (key.endsWith('/gettingStarted')) return start
    if (key.endsWith('/publicCompanyInfo')) return { PUBLIC_BESIKTAPP_CONTACT_EMAIL: 'public@example.test' }
    if (key.endsWith('/supabaseClient')) return { supabase: new Proxy({}, { get() { throw new Error('Rendering must not read or write Supabase') } }) }
    throw new Error(key)
  }, compiled, compiled.exports)
  return compiled.exports.default
}
test('profile guidance counts only saved core fields, not images, merits or invented company data', () => {
  assert.deepEqual(start.missingStartProfile(null), ['namn', 'giltig e-postadress', 'företagsnamn'])
  assert.deepEqual(start.missingStartProfile({ full_name: ' ', email: 'wrong', company_name: ' AB ' }), ['namn', 'giltig e-postadress'])
  assert.deepEqual(start.missingStartProfile({ full_name: 'Namn', email: 'person@example.test', company_name: 'AB' }), [])
})
test('return destinations are allowlisted and display preference is separated by account and module', () => {
  for (const value of [null, 'https://evil.test', '//evil.test', '__proto__', 'renoapp']) assert.equal(start.startModule(value), null)
  for (const key of ['ob', 'eb', 'tu'] as const) { assert.equal(start.startModule(key), key); assert.equal(start.BESIKT_START[key].href, `/${key}`) }
  assert.notEqual(start.startStorageKey('a', 'ob'), start.startStorageKey('b', 'ob'))
  assert.notEqual(start.startStorageKey('a', 'ob'), start.startStorageKey('a', 'tu'))
})
test('module guides use shared profile access and do not advertise other modules or send on render', () => {
  const Component = loadComponent('src/components/besiktapp/GettingStarted.tsx')
  for (const key of ['ob', 'eb', 'tu']) {
    const html = renderToStaticMarkup(React.createElement(Component, { module: key, ...(key === 'ob' ? {} : { onStart() { throw new Error('Render cannot start an assignment') } }) }))
    assert.ok(html.includes(`/settings?besiktStart=${key}`))
    assert.ok(html.includes('aria-expanded="false"'))
    assert.ok(html.includes('Den skickar inget till kunden'))
    assert.ok(!html.includes('/ob/settings'))
    assert.equal(html.includes('/ob/assignments/new'), key === 'ob')
  }
})
test('profile return never offers navigation while saving or on failure', () => {
  const hooks = { ...React, useSyncExternalStore: () => 'tu' } as typeof React
  const Component = loadComponent('src/components/besiktapp/ProfileStartReturn.tsx', hooks)
  const render = (pending: boolean, error: string | null) => renderToStaticMarkup(React.createElement(Component, { pending, error, onRetry() {} }))
  assert.ok(!render(true, null).includes('href="/tu"'))
  assert.ok(!render(false, 'save error').includes('href="/tu"'))
  assert.ok(render(false, 'save error').includes('Försök igen'))
  assert.ok(render(false, null).includes('href="/tu"'))
})
test('dashboard integration opens existing forms, and profile return waits for the saved snapshot', () => {
  assert.ok(source('src/app/(dashboard)/ob/page.tsx').includes('<GettingStarted module="ob" />'))
  assert.ok(source('src/components/eb/EbDashboardClient.tsx').includes('onStart={() => setDialogOpen(true)}'))
  const tu = source('src/components/tu/TuDashboardClient.tsx')
  assert.ok(tu.includes("onStart={() => openCreationDialog('scratch')}"))
  assert.ok(!tu.includes('href="/ob/settings"'))
  const settings = source('src/app/(dashboard)/ob/settings/page.tsx')
  assert.ok(settings.includes('serializeProfileForm(form) !== savedSnapshot'))
  assert.ok(settings.indexOf('setSavedSnapshot(nextSnapshot)') > settings.indexOf('if (saveError)'))
})
