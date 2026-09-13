import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildStagingSchema, guardBuildingMigration, digest } from './lib/ob-staging-schema.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const privateRoot = resolve(root, '.cache/inspection-schema-export')
const version = process.argv[2] ?? 'staging-schema-v2'
if (!/^staging-schema-v[1-9][0-9]*$/.test(version)) throw new Error('Use a private staging-schema-vN version name')
const output = join(privateRoot, version)
if (existsSync(output)) throw new Error('Output exists; inspect it before creating a new reviewed version')
const bundle = buildStagingSchema(readFileSync(join(privateRoot, 'production-schema-review.json')))
mkdirSync(output)
writeFileSync(join(output, '00-bootstrap.sql'), bundle.bootstrap, { flag: 'wx' })
for (const part of bundle.parts) writeFileSync(join(output, `${String(part.ordinal).padStart(2, '0')}-schema.sql`), part.sql, { flag: 'wx' })
bundle.manifest.buildingMigrations = []
for (const [i, name] of ['2026-09-12_01_ob_building_parts.sql', '2026-09-12_02_ob_building_commands.sql',
  '2026-09-12_03_ob_building_round.sql', '2026-09-12_04_ob_building_cutover.sql'].entries()) {
  const source = readFileSync(join(root, 'docs/db', name), 'utf8')
  const sql = guardBuildingMigration(source, i + 1)
  const file = `${String(bundle.parts.length + i + 1).padStart(2, '0')}-building.sql`
  writeFileSync(join(output, file), sql, { flag: 'wx' })
  bundle.manifest.buildingMigrations.push({ file, source: name, sourceSha256: digest(source), sha256: digest(sql) })
}
const smoke = readFileSync(join(root, 'scripts/sql/ob-staging-building-smoke.sql'), 'utf8')
writeFileSync(join(output, '13-smoke.sql'), smoke, { flag: 'wx' })
bundle.manifest.smoke = { file: '13-smoke.sql', sha256: digest(smoke) }
writeFileSync(join(output, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2), { flag: 'wx' })
console.log(JSON.stringify({ output, source: bundle.manifest.sourceSha256, counts: bundle.manifest.counts,
  parts: bundle.parts.length, externalFunctionsOmitted: bundle.manifest.omittedFunctions.length }, null, 2))
