export type PublicCompanyInfo = {
  name: string
  organizationNumber: string
  vatNumber: string
  address: { street: string; postalCode: string; city: string; country: string }
  email: string | null
}

// Always-visible company identity, independent of optional pricing/contact campaigns.
// Sources and verification notes: docs/PUBLIC_COMPANY_INFO.md.
// Ownership wording supplied by the user; company details checked 2026-09-07.
export const PUBLIC_COMPANY_INFO: PublicCompanyInfo = {
  name: 'JNH Consulting AB',
  organizationNumber: '559027-7694',
  vatNumber: 'SE559027769401',
  address: { street: 'Bryggvägen 7', postalCode: '117 71', city: 'Stockholm', country: 'Sverige' },
  // Do not infer a public HusHub contact from mail-provider settings or other companies.
  email: null,
}

export const PUBLIC_COMPANY_PAGE = '/om-hushub'
