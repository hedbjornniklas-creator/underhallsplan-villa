import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

const {
  FORTNOX_API_BASE_URL,
  FORTNOX_AUTHORIZATION_ENDPOINT,
  FORTNOX_CALLBACK_PATH,
  FORTNOX_CONNECTION_SCOPES,
  FORTNOX_CUSTOMER_EXTERNAL_REFERENCE_MAX_LENGTH,
  FORTNOX_CUSTOMER_LIST_LIMIT,
  FORTNOX_CUSTOMER_NUMBER_MAX_LENGTH,
  FORTNOX_PRODUCTION_REDIRECT_URI,
  FORTNOX_TOKEN_ENDPOINT,
  buildFortnoxAuthorizationUrl,
  buildFortnoxCustomerDraft,
  buildFortnoxCustomerIdentity,
  hasAllowedFortnoxConnectionScopes,
  hasExactFortnoxScopes,
  hasRequiredFortnoxScopes,
  parseFortnoxCustomerDraft,
  parseFortnoxCustomerListResponse,
  parseFortnoxCustomerResponse,
  normalizeFortnoxOrganizationNumber,
  normalizeFortnoxScopes,
  parseFortnoxCompanyInformation,
  parseFortnoxTokenResponse,
} = fortnoxDomain

test('Fortnox endpoints, callback and customer/invoice connection scopes stay fixed', () => {
  assert.equal(FORTNOX_AUTHORIZATION_ENDPOINT, 'https://apps.fortnox.se/oauth-v1/auth')
  assert.equal(FORTNOX_TOKEN_ENDPOINT, 'https://apps.fortnox.se/oauth-v1/token')
  assert.equal(FORTNOX_API_BASE_URL, 'https://api.fortnox.se/3')
  assert.equal(FORTNOX_CALLBACK_PATH, '/api/integrations/fortnox/callback')
  assert.equal(FORTNOX_PRODUCTION_REDIRECT_URI, 'https://hushub.se/api/integrations/fortnox/callback')
  assert.deepEqual(FORTNOX_CONNECTION_SCOPES, [
    'companyinformation',
    'customer',
    'invoice',
  ])
  assert.ok(Object.isFrozen(FORTNOX_CONNECTION_SCOPES))
})

test('organization numbers normalize only checksum-valid supported ten-digit forms', () => {
  for (const value of ['556123-4567', '5561234567', '  556123-4567  ']) {
    assert.equal(normalizeFortnoxOrganizationNumber(value), '556123-4567')
  }
  for (const value of [null, undefined, 5561234567, '', '55612-34567', '556123 4567', 'SE556123456701', '556123–4567', '556123-456x', '556123-4568']) {
    assert.equal(normalizeFortnoxOrganizationNumber(value), null, String(value))
  }
})

test('Fortnox scopes are case-sensitive, validated and de-duplicated', () => {
  assert.deepEqual(normalizeFortnoxScopes(' customer  companyinformation customer '), [
    'customer',
    'companyinformation',
  ])
  assert.deepEqual(normalizeFortnoxScopes(['companyinformation', 'customer', 'customer']), [
    'companyinformation',
    'customer',
  ])
  for (const value of [null, '', [], ['companyinformation customer'], ['companyinformation', 1], 'CompanyInformation', 'companyinformation "customer"']) {
    assert.deepEqual(normalizeFortnoxScopes(value), [], String(value))
  }
  assert.equal(hasRequiredFortnoxScopes('invoice customer companyinformation'), true)
  assert.equal(hasRequiredFortnoxScopes('customer'), false)
  assert.equal(hasRequiredFortnoxScopes('companyinformation', ['companyinformation', 'customer']), false)
  assert.equal(hasExactFortnoxScopes('invoice customer companyinformation'), true)
  assert.equal(hasExactFortnoxScopes('companyinformation'), false)
  assert.equal(hasExactFortnoxScopes('customer'), false)
  assert.equal(hasAllowedFortnoxConnectionScopes('companyinformation'), true)
  assert.equal(
    hasAllowedFortnoxConnectionScopes('invoice companyinformation customer'),
    true
  )
  assert.equal(hasAllowedFortnoxConnectionScopes('companyinformation customer'), false)
  assert.equal(
    hasAllowedFortnoxConnectionScopes('companyinformation customer invoice order'),
    false
  )
})

test('authorization URL exactly describes Fortnox service-account consent', () => {
  const state = 'state_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const url = new URL(buildFortnoxAuthorizationUrl({ clientId: ' client-id ', state }))

  assert.equal(url.origin + url.pathname, FORTNOX_AUTHORIZATION_ENDPOINT)
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    'access_type',
    'account_type',
    'client_id',
    'redirect_uri',
    'response_type',
    'scope',
    'state',
  ])
  assert.equal(url.searchParams.get('client_id'), 'client-id')
  assert.equal(url.searchParams.get('redirect_uri'), FORTNOX_PRODUCTION_REDIRECT_URI)
  assert.equal(url.searchParams.get('scope'), 'companyinformation customer invoice')
  assert.equal(url.searchParams.get('state'), state)
  assert.equal(url.searchParams.get('access_type'), 'offline')
  assert.equal(url.searchParams.get('response_type'), 'code')
  assert.equal(url.searchParams.get('account_type'), 'service')
  assert.equal(url.searchParams.has('client_secret'), false)
})

test('authorization URL rejects malformed state, client ID and callback URI', () => {
  const state = 'state_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  for (const invalidState of ['', 'short', 'x'.repeat(201), 'x'.repeat(31), `${'x'.repeat(32)}!`]) {
    assert.throws(
      () => buildFortnoxAuthorizationUrl({ clientId: 'client-id', state: invalidState }),
      { message: 'FORTNOX_STATE_INVALID' }
    )
  }
  for (const clientId of ['', 'client id', `client-${'x'.repeat(512)}`]) {
    assert.throws(
      () => buildFortnoxAuthorizationUrl({ clientId, state }),
      { message: 'FORTNOX_CLIENT_ID_INVALID' }
    )
  }
  for (const redirectUri of [
    'http://example.test/api/integrations/fortnox/callback',
    'https://user:pass@example.test/api/integrations/fortnox/callback',
    'https://example.test/another/callback',
    'https://example.test/api/integrations/fortnox/callback?next=/settings',
    'https://example.test/api/integrations/fortnox/callback#fragment',
  ]) {
    assert.throws(
      () => buildFortnoxAuthorizationUrl({ clientId: 'client-id', state, redirectUri }),
      { message: 'FORTNOX_REDIRECT_URI_INVALID' }
    )
  }
  assert.equal(
    new URL(buildFortnoxAuthorizationUrl({
      clientId: 'client-id',
      state,
      redirectUri: `http://localhost:3000${FORTNOX_CALLBACK_PATH}`,
    })).searchParams.get('redirect_uri'),
    `http://localhost:3000${FORTNOX_CALLBACK_PATH}`
  )
})

test('token response parser returns only a valid bearer token and granted scopes', () => {
  const parsed = parseFortnoxTokenResponse({
    access_token: 'access-token-value',
    refresh_token: 'must-not-leave-the-parser',
    scope: 'companyinformation customer invoice customer',
    expires_in: 3600,
    token_type: 'Bearer',
  })
  assert.deepEqual(parsed, {
    accessToken: 'access-token-value',
    scopes: ['companyinformation', 'customer', 'invoice'],
    expiresIn: 3600,
    tokenType: 'bearer',
  })
  assert.equal('refreshToken' in parsed!, false)
})

test('token response parser fails closed on malformed envelopes and missing scope', () => {
  const valid = {
    access_token: 'access-token-value',
    scope: 'companyinformation customer invoice',
    expires_in: 3600,
    token_type: 'bearer',
  }
  const invalid: unknown[] = [
    null,
    [],
    '<html>upstream unavailable</html>',
    { ...valid, access_token: '' },
    { ...valid, access_token: 'token with whitespace' },
    { ...valid, scope: undefined },
    { ...valid, scope: 'customer' },
    { ...valid, scope: 'companyinformation' },
    { ...valid, scope: 'companyinformation customer' },
    { ...valid, scope: 'companyinformation customer invoice order' },
    { ...valid, expires_in: '3600' },
    { ...valid, expires_in: 0 },
    { ...valid, expires_in: 1.5 },
    { ...valid, token_type: 'mac' },
  ]
  for (const value of invalid) assert.equal(parseFortnoxTokenResponse(value), null)
  assert.equal(parseFortnoxTokenResponse(valid, ['companyinformation', 'customer']), null)
})

test('company-information parser accepts Fortnox numeric and digit-string TenantIds', () => {
  assert.deepEqual(parseFortnoxCompanyInformation({
    CompanyInformation: {
      DatabaseNumber: 123456,
      CompanyName: '  STYR Projekt Stockholm AB  ',
      OrganizationNumber: '5561234567',
    },
  }), {
    tenantId: '123456',
    companyName: 'STYR Projekt Stockholm AB',
    organizationNumber: '556123-4567',
  })
  assert.deepEqual(parseFortnoxCompanyInformation({
    CompanyInformation: {
      DatabaseNumber: '987654',
      CompanyName: 'Testbolaget AB',
      OrganizationNumber: '556765-4321',
    },
  }), {
    tenantId: '987654',
    companyName: 'Testbolaget AB',
    organizationNumber: '556765-4321',
  })
})

test('company-information parser rejects schema drift and unsafe persisted values', () => {
  const valid = {
    CompanyInformation: {
      DatabaseNumber: 123456,
      CompanyName: 'Testbolaget AB',
      OrganizationNumber: '556123-4567',
    },
  }
  const invalid: unknown[] = [
    null,
    [],
    valid.CompanyInformation,
    { CompanyInformation: null },
    { CompanyInformation: { ...valid.CompanyInformation, DatabaseNumber: 0 } },
    { CompanyInformation: { ...valid.CompanyInformation, DatabaseNumber: -1 } },
    { CompanyInformation: { ...valid.CompanyInformation, DatabaseNumber: 1.5 } },
    { CompanyInformation: { ...valid.CompanyInformation, DatabaseNumber: '01' } },
    { CompanyInformation: { ...valid.CompanyInformation, DatabaseNumber: '123x' } },
    { CompanyInformation: { ...valid.CompanyInformation, DatabaseNumber: '1'.repeat(33) } },
    { CompanyInformation: { ...valid.CompanyInformation, CompanyName: ' ' } },
    { CompanyInformation: { ...valid.CompanyInformation, CompanyName: 'Unsafe\nName' } },
    { CompanyInformation: { ...valid.CompanyInformation, CompanyName: 'x'.repeat(256) } },
    { CompanyInformation: { ...valid.CompanyInformation, OrganizationNumber: 'invalid' } },
  ]
  for (const value of invalid) assert.equal(parseFortnoxCompanyInformation(value), null)
})

test('customer identity is deterministic, alphanumeric and bounded', () => {
  const identity = buildFortnoxCustomerIdentity(
    '550e8400-e29b-41d4-a716-446655440000',
    '1001'
  )

  assert.deepEqual(identity, {
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    fallbackCustomerNumber: 'HH1001X550E8400E29B',
  })
  assert.deepEqual(
    buildFortnoxCustomerIdentity('550E8400-E29B-41D4-A716-446655440000', 1001),
    identity
  )
  for (const value of Object.values(identity)) assert.match(value, /^[A-Z0-9]+$/u)
  assert.ok(identity.customerNumber.length <= FORTNOX_CUSTOMER_NUMBER_MAX_LENGTH)
  assert.ok(
    identity.externalReference.length <= FORTNOX_CUSTOMER_EXTERNAL_REFERENCE_MAX_LENGTH
  )

  for (const [customerId, localNumber] of [
    ['not-a-uuid', '1001'],
    ['550e8400-e29b-41d4-a716-446655440000', '1000'],
    ['550e8400-e29b-41d4-a716-446655440000', '01001'],
    ['550e8400-e29b-41d4-a716-446655440000', Number.MAX_SAFE_INTEGER + 1],
  ] as const) {
    assert.throws(() => buildFortnoxCustomerIdentity(customerId, localNumber), {
      message: 'FORTNOX_CUSTOMER_IDENTITY_INVALID',
    })
  }
})

test('business customer draft contains only the approved Fortnox fields', () => {
  const draft = buildFortnoxCustomerDraft({
    customerType: 'business',
    name: '  Testkund AB  ',
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '5561234567',
    email: ' kontakt@example.se ',
    invoiceEmail: ' faktura@example.se ',
    phone: ' 0700000000 ',
    address: ' Testgatan 1 ',
    addressLine2: ' c/o Test ',
    postalCode: ' 111 22 ',
    city: ' Stockholm ',
    countryCode: ' se ',
  })

  assert.deepEqual(draft, {
    Name: 'Testkund AB',
    CustomerNumber: 'HH1001',
    ExternalReference: 'HH550E8400E29B41D4A716446655440000',
    Type: 'COMPANY',
    Email: 'kontakt@example.se',
    EmailInvoice: 'faktura@example.se',
    Phone1: '0700000000',
    Address1: 'Testgatan 1',
    Address2: 'c/o Test',
    ZipCode: '111 22',
    City: 'Stockholm',
    CountryCode: 'SE',
    OrganisationNumber: '556123-4567',
  })
  assert.deepEqual(parseFortnoxCustomerDraft(draft), draft)
})

test('private customer draft cannot contain a personal or organization identity', () => {
  const draft = buildFortnoxCustomerDraft({
    customerType: 'private',
    name: 'Privatkund',
    customerNumber: 'HH1002',
    externalReference: 'HH550E8400E29B41D4A716446655440001',
    email: null,
    invoiceEmail: 'private@example.se',
    phone: null,
    address: 'Hemgatan 1',
    addressLine2: null,
    postalCode: '12345',
    city: 'Stockholm',
    countryCode: 'SE',
  })

  assert.deepEqual(draft, {
    Name: 'Privatkund',
    CustomerNumber: 'HH1002',
    ExternalReference: 'HH550E8400E29B41D4A716446655440001',
    Type: 'PRIVATE',
    EmailInvoice: 'private@example.se',
    Address1: 'Hemgatan 1',
    ZipCode: '12345',
    City: 'Stockholm',
    CountryCode: 'SE',
  })
  assert.equal('OrganisationNumber' in draft, false)

  assert.throws(
    () =>
      buildFortnoxCustomerDraft({
        customerType: 'private',
        name: 'Privatkund',
        customerNumber: 'HH1002',
        externalReference: 'HH550E8400E29B41D4A716446655440001',
        organizationNumber: '556123-4567',
        countryCode: 'SE',
      }),
    { message: 'FORTNOX_CUSTOMER_PAYLOAD_INVALID' }
  )

  assert.throws(
    () =>
      buildFortnoxCustomerDraft({
        customerType: 'private',
        name: 'Privatkund',
        customerNumber: 'HH1002',
        externalReference: 'HH550E8400E29B41D4A716446655440001',
        countryCode: 'SE',
        personalIdentityNumber: '19000101-0000',
      } as never),
    { message: 'FORTNOX_CUSTOMER_PAYLOAD_INVALID' }
  )
})

test('customer draft rejects invalid or oversized outbound fields without truncation', () => {
  const valid = {
    customerType: 'business' as const,
    name: 'Testkund AB',
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
    countryCode: 'SE',
  }
  const invalid = [
    { ...valid, name: ' ' },
    { ...valid, name: 'Unsafe\nName' },
    { ...valid, customerNumber: 'HH-1001' },
    { ...valid, customerNumber: 'hh1001' },
    { ...valid, externalReference: 'HH:customer' },
    { ...valid, organizationNumber: null },
    { ...valid, email: 'not-an-email' },
    { ...valid, invoiceEmail: 'not-an-email' },
    { ...valid, postalCode: '1'.repeat(11) },
    { ...valid, countryCode: 'SWE' },
  ]
  for (const value of invalid) {
    assert.throws(() => buildFortnoxCustomerDraft(value), {
      message: 'FORTNOX_CUSTOMER_PAYLOAD_INVALID',
    })
  }

  assert.equal(
    parseFortnoxCustomerDraft({ ...buildFortnoxCustomerDraft(valid), Secret: 'never-send' }),
    null
  )
})

test('customer response parser returns only bounded linking fields', () => {
  const response = {
    Customer: {
      CustomerNumber: ' HH1001 ',
      ExternalReference: ' HH550E8400E29B41D4A716446655440000 ',
      OrganisationNumber: '5561234567',
      Name: 'Provider detail not persisted here',
      Email: 'customer@example.se',
    },
  }
  assert.deepEqual(parseFortnoxCustomerResponse(response), {
    customerNumber: 'HH1001',
    externalReference: 'HH550E8400E29B41D4A716446655440000',
    organizationNumber: '556123-4567',
  })

  const invalid = [
    null,
    response.Customer,
    { Customer: null },
    { Customer: { ...response.Customer, CustomerNumber: 1001 } },
    {
      Customer: {
        ...response.Customer,
        CustomerNumber: 'x'.repeat(FORTNOX_CUSTOMER_NUMBER_MAX_LENGTH + 1),
      },
    },
    {
      Customer: {
        ...response.Customer,
        ExternalReference: 'x'.repeat(FORTNOX_CUSTOMER_EXTERNAL_REFERENCE_MAX_LENGTH + 1),
      },
    },
    { Customer: { ...response.Customer, OrganisationNumber: 'invalid' } },
  ]
  for (const value of invalid) assert.equal(parseFortnoxCustomerResponse(value), null)
})

test('customer list parser requires exact bounded pagination metadata', () => {
  const list = {
    Customers: [
      {
        CustomerNumber: 'HH1001',
        ExternalReference: 'HH550E8400E29B41D4A716446655440000',
        OrganisationNumber: '556123-4567',
      },
      {
        CustomerNumber: 'OTHER1',
        ExternalReference: null,
        OrganisationNumber: '',
      },
    ],
    MetaInformation: {
      '@CurrentPage': 1,
      '@TotalPages': 2,
      '@TotalResources': 3,
    },
  }
  assert.deepEqual(parseFortnoxCustomerListResponse(list), {
    customers: [
      {
        customerNumber: 'HH1001',
        externalReference: 'HH550E8400E29B41D4A716446655440000',
        organizationNumber: '556123-4567',
      },
      {
        customerNumber: 'OTHER1',
        externalReference: null,
        organizationNumber: null,
      },
    ],
    meta: { currentPage: 1, totalPages: 2, totalResources: 3 },
  })
  assert.deepEqual(
    parseFortnoxCustomerListResponse({
      Customers: [],
      MetaInformation: {
        '@CurrentPage': 1,
        '@TotalPages': 0,
        '@TotalResources': 0,
      },
    }),
    {
      customers: [],
      meta: { currentPage: 1, totalPages: 0, totalResources: 0 },
    }
  )

  for (const value of [
    { ...list, Customers: {} },
    { ...list, Customers: Array(FORTNOX_CUSTOMER_LIST_LIMIT + 1).fill(list.Customers[0]) },
    { ...list, MetaInformation: null },
    { ...list, MetaInformation: { ...list.MetaInformation, '@CurrentPage': 0 } },
    { ...list, MetaInformation: { ...list.MetaInformation, '@TotalPages': 0 } },
    { ...list, MetaInformation: { ...list.MetaInformation, '@TotalResources': 1 } },
    { ...list, Customers: [{ CustomerNumber: null }], MetaInformation: { ...list.MetaInformation, '@TotalResources': 1 } },
  ]) {
    assert.equal(parseFortnoxCustomerListResponse(value), null)
  }
})
