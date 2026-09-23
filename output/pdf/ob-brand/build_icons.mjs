import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as icons from 'lucide-react'

const out = resolve(dirname(fileURLToPath(import.meta.url)), 'assets/icons')
await mkdir(out, { recursive: true })
for (const name of ['ArrowLeft', 'ArrowRightLeft', 'Trash2', 'Menu', 'MapPin',
  'Camera', 'Images', 'Inbox', 'ChevronRight', 'Plus', 'Search', 'Check',
  'TriangleAlert', 'WifiOff', 'FileText', 'Building2', 'House', 'Link2', 'Pencil']) {
  const svg = renderToStaticMarkup(React.createElement(icons[name], { size: 24, color: '#25312D', strokeWidth: 1.8 }))
  await writeFile(resolve(out, `${name}.svg`), svg)
}
await copyFile(resolve('node_modules/lucide-react/LICENSE'), resolve(out, 'LICENSE'))
console.log('Exported 19 Lucide icons for the OB profile.')
