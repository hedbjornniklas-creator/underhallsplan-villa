import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, '../..')
export function environmentalLoader(mocks: Record<string, unknown> = {}) {
  const cache = new Map<string, { exports: unknown }>()
  function load(file: string): unknown {
    file = resolve(root, file)
    if (!existsSync(file)) file += existsSync(`${file}.tsx`) ? '.tsx' : '.ts'
    if (cache.has(file)) return cache.get(file)!.exports
    const mod = { exports: {} }; cache.set(file, mod)
    const source = ts.transpileModule(readFileSync(file, 'utf8'), { fileName: file, compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText
    new Function('require', 'module', 'exports', source)((name: string) => {
      if (name in mocks) return mocks[name]
      if (name.startsWith('@/')) return load(resolve(root, 'src', name.slice(2)))
      if (name.startsWith('.')) return load(resolve(dirname(file), name))
      return require(name)
    }, mod, mod.exports)
    return mod.exports
  }
  return <T>(file: string) => load(file) as T
}
