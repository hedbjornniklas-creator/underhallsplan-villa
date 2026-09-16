import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function sender(env: Record<string, string | undefined>) {
  const source = readFileSync(new URL('../src/lib/renoapp/mailConfig.ts', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} as { getRenoAppMailFromAddress: () => string } }
  new Function('module', 'exports', 'process', output)(compiled, compiled.exports, { env })
  return compiled.exports.getRenoAppMailFromAddress()
}

test('RenoApp defaults to its verified domain without inheriting the HusHub sender', () => {
  for (const override of [undefined, '', ' \t ']) {
    const env = { RENOAPP_MAIL_FROM: override, ASSIGNMENTS_MAIL_FROM: 'HusHub <noreply@hushub.se>' }
    assert.equal(sender(env), 'RenoApp <meddelanden@renoapp.se>')
    assert.equal(env.ASSIGNMENTS_MAIL_FROM, 'HusHub <noreply@hushub.se>')
  }
  assert.equal(sender({}), 'RenoApp <meddelanden@renoapp.se>')
})

test('a dedicated RenoApp override is trimmed and does not change shared configuration', () => {
  const env = {
    RENOAPP_MAIL_FROM: '  RenoApp Test <test@example.test>  ',
    ASSIGNMENTS_MAIL_FROM: 'HusHub <noreply@hushub.se>',
  }
  assert.equal(sender(env), 'RenoApp Test <test@example.test>')
  assert.equal(env.ASSIGNMENTS_MAIL_FROM, 'HusHub <noreply@hushub.se>')
})

test('all RenoApp sender entry points use the dedicated configuration', () => {
  for (const file of ['server', 'onboarding', 'actionTypeFeedback', 'consultantReviewServer']) {
    const source = readFileSync(new URL(`../src/lib/renoapp/${file}.ts`, import.meta.url), 'utf8')
    assert.match(source, /import \{ getRenoAppMailFromAddress(?: as getMailFromAddress)? \} from '@\/lib\/renoapp\/mailConfig'/)
    assert.doesNotMatch(source, /ASSIGNMENTS_MAIL_FROM|Hushub <noreply@hushub\.se>/)
  }
})
