import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import postcss from 'postcss'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const assignment = read('src/app/(dashboard)/ob/assignments/[id]/page.tsx')

test('assignment and property share presentational fields and sections only', () => {
  const primitives = read('src/components/ob/ObFormPrimitives.tsx')
  assert.doesNotMatch(primitives, /fetch\(|supabase|useEffect|useState/)
  for (const source of [assignment, read('src/components/ob/ObStepGrunddata.tsx')]) {
    assert.match(source, /ObFormField, ObFormSection/)
    assert.match(source, /ob-form-compact/)
    assert.match(source, /<ObFormSection title="Objekt"/)
    assert.match(source, /<ObFormSection title="Uppdragsgivare"/)
    assert.match(source, /<ObFormSection title="Besiktningsuppdrag"/)
  }
  assert.doesNotMatch(assignment, /SectionCard|RoleChip|linear-gradient|backdrop-blur|hover:-translate/)
})

test('assignment styling is local and keeps existing color tokens', () => {
  const css = postcss.parse(read('src/components/ob/ob-assignment-form.css'))
  css.walkRules(rule => {
    for (const selector of rule.selectors) assert.match(selector, /^\.ob-assignment-/)
  })
  css.walkDecls(declaration => assert.ok(!declaration.prop.startsWith('--obm-')))
  assert.match(css.toString(), /max-width: 1280px/)
  const shared = read('src/components/ob/ob-forms.css')
  assert.match(shared, /\.ob-form-compact \.ob-form-section > h2 \{\s*font-size: 1rem/)
  assert.match(shared, /\.ob-form-compact \.ob-form-label \{\s*font-size: \.8125rem/)
})

test('form retains locked fieldset, approval snapshot and action guards', () => {
  assert.match(assignment, /disabled=\{isEditingLocked \|\| sending\}/)
  assert.match(assignment, /disabled=\{!canSend \|\| sending/)
  assert.match(assignment, /disabled=\{!canBook \|\| booking/)
  assert.match(assignment, /validateObEarlyStartReason\(earlyStartReason\)/)
  assert.match(assignment, /<ObAcceptedAssignmentTerms[\s\S]*?assignmentId=\{assignment.id\}/)
  assert.match(assignment, /type="radio" name="assignment-role" checked=\{active\} onChange=\{onChange\}/)
  assert.match(assignment, /ob-assignment-save-status" role="status"/)
})
