export type PropertyDetails = {
  municipality: string
  cadastralDesignation: string
  street: string
  postalCode: string
  city: string
}

export type RegisteredProperty = PropertyDetails & { id: string; name: string }
export type ProjectPropertyLink = { available: boolean; property: RegisteredProperty | null }

export const propertyFields = [
  { key: 'municipality', title: 'Kommun', max: 200, required: true },
  { key: 'cadastralDesignation', title: 'Fastighetsbeteckning', max: 200, required: true },
  { key: 'street', title: 'Gata', max: 250, required: true },
  { key: 'postalCode', title: 'Postnummer', max: 20, required: false },
  { key: 'city', title: 'Ort', max: 200, required: true }
] as const

export function emptyPropertyDetails(street = ''): PropertyDetails {
  return { municipality: '', cadastralDesignation: '', street, postalCode: '', city: '' }
}

export function normalizePropertyDetails(value: unknown): PropertyDetails {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('PROPERTY_INVALID')
  const input = value as Record<string, unknown>
  const result = emptyPropertyDetails()
  for (const { key, max } of propertyFields) {
    if (typeof input[key] !== 'string' || input[key].length > max) throw new Error('PROPERTY_INVALID')
    result[key] = input[key].trim()
  }
  return result
}

// Designation alone is not unique across municipalities. The shared UUID remains the object ID.
export function propertyIdentityKey(value: Pick<PropertyDetails, 'municipality' | 'cadastralDesignation'>): string | null {
  const municipality = value.municipality.trim().toLowerCase().replace(/\s+/g, ' ')
  const designation = value.cadastralDesignation.trim().toLowerCase().replace(/\s+/g, '')
  return municipality && designation ? `${municipality}|${designation}` : null
}

export function propertyDetailsText(value: PropertyDetails): string {
  return propertyFields.flatMap(({ key, title }) => value[key].trim() ? [`${title}: ${value[key].trim()}`] : []).join('\n')
}

export function propertyDetailsComplete(value: PropertyDetails): boolean {
  return propertyFields.every(({ key, required }) => !required || Boolean(value[key].trim()))
}
