import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node strip-types requires the explicit extension.
import { getObInspectionClassification, isStatusInspection, obInspectionProfileAppliesTo, parseObInspectionProfile, resolveObInspectionProfile } from '../src/lib/ob/inspectionProfile.ts'

test('status classification cannot fall through to a buyer or seller role', () => {
  assert.equal(resolveObInspectionProfile({ assignment_type: 'STATUS', orderer_role: 'Köpare' }), 'status')
  assert.equal(resolveObInspectionProfile({ inspection_family: 'OB', inspection_variant: 'SB', inspection_side: 'seller' }), 'status')
  assert.equal(isStatusInspection({ type: 'STATUS' }), true)
  for (const value of ['status', 'STATUS', 'Statusbesiktning', 'STB', 'SB']) assert.equal(parseObInspectionProfile(value), 'status')
  assert.deepEqual(getObInspectionClassification('status'), { type: 'STATUS', inspection_family: 'OB', inspection_variant: 'SB', inspection_side: 'status' })
})

test('legacy profiles and other inspection families retain their own meaning', () => {
  assert.equal(resolveObInspectionProfile({ inspection_side: 'Säljare' }), 'seller')
  assert.equal(resolveObInspectionProfile({ orderer_role: 'Köpare' }), 'buyer')
  assert.equal(resolveObInspectionProfile({ orderer_role: 'Lägenhet' }), 'apartment')
  assert.equal(resolveObInspectionProfile({}), null)
  assert.equal(parseObInspectionProfile('unknown'), null)
  assert.equal(resolveObInspectionProfile({ inspection_family: 'EB', inspection_variant: 'SB' }), null)
  assert.equal(resolveObInspectionProfile({ type: 'TU', inspection_side: 'status' }), null)
  assert.deepEqual(getObInspectionClassification('seller'), { type: 'OB', inspection_family: 'OB', inspection_variant: 'OB', inspection_side: 'seller' })
})

test('STB explicitly shares house settings without making apartment-only settings apply', () => {
  assert.equal(obInspectionProfileAppliesTo('status', ['buyer']), true)
  assert.equal(obInspectionProfileAppliesTo('status', ['seller']), true)
  assert.equal(obInspectionProfileAppliesTo('status', ['status']), true)
  assert.equal(obInspectionProfileAppliesTo('status', ['apartment']), false)
  assert.equal(obInspectionProfileAppliesTo('status', null), true)
  assert.equal(obInspectionProfileAppliesTo('buyer', ['seller']), false)
})

test('public status acceptance is tied to the status document and its exact consent', () => {
  const source = readFileSync(new URL('../src/app/accept/[token]/page.tsx', import.meta.url), 'utf8')
  assert.match(source, /const statusTerms = data\.terms\.documents\.status/)
  assert.match(source, /statusTerms\?\.confirmationTexts\?\.acceptance \? statusTerms : null/)
  assert.match(source, /termsDocumentHash: activeTerms\.hash/)
  assert.match(source, /activeTerms\?\.confirmationTexts\?\.acceptance/)
})

test('Grunddata guards STB crossing and keeps agreed scope separate from add-on selection', () => {
  const source = readFileSync(new URL('../src/components/ob/ObStepGrunddata.tsx', import.meta.url), 'utf8')
  assert.match(source, /crossesStatusProfile/)
  assert.match(source, /\['sent', 'ordered', 'booked', 'completed'\]\.includes\(assignment.status\)/)
  assert.match(source, /window\.confirm\(/)
  assert.equal((source.match(/const draftError = profileChangeDraftError\(inspection.id\)/g) ?? []).length, 2,
    'check local drafts before validation and again inside the queued write')
  assert.match(source, /function profileChangeDraftError[\s\S]*?catch \{[\s\S]*?Lokala utkast kunde inte kontrolleras/)
  assert.match(source, /if \(inspForm\.inspection_side !== 'status'\) \{\s*const newScope = scopeFromInspectionAddons/)
  assert.match(source, /const patch: Partial<Inspection> = crossesStatusProfile\s*\? getObInspectionClassification\(side\)\s*: \{ inspection_side: side \}/)
})
