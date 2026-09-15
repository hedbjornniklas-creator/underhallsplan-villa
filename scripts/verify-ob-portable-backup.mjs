import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { verifyPortablePackage } from './lib/ob-portable-backup.mjs'

globalThis.fetch = () => { throw new Error('Offline recovery only') }
try {
  const [folder, keyFile, option, output] = process.argv.slice(2)
  assert.ok(folder && keyFile && (!option || option === '--extract-to' && output),
    'Usage: node verify-ob-portable-backup.mjs BACKUP_DIR SEPARATE_KEY_FILE [--extract-to NEW_DIR]')
  const inside = relative(resolve(folder), resolve(keyFile))
  assert.ok(inside.startsWith('..' + sep) || /^[a-z]:/i.test(inside), 'Keep recovery key outside the encrypted package')
  const record = JSON.parse(await readFile(keyFile, 'utf8'))
  const result = await verifyPortablePackage(folder, record, {
    extractTo: output,
    onProgress: ({ verified, total }) => { if (verified % 50 === 0) console.log(`Verified encrypted files: ${verified}/${total}`) },
  })
  console.log(JSON.stringify(result))
} catch {
  // Key material and customer values must not appear in thrown assertion output.
  console.error('Portable backup verification failed. No production changes were made. Check the package, separate key and any partial extraction locally.')
  process.exitCode = 1
}
