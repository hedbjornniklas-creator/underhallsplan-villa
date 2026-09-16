import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Template from '../src/lib/renoapp/emailTemplate'

const source = readFileSync(new URL('../src/lib/renoapp/emailTemplate.ts', import.meta.url), 'utf8')
const compiled = { exports: {} }
new Function('module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText)(compiled, compiled.exports)
const template = compiled.exports as typeof Template

test('email uses the RenoApp palette and readable branding without external resources', () => {
  const html = template.buildRenoAppEmailHtml({ origin: 'https://hushub.se', bodyHtml: '<p>Test</p>' })
  const css = readFileSync(new URL('../src/components/renoapp/renoapp-theme.css', import.meta.url), 'utf8')
  for (const color of ['#476786', '#eaf0f5', '#293239', '#58636d', '#f4f6f7', '#cfd7de', '#274c70']) {
    assert.ok(css.toLowerCase().includes(color))
    assert.ok(html.includes(color))
  }
  assert.match(html, /<html lang="sv"/)
  assert.match(html, /Manrope.*Arial,sans-serif/)
  assert.match(html, /<strong>RenoApp<\/strong>/)
  assert.match(html, /https:\/\/renoapp.se/)
  assert.doesNotMatch(html, /<img|<script|<link|@import|@font-face|url\(/i)
  assert.doesNotMatch(html, /#166534|#f6f1ea|Renoapp.png/)
})

test('preheader is escaped and hidden while trusted generated body is preserved', () => {
  const body = '<h1>Din ansökan</h1><p>Ärende <strong>RA-1</strong></p>'
  const html = template.buildRenoAppEmailHtml({ origin: 'https://hushub.se', preheader: '<img src=x> & "test"', bodyHtml: body })
  assert.ok(html.includes(body))
  assert.match(html, /mso-hide:all/)
  assert.match(html, /&lt;img src=x&gt; &amp; &quot;test&quot;/)
  assert.doesNotMatch(html, /<img src=x>/)
})

test('HTML and Outlook buttons preserve and escape the same personal URL and label', () => {
  const html = template.buildRenoAppEmailButton('https://hushub.se/renoapp/invite/test?a=1&b="2"', 'Öppna <ärendet>')
  const hrefs = [...html.matchAll(/href="([^"]*)"/g)].map(match => match[1])
  assert.deepEqual(hrefs, Array(2).fill('https://hushub.se/renoapp/invite/test?a=1&amp;b=&quot;2&quot;'))
  assert.equal((html.match(/Öppna &lt;ärendet&gt;/g) ?? []).length, 2)
  assert.match(html, /fillcolor="#476786"/)
  assert.match(html, /background:#476786/)
  assert.match(html, /<w:anchorlock\/>/)
  assert.match(html, /max-width:100%;box-sizing:border-box/)
})

test('narrow screens and long content have explicit containment', () => {
  const html = template.buildRenoAppEmailHtml({ origin: 'https://hushub.se', bodyHtml: 'x'.repeat(500) })
  assert.match(html, /max-width:480px/)
  assert.match(html, /table-layout:fixed/)
  assert.match(html, /overflow-wrap:anywhere;word-wrap:break-word/)
})

test('renovation feedback shares the common template and no longer loads the old logo', () => {
  const feedback = readFileSync(new URL('../src/lib/renoapp/actionTypeFeedback.ts', import.meta.url), 'utf8')
  assert.match(feedback, /const html = buildRenoAppEmailHtml\(/)
  assert.match(feedback, /buildRenoAppEmailButton\(applyUrl/)
  assert.doesNotMatch(feedback, /<img|Renoapp.png|#f6f1ea/)
})
