import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { buildAcceptedAssignmentConfirmationFilename, renderAcceptedAssignmentConfirmationPdf } from '../src/lib/assignments/acceptedConfirmationPdf.ts'

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
