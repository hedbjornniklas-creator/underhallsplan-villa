import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function encryptionKey() {
  const secret = process.env.TU_REPORT_LINK_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('TU_REPORT_LINK_ENCRYPTION_KEY_MISSING')
  return createHash('sha256').update(`tu-report-link-v1:${secret}`).digest()
}

export function encryptTuReportLinkToken(token: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptTuReportLinkToken(ciphertext: string) {
  const [version, iv, tag, payload] = ciphertext.split('.')
  if (version !== 'v1' || !iv || !tag || !payload) throw new Error('TU_REPORT_LINK_TOKEN_INVALID')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(payload, 'base64url')), decipher.final()]).toString('utf8')
}
