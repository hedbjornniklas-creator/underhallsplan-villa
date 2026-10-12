import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const source = readFileSync(new URL('../src/components/Topbar.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function renderTopbar(pathname: string, orgId = '') {
  const loaded = { exports: {} as { default?: () => unknown } }
  const mocks: Record<string, unknown> = {
    'next/link': { default: (props: Record<string, unknown>) => React.createElement('a', props) },
    'next/image': { default: (props: Record<string, unknown>) => React.createElement('img', props) },
    'next/navigation': {
      usePathname: () => pathname,
      useRouter: () => ({}),
      useSearchParams: () => new URLSearchParams(orgId ? { orgId } : {}),
    },
    'lucide-react': { LayoutGrid: () => null, Power: () => null, UserRound: () => null },
    '@/lib/supabaseClient': { supabase: {} },
    '@/hooks/useProfile': { useProfile: () => ({ profile: null }) },
    '@/components/organizations/ActiveOrganizationSwitcher': { default: () => null },
  }
  new Function('require', 'module', 'exports', compiled)(
    (name: string) => name in mocks ? mocks[name] : require(name), loaded, loaded.exports,
  )
  return renderToStaticMarkup(React.createElement(loaded.exports.default)) as string
}

function logoHref(pathname: string, orgId = '') {
  return renderTopbar(pathname, orgId).match(/<a href="([^"]+)"/)?.[1]
}

test('all shared settings pages send the BesiktApp logo to dashboard-v1', () => {
  for (const path of ['/settings', '/settings/', '/settings/organisation', '/settings/profil', '/settings/kunder', '/settings/organisation/new']) {
    assert.equal(logoHref(path), '/dashboard-v1', path)
    assert.equal(logoHref(path, 'selected-org'), '/dashboard-v1', `${path} with orgId`)
    assert.match(renderTopbar(path), /alt="BesiktApp"/)
  }
})

test('logo remains a normal same-tab link handled by the profile navigation guard', () => {
  const logo = renderTopbar('/settings/profil').match(/<a [^>]*>/)?.[0] ?? ''
  assert.match(logo, /href="\/dashboard-v1"/)
  assert.doesNotMatch(logo, /target=|download=/)
  assert.match(source, /<Link\s+href=\{logoHref\}/)
})

test('logo destinations outside shared settings stay unchanged', () => {
  for (const [path, expected] of [
    ['/admin/access', '/admin'], ['/dashboard-v1', '/'], ['/', '/'],
    ['/ob', '/dashboard-v1'], ['/eb', '/dashboard-v1'], ['/tu', '/dashboard-v1'],
    ['/uppdrag', '/dashboard-v1'], ['/fuktsakerhet', '/dashboard-v1'],
    ['/eb/project', '/eb'], ['/uppdrag/project', '/uppdrag'], ['/settings-other', '/'],
  ]) assert.equal(logoHref(path), expected, path)
})

test('module logo links still preserve the selected organization', () => {
  for (const [path, expected] of [
    ['/tu/project', '/tu'], ['/fuktsakerhet/project', '/fuktsakerhet'],
    ['/ob/project', '/ob'], ['/inspections/123', '/ob'],
  ]) assert.equal(logoHref(path, 'org with spaces'), `${expected}?orgId=org%20with%20spaces`, path)
})
