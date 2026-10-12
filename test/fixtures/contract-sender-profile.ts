import type { ContractSenderProfileSnapshot } from '../../src/lib/action-cases/contractSenderProfile'

export function contractSenderFixture(): ContractSenderProfileSnapshot {
  return { version: 1, organizationId: '00000000-0000-4000-8000-000000000090',
    profileId: '00000000-0000-4000-8000-000000000091', profileVersion: 3, legalNameVersion: 2,
    legalName: 'Fiktivt Juridiskt Bolag AB', organizationNumber: '556016-0680', name: 'STYR - FIKTIV TESTPROFIL',
    address: 'Profilgatan 2', postalCode: '12345', city: 'Teststad', email: 'styr@example.test', phone: '080000000',
    website: 'https://example.test/', logoPath: null, logoDataUrl: null,
    reportFooterText: 'Fiktiva profiluppgifter för test. Inte ett verkligt avtal.' }
}
