import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/lib/renoapp/server.ts', import.meta.url), 'utf8')
const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
const declarations = new Map<string, string>()
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.initializer) declarations.set(node.name.getText(ast), node.getText(ast))
  ts.forEachChild(node, visit)
}
visit(ast)
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['normalizeText', 'normalizeMachineKey'].includes(node.name?.text ?? '')).map(node => node.getText(ast)).join('\n')
const code = helpers + '\n' + ['questionAnswersInput', 'needsClarificationCapture', 'answerRowsToInsert'].map(name => {
  assert.ok(declarations.has(name), `Missing ${name}`)
  return `const ${declarations.get(name)};`
}).join('\n') + '\nreturn {questionAnswersInput, needsClarificationCapture, answerRowsToInsert};'
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const execute = new Function('input', 'mode', 'applicableQuestions', 'optionIdByQuestionAndKey', 'caseId', 'MUNICIPAL_QUESTION_KEY', 'INVESTIGATE_OPTION_KEY', js)
const municipal = 'har-du-fatt-besked-fran-kommunen-om-den-planerade-atgarden-kraver-anmalan'

for (const mode of ['draft', 'submit']) {
  test(`${mode}: municipal investigation survives normalization and is persisted by option ID`, () => {
    const result = execute({ questionAnswers: { [municipal]: ['needs_investigation'] } }, mode,
      [{ id: 'municipal', key: municipal, responseType: 'single_select' }],
      new Map([['municipal:needs_investigation', 'investigate-option']]), 'case', municipal, 'needs_investigation')
    assert.deepEqual(result.questionAnswersInput, { [municipal]: ['needs_investigation'] })
    assert.equal(result.needsClarificationCapture, mode === 'submit')
    assert.deepEqual(result.answerRowsToInsert, [{ case_id: 'case', question_id: 'municipal', option_id: 'investigate-option' }])
  })
}
test('existing underscore question keys remain intact; unknown options are still not persisted', () => {
  const result = execute({ questionAnswers: { legacy_question: ['yes_option', 'yes_option', 'unknown'] } }, 'submit',
    [{ id: 'legacy', key: 'legacy_question', responseType: 'multi_select' }],
    new Map([['legacy:yes_option', 'yes-id']]), 'case', municipal, 'needs_investigation')
  assert.deepEqual(result.questionAnswersInput, { legacy_question: ['yes_option', 'unknown'] })
  assert.deepEqual(result.answerRowsToInsert, [{ case_id: 'case', question_id: 'legacy', option_id: 'yes-id' }])
  assert.equal(result.needsClarificationCapture, false)
})
