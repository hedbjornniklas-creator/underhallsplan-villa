import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import ts from 'typescript'

const root = fileURLToPath(new URL('../', import.meta.url))
const recipient = process.argv[2]
const senderOverride = process.argv[3]
const receiptName = process.argv[4] ?? 'external-email.json'
assert.match(receiptName, /^external-email(?:-[a-z0-9-]+)?\.json$/)
assert.match(recipient ?? '', /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/, 'Supply an explicitly approved test inbox')
const folder = join(root, '.cache/ob-release')
await mkdir(folder, { recursive: true })
const receiptPath = join(folder, receiptName)
const delivery = JSON.parse(await readFile(join(root, '.cache/ob-staging-app/delivery-latest.json')))
assert.equal(delivery.project, 'https://lodbgdbmfdtdzfaezblx.supabase.co')
assert.equal(delivery.completed, true)
assert.equal(dirname(resolve(delivery.output)), resolve(root, '.cache/ob-staging-app'))
assert.match(delivery.output.split(/[\\/]/).pop(), /^delivery-\d+$/)
const pdf = await readFile(join(delivery.output, 'frozen-report.pdf'))
assert.equal(createHash('sha256').update(pdf).digest('hex'), delivery.pdfSha256)
assert.equal(pdf.length, delivery.pdfBytes)
assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
assert.ok(env.RESEND_API_KEY && env.ASSIGNMENTS_MAIL_FROM, 'Configured mail transport required')
const sender = senderOverride ?? env.ASSIGNMENTS_MAIL_FROM
assert.ok(!/[\r\n]/.test(sender) && sender.length < 200, 'Invalid sender')
let receipt
try { receipt = JSON.parse(await readFile(receiptPath)) } catch (error) { if (error.code !== 'ENOENT') throw error }
if (receipt) {
  assert.equal(receipt.to, recipient); assert.equal(receipt.pdfSha256, delivery.pdfSha256)
  assert.equal(receipt.from, sender)
  assert.ok(!receipt.acceptedAt, 'Provider already accepted this test; do not send again')
  assert.ok(Date.now() - Date.parse(receipt.createdAt) < 23 * 60 * 60 * 1000, 'Old uncertain attempt requires provider reconciliation, not a resend')
} else {
  receipt = { to: recipient, from: sender, pdfSha256: delivery.pdfSha256,
    pdfBytes: pdf.length, createdAt: new Date().toISOString(), idempotencyKey: 'ob-release-test-' + randomUUID(),
    subject: 'TEST - OB publiceringskontroll, syntetisk testrapport', acceptedAt: null }
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600 })
}
// Only the real mailer and its intended provider are available in this process.
const systemEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  /^(SystemRoot|WINDIR|PATH|PATHEXT|COMSPEC|TEMP|TMP|USERPROFILE|LOCALAPPDATA|APPDATA)$/i.test(key)))
for (const key of Object.keys(process.env)) delete process.env[key]
Object.assign(process.env, systemEnv)
process.env.RESEND_API_KEY = env.RESEND_API_KEY
const fetchReal = globalThis.fetch
globalThis.fetch = (input, init) => {
  assert.equal(String(input), 'https://api.resend.com/emails'); assert.equal(init.method, 'POST')
  const body = JSON.parse(init.body)
  assert.deepEqual(body.to, [recipient]); assert.equal(body.subject, receipt.subject)
  return fetchReal(input, init)
}
const compiled = ts.transpileModule(await readFile(join(root, 'src/lib/assignments/mailer.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const loaded = { exports: {} }
new Function('exports', 'module', compiled)(loaded.exports, loaded)
try {
  const result = await loaded.exports.sendAssignmentEmail({ to: recipient, from: receipt.from, subject: receipt.subject,
    idempotencyKey: receipt.idempotencyKey,
    text: 'Detta ar ett leveranstest fran HusHub. Bifogad PDF innehaller enbart syntetiska testuppgifter for tva byggnader, inte en riktig kundbesiktning. Kontrollera att mejlet kommer fram och att PDF-filen gar att oppna. Detta ar ett separat mejltransporttest; ingen kundrapport eller produktionsbesiktning har publicerats.',
    html: '<h1>TEST: HusHub</h1><p>Bifogad PDF inneh&aring;ller enbart syntetiska testuppgifter f&ouml;r tv&aring; byggnader, inte en riktig kundbesiktning.</p><p>Kontrollera att mejlet kommer fram och att PDF-filen g&aring;r att &ouml;ppna.</p><p>Detta &auml;r ett separat mejltransporttest. Ingen kundrapport eller produktionsbesiktning har publicerats.</p>',
    attachments: [{ filename: 'TEST-OB-tva-byggnader.pdf', contentBase64: pdf.toString('base64'), contentType: 'application/pdf' }],
  })
  receipt.acceptedAt = new Date().toISOString(); receipt.provider = result.provider; receipt.providerMessageId = result.providerMessageId
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ accepted: true, to: recipient, subject: receipt.subject, pdfBytes: pdf.length }))
} catch (error) {
  receipt.error = error.message; await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { mode: 0o600 }); throw error
} finally { globalThis.fetch = fetchReal }
