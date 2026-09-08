import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { StandardTextId } from '../src/content/standardtexts/registry'

const require = createRequire(import.meta.url)
const standardTextRoot = join(process.cwd(), 'src/content/standardtexts')

// Exercise the server implementation without Next's server-only import guard.
// Only the explicitly supplied filesystem is replaced; no storage or network
// services are available to these modules.
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'node:path') return require(name)
    throw new Error(`Unexpected test dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

type Registry = {
  STANDARD_TEXT_PATHS: Record<StandardTextId, string>
  getStandardTextPath: (id: StandardTextId) => string
  listStandardTextIds: () => StandardTextId[]
}
type Loader = { loadStandardText: (id: StandardTextId) => string }

const registry = load<Registry>('src/content/standardtexts/registry.ts', {})
function loader(filesystem: Record<string, unknown>, registryDependency: unknown = registry): Loader {
  return load<Loader>('src/content/standardtexts/loadStandardText.ts', {
    'server-only': {}, './registry': registryDependency, 'node:fs': filesystem,
  })
}

test('every registered standard text loads its existing UTF-8 file within the standard-text directory', () => {
  const reads: string[] = []
  const assertBoundedPath = (path: string) => {
    assert.equal(typeof path, 'string')
    assert.ok(isAbsolute(path), `Expected an absolute filesystem path: ${path}`)
    const suffix = relative(standardTextRoot, path)
    assert.ok(suffix && suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix),
      `Filesystem access escaped the standard-text directory: ${path}`)
  }
  const api = loader({
    existsSync: (path: string) => {
      assertBoundedPath(path)
      return existsSync(path)
    },
    readFileSync: (path: string, encoding: string) => {
      assertBoundedPath(path)
      assert.equal(encoding, 'utf8')
      reads.push(path)
      return readFileSync(path, 'utf8')
    },
  })
  const ids = registry.listStandardTextIds()
  assert.ok(ids.length > 0)
  assert.deepEqual(new Set(ids), new Set(Object.keys(registry.STANDARD_TEXT_PATHS)))
  for (const id of ids) {
    const registeredPath = registry.getStandardTextPath(id)
    assert.ok(registeredPath.startsWith('src/content/standardtexts/'), id)
    const expectedPath = resolve(process.cwd(), registeredPath)
    const rawText = readFileSync(expectedPath, 'utf8')
    assert.doesNotMatch(rawText, /\uFFFD/, `${id} contains invalid UTF-8`)
    assert.equal(api.loadStandardText(id), rawText, `${id} changed existing file contents`)
    assert.equal(reads.at(-1), expectedPath, `${id} read a different file`)
  }
  assert.equal(reads.length, ids.length)
})

test('EB, OB and TU texts retain their Swedish content', () => {
  const api = loader({ existsSync, readFileSync })
  assert.match(api.loadStandardText('EB_REPORT_SCOPE'), /Funktionsprovningar av hushållsmaskiner/)
  assert.match(api.loadStandardText('STD_VISUAL_INSPECTION_PREFACE'), /Särskilda förutsättningar vid besiktningen/)
  assert.match(api.loadStandardText('STD_ASSIGNMENT_TEMPLATE_TU_2026'), /VILLKOR FÖR TEKNISK UTREDNING/)
})

test('the loader preserves its single- and double-encoded mojibake repair for EB, OB and TU', () => {
  const singleEncoded = '\u00c3\u00a4 \u00c3\u00a5 \u00c3\u00b6 \u00c3\u201e \u00c3\u2026 \u00c3\u2013 \u00c3\u00a9 \u00c3\u2030'
  const doubleEncoded = '\u00c3\u0192\u00c2\u00a4 \u00c3\u0192\u00c2\u00a5 \u00c3\u0192\u00c2\u00b6 \u00c3\u0192\u00e2\u20ac\u017e \u00c3\u0192\u00e2\u20ac\u00a6 \u00c3\u0192\u00e2\u20ac\u201c \u00c3\u0192\u00c2\u00a9 \u00c3\u0192\u00e2\u20ac\u00b0'
  const unchanged = 'Redan korrekt: ä å ö Ä Å Ö é É.\n'
  const api = loader({
    existsSync: () => true,
    readFileSync: (_path: string, encoding: string) => {
      assert.equal(encoding, 'utf8')
      return `${unchanged}${singleEncoded}\n${doubleEncoded}\n`
    },
  })
  for (const id of ['EB_REPORT_SCOPE', 'STD_VISUAL_INSPECTION_PREFACE', 'STD_ASSIGNMENT_TEMPLATE_TU_2026'] as const) {
    assert.equal(api.loadStandardText(id), `${unchanged}ä å ö Ä Å Ö é É\nä å ö Ä Å Ö é É\n`, id)
  }
})

test('unknown IDs fail before attempting filesystem access', () => {
  const accesses: string[] = []
  const api = loader({
    existsSync: (path: string) => { accesses.push(path); return true },
    readFileSync: (path: string) => { accesses.push(path); return 'unexpected text' },
  })
  for (const id of ['UNKNOWN_STANDARD_TEXT', '../package.json', '__proto__', 'constructor']) {
    assert.throws(() => api.loadStandardText(id as StandardTextId))
  }
  assert.deepEqual(accesses, [])
})

test('invalid registry paths fail closed before attempting filesystem access', () => {
  const invalidPaths: unknown[] = [
    undefined, null, 42, {}, '',
    '../package.json',
    resolve(process.cwd(), 'package.json'),
    'src/content/standardtexts-other/EB_REPORT_SCOPE.txt',
    'src/content/standardtexts/',
    'src/content/standardtexts/../package.json',
    'src/content/standardtexts/eb/../../package.json',
    'src/content/standardtexts/..\\package.json',
    'src/content/standardtexts/eb\\..\\..\\package.json',
    'src/content/standardtexts//etc/passwd',
    'src/content/standardtexts/C:\\outside.txt',
  ]
  for (const invalidPath of invalidPaths) {
    const accesses: string[] = []
    const api = loader({
      existsSync: (path: string) => { accesses.push(path); return true },
      readFileSync: (path: string) => { accesses.push(path); return 'unexpected text' },
    }, { getStandardTextPath: () => invalidPath })
    assert.throws(() => api.loadStandardText('EB_REPORT_SCOPE'), `Accepted registry path: ${String(invalidPath)}`)
    assert.deepEqual(accesses, [], `Inspected invalid registry path: ${String(invalidPath)}`)
  }
})

test('a missing registered file throws without attempting to read it', () => {
  let reads = 0
  const api = loader({
    existsSync: () => false,
    readFileSync: () => { reads += 1; return 'unexpected text' },
  })
  assert.throws(() => api.loadStandardText('EB_REPORT_SCOPE'))
  assert.equal(reads, 0)
})
