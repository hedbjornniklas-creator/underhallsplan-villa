import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { isTuReportAuthoringMode, resolveTuReportAuthoringMode, tuReportAuthoringModeLabel, usesTuAiAssistedWorkflow } from '../src/lib/tu/authoring.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { TU_STANDARD_REPORT_TEMPLATES } from '../src/lib/tu/reportTemplates.ts'

test('retires the moisture template without removing existing report definitions or other templates', () => {
  const moisture = TU_STANDARD_REPORT_TEMPLATES.find(template => template.key === 'moisture_damage_investigation')
  assert.ok(moisture)
  assert.equal(moisture.isActive, false)
  assert.equal(moisture.authoringMode, 'ai_assisted')
  assert.equal(moisture.sections?.length, 4)
  for (const template of TU_STANDARD_REPORT_TEMPLATES.filter(template => template !== moisture)) {
    assert.equal(template.isActive, true, template.key)
  }
})

test('accepts only supported TU authoring modes', () => {
  assert.equal(isTuReportAuthoringMode('standard'), true)
  assert.equal(isTuReportAuthoringMode('ai_assisted'), true)
  assert.equal(isTuReportAuthoringMode('moisture'), false)
  assert.equal(isTuReportAuthoringMode(null), false)
})

test('uses the immutable investigation mode before the template fallback', () => {
  assert.equal(
    resolveTuReportAuthoringMode('standard', 'moisture_damage_investigation'),
    'standard'
  )
  assert.equal(
    resolveTuReportAuthoringMode('ai_assisted', 'short_technical_statement'),
    'ai_assisted'
  )
})

test('keeps legacy moisture investigations AI-assisted and defaults other legacy reports to standard', () => {
  assert.equal(resolveTuReportAuthoringMode(null, 'moisture_damage_investigation'), 'ai_assisted')
  assert.equal(resolveTuReportAuthoringMode(null, 'deep_technical_investigation'), 'standard')
  assert.equal(resolveTuReportAuthoringMode(undefined, null), 'standard')
})

test('exposes stable workflow helpers and labels', () => {
  assert.equal(usesTuAiAssistedWorkflow('ai_assisted'), true)
  assert.equal(usesTuAiAssistedWorkflow('standard'), false)
  assert.equal(tuReportAuthoringModeLabel('ai_assisted'), 'Fält- och AI-flöde')
  assert.equal(tuReportAuthoringModeLabel('standard'), 'Standardredigering')
})
