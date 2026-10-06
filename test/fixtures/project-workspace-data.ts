import type { ActionCaseItemView, ActionCaseView, ActionCaseWorkspace } from '../../src/lib/action-cases/contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function item(n: number, title: string, scope: string): ActionCaseItemView {
  return { id: id(n), title, scope, scopeConditionsAvailable: true, scopeConditions: '', scopeNotesAvailable: true, scopeExclusions: '', scopeAdvice: '', lumpSumAvailable: true, lumpSum: null, status: scope ? 'pricing_needed' : 'scope_needed', sortOrder: n,
    ownLaborReady: false, materialPriceReady: false, subcontractorPriceReady: false, wasteSolutionReady: false,
    requiresSubcontractor: false, estimatedCost: null, customerPrice: null, costLines: [], costSuggestion: null,
    updatedAt: '2026-10-01T09:00:00Z' }
}
export function projectFixture(actionCase: ActionCaseView): ActionCaseWorkspace {
  return { summary: { active: 2, pricingNeeded: 3, waitingSubcontractor: 0, awaitingCustomer: 0, readyToSchedule: 0, readyToInvoice: 0 },
    cases: [
      { ...structuredClone(actionCase), items: [item(101, 'Grund och stomme', 'Tillbyggnad enligt ritning. Kontrollera omfattningen innan prissättning.'), item(102, 'Fönster och montage', 'Val av leverantör hanteras separat.')] },
      { ...structuredClone(actionCase), id: id(201), title: 'Innervägg och målning', propertyAddress: 'Testgatan 8', customerName: 'Bo Exempel', customerEmail: 'bo@example.test', participants: [], attachments: [], items: [item(202, 'Bygga innervägg', ''), item(203, 'Måla väggen', '')] },
      { ...structuredClone(actionCase), id: id(301), title: 'Badrumsrenovering', propertyAddress: 'Provvägen 3', status: 'completed', customerName: 'Cecilia Exempel', participants: [], attachments: [], items: [] },
    ] }
}
