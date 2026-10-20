import type { ActionCasePortal } from './contracts'

export const customerSections = [
  { key: 'contract', label: 'Avtal', view: 'offer' },
  { key: 'choices', label: 'Val och tillval', view: 'planning' },
  { key: 'payments', label: 'Betalningsplan', view: 'payments' },
  { key: 'schedule', label: 'Tidsplan', view: 'schedule' },
  { key: 'files', label: 'Bilder och filer', view: 'files' },
] as const
export type CustomerSection = typeof customerSections[number]['key']
export type CustomerVisibility = Record<CustomerSection, boolean>
export const defaultCustomerVisibility = (): CustomerVisibility => ({ contract: true, choices: true, payments: true, schedule: true, files: true })
export type CustomerSharing = { revision: number; tabs: CustomerVisibility; updatedAt: string | null; updatedBy: string | null }
export type CustomerSharingWorkspace = CustomerSharing & { canEdit: boolean; managerId: string | null; recipients: Array<{ id: string; name: string; email: string | null }> }
export function visibilityMutation(value: Record<string, unknown>) {
  if (typeof value.requestId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value.requestId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || Number(value.revision) > 2147483646 || !customerSections.some(s => s.key === value.section) || typeof value.visible !== 'boolean') throw new Error('CUSTOMER_SHARING_INVALID')
  return { requestId: value.requestId, revision: Number(value.revision), section: value.section as CustomerSection, visible: value.visible }
}

// Each separate page receives only its own projection. Shared contracts remain intact.
export function projectCustomerPortal(portal: ActionCasePortal, sharing: CustomerSharing): ActionCasePortal {
  const source = portal.customerOffers, tabs = sharing.tabs
  const all = [
    ...(source?.offers || []),
    ...(source?.externalContracts || []).map(e => ({ ...e.document, status: e.releasedAt ? 'superseded' as const : 'published' as const })),
  ].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const latest = all[0], external = source?.externalContracts?.find(e => e.document.id === latest?.id && !e.releasedAt)
  const accepted = all.find(o => o.status === 'accepted')
  const contract = external ? latest : accepted || all.find(o => o.status === 'published')
  const stage: NonNullable<ActionCasePortal['sharedPayment']>['stage'] = external ? external.signedCopyRegisteredAt ? 'signed' : 'shared' : accepted ? 'accepted' : 'proposed'
  const identity = latest ? { issuerName: latest.snapshot.issuerName, replyEmail: latest.snapshot.replyEmail } : undefined
  return {
    accessState: portal.accessState, participant: portal.participant, sharing: { revision: sharing.revision, tabs },
    customerContact: identity,
    sharedPayment: tabs.payments && contract ? { version: contract.version, stage, plan: contract.snapshot.paymentPlan, terms: contract.snapshot.paymentTerms, conditions: contract.snapshot.paymentConditions } : undefined,
    sharedContractSchedule: tabs.schedule && contract?.snapshot.schedule ? { version: contract.version, accepted: Boolean(accepted), text: contract.snapshot.schedule } : undefined,
    customerOffers: {
      enabled: Boolean(source?.enabled || sharing.revision > 0),
      offers: tabs.contract ? source?.offers || [] : [],
      ...(tabs.contract && source?.externalContracts ? { externalContracts: source.externalContracts } : {}),
      ...(tabs.choices && source?.plannedItems ? { plannedItems: source.plannedItems } : {}),
      ...(tabs.choices && source?.plannedChoices ? { plannedChoices: source.plannedChoices } : {}),
    },
    actionCase: { ...portal.actionCase,
      description: source?.enabled || sharing.revision > 0 ? null : portal.actionCase.description,
      items: source?.enabled || sharing.revision > 0 ? [] : portal.actionCase.items,
      attachments: tabs.files ? portal.actionCase.attachments : [],
      schedule: tabs.schedule ? portal.actionCase.schedule : undefined,
    },
  }
}
