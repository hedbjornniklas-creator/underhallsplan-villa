import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

type ProfileCardParser = {
  parseOrganizationProfileCardValues: (value: unknown) => Record<string, string | null>
}

function loadParser() {
  const file = 'src/lib/organizations/profileCardTypes.ts'
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
      if (name === '@/lib/fortnox/domain') return fortnoxDomain
      throw new Error(`Unexpected profile-card parser dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as ProfileCardParser
}

const { parseOrganizationProfileCardValues } = loadParser()

function validCard(overrides: Record<string, unknown> = {}) {
  return {
    displayName: '  Anna Besiktningsman  ',
    title: '  Certifierad besiktningsman  ',
    phone: '  070-123 45 67  ',
    email: '  ANNA@EXAMPLE.TEST  ',
    companyName: '  Exempel Ingenjörer AB  ',
    companyOrgNo: '  5561234567  ',
    companyAddress: '  Testgatan 1  ',
    companyPostalCode: '  111 22  ',
    companyCity: '  Stockholm  ',
    avatarPath: '  profiles/person/organizations/org/avatar.png  ',
    logoPath: '  https://cdn.example.test/logo.webp  ',
    signaturePath: '',
    reportFooterText: '  Godkänd för TU.  ',
    ...overrides,
  }
}

test('organization profile parser returns only the allowlisted, normalized card fields', () => {
  assert.deepEqual(parseOrganizationProfileCardValues(validCard()), {
    displayName: 'Anna Besiktningsman',
    title: 'Certifierad besiktningsman',
    phone: '070-123 45 67',
    email: 'anna@example.test',
    companyName: 'Exempel Ingenjörer AB',
    companyOrgNo: '556123-4567',
    companyAddress: 'Testgatan 1',
    companyPostalCode: '111 22',
    companyCity: 'Stockholm',
    avatarPath: 'profiles/person/organizations/org/avatar.png',
    logoPath: 'https://cdn.example.test/logo.webp',
    signaturePath: null,
    reportFooterText: 'Godkänd för TU.',
  })
})

test('organization profile parser requires a plain object with exactly known fields', () => {
  for (const value of [
    null,
    [],
    'card',
    validCard({ orgId: 'attacker-selected-org' }),
    validCard({ profileId: 'another-profile' }),
    validCard({ updatedByProfileId: 'another-profile' }),
  ]) {
    assert.throws(() => parseOrganizationProfileCardValues(value), {
      message: 'ORG_PROFILE_CARD_INPUT_INVALID',
    })
  }
})

test('organization profile parser fails closed for missing required identity fields', () => {
  for (const overrides of [
    { displayName: '' },
    { displayName: '   ' },
    { displayName: null },
    { companyName: '' },
    { companyName: '   ' },
    { companyName: null },
  ]) {
    assert.throws(() => parseOrganizationProfileCardValues(validCard(overrides)), {
      message: 'ORG_PROFILE_CARD_REQUIRED_FIELDS',
    })
  }
})

test('organization profile parser validates email, organization number and field limits', () => {
  for (const email of ['anna', 'anna@example', 'anna example@test.se']) {
    assert.throws(() => parseOrganizationProfileCardValues(validCard({ email })), {
      message: 'ORG_PROFILE_CARD_EMAIL_INVALID',
    })
  }
  for (const companyOrgNo of ['556123-4568', 'SE556123456701', 5561234567]) {
    assert.throws(() => parseOrganizationProfileCardValues(validCard({ companyOrgNo })))
  }
  for (const overrides of [
    { displayName: 'x'.repeat(201) },
    { companyName: 'x'.repeat(241) },
    { title: 'x'.repeat(161) },
    { reportFooterText: 'x'.repeat(2_001) },
  ]) {
    assert.throws(() => parseOrganizationProfileCardValues(validCard(overrides)), {
      message: 'ORG_PROFILE_CARD_INPUT_INVALID',
    })
  }
})

test('organization profile parser rejects executable inline media schemes case-insensitively', () => {
  for (const field of ['avatarPath', 'logoPath', 'signaturePath']) {
    for (const value of [
      'data:image/svg+xml,<svg onload=alert(1)>',
      ' JAVASCRIPT:alert(1) ',
      'VbScRiPt:msgbox(1)',
    ]) {
      assert.throws(
        () => parseOrganizationProfileCardValues(validCard({ [field]: value })),
        { message: 'ORG_PROFILE_CARD_INPUT_INVALID' },
        `${field} accepted ${value}`
      )
    }
  }
})
