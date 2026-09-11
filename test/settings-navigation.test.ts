import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const componentPath = 'src/components/settings/SettingsNav.tsx'
const profilePagePath = 'src/app/(dashboard)/ob/settings/page.tsx'
const customerPagePath = 'src/app/(app)/settings/kunder/page.tsx'
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const componentCode = ts.transpileModule(source(componentPath), {
  fileName: componentPath,
  compilerOptions: {
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText

function renderNavigation(pathname: string, search = '') {
  const compiledModule = {
    exports: {} as { default: React.ComponentType },
  }
  const Icon = (props: React.SVGProps<SVGSVGElement>) => React.createElement('svg', props)

  new Function('require', 'module', 'exports', componentCode)(
    (name: string) => {
      if (name === 'react') return require(name)
      if (name === 'react/jsx-runtime') return require(name)
      if (name === 'next/link') {
        function LinkMock({
          children,
          ...props
        }: React.PropsWithChildren<Record<string, unknown>>) {
          return React.createElement('a', props, children)
        }
        return LinkMock
      }
      if (name === 'next/navigation') {
        return {
          usePathname: () => pathname,
          useSearchParams: () => new URLSearchParams(search),
        }
      }
      if (name === 'lucide-react') return new Proxy({}, { get: () => Icon })
      throw new Error(`Unexpected SettingsNav dependency: ${name}`)
    },
    compiledModule,
    compiledModule.exports
  )

  return renderToStaticMarkup(React.createElement(compiledModule.exports.default))
}

function anchors(html: string) {
  return html.match(/<a\b[^>]*>.*?<\/a>/g) ?? []
}

function anchorFor(html: string, href: string) {
  const matches = anchors(html).filter((anchor) => anchor.includes(`href="${href}"`))
  assert.equal(matches.length, 1, `Expected exactly one link to ${href}`)
  return matches[0]
}

function activeLinks(html: string) {
  return anchors(html).filter((anchor) => anchor.includes('aria-current="page"'))
}

test('settings navigation exposes the two destinations with clear descriptions', () => {
  const html = renderNavigation('/settings')

  assert.match(html, /<nav\b[^>]*aria-label="Inställningsmeny"/)
  assert.match(html, />Inställningsmeny</)
  assert.equal(anchors(html).length, 2)

  const profile = anchorFor(html, '/settings')
  assert.match(profile, />Profil och integrationer</)
  assert.match(profile, />Person-, företags- och Fortnoxuppgifter</)

  const customers = anchorFor(html, '/settings/kunder')
  assert.match(customers, />Kundregister</)
  assert.match(customers, />Kunder och faktureringsuppgifter</)
})

test('profile destination is current on both canonical and legacy settings routes', () => {
  for (const pathname of ['/settings', '/ob/settings']) {
    const html = renderNavigation(pathname)

    assert.deepEqual(activeLinks(html), [anchorFor(html, '/settings')])
    assert.doesNotMatch(anchorFor(html, '/settings/kunder'), /aria-current=/)
  }
})

test('customer destination alone is current on the customer route', () => {
  const html = renderNavigation('/settings/kunder')

  assert.deepEqual(activeLinks(html), [anchorFor(html, '/settings/kunder')])
  assert.doesNotMatch(anchorFor(html, '/settings'), /aria-current=/)
})

test('unrelated routes do not mark a settings destination as current', () => {
  const html = renderNavigation('/dashboard-v1')

  assert.equal(activeLinks(html).length, 0)
})

test('settings navigation preserves the active organization in both destinations', () => {
  const organizationId = '22222222-2222-4222-8222-222222222222'
  const html = renderNavigation('/settings/kunder', `orgId=${organizationId}`)

  anchorFor(html, `/settings?orgId=${organizationId}`)
  anchorFor(html, `/settings/kunder?orgId=${organizationId}`)
})

test('both settings pages mount the shared navigation once and use matching headings', () => {
  const pages = [
    {
      path: profilePagePath,
      heading: 'Profil och integrationer',
    },
    {
      path: customerPagePath,
      heading: 'Kundregister',
    },
  ]

  for (const page of pages) {
    const pageSource = source(page.path)
    assert.equal(pageSource.match(/<SettingsNav\s*\/>/g)?.length, 1, page.path)
    assert.match(
      pageSource,
      new RegExp(`<h1\\b[^>]*>${page.heading}<\\/h1>`),
      `${page.path} should use the navigation label as its H1`
    )
  }
})
