import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Seller from '../src/lib/eb/followUpSeller'
import type * as Company from '../src/lib/publicCompanyInfo'
import type * as Shared from '../src/lib/eb/followUp'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)((id: string) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`)
    return dependencies[id]
  }, compiledModule.exports, compiledModule)
  return compiledModule.exports as T
}
const company = load<typeof Company>('src/lib/publicCompanyInfo.ts', {})
const shared = load<typeof Shared>('src/lib/eb/followUp.ts', {})
const sellerModule = (identity: { PUBLIC_COMPANY_INFO: Company.PublicCompanyInfo; PUBLIC_BESIKTAPP_CONTACT_EMAIL: string } = company) => load<typeof Seller>('src/lib/eb/followUpSeller.ts', {
  '@/lib/publicCompanyInfo': identity, '@/lib/eb/followUp': shared,
})

test('the follow-up seller is the shared HusHub company with the approved BesiktApp contact', () => {
  const seller = sellerModule().getEbFollowUpPlatformSeller()
  assert.deepEqual(seller, { name: 'JNH Consulting AB', orgNumber: '559027-7694',
    address: 'Bryggvägen 7, 117 71 Stockholm', email: 'jn@hedbjorn.se', phone: null })
  assert.equal(seller?.name, company.PUBLIC_COMPANY_INFO.name)
  assert.equal(seller?.email, company.PUBLIC_BESIKTAPP_CONTACT_EMAIL)
  assert.equal(shared.EB_FOLLOW_UP_ADMIN_EMAIL, 'jn@hedbjorn.se')
  assert.equal(shared.EB_FOLLOW_UP_PRICE_ORE, 59_900)
})

test('seller data is a fresh value and never fills gaps from the inspecting organisation', () => {
  const seller = sellerModule().getEbFollowUpPlatformSeller()!
  seller.name = 'An external inspector'
  assert.equal(sellerModule().getEbFollowUpPlatformSeller()?.name, 'JNH Consulting AB')
  const incomplete = { ...company, PUBLIC_COMPANY_INFO: { ...company.PUBLIC_COMPANY_INFO, organizationNumber: '' } }
  assert.equal(sellerModule(incomplete).getEbFollowUpPlatformSeller(), null)
  assert.equal(sellerModule({ ...company, PUBLIC_BESIKTAPP_CONTACT_EMAIL: 'invalid' }).getEbFollowUpPlatformSeller(), null)
})
