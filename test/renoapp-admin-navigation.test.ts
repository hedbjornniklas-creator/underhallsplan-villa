import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { RENOAPP_ADMIN_SETTINGS_TABS, RENOAPP_ADMIN_TABS } from '../src/lib/admin/navigation.ts'

test('main navigation contains only association management, requests and settings', () => {
  assert.deepEqual(RENOAPP_ADMIN_TABS.map(tab => tab.label), ['BRF:er', 'Intresseanmälningar', 'Systeminställningar'])
  assert.equal(RENOAPP_ADMIN_TABS[0].href, '/admin/renoapp/brf')
  assert.equal(RENOAPP_ADMIN_TABS[1].href, '/admin/renoapp/brf-requests')
  assert.equal(RENOAPP_ADMIN_TABS[2].href, RENOAPP_ADMIN_SETTINGS_TABS[0].href)
})

test('the BRF tab stays active for the list, details and manual creation, but not requests', () => {
  for (const path of ['/admin/renoapp', '/admin/renoapp/brf', '/admin/renoapp/brf/create', '/admin/renoapp/brf/brf-id']) {
    assert.deepEqual(RENOAPP_ADMIN_TABS.filter(tab => tab.match(path)).map(tab => tab.label), ['BRF:er'])
    assert.ok(!RENOAPP_ADMIN_SETTINGS_TABS.some(tab => tab.match(path)))
  }
  assert.deepEqual(RENOAPP_ADMIN_TABS.filter(tab => tab.match('/admin/renoapp/brf-requests')).map(tab => tab.label), ['Intresseanmälningar'])
})

test('every previous settings tab remains reachable at its original address', () => {
  assert.deepEqual(RENOAPP_ADMIN_SETTINGS_TABS.map(tab => tab.href), [
    '/admin/renoapp/action-types', '/admin/renoapp/flow-builder', '/admin/renoapp/questions',
    '/admin/renoapp/participants', '/admin/renoapp/review-flags', '/admin/renoapp/document-types',
    '/admin/renoapp/terminology',
  ])
  for (const tab of RENOAPP_ADMIN_SETTINGS_TABS) {
    assert.deepEqual(RENOAPP_ADMIN_TABS.filter(item => item.match(tab.href)).map(item => item.label), ['Systeminställningar'])
    assert.deepEqual(RENOAPP_ADMIN_SETTINGS_TABS.filter(item => item.match(tab.href)), [tab])
  }
})

test('legacy requirements remain in the settings section and unrelated URLs do not activate a tab', () => {
  assert.equal(RENOAPP_ADMIN_SETTINGS_TABS.find(tab => tab.match('/admin/renoapp/requirements'))?.label, 'Renoveringstyper')
  assert.equal(RENOAPP_ADMIN_TABS.find(tab => tab.match('/admin/renoapp/requirements'))?.label, 'Systeminställningar')
  for (const path of ['/admin/besiktapp', '/renoapp/app', '/admin/renoapp/brf-other']) {
    assert.ok(!RENOAPP_ADMIN_TABS.some(tab => tab.match(path)))
  }
})

test('the former overview redirects to the BRF list', () => {
  const source = readFileSync(new URL('../src/app/(app)/admin/renoapp/page.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const compiledModule = { exports: {} as { default: () => void } }
  const redirected = new Error('redirected')
  let destination: string | undefined
  new Function('require', 'module', 'exports', compiled.outputText)((name: string) => {
    assert.equal(name, 'next/navigation')
    return { redirect: (path: string) => { destination = path; throw redirected } }
  }, compiledModule, compiledModule.exports)
  assert.throws(() => compiledModule.exports.default(), error => error === redirected)
  assert.equal(destination, '/admin/renoapp/brf')
})
