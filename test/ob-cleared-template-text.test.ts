import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

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
    const expressions = [...source.matchAll(new RegExp(`const \\w+ = (trimText\\(controlItem\\.${field}[^\\r\\n]+)`, 'g'))]
    assert.equal(expressions.length, 2, `${name}: exercise both interior and exterior report paths`)
    return expressions.map(([, expression]) => ({
      name,
      text: evaluate<string>(expression, {
        controlItem: item, outcome, trimText: (value: string) => value.trim(),
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
        assert.equal(result.text, template, `${result.name} must preserve legacy null fallback`)
      }
    }
  })
}
