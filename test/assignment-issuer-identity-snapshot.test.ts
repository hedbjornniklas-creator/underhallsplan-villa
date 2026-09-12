import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { ASSIGNMENT_ISSUER_IDENTITY_SCHEMA, ASSIGNMENT_ISSUER_SNAPSHOT_SCHEMA_VERSION, createAssignmentIssuerIdentitySnapshotV1, isAssignmentIssuerIdentitySnapshotV1, parseAssignmentIssuerIdentitySnapshot, parseAssignmentIssuerIdentitySnapshotV1, type AssignmentIssuerIdentitySnapshotV1 } from '../src/lib/assignments/issuerIdentity.ts'

const ORG_ID = '3d68eb25-e9a0-42cf-8a1d-f03e7a585fb5'
const PROFILE_ID = '16bd9150-a1d2-4a2e-af36-b9df45d14750'
const EXPECTED = { orgId: ORG_ID, profileId: PROFILE_ID }

function validSnapshot(): AssignmentIssuerIdentitySnapshotV1 {
  return {
    schema: ASSIGNMENT_ISSUER_IDENTITY_SCHEMA,
    orgId: ORG_ID,
    profileId: PROFILE_ID,
    capturedAt: '2026-09-12T09:30:00.000Z',
    card: {
      id: 'fddaa0ca-076d-44c7-922f-22ad1b41b69c',
      version: 4,
      source: 'organization_card',
      updatedAt: '2026-09-12T09:15:00+00:00',
    },
    inspector: {
      displayName: 'Niklas Hedbjörn',
      title: 'Besiktningsman',
      phone: '+46 70 123 45 67',
      email: 'niklas@example.se',
      avatarPath: 'profiles/16bd/avatar-2f0c.jpg',
      signaturePath: 'https://media.example.se/signatures/signature-a9f1.png',
    },
    company: {
      name: 'SVEA Ingenjörer AB',
      organizationNumber: '556123-4567',
      address: 'Exempelvägen 1',
      postalCode: '123 45',
      city: 'Stockholm',
      logoPath: 'profiles/16bd/organizations/3d68/logo-5b1f.png',
      reportFooterText: 'Oberoende teknisk rådgivning.',
    },
    certifications: {
      sbrGroup: 'Medlem i SBR:s överlåtelsebesiktningsgrupp',
      sbrStatus: 'Av SBR godkänd besiktningsman',
      membershipNumber: '12345',
      certificationNumber: 'CERT-99',
      isSbrDiplomeradAreamatning: true,
      items: [
        {
          key: 'av_sbr_godkand_besiktningsman',
          name: 'Av SBR godkänd besiktningsman',
          category: 'certification',
          sortOrder: 10,
          numberValue: 'CERT-99',
          validTo: '2027-12-31',
        },
        {
          key: 'medlem_i_sbr_overlatelsebesiktningsgrupp',
          name: 'Medlem i SBR:s överlåtelsebesiktningsgrupp',
          category: 'membership',
          sortOrder: 20,
          numberValue: '12345',
          validTo: null,
        },
      ],
    },
    replyToEmail: 'uppdrag@example.se',
  }
}

function validSnapshotInput() {
  const snapshot = validSnapshot()
  return {
    orgId: snapshot.orgId,
    profileId: snapshot.profileId,
    capturedAt: snapshot.capturedAt,
    card: snapshot.card,
    inspector: snapshot.inspector,
    company: snapshot.company,
    certifications: snapshot.certifications,
    replyToEmail: snapshot.replyToEmail,
  }
}

test('parses a complete issuer snapshot for the expected organization and profile', () => {
  const input = validSnapshot()
  const parsed = parseAssignmentIssuerIdentitySnapshotV1(input, EXPECTED)

  assert.deepEqual(parsed, input)
  assert.notEqual(parsed, input)
  assert.notEqual(parsed?.inspector, input.inspector)
  assert.notEqual(parsed?.certifications.items, input.certifications.items)
  assert.equal(isAssignmentIssuerIdentitySnapshotV1(input, EXPECTED), true)
})

test('creates the versioned schema through the same strict parser', () => {
  const created = createAssignmentIssuerIdentitySnapshotV1(validSnapshotInput())

  assert.equal(created.schema, 'assignment_issuer_v1')
  assert.deepEqual(created, validSnapshot())
})

test('exports the central parser API with optional context checks', () => {
  const input = validSnapshot()

  assert.equal(ASSIGNMENT_ISSUER_SNAPSHOT_SCHEMA_VERSION, 'assignment_issuer_v1')
  assert.deepEqual(parseAssignmentIssuerIdentitySnapshot(input), input)
  assert.deepEqual(
    parseAssignmentIssuerIdentitySnapshot(input, { orgId: ORG_ID }),
    input
  )
  assert.equal(
    parseAssignmentIssuerIdentitySnapshot(input, {
      profileId: '57923ac5-ddf2-45bc-9507-539a36fa74e1',
    }),
    null
  )
})

test('rejects a valid snapshot when its organization or profile does not match', () => {
  const input = validSnapshot()

  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1(input, {
      orgId: 'eb3d2524-2ddb-46ce-9c81-45f8090aed1d',
      profileId: PROFILE_ID,
    }),
    null
  )
  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1(input, {
      orgId: ORG_ID,
      profileId: '57923ac5-ddf2-45bc-9507-539a36fa74e1',
    }),
    null
  )
})

test('rejects missing and unknown fields at every snapshot level', () => {
  const input = validSnapshot()
  const missingRootField: Record<string, unknown> = { ...input }
  delete missingRootField.replyToEmail

  assert.equal(parseAssignmentIssuerIdentitySnapshotV1(missingRootField, EXPECTED), null)
  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1({ ...input, unexpected: true }, EXPECTED),
    null
  )
  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1(
      { ...input, inspector: { ...input.inspector, unexpected: true } },
      EXPECTED
    ),
    null
  )
  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1(
      {
        ...input,
        certifications: {
          ...input.certifications,
          items: [{ ...input.certifications.items[0], unexpected: true }],
        },
      },
      EXPECTED
    ),
    null
  )
})

test('rejects invalid timestamps, contact fields, media references and certification data', () => {
  const input = validSnapshot()
  const invalidSnapshots = [
    { ...input, capturedAt: '2026-09-12' },
    { ...input, capturedAt: '2026-02-30T09:30:00.000Z' },
    { ...input, inspector: { ...input.inspector, email: 'not-an-email' } },
    { ...input, inspector: { ...input.inspector, signaturePath: 'data:image/png;base64,abc' } },
    { ...input, company: { ...input.company, logoPath: '../other-org/logo.png' } },
    {
      ...input,
      certifications: {
        ...input.certifications,
        items: [
          input.certifications.items[0],
          { ...input.certifications.items[0] },
        ],
      },
    },
    {
      ...input,
      certifications: {
        ...input.certifications,
        items: [{ ...input.certifications.items[0], validTo: '2027-02-30' }],
      },
    },
  ]

  for (const candidate of invalidSnapshots) {
    assert.equal(parseAssignmentIssuerIdentitySnapshotV1(candidate, EXPECTED), null)
  }
})

test('enforces card provenance invariants and supports a canonical legacy snapshot', () => {
  const input = validSnapshot()
  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1(
      { ...input, card: { ...input.card, version: 0 } },
      EXPECTED
    ),
    null
  )
  assert.equal(
    parseAssignmentIssuerIdentitySnapshotV1(
      { ...input, card: { ...input.card, source: 'legacy_profile' } },
      EXPECTED
    ),
    null
  )

  const legacy = {
    ...input,
    card: {
      id: null,
      version: null,
      source: 'legacy_profile',
      updatedAt: null,
    },
  }
  assert.deepEqual(parseAssignmentIssuerIdentitySnapshotV1(legacy, EXPECTED), legacy)
})

test('the creator fails closed for runtime input that violates the schema', () => {
  const input = validSnapshotInput()
  const invalid = {
    ...input,
    company: { ...input.company, name: '' },
  }

  assert.throws(
    () => createAssignmentIssuerIdentitySnapshotV1(invalid),
    /ASSIGNMENT_ISSUER_IDENTITY_INVALID/u
  )
})
