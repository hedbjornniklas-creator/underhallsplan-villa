import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compact = (value: string) => value.replace(/\s+/gu, ' ')

const pagePath = 'src/app/(dashboard)/tu/settings/profile/page.tsx'
const editorPath = 'src/components/tu/TuOrganizationProfileEditor.tsx'
const dashboardPath = 'src/components/tu/TuDashboardClient.tsx'
const switcherPath = 'src/components/organizations/ActiveOrganizationSwitcher.tsx'

const page = compact(read(pagePath))
const editor = compact(read(editorPath))
const dashboard = compact(read(dashboardPath))
const switcher = compact(read(switcherPath))

test('TU profile page resolves workspace exclusively from the authenticated TU organization context', () => {
  assert.match(page, /context = await requireTuContext\(requestedOrgId\)/u)
  assert.match(page, /orgId: context\.orgId/u)
  assert.match(page, /profileId: context\.userId/u)
  assert.match(page, /role: context\.role/u)
  assert.match(page, /key=\{context\.orgId\}/u)
  assert.match(page, /Aktiv arbetsorganisation: \{context\.orgName/u)
  assert.match(page, /`\/tu\?orgId=\$\{encodeURIComponent\(context\.orgId\)\}`/u)

  assert.doesNotMatch(page, /profileId:\s*resolvedSearchParams/u)
  assert.doesNotMatch(page, /profileId\?:\s*string/u)
})

test('TU dashboard and organization switcher preserve the selected organization on the profile route', () => {
  assert.match(
    dashboard,
    /href=\{organizationUrl\('\/tu\/settings\/profile', organizationId\)\}/u
  )
  assert.match(dashboard, /> Öppna företagsprofil <\/PendingLink>/u)
  assert.match(switcher, /pathname === '\/tu\/settings\/profile'/u)
  assert.match(switcher, /next\.set\('orgId', orgId\)/u)
  assert.match(switcher, /router\.push\(`\$\{targetPath\}\?\$\{next\.toString\(\)\}`\)/u)
})

test('profile editor scopes save and upload requests to the currently rendered workspace', () => {
  assert.match(
    editor,
    /new URLSearchParams\(\{ orgId: workspace\.organization\.id, field, \}\)/u
  )
  assert.match(editor, /fetch\(`\/api\/tu\/profile-card\/media\?\$\{params\.toString\(\)\}`/u)
  assert.match(editor, /fetch\('\/api\/tu\/profile-card'/u)
  assert.match(
    editor,
    /JSON\.stringify\(\{ orgId: workspace\.organization\.id, expectedVersion: workspace\.version, card: form, \}\)/u
  )
  assert.match(
    editor,
    /payload\.workspace\.organization\.id !== workspace\.organization\.id/u
  )
  assert.equal(editor.match(/credentials: 'same-origin'/gu)?.length, 2)
  assert.equal(editor.match(/cache: 'no-store'/gu)?.length, 2)

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
  assert.match(editor, /Organisationsspecifikt visitkort/u)
  assert.match(editor, /workspace\.role === 'admin' \? 'Organisationsadministratör' : 'Besiktningsman'/u)
  assert.match(editor, /Dessa uppgifter används bara när du arbetar och skickar TU-dokument för denna organisation/u)
})

test('migration-required mode prevents profile writes and media uploads in the UI', () => {
  assert.match(editor, /const canSave = !workspace\.migrationRequired/u)
  assert.match(editor, /if \(!file \|\| workspace\.migrationRequired\) return/u)
  assert.equal(
    editor.match(/disabled=\{workspace\.migrationRequired \|\| Boolean\(uploadingField\)\}/gu)?.length,
    3
  )
  assert.match(editor, /disabled=\{!canSave \|\| !dirty\}/u)
  assert.match(editor, /SQL 07 behöver köras/u)
})
