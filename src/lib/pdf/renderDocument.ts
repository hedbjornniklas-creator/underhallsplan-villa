import { renderToBuffer, type DocumentProps } from '@react-pdf/renderer'
import type { ReactElement } from 'react'

// Shared server renderer for snapshot-based documents; no browser or remote assets.
export async function renderPdfDocument(document: ReactElement<DocumentProps>): Promise<Buffer> {
  const bytes = await renderToBuffer(document)
  return Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)
}
