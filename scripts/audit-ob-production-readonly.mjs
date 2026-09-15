import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { productionOrigin, readonlyUrl, protectKey, seal, unseal, digest, windowsPowerShellEnv } from './lib/ob-private-backup.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = parseEnv(await readFile(join(root, '.env.local'), 'utf8'))
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, productionOrigin)
assert.ok(env.SUPABASE_SERVICE_ROLE_KEY, 'Existing service credential required')
const schema = JSON.parse(await readFile(join(root, '.cache/inspection-schema-export/production-schema-review-20260914.json')))
assert.equal(schema.transaction_read_only, 'on')
const folder = join(homedir(), '.codex/backups/hushub-ob', `production-${Date.now()}`)
await mkdir(folder, { recursive: true })
const acl = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
  `$ErrorActionPreference='Stop'; $p=$env:OB_BACKUP_TARGET; $a=Get-Acl -LiteralPath $p; $a.SetAccessRuleProtection($true,$false); $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow')); $a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-18'),'FullControl','ContainerInherit,ObjectInherit','None','Allow')); Set-Acl -LiteralPath $p -AclObject $a`],
{ env: { ...windowsPowerShellEnv(), OB_BACKUP_TARGET: folder }, encoding: 'utf8', windowsHide: true })
assert.equal(acl.status, 0, 'Private backup folder ACL could not be set: ' + acl.stderr)
const key = randomBytes(32), protectedKey = protectKey(key)
assert.deepEqual(protectKey(protectedKey, true), key, 'DPAPI round trip failed')
await writeFile(join(folder, 'key.dpapi'), protectedKey, { flag: 'wx' })
async function save(name, value) {
  const bytes = Buffer.from(JSON.stringify(value))
  const encrypted = seal(bytes, key)
  await writeFile(join(folder, name + '.gcm'), encrypted, { flag: 'wx' })
  assert.deepEqual(unseal(await readFile(join(folder, name + '.gcm')), key), bytes)
  return { name, bytes: bytes.length, sha256: digest(bytes) }
}
async function rows(table, select, filters = {}) {
  assert.ok(schema.sections.relations.some(r => r.schema_name === 'public' && r.name === table && r.kind === 'r'), 'Unknown source table')
  const params = new URLSearchParams({ select, ...filters, limit: '1000' })
  const response = await fetch(readonlyUrl('/rest/v1/' + table + '?' + params), { method: 'GET', redirect: 'error',
    headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY, Prefer: 'count=exact' }, signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200, 'Read failed for ' + table + ' (' + response.status + ')')
  const result = await response.json()
  const total = Number(response.headers.get('content-range')?.split('/')[1])
  assert.equal(total, result.length, 'Truncated audit: ' + table)
  return result
}
const audit = { project: productionOrigin, capturedAt: new Date().toISOString(), mode: 'read-only-release-inventory',
  inspections: await rows('inspections', 'id,property_id,inspection_family,inspection_variant,status,locked_at'),
  reports: await rows('inspection_report_links', 'id,inspection_id,created_at,revoked_at,pdf_status,pdf_storage_bucket,pdf_storage_path,pdf_sha256,pdf_size_bytes,snapshot_schema_version'),
  administrators: await rows('profiles', 'id,email,is_admin', { is_admin: 'eq.true' }),
  activeOrgAdmins: await rows('org_members', 'org_id,profile_id,role,is_active', { role: 'eq.admin', is_active: 'eq.true' }),
}
const receipt = { ...await save('inventory', audit), schema: await save('schema', schema), folder,
  project: productionOrigin, capturedAt: audit.capturedAt, inspectionCount: audit.inspections.length,
  obCount: audit.inspections.filter(i => i.inspection_family === 'OB').length,
  reports: audit.reports.length, storedReports: audit.reports.filter(r => r.pdf_storage_path).length,
  readyReports: audit.reports.filter(r => r.pdf_status === 'ready').length,
  administratorCount: audit.administrators.length, orgAdminCount: audit.activeOrgAdmins.length,
  backupComplete: false, productionModified: false }
await mkdir(join(root, '.cache/ob-release'), { recursive: true })
await writeFile(join(root, '.cache/ob-release/production-inventory-latest.json'), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(receipt))
key.fill(0)
