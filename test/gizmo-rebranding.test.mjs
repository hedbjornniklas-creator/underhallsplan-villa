import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load(path, dependencies = {}, extra = '') {
  const loaded = { exports: {} }
  const code = ts.transpileModule(read(path) + extra, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)(name => name in dependencies ? dependencies[name] : name === 'react/jsx-runtime' ? require(name) : {}, loaded, loaded.exports)
  return loaded.exports
}
test('navigation keeps its technical identity and existing route while displaying Gizmo', () => {
  const topbar = read('src/components/Topbar.tsx'), dashboard = read('src/lib/dashboard/server.ts')
  assert.match(topbar, /code: 'GZ',\s*label: 'Gizmo',[\s\S]*?href: '\/uppdrag'/)
  assert.match(dashboard, /id: 'tasks', title: 'Gizmo', code: 'GZ', href: '\/uppdrag', moduleKey: 'tasks'/)
  const layout = read('src/app/(dashboard)/uppdrag/layout.tsx')
  assert.match(layout, /productLabel="Gizmo"/); assert.match(layout, /moduleKey: 'tasks'/)
  assert.match(layout, /title: 'Gizmo'/)
  assert.match(read('src/app/(dashboard)/uppdrag/loading.tsx'), /Öppnar Gizmo/)
  assert.match(read('src/app/mina-uppdrag/layout.tsx'), /Mina uppdrag \| Gizmo/)
})
test('public wordmark uses Gizmo, the existing symbol and no changed print asset', () => {
  const Brand = load('src/components/tasks/UppdragBrand.tsx', { 'next/image': { __esModule: true, default: ({ priority, ...props }) => createElement('img', props) } }).default
  const html = renderToStaticMarkup(createElement(Brand))
  assert.match(html, />Gizmo</); assert.match(html, /från HusHub/)
  assert.match(html, /\/uppdrag\/brand\/symbol\.svg/); assert.doesNotMatch(html, /HusHub Uppdrag|\/brand\/logo\.svg/)
  assert.match(renderToStaticMarkup(createElement(Brand, { compact: true })), /alt="Gizmo"/)
  assert.match(read('src/lib/action-cases/purchaseListPrint.ts'), /asset\('logo\.svg'\)/)
})
test('admin labels are presentation only and preserve every other module and role', () => {
  const admin = load('src/lib/access/admin.ts', {}, '\nexport { moduleDisplayLabel, roleDisplayLabel };')
  const module = { id: 'unchanged-module-id', key: 'tasks', label: 'Uppdrag' }, role = { id: 'unchanged-role-id', key: 'task_member', label: 'Uppdragsanvandare' }
  assert.equal(admin.moduleDisplayLabel('dashboard', module), 'Gizmo')
  assert.equal(admin.roleDisplayLabel('dashboard', role), 'Gizmo-användare')
  assert.equal(admin.moduleDisplayLabel('renoapp', module), 'Uppdrag')
  assert.equal(admin.moduleDisplayLabel('dashboard', null), null)
  assert.equal(admin.moduleDisplayLabel('dashboard', { key: 'inspections', label: 'ÖB' }), 'ÖB')
  assert.equal(admin.roleDisplayLabel('dashboard', { key: 'task_manager', label: 'Uppdragsansvarig' }), 'Uppdragsansvarig')
  assert.deepEqual(module, { id: 'unchanged-module-id', key: 'tasks', label: 'Uppdrag' })
  assert.deepEqual(role, { id: 'unchanged-role-id', key: 'task_member', label: 'Uppdragsanvandare' })
})
test('new emails use Gizmo without changing task-specific content or personal links', () => {
  const email = load('src/lib/tasks/emailTemplates.ts')
  const url = 'https://hushub.se/signe/fictitious-token?preserved=yes'
  const html = email.buildTaskEmailHtml({ previewText: 'Fiktivt test', eyebrow: 'Fråga', heading: 'Fråga att besvara', recipientName: 'Anna Exempel', lead: 'En oförändrad fråga', taskTitle: 'Fiktivt uppdrag', dueLabel: null, actionUrl: url })
  assert.match(html, />Gizmo</); assert.match(html, />från HusHub</)
  assert.doesNotMatch(html, /Uppdrag med Gizmo/)
  assert.match(html, /Fiktivt uppdrag/); assert.ok(html.includes(url)); assert.match(html, /Öppna uppdraget/)
  const digest = email.buildTaskReminderDigestEmailHtml({ previewText: 'Fiktivt test', heading: 'Att följa upp', recipientName: 'Anna Exempel', lead: 'Test', items: [], overviewUrl: '/mina-uppdrag' })
  assert.match(digest, />Gizmo</); assert.match(digest, />från HusHub</)
})
test('module references change, but generic assignment and legal headings remain', () => {
  assert.doesNotMatch(read('src/components/tasks/QuestionDialogue.tsx'), /via Uppdrag|Uppdrags utskickskö/)
  assert.match(read('src/components/tasks/QuestionDialogue.tsx'), /via Gizmo/)
  assert.match(read('src/components/tasks/ProjectQuestions.tsx'), /href=\{`\/uppdrag\?task=\$\{task.id\}`\}/)
  assert.match(read('src/components/tasks/TaskDetailSheet.tsx'), /Uppdragsansvarig/)
  assert.match(read('src/lib/action-cases/contractSigningPdf.ts'), /'Uppdraget'/)
})
