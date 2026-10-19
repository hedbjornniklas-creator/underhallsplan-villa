import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const shellFiles = ['src/app/(app)/layout.tsx', 'src/components/DashboardLayoutShell.tsx']

function renderShell(file: string, pathname: string, search = '') {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file,
    compilerOptions: {
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiledModule = { exports: {} as { default: React.ComponentType<React.PropsWithChildren> } }
  const dependencies: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'next/navigation': {
      usePathname: () => pathname,
      useSearchParams: () => new URLSearchParams(search),
    },
    '@/components/Topbar': () => React.createElement('header', { 'data-topbar': true }),
    '@/components/organizations/OrganizationContextProvider': ({ children }: React.PropsWithChildren) => children,
    '@/components/auth/SessionAccessGuard': ({ children }: React.PropsWithChildren) =>
      React.createElement('section', { 'data-session-guard': true }, children),
  }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(name in dependencies, `Unexpected shell dependency: ${name}`)
    return dependencies[name]
  }, compiledModule, compiledModule.exports)
  return renderToStaticMarkup(React.createElement(compiledModule.exports.default, null,
    React.createElement('p', null, 'Current page content')))
}

for (const file of shellFiles) {
  test(`${file} leaves the public landing page outside session recovery, including embed queries`, () => {
    for (const search of ['', 'embed=1', 'embed=true']) {
      const html = renderShell(file, '/', search)
      assert.match(html, /Current page content/)
      assert.doesNotMatch(html, /data-session-guard/)
      assert.doesNotMatch(html, /data-topbar/)
    }
  })

  test(`${file} protects both regular and embedded application content`, () => {
    for (const pathname of ['/settings/profil', '/ob/assignments/example']) {
      for (const search of ['', 'embed=1', 'embed=true']) {
        const html = renderShell(file, pathname, search)
        assert.match(html, /data-session-guard="true"/)
        assert.match(html, /Current page content/)
        if (search) assert.doesNotMatch(html, /data-topbar/)
        else assert.match(html, /data-topbar="true"/)
      }
    }
  })
}
