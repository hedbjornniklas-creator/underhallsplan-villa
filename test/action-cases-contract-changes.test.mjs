import assert from 'node:assert/strict'
import test from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as changes from '../src/lib/action-cases/contractChanges.ts'
import { emptyContractDetails, normalizeContractDetails, contractDetailsIssues } from '../src/lib/action-cases/customerContract.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, mapCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { assignmentPatch } from '../src/lib/action-cases/contractAssignment.ts'

const rate = (kind = 'other', title = 'Snickare', hourlyOre = 75000) => ({ id: randomUUID(), kind, title, hourlyOre })
const pricing = () => ({ ...changes.changesForEditing(emptyContractDetails()), rates: [rate('ordinary', 'Ordinarie arbete', 65000)],
  markups: { materials: 10, subcontractors: 5, equipment: 0, other: 12.5 } })
const draft = () => ({ ...emptyCustomerOffer('Testavtal'), baseAmountOre: 10000, contractDetails: emptyContractDetails() })
const file = () => ({ id: randomUUID(), fileName: 'Prislista.pdf', contentType: 'application/pdf', fileSizeBytes: 100 })
const annex = (f) => ({ fileId: f.id, type: 'ÄTA-prislista', name: 'ÄTA-prislista 2026', date: '2026-10-10' })
const edited = (d, p, files = []) => normalizeCustomerOffer({ ...d, ...changes.changePricingPatch(d, p, files) })

test('legacy text survives an explicit editing upgrade without guessed rates or changed snapshots', () => {
  const d = draft(); d.contractDetails.fields.changes = { status: 'document', text: 'Gamla villkor' }
  const original = structuredClone(d), p = changes.changesForEditing(d.contractDetails)
  assert.equal(p.notes, 'Avtalshandling: Gamla villkor')
  assert.equal(p.rates[0].hourlyOre, null)
  assert(Object.values(p.markups).every((v) => v === null))
  assert.deepEqual(d, original)
  assert.equal(normalizeCustomerOffer(d).contractDetails.changesPricing, undefined)
  assert.equal(changes.changesForEditing(changes.changesDetails(d.contractDetails, p)), p)
})

test('hourly roles, leadership and per-category markups save independently of the main price and source text', () => {
  const d = draft(), before = structuredClone(d), p = pricing()
  p.rates.push(rate('management', 'Arbetsledning', 85000), rate())
  p.notes = 'Resor enligt särskild överenskommelse.'
  const saved = edited(d, p)
  assert.equal(saved.baseAmountOre, 10000)
  assert.deepEqual(saved.items, d.items)
  assert.deepEqual(saved.contractDetails.changesPricing, p)
  assert.equal(saved.contractDetails.fields.changes.status, 'specified')
  assert.deepEqual(changes.changesIssues(p), [])
  assert.deepEqual(d, before)
  const partial = { ...p, markups: { ...p.markups, materials: null } }
  const incomplete = edited(saved, partial)
  assert.equal(incomplete.contractDetails.fields.changes.status, 'unreviewed')
  assert(contractDetailsIssues(incomplete.contractDetails).some((v) => v.includes('ÄTA-påslag')))
  assert.deepEqual(changes.changesIssues({ ...p, markups: { materials: 0, subcontractors: 0, equipment: 0, other: 0 } }), [])
})

test('annex reference, document metadata and selected files save in one patch without duplicate documents', () => {
  const d = draft(), f = file(), p = { ...pricing(), mode: 'attachment', annex: annex(f), annexRevision: 'Rev 2' }
  const saved = edited(d, p, [f]), original = structuredClone(saved)
  assert.deepEqual(saved.attachmentIds, [f.id])
  assert.deepEqual(saved.contractDetails.assignment.documents, [p.annex])
  assert.deepEqual(changes.changesIssues(p), [])
  const next = edited(saved, { ...p, annex: { ...p.annex, name: 'Ny titel', date: '2026-10-11' } }, [f])
  assert.equal(next.contractDetails.assignment.documents.length, 1)
  assert.equal(next.contractDetails.assignment.documents[0].name, 'Ny titel')
  assert.deepEqual(saved, original)
  const viaDocuments = assignmentPatch(next, { ...next.contractDetails.assignment, documents: [{ ...next.contractDetails.assignment.documents[0], name: 'Via handlingar' }] })
  assert.equal(normalizeCustomerOffer({ ...next, ...viaDocuments }).contractDetails.changesPricing.annex.name, 'Via handlingar')
  const removed = assignmentPatch(next, { ...next.contractDetails.assignment, documents: [] })
  assert.equal(normalizeCustomerOffer({ ...next, ...removed }).contractDetails.changesPricing.annex, null)
  assert(changes.changesIssues(removed.contractDetails.changesPricing).some((v) => v.includes('prisbilaga')))
})

test('switching methods retains manual rates but excludes the inactive annex and never touches other files', () => {
  const d = draft(), f = file(), other = file()
  d.attachmentIds = [other.id]
  const p = { ...pricing(), mode: 'attachment', annex: annex(f), annexRevision: 'Rev 1' }
  const attached = edited(d, p, [f, other])
  const manual = edited(attached, { ...p, mode: 'fields' }, [f, other])
  assert.deepEqual(manual.attachmentIds, [other.id])
  assert.deepEqual(manual.contractDetails.changesPricing.rates, p.rates)
  assert.equal(manual.contractDetails.assignment.documents.length, 1)
  const restored = edited(manual, { ...p, mode: 'attachment' }, [f, other])
  assert.deepEqual(new Set(restored.attachmentIds), new Set([other.id, f.id]))
  const replacement = file()
  const replaced = edited(restored, { ...p, annex: annex(replacement) }, [f, other, replacement])
  assert.deepEqual(new Set(replaced.attachmentIds), new Set([other.id, replacement.id]))
})

test('annex mode requires metadata, manual mode requires ordinary rates, and blank values are not free', () => {
  assert(changes.changesIssues({ ...pricing(), rates: [] }).some((v) => v.includes('ordinarie')))
  assert(changes.changesIssues({ ...pricing(), rates: [rate('ordinary', '', 0)] }).length)
  const p = { ...pricing(), mode: 'attachment', rates: [], annex: null, annexRevision: '' }
  assert.equal(changes.changesIssues(p).length, 2)
  p.annex = { ...annex(file()), date: '' }
  assert(changes.changesIssues(p).some((v) => v.includes('datum')))
  p.annex.date = '2026-10-10'; p.annexRevision = '1'; p.standardText = ''
  assert(changes.changesIssues(p).some((v) => v.includes('avtalsvillkoren')))
})

test('malformed rates, duplicates, markups, dates and unsupported money never enter drafts', () => {
  for (const patch of [{ version: 2 }, { mode: 'both' }, { rates: [rate('manager')] }, { rates: [rate('ordinary'), rate('ordinary')] },
    { rates: [rate('ordinary', 'Arbete', '65000')] }, { rates: [rate('ordinary', 'Arbete', 1.5)] },
    { rates: [rate('ordinary', 'Arbete', -1)] }, { rates: [rate('ordinary', 'Arbete', 100_000_000_001)] },
    { rates: Array.from({ length: 51 }, () => rate()) }, { markups: { ...pricing().markups, materials: 1.001 } },
    { markups: { ...pricing().markups, other: 1001 } }, { annex: { ...annex(file()), date: '2026-02-30' } },
    { annexRevision: 'x'.repeat(101) }, { standardText: 'x'.repeat(6001) }])
    assert.throws(() => changes.normalizeContractChanges({ ...pricing(), ...patch }), /INVALID/)
  const duplicate = rate()
  assert.throws(() => changes.normalizeContractChanges({ ...pricing(), rates: [duplicate, duplicate] }), /INVALID/)
  const p = { ...pricing(), mode: 'attachment', annex: annex(file()), annexRevision: '1' }
  assert.throws(() => normalizeContractDetails(changes.changesDetails(emptyContractDetails(), p)), /INVALID/)
})

test('missing, foreign, non-PDF and terms files cannot be used as a price annex', () => {
  const d = draft(), f = file(), p = { ...pricing(), mode: 'attachment', annex: annex(f), annexRevision: '1' }
  assert.throws(() => changes.changePricingPatch(d, p, []), /FILES/)
  assert.throws(() => changes.changePricingPatch(d, p, [{ ...f, contentType: 'image/png' }]), /FILES/)
  d.termsAttachmentId = f.id
  assert.throws(() => changes.changePricingPatch(d, p, [f]), /FILES/)
})

test('customer projection hides inactive rate data and cannot expose an unused annex', () => {
  const f = file(), d = edited(draft(), { ...pricing(), mode: 'attachment', annex: annex(f), annexRevision: '1' }, [f])
  const publicOffer = (d) => mapCustomerOffer({ id: randomUUID(), version: 1, snapshot: d, files: [], status: 'published' }).snapshot
  const projected = publicOffer(d)
  assert.deepEqual(projected.contractDetails.changesPricing.rates, [])
  assert(Object.values(projected.contractDetails.changesPricing.markups).every((v) => v === null))
  assert.equal(normalizeCustomerOffer(projected).contractDetails.changesPricing.annex.name, 'ÄTA-prislista 2026')
  const manual = edited(d, { ...d.contractDetails.changesPricing, mode: 'fields' }, [f])
  assert.equal(publicOffer(manual).contractDetails.changesPricing.annex, null)
  assert.equal(d.contractDetails.changesPricing.rates.length, 1)
})

function documentText(value) {
  const source = readFileSync(new URL('../src/components/tasks/CustomerContractChanges.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }, jsx = (type, props) => ({ type, props })
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: {}, 'lucide-react': {}, '@/lib/action-cases/contractChanges': changes,
    '@/lib/action-cases/customerOffers': { money: (v) => v === null ? 'Pris saknas' : `${v / 100} kr` }, '@/lib/action-cases/contractAssignment': {}, './CustomerOfferPriceInput': {} }
  new Function('require', 'module', 'exports', code)((name) => modules[name], loaded, loaded.exports)
  const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? flatten(node.props?.children) : [node]
  return flatten(loaded.exports.ContractChangesDocument({ value })).filter((v) => typeof v === 'string' || typeof v === 'number').join(' ')
}
test('customer document shows selected price basis, VAT, agreed roles and an ordinary leadership fallback', () => {
  const p = pricing(), text = documentText(p)
  assert.match(text, /650 kr/)
  assert.match(text, /Arbetsledning/)
  assert.match(text, /Underentreprenörer/)
  assert.match(text, /12,5 %/)
  assert.match(text, /Moms tillkommer/)
  const annexText = documentText({ ...p, mode: 'attachment', annex: annex(file()), annexRevision: 'Rev 3' })
  assert.match(annexText, /ÄTA-prislista 2026/)
  assert.match(annexText, /Rev 3/)
  assert.doesNotMatch(annexText, /650 kr/)
})

test('saving and publication preflight require the new database guard and preserve the existing snapshot-file pipeline', () => {
  const server = readFileSync(new URL('../src/lib/action-cases/customerOffersServer.ts', import.meta.url), 'utf8')
  const preflight = server.slice(server.indexOf('async function checkPricingSchema'), server.indexOf('function mailConfig'))
  assert.match(preflight, /draft.contractDetails\?\.changesPricing/)
  assert.match(preflight, /rpc\('assert_contract_changes', \{ p_body: draft, p_complete: complete \}\)/)
  assert.match(preflight, /checked\(guard.error\)/)
  assert.match(server, /await checkPricingSchema\(draft, true\)/)
})
