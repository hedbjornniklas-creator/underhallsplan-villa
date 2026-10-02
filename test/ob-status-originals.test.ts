import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const golden = [
  { name: 'confirmation-2026.1', source: '67b72e4f3264476ceeff1d722b958dfb6e21d9cde4c9bbd1b1b4e69a52e0f4be',
    paragraphs: '17608191af1a8e0da81d6bde79709d22a9271878bf8627e6272696a97a928794',
    appendix: '445377bc76792b4475925e46d2d6c1fc21f35aa8bb73be4e8c53d8a5e9d21c0d' },
  { name: 'report-2026.2', source: 'e053fab1c557f71017c12b935cd521da5032e494e078fd5948e9d3c7fd3b1e53',
    paragraphs: 'c34135e26f51ce3e90eae1a78d2b270222362158ea54dc2e617681dec2631d9d',
    appendix: '1297bb2cdfe84b73b822e63acc03c5bb69f771ec138ad4835ab7febf2eb31d64' },
]
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')
for (const expected of golden) {
  test(`SBR ${expected.name} stays identical to the verified original paragraph extraction`, () => {
    const source = JSON.parse(readFileSync(new URL(`../src/content/standardtexts/status/${expected.name}.json`, import.meta.url), 'utf8'))
    assert.equal(source.sourceFileSha256, expected.source)
    assert.equal(hash(source.paragraphs.join('\n')), expected.paragraphs)
    const start = source.paragraphs.indexOf('Statusbesiktning enligt SBR-modellen')
    assert.ok(start >= 0)
    assert.equal(hash(source.paragraphs.slice(start).join('\n\n')), expected.appendix)
    assert.equal(source.paragraphs[start + 1], '(2026.1)')
  })
}
test('status confirmation and report retain their own original appendix rather than merging their differences', () => {
  assert.notEqual(golden[0].appendix, golden[1].appendix)
  const module = readFileSync(new URL('../src/content/standardtexts/status/originals.ts', import.meta.url), 'utf8')
  assert.match(module, /STB_CONFIRMATION_TERMS = appendix\(confirmation\)/)
  assert.match(module, /STB_REPORT_TERMS = appendix\(report\)/)
  assert.doesNotMatch(module, /repairMojibake|\.replace\(/)
})
