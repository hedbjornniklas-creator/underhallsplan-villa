import assert from 'node:assert/strict'
import { STAGING_PROJECT } from './ob-staging-schema.mjs'

export const stagingUrl = `https://${STAGING_PROJECT}.supabase.co`
export function validateStagingKeys(value) {
  assert.equal(value.url, stagingUrl, 'Only the approved staging URL is accepted')
  assert.match(value.anonKey, /^sb_publishable_[A-Za-z0-9_-]+$/, 'Expected staging publishable key')
  assert.match(value.serviceKey, /^sb_secret_[A-Za-z0-9_-]+$/, 'Expected staging secret key')
  return value
}

// Do not inherit integrations, NODE_OPTIONS, proxies or the normal .env.local.
export function stagingEnvironment(parent, keys, port) {
  validateStagingKeys(keys)
  const result = {}
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATH', 'PATHEXT', 'TEMP', 'TMP', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA']) {
    const actual = Object.keys(parent).find(k => k.toLowerCase() === key.toLowerCase())
    if (actual) result[key] = parent[actual]
  }
  return { ...result, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_SUPABASE_URL: stagingUrl, NEXT_PUBLIC_SUPABASE_ANON_KEY: keys.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: keys.serviceKey, APP_BASE_URL: `http://127.0.0.1:${port}`,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}` }
}

export function allowedStagingApi(path) {
  return /^\/api\/ob\/inspections\/[0-9a-f-]{36}\/(?:buildings|assignment-workflow|round|floors|frozen-inspector|addon-orders|area-measurement|moisture-control)(?:\/images)?$/.test(path)
    || path === '/api/organizations/context' || path === '/api/staging/login' || path === '/api/image-proxy'
}
