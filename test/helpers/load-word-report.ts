import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'

const require = createRequire(resolve('package.json'))
const bundled = process.env.DOCUMENT_NODE_MODULES
  ? createRequire(resolve(process.env.DOCUMENT_NODE_MODULES, '../package.json')) : require

export function loadWordModule<T>(file: string, deps: Record<string, unknown> = {}): T {
  const path = resolve(file)
  const source = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', source)((name: string) => {
    if (name in deps) return deps[name]
    if (name === 'server-only') return {}
    if (name.startsWith('@/') || name.startsWith('.')) {
      const target = name.startsWith('@/') ? resolve('src', name.slice(2)) : resolve(path, '..', name)
      const filename = [target, `${target}.ts`, `${target}.tsx`].find(existsSync)
      if (!filename) throw Error(`Missing ${name} from ${path}`)
      if (filename.endsWith('.json')) return require(filename)
      return loadWordModule(filename, deps)
    }
    return ['docx', 'sharp'].includes(name) ? bundled(name) : require(name)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
