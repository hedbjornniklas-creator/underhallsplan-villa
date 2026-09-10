import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { ensureTuPostDamageDisclaimer, resolveTuReportDocumentTitle, resolveTuReportProjectType, resolveTuReportSectionPolicy, TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY, TU_POST_DAMAGE_REPORT_DISCLAIMER, TU_STANDARD_REPORT_TEMPLATES } from '../src/lib/tu/reportTemplates.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { summarizeTuControlPlanReview } from '../src/lib/tu/controlPlan.ts'
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
  assert.equal(template.version, 2)
  assert.equal(template.documentTitle, 'Teknisk uppföljningskontroll efter skadeåtgärd')
  assert.deepEqual(template.sections?.map((section) => section.titleOverride), [
    'Uppdrag och avgränsning',
    'Kontrollens resultat',
    'Samlad teknisk bedömning',
    'Rekommenderad fortsatt hantering',
  ])
  assert.ok(template.sections?.every((section) => section.isRequired && !section.allowDelete))
})

test('uses the observation-driven policy for existing post-damage investigations', () => {
  assert.equal(resolveTuReportDocumentTitle({
    templateKey: 'post_damage_remediation_review',
    storedTitle: 'Teknisk kontroll efter skadeåtgärd',
  }), 'Teknisk uppföljningskontroll efter skadeåtgärd')
  assert.equal(resolveTuReportDocumentTitle({
    templateKey: 'post_damage_remediation_review',
    storedTitle: 'Egen rapporttitel',
  }), 'Egen rapporttitel')
  assert.equal(resolveTuReportProjectType({
    templateKey: 'post_damage_remediation_review',
    storedProjectType: 'Teknisk kontroll efter skadeåtgärd',
  }), 'Teknisk uppföljningskontroll efter skadeåtgärd')
  assert.match(
    resolveTuReportSectionPolicy('post_damage_remediation_review', 'observed_execution')?.aiInstruction ?? '',
    /observationstyrt/i
  )
})

test('adds the assignment disclaimer once with a traceable policy source', () => {
  const sections = ensureTuPostDamageDisclaimer({
    templateKey: 'post_damage_remediation_review',
    assignmentSectionId: 'scope',
    sections: [{
      sectionId: 'scope',
      paragraphs: [{
        text: 'Kontrollen omfattade åtkomliga delar.',
        sourceAnalysisItemIds: [],
        sourceObservationIds: ['observation-1'],
        sourceFieldKeys: [],
        warnings: [],
      }],
    }],
  })
  assert.equal(sections[0].paragraphs.at(-1)?.text, TU_POST_DAMAGE_REPORT_DISCLAIMER)
  assert.deepEqual(
    sections[0].paragraphs.at(-1)?.sourceFieldKeys,
    [TU_POST_DAMAGE_ASSIGNMENT_NATURE_FIELD_KEY]
  )

  const secondPass = ensureTuPostDamageDisclaimer({
    templateKey: 'post_damage_remediation_review',
    assignmentSectionId: 'scope',
    sections,
  })
  assert.equal(secondPass[0].paragraphs.length, sections[0].paragraphs.length)
})

test('treats generated attention areas as included until explicitly removed', () => {
  assert.deepEqual(summarizeTuControlPlanReview([
    { reviewStatus: 'accepted' },
    { reviewStatus: 'rejected' },
    { reviewStatus: 'pending' },
  ]), {
    accepted: 1,
    rejected: 1,
    pending: 1,
    included: 2,
    canApprove: true,
  })

  assert.equal(summarizeTuControlPlanReview([
    { reviewStatus: 'accepted' },
    { reviewStatus: 'rejected' },
  ]).canApprove, true)

  assert.equal(summarizeTuControlPlanReview([
    { reviewStatus: 'rejected' },
  ]).canApprove, false)
})
