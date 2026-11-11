import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node strip-types requires explicit extensions.
import { loadTuModule } from './helpers/load-tu-module.ts'
import type { TuCustomer } from '../src/lib/tu/customer'
import type { TuInvestigationDetails } from '../src/lib/tu/server'
import type * as Emails from '../src/lib/assignments/emailTemplates'
import type * as Snapshot from '../src/lib/tu/reportSnapshot'

const emails = loadTuModule<typeof Emails>('src/lib/assignments/emailTemplates.ts')
const snapshot = loadTuModule<typeof Snapshot>('src/lib/tu/reportSnapshot.ts')
const customer: TuCustomer = {
  version: 1, kind: 'association', identityNumber: '769600-0000',
  contactName: 'Anna <Exempel> & Co', contactRole: 'Kontaktansvarig',
  invoiceName: '', invoiceAddress: '', invoiceReference: '',
}
const emailInput = {
  assignment: {
    assignment_type: 'TU', customer_name: 'Testforeningen', customer_email: 'test@example.test',
    assignment_details: { tuCustomer: customer },
  },
  termsRole: 'technical', orgName: 'Test', acceptUrl: 'https://example.test/accept/test',
  expiresAt: '2026-12-01', termsVersion: 'test', termsText: 'Oförändrade testvillkor',
  acceptedAt: '2026-11-11', addonOrders: [],
} as unknown as Emails.BuildAssignmentConfirmationEmailInput & Emails.BuildAssignmentOrderReceiptEmailInput

function investigation(overrides: Partial<TuInvestigationDetails> = {}): TuInvestigationDetails {
  return {
    inspectionId: 'test-inspection', inspection: { customer_name: 'Testforeningen' },
    assignment: { ...emailInput.assignment, orderer_role: 'Styrelse' },
    tuCustomer: customer, inspector: null, property: { address: 'Objektgatan 1', city: 'Teststad' },
    objectType: 'villa', cadastralId: 'TEST 1:1', reportTemplateKey: 'short_technical_statement',
    reportDraft: { sections: [
      { id: 'parties', key: 'assignment_parties', text: 'Uppdragsgivare\nNamn: Manuellt namn\nE-post: edited@example.test' },
      { id: 'scope', key: 'assignment_scope', title: 'Omfattning', text: 'Besiktningsmannens egen text.' },
    ] },
    ...overrides,
  } as TuInvestigationDetails
}

for (const [name, build] of [
  ['confirmation', emails.buildAssignmentConfirmationEmail],
  ['receipt', emails.buildAssignmentOrderReceiptEmail],
] as const) {
  test(`TU ${name} includes separate organization and contact details in HTML and plain text`, () => {
    for (const kind of ['association', 'business'] as const) {
      const result = build({ ...emailInput, assignment: { ...emailInput.assignment,
        assignment_details: { tuCustomer: { ...customer, kind } },
      } })
      assert.ok(result.text.includes(`- Beställartyp: ${kind === 'association' ? 'Förening' : 'Företag'}`))
      assert.ok(result.text.includes('- Organisationsnummer: 769600-0000'))
      assert.ok(result.text.includes('- Kontaktperson: Anna <Exempel> & Co'))
      assert.ok(result.text.includes('- Kontaktpersonens roll: Kontaktansvarig'))
      assert.ok(result.html.includes('Anna &lt;Exempel&gt; &amp; Co'))
      assert.ok(result.html.includes('<strong>Organisationsnummer:</strong> 769600-0000'))
      assert.ok(result.html.includes('<strong>Kontaktpersonens roll:</strong> Kontaktansvarig'))
      assert.ok(!result.html.includes('Anna <Exempel>'))
    }
  })

  test(`TU ${name} omits empty contacts and consumer identity numbers; other modules remain unchanged`, () => {
    const privateInput = { ...emailInput, assignment: { ...emailInput.assignment,
      assignment_details: { tuCustomer: { ...customer, kind: 'consumer', contactName: '', contactRole: '', identityNumber: '19900101-1234' } },
    } }
    for (const result of [build(privateInput), build({ ...emailInput, assignment: {
      ...emailInput.assignment, assignment_details: {},
    } })]) {
      assert.doesNotMatch(result.html + result.text, /Kontaktperson|Organisationsnummer|19900101-1234/)
    }
    for (const type of ['OB', 'STATUS', 'EB'] as const) {
      const result = build({ ...emailInput, assignment: { ...emailInput.assignment, assignment_type: type } })
      assert.doesNotMatch(result.html + result.text, /Kontaktperson|769600-0000|Anna &lt;Exempel/)
    }
  })
}

test('print and digital snapshots include the saved organization contact without replacing manual text', () => {
  const value = investigation({ tuCustomer: { ...customer, contactName: 'Ny kontakt', contactRole: 'Kassör' } })
  const report = snapshot.buildTuPrintPayload({ investigation: value, coverImages: [], appendixImages: [] })
  const rows = Object.fromEntries(report.parties!.rightRows.map(row => [row.label, row.value]))
  assert.equal(rows.Uppdragsgivare, 'Manuellt namn')
  assert.equal(rows.Beställartyp, 'Förening')
  assert.equal(rows['Org.nr'], customer.identityNumber)
  assert.equal(rows.Kontaktperson, 'Ny kontakt')
  assert.equal(rows['Kontaktpersonens roll'], 'Kassör')
  assert.equal(rows.Roll, 'Styrelse')
  assert.equal(rows['E-post'], 'edited@example.test')
  assert.equal(report.sections[0].text, 'Besiktningsmannens egen text.')
  assert.equal(rows.Adress, 'Objektgatan 1')
  const frozen = snapshot.createTuReportSnapshotPayloadV1({ investigation: value, coverImages: [], appendixImages: [] })
  assert.deepEqual(frozen.report.parties, report.parties)
  value.tuCustomer!.contactName = 'Senare ändring'
  assert.ok(frozen.report.parties!.rightRows.some(row => row.value === 'Ny kontakt'))
  assert.ok(snapshot.isTuReportSnapshotPayloadV1(frozen))
})

test('reports support direct investigations, assignment fallback, and unchanged legacy party rows', () => {
  for (const value of [investigation({ assignment: null }), investigation({ tuCustomer: null })]) {
    const report = snapshot.buildTuPrintPayload({ investigation: value, coverImages: [], appendixImages: [] })
    assert.ok(report.parties!.rightRows.some(row => row.label === 'Kontaktperson' && row.value === customer.contactName))
  }
  const legacy = investigation({ tuCustomer: null, assignment: { ...emailInput.assignment, assignment_details: {}, orderer_role: 'Styrelse' } as TuInvestigationDetails['assignment'] })
  const report = snapshot.buildTuPrintPayload({ investigation: legacy, coverImages: [], appendixImages: [] })
  assert.ok(report.parties!.rightRows.some(row => row.label === 'Roll/beställartyp' && row.value === 'Styrelse'))
  assert.ok(!report.parties!.rightRows.some(row => ['Beställartyp', 'Kontaktperson', 'Org.nr'].includes(row.label)))
  const privateReport = snapshot.buildTuPrintPayload({ investigation: investigation({ tuCustomer: { ...customer, kind: 'consumer', identityNumber: '19900101-1234', contactName: '', contactRole: '' } }), coverImages: [], appendixImages: [] })
  assert.ok(!JSON.stringify(privateReport).includes('19900101-1234'))
})
