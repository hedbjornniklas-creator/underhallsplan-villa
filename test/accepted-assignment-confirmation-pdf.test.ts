import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import React from 'react'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { loadTuModule } from './helpers/load-tu-module.ts'
const { buildAcceptedAssignmentConfirmationFilename, renderAcceptedAssignmentConfirmationPdf } = loadTuModule<typeof import('../src/lib/assignments/acceptedConfirmationPdf')>('src/lib/assignments/acceptedConfirmationPdf.ts')

test('TU confirmation PDF uses accepted customer, representative and VAT rather than later edits', async () => {
  const texts: string[] = []
  function visit(node: unknown): void {
    if (typeof node === 'string') { texts.push(node); return }
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node !== 'object') return
    const element = node as { type?: unknown; props?: { children?: unknown } }
    if (typeof element.type === 'function') visit(element.type(element.props))
    else visit(element.props?.children)
  }
  const renderer = loadTuModule<{ renderAcceptedAssignmentConfirmationPdf: (input: unknown) => Promise<Buffer> }>('src/lib/assignments/acceptedConfirmationPdf.ts', {
    '@react-pdf/renderer': { Document: 'DOCUMENT', Page: 'PAGE', Text: 'TEXT', View: 'VIEW', StyleSheet: { create: (styles: unknown) => styles },
      renderToBuffer: async (document: unknown) => { visit(document); return Buffer.from('%PDF-tree-check') } },
  })
  await renderer.renderAcceptedAssignmentConfirmationPdf({
    assignment: { id: 'tu-test', assignment_type: 'TU', customer_name: 'Later name', accepted_at: '2026-11-11T10:00:00Z', price_amount: 99,
      assignment_details: { objectType: 'apartment' }, brf_name: 'Stale BRF', apartment_number: 'Stale apartment' },
    issuerName: 'Testforetaget', inspector: null, addonOrders: [],
    acceptancePayload: { customer_name: 'Accepted association', assignment_details: { objectType: 'villa', customerType: 'business',
      tuCustomer: { version: 1, kind: 'association', contactName: 'Accepted contact', contactRole: 'Chair', identityNumber: '769000-0000',
        invoiceName: '', invoiceAddress: '', invoiceReference: 'REF-42' },
      tuPricing: { version: 1, amount: 5000, basis: 'exclusive', vatRate: 25 } } },
    terms: { role: 'technical', version: 'test', documentHash: 'a'.repeat(64), text: 'Testvillkor.' },
  })
  assert.ok(texts.includes('Förening'))
  for (const value of ['Accepted association', 'Accepted contact', 'Chair', '769000-0000', 'REF-42', 'Pris exkl. moms', 'Moms (25 %)', 'Totalt inkl. moms']) assert.ok(texts.includes(value), value)
  assert.match(texts.join(' ').replace(/\s/g, ''), /6250,00/)
  for (const value of ['Later name', 'Stale BRF', 'Stale apartment']) assert.ok(!texts.includes(value), value)
})

test('renders a complete accepted assignment confirmation as a PDF buffer', async () => {
  const acceptedAt = '2026-09-03T08:42:13.000Z'
  const assignmentId = 'b617c9ba-eea5-4220-96c9-43c72f805b2e'
  const documentHash = '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
  const assignmentDetails = {
    customerType: 'consumer',
    pricingModel: 'fixed',
    vatIncluded: true,
    underlyingContract: 'ABS 18',
    contractTerms: 'ABK 09 med konsumentanpassningar',
    paymentTerms: '10 dagar',
  }

  const pdf = await renderAcceptedAssignmentConfirmationPdf({
    assignment: {
      id: assignmentId,
      assignment_type: 'EB',
      customer_name: 'Anna Andersson',
      customer_email: 'anna@example.se',
      customer_phone: '070-123 45 67',
      customer_address: 'Exempelvägen 1',
      customer_postal_code: '123 45',
      customer_city: 'Exempelstad',
      preliminary_address: 'Villagatan 8',
      scope_description: 'Slutbesiktning av villa.',
      preferred_date: '2026-09-03',
      preferred_time: '10:00:00',
      price_amount: 9900,
      currency: 'SEK',
      property_address: 'Villagatan 8',
      property_postal_code: '543 21',
      property_city: 'Villastad',
      property_municipality: 'Villastads kommun',
      property_owner_name: 'Anna Andersson',
      cadastral_id: 'Villastaden 1:23',
      brf_name: null,
      apartment_number: null,
      apartment_holder_name: null,
      invoice_name: 'Anna Andersson',
      invoice_address: 'Exempelvägen 1',
      invoice_email: 'faktura@example.se',
      personal_identity_number: '19800101-1234',
      orderer_role: 'Entreprenadbesiktning - Konsument',
      accepted_at: acceptedAt,
      terms_version: '2026-08-22.eb-consumer.v1',
      terms_document_hash: documentHash,
      assignment_details: assignmentDetails,
    },
    issuerName: 'Exempel Besiktning AB',
    inspector: null,
    addonOrders: [],
    acceptancePayload: {
      assignment_details: assignmentDetails,
      consumer_withdrawal_acknowledged: true,
      consumer_early_start_required: true,
      consumer_early_start_requested: true,
    },
    terms: {
      role: 'construction_consumer',
      version: '2026-08-22.eb-consumer.v1',
      documentHash,
      text: 'VILLKOR\n\nHela villkorstexten ska finnas med i kundens kopia.',
    },
  })

  assert.equal(pdf.subarray(0, 5).toString('ascii'), '%PDF-')
  assert.ok(pdf.length > 5_000)
  assert.equal(
    buildAcceptedAssignmentConfirmationFilename({
      assignmentType: 'EB',
      assignmentId,
      acceptedAt,
    }),
    'Uppdragsbekraftelse-EB-2026-09-03-b617c9ba.pdf'
  )
})

test('the actual STATUS document tree uses status headings and no seller fallback or raw status label', async () => {
  const output = ts.transpileModule(readFileSync(new URL('../src/lib/assignments/acceptedConfirmationPdf.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  const texts: string[] = []
  function visit(node: unknown): void {
    if (typeof node === 'string') { texts.push(node); return }
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node !== 'object') return
    const element = node as { type?: unknown; props?: { children?: unknown } }
    if (typeof element.type === 'function') visit(element.type(element.props))
    else visit(element.props?.children)
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name === '@/lib/tu/customer') return loadTuModule('src/lib/tu/customer.ts')
    if (name === 'react') return React
    if (name === '@react-pdf/renderer') return {
      Document: 'DOCUMENT', Page: 'PAGE', Text: 'TEXT', View: 'VIEW', StyleSheet: { create: (styles: unknown) => styles },
      renderToBuffer: async (document: unknown) => { visit(document); return Buffer.from('%PDF-synthetic-tree-check') },
    }
    throw new Error(`Unexpected dependency ${name}`)
  }, mod, mod.exports)
  const renderer = mod.exports as { renderAcceptedAssignmentConfirmationPdf: (input: unknown) => Promise<Buffer> }
  const input = {
    assignment: { id: 'status-test', assignment_type: 'STATUS', orderer_role: 'status',
      accepted_at: '2026-10-02T10:00:00Z', customer_name: 'Testkund', assignment_details: {} },
    issuerName: 'Testföretag', inspector: null, addonOrders: [], acceptancePayload: null,
    terms: { role: 'status', version: '2026.1', documentHash: 'a'.repeat(64), verbatim: true,
      text: 'Statusbesiktning enligt SBR-modellen\n\nExakt statusvillkor.' },
  }
  await renderer.renderAcceptedAssignmentConfirmationPdf(input)
  assert.ok(texts.includes('Villkor för statusbesiktning'))
  assert.ok(texts.filter(text => text === 'Statusbesiktning').length >= 2, 'hero and subtitle both use the display label')
  assert.ok(!texts.some(text => text.includes('Villkor för överlåtelsebesiktning')))
  assert.ok(!texts.includes('status'), 'internal role must not appear as customer copy')

  texts.length = 0
  await renderer.renderAcceptedAssignmentConfirmationPdf({...input,
    assignment:{...input.assignment,assignment_details:{objectType:'property'},property_owner_name:'Stale owner'},
    acceptancePayload:{assignment_details:{objectType:'apartment'},apartment_number:'1201',brf_name:'',apartment_holder_name:''},
  })
  assert.ok(texts.includes('Lägenhetsnummer'))
  assert.ok(texts.includes('1201'))
  assert.ok(texts.includes('Lägenhetsinnehavare'))
  assert.ok(!texts.includes('Fastighetsägare'))
  assert.ok(!texts.includes('Stale owner'))
  assert.ok(texts.includes('Villkor för statusbesiktning'))

  texts.length = 0
  await renderer.renderAcceptedAssignmentConfirmationPdf({...input,
    assignment:{...input.assignment,assignment_details:{objectType:'property'},apartment_number:'Old apartment',property_owner_name:'Current owner'},
  })
  assert.ok(texts.includes('Fastighetsägare'))
  assert.ok(texts.includes('Current owner'))
  assert.ok(!texts.includes('Old apartment'))

  texts.length = 0
  await renderer.renderAcceptedAssignmentConfirmationPdf({...input,
    assignment:{...input.assignment,apartment_number:'Legacy apartment'},
  })
  assert.ok(texts.includes('Legacy apartment'), 'old frozen documents without a marker retain their prior rendering')
  assert.ok(texts.includes('Bostadsrättsinnehavare'))

  texts.length = 0
  await renderer.renderAcceptedAssignmentConfirmationPdf({...input,
    assignment:{...input.assignment,apartment_number:'Stale hidden apartment',brf_name:'Stale BRF',property_owner_name:'Accepted owner'},
    acceptancePayload:{assignment_details:{},apartment_number:null,brf_name:null,apartment_holder_name:null},
  })
  assert.ok(texts.includes('Fastighetsägare'), 'legacy property acceptance explicitly clears hidden apartment fields')
  assert.ok(!texts.includes('Stale hidden apartment'))
  assert.ok(!texts.includes('Stale BRF'))

  texts.length = 0
  await renderer.renderAcceptedAssignmentConfirmationPdf({ ...input,
    assignment: { ...input.assignment, assignment_type: 'OB', orderer_role: 'Säljare' },
    terms: { ...input.terms, role: 'seller', verbatim: false, text: 'Oförändrade säljarvillkor.' },
  })
  assert.ok(texts.includes('Villkor för överlåtelsebesiktning - säljare'))
  assert.ok(texts.includes('Säljare'))
})
