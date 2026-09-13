import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

test('the OB backup branch cannot trigger an automatic Vercel deployment', () => {
  assert.equal(config.git?.deploymentEnabled?.['codex/ob-staging-cleanup-2026-09-13'], false)
})

test('the backup guard leaves main and every other branch at the existing Vercel default', () => {
  assert.deepEqual(config.git.deploymentEnabled, {
    'codex/ob-staging-cleanup-2026-09-13': false,
  })
})
