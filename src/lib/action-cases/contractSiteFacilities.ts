export const siteFacilityFields = [
  { key: 'electricity', title: 'Byggström och elförsörjning' },
  { key: 'water', title: 'Vatten' },
  { key: 'toilet', title: 'Toalett och handtvätt' },
  { key: 'changing', title: 'Omklädning, dusch och klädförvaring' },
  { key: 'meals', title: 'Matplats och pausutrymme' },
  { key: 'storage', title: 'Förråd och materialupplag' },
  { key: 'access', title: 'Tillträde, transporter och parkering' },
  { key: 'waste', title: 'Städning och avfall' }
] as const

export const siteFacilityParties = [
  { value: '', label: 'Inte angivet' },
  { value: 'customer', label: 'Beställaren' },
  { value: 'contractor', label: 'Entreprenören' },
  { value: 'agreed', label: 'Enligt villkor' }
] as const

export type SiteFacilityKey = (typeof siteFacilityFields)[number]['key']
export type SiteFacilityParty = (typeof siteFacilityParties)[number]['value']
export type SiteFacilityEntry = { providedBy: SiteFacilityParty; paidBy: SiteFacilityParty; details: string }
export type ContractSiteFacilities = { version: 1; entries: Partial<Record<SiteFacilityKey, SiteFacilityEntry>> }

export function emptySiteFacilityEntry(): SiteFacilityEntry {
  return { providedBy: '', paidBy: '', details: '' }
}

export function siteFacilityUsed(entry?: SiteFacilityEntry): boolean {
  return Boolean(entry && (entry.providedBy || entry.paidBy || entry.details.trim()))
}

export function siteFacilityComplete(entry?: SiteFacilityEntry): boolean {
  return Boolean(entry?.providedBy && entry.paidBy && entry.details.trim())
}

export function siteFacilityPartyLabel(party: SiteFacilityParty): string {
  return siteFacilityParties.find(({ value }) => value === party)!.label
}

export function editSiteFacility(value: ContractSiteFacilities | undefined, key: SiteFacilityKey, patch: Partial<SiteFacilityEntry>): ContractSiteFacilities {
  return { version: 1, entries: { ...value?.entries, [key]: { ...emptySiteFacilityEntry(), ...value?.entries[key], ...patch } } }
}

export function normalizeSiteFacilities(value: unknown): ContractSiteFacilities {
  const invalid = (): never => { throw new Error('CUSTOMER_OFFER_INVALID') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const input = value as Record<string, unknown>
  if (input.version !== 1 || !input.entries || typeof input.entries !== 'object' || Array.isArray(input.entries)) invalid()
  const entries: ContractSiteFacilities['entries'] = {}
  for (const [key, row] of Object.entries(input.entries as Record<string, unknown>)) {
    if (!siteFacilityFields.some((field) => field.key === key) || !row || typeof row !== 'object' || Array.isArray(row)) invalid()
    const entry = row as Record<string, unknown>
    if (!siteFacilityParties.some(({ value }) => value === entry.providedBy) || !siteFacilityParties.some(({ value }) => value === entry.paidBy)
      || typeof entry.details !== 'string' || entry.details.length > 2000) invalid()
    entries[key as SiteFacilityKey] = { providedBy: entry.providedBy as SiteFacilityParty, paidBy: entry.paidBy as SiteFacilityParty, details: (entry.details as string).trim() }
  }
  return { version: 1, entries }
}

export function siteFacilitiesIssues(value?: ContractSiteFacilities): string[] {
  return siteFacilityFields.flatMap(({ key, title }) => siteFacilityUsed(value?.entries[key]) && !siteFacilityComplete(value?.entries[key])
    ? [`Komplettera arbetsplatsens ${title.toLowerCase()}: vem som ordnar, vem som bekostar samt plats och villkor.`] : [])
}

export function siteFacilitiesSummary(value?: ContractSiteFacilities): string {
  const count = siteFacilityFields.filter(({ key }) => siteFacilityUsed(value?.entries[key])).length
  return count ? `${count} ${count === 1 ? 'förutsättning angiven' : 'förutsättningar angivna'}${siteFacilitiesIssues(value).length ? ' · Behöver kompletteras' : ''}` : 'Inte angivet'
}
