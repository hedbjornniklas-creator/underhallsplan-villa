import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

type ResolverModule = {
  resolveOrganizationProfileCard: (input: {
    orgId: string
    profileId: string
  }) => Promise<Record<string, unknown>>
  requireConfiguredOrganizationProfileCard: (input: {
    orgId: string
    profileId: string
  }) => Promise<Record<string, unknown>>
  saveOrganizationProfileCard: (input: {
    orgId: string
    profileId: string
    actorProfileId: string
    expectedVersion: number | null
    values: Record<string, string | null>
  }) => Promise<Record<string, unknown>>
}

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const ORG_A = '22222222-2222-4222-8222-222222222222'
const ORG_B = '33333333-3333-4333-8333-333333333333'

type Fixture = {
  card?: Record<string, unknown> | null
  cardError?: { code?: string; message?: string } | null
  memberships: Array<{ org_id: string; is_default: boolean }>
  company?: Record<string, unknown> | null
  profile?: Partial<{
    avatar_path: string | null
    logo_path: string | null
    signature_path: string | null
  }>
}

function loadResolver(fixture: Fixture): ResolverModule {
  const file = 'src/lib/organizations/profileCard.ts'
  const output = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
    {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText
  const compiled = { exports: {} }

  const profile = {
    id: PROFILE_ID,
    full_name: 'Niklas Global',
    email: 'global@styr.example',
    phone: '070-111 11 11',
    avatar_path: 'profiles/global-avatar.jpg',
    company_name: 'STYR Global AB',
    company_orgno: '556000-0000',
    company_address: 'Styrgatan 1',
    company_postal_code: '111 11',
    company_city: 'Stockholm',
    logo_path: 'profiles/styr-logo.png',
    signature_path: 'profiles/styr-signature.png',
    ...fixture.profile,
  }

  function response(table: string) {
    if (table === 'profiles') return { data: profile, error: null }
    if (table === 'profile_org_cards') {
      return { data: fixture.card ?? null, error: fixture.cardError ?? null }
    }
    if (table === 'org_members') return { data: fixture.memberships, error: null }
    throw new Error(`Unexpected table ${table}`)
  }

  function query(table: string) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => response(table),
      then: (
        resolve: (value: ReturnType<typeof response>) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(response(table)).then(resolve, reject),
    }
    return builder
  }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name === 'server-only') return {}
      if (name === '@/lib/supabase/admin') {
        return { createSupabaseAdminClient: () => ({ from: query }) }
      }
      if (name === '@/lib/organizations/companyProfile') {
        return { readOrganizationBranding: async () => fixture.company ?? null }
      }
      throw new Error(`Unexpected resolver dependency ${name}`)
    },
    compiled,
    compiled.exports
  )
  return compiled.exports as ResolverModule
}

test('a second organization fails closed instead of inheriting global company data', async () => {
  const resolver = loadResolver({
    memberships: [
      { org_id: ORG_A, is_default: true },
      { org_id: ORG_B, is_default: false },
    ],
  })
  const card = await resolver.resolveOrganizationProfileCard({
    orgId: ORG_B,
    profileId: PROFILE_ID,
  })

  assert.equal(card.source, 'unconfigured')
  assert.equal(card.configured, false)
  assert.equal(card.companyName, '')
  assert.equal(card.email, null)
  assert.equal(card.phone, null)
  assert.equal(card.logoPath, null)
  assert.equal(card.signaturePath, null)
  assert.deepEqual(card.legacyMediaAvailable, {
    avatarPath: true,
    logoPath: true,
    signaturePath: true,
  })
})

test('the default flag alone never enables legacy branding in a multi-org account', async () => {
  const resolver = loadResolver({
    memberships: [
      { org_id: ORG_A, is_default: true },
      { org_id: ORG_B, is_default: false },
    ],
  })
  const card = await resolver.resolveOrganizationProfileCard({
    orgId: ORG_A,
    profileId: PROFILE_ID,
  })

  assert.equal(card.isDefaultOrganization, true)
  assert.equal(card.source, 'unconfigured')
  assert.equal(card.configured, false)
})

test('recognizes legacy media stored as public URLs in the current Supabase project', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co'
  try {
    const resolver = loadResolver({
      memberships: [
        { org_id: ORG_A, is_default: true },
        { org_id: ORG_B, is_default: false },
      ],
      profile: {
        avatar_path: `https://project-ref.supabase.co/storage/v1/object/public/property-media/profiles/${PROFILE_ID}/avatar.webp?v=1`,
        logo_path: `https://project-ref.supabase.co/storage/v1/object/public/property-media/profiles/${PROFILE_ID}/logo.png?v=2`,
        signature_path: `https://project-ref.supabase.co/storage/v1/object/public/property-media/profiles/${PROFILE_ID}/signature.jpg?v=3`,
      },
    })
    const card = await resolver.resolveOrganizationProfileCard({
      orgId: ORG_A,
      profileId: PROFILE_ID,
    })

    assert.deepEqual(card.legacyMediaAvailable, {
      avatarPath: true,
      logoPath: true,
      signaturePath: true,
    })
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
  }
})

test('rejects public media URLs from another project or an organization-specific path', async () => {
  const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project-ref.supabase.co'
  try {
    const resolver = loadResolver({
      memberships: [{ org_id: ORG_A, is_default: true }],
      profile: {
        avatar_path: 'https://other-project.supabase.co/storage/v1/object/public/property-media/profiles/avatar.webp',
        logo_path: `https://project-ref.supabase.co/storage/v1/object/public/property-media/profiles/${PROFILE_ID}/organizations/${ORG_B}/logo.png`,
        signature_path: 'javascript:alert(1)',
      },
    })
    const card = await resolver.resolveOrganizationProfileCard({
      orgId: ORG_A,
      profileId: PROFILE_ID,
    })

    assert.deepEqual(card.legacyMediaAvailable, {
      avatarPath: false,
      logoPath: false,
      signaturePath: false,
    })
  } finally {
    if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl
  }
})

test('a single active organization may use the legacy profile during migration', async () => {
  const resolver = loadResolver({
    memberships: [{ org_id: ORG_A, is_default: true }],
    cardError: { code: '42P01', message: 'relation profile_org_cards does not exist' },
  })
  const card = await resolver.resolveOrganizationProfileCard({
    orgId: ORG_A,
    profileId: PROFILE_ID,
  })

  assert.equal(card.source, 'legacy_profile')
  assert.equal(card.configured, true)
  assert.equal(card.migrationRequired, true)
  assert.equal(card.companyName, 'STYR Global AB')
})

test('a missing card stays unconfigured after the organization-card migration exists', async () => {
  const resolver = loadResolver({
    memberships: [{ org_id: ORG_A, is_default: true }],
  })
  const card = await resolver.resolveOrganizationProfileCard({
    orgId: ORG_A,
    profileId: PROFILE_ID,
  })

  assert.equal(card.source, 'unconfigured')
  assert.equal(card.configured, false)
  assert.equal(card.migrationRequired, false)
  assert.equal(card.avatarPath, null)
  assert.equal(card.companyName, '')
})

test('document issuing requires SQL 07 and an exact organization card', async () => {
  const migrationMissing = loadResolver({
    memberships: [{ org_id: ORG_A, is_default: true }],
    cardError: { code: '42P01', message: 'relation profile_org_cards does not exist' },
  })
  await assert.rejects(
    migrationMissing.requireConfiguredOrganizationProfileCard({
      orgId: ORG_A,
      profileId: PROFILE_ID,
    }),
    { message: 'ORG_PROFILE_CARD_MIGRATION_REQUIRED' }
  )

  const cardMissing = loadResolver({
    memberships: [{ org_id: ORG_A, is_default: true }],
  })
  await assert.rejects(
    cardMissing.requireConfiguredOrganizationProfileCard({
      orgId: ORG_A,
      profileId: PROFILE_ID,
    }),
    { message: 'ORG_PROFILE_CARD_REQUIRED' }
  )
})

test('an exact organization card always wins over the legacy profile', async () => {
  const resolver = loadResolver({
    memberships: [
      { org_id: ORG_A, is_default: true },
      { org_id: ORG_B, is_default: false },
    ],
    card: {
      id: '44444444-4444-4444-8444-444444444444',
      org_id: ORG_B,
      profile_id: PROFILE_ID,
      display_name: 'Niklas SVEA',
      title: 'Besiktningsman',
      phone: '070-222 22 22',
      email: 'niklas@svea.example',
      company_name: 'SVEA Ingenjörer AB',
      company_orgno: '556111-1111',
      company_address: 'Sveavägen 1',
      company_postal_code: '222 22',
      company_city: 'Uppsala',
      avatar_path: 'profiles/svea-avatar.jpg',
      logo_path: 'profiles/svea-logo.png',
      signature_path: 'profiles/svea-signature.png',
      report_footer_text: null,
      version: 2,
      created_at: '2026-09-12T10:00:00.000Z',
      updated_at: '2026-09-12T11:00:00.000Z',
    },
  })
  const card = await resolver.resolveOrganizationProfileCard({
    orgId: ORG_B,
    profileId: PROFILE_ID,
  })

  assert.equal(card.source, 'organization_card')
  assert.equal(card.companyName, 'SVEA Ingenjörer AB')
  assert.equal(card.email, 'niklas@svea.example')
  assert.equal(card.version, 2)
})

const SAVED_CARD = {
  id: '44444444-4444-4444-8444-444444444444',
  org_id: ORG_A,
  profile_id: PROFILE_ID,
  display_name: 'Niklas STYR',
  title: 'Besiktningsman',
  phone: '070-111 11 11',
  email: 'niklas@styr.example',
  company_name: 'STYR Projekt AB',
  company_orgno: '556123-4567',
  company_address: 'Styrgatan 1',
  company_postal_code: '111 11',
  company_city: 'Stockholm',
  avatar_path: 'https://legacy.example/avatar.jpg',
  logo_path: 'profiles/legacy-logo.png',
  signature_path: null,
  report_footer_text: null,
  version: 2,
  created_at: '2026-09-12T10:00:00.000Z',
  updated_at: '2026-09-12T11:00:00.000Z',
}

const SHARED_COMPANY = {
  id: ORG_A,
  name: 'Organisationens gemensamma AB',
  organizationNumber: '556999-9999',
  address: 'Gemensamma gatan 2',
  postalCode: '333 33',
  city: 'Göteborg',
  website: 'https://gemensamt.example',
  logoPath: `organizations/${ORG_A}/logo-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`,
  reportFooterText: 'Organisationens gemensamma sidfot',
  configured: true,
  version: 5,
}

function savedCardValues(overrides: Record<string, string | null> = {}) {
  return {
    displayName: SAVED_CARD.display_name,
    title: SAVED_CARD.title,
    phone: SAVED_CARD.phone,
    email: SAVED_CARD.email,
    companyName: SHARED_COMPANY.name,
    companyOrgNo: SHARED_COMPANY.organizationNumber,
    companyAddress: SHARED_COMPANY.address,
    companyPostalCode: SHARED_COMPANY.postalCode,
    companyCity: SHARED_COMPANY.city,
    avatarPath: SAVED_CARD.avatar_path,
    logoPath: SHARED_COMPANY.logoPath,
    signaturePath: SAVED_CARD.signature_path,
    reportFooterText: SHARED_COMPANY.reportFooterText,
    ...overrides,
  }
}

function saveHarness(options: {
  company?: Record<string, unknown> | null
  card?: Record<string, unknown> | null
  rpcError?: { code?: string; message?: string } | null
} = {}) {
  const writes: Array<{ operation: string; values: Record<string, unknown> }> = []
  let saved: Record<string, unknown> | null = options.card === undefined ? { ...SAVED_CARD } : options.card
  const profile = {
    id: PROFILE_ID,
    full_name: 'Niklas Global',
    email: 'global@styr.example',
    phone: '070-111 11 11',
    avatar_path: 'profiles/global-avatar.jpg',
    company_name: 'STYR Global AB',
    company_orgno: '556000-0000',
    company_address: 'Styrgatan 1',
    company_postal_code: '111 11',
    company_city: 'Stockholm',
    logo_path: 'profiles/styr-logo.png',
    signature_path: 'profiles/styr-signature.png',
  }

  function selection(table: string) {
    if (table === 'profiles') return { data: profile, error: null }
    if (table === 'profile_org_cards') return { data: saved, error: null }
    if (table === 'org_members') {
      return { data: [{ org_id: ORG_A, is_default: true }], error: null }
    }
    throw new Error(`Unexpected table ${table}`)
  }

  function query(table: string) {
    const builder = {
      select: () => builder,
      eq: () => builder,
      maybeSingle: async () => selection(table),
      then: (
        resolve: (value: ReturnType<typeof selection>) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(selection(table)).then(resolve, reject),
    }
    return builder
  }

  async function rpc(operation: string, values: Record<string, unknown>) {
    writes.push({ operation, values })
    if (options.rpcError) return { data: null, error: options.rpcError }
    const personal = values.p_values as Record<string, unknown>
    saved = {
      ...(saved ?? SAVED_CARD),
      display_name: personal.displayName, title: personal.title, phone: personal.phone,
      email: personal.email, avatar_path: personal.avatarPath, signature_path: personal.signaturePath,
      version: Number(values.p_expected_version ?? 0) + 1,
    }
    return { data: { saved: true }, error: null }
  }

  const file = 'src/lib/organizations/profileCard.ts'
  const output = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
    {
      fileName: file,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name === 'server-only') return {}
      if (name === '@/lib/supabase/admin') {
        return { createSupabaseAdminClient: () => ({ from: query, rpc }) }
      }
      if (name === '@/lib/organizations/companyProfile') {
        return { readOrganizationBranding: async () => options.company === undefined ? SHARED_COMPANY : options.company }
      }
      throw new Error(`Unexpected save dependency ${name}`)
    },
    compiled,
    compiled.exports
  )

  return { module: compiled.exports as ResolverModule, writes }
}

async function saveWithMedia(values: Record<string, string | null>) {
  const harness = saveHarness()
  await harness.module.saveOrganizationProfileCard({
    orgId: ORG_A,
    profileId: PROFILE_ID,
    actorProfileId: PROFILE_ID,
    expectedVersion: SAVED_CARD.version,
    values,
  })
  return harness
}

test('personal profile save accepts null, exactly unchanged legacy media and own generated upload paths through RPC', async () => {
  const ownPrefix = `profiles/${PROFILE_ID}/organizations/${ORG_A}/`
  const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const cases = [
    savedCardValues(),
    savedCardValues({ avatarPath: null, signaturePath: null }),
    savedCardValues({
      avatarPath: `${ownPrefix}avatarPath-${uploadId}.png`,
      signaturePath: `${ownPrefix}signaturePath-${uploadId}.webp`,
    }),
  ]

  for (const values of cases) {
    const harness = await saveWithMedia(values)
    assert.equal(harness.writes.length, 1)
    assert.deepEqual(harness.writes[0], {
      operation: 'organization_member_profile_save',
      values: {
        p_actor: PROFILE_ID,
        p_org: ORG_A,
        p_expected_version: SAVED_CARD.version,
        p_values: { displayName: values.displayName, title: values.title, phone: values.phone,
          email: values.email, avatarPath: values.avatarPath, signaturePath: values.signaturePath },
      },
    })
  }
})

test('profile save rejects external, foreign, mismatched and non-upload media paths before writing', async () => {
  const ownPrefix = `profiles/${PROFILE_ID}/organizations/${ORG_A}/`
  const otherProfile = '55555555-5555-4555-8555-555555555555'
  const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const invalidCases: Array<Record<string, string | null>> = [
    { avatarPath: 'https://attacker.example/avatar.png' },
    { avatarPath: `profiles/${PROFILE_ID}/organizations/${ORG_B}/avatarPath-${uploadId}.png` },
    { signaturePath: `profiles/${otherProfile}/organizations/${ORG_A}/signaturePath-${uploadId}.png` },
    { signaturePath: `${ownPrefix}avatarPath-${uploadId}.png` },
    { avatarPath: `${ownPrefix}avatarPath-../foreign.png` },
    { avatarPath: `${ownPrefix}avatarPath-${uploadId}.svg` },
    { signaturePath: `${ownPrefix}signaturePath-not-a-generated-id.webp` },
  ]

  for (const overrides of invalidCases) {
    const harness = saveHarness()
    await assert.rejects(
      harness.module.saveOrganizationProfileCard({
        orgId: ORG_A,
        profileId: PROFILE_ID,
        actorProfileId: PROFILE_ID,
        expectedVersion: SAVED_CARD.version,
        values: savedCardValues(overrides),
      }),
      { message: 'ORG_PROFILE_CARD_INPUT_INVALID' }
    )
    assert.deepEqual(harness.writes, [], JSON.stringify(overrides))
  }
})

test('shared company identity overrides every corporate field on an old member card while personal identity stays local', async () => {
  const resolver = loadResolver({ memberships: [{ org_id: ORG_A, is_default: true }], card: SAVED_CARD, company: SHARED_COMPANY })
  const card = await resolver.resolveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID })
  assert.equal(card.sharedCompany, true)
  assert.equal(card.configured, true)
  assert.equal(card.companyConfigured, true)
  assert.equal(card.companyName, SHARED_COMPANY.name)
  assert.equal(card.companyOrgNo, SHARED_COMPANY.organizationNumber)
  assert.equal(card.companyAddress, SHARED_COMPANY.address)
  assert.equal(card.companyPostalCode, SHARED_COMPANY.postalCode)
  assert.equal(card.companyCity, SHARED_COMPANY.city)
  assert.equal(card.logoPath, SHARED_COMPANY.logoPath)
  assert.equal(card.reportFooterText, SHARED_COMPANY.reportFooterText)
  assert.equal(card.displayName, SAVED_CARD.display_name)
  assert.equal(card.email, SAVED_CARD.email)
  assert.equal(card.phone, SAVED_CARD.phone)
  assert.equal(card.avatarPath, SAVED_CARD.avatar_path)
  assert.equal(card.signaturePath, SAVED_CARD.signature_path)
  assert.equal((card.legacyMediaAvailable as Record<string, boolean>).logoPath, false)
})

test('issuing blocks unconfigured shared company identity even when an old member card exists', async () => {
  const resolver = loadResolver({ memberships: [{ org_id: ORG_A, is_default: true }], card: SAVED_CARD,
    company: { ...SHARED_COMPANY, configured: false } })
  const card = await resolver.resolveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID })
  assert.equal(card.companyName, SHARED_COMPANY.name)
  assert.equal(card.configured, false)
  await assert.rejects(resolver.requireConfiguredOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID }), { message: 'ORG_PROFILE_CARD_REQUIRED' })
})

test('shared company alone never substitutes for a missing personal member card', async () => {
  const resolver = loadResolver({ memberships: [{ org_id: ORG_A, is_default: true }], company: SHARED_COMPANY })
  const card = await resolver.resolveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID })
  assert.equal(card.source, 'unconfigured')
  assert.equal(card.configured, false)
  assert.equal(card.companyConfigured, true)
  assert.equal(card.companyName, SHARED_COMPANY.name)
  assert.equal(card.signaturePath, null)
  await assert.rejects(resolver.requireConfiguredOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID }), { message: 'ORG_PROFILE_CARD_REQUIRED' })
})

test('shared company cannot give a non-member access to another organization card', async () => {
  const resolver = loadResolver({ memberships: [{ org_id: ORG_A, is_default: true }], card: { ...SAVED_CARD, org_id: ORG_B },
    company: { ...SHARED_COMPANY, id: ORG_B } })
  await assert.rejects(resolver.resolveOrganizationProfileCard({ orgId: ORG_B, profileId: PROFILE_ID }), { message: 'ORG_MEMBERSHIP_REQUIRED' })
})

test('inspector can update own person fields and own signature without submitting any company mutation to RPC', async () => {
  const harness = saveHarness()
  const values = savedCardValues({ displayName: 'Anna Medlem', title: 'Teknisk utredare', phone: '070-999 99 99', email: 'anna@company.example',
    signaturePath: `profiles/${PROFILE_ID}/organizations/${ORG_A}/signaturePath-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png` })
  const saved = await harness.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: PROFILE_ID,
    expectedVersion: SAVED_CARD.version, values })
  assert.equal(saved.displayName, values.displayName)
  assert.equal(saved.signaturePath, values.signaturePath)
  assert.equal(saved.version, SAVED_CARD.version + 1)
  assert.equal(saved.companyName, SHARED_COMPANY.name)
  assert.deepEqual(Object.keys(harness.writes[0].values.p_values as object).sort(), ['avatarPath', 'displayName', 'email', 'phone', 'signaturePath', 'title'])
})

test('company fields and logo are read only through personal save, even for a valid generated logo path', async () => {
  const corporateChanges: Array<Record<string, string | null>> = [
    { companyName: 'Annat företag AB' }, { companyOrgNo: '556123-4567' }, { companyAddress: 'Annangatan 3' },
    { companyPostalCode: '111 11' }, { companyCity: 'Stockholm' }, { reportFooterText: 'Egen företagssidfot' },
    { logoPath: null }, { logoPath: `profiles/${PROFILE_ID}/organizations/${ORG_A}/logoPath-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png` },
    { logoPath: `profiles/55555555-5555-4555-8555-555555555555/organizations/${ORG_A}/logoPath-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png` },
  ]
  for (const overrides of corporateChanges) {
    const harness = saveHarness()
    await assert.rejects(harness.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: PROFILE_ID,
      expectedVersion: SAVED_CARD.version, values: savedCardValues(overrides) }), { message: 'ORG_COMPANY_FIELDS_READ_ONLY' })
    assert.deepEqual(harness.writes, [])
  }
})

test('a second actor cannot replace another member personal fields or signature', async () => {
  const actor = '55555555-5555-4555-8555-555555555555'
  const changes: Array<Record<string, string | null>> = [{ displayName: 'Ersatt namn' }, { signaturePath: null }, {
    signaturePath: `profiles/${PROFILE_ID}/organizations/${ORG_A}/signaturePath-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png`,
  }]
  for (const overrides of changes) {
    const harness = saveHarness()
    await assert.rejects(harness.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: actor,
      expectedVersion: SAVED_CARD.version, values: savedCardValues(overrides) }), { message: 'ORG_PROFILE_CARD_ADMIN_REQUIRED' })
    assert.deepEqual(harness.writes, [])
  }
})

test('personal save requires the company migration and preserves optimistic concurrency at both boundaries', async () => {
  const unmigrated = saveHarness({ company: null })
  await assert.rejects(unmigrated.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: PROFILE_ID,
    expectedVersion: SAVED_CARD.version, values: savedCardValues() }), { message: 'ORG_PROFILE_CARD_MIGRATION_REQUIRED' })
  assert.deepEqual(unmigrated.writes, [])

  const stale = saveHarness()
  await assert.rejects(stale.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: PROFILE_ID,
    expectedVersion: SAVED_CARD.version - 1, values: savedCardValues() }), { message: 'ORG_PROFILE_CARD_CONFLICT' })
  assert.deepEqual(stale.writes, [])

  const raced = saveHarness({ rpcError: { message: 'ORG_CONFLICT' } })
  await assert.rejects(raced.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: PROFILE_ID,
    expectedVersion: SAVED_CARD.version, values: savedCardValues() }), { message: 'ORG_PROFILE_CARD_CONFLICT' })
  assert.equal(raced.writes.length, 1)
})

test('first personal card creation maps missing version to the SQL create sentinel and allows preparing a profile before company confirmation', async () => {
  const harness = saveHarness({ card: null, company: { ...SHARED_COMPANY, configured: false } })
  const values = savedCardValues({ avatarPath: null, signaturePath: null })
  const result = await harness.module.saveOrganizationProfileCard({ orgId: ORG_A, profileId: PROFILE_ID, actorProfileId: PROFILE_ID,
    expectedVersion: null, values })
  assert.equal(harness.writes[0].values.p_expected_version, 0)
  assert.equal(result.source, 'organization_card')
  assert.equal(result.version, 1)
  assert.equal(result.configured, false)
})
