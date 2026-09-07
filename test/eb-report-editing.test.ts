import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement, type ComponentType, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import type {
  EbInspectionReport, EbReportDraft, EbReportDraftSection, SaveEbReportDraftInput,
  saveEbReportDraft, resetEbReportDraftSection, refreshEbReportProjectSource, getEbInspectionReport,
} from '../src/lib/eb/server'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const compile = (source: string, fileName = 'test.ts') => ts.transpileModule(source, { fileName, compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText

function load<T>(path: string, dependencies: Record<string, unknown>, expose: string[] = []): T {
  const compiledModule = { exports: {} }
  const source = `${read(path)}\n${expose.map(name => `exports.${name} = ${name};`).join('\n')}`
  new Function('require', 'module', 'exports', compile(source, path))((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('node:') || ['react', 'react/jsx-runtime', 'lucide-react'].includes(name)) return require(name)
    throw new Error(`Unexpected test dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const registry = load<Record<string, unknown>>('src/content/standardtexts/registry.ts', {})
const standardTexts = load<Record<string, unknown>>('src/content/standardtexts/loadStandardText.ts', {
  'server-only': {}, './registry': registry,
})
const pureDependencies = Object.fromEntries(['reportSectionRules', 'reportText', 'vocabulary', 'approvalStatus', 'reviewSections'].map(name => [
  `@/lib/eb/${name}`, load<Record<string, unknown>>(`src/lib/eb/${name}.ts`, {}),
]))

type BuildInput = {
  round: EbInspectionReport
  participants: EbInspectionReport['participants']
  attachments: EbInspectionReport['projectAttachments']
  inspectionDocuments: EbInspectionReport['inspectionDocuments']
  inspectorText: string
  storedDraft: EbReportDraft
}
type Service = {
  buildEbReportDraft: (input: BuildInput) => EbReportDraft
  normalizeEbReportDraft: (input: unknown, updatedAt: string | null) => EbReportDraft
  normalizeEbReportDraftSection: (input: unknown) => EbReportDraftSection | null
  saveEbReportDraft: typeof saveEbReportDraft
  resetEbReportDraftSection: typeof resetEbReportDraftSection
  refreshEbReportProjectSource: typeof refreshEbReportProjectSource
  getEbInspectionReport: typeof getEbInspectionReport
}

// Run the actual build/save/reset/source-refresh implementation. Only storage,
// access checks and loading other entities are replaced; no database is contacted.
function service(dependencies: Record<string, unknown>): Service {
  const ast = ts.createSourceFile('server.ts', read('src/lib/eb/server.ts'), ts.ScriptTarget.Latest, true)
  const statements = ast.statements.filter(node => !ts.isImportDeclaration(node) && !(
    ts.isFunctionDeclaration(node) && node.name && node.name.text in dependencies
  ))
  const names = ['buildEbReportDraft', 'normalizeEbReportDraft', 'normalizeEbReportDraftSection',
    'saveEbReportDraft', 'resetEbReportDraftSection', 'refreshEbReportProjectSource', 'getEbInspectionReport']
  const bindings = { exports: {}, ...standardTexts, ...Object.assign({}, ...Object.values(pureDependencies)), ...dependencies }
  return new Function(...Object.keys(bindings), `${compile(statements.map(node => node.getText(ast)).join('\n'))}; return {${names.join(',')}}`)(
    ...Object.values(bindings)
  ) as Service
}

function fixture() {
  const now = '2026-09-07T10:00:00.000Z'
  const live = {
    project: { id: 'project', title: 'Villa', standardAgreement: 'Konsumententreprenad', clientName: 'Beställaren',
      contractorName: 'Entreprenören', agreementItems: [], inspections: [] },
    inspection: { inspectionId: 'inspection', variant: 'SLB', variantLabel: 'Slutbesiktning', sequenceNo: 1,
      date: '2026-09-03', inspectionTime: '10:00', previousInspections: [], invitationSentAt: null,
      invitationMethod: null, invitationDate: null, approvalStatus: null },
    notes: [], checkpoints: [], images: [], markers: [], participants: [], projectAttachments: [], inspectionDocuments: [],
    disciplines: [], statuses: [], suggestions: [],
  } as unknown as EbInspectionReport
  let stored: EbReportDraft
  let writes = 0
  const input = { orgId: 'org', projectId: 'project', inspectionId: 'inspection', requestedByUserId: 'inspector' }
  const build = (draft: EbReportDraft, round = live) => api.buildEbReportDraft({
    round, participants: round.participants, attachments: round.projectAttachments,
    inspectionDocuments: round.inspectionDocuments, inspectorText: 'Namn: Besiktningsmannen', storedDraft: draft,
  })
  const report = () => {
    const round = { ...live, project: { ...live.project, ...stored.sourceSnapshot?.project } }
    return { ...round, reportDraft: build(stored, round) }
  }
  const api = service({
    assertEbInspectionEditable: async () => undefined,
    fetchEbReportDraft: async () => structuredClone(stored),
    getEbInspectionRound: async () => live,
    listParticipantsForInspection: async () => live.participants,
    listEbInspectionDocuments: async () => live.inspectionDocuments,
    writeEbReportDraft: async (_input: unknown, draft: EbReportDraft, options: { expectedUpdatedAt: string | null; preserveProjectSourceRefreshBase?: boolean }) => {
      assert.equal(options.expectedUpdatedAt, stored.updatedAt)
      writes += 1
      stored = structuredClone({ ...draft, projectSourceRefreshBaseUpdatedAt: options.preserveProjectSourceRefreshBase
        ? draft.projectSourceRefreshBaseUpdatedAt : null })
      return structuredClone(stored)
    },
  })
  stored = build(api.normalizeEbReportDraft(null, null))
  stored.initializedAt = now
  stored.updatedAt = now
  stored.sourceSnapshot = { capturedAt: now, project: structuredClone(live.project), inspectorText: 'Namn: Besiktningsmannen',
    branding: {} as NonNullable<EbReportDraft['sourceSnapshot']>['branding'] }
  const section = (key: string) => {
    const found = report().reportDraft.sections.find(row => row.key === key)
    assert.ok(found, `Missing section ${key}`)
    return found
  }
  return {
    api, input, live, report, section,
    persisted: () => structuredClone(stored),
    writes: () => writes,
    save: async (key: string, text: string) => api.saveEbReportDraft({ ...input, expectedUpdatedAt: stored.updatedAt,
      sections: [{ ...section(key), text }] }),
    refresh: async () => api.refreshEbReportProjectSource(input, { forceContentRefresh: true }),
    reset: async (key: string) => api.resetEbReportDraftSection({ ...input, sectionKey: key }),
    legacySection: (key: string, omitMode = false) => {
      stored.sections = stored.sections.map(row => {
        if (row.key !== key) return row
        if (!omitMode) return { ...row, contentMode: 'structured' }
        const raw: Partial<EbReportDraftSection> = { ...row }
        delete raw.contentMode
        const normalized = api.normalizeEbReportDraftSection(raw)
        assert.ok(normalized)
        return normalized
      })
    },
  }
}

const customerSummons = 'Beställaren har själv kallat entreprenören till besiktningen.'

test('customer-authored summons survives saving, reload and refreshed source data; reset is explicit', async () => {
  const f = fixture()
  assert.equal(f.section('summons').contentMode, 'editable')
  assert.doesNotMatch(f.section('summons').text, /har kallat parterna per e-post/)
  await f.save('summons', customerSummons)
  assert.equal(f.section('summons').text, customerSummons)
  f.live.inspection.invitationMethod = 'e-post'
  f.live.inspection.invitationDate = '2026-09-04'
  f.live.project.clientName = 'Ny beställare'
  await f.refresh()
  assert.equal(f.section('summons').text, customerSummons)
  assert.match(f.section('contract_parties').text, /Ny beställare/)
  await f.save('other_notes', 'Annan egen text ska finnas kvar.')
  await f.reset('summons')
  assert.notEqual(f.section('summons').text, customerSummons)
  assert.match(f.section('summons').text, /2026-09-04/)
  assert.equal(f.section('other_notes').text, 'Annan egen text ska finnas kvar.')
})

test('clearing a narrative is persisted and does not restore a standard phrase on source refresh', async () => {
  const f = fixture()
  for (const key of ['summons', 'not_accessible', 'remedy_deadline', 'inspection_cost_distribution', 'testing_documentation', 'reclamation_notice']) {
    await f.save(key, '')
  }
  f.live.inspection.invitationMethod = 'telefon'
  f.live.inspection.defaultRemedyDeadline = '2026-09-30'
  f.live.inspection.inspectionCostDistribution = 'Beställaren betalar.'
  await f.refresh()
  for (const key of ['summons', 'not_accessible', 'remedy_deadline', 'inspection_cost_distribution', 'testing_documentation', 'reclamation_notice']) {
    assert.equal(f.section(key).text, '', `${key} restored deleted prose`)
  }
})

test('mixed documentation and reclamation prose stays verbatim, even when it resembles old generated text', async () => {
  const f = fixture()
  const documentation = 'Följande dokument över avtalade kvalitetsåtgärder redovisades för granskning i samband med slutbesiktningen:\n\nEgen förklaring.'
  const reclamation = 'För denna konsumententreprenad gäller den formulering som besiktningsmannen skrivit här.\n\nEtt tillägg.'
  await f.save('testing_documentation', documentation)
  await f.save('reclamation_notice', reclamation)
  f.live.project.standardAgreement = 'AB 04'
  await f.refresh()
  assert.equal(f.section('testing_documentation').text, documentation)
  assert.equal(f.section('reclamation_notice').text, reclamation)
})

test('existing field-driven summons can be upgraded and edited; factual fields resist spoofed text or mode', async () => {
  const f = fixture()
  f.legacySection('summons')
  assert.equal(f.section('summons').contentMode, 'editable')
  await f.save('summons', customerSummons)
  await f.refresh()
  assert.equal(f.section('summons').text, customerSummons)
  const original = f.section('inspection_time')
  const payload = { ...original, contentMode: 'editable', text: 'Datum: 1900-01-01' }
  await assert.rejects(f.api.saveEbReportDraft({ ...f.input, sections: [payload] } as SaveEbReportDraftInput), /EB_REPORT_DRAFT_EMPTY/)
  await f.api.saveEbReportDraft({ ...f.input, sections: [{ ...payload, relevanceOverridden: true }] } as SaveEbReportDraftInput)
  assert.equal(f.section('inspection_time').text, original.text)
  assert.equal(f.section('inspection_time').contentMode, 'structured')
  await assert.rejects(f.reset('inspection_time'), /EB_REPORT_SECTION_NOT_EDITABLE/)
})

test('opening a legacy report persists its editable upgrade once and accepts an autosave with the preceding version', async () => {
  const f = fixture()
  f.legacySection('summons', true)
  const before = f.persisted()
  assert.equal(before.sections.find(row => row.key === 'summons')?.contentMode, 'structured')
  await f.api.getEbInspectionReport(f.input)
  assert.equal(f.writes(), 1)
  assert.equal(f.persisted().sections.find(row => row.key === 'summons')?.contentMode, 'editable')
  await f.api.getEbInspectionReport(f.input)
  assert.equal(f.writes(), 1)
  await f.api.saveEbReportDraft({ ...f.input, expectedUpdatedAt: before.updatedAt,
    sections: [{ ...f.section('summons'), text: customerSummons }] })
  assert.equal(f.section('summons').text, customerSummons)
  assert.equal(f.persisted().projectSourceRefreshBaseUpdatedAt, null)
  await assert.rejects(f.api.saveEbReportDraft({ ...f.input, expectedUpdatedAt: before.updatedAt,
    sections: [{ ...f.section('summons'), text: 'En äldre flik försöker skriva över den sparade texten.' }] }), /EB_REPORT_DRAFT_CONFLICT/)
  assert.equal(f.section('summons').text, customerSummons)
})

test('a locked historical report keeps its stored section mode and text without a migration write', async () => {
  const f = fixture()
  f.legacySection('summons')
  const original = f.persisted().sections.find(row => row.key === 'summons')
  f.live.inspection.reportLockedAt = '2026-09-06T12:00:00Z'
  f.live.inspection.invitationMethod = 'telefon'
  const report = await f.api.getEbInspectionReport(f.input)
  assert.deepEqual(report.reportDraft.sections.find(row => row.key === 'summons'), original)
  assert.equal(f.writes(), 0)
})

type SectionRenderer = ComponentType<{ report: EbInspectionReport; section: EbReportDraftSection }>
const rendererDependencies = { ...pureDependencies, 'next/link': { default: () => null }, 'next/navigation': {},
  '@/components/eb/EbReportDeliveryDialog': { default: () => null }, '@/components/eb/EbToastProvider': {},
  '@/components/report/PublicReportPdfDownload': { default: () => null }, '@/components/report/ReportShareButton': { default: () => null } }
const pdf = load<{ SummonsReport: SectionRenderer; TestingDocumentationReport: SectionRenderer }>(
  'src/components/eb/EbInspectionReportView.tsx', rendererDependencies, ['SummonsReport', 'TestingDocumentationReport'])
const digital = load<{ SectionContent: SectionRenderer }>(
  'src/components/eb/EbPublicReportSnapshotView.tsx', rendererDependencies, ['SectionContent'])

test('PDF and digital output render saved summons literally, including text resembling editor instructions', async () => {
  const f = fixture()
  for (const text of [customerSummons, 'Ange kunden som kontaktperson vid återbesök.', 'Ej angivet', '']) {
    await f.save('summons', text)
    const section = f.section('summons')
    for (const renderer of [pdf.SummonsReport, digital.SectionContent]) {
      const html = renderToStaticMarkup(createElement(renderer, { report: f.report(), section }))
      if (text) assert.ok(html.includes(text), `Saved text missing from rendered report: ${text}`)
      assert.doesNotMatch(html, /Besiktningsmannen har kallat|per e-post|kallelsemetod.*inte angetts/)
    }
  }
})

test('both output formats keep manually written documentation wording and its structured document rows', async () => {
  const f = fixture()
  const text = 'Följande dokument över avtalade kvalitetsåtgärder redovisades för granskning i samband med slutbesiktningen:\n\nAnge kunden som kontaktperson.\n\nEgen slutsats.'
  await f.save('testing_documentation', text)
  f.live.inspectionDocuments = [{ documentTypeId: 'document', title: 'Våtrumsintyg', status: 'present', documentDate: '2026-08-30', sortOrder: 1 }] as EbInspectionReport['inspectionDocuments']
  for (const renderer of [pdf.TestingDocumentationReport, digital.SectionContent]) {
    const html = renderToStaticMarkup(createElement(renderer, { report: f.report(), section: f.section('testing_documentation') }))
    for (const paragraph of text.split('\n\n')) assert.ok(html.includes(paragraph), paragraph)
    assert.ok(html.includes('Våtrumsintyg'))
    assert.ok(html.includes('2026-08-30'))
  }
})

const localTextDrafts = load<Record<string, unknown>>('src/lib/ob/localTextDrafts.ts', {})
const debouncedTextarea = load<Record<string, unknown>>('src/components/ob/DebouncedTextarea.tsx', {
  '@/lib/ob/localTextDrafts': localTextDrafts,
})
type SectionEditorProps = {
  sections: EbReportDraftSection[]
  inspectionId: string
  disabled: boolean
  resettingSectionKey: string | null
  onSectionChange: (section: EbReportDraftSection) => void
  onSectionTextSave: (sectionKey: string, text: string) => Promise<void>
  onResetSection: (sectionKey: string) => Promise<void>
}
const reviewEditor = load<{ ReportDraftSectionsEditor: ComponentType<SectionEditorProps> }>(
  'src/components/eb/EbInspectionRoundClient.tsx', {
    ...rendererDependencies,
    '@/components/Protected': { default: () => null },
    '@/components/ob/DebouncedTextarea': debouncedTextarea,
    '@/hooks/useAutosaveQueue': {}, '@/hooks/useEbNoteImageUploadQueue': {},
  }, ['ReportDraftSectionsEditor'])
const legacyEditor = load<{ default: ComponentType<{ initialReport: EbInspectionReport }> }>(
  'src/components/eb/EbInspectionReportDraftClient.tsx', {
    ...rendererDependencies,
    'next/link': () => null,
    '@/components/eb/EbToastProvider': { useEbToast: () => ({ showError: () => undefined }) },
  })

const autosaveHook = load<Record<string, unknown>>('src/hooks/useAutosaveQueue.ts', {})
const uploadStorage = load<Record<string, unknown>>('src/lib/eb/noteImageUploadQueue.ts', {})
const uploadHook = load<Record<string, unknown>>('src/hooks/useEbNoteImageUploadQueue.ts', {
  '@/lib/eb/noteImageUploadQueue': uploadStorage,
})
const mainReview = load<{
  default: ComponentType<{ initialRound: EbInspectionReport; initialDisciplineId: string | null }>
  buildInspectionDetailsForm: (inspection: EbInspectionReport['inspection']) => Record<string, unknown>
  ReviewInspectionFields: ComponentType<{
    sectionKey: string; form: Record<string, unknown>; inspectionId: string; disabled: boolean;
    preliminaryInspection: boolean; supportsFinalDecision: boolean;
    onChange: (field: string, value: unknown) => void; onTextSave: (field: string, value: string) => Promise<void>
  }>
}>(
  'src/components/eb/EbInspectionRoundClient.tsx', {
    ...rendererDependencies,
    'next/link': ({ children, ...props }: { children: ReactNode }) => createElement('a', props, children),
    'next/navigation': { useRouter: () => ({}), usePathname: () => '/eb/projects/project/inspections/inspection/perform' },
    '@/components/Protected': ({ children }: { children: ReactNode }) => children,
    '@/components/ob/DebouncedTextarea': debouncedTextarea,
    '@/components/eb/EbToastProvider': { useEbToast: () => ({ showError: () => undefined }) },
    '@/hooks/useAutosaveQueue': autosaveHook, '@/hooks/useEbNoteImageUploadQueue': uploadHook,
  }, ['buildInspectionDetailsForm', 'ReviewInspectionFields'])

function renderMainReview(report: EbInspectionReport) {
  return renderToStaticMarkup(createElement(mainReview.default, { initialRound: report, initialDisciplineId: null }))
}

function writeReviewFixture(html: string) {
  const outputPath = process.env.EB_REVIEW_FIXTURE_HTML
  if (!outputPath) return
  const chunks = new URL('../.next/static/chunks/', import.meta.url)
  const css = readdirSync(chunks).filter(name => name.endsWith('.css'))
    .map(name => readFileSync(new URL(name, chunks), 'utf8')).join('\n')
  writeFileSync(outputPath, `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>EB Granska – testdata</title><style>${css}</style></head><body>${html}</body></html>`)
}

// The autosave callback closes over endpoints and UI state. Exercise that real
// callback with a captured HTTP boundary instead of reproducing its payload.
function reviewAutosaveService() {
  const ast = ts.createSourceFile('review.tsx', read('src/components/eb/EbInspectionRoundClient.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let callback: ts.Expression | undefined
  const findCallback = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'saveReviewAutosavePatch' &&
        node.initializer && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]
    ts.forEachChild(node, findCallback)
  }
  findCallback(ast)
  assert.ok(callback)
  const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name &&
    ['booleanFromSelect', 'participantPayload'].includes(node.name.text))
  const requests: Array<{ path: string; method: string; body: Record<string, unknown> }> = []
  const dependencies = {
    inspectionBasePath: '/inspection', invitationPath: '/invitation',
    setInspectionSaving: () => undefined, setParticipantsSaving: () => undefined,
    fetch: async (path: string, options: { method: string; body: string }) => {
      requests.push({ path, method: options.method, body: JSON.parse(options.body) })
      return Response.json({ project: {}, participants: [] })
    },
  }
  const source = `${helpers.map(node => node.getText(ast)).join('\n')}\nconst save = ${callback.getText(ast)};`
  const save = new Function(...Object.keys(dependencies), `${compile(source)}; return save;`)(
    ...Object.values(dependencies)
  ) as (payload: Record<string, unknown>) => Promise<unknown>
  return { save, requests }
}

test('Granska displays inclusion checkboxes without status menus, editable summons and read-only factual content', () => {
  const f = fixture()
  const render = (disabled: boolean) => renderToStaticMarkup(createElement(reviewEditor.ReportDraftSectionsEditor, {
    sections: [f.section('summons'), f.section('inspection_time')], inspectionId: 'inspection', disabled,
    resettingSectionKey: null, onSectionChange: () => undefined,
    onSectionTextSave: async () => undefined, onResetSection: async () => undefined,
  }))
  const html = render(false)
  assert.equal((html.match(/Ta med i utlåtandet/g) ?? []).length, 2)
  assert.equal((html.match(/type="checkbox"/g) ?? []).length, 2)
  assert.doesNotMatch(html, /<select\b/)
  assert.equal((html.match(/<textarea\b/g) ?? []).length, 1)
  assert.match(html, /<textarea[^>]*aria-label="Text för Sättet för kallelse"[^>]*>/)
  assert.doesNotMatch(html, /<textarea[^>]*(disabled|readOnly)/)
  assert.match(html, /Sakuppgifter/)
  assert.match(html, /Datum: 2026-09-03/)
  assert.match(render(true), /<textarea[^>]*disabled=""/)
})

test('the alternate draft editor also offers free summons prose and no per-section status selector', () => {
  const f = fixture()
  for (const key of ['summons', 'inspection_time']) {
    const report = f.report()
    report.reportDraft.sections = [f.section(key)]
    const html = renderToStaticMarkup(createElement(legacyEditor.default, { initialReport: report }))
    assert.ok(html.includes('Ta med i utlåtandet'))
    assert.doesNotMatch(html, /<option[^>]*value="(?:draft|complete|missing|not_applicable)"/)
    if (key === 'summons') {
      assert.match(html, /<textarea[^>]*aria-label="Text för Sättet för kallelse"[^>]*>/)
    } else {
      assert.doesNotMatch(html, /<textarea[^>]*aria-label="Text för Tid för besiktningen"/)
      assert.match(html, /Datum: 2026-09-03/)
    }
  }
})

test('saving visible inspection fields preserves data belonging to removed duplicate or conditional controls', async () => {
  const f = fixture()
  Object.assign(f.live.inspection, {
    warrantyPeriodYears: 5, inspectionCostDistribution: 'Ursprunglig kostnadsuppgift',
    afterInspectionRequested: false, afterInspectionRequestedBy: 'client', afterInspectionDueDate: '2026-10-01',
  })
  const form = { ...mainReview.buildInspectionDetailsForm(f.live.inspection), inspectionTime: '11:30' }
  const s = reviewAutosaveService()
  await s.save({ kind: 'inspection', form })
  assert.equal(s.requests.length, 1)
  assert.equal(s.requests[0].method, 'PATCH')
  assert.equal(s.requests[0].body.inspectionTime, '11:30')
  assert.equal(s.requests[0].body.warrantyPeriodYears, 5)
  assert.equal(s.requests[0].body.inspectionCostDistribution, 'Ursprunglig kostnadsuppgift')
  assert.equal(s.requests[0].body.afterInspectionRequested, false)
  assert.equal(s.requests[0].body.afterInspectionRequestedBy, 'client')
  assert.equal(s.requests[0].body.afterInspectionDueDate, '2026-10-01')
})

test('review participant edits submit no invitation subject or email text, even if a stale caller includes them', async () => {
  const s = reviewAutosaveService()
  await s.save({ kind: 'participants', subject: 'Gammalt ämne', body: 'Gammal mejltext', participants: [
    { id: 'participant', personName: 'Deltagare', attended: true, receivesInvitation: true, receivesReport: true, sortOrder: 100 },
  ] })
  assert.equal(s.requests.length, 1)
  assert.equal(s.requests[0].path, '/invitation')
  assert.equal(s.requests[0].method, 'PATCH')
  assert.deepEqual(Object.keys(s.requests[0].body), ['participants'])
  const participants = s.requests[0].body.participants as Array<Record<string, unknown>>
  assert.equal(participants[0].personName, 'Deltagare')
  assert.equal(participants[0].attended, true)
})

test('after-inspection details appear only for a requested after-inspection without clearing hidden values', () => {
  const f = fixture()
  for (const requested of [null, false, true]) {
    Object.assign(f.live.inspection, { afterInspectionRequested: requested,
      afterInspectionRequestedBy: 'client', afterInspectionDueDate: '2026-10-01', afterInspectionNoticeInReport: true })
    const form = mainReview.buildInspectionDetailsForm(f.live.inspection)
    const html = renderToStaticMarkup(createElement(mainReview.ReviewInspectionFields, {
      sectionKey: 'remedy_deadline', form, inspectionId: 'inspection', disabled: false,
      preliminaryInspection: false, supportsFinalDecision: true,
      onChange: () => undefined, onTextSave: async () => undefined,
    }))
    assert.ok(html.includes('Efterbesiktning påkallad'))
    for (const label of ['Efterbesiktning påkallad av', 'Efterbesiktning senast', 'Utlåtandet gäller som kallelse till efterbesiktning']) {
      assert.equal(html.includes(label), requested === true, `${label}: requested=${requested}`)
    }
    assert.equal(form.afterInspectionDueDate, '2026-10-01')
    assert.equal(form.afterInspectionRequestedBy, 'client')
  }
})

test('resetting the remedy start text ignores retained notice details when no after-inspection is requested', async () => {
  const f = fixture()
  Object.assign(f.live.inspection, {
    afterInspectionRequested: false,
    afterInspectionNoticeInReport: true,
    afterInspectionRequestedBy: 'client',
    afterInspectionDueDate: '2026-10-01',
  })
  const ownText = 'Parterna återkommer med besked om eventuell efterbesiktning.'
  await f.save('remedy_deadline', ownText)
  assert.equal(f.section('remedy_deadline').text, ownText)
  await f.reset('remedy_deadline')
  assert.match(f.section('remedy_deadline').text, /Efterbesiktning har inte påkallats/)
  assert.doesNotMatch(f.section('remedy_deadline').text, /Denna notering gäller som kallelse|2026-10-01/)
  assert.equal(f.live.inspection.afterInspectionNoticeInReport, true)
  f.live.inspection.afterInspectionRequested = true
  await f.reset('remedy_deadline')
  assert.match(f.section('remedy_deadline').text, /Denna notering gäller som kallelse/)
  assert.match(f.section('remedy_deadline').text, /2026-10-01/)
})

test('the complete review page presents each prose editor and factual form once in its report section', async () => {
  const f = fixture()
  f.live.project.propertyDesignation = 'EXEMPELVILLAN 1'
  f.live.project.address = 'Exempelvägen 1'
  f.live.inspection.warrantyPeriodYears = 5
  await f.save('summons', customerSummons)
  await f.save('inspection_cost_distribution', 'Beställaren svarar för besiktningskostnaden.')
  const html = renderMainReview(await f.api.getEbInspectionReport(f.input))
  writeReviewFixture(html)
  const editors = [...html.matchAll(/<textarea[^>]*aria-label="Text för ([^"]+)"/g)].map(match => match[1])
  assert.equal(editors.length, new Set(editors).size, 'A section has more than one prose editor')
  assert.ok(editors.includes('Sättet för kallelse'))
  assert.ok(editors.includes('Besiktningskostnadens fördelning'))
  assert.equal((html.match(/>Besiktningsdatum</g) ?? []).length, 1)
  assert.equal((html.match(/>Besiktningstid</g) ?? []).length, 1)
  assert.equal((html.match(/>Beslut</g) ?? []).length, 1)
  assert.equal((html.match(/>Besiktningskostnadens fördelning</g) ?? []).length, 1)
  assert.doesNotMatch(html, />Ämne<|>Kallelsetext<|>Garantitid \(år\)</)
  assert.doesNotMatch(html, /id="eb-review-(warranty_end|after_inspection)"/)
  for (const key of ['defects_appendices', 'marker_legend', 'deduction', 'notes', 'distribution_list', 'signature_certificate']) {
    assert.equal((html.match(new RegExp(`id="eb-review-${key}"`, 'g')) ?? []).length, 1, key)
  }
  const defectsStart = html.indexOf('id="eb-review-defects_appendices"')
  const nextSection = html.indexOf('id="eb-review-special_investigation"')
  for (const key of ['marker_legend', 'deduction', 'notes']) {
    const childIndex = html.indexOf(`id="eb-review-${key}"`)
    assert.ok(childIndex > defectsStart && childIndex < nextSection, `${key} is not grouped with defects`)
  }
  assert.ok(html.indexOf('id="eb-review-signature_certificate"') > html.indexOf('id="eb-review-distribution_list"'))
})
