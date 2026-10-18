import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Copy from '../src/lib/tu/copy'
import type * as CopyServer from '../src/lib/tu/copyServer'

function load<T>(path: string, dependencies: Record<string, unknown> = {}, source?: string): T {
  const output = ts.transpileModule(source ?? readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((id: string) => {
    if (id in dependencies) return dependencies[id]
    throw new Error(`Unexpected dependency: ${id}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const copy = load<typeof Copy>('src/lib/tu/copy.ts')
const roles = load('src/lib/tu/customerRole.ts')
const ORG = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'

function harness(options: { foreign?: boolean; noAssignment?: boolean; inactiveCustomer?: boolean; failure?: boolean; changedCustomer?: boolean } = {}) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = []
  const data: Record<string, unknown> = {
    technical_investigation_details: {
      inspection_id: ID, property_id: 'property', assignment_id: options.noAssignment ? null : 'assignment',
      title: 'Tidigare specialrubrik', report_template_key: 'moisture_damage_investigation', property_object_type: 'apartment',
      scope_description: 'Gammal omfattning', brf_name: 'BRF Test', apartment_number: '12', invoice_email: 'invoice@example.com',
      report_locked_at: '2026-10-01',
      report_draft: { sections: [
        { key: 'assignment_parties', text: 'Uppdragsgivare\nNamn: Rättat kundnamn\nRoll/beställartyp: Styrelse\nPerson-/org.nr: 769600-0000\nFakturanamn: BRF Test\nFakturaadress: Gatan 1\n123 45 Teststad\n\nBesiktningsman\nNamn: Gamla besiktningsmannen\nE-post: old-inspector@example.com' },
        { key: 'assessment', text: 'Får aldrig återanvändas' },
      ] },
    },
    inspections: { customer_name: 'Gammalt kundnamn', customer_email: 'contact@example.com', customer_phone: '123', customer_address: 'Gatan 1', customer_city: 'Teststad', customer_postal_code: '12345' },
    properties: { address: 'Objektgatan 2', cadastral_id: 'Test 1:1', city: 'Teststad' },
    assignments: { organization_customer_id: 'customer', assignment_details: { customerType: 'business' }, price_amount: 5900, customer_email: 'old@example.com', invoice_name: 'Gammal fakturamottagare' },
    organization_customers: {
      id: 'customer', is_active: !options.inactiveCustomer, version: '8', customer_type: 'business',
      name: options.changedCustomer ? 'Ett annat registrerat namn' : 'Rättat kundnamn', email: 'contact@example.com', phone: '123',
      address: 'Gatan 1', postal_code: '12345', city: 'Teststad', invoice_same_as_customer: false,
      invoice_name: 'BRF Test', invoice_email: 'invoice@example.com', invoice_address: 'Gatan 1\n123 45 Teststad',
    },
  }
  const admin = { from(table: string) {
    const call = { table, filters: {} as Record<string, unknown> }
    calls.push(call)
    const query = {
      select() { return query },
      eq(key: string, value: unknown) { call.filters[key] = value; return query },
      async maybeSingle() { return { data: options.foreign && table === 'technical_investigation_details' ? null : data[table], error: options.failure ? { message: 'internal database info' } : null } },
    }
    return query
  } }
  const server = load<typeof CopyServer>('src/lib/tu/copyServer.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin }, './copy': copy, './customerRole': roles,
  })
  return { server, calls }
}

test('reads a locked source without changing it; all tenant-owned reads are scoped', async () => {
  const { server, calls } = harness()
  const source = await server.getTuCopySource(ORG, ID)
  assert.ok(source)
  assert.equal(source.customerName, 'Rättat kundnamn')
  assert.equal(source.customerEmail, 'contact@example.com')
  assert.equal(source.invoiceAddress, 'Gatan 1\n123 45 Teststad')
  assert.equal(source.invoiceName, 'BRF Test')
  assert.equal(source.customerType, 'business')
  assert.deepEqual(source.customerBinding, { mode: 'existing', customerId: 'customer', customerVersion: 8 })
  for (const table of ['technical_investigation_details', 'assignments', 'organization_customers']) {
    assert.equal(calls.find(call => call.table === table)?.filters.org_id, ORG)
  }
  assert.equal(calls.find(call => call.table === 'inspections')?.filters.inspection_family, 'TU')
  assert.doesNotMatch(JSON.stringify(source), /Får aldrig|report_locked_at|old-inspector|Gamla besiktningsmannen/)
})

test('a missing/foreign source never reads the associated property or customer', async () => {
  const { server, calls } = harness({ foreign: true })
  assert.equal(await server.getTuCopySource(ORG, ID), null)
  assert.equal(calls.length, 1)
})

test('invalid IDs do not reach the database', async () => {
  const { server, calls } = harness()
  assert.equal(await server.getTuCopySource(ORG, '../anything'), null)
  assert.equal(calls.length, 0)
})

test('inactive customers are not silently re-linked', async () => {
  const { server } = harness({ inactiveCustomer: true })
  assert.equal((await server.getTuCopySource(ORG, ID))?.customerBinding, null)
})

test('a differing customer record cannot silently overwrite the copied contact details', async () => {
  const { server } = harness({ changedCustomer: true })
  const source = await server.getTuCopySource(ORG, ID)
  assert.equal(source?.customerBinding, null)
  assert.equal(source?.customerName, 'Rättat kundnamn')
})

test('direct investigations without an assignment also support reuse', async () => {
  const { server, calls } = harness({ noAssignment: true })
  const source = await server.getTuCopySource(ORG, ID)
  assert.equal(source?.customerEmail, 'contact@example.com')
  assert.equal(source?.priceAmount, '')
  assert.equal(source?.customerBinding, null)
  assert.equal(calls.some(call => call.table === 'assignments'), false)
})

test('database failure is not mistaken for an empty source', async () => {
  const { server } = harness({ failure: true })
  await assert.rejects(server.getTuCopySource(ORG, ID), /TU_COPY_SOURCE_FAILED/)
})

test('prefill excludes scope, dates, price, old titles, results and approval fields', async () => {
  const { server } = harness()
  const source = await server.getTuCopySource(ORG, ID)
  assert.ok(source)
  const seeded = copy.tuCopyPrefill({ ...source, accepted_at: 'old', date: '2026-01-01', reportDraft: 'old report' } as Copy.TuCopySource)
  assert.equal(seeded.scopeDescription, '')
  assert.equal(seeded.customerAddressMatchesObject, false)
  assert.equal(seeded.propertyAddress, 'Objektgatan 2')
  for (const key of ['date', 'time', 'preferredDate', 'preferredTime', 'priceAmount', 'title', 'reportDraft', 'accepted_at', 'inspectionId', 'propertyId']) {
    assert.equal(key in seeded, false, key)
  }
})

test('new parties text only contains the selected customer identity, never old inspector data', () => {
  const text = copy.tuCopyPartiesText({ ...copy.EMPTY_TU_COPY_EXTRAS, customerName: 'Ny kund', invoiceName: 'Faktura', invoiceAddress: 'Rad 1\nRad 2' })
  assert.match(text, /Namn: Ny kund/)
  assert.match(text, /Fakturaadress: Rad 1, Rad 2/)
  assert.doesNotMatch(text, /Besiktningsman|Signering|Godkänd/)
})

test('copy link carries only the source ID and chosen organization', () => {
  assert.equal(copy.tuCopyHref(ID, ORG), `/tu?orgId=${ORG}&copyFrom=${ID}`)
})

test('new direct report uses a fresh property and template, not a copied report', async () => {
  const file = readFileSync(new URL('../src/lib/tu/server.ts', import.meta.url), 'utf8')
  const source = file.slice(file.indexOf('export async function createScratchTuInvestigation'), file.indexOf('export async function convertTuAssignmentToInvestigation'))
  const calls: Array<{ name: string; input: unknown }> = []
  const dependencies = {
    getActiveTuReportTemplateByKey: async () => ({ documentTitle: 'Aktuell mall', projectType: 'Aktuell typ' }),
    cleanText: (value: string | null) => value?.trim() || null,
    inferTuObjectType: () => 'villa',
    createPropertyForTu: async (input: unknown) => { calls.push({ name: 'property', input }); return { id: 'new-property' } },
    createInspectionForTu: async (input: unknown) => { calls.push({ name: 'inspection', input }); return { id: 'new-inspection' } },
    createTuDetail: async (input: unknown) => { calls.push({ name: 'detail', input }) },
    createTuReportDraftFromTemplate: (_template: unknown, values: unknown) => ({ sections: [], values }),
    ...copy,
  }
  const names = Object.keys(dependencies)
  const wrapped = `import { ${names.join(', ')} } from 'deps'\n${source}`
  const server = load<{ createScratchTuInvestigation: (input: unknown) => Promise<unknown> }>('', { deps: dependencies }, wrapped)
  const result = await server.createScratchTuInvestigation({ orgId: ORG, createdBy: 'me', customerEmail: 'new@example.com', customerDetails: { ...copy.EMPTY_TU_COPY_EXTRAS, invoiceName: 'BRF Test' } })
  assert.deepEqual(result, { propertyId: 'new-property', inspectionId: 'new-inspection' })
  assert.equal((calls.find(call => call.name === 'inspection')?.input as { propertyId: string }).propertyId, 'new-property')
  const detail = calls.find(call => call.name === 'detail')!.input as {
    assignmentId?: string; title: string; reportLockedAt?: string; reportDraft: { values: Record<string, string> }
  }
  assert.equal(detail.assignmentId, undefined)
  assert.equal(detail.title, 'Aktuell mall')
  assert.equal(detail.reportDraft.values.assignment_scope, '')
  assert.match(detail.reportDraft.values.assignment_parties, /Fakturanamn: BRF Test/)
  assert.equal(detail.reportLockedAt, undefined)
})

test('manually edited report addresses are preserved without inventing a postal code', () => {
  assert.deepEqual(copy.tuCopyCustomerAddress('Ny adress 4, Ny ort', 'Gammal 1', '12345', 'Gammal ort'), {
    customerAddress: 'Ny adress 4, Ny ort', customerPostalCode: '', customerCity: '',
  })
  assert.deepEqual(copy.tuCopyCustomerAddress('Gatan 1, 12345, Teststad', 'Gatan 1', '12345', 'Teststad'), {
    customerAddress: 'Gatan 1', customerPostalCode: '12345', customerCity: 'Teststad',
  })
})

test('creation API only forwards editable customer fields, never copied IDs or report state', async () => {
  const calls: Array<Record<string, unknown>> = []
  const route = load<{ POST: (request: Request) => Promise<Response> }>('src/app/api/tu/investigations/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    '@/lib/supabase/admin': {},
    '@/lib/tu/server': {
      requireTuContext: async (orgId: string) => { assert.equal(orgId, ORG); return { orgId: ORG, userId: 'current-user' } },
      createScratchTuInvestigation: async (input: Record<string, unknown>) => { calls.push(input); return { inspectionId: 'new' } },
    },
  })
  const response = await route.POST(new Request('https://example.com/api/tu/investigations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: ORG, customerEmail: 'NEW@example.com', reportTemplateKey: 'active-template',
      customerDetails: { ...copy.EMPTY_TU_COPY_EXTRAS, invoiceName: 'Fakturamottagare', inspectorName: 'Old inspector' },
      propertyId: 'old-property', assignmentId: 'old-assignment', reportDraft: 'Old report', accepted_at: 'old', report_locked_at: 'old',
    }),
  }))
  assert.equal(response.status, 201)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].customerEmail, 'new@example.com')
  assert.equal(calls[0].responsibleProfileId, 'current-user')
  assert.equal(calls[0].date, null)
  assert.equal(calls[0].time, null)
  assert.deepEqual(calls[0].customerDetails, { ...copy.EMPTY_TU_COPY_EXTRAS, invoiceName: 'Fakturamottagare' })
  for (const key of ['assignmentId', 'propertyId', 'reportDraft', 'accepted_at', 'report_locked_at']) assert.equal(key in calls[0], false)
})
