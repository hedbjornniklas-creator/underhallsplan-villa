import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Server from '../src/lib/dashboard/server'
import type { DashboardConfirmationBookingSource } from '../src/lib/dashboard/model'
import type { ObOverviewItem } from '../src/lib/ob/overview'
import type { EbProjectListItem } from '../src/lib/eb/server'
import type { EbAssignmentConfirmationSummary } from '../src/lib/eb/assignmentConfirmationTypes'
import type { DashboardActionCaseSource } from '../src/lib/dashboard/actionCases'
// @ts-expect-error Node strip-types requires explicit TypeScript extension.
import * as model from '../src/lib/dashboard/model.ts'

const caseModule = { exports: {} }
new Function('require', 'module', 'exports', ts.transpileModule(
  readFileSync(new URL('../src/lib/dashboard/actionCases.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText)((name: string) => {
  if (name !== './model') throw new Error(`Unexpected case dependency ${name}`)
  return model
}, caseModule, caseModule.exports)

const orgId = '11111111-1111-4111-8111-111111111111', otherOrgId = '22222222-2222-4222-8222-222222222222'
const context = { orgId, userId: 'me', role: 'admin', orgName: 'Test' }
function harness({ allowed = ['inspections', 'construction_inspections', 'technical_investigations', 'moisture_safety', 'tasks'],
  accessOrgId = orgId, orgError = null as Error | null, failed = '', overviewItems = [] as ObOverviewItem[],
  assignmentRows = [] as Array<DashboardConfirmationBookingSource & { id: string; org_id: string }>,
  inspectionRows = [] as Array<{ id: string; date: string | null; inspection_time: string | null }>,
  ebProjects = [] as EbProjectListItem[], ebConfirmations = [] as EbAssignmentConfirmationSummary[],
  actionCaseRows = [] as DashboardActionCaseSource[] } = {}) {
  const checks: Array<Record<string, unknown>> = [], reads: Array<{ module: string; orgId: string }> = [], selections: unknown[] = []
  const bookingReads: Array<{ table: string; columns: string; orgId: unknown; ids: string[] }> = []
  const read = (module: string, selected: string, result: unknown) => {
    reads.push({ module, orgId: selected })
    if (failed === module) throw new Error('DATABASE_FAILED')
    return result
  }
  const deps: Record<string, unknown> = {
    'server-only': {}, './model': model, './actionCases': caseModule.exports,
    '@/lib/access/server': { hasCurrentUserAccess: async (check: Record<string, unknown>) => {
      checks.push(check)
      return check.scopeType === 'organization' && check.scopeId === accessOrgId && (!check.moduleKey || allowed.includes(String(check.moduleKey)))
    } },
    '@/lib/assignments/server': { requireOrgContext: async (selected?: unknown) => {
      selections.push(selected)
      if (orgError) throw orgError
      return { ...context, orgId: selected || orgId }
    } },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ from: (table: string) => {
      assert.ok(['assignments', 'inspections', 'action_cases'].includes(table), `Unexpected table ${table}`)
      let columns = '', selectedOrg: unknown
      const query = {
        select: (selected: string) => { columns = selected; return query },
        eq: (column: string, value: unknown) => { assert.equal(column, 'org_id'); selectedOrg = value; return query },
        order: (column: string, options: { ascending: boolean }) => {
          assert.equal(column, 'id'); assert.equal(options.ascending, true); return query
        },
        range: async (from: number, to: number) => {
          assert.equal(table, 'action_cases')
          bookingReads.push({ table, columns, orgId: selectedOrg, ids: [] })
          return { data: actionCaseRows.filter(row => row.org_id === selectedOrg).slice(from, to + 1), error: null }
        },
        in: async (column: string, ids: string[]) => {
          assert.equal(column, 'id')
          bookingReads.push({ table, columns, orgId: selectedOrg, ids })
          return { data: table === 'assignments'
            ? assignmentRows.filter(row => ids.includes(row.id) && row.org_id === selectedOrg)
            : inspectionRows.filter(row => ids.includes(row.id)), error: null }
        },
      }
      return query
    } }) },
    '@/lib/ob/overviewLoader': { loadObOverview: async ({ orgId: selected, options }: { orgId: string; options: { page: number } }) => read('ob', selected,
      { items: overviewItems, total: overviewItems.length, page: options.page, pageSize: 50,
        counts: { active: overviewItems.length, closed: 0, all: overviewItems.length } }) },
    '@/lib/tu/server': {
      requireTuContext: async (selected: string) => { selections.push(selected); return { ...context, orgId: selected } },
      listTuAssignments: async (selected: string) => read('tu', selected, []), listTuInvestigations: async (selected: string) => read('tu', selected, []),
    },
    '@/lib/eb/server': { listEbProjects: async (selected: string) => read('eb', selected, ebProjects) },
    '@/lib/eb/assignmentConfirmationServer': { listEbAssignmentConfirmationSummaries: async ({ orgId: selected }: { orgId: string }) => read('eb-confirmations', selected, ebConfirmations) },
    '@/lib/moisture/server': {
      requireMoistureContext: async (selected: string) => { selections.push(selected); return { ...context, orgId: selected } },
      listMoistureProjects: async ({ orgId: selected }: { orgId: string }) => read('moisture', selected, []),
    },
    '@/lib/tasks/server': { getTaskWorkspace: async ({ orgId: selected }: { orgId: string }) => read('tasks', selected, { currentUser: { id: 'me' }, tasks: [] }) },
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/lib/dashboard/server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in deps)) throw new Error(`Unexpected dependency ${name}`)
    return deps[name]
  }, compiled, compiled.exports)
  return { server: compiled.exports as typeof Server, checks, reads, selections, bookingReads }
}

test('dashboard validates membership before readers and never reads a denied module', async () => {
  const h = harness({ allowed: ['technical_investigations'] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.organizationId, orgId)
  assert.deepEqual(result.modules.filter(module => module.active).map(module => module.id), ['tu'])
  assert.ok(h.reads.every(read => read.module === 'tu' && read.orgId === orgId))
  assert.ok(h.checks.every(check => check.scopeType === 'global' || check.scopeId === orgId))
  assert.ok(h.selections.every(selected => selected === orgId || selected === undefined), 'module contexts cannot silently choose another organization')
  assert.equal(result.bookings.length, 0)
  assert.equal(result.actions.length, 0)
  assert.equal(h.bookingReads.length, 0, 'denied OB/EB modules must not read confirmation metadata')
})

test('an access grant in another organization never authorizes dashboard reads in the selected one', async () => {
  const h = harness({ accessOrgId: otherOrgId })
  await assert.rejects(h.server.getDashboardData(orgId), /MODULE_ACCESS_REQUIRED/)
  assert.equal(h.reads.length, 0)
})

test('a different active organization cannot be aggregated when downstream modules use the default one', async () => {
  const h = harness({ accessOrgId: otherOrgId })
  await assert.rejects(h.server.getDashboardData(otherOrgId), /DASHBOARD_ORGANIZATION_UNSUPPORTED/)
  assert.deepEqual(h.selections, [otherOrgId, undefined], 'validate selected membership before comparing the default organization')
  assert.equal(h.reads.length, 0)
  assert.equal(h.checks.length, 0)
})

test('explicit default organization remains valid for map requests', async () => {
  const h = harness()
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.organizationId, orgId)
  assert.equal(result.issues?.length, 0)
  assert.ok(h.reads.length > 0)
})

test('auth, invalid selection and membership failures remain errors instead of empty dashboards', async () => {
  for (const code of ['UNAUTHORIZED', 'ORG_SELECTION_INVALID', 'ORG_MEMBERSHIP_REQUIRED']) {
    const h = harness({ orgError: new Error(code) })
    await assert.rejects(h.server.getDashboardData(orgId), new RegExp(code))
    assert.equal(h.reads.length, 0)
    assert.equal(h.checks.length, 0)
  }
})

test('one failed authorized reader reports its module while other data still loads', async () => {
  const h = harness({ failed: 'eb' })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.issues?.length, 1)
  assert.equal(result.issues?.[0].moduleId, 'eb')
  assert.equal(result.modules.find(module => module.id === 'eb')?.active, true)
  assert.ok(h.reads.some(read => read.module === 'tasks'))
  assert.ok(h.reads.some(read => read.module === 'moisture'))
  assert.ok(h.reads.every(read => read.orgId === orgId))
})

const scheduledConfirmation = (id: string, overrides: Partial<DashboardConfirmationBookingSource> = {}) => ({
  id, org_id: orgId, status: 'sent', preferred_date: '2026-10-14', preferred_time: '14:00', accepted_at: null,
  booked_at: null, last_sent_at: '2026-10-12T10:00:00Z', archived_at: null, ...overrides,
})

test('OB supplemental reads follow the current reissue ID inside the selected organization and keep one event', async () => {
  const row: ObOverviewItem = { id: 'inspection:i', date: '2026-10-12', createdAt: '2026-10-01', address: 'Testgatan 1', city: 'Stockholm',
    customer: 'Kund', assignmentNumber: '', confirmation: 'Inväntar kund', inspection: 'Pågår', confirmationHref: '/ob/assignments/current',
    inspectionHref: '/properties/p/ob/i', confirmationAction: 'Öppna bekräftelse', attention: [], closed: false, archived: false, marker: 'active' }
  const h = harness({ allowed: ['inspections'], overviewItems: [row], inspectionRows: [{ id: 'i', date: '2026-10-12', inspection_time: '09:00' }],
    assignmentRows: [scheduledConfirmation('old', { preferred_date: '2026-10-11' }), scheduledConfirmation('current'),
      { ...scheduledConfirmation('foreign'), org_id: otherOrgId }] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.issues?.length, 0)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].startsAt, '2026-10-14T14:00:00+02:00')
  assert.equal(result.bookings[0].href, '/ob/assignments/current')
  const assignmentRead = h.bookingReads.find(read => read.table === 'assignments')!
  assert.equal(assignmentRead.orgId, orgId)
  assert.deepEqual(assignmentRead.ids, ['current'], 'superseded/foreign/unlisted confirmations are never requested')
  assert.ok(assignmentRead.columns.includes('preferred_date'))
  assert.ok(assignmentRead.columns.includes('last_sent_at'))
  assert.deepEqual(h.bookingReads.find(read => read.table === 'inspections')?.ids, ['i'])
})

test('OB read-only colleague rows are excluded before supplemental assignment and inspection reads', async () => {
  const shared = { id: 'inspection:colleague', date: '2026-10-12', createdAt: '2026-10-01', address: 'Testgatan 1', city: 'Stockholm',
    customer: 'Kund', assignmentNumber: '', confirmation: 'Inväntar kund', inspection: 'Pågår', confirmationHref: '/ob/assignments/colleague',
    inspectionHref: '/properties/p/ob/colleague', confirmationAction: 'Öppna bekräftelse', attention: [], closed: false, archived: false,
    marker: 'active' as const, canEdit: false }
  const h = harness({ allowed: ['inspections'], overviewItems: [shared], assignmentRows: [scheduledConfirmation('colleague')],
    inspectionRows: [{ id: 'colleague', date: '2026-10-12', inspection_time: '09:00' }] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.modules.find(item => item.id === 'ob')?.activeCount, 0)
  assert.equal(result.bookings.length, 0)
  assert.equal(result.actions.length, 0)
  assert.equal(h.bookingReads.length, 0)
})

test('EB supplemental schedule reads use only current confirmation IDs and remain tentative if RLS hides the source', async () => {
  const project = { id: 'p', orgId, title: 'Takrenovering', status: 'active', address: 'Takvägen 2',
    inspections: [{ inspectionId: 'i', status: 'draft', reportLockedAt: null, date: '2026-10-12', inspectionTime: '08:00', variantLabel: 'Slutbesiktning' }] } as EbProjectListItem
  const summary = { assignmentId: 'current', inspectionId: 'i', status: 'sent', acceptedAt: null, lastSentAt: '2026-10-12' } as EbAssignmentConfirmationSummary
  const config = { allowed: ['construction_inspections'], ebProjects: [project], ebConfirmations: [summary] }
  const h = harness({ ...config, assignmentRows: [scheduledConfirmation('current'), scheduledConfirmation('old')] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.bookings.length, 1)
  assert.equal(result.bookings[0].status, 'tentative')
  assert.equal(result.bookings[0].startsAt, '2026-10-14T14:00:00+02:00')
  assert.deepEqual(h.bookingReads.map(read => ({ table: read.table, orgId: read.orgId, ids: read.ids })), [
    { table: 'assignments', orgId, ids: ['current'] },
  ])
  const hidden = harness(config)
  const hiddenResult = await hidden.server.getDashboardData(orgId)
  assert.equal(hiddenResult.issues?.length, 0)
  assert.equal(hiddenResult.bookings[0].status, 'tentative', 'current sent evidence must not be upgraded to confirmed when supplementary metadata is hidden')
  assert.equal(hiddenResult.bookings[0].startsAt, '2026-10-12', 'never borrow an old actual time for an unreadable proposal')
})

test('Uppdrag reads scheduled site visits through the signed-in org scope and includes them as tentative', async () => {
  const planned: DashboardActionCaseSource = { id: 'case', org_id: orgId, title: 'Planerat platsbesök', status: 'preparing',
    site_visit_at: '2026-10-15T11:30:00Z', property_address: 'Testgatan 4, Stockholm' }
  const h = harness({ allowed: ['tasks'], actionCaseRows: [planned, { ...planned, id: 'foreign', org_id: otherOrgId },
    { ...planned, id: 'cancelled', status: 'cancelled' }] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.issues?.length, 0)
  assert.equal(result.modules.find(module => module.id === 'tasks')?.activeCount, 1)
  assert.deepEqual(result.bookings.map(booking => ({ id: booking.id, startsAt: booking.startsAt, status: booking.status, href: booking.href })), [
    { id: 'tasks:case:case', startsAt: planned.site_visit_at, status: 'tentative', href: '/uppdrag/case' },
  ])
  assert.deepEqual(h.bookingReads, [{ table: 'action_cases', columns: 'id,org_id,title,status,site_visit_at,property_address', orgId, ids: [] }])
  const denied = harness({ allowed: [], actionCaseRows: [planned] })
  assert.equal((await denied.server.getDashboardData(orgId)).bookings.length, 0)
  assert.equal(denied.bookingReads.length, 0, 'denied modules must never read case visits')
})

test('Uppdrag site visits are not truncated by the database default row limit', async () => {
  const rows = Array.from({ length: 1001 }, (_, index): DashboardActionCaseSource => ({ id: `case-${index}`, org_id: orgId,
    title: `Platsbesök ${index}`, status: 'preparing', site_visit_at: '2026-10-15T11:30:00Z', property_address: null }))
  const h = harness({ allowed: ['tasks'], actionCaseRows: rows })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.bookings.length, 1001)
  assert.equal(h.bookingReads.filter(read => read.table === 'action_cases').length, 3)
})

test('OB and EB draft metadata reach tentative calendar bookings without reading superseded confirmations', async () => {
  const obRow: ObOverviewItem = { id: 'assignment:ob-draft', date: '2026-10-15', createdAt: '2026-10-01', address: 'Testgatan 1', city: 'Stockholm',
    customer: 'Kund', assignmentNumber: '', confirmation: 'Utkast', inspection: 'Ej startad', confirmationHref: '/ob/assignments/ob-draft',
    inspectionHref: null, confirmationAction: 'Öppna bekräftelse', attention: [], closed: false, archived: false, marker: 'active' }
  const ebProject = { id: 'p', orgId, title: 'Takrenovering', status: 'active', address: 'Takvägen 2',
    inspections: [{ inspectionId: 'i', status: 'draft', reportLockedAt: null, date: '2026-10-15', inspectionTime: '09:00', variantLabel: 'Slutbesiktning' }] } as EbProjectListItem
  const summary = { assignmentId: 'eb-draft', inspectionId: 'i', versionNo: 1, status: 'draft', acceptedAt: null, lastSentAt: null } as EbAssignmentConfirmationSummary
  const h = harness({ allowed: ['inspections', 'construction_inspections'], overviewItems: [obRow], ebProjects: [ebProject], ebConfirmations: [summary],
    assignmentRows: [scheduledConfirmation('ob-draft', { status: 'draft', preferred_date: '2026-10-15', preferred_time: '12:30', last_sent_at: null }),
      scheduledConfirmation('eb-draft', { status: 'draft', preferred_date: '2026-10-15', preferred_time: '13:30', last_sent_at: null }),
      scheduledConfirmation('superseded', { status: 'draft' })] })
  const result = await h.server.getDashboardData(orgId)
  assert.equal(result.issues?.length, 0)
  assert.deepEqual(result.bookings.map(booking => [booking.moduleId, booking.startsAt, booking.status, booking.confirmationStatus]), [
    ['ob', '2026-10-15T12:30:00+02:00', 'tentative', 'Bekräftelse ej skickad'],
    ['eb', '2026-10-15T13:30:00+02:00', 'tentative', 'Bekräftelse ej skickad'],
  ])
  assert.deepEqual(h.bookingReads.flatMap(read => read.ids).sort(), ['eb-draft', 'ob-draft'])
})
