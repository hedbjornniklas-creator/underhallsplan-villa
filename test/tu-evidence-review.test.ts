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
