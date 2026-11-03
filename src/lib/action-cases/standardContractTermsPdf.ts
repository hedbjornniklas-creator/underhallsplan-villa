import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { appendPdfPages } from '../pdf/appendPages.ts'
// @ts-expect-error Explicit extensions support the shared Node PDF test runner.
import { HF17_TERMS } from './standardContractTerms.ts'

export async function appendHf17TermsPdf(base: Uint8Array): Promise<Buffer> {
  const original = await readFile(join(process.cwd(), HF17_TERMS.assetPath))
  if (original.length !== HF17_TERMS.size || createHash('sha256').update(original).digest('hex') !== HF17_TERMS.sha256)
    throw new Error('CUSTOMER_OFFER_STANDARD_TERMS')
  // This verified edition has three form pages followed by the unchanged general terms.
  return appendPdfPages(base, original, [3])
}
