import test from 'node:test'
import assert from 'node:assert/strict'
import { allowedStagingApi, stagingEnvironment, stagingUrl, validateStagingKeys } from '../scripts/lib/ob-staging-app.mjs'

const keys = { url: stagingUrl, anonKey: 'sb_publishable_test', serviceKey: 'sb_secret_test' }
test('staging rejects any other backend and omits inherited integration secrets', () => {
  assert.throws(() => validateStagingKeys({ ...keys, url: 'https://production.supabase.co' }))
  const env = stagingEnvironment({ PATH: 'safe-path', RESEND_API_KEY: 'do-not-copy', NODE_OPTIONS: 'unsafe', OPENAI_API_KEY: 'do-not-copy', SUPABASE_SERVICE_ROLE_KEY: 'production' }, keys, 57100)
  assert.equal(env.PATH, 'safe-path')
  assert.equal(env.SUPABASE_SERVICE_ROLE_KEY, keys.serviceKey)
  for (const name of ['RESEND_API_KEY', 'OPENAI_API_KEY', 'NODE_OPTIONS']) assert.equal(env[name], undefined)
})
test('staging blocks all integration and delivery endpoints by default', () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  assert.ok(allowedStagingApi(`/api/ob/inspections/${id}/buildings`))
  assert.ok(allowedStagingApi('/api/image-proxy'))
  for (const path of [`/api/ob/inspections/${id}/report-delivery`, `/api/ob/inspections/${id}/note-suggestions`, '/api/cron/reports/pdf', '/api/ai/test', '/api/auth/reset-password', '/api/fortnox/connect', '/api/unknown']) assert.equal(allowedStagingApi(path), false)
})
