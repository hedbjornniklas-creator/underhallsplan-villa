import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { digest, REVIEW_SHA256 } from './lib/ob-staging-schema.mjs'
import { settingsTables } from './lib/ob-settings-rehearsal.mjs'

const bytes = await readFile(new URL('../.cache/inspection-schema-export/production-schema-review.json', import.meta.url))
assert.equal(digest(bytes), REVIEW_SHA256)
const s = JSON.parse(bytes).sections
const ident = text => '"' + text.replaceAll('"', '""') + '"'
const statements = ['-- Generated schema-only fixture from the pinned export. No customer rows.',
  '-- UUID extension shim is supplied by the local test harness.']
const enumType = s.types.find(t => t.name === 'overview_selection_mode')
statements.push(`CREATE TYPE public.overview_selection_mode AS ENUM (${enumType.enum_labels.map(v => "'" + v + "'").join(',')});`)
for (const table of settingsTables) {
  const columns = s.columns.filter(c => c.relation_name === table).sort((a,b) => a.position-b.position)
  assert.ok(columns.length)
  assert.ok(columns.every(c => !c.identity_kind && !c.generated_kind))
  statements.push(`CREATE TABLE public.${ident(table)} (\n${columns.map(c =>
    `  ${ident(c.name)} ${c.data_type}${c.default_expression === null ? '' : ' DEFAULT ' + c.default_expression}${c.not_null ? ' NOT NULL' : ''}`
  ).join(',\n')}\n);`)
}
for (const foreign of [false,true]) {
  for (const c of s.constraints.filter(c => settingsTables.includes(c.relation_name.replace('public.','')) && (c.kind === 'f') === foreign)) {
    statements.push(`ALTER TABLE ${c.relation_name} ADD CONSTRAINT ${ident(c.name)} ${c.definition};`)
  }
}
for (const f of s.functions.filter(f => s.triggers.some(t => settingsTables.includes(t.table_name) && t.function_name === f.signature))) {
  statements.push(f.definition + ';')
}
for (const t of s.triggers.filter(t => settingsTables.includes(t.table_name))) statements.push(t.definition + ';')
for (const p of s.policies.filter(p => settingsTables.includes(p.table_name))) {
  statements.push(`CREATE POLICY ${ident(p.name)} ON public.${ident(p.table_name)} AS ${p.permissive} FOR ${p.command} TO ${p.roles.map(ident).join(',')}${p.using_expression ? ' USING (' + p.using_expression + ')' : ''}${p.check_expression ? ' WITH CHECK (' + p.check_expression + ')' : ''};`)
}
for (const t of s.relations.filter(t => settingsTables.includes(t.name) && t.rls_enabled)) statements.push(`ALTER TABLE public.${ident(t.name)} ENABLE ROW LEVEL SECURITY;`)
for (const table of settingsTables) statements.push(`GRANT ALL ON public.${ident(table)} TO anon,authenticated,service_role;`)
await writeFile(new URL('../test/fixtures/ob-settings-access.sql',import.meta.url),statements.join('\n')+'\n')
console.log(`Generated exact columns, constraints, triggers and policies for ${settingsTables.length} catalogues`)
