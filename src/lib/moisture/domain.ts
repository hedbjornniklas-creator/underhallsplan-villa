export const MOISTURE_SCOPES = ['inventory', 'description', 'design'] as const
export const MOISTURE_PRICING_MODES = ['undecided', 'fixed', 'hourly'] as const
export const MOISTURE_STATUSES = ['draft', 'active', 'archived'] as const

export type MoistureScope = (typeof MOISTURE_SCOPES)[number]
export type MoisturePricingMode = (typeof MOISTURE_PRICING_MODES)[number]
export type MoistureStatus = (typeof MOISTURE_STATUSES)[number]
export type MoistureProperty = {
  id: string
  name: string
  address: string | null
  cadastralId: string | null
  municipality: string | null
  postalCode: string | null
  city: string | null
}
export type MoistureCustomer = { id: string; name: string; customerNumber: string }
export type MoistureBuilding = { id: string; name: string }
export type MoistureProject = {
  id: string
  orgId: string
  title: string
  description: string | null
  scopes: MoistureScope[]
  pricingMode: MoisturePricingMode
  status: MoistureStatus
  revision: number
  createdAt: string
  updatedAt: string
  customerId: string | null
  propertyId: string
  property: MoistureProperty
  customer: MoistureCustomer | null
  buildings: MoistureBuilding[]
}
export type MoistureProjectInput = {
  projectId: string
  title: string
  description: string | null
  scopes: MoistureScope[]
  pricingMode: MoisturePricingMode
  customerId: string | null
  property: { mode: 'existing'; id: string } | ({ mode: 'new' } & Omit<MoistureProperty, 'id'>)
  buildingIds: string[]
  newBuildings: string[]
}
export type MoistureProjectUpdate = Omit<MoistureProjectInput, 'projectId' | 'property'> & { revision: number }
export type MoistureOptions = {
  properties: Array<MoistureProperty & { buildings: MoistureBuilding[] }>
  customers: MoistureCustomer[]
}
export type MoistureContext = { orgId: string; orgName: string | null; userId: string }
export type MoistureErrorResponse = { status: number; message: string; fieldErrors?: Record<string, string> }

export class MoistureError extends Error {
  fieldErrors?: Record<string, string>
  constructor(code: string, fieldErrors?: Record<string, string>) {
    super(code)
    this.name = 'MoistureError'
    this.fieldErrors = fieldErrors
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const COMMON_KEYS = ['title', 'description', 'scopes', 'pricingMode', 'customerId', 'buildingIds', 'newBuildings']
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
export function parseMoistureId(value: unknown, field = 'id'): string {
  if (typeof value !== 'string' || !UUID.test(value.trim())) {
    throw new MoistureError('MOISTURE_INVALID_INPUT', { [field]: 'Välj en giltig post.' })
  }
  return value.trim().toLowerCase()
}
function parseInput(value: unknown, update: boolean): MoistureProjectInput | MoistureProjectUpdate {
  if (!record(value)) throw new MoistureError('MOISTURE_INVALID_INPUT')
  const errors: Record<string, string> = {}
  const allowed = new Set([...COMMON_KEYS, ...(update ? ['revision'] : ['projectId', 'property'])])
  if (Object.keys(value).some(key => !allowed.has(key))) errors.form = 'Formuläret innehåller ett fält som inte kan ändras.'
  function text(input: unknown, field: string, max: number, required = false): string | null {
    if (input === undefined || input === null || input === '') {
      if (required) errors[field] = 'Fyll i fältet.'
      return null
    }
    if (typeof input !== 'string') { errors[field] = 'Ange text.'; return null }
    const result = input.trim()
    if (!result && required) errors[field] = 'Fyll i fältet.'
    if (result.length > max) errors[field] = `Använd högst ${max} tecken.`
    return result || null
  }
  function id(input: unknown, field: string): string {
    try { return parseMoistureId(input, field) } catch { errors[field] = 'Välj en giltig post.'; return '' }
  }
  const title = text(value.title, 'title', 200, true) ?? ''
  const description = text(value.description, 'description', 5000)
  const scopes: MoistureScope[] = []
  if (!Array.isArray(value.scopes) || value.scopes.length < 1 || value.scopes.length > 3 || value.scopes.some(scope => !MOISTURE_SCOPES.includes(scope))) {
    errors.scopes = 'Välj minst ett av de tre arbetsområdena.'
  } else {
    for (const scope of MOISTURE_SCOPES) if (value.scopes.includes(scope)) scopes.push(scope)
  }
  const pricingMode = value.pricingMode as MoisturePricingMode
  if (!MOISTURE_PRICING_MODES.includes(pricingMode)) errors.pricingMode = 'Välj fast pris, löpande eller ännu inte bestämt.'
  const customerId = value.customerId === null || value.customerId === undefined || value.customerId === '' ? null : id(value.customerId, 'customerId')
  const buildingIds: string[] = []
  if (!Array.isArray(value.buildingIds) || value.buildingIds.length > 100) errors.buildingIds = 'Välj högst 100 byggnader.'
  else for (const raw of value.buildingIds) { const item = id(raw, 'buildingIds'); if (item && !buildingIds.includes(item)) buildingIds.push(item) }
  const newBuildings: string[] = []
  if (!Array.isArray(value.newBuildings) || value.newBuildings.length > 50) errors.newBuildings = 'Lägg till högst 50 byggnader åt gången.'
  else for (const raw of value.newBuildings) {
    const name = text(raw, 'newBuildings', 200, true)
    if (name) newBuildings.push(name)
  }
  if (buildingIds.length + newBuildings.length > 100) errors.buildingIds = 'Ett uppdrag kan omfatta högst 100 byggnader.'
  const common = { title, description, scopes, pricingMode, customerId, buildingIds, newBuildings }
  let result: MoistureProjectInput | MoistureProjectUpdate
  if (update) {
    if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || Number(value.revision) > 2147483646) errors.revision = 'Ladda om uppdraget innan du sparar.'
    result = { ...common, revision: Number(value.revision) }
  } else {
    const projectId = id(value.projectId, 'projectId')
    let property: MoistureProjectInput['property'] = { mode: 'existing', id: '' }
    if (!record(value.property)) errors.property = 'Välj en fastighet eller lägg till en ny.'
    else if (value.property.mode === 'existing') {
      property = { mode: 'existing', id: id(value.property.id, 'property.id') }
      if (Object.keys(value.property).some(key => !['mode', 'id'].includes(key))) errors.property = 'Fastighetsuppgifter kan inte ändras i detta steg.'
    } else if (value.property.mode === 'new') {
      const source = value.property
      const keys = ['mode', 'name', 'address', 'cadastralId', 'municipality', 'postalCode', 'city']
      if (Object.keys(source).some(key => !keys.includes(key))) errors.property = 'Fastighetsuppgifterna innehåller ett okänt fält.'
      property = {
        mode: 'new', name: text(source.name, 'property.name', 200, true) ?? '',
        address: text(source.address, 'property.address', 255), cadastralId: text(source.cadastralId, 'property.cadastralId', 200),
        municipality: text(source.municipality, 'property.municipality', 120), postalCode: text(source.postalCode, 'property.postalCode', 32),
        city: text(source.city, 'property.city', 120),
      }
      if (buildingIds.length) errors.buildingIds = 'En ny fastighet kan bara ha nya byggnader.'
    } else errors.property = 'Välj en fastighet eller lägg till en ny.'
    result = { ...common, projectId, property }
  }
  if (Object.keys(errors).length) throw new MoistureError('MOISTURE_INVALID_INPUT', errors)
  return result
}
export function parseMoistureProjectInput(value: unknown): MoistureProjectInput {
  return parseInput(value, false) as MoistureProjectInput
}
export function parseMoistureProjectUpdate(value: unknown): MoistureProjectUpdate {
  return parseInput(value, true) as MoistureProjectUpdate
}

export function getMoistureError(error: unknown): MoistureErrorResponse {
  const code = error instanceof Error ? error.message : ''
  const known: Record<string, [number, string]> = {
    UNAUTHORIZED: [401, 'Logga in för att fortsätta.'],
    ORG_SELECTION_INVALID: [400, 'Välj en giltig organisation.'],
    ORG_MEMBERSHIP_REQUIRED: [403, 'Du har inte tillgång till den valda organisationen.'],
    MODULE_ACCESS_REQUIRED: [403, 'Du har inte behörighet till Fuktsäkerhet i den valda organisationen.'],
    MOISTURE_FORBIDDEN: [403, 'Du har inte behörighet att öppna eller ändra uppdraget.'],
    MOISTURE_NOT_FOUND: [404, 'Fuktuppdraget kunde inte hittas.'],
    MOISTURE_INVALID_INPUT: [400, 'Kontrollera uppgifterna i formuläret.'],
    MOISTURE_PROPERTY_INVALID: [400, 'Fastigheten är inte tillgänglig i det här uppdraget.'],
    MOISTURE_BUILDING_INVALID: [400, 'En vald byggnad tillhör inte uppdragets fastighet.'],
    MOISTURE_CUSTOMER_INVALID: [400, 'Välj en aktiv kund i den valda organisationen.'],
    MOISTURE_CONFLICT: [409, 'Uppdraget har ändrats. Ladda om innan du sparar igen.'],
    MOISTURE_CREATE_CONFLICT: [409, 'Detta försök har redan använts för ett annat innehåll. Öppna det skapade uppdraget eller börja om.'],
    MOISTURE_SCHEMA_REQUIRED: [503, 'Fuktsäkerhet behöver förberedas i databasen innan modulen kan användas.'],
  }
  const [status, message] = known[code] ?? [500, 'Fuktsäkerhet kunde inte slutföra åtgärden. Försök igen.']
  const fields: Record<string, string> | undefined = code === 'MOISTURE_CUSTOMER_INVALID' ? { customerId: message }
    : code === 'MOISTURE_PROPERTY_INVALID' ? { property: message }
      : code === 'MOISTURE_BUILDING_INVALID' ? { buildingIds: message } : undefined
  return { status, message, ...((error instanceof MoistureError && error.fieldErrors) || fields ? { fieldErrors: error instanceof MoistureError && error.fieldErrors ? error.fieldErrors : fields } : {}) }
}
