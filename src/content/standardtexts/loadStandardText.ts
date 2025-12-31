import 'server-only'

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getStandardTextPath, type StandardTextId } from './registry'

export function loadStandardText(id: StandardTextId): string {
  const relativePath = getStandardTextPath(id)
  const fullPath = resolve(process.cwd(), relativePath)

  if (!existsSync(fullPath)) {
    throw new Error(
      `Kunde inte hitta standardtext "${id}". Förväntad sökväg: ${fullPath}`
    )
  }

  return readFileSync(fullPath, 'utf8')
}
