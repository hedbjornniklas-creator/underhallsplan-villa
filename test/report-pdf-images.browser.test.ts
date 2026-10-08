import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync, rmdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import sharp from 'sharp'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const enabled = process.env.REPORT_PDF_BROWSER_TESTS === '1'

function loadRenderer() {
  const code = ts.transpileModule(readFileSync(new URL(
    '../src/lib/report/pdfV2/renderPreviewPdf.ts', import.meta.url
  ), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const mod = { exports: {} as {
    renderPreviewPdf: (params: { url: string; timeoutMs: number }) => Promise<Uint8Array>
  } }
  new Function('require', 'module', 'exports', code)(require, mod, mod.exports)
  return mod.exports.renderPreviewPdf
}

test('real PDF renderer waits for every image and rejects incomplete reports', { skip: !enabled }, async t => {
  // No credentials, production data or remote network resources are used.
  const savedEnv = { ...process.env }
  process.env.REPORT_NETWORK_IDLE_TIMEOUT_MS = '1000'
  process.env.REPORT_READY_TIMEOUT_MS = '5000'
  process.env.REPORT_TIMING_LOGS = '0'
  const profileRoot = mkdtempSync(join(tmpdir(), 'report-pdf-readiness-test-'))
  process.env.PUPPETEER_PROFILE_ROOT_DIR = profileRoot
  const render = loadRenderer()
  const width = 900, height = 900
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const offset = (y * width + x) * 3
    const noise = (x * 37 + y * 13) % 31
    pixels[offset] = (y < height / 3 ? 195 : 20) + noise
    pixels[offset + 1] = (y >= height / 3 && y < 2 * height / 3 ? 195 : 20) + noise
    pixels[offset + 2] = (y >= 2 * height / 3 ? 195 : 20) + noise
  }
  const jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 95 }).toBuffer()
  assert.ok(jpeg.length > 32_768)
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let sentCompleteImage = false
  const server = createServer((request, response) => {
    const url = new URL(request.url!, 'http://localhost')
    if (url.pathname === '/fast.jpg') {
      response.writeHead(200, { 'Content-Type': 'image/jpeg' }).end(jpeg)
    } else if (url.pathname === '/slow.jpg') {
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length })
      response.write(jpeg.subarray(0, 16_384))
      const timer = setTimeout(() => {
        timers.delete(timer)
        sentCompleteImage = true
        response.end(jpeg.subarray(16_384))
      }, 2200)
      timers.add(timer)
      response.on('close', () => { clearTimeout(timer); timers.delete(timer) })
    } else if (url.pathname === '/broken.jpg') {
      response.writeHead(404).end()
    } else if (url.pathname === '/truncated.jpg') {
      response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': jpeg.length })
      response.write(jpeg.subarray(0, 16_384))
      const timer = setTimeout(() => { timers.delete(timer); response.destroy() }, 100)
      timers.add(timer)
    } else if (url.pathname === '/report') {
      const mode = url.searchParams.get('mode')
      const imagePath = mode === 'slow' ? '/slow.jpg' : mode === 'broken' ? '/broken.jpg'
        : mode === 'truncated' ? '/truncated.jpg' : '/fast.jpg'
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(`<!doctype html>
        <html><head><style>@page{size:A4;margin:14mm}body{font:16px Arial}img{width:110mm;height:110mm;object-fit:contain}</style></head>
        <body><main class="report-root report-root--pdf" data-report-pagination-ready="1">
        <h1>PDF image regression test</h1><p>Synthetic cover: red, green and blue bands must all be visible.</p>
        <img alt="Omslagsillustration" src="${imagePath}" ${mode === 'fallback' ? 'data-report-track="1" data-report-ready="1" data-report-failed="1"' : ''}>
        </main></body></html>`)
    } else response.writeHead(404).end()
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`
  try {
    await t.test('an untracked cover streaming its first 16 kB is fully embedded', async () => {
      sentCompleteImage = false
      const pdf = Buffer.from(await render({ url: `${origin}/report?mode=slow`, timeoutMs: 20_000 }))
      assert.equal(sentCompleteImage, true, 'PDF capture must wait beyond the network-idle timeout')
      assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
      assert.ok(pdf.includes(jpeg), 'The PDF must embed the entire JPEG, not its first network chunk')
      const output = process.env.REPORT_PDF_QA_DIR
      if (output) {
        mkdirSync(output, { recursive: true })
        writeFileSync(join(output, 'slow-cover.pdf'), pdf)
      }
    })
    for (const mode of ['broken', 'truncated', 'fallback']) {
      await t.test(`${mode} image prevents any PDF output and provides diagnostics`, async () => {
        await assert.rejects(render({ url: `${origin}/report?mode=${mode}`, timeoutMs: 20_000 }), error => {
          const failure = error as Error & { diagnostics: {
            imageCount: number; notReadyImageCount: number; notReadyImages: Array<{ alt: string; failed: boolean }>
          } }
          assert.equal(failure.name, 'PdfRenderReadinessTimeoutError')
          assert.match(failure.message, /PDF kunde inte skapas/)
          assert.equal(failure.diagnostics.imageCount, 1)
          assert.equal(failure.diagnostics.notReadyImageCount, 1)
          assert.equal(failure.diagnostics.notReadyImages[0].alt, 'Omslagsillustration')
          if (mode === 'fallback') assert.equal(failure.diagnostics.notReadyImages[0].failed, true)
          return true
        })
      })
    }
  } finally {
    for (const timer of timers) clearTimeout(timer)
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
    for (const key of ['REPORT_NETWORK_IDLE_TIMEOUT_MS', 'REPORT_READY_TIMEOUT_MS', 'REPORT_TIMING_LOGS', 'PUPPETEER_PROFILE_ROOT_DIR']) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    rmdirSync(profileRoot)
  }
})
