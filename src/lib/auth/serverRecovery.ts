import 'server-only'

import { headers } from 'next/headers'
import { safeAuthReturnPath } from '@/lib/auth/returnPath'

/** The proxy overwrites this header from the original protected request URL. */
export async function currentAuthReturnPath(fallback = '/app'): Promise<string> {
  const requestHeaders = await headers()
  return safeAuthReturnPath(requestHeaders.get('x-hushub-return-path'), fallback)
}

const permissionFailures = new Set([
  'PRODUCT_ACCESS_REQUIRED',
  'MODULE_ACCESS_REQUIRED',
  'ORG_MEMBERSHIP_REQUIRED',
  'ORG_ADMIN_REQUIRED',
  'RENOAPP_MEMBERSHIP_REQUIRED',
  'MOISTURE_FORBIDDEN',
  'FORBIDDEN',
])

/** Unexpected technical failures must not imply that an active grant was revoked. */
export function authRecoveryReason(error: unknown): 'forbidden' | 'unavailable' {
  return error instanceof Error && permissionFailures.has(error.message) ? 'forbidden' : 'unavailable'
}
