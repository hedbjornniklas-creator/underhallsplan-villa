import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { buildFlowAiDeterministicDiff, fingerprintFlowAiSnapshot, normalizeFlowAiMode, normalizeFlowAiSnapshot, stableStringifyFlowAiSnapshot, validateFlowAiProposal, type FlowAiCandidateChange, type FlowAiSnapshot } from '../src/lib/renoapp/flowAi.ts'

function makeSnapshot(overrides: Partial<FlowAiSnapshot> = {}): FlowAiSnapshot {
  return {
    schemaVersion: 1,
    actionTypes: [],
    questions: [],
    documentTypes: [],
    participantRoles: [],
    reviewFlags: [],
    requirementGroups: [],
    questionGroups: [],
    participantGroups: [],
    reviewFlagLinks: [],
    ...overrides,
  }
}

test('serializes equivalent flow snapshots deterministically', async () => {
  const first = makeSnapshot({
    actionTypes: [{ label: 'El', key: 'electrical', nested: { z: 2, a: 1 } }],
  })
  const second = {
    reviewFlagLinks: [],
    participantGroups: [],
    questionGroups: [],
    requirementGroups: [],
    reviewFlags: [],
    participantRoles: [],
    documentTypes: [],
    questions: [],
    actionTypes: [{ nested: { a: 1, z: 2 }, key: 'electrical', label: 'El' }],
    schemaVersion: 1 as const,
  }

  assert.equal(stableStringifyFlowAiSnapshot(first), stableStringifyFlowAiSnapshot(second))
  assert.equal(await fingerprintFlowAiSnapshot(first), await fingerprintFlowAiSnapshot(second))
  assert.match(await fingerprintFlowAiSnapshot(first), /^sha256:[a-f0-9]{64}$/)
})

test('rejects incomplete snapshots before they reach the model', () => {
  assert.throws(
    () => normalizeFlowAiSnapshot({ schemaVersion: 1, actionTypes: [] }),
    /FLOW_AI_SNAPSHOT_INVALID/
  )
})

test('infers review and extension modes from Swedish admin instructions', () => {
  assert.equal(normalizeFlowAiMode(undefined, 'Granska arbete med el-anläggning', 'action-1'), 'review')
  assert.equal(normalizeFlowAiMode(undefined, 'Lägg till kontroll av elcentral', 'action-1'), 'extend')
  assert.equal(normalizeFlowAiMode(undefined, 'Installera hiss i lägenheten', null), 'create')
  assert.equal(normalizeFlowAiMode('review', 'Lägg till något', null), 'review')
})

test('turns an AI add request into an update when the semantic key already exists', () => {
  const snapshot = makeSnapshot({
    actionTypes: [{ id: 'action-1', key: 'electrical', label: 'El', isActive: true }],
  })
  const candidates: FlowAiCandidateChange[] = [{
    changeId: 'change-1',
    requestedOperation: 'add',
    entityType: 'action_type',
    semanticKey: 'electrical',
    parentSemanticKey: null,
    title: 'Förtydliga benämningen',
    reason: 'Benämningen ska beskriva hela elanläggningen.',
    risk: 'low',
    fieldsJson: JSON.stringify({ label: 'Arbete med el-anläggning' }),
    sourceIds: ['source-1'],
    requiresExpertReview: false,
  }]

  const result = buildFlowAiDeterministicDiff({ snapshot, candidates })

  assert.equal(result.issues.length, 0)
  assert.equal(result.changes.length, 1)
  assert.equal(result.changes[0]?.operation, 'update')
  assert.equal(result.changes[0]?.targetId, 'action-1')
  assert.deepEqual(JSON.parse(result.changes[0]?.afterJson ?? '{}'), {
    id: 'action-1',
    isActive: true,
    key: 'electrical',
    label: 'Arbete med el-anläggning',
  })
})

test('blocks a mandatory flow requirement when its source was not retrieved', () => {
  const snapshot = makeSnapshot({
    actionTypes: [{ id: 'action-1', key: 'electrical', label: 'El' }],
    documentTypes: [{ id: 'document-1', key: 'electrical_documentation', label: 'Dokumentation' }],
  })
  const sourceUrl = 'https://www.elsakerhetsverket.se/privatpersoner/'
  const proposal = validateFlowAiProposal({
    snapshot,
    requestedMode: 'review',
    targetActionKey: 'electrical',
    retrievedAt: '2026-09-02T10:00:00.000Z',
    retrievedSourceUrls: [],
    rawProposal: {
      mode: 'review',
      summary: 'Komplettera elflödet.',
      warnings: [],
      candidateChanges: [{
        changeId: 'change-1',
        requestedOperation: 'add',
        entityType: 'action_document_link',
        semanticKey: 'electrical_documentation',
        parentSemanticKey: 'electrical',
        title: 'Kräv dokumentation',
        reason: 'Dokumentation behövs efter utfört arbete.',
        risk: 'medium',
        fieldsJson: JSON.stringify({ isRequired: true, phase: 'after_completion', isActive: true }),
        sourceIds: ['source-1'],
        requiresExpertReview: false,
      }],
      sources: [{
        sourceId: 'source-1',
        title: 'Dokumentation och märkning',
        publisher: 'Elsäkerhetsverket',
        url: sourceUrl,
        sourceType: 'authority_guidance',
        reference: null,
        effectiveDate: null,
        claim: 'Dokumentation ska överlämnas efter arbetet.',
      }],
      testScenarios: [],
    },
  })

  assert.equal(proposal.canApply, false)
  assert.ok(proposal.validationIssues.some((issue) => issue.code === 'SOURCE_NOT_RETRIEVED'))
  assert.ok(proposal.validationIssues.some(
    (issue) => issue.code === 'MANDATORY_REQUIREMENT_WITHOUT_VERIFIED_SOURCE'
  ))
})

test('accepts a source-grounded mandatory requirement after deterministic validation', () => {
  const snapshot = makeSnapshot({
    actionTypes: [{ id: 'action-1', key: 'electrical', label: 'El' }],
    documentTypes: [{ id: 'document-1', key: 'electrical_documentation', label: 'Dokumentation' }],
  })
  const sourceUrl = 'https://www.elsakerhetsverket.se/privatpersoner/'
  const proposal = validateFlowAiProposal({
    snapshot,
    requestedMode: 'review',
    targetActionKey: 'electrical',
    retrievedAt: '2026-09-02T10:00:00.000Z',
    retrievedSourceUrls: [sourceUrl],
    rawProposal: {
      mode: 'review',
      summary: 'Komplettera elflödet.',
      warnings: [],
      candidateChanges: [{
        changeId: 'change-1',
        requestedOperation: 'add',
        entityType: 'action_document_link',
        semanticKey: 'electrical_documentation',
        parentSemanticKey: 'electrical',
        title: 'Kräv dokumentation',
        reason: 'Dokumentation behövs efter utfört arbete.',
        risk: 'medium',
        fieldsJson: JSON.stringify({ isRequired: true, phase: 'after_completion', isActive: true }),
        sourceIds: ['source-1'],
        requiresExpertReview: false,
      }],
      sources: [{
        sourceId: 'source-1',
        title: 'Dokumentation och märkning',
        publisher: 'Elsäkerhetsverket',
        url: sourceUrl,
        sourceType: 'authority_guidance',
        reference: null,
        effectiveDate: null,
        claim: 'Dokumentation ska överlämnas efter arbetet.',
      }],
      testScenarios: [],
    },
  })

  assert.equal(proposal.canApply, true)
  assert.equal(proposal.validationIssues.length, 0)
  assert.equal(proposal.changes[0]?.validationStatus, 'valid')
  assert.equal(proposal.sources[0]?.verified, true)
})
