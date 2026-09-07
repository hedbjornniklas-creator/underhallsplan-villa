import ts from 'typescript'
export default function transpile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  }, fileName: this.resourcePath }).outputText
}
