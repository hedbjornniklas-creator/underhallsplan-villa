import assert from 'node:assert/strict'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export const productionOrigin = 'https://rfresrbuekidumbwzpcm.supabase.co'
export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const magic = Buffer.from('OBBK1')
export const windowsPowerShellEnv = () => Object.fromEntries(Object.entries(process.env)
  .filter(([name]) => name.toLowerCase() !== 'psmodulepath'))

export function seal(bytes, key) {
  assert.equal(key.length, 32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(magic)
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()])
  return Buffer.concat([magic, iv, cipher.getAuthTag(), encrypted])
}

export function unseal(bytes, key) {
  assert.equal(key.length, 32)
  assert.ok(bytes.length >= 33 && bytes.subarray(0, 5).equals(magic), 'Invalid backup envelope')
  const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(5, 17))
  decipher.setAAD(magic)
  decipher.setAuthTag(bytes.subarray(17, 33))
  return Buffer.concat([decipher.update(bytes.subarray(33)), decipher.final()])
}

export function protectKey(key, decrypt = false) {
  assert.equal(process.platform, 'win32', 'Windows current-user DPAPI is required')
  const method = decrypt ? 'Unprotect' : 'Protect'
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`],
  { input: key.toString('base64'), env: windowsPowerShellEnv(), encoding: 'utf8', windowsHide: true, timeout: 30000 })
  assert.equal(result.status, 0, 'DPAPI operation failed')
  return Buffer.from(result.stdout.trim(), 'base64')
}

export function readonlyUrl(path) {
  assert.ok(path.startsWith('/rest/v1/') || path.startsWith('/storage/v1/object/'), 'Unapproved read path')
  assert.ok(!path.startsWith('/rest/v1/rpc/') && !/[\\\u0000-\u001f]/.test(path), 'RPC/unsafe path denied')
  const url = new URL(path, productionOrigin)
  assert.equal(url.origin, productionOrigin)
  assert.ok(url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/object/'))
  if (url.pathname.startsWith('/rest/v1/')) {
    const decoded = decodeURIComponent(url.pathname)
    assert.match(decoded, /^\/rest\/v1\/[a-z_][a-z0-9_]*$/)
    assert.notEqual(decoded, '/rest/v1/rpc', 'RPC denied')
  }
  return url
}

export function objectReadPath(bucket, path) {
  assert.match(bucket, /^[a-z0-9][a-z0-9-]*$/)
  assert.ok(typeof path === 'string' && path.split('/').every(p => p && p !== '.' && p !== '..'), 'Invalid object path')
  assert.doesNotMatch(path, /[\\\u0000-\u001f]/)
  return '/storage/v1/object/' + bucket + '/' + path.split('/').map(encodeURIComponent).join('/')
}
