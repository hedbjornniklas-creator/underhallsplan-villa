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

test('TU profile page resolves workspace exclusively from the authenticated organization membership', () => {
  assert.match(page, /context = await getOrganizationWorkspace\(params\.orgId\)/u)
  assert.match(page, /orgId: context\.organization\.id/u)
  assert.match(page, /profileId: context\.profileId/u)
  assert.match(page, /role: context\.role/u)
  assert.match(page, /key=\{context\.organization\.id\}/u)
  assert.match(page, /Min profil i \{context\.organization\.name/u)
  assert.match(page, /Tidigare profilvy för ÖB\/EB/u)

  assert.doesNotMatch(page, /profileId:\s*resolvedSearchParams/u)
  assert.doesNotMatch(page, /profileId\?:\s*string/u)
})

test('TU dashboard and organization switcher preserve the selected organization on the profile route', () => {
  assert.match(
    dashboard,
    /href=\{organizationUrl\('\/settings\/profil', organizationId\)\}/u
  )
  assert.match(dashboard, /> Öppna min profil <\/PendingLink>/u)
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
    /JSON\.stringify\(\{ orgId: workspace\.organization\.id, expectedVersion: workspace\.version, card: \{ displayName: form\.displayName, title: form\.title, phone: form\.phone, email: form\.email, avatarPath: form\.avatarPath, signaturePath: form\.signaturePath, \}, \}\)/u
  )
  assert.match(
    editor,
    /payload\.workspace\.organization\.id !== workspace\.organization\.id/u
  )
  assert.equal(editor.match(/credentials: 'same-origin'/gu)?.length, 3)
  assert.equal(editor.match(/cache: 'no-store'/gu)?.length, 3)

  assert.doesNotMatch(editor, /profileId\s*:/u)
  assert.doesNotMatch(editor, /actorProfileId\s*:/u)
  assert.doesNotMatch(editor, /createSupabase/u)
})

test('profile editor resets organization-bound state and makes organization and role explicit', () => {
  assert.match(editor, /setWorkspace\(initialWorkspace\)/u)
  assert.match(editor, /setForm\(initialWorkspace\.card\)/u)
  assert.match(editor, /setSavedSnapshot\(serialize\(initialWorkspace\.card\)\)/u)
  assert.match(editor, /\}, \[initialWorkspace\]\)/u)
  assert.match(editor, /const organizationName = workspace\.organization\.name/u)
  assert.match(editor, /Min profil/u)
  assert.match(editor, /workspace\.role === 'admin' \? 'Organisationsadministratör' : 'Besiktningsman'/u)
  assert.match(editor, /Företagsuppgifterna och logotypen är gemensamma för alla medlemmar/u)
})

test('migration-required mode prevents profile writes and media uploads in the UI', () => {
  assert.match(editor, /const canSave = !workspace\.migrationRequired/u)
  assert.match(editor, /if \(!file \|\| workspace\.migrationRequired \|\| importingLegacyMedia\) return/u)
  assert.equal(
    editor.match(/disabled=\{workspace\.migrationRequired \|\| Boolean\(uploadingField\) \|\| importingLegacyMedia\}/gu)?.length,
    2
  )
  assert.match(editor, /workspace\.configured && !workspace\.migrationRequired/u)
  assert.match(editor, /disabled=\{!canSave \|\| \(!dirty && workspace\.version !== null\)\}/u)
  assert.match(editor, /Organisationsinställningarna är ännu inte aktiverade/u)
})
