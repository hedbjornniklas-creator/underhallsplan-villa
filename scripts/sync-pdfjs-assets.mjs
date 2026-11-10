import { cp, mkdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function syncPdfJsAssets() {
  const require = createRequire(import.meta.url), root = dirname(require.resolve('pdfjs-dist/package.json'))
  const { version } = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'))
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('Invalid PDF.js version')
  const target = resolve('public/vendor/pdfjs', version)
  await mkdir(target, { recursive: true })
  for (const name of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) await cp(resolve(root, name), resolve(target, name), { recursive: true })
  await cp(resolve(root, 'build/pdf.worker.min.mjs'), resolve(target, 'pdf.worker.min.mjs'))
  await cp(resolve(root, 'LICENSE'), resolve(target, 'LICENSE'))
  return target
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await syncPdfJsAssets()
