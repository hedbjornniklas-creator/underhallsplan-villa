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
function loadStatusModule(file: string): unknown {
  const output = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => name === '@/lib/ob/reportDeliveryHistory'
    ? loadStatusModule('src/lib/ob/reportDeliveryHistory.ts') : require(name), module, module.exports)
  return module.exports
}
const statusModule = loadStatusModule('src/components/ob/ObReportDeliveryStatus.tsx')
const code = ts.transpileModule(
  readFileSync(new URL('../src/components/ob/ObWizard.tsx', import.meta.url), 'utf8'),
  { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText

function entry(id: string, type: 'report_sent' | 'report_created' | 'report_unlocked', downloadable = true) {
  return { id, type, title: id, subtitle: null, occurred_at: '2026-09-25T13:57:24Z', download_url: downloadable ? pdfHref : null }
}

function renderDelivery(activityLog: ReturnType<typeof entry>[], ready = true, state: { status?: string; lockedAt?: string | null } = {}) {
  const meta = {
    inspectionId, inspectionStatus: state.status ?? 'completed', canSend: true,
    hasStoredPdf: ready, pdfStatus: ready ? 'ready' : 'processing', pdfError: null,
    canDownloadPdf: ready, reason: null, defaultRecipientEmail: null, ordererEmail: null,
    history: [], activityLog,
    digitalReportUrl: '/internal/published-report',
    timeline: { nextCursor: activityLog.length > 20 ? 'older' : null, overview: { publishedAt: null,
      reportId: 'selected', version: 1, lockedAt: state.lockedAt ?? null, lastSentAt: null, lastRecipients: [], historyIncomplete: false },
      entries: activityLog.slice(0,20).map(item => ({ id: item.id,
        type: item.type === 'report_sent' ? 'sent' : item.type === 'report_created' ? 'published' : 'unlocked',
        occurred_at: item.occurred_at, actor_name: item.title, status: item.download_url ? 'sent' : 'failed',
        recipient_email: null, detail: null, report_id: 'selected', version: 1, report_active: true })) },
  }
  const compiled = { exports: {} as { default: React.ComponentType<Record<string, unknown>> } }
  let stateIndex = 0
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (name === 'react') return {
      ...React,
      useState: (initial: unknown) => React.useState(stateIndex++ === 2 ? meta : initial),
    }
    if (name === 'react/jsx-runtime' || name === 'lucide-react') return require(name)
    if (name === 'next/link') return { default: 'a' }
    if (name.startsWith('./ObStep')) return { default: () => null }
    if (name === './ObUnlockInspection') return { default: () => null }
    if (name === './ObWordExport') return { default: () => null }
    if (name === './ObInspectionBillingPanel') return { default: () => null }
    if (name === './ObReportDeliveryStatus') return statusModule
    if (name === './ObBuildingContext') return { useObBuilding: () => null }
    if (name === './ObFloorProvider') return {
      ObFloorProvider: ({ children }: React.PropsWithChildren) => children,
    }
    if (name === '@/lib/ob/publishedReportLink') return { obPublishedReportHref: () => null }
    if (name === '@/lib/ob/wordExportLink') return { obWordExportHref: () => null }
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return renderToStaticMarkup(React.createElement(compiled.exports.default, {
    property: { id: '7604799b-b346-4eec-a489-ee98c85ee4b9', name: 'Test' },
    inspection: { id: inspectionId, status: state.status ?? 'completed', locked_at: state.lockedAt ?? null },
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

test('one current PDF download outside the timeline; all send events remain visible', () => {
  const html = renderDelivery([
    entry('Failed send', 'report_sent', false),
    entry('Latest send', 'report_sent'),
    entry('Created report', 'report_created'),
    entry('Other recipient', 'report_sent'),
    entry('Earlier send', 'report_sent'),
  ])
  assert.equal(downloads(html).length, 1)
  assert.equal(downloads(logRow(html, 'Latest send')).length, 0)
  for (const title of ['Failed send', 'Created report', 'Other recipient', 'Earlier send']) {
    assert.equal(downloads(logRow(html, title)).length, 0)
  }
})

test('a ready but unsent PDF has one download in report tools, never in the publication log', () => {
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

test('delivery labels distinguish completion from the actual lock, including legacy status names', () => {
  for (const status of ['completed', 'klar', 'done']) {
    const open = renderDelivery([], true, { status, lockedAt: null })
    assert.match(open, /Öppen för ändringar/)
    assert.match(open, /Tidigare klarmarkerad/)
    assert.match(open, /Publicera, skicka och lås/)
    assert.match(open, /Publicera och skicka utan låsning/)
    assert.doesNotMatch(open, /Skicka och behåll låst/)
    const locked = renderDelivery([], true, { status, lockedAt: '2026-10-14T08:00:00Z' })
    assert.match(locked, /Skicka publicerad version igen/)
    assert.doesNotMatch(locked, /Publicera, skicka och lås/)
    assert.doesNotMatch(locked, /Skicka och behåll upplåst/)
  }
  const ongoing = renderDelivery([], true, { status: 'ongoing' })
  assert.match(ongoing, /Publicera, skicka och lås/)
  assert.match(ongoing, /Publicera och skicka utan låsning/)
})
