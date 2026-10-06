import type { AssignmentIssuerIdentitySnapshotV1 } from '../../src/lib/assignments/issuerIdentity'

export const OB_TEST_ORG = '11111111-1111-4111-8111-111111111111'
export const OB_TEST_ACTOR = '33333333-3333-4333-8333-333333333333'
export function obIssuedIdentity(): AssignmentIssuerIdentitySnapshotV1 {
  return {
    schema: 'assignment_issuer_v1', orgId: OB_TEST_ORG, profileId: OB_TEST_ACTOR,
    capturedAt: '2026-10-02T10:00:00Z',
    card: { id: '44444444-4444-4444-8444-444444444444', version: 1, source: 'organization_card', updatedAt: '2026-10-02T09:00:00Z' },
    inspector: { displayName: 'Issued inspector', title: null, phone: null, email: 'issued@example.test', avatarPath: null, signaturePath: null },
    company: { name: 'Issued organization', organizationNumber: '1234567890', address: null, postalCode: null, city: null, logoPath: null, reportFooterText: null },
    certifications: { sbrGroup: null, sbrStatus: null, membershipNumber: null, certificationNumber: null, isSbrDiplomeradAreamatning: false, items: [] },
    replyToEmail: 'issued@example.test',
  }
}
