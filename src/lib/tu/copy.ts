export type TuCopyExtraFields = {
  customerIdentityNumber: string
  customerRole: string
  invoiceName: string
  invoiceAddress: string
}

export type TuCopySource = {
  inspectionId: string
  title: string
  reportTemplateKey: string
  objectType: 'villa' | 'apartment'
  customerType: 'consumer' | 'business'
  customerName: string
  customerEmail: string
  customerPhone: string
  customerAddress: string
  customerPostalCode: string
  customerCity: string
  invoiceEmail: string
  propertyAddress: string
  propertyPostalCode: string
  propertyCity: string
  propertyMunicipality: string
  propertyOwnerName: string
  cadastralId: string
  brfName: string
  apartmentNumber: string
  apartmentHolderName: string
  scopeDescription: string
  priceAmount: string
  customerBinding: { mode: 'existing'; customerId: string; customerVersion: number } | null
} & TuCopyExtraFields

export const EMPTY_TU_COPY_EXTRAS: TuCopyExtraFields = {
  customerIdentityNumber: '', customerRole: '', invoiceName: '', invoiceAddress: '',
}

export type TuCopyRegisteredCustomer = {
  id: string; version: number | string; is_active: boolean
  customer_type: string; name: string; email: string | null; phone: string | null
  address: string | null; postal_code: string | null; city: string | null
  invoice_same_as_customer: boolean; invoice_name: string | null
  invoice_email: string | null; invoice_address: string | null
}

export function tuCopyMatchesCustomer(source: TuCopySource, customer: TuCopyRegisteredCustomer) {
  const text = (value: string | null) => (value ?? '').trim()
  return customer.is_active &&
    source.customerType === (customer.customer_type === 'business' ? 'business' : 'consumer') &&
    [
      [source.customerName, customer.name], [source.customerEmail.toLowerCase(), customer.email?.toLowerCase() ?? ''],
      [source.customerPhone, customer.phone], [source.customerAddress, customer.address],
      [source.customerPostalCode, customer.postal_code], [source.customerCity, customer.city],
      [source.invoiceName, customer.invoice_same_as_customer ? null : customer.invoice_name],
      [source.invoiceEmail.toLowerCase(), customer.invoice_same_as_customer ? null : customer.invoice_email?.toLowerCase() ?? ''],
      [source.invoiceAddress, customer.invoice_same_as_customer ? null : customer.invoice_address],
    ].every(([left, right]) => text(left) === text(right))
}

export function tuCopyHref(inspectionId: string, organizationId: string) {
  return `/tu?orgId=${encodeURIComponent(organizationId)}&copyFrom=${encodeURIComponent(inspectionId)}`
}

// Only identity fields are reusable. Never spread a source report into a new draft.
export function tuCopyPrefill(source: TuCopySource) {
  return {
    objectType: source.objectType,
    customerAddressMatchesObject: false,
    customerName: source.customerName,
    customerEmail: source.customerEmail,
    customerPhone: source.customerPhone,
    customerAddress: source.customerAddress,
    customerPostalCode: source.customerPostalCode,
    customerCity: source.customerCity,
    invoiceEmail: source.invoiceEmail,
    customerIdentityNumber: source.customerIdentityNumber,
    customerRole: source.customerRole,
    invoiceName: source.invoiceName,
    invoiceAddress: source.invoiceAddress,
    propertyAddress: source.propertyAddress,
    propertyPostalCode: source.propertyPostalCode,
    propertyCity: source.propertyCity,
    propertyMunicipality: source.propertyMunicipality,
    propertyOwnerName: source.propertyOwnerName,
    cadastralId: source.cadastralId,
    brfName: source.brfName,
    apartmentNumber: source.apartmentNumber,
    apartmentHolderName: source.apartmentHolderName,
    scopeDescription: '',
  }
}

export function tuCopyPartyFields(reportDraft: unknown): Partial<TuCopyExtraFields> & {
  customerName?: string; customerEmail?: string; customerPhone?: string; customerAddress?: string; propertyOwnerName?: string
} {
  if (!reportDraft || typeof reportDraft !== 'object') return {}
  const sections = (reportDraft as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return {}
  const section = sections.find(item => item?.key === 'assignment_parties')
  if (typeof section?.text !== 'string') return {}
  const fields: ReturnType<typeof tuCopyPartyFields> = {}
  const labels: Record<string, keyof typeof fields> = {
    namn: 'customerName', 'e-post': 'customerEmail', telefon: 'customerPhone', adress: 'customerAddress',
    'roll/beställartyp': 'customerRole', 'person-/org.nr': 'customerIdentityNumber',
    roll: 'customerRole', beställartyp: 'customerRole',
    'e.post': 'customerEmail', 'e-mail': 'customerEmail', email: 'customerEmail',
    'person-/organisationsnummer': 'customerIdentityNumber', 'personnummer/org.nr': 'customerIdentityNumber',
    fakturanamn: 'invoiceName', fakturaadress: 'invoiceAddress', fastighetsägare: 'propertyOwnerName',
  }
  let customer = false
  let currentKey: keyof typeof fields | undefined
  for (const raw of section.text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.toLowerCase() === 'uppdragsgivare') { customer = true; currentKey = undefined; continue }
    if (line.toLowerCase() === 'besiktningsman') break
    if (!customer) continue
    const colon = line.indexOf(':')
    if (colon >= 0) {
      currentKey = labels[line.slice(0, colon).trim().toLowerCase()]
      const value = line.slice(colon + 1).trim()
      if (currentKey && value) fields[currentKey] = value
    } else if (line && (currentKey === 'invoiceAddress' || currentKey === 'customerAddress')) {
      fields[currentKey] = [fields[currentKey], line].filter(Boolean).join('\n')
    }
  }
  return fields
}

export function tuCopyCustomerAddress(edited: string | undefined, address: string, postalCode: string, city: string) {
  // Report editing stores one address string. Preserve an edited address intact;
  // do not guess which part is a street, postal code or locality.
  const normalize = (value: string) => value.replace(/[,\s]+/g, ' ').trim().toLocaleLowerCase('sv-SE')
  if (edited && normalize(edited) !== normalize([address, postalCode, city].filter(Boolean).join(' '))) {
    return { customerAddress: edited, customerPostalCode: '', customerCity: '' }
  }
  return { customerAddress: address, customerPostalCode: postalCode, customerCity: city }
}

export function tuCopyPartiesText(input: TuCopyExtraFields & {
  customerName?: string | null; customerEmail?: string | null; customerPhone?: string | null
  customerAddress?: string | null; customerPostalCode?: string | null; customerCity?: string | null
  propertyOwnerName?: string | null
}) {
  const address = [input.customerAddress, [input.customerPostalCode, input.customerCity].filter(Boolean).join(' ')].filter(Boolean).join(', ')
  const rows = [
    ['Namn', input.customerName], ['Roll/beställartyp', input.customerRole],
    ['Person-/org.nr', input.customerIdentityNumber], ['Adress', address],
    ['Telefon', input.customerPhone], ['E-post', input.customerEmail],
    ['Fakturanamn', input.invoiceName], ['Fakturaadress', input.invoiceAddress],
    ['Fastighetsägare', input.propertyOwnerName],
  ]
  return `Uppdragsgivare\n${rows.filter(([, value]) => value?.trim()).map(([label, value]) => `${label}: ${value?.replace(/\r?\n/g, ', ').trim()}`).join('\n')}`
}
