import 'server-only'

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getStandardTextPath, type StandardTextId } from './registry'

function repairMojibake(value: string) {
  return String(value ?? '')
    .replace(/\u00c3\u0192\u00c2\u00a4/g, '\u00e4')
    .replace(/\u00c3\u0192\u00c2\u00a5/g, '\u00e5')
    .replace(/\u00c3\u0192\u00c2\u00b6/g, '\u00f6')
    .replace(/\u00c3\u0192\u00e2\u20ac\u017e/g, '\u00c4')
    .replace(/\u00c3\u0192\u00e2\u20ac\u00a6/g, '\u00c5')
    .replace(/\u00c3\u0192\u00e2\u20ac\u201c/g, '\u00d6')
    .replace(/\u00c3\u0192\u00c2\u00a9/g, '\u00e9')
    .replace(/\u00c3\u0192\u00e2\u20ac\u00b0/g, '\u00c9')
    .replace(/\u00c3\u00a4/g, '\u00e4')
    .replace(/\u00c3\u00a5/g, '\u00e5')
    .replace(/\u00c3\u00b6/g, '\u00f6')
    .replace(/\u00c3\u201e/g, '\u00c4')
    .replace(/\u00c3\u2026/g, '\u00c5')
    .replace(/\u00c3\u2013/g, '\u00d6')
    .replace(/\u00c3\u00a9/g, '\u00e9')
    .replace(/\u00c3\u2030/g, '\u00c9')
}

export function loadStandardText(id: StandardTextId): string {
  const relativePath = getStandardTextPath(id)
  const prefix = 'src/content/standardtexts/'
  if (typeof relativePath !== 'string' || !relativePath.startsWith(prefix)) {
    throw new Error(`Ogiltig sökväg för standardtext "${id}".`)
  }
  const filename = relativePath.slice(prefix.length)
  if (
    filename.includes('\\') || filename.includes(':') ||
    filename.split('/').some(part => !part || part === '.' || part === '..') ||
    !filename.endsWith('.txt')
  ) {
    throw new Error(`Ogiltig sökväg för standardtext "${id}".`)
  }

  // Keep the fixed directory inside the fs path expression. A dynamic path
  // joined directly to cwd makes deployment tracing include the whole repo.
  const fullPath = join(process.cwd(), 'src/content/standardtexts', filename)

  if (!existsSync(fullPath)) {
    throw new Error(
      `Kunde inte hitta standardtext "${id}". Förväntad sökväg: ${fullPath}`
    )
  }

  return repairMojibake(readFileSync(fullPath, 'utf8'))
}
