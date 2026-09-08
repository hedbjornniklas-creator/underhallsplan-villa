import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Defaults from '../src/lib/eb/remediationDefaults'

const output = ts.transpileModule(readFileSync(new URL('../src/lib/eb/remediationDefaults.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiled = { exports: {} }
new Function('exports', 'module', output)(compiled.exports, compiled)
const { ebRemediationAssignmentDueDate: dueDate, ebRemediationReportDeadline: deadline,
  ebRemediationContractorSuggestions: suggestions } = compiled.exports as typeof Defaults

const reportProject = { contractorName: 'Bygg AB', contractorOrgNo: '556000-0001', contractorEmail: null, contractorPhone: null }
const project = { contractorName: '  BYGG   AB ', contractorOrgNo: '5560000001',
  contractorEmail: 'Office@bygg.example', contractorPhone: '010-123456' }
const base = { state: 'open', role: 'customer_owner', paid: true, reportProject, project }

test('an omitted assignment date preserves it while explicit null/empty clears it', () => {
  assert.equal(dueDate({ assigneeId: 'new' }), undefined)
  assert.equal(dueDate({ dueDate: undefined }), undefined)
  assert.equal(dueDate({ dueDate: null }), null)
  assert.equal(dueDate({ dueDate: '' }), null)
  assert.equal(dueDate({ dueDate: '2026-09-30' }), '2026-09-30')
  for (const value of ['2026-02-31', 'tomorrow', true, 0, {}]) {
    assert.throws(() => dueDate({ dueDate: value }), /DATE_INVALID/)
  }
})

test('only calendar-valid frozen report dates can become an inherited deadline', () => {
  assert.equal(deadline('2028-02-29'), '2028-02-29')
  for (const value of ['2026-02-29', '2026-09-31', '2026-09-03T00:00:00Z', '', null]) {
    assert.equal(deadline(value), null)
  }
})

test('same frozen company can use its live company contact without changing the frozen identity', () => {
  assert.deepEqual(suggestions(base), [{ name: 'Bygg AB', companyName: 'Bygg AB', contactName: null,
    email: 'office@bygg.example', phone: '010-123456', source: 'project' }])
  assert.equal(reportProject.contractorEmail, null)
})

test('a different or ambiguous company cannot lend contact details to the frozen contractor', () => {
  for (const live of [{ ...project, contractorName: 'Bygg AB 2' },
    { ...project, contractorOrgNo: '556000-9999' }]) {
    const values = suggestions({ ...base, project: live })
    assert.equal(values.length, 1)
    assert.equal(values[0].email, null)
    assert.equal(values[0].phone, null)
    assert.equal(values[0].source, 'report')
  }
  assert.deepEqual(suggestions({ ...base, reportProject: { contractorName: null } }), [])
})

test('frozen contact details have precedence over later edited project details', () => {
  const [value] = suggestions({ ...base, reportProject: { ...reportProject,
    contractorEmail: 'signed@bygg.example', contractorPhone: '010-999' } })
  assert.equal(value.email, 'signed@bygg.example')
  assert.equal(value.phone, '010-999')
  assert.equal(value.source, 'report')
})

test('contractor participants remain distinct choices and never absorb a different person or company contact', () => {
  const participants = [
    { representsPartyKey: 'contractor', companyName: 'Bygg AB', personName: 'Anna', email: 'anna@bygg.example' },
    { representsPartyKey: 'contractor', companyName: 'Bygg AB', personName: 'Bertil', email: null },
    { representsPartyKey: 'contractor', companyName: 'El AB', personName: 'Erik', email: 'erik@el.example' },
    { representsPartyKey: 'client', roleLabel: 'Entreprenör', companyName: 'Bygg AB', personName: 'Beställare', email: 'private@buyer.example' },
    { roleLabel: 'Besiktningsman', personName: 'Inspektör', email: 'inspector@example.test' },
  ]
  const values = suggestions({ ...base, participants })
  assert.equal(values.length, 4)
  assert.equal(values.find(value => value.contactName === 'Bertil')?.email, null)
  assert.equal(values.find(value => value.contactName === 'Bertil')?.phone, null)
  assert.equal(values.find(value => value.contactName === 'Anna')?.email, 'anna@bygg.example')
  assert.equal(values.find(value => value.contactName === 'Erik')?.companyName, 'El AB')
  assert.doesNotMatch(JSON.stringify(values), /private@buyer|inspector@example/)
})

test('a default participant repeating the company is deduplicated, not mistaken for a second contractor', () => {
  assert.equal(suggestions({ ...base, participants: [
    { representsPartyKey: 'contractor', companyName: 'BYGG AB', personName: 'Bygg AB' },
  ] }).length, 1)
  const values = suggestions({ ...base, project: null, participants: [
    { representsPartyKey: 'contractor', companyName: 'Bygg AB', personName: 'Anna', email: 'anna@bygg.example' },
  ] })
  assert.equal(values.length, 1)
  assert.equal(values[0].contactName, 'Anna')
})

test('non-buyers, expired/revoked links and unpaid/internal access receive no suggestions', () => {
  for (const role of ['assignee', 'contractor_admin', 'contractor_viewer', 'internal', 'public']) {
    assert.deepEqual(suggestions({ ...base, role }), [])
  }
  for (const state of ['expired', 'revoked']) assert.deepEqual(suggestions({ ...base, state }), [])
  assert.deepEqual(suggestions({ ...base, paid: false }), [])
  assert.deepEqual(suggestions({ ...base, reportProject: null }), [])
})
