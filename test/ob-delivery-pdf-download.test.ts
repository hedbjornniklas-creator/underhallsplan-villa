import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const inspectionId = 'c9adfa97-07d7-476d-946d-4bf2fd3c1a32'
const pdfHref = `/api/report-v2/${inspectionId}/pdf`
const code = ts.transpileModule(
  readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

function entry(id: string, type: 'report_sent' | 'report_created' | 'report_unlocked', downloadable = true) {
  return { id, type, title: id, subtitle: null, occurred_at: '2026-09-25T13:57:24Z', download_url: downloadable ? pdfHref : null }
}

function renderDelivery(activityLog: ReturnType<typeof entry>[], ready = true) {
  const meta = {
    inspectionId, inspectionStatus: 'completed', canSend: true,
    hasStoredPdf: ready, pdfStatus: ready ? 'ready' : 'processing', pdfError: null,
    canDownloadPdf: ready, reason: null, defaultRecipientEmail: null, ordererEmail: null,
    history: [], activityLog,
  }
  const compiled = { exports: {} as { default: React.ComponentType<Record<string, unknown>> } }
  let stateIndex = 0
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'react') return {
      ...React,
      useState: (initial: unknown) => React.useState(stateIndex++ === 0 ? meta : initial),
    }
    if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name)
    if (name === 'next/link') return { default: 'a' }
    if (name.startsWith('./ObStep')) return { default: () => null }
    if (name === './ObBuildingContext') return { useObBuilding: () => null }
    if (name === './ObFloorProvider') return {
      ObFloorProvider: ({ children }: React.PropsWithChildren) => children,
    }
    if (name === '@/lib/ob/publishedReportLink') return { obPublishedReportHref: () => null }
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return renderToStaticMarkup(React.createElement(compiled.exports.default, {
    property: { id: '7604799b-b346-4eec-a489-ee98c85ee4b9', name: 'Test' },
    inspection: { id: inspectionId, status: 'completed' },
    activeSection: 'delivery',
  }))
}

function downloads(html: string) {
  return (html.match(/<a\b[^>]*>.*?<\/a>/g) ?? []).filter(anchor => anchor.includes(`href="${pdfHref}"`))
}

function logRow(html: string, title: string) {
  const row = (html.match(/<li\b[^>]*>.*?<\/li>/g) ?? []).find(item => item.includes(`>${title}</span>`))
  assert.ok(row, `Missing log row: ${title}`)
  return row
}

test('one PDF download on the latest successful send; all log entries remain visible', () => {
  const html = renderDelivery([
    entry('Failed send', 'report_sent', false),
    entry('Latest send', 'report_sent'),
    entry('Created report', 'report_created'),
    entry('Other recipient', 'report_sent'),
    entry('Earlier send', 'report_sent'),
  ])
  assert.equal(downloads(html).length, 1)
  assert.equal(downloads(logRow(html, 'Latest send')).length, 1)
  for (const title of ['Failed send', 'Created report', 'Other recipient', 'Earlier send']) {
    assert.equal(downloads(logRow(html, title)).length, 0)
  }
})

test('a ready but unsent PDF has one download at PDF status, never in the created log', () => {
  for (const activityLog of [[], [entry('Created report', 'report_created')], [entry('Failed send', 'report_sent', false), entry('Created report', 'report_created')]]) {
    const html = renderDelivery(activityLog)
    assert.equal(downloads(html).length, 1)
    for (const item of activityLog) assert.equal(downloads(logRow(html, item.title)).length, 0)
  }
})

test('a send outside the visible log does not hide the only PDF download', () => {
  const activityLog = Array.from({ length: 20 }, (_, index) => entry(`Unlock ${index}`, 'report_unlocked', false))
  activityLog.push(entry('Older send', 'report_sent'))
  const html = renderDelivery(activityLog)
  assert.equal(downloads(html).length, 1)
  assert.doesNotMatch(html, /Older send/)
})

test('a PDF that is not ready has no download', () => {
  const html = renderDelivery([entry('Created report', 'report_created', false)], false)
  assert.equal(downloads(html).length, 0)
})
