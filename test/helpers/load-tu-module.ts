import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const root = resolve(import.meta.dirname, '../..')
const nativeRequire = createRequire(import.meta.url)
export function loadTuModule<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const filename = resolve(root, path)
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    fileName: filename,
  }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)((id: string) => {
    if (id in dependencies) return dependencies[id]
    if (id === 'server-only') return {}
    if (id.startsWith('@/')) return loadTuModule(id.replace('@/', 'src/') + (id.endsWith('.ts') ? '' : '.ts'), dependencies)
    if (id.startsWith('.')) return loadTuModule(resolve(dirname(filename), id + (id.endsWith('.ts') ? '' : '.ts')), dependencies)
    return nativeRequire(id)
  }, mod, mod.exports)
  return mod.exports as T
}
