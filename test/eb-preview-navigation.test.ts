import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { EbInspectionReport } from '../src/lib/eb/server'

const require = createRequire(import.meta.url)
function load(path: string, dependencies: Record<string, unknown> = {}) {
  const compiledModule = { exports: {} }
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (['react', 'react/jsx-runtime', 'lucide-react'].includes(name)) return require(name)
    throw new Error(`Unexpected preview-navigation dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports
}

function Link(props: React.ComponentProps<'a'>) { return React.createElement('a', props) }
const navigationStates: unknown[] = []
const dependencies: Record<string, unknown> = {
  react: { ...React, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn,
    useState: (value: unknown) => [value, (next: unknown) => navigationStates.push(next)],
    useEffect: () => undefined, useLayoutEffect: () => undefined },
  'next/link': { __esModule: true, default: Link },
  'next/navigation': { useRouter: () => ({ refresh() { throw new Error('Navigation must not refresh or mutate the report') } }) },
  '@/components/eb/EbReportDeliveryDialog': { __esModule: true, default: () => null },
  '@/components/eb/EbToastProvider': { useEbToast: () => ({ showError() {} }) },
}
for (const name of ['reportSectionRules', 'reportText', 'vocabulary', 'approvalStatus', 'reportNoteDisplay', 'inspectionReuseDisplay']) {
  dependencies[`@/lib/eb/${name}`] = load(`src/lib/eb/${name}.ts`)
}
const view = load('src/components/eb/EbInspectionReportView.tsx', dependencies) as {
  default: (props: { report: EbInspectionReport; showInternalActions?: boolean; publicActions?: React.ReactNode }) => React.ReactElement<{ children?: React.ReactNode }>
}
function fixture(): EbInspectionReport {
  return {
    project: { id: 'project/name', title: 'TEST', standardAgreement: 'AB 04' },
    inspection: { inspectionId: 'inspection/name', variant: 'FB', variantLabel: 'Förbesiktning', sequenceNo: 1,
      date: '2026-11-07', previousInspections: [], reportLockedAt: null },
    notes: [], checkpoints: [], images: [], participants: [],
    reportDraft: { sections: [], noteHeadings: [] },
    branding: { footer: { companyLines: [], contactLines: [] }, signature: null },
  } as unknown as EbInspectionReport
}
function toolbar(node: React.ReactNode): React.ReactElement | undefined {
  if (!React.isValidElement<{ className?: string; children?: React.ReactNode }>(node)) return
  if (node.type === 'div' && node.props.className?.includes('print:hidden')) return node
  for (const child of React.Children.toArray(node.props.children)) {
    const found = toolbar(child)
    if (found) return found
  }
}
function links(node: React.ReactNode): Array<React.ReactElement<React.ComponentProps<'a'>>> {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return []
  return [
    ...(node.type === Link ? [node as React.ReactElement<React.ComponentProps<'a'>>] : []),
    ...React.Children.toArray(node.props.children).flatMap(links),
  ]
}

test('internal report preview has one clear return link to the current inspection and preserves the project link', () => {
  const report = fixture()
  const before = structuredClone(report)
  for (const lockedAt of [null, '2026-11-06T10:00:00Z']) {
    report.inspection.reportLockedAt = lockedAt
    const ui = toolbar(view.default({ report }))
    assert.ok(ui)
    const html = renderToStaticMarkup(ui)
    assert.match(html, /Till besiktningen/)
    assert.match(html, /href="\/eb\/projects\/project%2Fname\/inspections\/inspection%2Fname\/perform"/)
    assert.match(html, /Till entreprenaden/)
    assert.match(html, /href="\/eb\/projects\/project%2Fname"/)
    const inspectionLinks = links(ui).filter(link => String(link.props.href).endsWith('/perform'))
    assert.equal(inspectionLinks.length, 1, 'Granska and the return action must not duplicate the same navigation')
    assert.ok(links(ui).findIndex(link => String(link.props.href).endsWith('/perform')) <
      links(ui).findIndex(link => String(link.props.href).endsWith('project%2Fname')))
    assert.match(html, /print:hidden/)
    assert.doesNotMatch(html, /hidden (?:md|lg):|hidden md:flex/)
    navigationStates.length = 0
    inspectionLinks[0].props.onClick?.({ preventDefault() { throw new Error('Available navigation should not be blocked') } } as unknown as React.MouseEvent<HTMLAnchorElement>)
    assert.deepEqual(navigationStates, ['review:inspection/name'])
  }
  report.inspection.reportLockedAt = null
  assert.deepEqual(report, before, 'Opening or returning from the preview never edits report data')
})

test('public views and PDF-only rendering never expose internal inspection or project links', () => {
  const report = fixture()
  const pdf = view.default({ report, showInternalActions: false })
  assert.equal(toolbar(pdf), undefined)
  assert.equal(links(pdf).length, 0)
  const publicUi = toolbar(view.default({ report, showInternalActions: false,
    publicActions: React.createElement('button', null, 'Publik åtgärd') }))
  assert.ok(publicUi)
  const html = renderToStaticMarkup(publicUi)
  assert.match(html, /Publik åtgärd/)
  assert.doesNotMatch(html, /Till besiktningen|Till entreprenaden|\/eb\/projects/)
})

const chromePath = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
test('the real preview toolbar keeps its inspection return button visible on desktop/mobile and hidden in print',
  { skip: !existsSync(chromePath) }, async () => {
  const puppeteer = require('puppeteer-core')
  const postcss = require('postcss')
  const tailwind = require('@tailwindcss/postcss')
  const source = readFileSync('src/app/globals.css', 'utf8').replace('@import "tailwindcss";',
    '@import "tailwindcss" source(none);\n@source "../components/eb/EbInspectionReportView.tsx";')
  const css = (await postcss([tailwind()]).process(source, { from: resolve('src/app/globals.css') })).css
  const ui = toolbar(view.default({ report: fixture() }))
  assert.ok(ui)
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true })
  const output = resolve('tmp/eb-preview-navigation')
  mkdirSync(output, { recursive: true })
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', (request: { abort(): Promise<void> }) => { void request.abort() })
    for (const width of [390, 1024]) {
      await page.setViewport({ width, height: 320 })
      await page.setContent(`<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body>${renderToStaticMarkup(ui)}</body></html>`)
      const result = await page.$$eval('a', (nodes: HTMLAnchorElement[]) => nodes.map(node => {
        const rect = node.getBoundingClientRect()
        return { text: node.textContent?.trim(), left: rect.left, right: rect.right, height: rect.height,
          visible: getComputedStyle(node).display !== 'none' }
      })) as Array<{ text: string; left: number; right: number; height: number; visible: boolean }>
      assert.ok(result.some(link => link.text === 'Till besiktningen' && link.visible && link.height > 0))
      assert.ok(result.every(link => link.left >= 0 && link.right <= width), `${width}px: navigation never clips`)
      await page.screenshot({ path: resolve(output, `internal-${width}.png`), fullPage: true })
      await page.emulateMediaType('print')
      assert.equal(await page.$eval('body > div', (node: Element) => getComputedStyle(node).display), 'none')
      await page.emulateMediaType('screen')
    }
  } finally { await browser.close() }
})
