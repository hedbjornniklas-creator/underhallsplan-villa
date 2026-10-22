import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as jsx from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import * as pricing from '../src/lib/action-cases/contractPricing.ts'
import { choiceOfferForEditing } from '../src/lib/action-cases/choiceOffer.ts'
import { money } from '../src/lib/action-cases/customerOffers.ts'
const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/CustomerChoicePriceTime.tsx', import.meta.url), 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const mod = { exports: {} }
const deps = { 'react/jsx-runtime': jsx, 'lucide-react': { Plus: () => null, Trash2: () => null }, '@/lib/action-cases/contractPricing': pricing, '@/lib/action-cases/customerOffers': { money }, './CustomerOfferPriceInput': { default: () => null } }
new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, mod, mod.exports)
test('legacy calculated customer prices can select priced rows without first changing another field', () => {
  const base = choiceOfferForEditing({ budgetOre: 10000 })
  for (const priceSource of ['calculation', 'manual']) {
    const html = renderToStaticMarkup(jsx.jsx(mod.exports.default, { value: { ...base, priceSource }, onChange() {} }))
    const option = html.match(/<option[^>]*value="priced"[^>]*>/)?.[0]
    assert.ok(option)
    assert.equal(option.includes('disabled'), priceSource === 'manual')
  }
})
