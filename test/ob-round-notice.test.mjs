import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/ob/ObStepRunda.tsx', import.meta.url), 'utf8')
const ast = ts.createSourceFile('ObStepRunda.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ObStepRunda')
const effect = component.body.statements.find(node => ts.isExpressionStatement(node)
  && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === 'useEffect'
  && node.expression.arguments[1]?.getText(ast) === '[message]')
assert.ok(effect, 'the message has its own timeout effect')
const runEffect = new Function('message', 'setMessage', 'setTimeout', 'clearTimeout',
  `return (${effect.expression.arguments[0].getText(ast)})()`)

// Exercise the production effect with a fake clock, without loading inspection data.
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let message = null
  let cleanup
  const setMessage = next => {
    if (Object.is(message, next)) return
    cleanup?.()
    message = next
    cleanup = runEffect(message, setMessage, setTimeout, clearTimeout)
  }
  return { setMessage, message: () => message, unmount: () => cleanup?.() }
}

test('success disappears after four seconds, not before', t => {
  const notice = setup(t)
  notice.setMessage({ text: 'Uploaded' })
  t.mock.timers.tick(3999)
  assert.equal(notice.message()?.text, 'Uploaded')
  t.mock.timers.tick(1)
  assert.equal(notice.message(), null)
})

test('another upload with identical wording restarts the timeout', t => {
  const notice = setup(t)
  notice.setMessage({ text: 'Uploaded' })
  t.mock.timers.tick(3000)
  notice.setMessage({ text: 'Uploaded' })
  t.mock.timers.tick(3999)
  assert.equal(notice.message()?.text, 'Uploaded')
  t.mock.timers.tick(1)
  assert.equal(notice.message(), null)
})

test('manual dismissal cancels the old timer without clearing a later message', t => {
  const notice = setup(t)
  notice.setMessage({ text: 'First' })
  t.mock.timers.tick(2000)
  notice.setMessage(null)
  notice.setMessage({ text: 'Second' })
  t.mock.timers.tick(2000)
  assert.equal(notice.message()?.text, 'Second')
  t.mock.timers.tick(2000)
  assert.equal(notice.message(), null)
})

test('unmount cancels the timer', t => {
  const notice = setup(t)
  notice.setMessage({ text: 'Uploaded' })
  notice.unmount()
  t.mock.timers.tick(10000)
  assert.equal(notice.message()?.text, 'Uploaded')
})

test('only success expires; errors and the manual close action are unchanged', () => {
  assert.doesNotMatch(effect.getText(ast), /setError|clearNotice/)
  assert.match(source, /<span>\{error \?\? message\?\.text\}<\/span>/)
  assert.match(source, /const clearNotice = \(\) => \{\s*setError\(null\)\s*setMessage\(null\)/)
  assert.match(source, /onClick=\{clearNotice\} aria-label="Stäng"/)
  assert.match(source, /setMessage\(\{ text: 'Bild uppladdad\.' \}\)/)
})
