// @ts-expect-error Node strip-types tests require the explicit extension.
import { emptyPropertyDetails, normalizePropertyDetails, propertyDetailsText, propertyDetailsComplete, propertyFields, propertyIdentityKey, type PropertyDetails } from '../properties/identity.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { normalizeAssignment, assignmentIssues, assignmentDocumentsText, type ContractAssignment } from './contractAssignment.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { changesEntry, changesIssues, normalizeContractChanges, type ContractChanges } from './contractChanges.ts'

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
  changesPricing?: ContractChanges
  otherAgreements?: string
  workEnvironmentDefaultVersion?: 'abs18-2018-06'
  assignment?: ContractAssignment
  property?: PropertyDetails & { sourcePropertyId?: string }
  propertyReference?: string
  controlParticipants?: ContractParticipants
  advice: {
    format?: 'contract-fields'
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
  return {
    controlOfficer: value.controlParticipants?.controlOfficer ?? '',
    customerInspector: value.controlParticipants?.customerInspector ?? ''
  }
}

export function contractDetailsForEditing(value: CustomerContractDetails): CustomerContractDetails {
  const details = editContractParticipants(value, {})
  if (details.otherAgreements !== undefined) return details
  // Preserve the old free text under Other; do not classify it as a scope exclusion.
  return { ...details, otherAgreements: contractEntryText(details.fields.customerWork),
    fields: { ...details.fields, customerWork: { status: 'unreviewed', text: '' } } }
}

export const contractAdviceFields = [
  { key: 'work', title: 'Entreprenören har avrått beställaren från följande i kontraktsarbetena ingående arbeten' },
  { key: 'reason', title: 'På grund av' }
] as const

export function contractAdviceForEditing(value: CustomerContractDetails): CustomerContractDetails {
  if (value.advice.format === 'contract-fields') return value
  return editContractAdvice(value, {})
}

export function editContractAdvice(value: CustomerContractDetails, patch: Partial<Pick<CustomerContractDetails['advice'], 'work' | 'reason'>>): CustomerContractDetails {
  const advice = { ...value.advice, ...patch, format: 'contract-fields' as const }
  advice.status = advice.work.trim() || advice.reason.trim() ? 'given' : 'none'
  return { ...value, advice }
}

export function contractAdviceSummary(value?: CustomerContractDetails): string {
  const count = contractAdviceFields.filter(({ key }) => value?.advice[key].trim()).length
  return count === 2 ? 'Avrådande angivet' : count === 1 ? 'Behöver kompletteras' : 'Inte angivet'
}

export function editContractProperty(value: CustomerContractDetails, patch: Partial<PropertyDetails>, street = ''): CustomerContractDetails {
  const previous = value.property ?? emptyPropertyDetails(street)
  const property: NonNullable<CustomerContractDetails['property']> = { ...previous, ...patch }
  if (propertyIdentityKey(property) !== propertyIdentityKey(previous)) delete property.sourcePropertyId
  return { ...value, ...(!value.property && value.fields.property.text ? { propertyReference: value.fields.property.text } : {}), property, fields: { ...value.fields, property: {
    status: propertyDetailsComplete(property) ? 'specified' : 'unreviewed', text: propertyDetailsText(property)
  } } }
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

export function editContractParticipants(value: CustomerContractDetails, patch: Partial<Pick<ContractParticipants, 'controlOfficer' | 'customerInspector'>>): CustomerContractDetails {
  const participants = contractParticipantsForEditing(value)
  const controlParticipants = {
    controlOfficer: patch.controlOfficer ?? participants.controlOfficer,
    customerInspector: patch.customerInspector ?? participants.customerInspector
  }
  return { ...value, controlParticipants, fields: { ...value.fields, controls: participantsEntry(controlParticipants) } }
}

export function contractFieldSummary(value: CustomerContractDetails | undefined, keys: ContractFieldKey[]): string {
  if (keys.length === 1 && keys[0] === 'property' && value?.property) {
    return [value.property.cadastralDesignation, value.property.municipality].filter(Boolean).join(' · ') || 'Fastighetsuppgifter saknas'
  }
  if (keys.length === 1 && keys[0] === 'controls' && value) {
    const participants = contractParticipantsForEditing(value)
    const count = contractParticipantFields.filter(({ key }) => participants[key].trim()).length
    return `${count}/2 roller angivna`
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
  if (advice.format !== undefined) {
    if (advice.format !== 'contract-fields') invalid()
    result.advice.format = advice.format
    const expectedStatus = result.advice.work || result.advice.reason ? 'given' : 'none'
    if (result.advice.status !== expectedStatus) invalid()
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
  if (input.workEnvironmentDefaultVersion !== undefined) {
    if (input.workEnvironmentDefaultVersion !== 'abs18-2018-06') invalid()
    result.workEnvironmentDefaultVersion = input.workEnvironmentDefaultVersion
  }
  if (input.otherAgreements !== undefined) {
    result.otherAgreements = str(input.otherAgreements, 6200)
    if (result.fields.customerWork.text || result.fields.customerWork.status !== 'unreviewed') invalid()
  }
  if (input.assignment !== undefined) {
    result.assignment = normalizeAssignment(input.assignment)
    result.fields.documents = { status: assignmentIssues(result.assignment).length ? 'unreviewed' : 'specified', text: assignmentDocumentsText }
  }
  if (input.propertyReference !== undefined) result.propertyReference = str(input.propertyReference)
  if (input.property !== undefined) {
    try { result.property = normalizePropertyDetails(input.property) } catch { invalid() }
    const source = record(input.property).sourcePropertyId
    if (source !== undefined) {
      if (typeof source !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(source)) invalid()
      result.property!.sourcePropertyId = source
    }
    result.fields.property = { status: propertyDetailsComplete(result.property!) ? 'specified' : 'unreviewed', text: propertyDetailsText(result.property!) }
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
  if (input.changesPricing !== undefined) {
    result.changesPricing = normalizeContractChanges(input.changesPricing)
    result.fields.changes = changesEntry(result.changesPricing)
    const annex = result.changesPricing.mode === 'attachment' ? result.changesPricing.annex : null
    if (annex && !result.assignment?.documents.some((doc) => doc.fileId === annex.fileId && doc.name === annex.name && doc.type === annex.type && doc.date === annex.date)) invalid()
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
  if (value.advice.format === 'contract-fields') {
    if (Boolean(value.advice.work.trim()) !== Boolean(value.advice.reason.trim()))
      issues.push('Komplettera avrådandets arbeten och på grund av vad entreprenören avråder.')
  } else {
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
  }
  for (const { key, title } of contractFields) {
    if (key === 'changes' && value.changesPricing) {
      issues.push(...changesIssues(value.changesPricing))
      continue
    }
    if (key === 'customerWork' && value.otherAgreements !== undefined) continue
    if (key === 'parties' && structuredParties) continue
    if (key === 'documents' && value.assignment) {
      issues.push(...assignmentIssues(value.assignment))
      continue
    }
    if (key === 'property' && value.property) {
      for (const { key: propertyKey, title: propertyTitle, required } of propertyFields) {
        if (required && !value.property[propertyKey].trim()) issues.push(`Komplettera fastighetens ${propertyTitle.toLowerCase()}.`)
      }
      continue
    }
    if (key === 'controls') {
      const participants = contractParticipantsForEditing(value)
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
