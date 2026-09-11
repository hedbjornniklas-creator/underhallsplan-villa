import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(
  new URL('../src/components/tu/TuEvidenceWorkspace.tsx', import.meta.url),
  'utf8'
)

test('opening the next observation also replaces the active measurement form', () => {
  const reviewFlow = source.slice(
    source.indexOf('const approveObservationAndOpenNext = async () => {'),
    source.indexOf('void queueObservationSnapshot(snapshot)', source.indexOf('const approveObservationAndOpenNext = async () => {'))
  )

  assert.match(
    reviewFlow,
    /setForm\(toObservationForm\(nextObservation\)\)[\s\S]*setMeasurementForm\([\s\S]*nextObservation\.measurements\[0\][\s\S]*measurementToForm\(nextObservation\.measurements\[0\]\)/
  )
  assert.match(
    reviewFlow,
    /else \{[\s\S]*setForm\(snapshot\)[\s\S]*setMeasurementForm\(emptyMeasurementWithRememberedInstrument\(\)\)/
  )
})

test('requires an explicit measurement assessment before source review is completed', () => {
  const reviewFlow = source.slice(
    source.indexOf('const approveObservationAndOpenNext = async () => {'),
    source.indexOf('const deleteObservation = async () => {')
  )

  assert.match(reviewFlow, /missingAssessment/)
  assert.match(reviewFlow, /Välj en bedömning för varje mätning/)
  assert.match(
    source,
    /function isObservationReviewComplete[\s\S]*observation\.reviewStatus === 'reviewed'[\s\S]*observation\.measurements\.every[\s\S]*measurement\.assessment/
  )
})
