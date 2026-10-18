import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type { TuPrintImage, TuPrintPagedDocumentProps } from '../src/components/tu/TuPrintPagedDocument'

const require = createRequire(import.meta.url)
function load<T>(path: string, exports: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const code = ts.transpileModule(`${source}\nexport { ${exports} };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (id: string) => id in dependencies ? dependencies[id] : require(id), module, module.exports
  )
  return module.exports as T
}
type Block = { id: string; type: string; images?: TuPrintImage[] }
const printer = load<{
  buildPrintableBlocks: (props: TuPrintPagedDocumentProps) => Block[]
  createPagePlan: (blocks: Block[], heights: Map<string, number>) => { pages: Block[][] }
  PrintableBlockView: ComponentType<{ block: Block }>
}>('src/components/tu/TuPrintPagedDocument.tsx', 'buildPrintableBlocks, createPagePlan, PrintableBlockView')
const publicView = load<{ ImageAppendix: ComponentType<{ images: TuPrintImage[]; startNumber: number }> }>(
  'src/components/tu/TuPublicReportSnapshotView.tsx', 'ImageAppendix', {
    '@/components/tu/TuPublicReportToolbar': {},
    '@/components/tu/TuPrintPagedDocument': {},
  }
)

function props(count: number): TuPrintPagedDocumentProps {
  return {
    companyLogoUrl: null, companyLogoAlt: '', coverTitle: '', coverImage: null, parties: null,
    metaRows: [], objectRows: [], sections: [], signature: null,
    appendixImages: Array.from({ length: count }, (_, index) => ({
      id: `image-${index}`, src: `https://example.test/photo-${index}.jpg`, caption: `Bildtext ${index + 1}.`,
    })),
    header: { documentTitle: '', objectIdentifierLabel: '', objectIdentifier: '', projectType: '', reportDate: '', address: '', assignmentNumber: '' },
    footer: { companyLines: [], contactLines: [] },
  }
}

test('appendix images remain in groups of four in the original order', () => {
  const input = props(9)
  const blocks = printer.buildPrintableBlocks(input)
  assert.equal(blocks[0].type, 'appendix-title')
  assert.deepEqual(blocks.slice(1).flatMap(block => block.images), input.appendixImages)
  assert.deepEqual(blocks.slice(1).map(block => block.images?.length), [4, 4, 1])
})

test('four enlarged photos and the appendix heading fit on one page', () => {
  for (const count of [1, 2, 3, 4, 8, 9, 10, 11]) {
    const blocks = printer.buildPrintableBlocks(props(count))
    const heights = new Map(blocks.map(block => [block.id,
      (block.type === 'appendix-title' ? 10.5 : block.images!.length > 2 ? 207 : block.images!.length === 1 ? 190 : 145) * 96 / 25.4,
    ]))
    const { pages } = printer.createPagePlan(blocks, heights)
    assert.equal(pages.length, Math.ceil(count / 4))
    assert.ok(pages.every(page => page.filter(block => block.type === 'image-grid').length === 1))
    assert.equal(pages[0][1].type, 'image-grid', 'the heading stays with the first photos')
  }
})

test('long captions are preserved instead of clamped or clipped', () => {
  const input = props(4)
  input.appendixImages[1].caption = 'En komplett bildtext med flera rader.\n'.repeat(8)
  const blocks = printer.buildPrintableBlocks(input)
  const html = renderToStaticMarkup(createElement(printer.PrintableBlockView, { block: blocks[1] }))
  assert.ok(html.includes(input.appendixImages[1].caption))
  assert.doesNotMatch(html, /overflow-hidden|max-h-|line-clamp/)
})

test('print photos preserve the complete image and use sufficient resolution for the larger layout', () => {
  const block = printer.buildPrintableBlocks(props(4))[1]
  const html = renderToStaticMarkup(createElement(printer.PrintableBlockView, { block }))
  assert.match(html, /height:96mm/)
  assert.match(html, /row-gap:10mm/)
  assert.match(html, /grid-cols-2/)
  assert.match(html, /w-full object-contain object-center/)
  assert.match(html, /max=1600/)
  assert.match(html, /q=80/)
  assert.doesNotMatch(html, /object-cover/)
  const css = readFileSync(new URL('../src/app/globals.css', import.meta.url), 'utf8')
  assert.doesNotMatch(css, /\.tu-report-(?:image-grid-block|appendix-image)\s+img\s*\{[^}]*max-height:\s*52mm/)
  assert.match(css, /\.tu-report-image-grid-block img\s*\{\s*height: 100%;\s*max-height: none;/)
})

test('the digital appendix also shows large uncropped photos and retains links to the originals', () => {
  const images = props(2).appendixImages
  const html = renderToStaticMarkup(createElement(publicView.ImageAppendix, { images, startNumber: 5 }))
  assert.match(html, /max-h-\[640px\] w-full object-contain/)
  assert.match(html, /sm:grid-cols-2/)
  assert.doesNotMatch(html, /object-cover|aspect-\[4\/3\]/)
  assert.ok(html.includes(`href="${images[0].src}"`))
  assert.ok(html.includes(images[1].caption))
})
