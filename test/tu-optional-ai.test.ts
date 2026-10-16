import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires explicit extensions.
import * as finalization from '../src/lib/tu/finalization.ts'
// @ts-expect-error Node strip-types requires explicit extensions.
import * as quality from '../src/lib/tu/reportQuality.ts'
// @ts-expect-error Node strip-types requires explicit extensions.
import { deriveTuWorkflowSteps, type TuWorkflowSource } from '../src/lib/tu/workflow.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const section = (text = 'Manuellt skriven och granskad text.') => ({ key: 'summary', title: 'Sammanfattning', text, isRequired: true })

function loadGate(qualityBlocker: string | null = null) {
  const source = read('src/app/api/tu/investigations/[inspectionId]/report-delivery/route.ts')
  const code = ts.transpileModule(source + '\nexport { getFinalizationBlocker };', {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const imports: Record<string, unknown> = {
    '@/lib/tu/authoring': { usesTuAiAssistedWorkflow: () => true },
    '@/lib/tu/finalization': finalization,
    '@/lib/tu/reportQuality': { ...quality, evaluateTuReportQuality: () => qualityBlocker ? [{ severity: 'blocker', message: qualityBlocker }] : [] },
    '@/lib/tu/evidence': { TU_MOISTURE_DAMAGE_TEMPLATE_KEY: 'moisture' },
    '@/lib/tu/workflowProfiles': { TU_POST_DAMAGE_REVIEW_TEMPLATE_KEY: 'post_damage' },
    '@/lib/tu/evidenceServer': { listTuObservations: async () => [] },
    '@/lib/tu/server': { listTuInvestigationImages: async () => [] },
  }
  const loaded = { exports: {} as { getFinalizationBlocker: (...args: unknown[]) => Promise<string | null> } }
  new Function('require', 'module', 'exports', code)((name: string) => imports[name] ?? {}, loaded, loaded.exports)
  return loaded.exports.getFinalizationBlocker
}

test('actual delivery gate accepts manual text without any AI run and never writes or generates', async () => {
  const gate = loadGate()
  const investigation = { orgId: 'org', inspectionId: 'inspection', reportTemplateKey: 'moisture', reportAuthoringMode: 'ai_assisted', reportDraft: { sections: [section()] } }
  const original = structuredClone(investigation)
  const admin = { from: () => assert.fail('No database writes or generation allowed') }
  for (const state of [null, { status: 'in_progress' }, { status: 'analysis_ready' }, { status: 'analysis_failed' }, { status: 'analysis_approved' }]) {
    assert.equal(await gate(admin, investigation, false, state), null)
  }
  assert.deepEqual(investigation, original)
})

test('manual delivery retains required content, quality and source review gates', async () => {
  const investigation = { reportTemplateKey: 'moisture', reportDraft: { sections: [section('')] } }
  assert.match(await loadGate()({}, investigation, false, null) ?? '', /Sammanfattning/)
  investigation.reportDraft.sections = [section()]
  assert.equal(await loadGate('Rätta uppgiften.')({}, investigation, false, null), 'Rätta uppgiften.')
  const stale = { status: 'in_progress', analysisStaleAt: 'source-v2' }
  assert.match(await loadGate()({}, investigation, false, stale) ?? '', /Underlaget har ändrats/)
  assert.equal(await loadGate()({}, investigation, true, stale), null)
  assert.equal(finalization.isTuStaleAnalysisAcknowledgementCurrent({ state: stale, acknowledgedAnalysisStaleAt: 'source-v1' }), false)
})

test('optional empty sections and generated signature do not block manual text', () => {
  assert.equal(quality.getTuRequiredReportSectionsBlocker([
    section(), { ...section(''), key: 'optional', isRequired: false },
    { ...section(''), key: 'signature' }, { ...section(''), key: 'assignment_parties' },
    { ...section(''), subsections: [{ text: 'Text under underrubrik.' }] },
  ]), null)
})

test('manual text is reviewable independently of failed, cancelled or incomplete AI proposals', () => {
  const base: TuWorkflowSource = { workflowProfile: 'field_report', preparation: null, validation: null,
    workflow: null, reportDraft: null, delivery: null, queue: { total: 0, failed: 0 }, reportSectionCount: 2, reportFilledSectionCount: 2 }
  for (const status of ['failed', 'cancelled', 'processing', 'completed']) {
    const source = { ...base, reportDraft: { run: { status }, sections: [] } } as unknown as TuWorkflowSource
    const steps = deriveTuWorkflowSteps(source)
    assert.equal(steps.find(step => step.id === 'report')?.status, 'complete')
    assert.equal(steps.find(step => step.id === 'report')?.blockerCount, 0)
    assert.match(steps.find(step => step.id === 'assessment')?.statusText ?? '', /Valfritt/)
  }
  assert.equal(deriveTuWorkflowSteps(base).find(step => step.id === 'report')?.blockerCount, 0)
  assert.match(deriveTuWorkflowSteps({ ...base, reportFilledSectionCount: 0 }).find(step => step.id === 'report')?.statusText ?? '', /Skriv eller granska/)
})

test('delivery UI no longer gates on AI steps or skips unsaved-content checks for stale sources', () => {
  const editor = read('src/components/tu/TuInvestigationEditorClient.tsx')
  const gate = editor.slice(editor.indexOf('const finalizationBlockedReason ='), editor.indexOf('const handleDeliveryStatusChange ='))
  assert.doesNotMatch(gate, /assessmentStep|workflowState\.steps/)
  assert.match(gate, /getTuRequiredReportSectionsBlocker\(draft.sections\)/)
  assert.match(gate, /autosave.status === 'saving'/)
  assert.match(gate, /autosave.status === 'error'/)
  assert.match(editor, /Klar med granskningen/)
  assert.doesNotMatch(read('src/components/tu/TuPrintActions.tsx'), /analysisStale \? null : finalizationBlockedReason/)
  assert.match(read('src/components/tu/TuPrintActions.tsx'), /setStaleAnalysisAcknowledged\(false\)\s*\}, \[meta\?\.analysisStale, meta\?\.analysisStaleAt\]\)/)
})
