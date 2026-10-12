import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { organizationSwitchDestination } from '../src/lib/organizations/navigation.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compact = (value: string) => value.replace(/\s+/gu, ' ')

const pagePath = 'src/app/(app)/settings/profil/page.tsx'
const editorPath = 'src/components/tu/TuOrganizationProfileEditor.tsx'
const dashboardPath = 'src/components/tu/TuDashboardClient.tsx'
const switcherPath = 'src/components/organizations/ActiveOrganizationSwitcher.tsx'

const page = compact(read(pagePath))
const editor = compact(read(editorPath))
const dashboard = compact(read(dashboardPath))
const switcher = compact(read(switcherPath))
const autosave = compact(read('src/lib/organizations/profileCardAutosave.ts'))

test('TU profile page resolves workspace exclusively from the authenticated organization membership', () => {
  assert.match(page, /context = await getOrganizationWorkspace\(params\.orgId\)/u)
  assert.match(page, /orgId: context\.organization\.id/u)
  assert.match(page, /profileId: context\.profileId/u)
  assert.match(page, /role: context\.role/u)
  assert.match(page, /key=\{context\.organization\.id\}/u)
  assert.match(page, /Min profil i \{context\.organization\.name/u)

  assert.doesNotMatch(page, /profileId:\s*resolvedSearchParams/u)
  assert.doesNotMatch(page, /profileId\?:\s*string/u)
})

test('personal profile omits the legacy profile link but keeps organization settings recovery', () => {
  assert.doesNotMatch(page, /Tidigare profilvy för ÖB\/EB/u)
  assert.doesNotMatch(page, /href="\/ob\/settings"/u)
  assert.match(page, /href="\/settings\/organisation">Till organisationsinställningar<\/Link>/u)
})

test('personal profile mounts certifications and addons for the authenticated member and selected organization', () => {
  assert.match(page, /import OrganizationProfileExtras from '@\/components\/organizations\/OrganizationProfileExtras'/u)
  assert.match(page, /<OrganizationProfileExtras orgId=\{context\.organization\.id\} profileId=\{context\.profileId\} \/>/u)
  assert.equal(page.match(/<OrganizationProfileExtras /gu)?.length, 1)
})

test('TU dashboard and organization switcher preserve the selected organization on the profile route', () => {
  assert.match(
    dashboard,
    /href=\{organizationUrl\('\/settings\/profil', organizationId\)\}/u
  )
  assert.match(dashboard, />Visitkort<\/PendingLink>/u)
  assert.match(switcher, /router\.push\(organizationSwitchDestination\(\{ pathname, search, surface, orgId \}\)\)/u)
  assert.equal(organizationSwitchDestination({
    pathname: '/settings/profil', search: 'orgId=old', surface: 'settings', orgId: 'new',
  }), '/settings/profil?orgId=new')
})

test('profile editor scopes save and upload requests to the currently rendered workspace', () => {
  assert.match(
    editor,
    /new URLSearchParams\(\{ orgId: workspace\.organization\.id, field, \}\)/u
  )
  assert.match(editor, /fetch\(`\/api\/organizations\/member-profile\/media\?\$\{params\.toString\(\)\}`/u)
  assert.match(editor, /fetch\('\/api\/organizations\/member-profile'/u)
  assert.match(editor, /action: 'import_legacy_media'/u)
  assert.match(
    editor,
    /JSON\.stringify\(\{ orgId: workspace\.organization\.id, expectedVersion: workspace\.version, card: personalProfileValues\(submitted\), \}\)/u
  )
  assert.match(editor, /checkedProfileWorkspace\(payload\.workspace, workspace\)/u)
  assert.match(autosave, /value\.organization\.id !== previous\.organization\.id \|\| value\.profileId !== previous\.profileId/u)
  assert.equal(editor.match(/credentials: 'same-origin'/gu)?.length, 3)
  assert.equal(editor.match(/cache: 'no-store'/gu)?.length, 3)

  assert.doesNotMatch(editor, /profileId\s*:/u)
  assert.doesNotMatch(editor, /actorProfileId\s*:/u)
  assert.doesNotMatch(editor, /createSupabase/u)
})

test('profile editor isolates organization-bound state without resetting same-organization drafts', () => {
  assert.match(editor, /key=\{`\$\{initialWorkspace\.organization\.id\}:\$\{initialWorkspace\.profileId\}`\}/u)
  assert.match(editor, /useState\(initialWorkspace\.card\)/u)
  assert.doesNotMatch(editor, /setForm\(initialWorkspace\.card\)/u)
  assert.match(editor, /generation !== lifetime\.current/u)
  assert.match(editor, /const organizationName = workspace\.organization\.name/u)
  assert.match(editor, /Min profil/u)
  assert.match(editor, /workspace\.role === 'admin' \? 'Organisationsadministratör' : 'Besiktningsman'/u)
  assert.match(editor, /Företagsuppgifterna och logotypen är gemensamma för alla medlemmar/u)
})

test('migration-required mode prevents profile writes and media uploads in the UI', () => {
  assert.match(editor, /const canSave = !workspace\.migrationRequired/u)
  assert.match(editor, /if \(!file \|\| workspace\.migrationRequired \|\| saveConflict \|\| retryImport \|\| operation\.current\) return/u)
  assert.equal(
    editor.match(/disabled=\{workspace\.migrationRequired \|\| saving \|\| saveConflict \|\| retryImport \|\| Boolean\(uploadingField\) \|\| importingLegacyMedia\}/gu)?.length,
    2
  )
  assert.match(editor, /workspace\.configured && !workspace\.migrationRequired/u)
  assert.match(editor, /disabled=\{retryImport \? !canImportLegacyMedia : !canSave \|\| \(!dirty && !saveError && workspace\.version !== null\)\}/u)
  assert.match(editor, /Organisationsinställningarna är ännu inte aktiverade/u)
})
