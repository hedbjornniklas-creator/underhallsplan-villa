const { readFileSync, mkdirSync, writeFileSync } = require('node:fs')
const ts = require('typescript')
const puppeteer = require('puppeteer-core')
function load(path, dependencies, expose = '') {
  const output = ts.transpileModule(readFileSync(path, 'utf8') + expose, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => name.startsWith('node:') ? require(name) : dependencies[name] ?? {}, compiled, compiled.exports)
  return compiled.exports
}
async function main() {
  const service = load('src/lib/eb/remediation.ts', {
    '@/lib/eb/remediationDefaults': load('src/lib/eb/remediationDefaults.ts', {}),
  }, '\nexports.preview = paidRemediationInvitation;')
  const mail = service.preview({
    report: { project: { id: 'project', title: 'Renovering av Testvilla', propertyDesignation: 'VILLAN 1:2',
      address: 'Villavägen 4', postalCode: '123 45', city: 'Teststad', clientName: 'Anna & Anders Exempel' },
    inspection: { inspectionId: 'inspection', variantLabel: 'Slutbesiktning', sequenceNo: 1,
      date: '2026-09-03', assignmentNumber: 'EB 2026-0903-01', defaultRemedyDeadline: '2026-10-03' } },
    buyerSnapshot: {}, recipient: 'Testbygg AB', accessUrl: 'https://example.invalid/atgarder/test-only', taskCount: 5,
  })
  const output = 'tmp/eb-invitation-preview'
  mkdirSync(output, { recursive: true })
  writeFileSync(`${output}/invitation.html`, mail.html)
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
  try {
    const page = await browser.newPage()
    await page.setRequestInterception(true)
    page.on('request', request => request.abort())
    for (const width of [900, 390]) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 })
      await page.setContent(mail.html)
      const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }))
      if (dimensions.content > dimensions.viewport) throw new Error(`Overflow: ${JSON.stringify(dimensions)}`)
      await page.screenshot({ path: `${output}/invitation-${width}.png`, fullPage: true })
    }
  } finally { await browser.close() }
  console.log('Invitation preview verified at 900px and 390px.')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
