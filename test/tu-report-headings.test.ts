import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node strip-types requires explicit extensions.
import { loadTuModule } from './helpers/load-tu-module.ts'
import type * as Snapshot from '../src/lib/tu/reportSnapshot'
import type * as Templates from '../src/lib/tu/reportTemplates'
import type * as Server from '../src/lib/tu/server'

const { resolveTuReportSectionTitle } = loadTuModule<typeof Templates>('src/lib/tu/reportTemplates.ts')
const { buildTuPrintPayload, createTuReportSnapshotPayloadV1 } = loadTuModule<typeof Snapshot>('src/lib/tu/reportSnapshot.ts')
const { normalizeTuReportDraft } = loadTuModule<typeof Server>('src/lib/tu/server.ts', {
  '@/lib/supabase/admin': {}, '@/lib/supabase/server': {},
  '@/lib/access/server': {}, '@/lib/assignments/server': {}, '@/lib/organizations/profileCard': {},
  '@/lib/tu/billingServer': {}, '@/lib/tu/assignmentProgressServer': {}, '@/lib/tu/assignmentWorkflowServer': {},
  '@/lib/certifications/profileResolver': {},
})

const section = {
  id: 'recommended_actions', key: 'rekommenderade_kompletterande_kontroller',
  title: 'Rekommenderad fortsatt hantering', text: 'Min egen text.\nEn rad till.\n\nEtt eget stycke.',
  templateSectionKey: 'recommended_actions', isRequired: true, allowDelete: false,
  subsections: [{ id: 'sub-1', title: 'Min underrubrik', text: 'Oförändrad underrubrikstext.\n\nNästa stycke.' }],
}

test('normalization preserves an edited heading, body, subsections and section identity', () => {
  const normalized = normalizeTuReportDraft({ sections: [section] })
  const saved = normalized.sections.find(item => item.id === section.id)!
  for (const key of Object.keys(section) as Array<keyof typeof section>) {
    assert.deepEqual(saved[key], section[key], key)
  }
})

for (const template of ['technical_status_statement', 'post_damage_remediation_review']) {
  test(`${template}: preview and frozen snapshot use the saved heading, not the type or template label`, () => {
    const saved = { ...section, key: 'recommended_actions' }
    const investigation = {
      inspectionId: 'test', reportTemplateKey: template, title: 'Testutlåtande',
      reportDraft: { sections: [saved] }, objectType: 'villa', inspection: {}, property: {},
      inspector: null, assignment: null,
    } as unknown as Server.TuInvestigationDetails
    const before = JSON.stringify(investigation)
    const input = { investigation, coverImages: [], appendixImages: [] }
    const printed = buildTuPrintPayload(input)
    assert.equal(printed.sections[0].title, saved.title)
    assert.equal(printed.sections[0].text, saved.text)
    assert.deepEqual(printed.sections[0].subsections, saved.subsections)
    const frozen = createTuReportSnapshotPayloadV1(input)
    assert.deepEqual(frozen.report.sections, printed.sections)
    assert.equal(JSON.stringify(investigation), before)
    assert.equal(resolveTuReportSectionTitle(template, saved), saved.title)
    assert.equal(resolveTuReportSectionTitle(template, { ...saved, title: 'Min helt egna rubrik' }), 'Min helt egna rubrik')
  })
}

test('only missing headings fall back to template policy', () => {
  assert.equal(resolveTuReportSectionTitle('post_damage_remediation_review', { key: 'recommended_actions', title: '' }), 'Rekommenderad fortsatt hantering')
  assert.equal(resolveTuReportSectionTitle(null, { key: 'custom' }), 'Rapportdel')
})

test('editor, server preview and snapshot share heading resolution', () => {
  for (const file of [
    'src/components/tu/TuInvestigationEditorClient.tsx',
    'src/app/(dashboard)/tu/investigations/[inspectionId]/print/page.tsx',
    'src/lib/tu/reportSnapshot.ts',
  ]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.match(source, /resolveTuReportSectionTitle\(/)
    assert.doesNotMatch(source, /resolveTuReportSectionPolicy\(/)
  }
})
