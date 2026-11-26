import * as presentation from '../../src/lib/action-cases/customerPresentation.ts'

// Legacy renderer unit tests exercise their original inclusive display without
// mounting a React tree. The real provider and basis switching are covered by
// the customer-presentation browser integration tests.
export const legacyCustomerPriceDisplay = {
  CustomerPriceDisplay: ({ children }) => children,
  CustomerPriceTotals: () => null,
  useCustomerPriceDisplay: () => ({ presentation: null, basis: 'incl', label: 'inkl. moms', text: value => value,
    money: value => presentation.customerMoney(value), display: value => value, store: value => value }),
}
export function withLegacyCustomerPresentation(load) {
  return name => {
    if (name === './CustomerPriceDisplay') {
      let format
      try { format = load('@/lib/action-cases/customerOffers')?.money } catch { /* Some field-only unit tests have no money dependency. */ }
      return { ...legacyCustomerPriceDisplay, useCustomerPriceDisplay: () => ({ ...legacyCustomerPriceDisplay.useCustomerPriceDisplay(), ...(typeof format === 'function' ? { money: format } : {}) }) }
    }
    if (name === '@/lib/action-cases/customerPresentation') return presentation
    if (name === './customerPresentationServer') return { getProjectCustomerPresentation: async () => ({ available: false, revision: 0, value: null }) }
    const result = load(name)
    if (name === './CustomerOfferPriceInput') return { ...result, CustomerPriceInput: result.default }
    return result
  }
}
