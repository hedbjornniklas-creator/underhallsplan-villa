export type ContractCustomer = { name: string; personalNumber: string }
export type ContractContractor = {
  companyName: string
  organizationNumber: string
  contactName: string
  mobile: string
  street: string
  postalCode: string
  city: string
  phone: string
  fax: string
  email: string
  fTax: 'unreviewed' | 'yes' | 'no'
}
export type ContractParties = {
  version: 1
  customers: ContractCustomer[]
  street: string
  postalCode: string
  city: string
  phone: string
  mobile: string
  email: string
  contractor: ContractContractor
}

export function emptyContractParties(name = '', email = '', phone = '', contractor: Partial<ContractContractor> = {}): ContractParties {
  return { version: 1, customers: [{ name, personalNumber: '' }], street: '', postalCode: '', city: '', phone: '', mobile: phone, email,
    contractor: { companyName: '', organizationNumber: '', contactName: '', mobile: '', street: '', postalCode: '', city: '', phone: '', fax: '', email: '', fTax: 'unreviewed', ...contractor } }
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  return value as Record<string, unknown>
}
function text(value: unknown, max = 250): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f]/u.test(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  return value.trim()
}
export function normalizeContractParties(value: unknown): ContractParties {
  const input = record(value), contractor = record(input.contractor)
  if (input.version !== 1 || !Array.isArray(input.customers) || !input.customers.length || input.customers.length > 2 || !['unreviewed', 'yes', 'no'].includes(String(contractor.fTax))) throw new Error('CUSTOMER_OFFER_INVALID')
  const customers = input.customers.map((value) => {
    const customer = record(value)
    return { name: text(customer.name), personalNumber: text(customer.personalNumber, 20) }
  })
  const result = emptyContractParties()
  result.customers = customers
  for (const key of ['street', 'postalCode', 'city', 'phone', 'mobile', 'email'] as const) result[key] = text(input[key])
  for (const key of ['companyName', 'organizationNumber', 'contactName', 'mobile', 'street', 'postalCode', 'city', 'phone', 'fax', 'email'] as const) result.contractor[key] = text(contractor[key])
  result.contractor.fTax = contractor.fTax as ContractContractor['fTax']
  return result
}

export function contractPartiesIssues(parties?: ContractParties): string[] {
  if (!parties) return []
  const issues: string[] = []
  parties.customers.forEach((customer, index) => { if (!customer.name.trim()) issues.push(`Ange namn för beställare ${index + 1}.`) })
  for (const [key, label] of [['street', 'postadress'], ['postalCode', 'postnummer'], ['city', 'ort']] as const) {
    if (!parties[key].trim()) issues.push(`Ange beställarens ${label}.`)
    if (!parties.contractor[key].trim()) issues.push(`Ange entreprenörens ${label}.`)
  }
  for (const [key, label] of [['companyName', 'företagsnamn'], ['organizationNumber', 'organisationsnummer']] as const) if (!parties.contractor[key].trim()) issues.push(`Ange entreprenörens ${label}.`)
  for (const [email, label] of [[parties.email, 'beställaren'], [parties.contractor.email, 'entreprenören']]) if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) issues.push(`Ange en giltig e-postadress för ${label}.`)
  if (parties.contractor.fTax === 'unreviewed') issues.push('Kontrollera entreprenörens F-skatt.')
  // The existing approval verifies one mailbox; it cannot represent two signatures.
  if (parties.customers.length > 1) issues.push('Avtalet har två beställare. Utskick kräver stöd för bådas underskrifter.')
  return issues
}

export function publicContractParties(parties: ContractParties): ContractParties {
  return { ...parties, customers: parties.customers.map((customer) => ({ name: customer.name, personalNumber: '' })), contractor: { ...parties.contractor } }
}

export function contractPartiesSummary(parties: ContractParties): string {
  return `Beställare: ${parties.customers.map((customer) => customer.name).filter(Boolean).join(', ')}. Entreprenör: ${parties.contractor.companyName}.`
}
