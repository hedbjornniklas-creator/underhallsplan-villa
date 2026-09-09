import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { TU_STANDARD_REPORT_TEMPLATES } from '../src/lib/tu/reportTemplates.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { deriveTuWorkflowSteps } from '../src/lib/tu/workflow.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { resolveTuWorkflowProfile } from '../src/lib/tu/workflowProfiles.ts'

function workflowSource(workflowProfile: 'field_report' | 'post_damage_review') {
  return {
    workflowProfile,
    preparation: null,
    validation: null,
    workflow: null,
    reportDraft: null,
    delivery: null,
    queue: { total: 0, failed: 0 },
    reportFilledSectionCount: 0,
    reportSectionCount: 0,
  }
}

test('adds preparation only to the post-damage workflow', () => {
  const standardSteps = deriveTuWorkflowSteps(workflowSource('field_report'))
  const postDamageSteps = deriveTuWorkflowSteps(workflowSource('post_damage_review'))

  assert.deepEqual(standardSteps.map((step) => step.id), [
    'field',
    'evidence',
    'assessment',
    'report',
    'delivery',
  ])
  assert.deepEqual(postDamageSteps.map((step) => step.id), [
    'preparation',
    'field',
    'evidence',
    'assessment',
    'report',
    'delivery',
  ])
  assert.deepEqual(postDamageSteps.map((step) => step.number), [1, 2, 3, 4, 5, 6])
})

test('resolves the immutable profile and supports the template fallback', () => {
  assert.equal(resolveTuWorkflowProfile('field_report', 'post_damage_remediation_review'), 'field_report')
  assert.equal(resolveTuWorkflowProfile(null, 'post_damage_remediation_review'), 'post_damage_review')
  assert.equal(resolveTuWorkflowProfile(undefined, 'deep_technical_investigation'), 'field_report')
})

test('seeds a general AI-assisted post-damage report template', () => {
  const template = TU_STANDARD_REPORT_TEMPLATES.find(
    (candidate) => candidate.key === 'post_damage_remediation_review'
  )

  assert.ok(template)
  assert.equal(template.authoringMode, 'ai_assisted')
  assert.equal(template.workflowProfile, 'post_damage_review')
  assert.deepEqual(template.sections?.map((section) => section.titleOverride), [
    'Uppdrag, underlag och avgränsning',
    'Genomförande och iakttagelser',
    'Teknisk bedömning',
    'Rekommenderad fortsatt hantering',
  ])
  assert.ok(template.sections?.every((section) => section.isRequired && !section.allowDelete))
})
