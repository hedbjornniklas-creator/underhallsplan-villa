import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { EbFollowUpConfirmation } from '../../src/lib/eb/followUpConfirmation'
import type * as Terms from '../../src/lib/eb/followUpTerms'

// Evaluate only the pure checkout constants/text. No database, secrets or mail.
function load(file: string, dependencies: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../../src/lib/eb/${file}.ts`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected fixture dependency ${name}`)
  }, compiledModule.exports, compiledModule)
  return compiledModule.exports
}
const terms = load('followUpTerms', { './followUp': load('followUp') }) as typeof Terms

export function confirmationFixture(customerType: 'consumer' | 'business' = 'consumer'): EbFollowUpConfirmation {
  const seller = { name: 'Exempelföretaget AB', orgNumber: '000000-0000', address: 'Exempelgatan 7, 123 45 Exempelstad', email: 'kontakt@example.invalid' }
  const termsText = terms.getEbFollowUpTermsText({ seller, customerType })
  return {
    version: 1, orderId: 'cfe2174a-8511-4e14-96c9-12deacf91234',
    project: { title: 'Renovering av villa', propertyDesignation: 'EXEMPELGÅRDEN 1:23', address: 'Villavägen 13, 123 45 Exempelstad',
      customerName: 'Anna och Erik Andersson', inspectionLabel: 'Slutbesiktning 1', inspectionDate: '2026-09-03', reportNumber: 'EB 2026-0903-01' },
    price: { totalOre: 59900, netOre: 47920, vatOre: 11980, vatRate: 25 },
    seller, withdrawalFormText: terms.getEbFollowUpWithdrawalFormText(seller),
    buyer: { name: 'Anna Andersson', email: 'anna@example.invalid', customerType,
      invoiceName: customerType === 'consumer' ? 'Anna Andersson' : 'Exemplets bostadsrättsförening',
      invoiceAddress: 'Villavägen 13', invoicePostalCode: '123 45', invoiceCity: 'Exempelstad', invoiceOrgNo: customerType === 'business' ? '000000-0000' : null,
      acceptanceSnapshot: { acceptedAt: '2026-09-08T11:23:40.308Z', termsVersion: '2026-09-08.2', termsText,
        termsHash: createHash('sha256').update(termsText).digest('hex'), withdrawalDeadline: customerType === 'consumer' ? '2026-09-22' : null,
        withdrawalFormUrl: terms.EB_FOLLOW_UP_WITHDRAWAL_FORM_URL, consentTexts: terms.getEbFollowUpConsentTexts(customerType),
        consents: { acceptTerms: true, requestImmediateStart: true, acceptInvoice: true, consumerWithdrawalAcknowledged: customerType === 'consumer' } },
    },
  }
}
