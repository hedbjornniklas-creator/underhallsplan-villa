export const contractFields = [
  {
    key: 'parties',
    title: 'Parternas kompletterande uppgifter',
    group: 'Parter och handlingar'
  },
  {
    key: 'property',
    title: 'Fastighetsbeteckning och kommun',
    group: 'Parter och handlingar'
  },
  {
    key: 'documents',
    title: 'Avtalshandlingar, datum och inbördes ordning',
    group: 'Parter och handlingar'
  },
  {
    key: 'controls',
    title: 'Kontrollansvarig och beställarens kontrollant',
    group: 'Ansvar och förutsättningar'
  },
  {
    key: 'workEnvironment',
    title: 'Arbetsmiljö, BAS-P och BAS-U',
    group: 'Ansvar och förutsättningar'
  },
  {
    key: 'customerWork',
    title: 'Beställarens arbeten och samordning',
    group: 'Ansvar och förutsättningar'
  },
  {
    key: 'changes',
    title: 'Prissättning och hantering av ÄTA',
    group: 'Ekonomi och genomförande'
  },
  {
    key: 'delay',
    title: 'Försening och eventuellt vite',
    group: 'Ekonomi och genomförande'
  },
  { key: 'inspection', title: 'Besiktning', group: 'Ekonomi och genomförande' },
  {
    key: 'insurance',
    title: 'Försäkringar och försäkringsbevis',
    group: 'Försäkringar och säkerheter'
  },
  {
    key: 'completionProtection',
    title: 'Färdigställandeskydd',
    group: 'Försäkringar och säkerheter'
  },
  { key: 'security', title: 'Säkerheter', group: 'Försäkringar och säkerheter' }
] as const

export type ContractFieldKey = (typeof contractFields)[number]['key']
export type ContractEntry = {
  status: 'unreviewed' | 'specified' | 'document' | 'not_applicable'
  text: string
}
export type CustomerContractDetails = {
  version: 1
  advice: {
    status: 'unreviewed' | 'none' | 'given'
    work: string
    reason: string
    communicatedAt: string
    customerResponse: string
  }
  fields: Record<ContractFieldKey, ContractEntry>
}

export function emptyContractDetails(): CustomerContractDetails {
  return {
    version: 1,
    advice: {
      status: 'unreviewed',
      work: '',
      reason: '',
      communicatedAt: '',
      customerResponse: ''
    },
    fields: Object.fromEntries(
      contractFields.map(({ key }) => [key, { status: 'unreviewed', text: '' }])
    ) as CustomerContractDetails['fields']
  }
}
function invalid(): never {
  throw new Error('CUSTOMER_OFFER_INVALID')
}
function str(value: unknown, max = 6000): string {
  if (typeof value !== 'string' || value.length > max) invalid()
  return value.trim()
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
export function normalizeContractDetails(
  value: unknown
): CustomerContractDetails {
  const input = record(value),
    advice = record(input.advice),
    fields = record(input.fields)
  if (
    input.version !== 1 ||
    !['unreviewed', 'none', 'given'].includes(String(advice.status))
  )
    invalid()
  const result = emptyContractDetails()
  result.advice = {
    status: advice.status as CustomerContractDetails['advice']['status'],
    work: str(advice.work),
    reason: str(advice.reason),
    communicatedAt: str(advice.communicatedAt, 10),
    customerResponse: str(advice.customerResponse)
  }
  const date = result.advice.communicatedAt
  if (
    date &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date)
  )
    invalid()
  for (const { key } of contractFields) {
    const entry = record(fields[key])
    if (
      !['unreviewed', 'specified', 'document', 'not_applicable'].includes(
        String(entry.status)
      )
    )
      invalid()
    result.fields[key] = {
      status: entry.status as ContractEntry['status'],
      text: str(entry.text)
    }
  }
  return result
}
export function contractDetailsIssues(
  value?: CustomerContractDetails,
  structuredParties = false
): string[] {
  // Legacy drafts and signed snapshots are not silently upgraded to a new contract.
  if (!value) return []
  const issues: string[] = []
  if (value.advice.status === 'unreviewed')
    issues.push('Ta ställning till avrådan.')
  if (
    value.advice.status === 'none' &&
    (value.advice.work.trim() ||
      value.advice.reason.trim() ||
      value.advice.customerResponse.trim() ||
      value.advice.communicatedAt)
  )
    issues.push(
      'Avrådan innehåller uppgifter men är markerad som ingen avrådan.'
    )
  if (
    value.advice.status === 'given' &&
    (!value.advice.work.trim() ||
      !value.advice.reason.trim() ||
      !value.advice.communicatedAt ||
      !value.advice.customerResponse.trim())
  )
    issues.push(
      'Komplettera avrådans arbete, skäl, datum och beställarens besked.'
    )
  for (const { key, title } of contractFields) {
    if (key === 'parties' && structuredParties) continue
    const entry = value.fields[key]
    if (entry.status === 'unreviewed' || !entry.text.trim())
      issues.push(`Kontrollera avtalsuppgiften: ${title}.`)
  }
  return issues
}
