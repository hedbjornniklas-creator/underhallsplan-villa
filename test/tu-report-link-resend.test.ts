import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { decryptTuReportLinkToken, encryptTuReportLinkToken } from '../src/lib/tu/reportLinkToken.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const delivery = read('src/app/api/tu/investigations/[inspectionId]/report-delivery/route.ts')
const list = read('src/app/(dashboard)/tu/investigations/page.tsx')

test('encrypts the bearer token and detects corrupted ciphertext', () => {
  const previous = process.env.TU_REPORT_LINK_ENCRYPTION_KEY
  process.env.TU_REPORT_LINK_ENCRYPTION_KEY = 'test-only-secret-not-for-production'
  try {
    const token = 'a'.repeat(43)
    const ciphertext = encryptTuReportLinkToken(token)
    assert.ok(!ciphertext.includes(token))
    assert.equal(decryptTuReportLinkToken(ciphertext), token)
    const parts = ciphertext.split('.')
    parts[2] = (parts[2].startsWith('A') ? 'B' : 'A') + parts[2].slice(1)
    assert.throws(() => decryptTuReportLinkToken(parts.join('.')))
  } finally {
    if (previous === undefined) delete process.env.TU_REPORT_LINK_ENCRYPTION_KEY
    else process.env.TU_REPORT_LINK_ENCRYPTION_KEY = previous
  }
})

test('resends the latest published revision without revoking its existing link', () => {
  assert.match(delivery, /action === 'resend'\s*\? await getPublishedTuRevision/u)
  assert.match(delivery, /if \(publishedLink\?\.tu_token_ciphertext\) \{[\s\S]*?decryptTuReportLinkToken/u)
  assert.match(delivery, /if \(!publishedLink\) await revokeOlderReportLinks/u)
  assert.match(delivery, /if \(!reusingPublishedLink\) \{\s*await admin[\s\S]*?revoked_at/u)
  assert.match(delivery, /if \(action !== 'resend'\) \{\s*reportLockedAt =/u)
})

test('keeps an old link alive during the one-time legacy replacement', () => {
  assert.match(delivery, /if \(currentRevision\.status === 'published' && currentRevision\.published_link_id\) \{\s*if \(!reusingPublishedLink\) \{\s*await replacePublishedTuLink/u)
  assert.match(delivery, /tu_token_ciphertext: encryptTuReportLinkToken\(token\)/u)
  assert.match(list, /Skicka om publicerat utlåtande/u)
  assert.match(list, /tidigare delade länkar fortsätter fungera/u)
})
