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
export const contractParticipantFields = [
  { key: 'controlOfficer', title: 'Kontrollansvarig enligt plan- och bygglagen' },
  { key: 'customerInspector', title: 'Beställarens kontrollant' }
] as const
export type ContractParticipants = {
  controlOfficer: string
  customerInspector: string
  previousDetails?: ContractEntry
}
export type CustomerContractDetails = {
  version: 1
  controlParticipants?: ContractParticipants
  advice: {
    status: 'unreviewed' | 'none' | 'given'
    work: string
    reason: string
    communicatedAt: string
    customerResponse: string
  }
  fields: Record<ContractFieldKey, ContractEntry>
}

export function editedContractEntry(text: string): ContractEntry {
  return { text, status: text.trim() ? 'specified' : 'unreviewed' }
}

export function contractEntryText(entry: ContractEntry): string {
  if (!entry.text) return ''
  const prefix = entry.status === 'document' ? 'Avtalshandling: ' : entry.status === 'not_applicable' ? 'Ej aktuellt: ' : ''
  return `${prefix}${entry.text}`
}

export function contractParticipantsForEditing(value: CustomerContractDetails): ContractParticipants {
  return value.controlParticipants ?? {
    controlOfficer: '', customerInspector: '',
    ...(value.fields.controls.text.trim() ? { previousDetails: value.fields.controls } : {})
  }
}

function participantsEntry(participants: ContractParticipants): ContractEntry {
  const lines = contractParticipantFields.flatMap(({ key, title }) =>
    participants[key].trim() ? [`${title}: ${participants[key]}`] : [])
  if (!lines.length && participants.previousDetails?.text.trim()) return { ...participants.previousDetails }
  if (participants.previousDetails?.text.trim()) lines.push(contractEntryText(participants.previousDetails))
  const completePrevious = participants.previousDetails?.status !== 'unreviewed' && participants.previousDetails?.text.trim()
  return {
    status: completePrevious || contractParticipantFields.every(({ key }) => participants[key].trim()) ? 'specified' : 'unreviewed',
    text: lines.join('\n\n')
  }
}

export function editContractParticipants(value: CustomerContractDetails, patch: Partial<ContractParticipants>): CustomerContractDetails {
  const controlParticipants = { ...contractParticipantsForEditing(value), ...patch }
  return { ...value, controlParticipants, fields: { ...value.fields, controls: participantsEntry(controlParticipants) } }
}

export function contractParticipantTextLimit(value: CustomerContractDetails, key: (typeof contractParticipantFields)[number]['key'] | 'previousDetails'): number {
  const participants = contractParticipantsForEditing(value)
  if (key === 'previousDetails') {
    const without = participantsEntry({ ...participants, previousDetails: undefined }).text
    return Math.max(0, 6000 - without.length - (without ? 2 : 0))
  }
  const otherLines = contractParticipantFields.flatMap((field) => field.key !== key && participants[field.key].trim() ? [`${field.title}: ${participants[field.key]}`] : [])
  if (participants.previousDetails?.text.trim()) otherLines.push(contractEntryText(participants.previousDetails))
  const without = otherLines.join('\n\n')
  const title = contractParticipantFields.find((field) => field.key === key)!.title
  return Math.max(0, Math.min(2000, 6000 - without.length - (without ? 2 : 0) - title.length - 2))
}

export function contractFieldSummary(value: CustomerContractDetails | undefined, keys: ContractFieldKey[]): string {
  if (keys.length === 1 && keys[0] === 'controls' && value) {
    const participants = contractParticipantsForEditing(value)
    const count = contractParticipantFields.filter(({ key }) => participants[key].trim()).length
    return participants.previousDetails?.text.trim() ? `${count}/2 roller angivna · Gemensamma uppgifter finns` : `${count}/2 roller angivna`
  }
  const complete = keys.filter((key) => value?.fields[key].status !== 'unreviewed' && value?.fields[key].text.trim()).length
  return `${complete}/${keys.length} uppgifter ifyllda`
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
function normalizeEntry(value: unknown): ContractEntry {
  const entry = record(value)
  if (!['unreviewed', 'specified', 'document', 'not_applicable'].includes(String(entry.status))) invalid()
  return { status: entry.status as ContractEntry['status'], text: str(entry.text) }
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
    result.fields[key] = normalizeEntry(fields[key])
  }
  if (input.controlParticipants !== undefined) {
    const participants = record(input.controlParticipants)
    result.controlParticipants = {
      controlOfficer: str(participants.controlOfficer, 2000),
      customerInspector: str(participants.customerInspector, 2000),
      ...(participants.previousDetails === undefined ? {} : { previousDetails: normalizeEntry(participants.previousDetails) })
    }
    // Keep the existing database field readable by older clients, without guessing roles.
    result.fields.controls = participantsEntry(result.controlParticipants)
    if (result.fields.controls.text.length > 6000) invalid()
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
    if (key === 'controls' && value.controlParticipants) {
      const participants = value.controlParticipants
      if (participants.previousDetails?.status !== 'unreviewed' && participants.previousDetails?.text.trim()) continue
      for (const { key: participantKey, title: participantTitle } of contractParticipantFields) {
        if (!participants[participantKey].trim()) issues.push(`Kontrollera avtalsuppgiften: ${participantTitle}. Ange person eller beskriv om ingen är utsedd.`)
      }
      continue
    }
    const entry = value.fields[key]
    if (entry.status === 'unreviewed' || !entry.text.trim())
      issues.push(`Kontrollera avtalsuppgiften: ${title}.`)
  }
  return issues
}
