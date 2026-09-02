import assert from 'node:assert/strict'
import test from 'node:test'

// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { isTuReportAuthoringMode, resolveTuReportAuthoringMode, tuReportAuthoringModeLabel, usesTuAiAssistedWorkflow } from '../src/lib/tu/authoring.ts'

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
