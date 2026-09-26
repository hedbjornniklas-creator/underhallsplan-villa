import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
// @ts-expect-error Native Node tests require the explicit TypeScript extension.
import { copyObOutcomeText, readObNoteText } from '../src/lib/ob/noteText.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const round = read('src/components/ob/ObStepRunda.tsx')
const reports = [
  ['HTML', read('src/app/utlatande/[propertyId]/[inspectionId]/page.tsx')],
  ['PDF', read('src/lib/report/pdfV2/buildReportDataV2.ts')],
] as const
const outcome = { id: 'outcome', risk_template: 'Mallens risk', ftu_template: 'Mallens FTU' }
type Item = {
  id: string
  selected_outcome_id: string
  note: string
  risk_text: string | null
  ftu_text: string | null
}

// Execute the production save/report expressions without mounting the complete round UI.
// Extraction assertions also make a moved or renamed boundary fail visibly.
function evaluate<T>(expression: string, bindings: Record<string, unknown>): T {
  const output = ts.transpileModule(`return (${expression})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return new Function(...Object.keys(bindings), output)(...Object.values(bindings)) as T
}
const payload = round.match(/const upsertControlItem = [\s\S]*?const payload = (\{[\s\S]*?\n      \})/)
assert.ok(payload, 'round persistence payload must be exercised')

function reportTexts(item: Item, field: 'risk_text' | 'ftu_text') {
  return reports.flatMap(([name, source]) => {
    const expressions = [...source.matchAll(new RegExp(`const \\w+ = (trimText\\(savedText\\.${field}[^\\r\\n]+)`, 'g'))]
    assert.equal(expressions.length, 2, `${name}: exercise both interior and exterior report paths`)
    return expressions.map(([, expression]) => ({
      name,
      text: evaluate<string>(expression, {
        savedText: readObNoteText(item), trimText: (value: string) => value.trim(),
      }),
    }))
  })
}

for (const field of ['risk_text', 'ftu_text'] as const) {
  test(`clearing ${field} survives round save and suppresses HTML/PDF template fallback`, () => {
    const handlers = [...round.matchAll(new RegExp(`onSave=\\{(value => updateControlItem\\(item\\.id!, \\{ ${field}: [^\\n]+)\\}`, 'g'))]
    assert.equal(handlers.length, 2, 'exercise both free-note and catalog-note dialogs')
    for (const [, handler] of handlers) {
      // A selected catalog note starts with the copied template, retaining its outcome ID.
      let saved: Item = {
        id: 'note', selected_outcome_id: outcome.id, note: 'Iakttagelsen kvarstår.',
        risk_text: outcome.risk_template, ftu_text: outcome.ftu_template,
      }
      const original = { ...saved }
      const template = field === 'risk_text' ? outcome.risk_template : outcome.ftu_template
      for (const result of reportTexts(saved, field)) assert.equal(result.text, template)
      const onSave = evaluate<(value: string) => void>(handler, {
        item: saved,
        updateControlItem: (id: string, patch: Partial<Item>) => {
          assert.equal(id, saved.id)
          const item = { ...saved, ...patch }
          const persisted = evaluate<Partial<Item>>(payload![1], { item })
          saved = JSON.parse(JSON.stringify({ ...item, ...persisted })) as Item
        },
      })
      onSave('')
      assert.deepEqual(saved, { ...original, [field]: '' })
      for (const result of reportTexts(saved, field)) {
        assert.equal(result.text, '', `${result.name} must respect explicitly cleared ${field}`)
      }
      for (const result of reportTexts({ ...saved, [field]: null }, field)) {
        assert.equal(result.text, '', `${result.name} must treat legacy null as empty without reading the template`)
      }
    }
  })
}

test('all three fields are independent copies, including empty and null template fields', () => {
  for (const empty of [null, undefined, '']) {
    const template = { note_template: 'Observation', risk_template: empty, ftu_template: empty }
    const copy = copyObOutcomeText(template)
    assert.deepEqual(copy, { note: 'Observation', risk_text: '', ftu_text: '' })
    template.note_template = 'Changed observation'
    template.risk_template = 'New risk'
    template.ftu_template = 'New FTU'
    assert.deepEqual(readObNoteText(copy), { note: 'Observation', risk_text: '', ftu_text: '' })
    const serialized = JSON.parse(JSON.stringify(copy))
    assert.deepEqual(readObNoteText(serialized), copy)
    assert.deepEqual(copyObOutcomeText(template), {
      note: 'Changed observation', risk_text: 'New risk', ftu_text: 'New FTU',
    }, 'only a new explicit selection takes the changed template')
  }
  assert.deepEqual(copyObOutcomeText({ note_template: '  Text\n', risk_template: 'Risk', ftu_template: 'FTU' }), {
    note: '  Text\n', risk_text: 'Risk', ftu_text: 'FTU',
  }, 'copying preserves the original text without formatting changes')
  const historical = { note: null, risk_text: null, ftu_text: null }
  assert.deepEqual(readObNoteText(historical), { note: '', risk_text: '', ftu_text: '' })
  assert.deepEqual(historical, { note: null, risk_text: null, ftu_text: null }, 'reading does not mutate old records')
})

test('working reports never query catalogue outcomes; every report text comes from saved notes', () => {
  for (const [name, source] of reports) {
    assert.doesNotMatch(source, /settings_control_point_outcomes|risk_template|ftu_template|note_template/, name)
    assert.equal([...source.matchAll(/const savedText = readObNoteText\(controlItem\)/g)].length, 2, name)
  }
  for (const file of ['ObStepRunda.tsx', 'ObStepInsida.tsx', 'ObStepUtsida.tsx', 'ObImageNoteForm.tsx']) {
    assert.match(read('src/components/ob/' + file), /copyObOutcomeText\(outcome\)/, `${file}: shared copy rule`)
  }
  for (const file of ['ObMobileRound.tsx', 'ObStepInsida.tsx', 'ObStepUtsida.tsx']) {
    assert.match(read('src/components/ob/' + file), /readObNoteText\(/, `${file}: saved text only`)
    assert.doesNotMatch(read('src/components/ob/' + file), /\?\?\s*(?:outcome\?|riskTemplate|ftuTemplate)/)
  }
})
