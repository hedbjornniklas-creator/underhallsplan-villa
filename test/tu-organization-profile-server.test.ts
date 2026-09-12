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

function savedCardValues(overrides: Record<string, string | null> = {}) {
  return {
    displayName: SAVED_CARD.display_name,
    title: SAVED_CARD.title,
    phone: SAVED_CARD.phone,
    email: SAVED_CARD.email,
    companyName: SAVED_CARD.company_name,
    companyOrgNo: SAVED_CARD.company_orgno,
    companyAddress: SAVED_CARD.company_address,
    companyPostalCode: SAVED_CARD.company_postal_code,
    companyCity: SAVED_CARD.company_city,
    avatarPath: SAVED_CARD.avatar_path,
    logoPath: SAVED_CARD.logo_path,
    signaturePath: SAVED_CARD.signature_path,
    reportFooterText: SAVED_CARD.report_footer_text,
    ...overrides,
  }
}

function saveHarness() {
  const writes: Array<{ operation: 'insert' | 'update'; values: unknown }> = []
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
    if (table === 'profile_org_cards') return { data: SAVED_CARD, error: null }
    if (table === 'org_members') {
      return { data: [{ org_id: ORG_A, is_default: true }], error: null }
    }
    throw new Error(`Unexpected table ${table}`)
  }

  function query(table: string) {
    let operation: 'select' | 'insert' | 'update' = 'select'
    const builder = {
      select: () => builder,
      eq: () => builder,
      insert: (values: unknown) => {
        operation = 'insert'
        writes.push({ operation, values })
        return builder
      },
      update: (values: unknown) => {
        operation = 'update'
        writes.push({ operation, values })
        return builder
      },
      single: async () =>
        operation === 'select'
          ? selection(table)
          : { data: { id: SAVED_CARD.id }, error: null },
      maybeSingle: async () =>
        operation === 'select'
          ? selection(table)
          : { data: { id: SAVED_CARD.id }, error: null },
      then: (
        resolve: (value: ReturnType<typeof selection>) => unknown,
        reject?: (reason: unknown) => unknown
      ) => Promise.resolve(selection(table)).then(resolve, reject),
    }
    return builder
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
        return { createSupabaseAdminClient: () => ({ from: query }) }
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

test('profile save accepts null, exactly unchanged legacy media and own generated upload paths', async () => {
  const ownPrefix = `profiles/${PROFILE_ID}/organizations/${ORG_A}/`
  const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const cases = [
    savedCardValues(),
    savedCardValues({ avatarPath: null, logoPath: null, signaturePath: null }),
    savedCardValues({
      avatarPath: `${ownPrefix}avatarPath-${uploadId}.png`,
      logoPath: `${ownPrefix}logoPath-${uploadId}.jpg`,
      signaturePath: `${ownPrefix}signaturePath-${uploadId}.webp`,
    }),
  ]

  for (const values of cases) {
    const harness = await saveWithMedia(values)
    assert.equal(harness.writes.length, 1)
    assert.equal(harness.writes[0].operation, 'update')
  }
})

test('profile save rejects external, foreign, mismatched and non-upload media paths before writing', async () => {
  const ownPrefix = `profiles/${PROFILE_ID}/organizations/${ORG_A}/`
  const otherProfile = '55555555-5555-4555-8555-555555555555'
  const uploadId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const invalidCases = [
    { avatarPath: 'https://attacker.example/avatar.png' },
    { avatarPath: `profiles/${PROFILE_ID}/organizations/${ORG_B}/avatarPath-${uploadId}.png` },
    { logoPath: `profiles/${otherProfile}/organizations/${ORG_A}/logoPath-${uploadId}.png` },
    { signaturePath: `${ownPrefix}avatarPath-${uploadId}.png` },
    { avatarPath: `${ownPrefix}avatarPath-../foreign.png` },
    { logoPath: `${ownPrefix}logoPath-${uploadId}.svg` },
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
