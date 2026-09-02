import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS,
  FLOW_AI_DEFAULT_REASONING_EFFORT,
  FLOW_AI_MAX_MAX_OUTPUT_TOKENS,
  FLOW_AI_MAX_PROPOSED_CHANGES,
  FLOW_AI_MAX_PROPOSED_SOURCES,
  FLOW_AI_MAX_TEST_SCENARIOS,
  FLOW_AI_MIN_MAX_OUTPUT_TOKENS,
  buildFlowAiDeterministicDiff,
  buildFlowAiTerminalError,
  fingerprintFlowAiSnapshot,
  normalizeFlowAiIncompleteReason,
  normalizeFlowAiJobMetadata,
  normalizeFlowAiMode,
  normalizeFlowAiProviderStatus,
  normalizeFlowAiResponseId,
  normalizeFlowAiSnapshot,
  normalizeFlowAiTokenUsage,
  resolveFlowAiGenerationConfig,
  stableStringifyFlowAiSnapshot,
  validateFlowAiProposal,
  type FlowAiCandidateChange,
  type FlowAiSnapshot,
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
} from '../src/lib/renoapp/flowAi.ts'

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

test('changes the optimistic-lock fingerprint when the canonical flow changes', async () => {
  const before = makeSnapshot({
    actionTypes: [{ id: 'action-1', key: 'electrical', label: 'El' }],
  })
  const after = makeSnapshot({
    actionTypes: [{ id: 'action-1', key: 'electrical', label: 'Arbete med el-anläggning' }],
  })

  assert.notEqual(
    await fingerprintFlowAiSnapshot(before),
    await fingerprintFlowAiSnapshot(after)
  )
})

test('accepts only canonical OpenAI response ids', () => {
  assert.equal(normalizeFlowAiResponseId('resp_1234abcd'), 'resp_1234abcd')
  assert.equal(normalizeFlowAiResponseId('resp_job-1234_abcd'), 'resp_job-1234_abcd')

  for (const value of [
    null,
    '',
    'resp_short',
    'response_1234abcd',
    'resp_1234abcd/../../secrets',
    'resp_1234abcd?include=all',
    `resp_${'a'.repeat(201)}`,
    'resp_åäö12345678',
  ]) {
    assert.throws(() => normalizeFlowAiResponseId(value), /FLOW_AI_RESPONSE_ID_INVALID/)
  }
})

test('recognizes every provider terminal status and rejects unknown states', () => {
  const pending = ['queued', 'in_progress'] as const
  const terminal = ['completed', 'failed', 'incomplete', 'cancelled'] as const

  for (const status of [...pending, ...terminal]) {
    assert.equal(normalizeFlowAiProviderStatus(status), status)
  }
  for (const status of ['processing', 'canceled', 'expired', 'requires_action', null]) {
    assert.throws(() => normalizeFlowAiProviderStatus(status), /FLOW_AI_PROVIDER_STATUS_INVALID/)
  }
})

test('resolves only bounded output-token budgets and allowlisted reasoning effort', () => {
  assert.deepEqual(resolveFlowAiGenerationConfig(), {
    maxOutputTokens: FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS,
    reasoningEffort: FLOW_AI_DEFAULT_REASONING_EFFORT,
  })
  assert.deepEqual(resolveFlowAiGenerationConfig({
    maxOutputTokens: String(FLOW_AI_MIN_MAX_OUTPUT_TOKENS),
    reasoningEffort: 'low',
  }), {
    maxOutputTokens: FLOW_AI_MIN_MAX_OUTPUT_TOKENS,
    reasoningEffort: 'low',
  })
  assert.deepEqual(resolveFlowAiGenerationConfig({
    maxOutputTokens: FLOW_AI_MAX_MAX_OUTPUT_TOKENS,
    reasoningEffort: 'high',
  }), {
    maxOutputTokens: FLOW_AI_MAX_MAX_OUTPUT_TOKENS,
    reasoningEffort: 'high',
  })

  const malformedBudgets: unknown[] = [
    null,
    '',
    'not-a-number',
    FLOW_AI_MIN_MAX_OUTPUT_TOKENS - 1,
    FLOW_AI_MAX_MAX_OUTPUT_TOKENS + 1,
    FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS + 0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    [FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS],
    { valueOf: () => FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS },
    Symbol('invalid-budget'),
  ]
  for (const maxOutputTokens of malformedBudgets) {
    assert.deepEqual(resolveFlowAiGenerationConfig({
      maxOutputTokens,
      reasoningEffort: 'maximum',
    }), {
      maxOutputTokens: FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS,
      reasoningEffort: FLOW_AI_DEFAULT_REASONING_EFFORT,
    })
  }
})

test('allowlists incomplete reasons and strips provider-controlled diagnostic text', () => {
  assert.equal(normalizeFlowAiIncompleteReason('max_output_tokens'), 'max_output_tokens')
  assert.equal(normalizeFlowAiIncompleteReason('content_filter'), 'content_filter')

  const untrustedValues: unknown[] = [
    'server_error',
    'max_output_tokens: sk-live-secret',
    '<script>alert(1)</script>',
    { reason: 'max_output_tokens', providerMessage: 'internal detail' },
    null,
  ]
  for (const value of untrustedValues) {
    assert.equal(normalizeFlowAiIncompleteReason(value), 'unknown')
  }

  const diagnostics = normalizeFlowAiTokenUsage({
    input_tokens: 123,
    output_tokens: 456,
    total_tokens: 579,
    output_tokens_details: {
      reasoning_tokens: 321,
      provider_message: 'sk-live-secret',
    },
    error: { message: '<script>alert(1)</script>' },
  })
  assert.deepEqual(diagnostics, {
    inputTokens: 123,
    outputTokens: 456,
    reasoningTokens: 321,
    totalTokens: 579,
  })
  assert.doesNotMatch(JSON.stringify(diagnostics), /sk-live-secret|script|provider_message/u)
})

test('distinguishes output-budget exhaustion without leaking provider text', () => {
  const generationConfig = resolveFlowAiGenerationConfig()
  const maxOutputTokens = buildFlowAiTerminalError({
    status: 'incomplete',
    incompleteReason: 'max_output_tokens',
    usage: {
      input_tokens: 100,
      output_tokens: generationConfig.maxOutputTokens,
      total_tokens: generationConfig.maxOutputTokens + 100,
      output_tokens_details: { reasoning_tokens: 40_000 },
    },
    generationConfig,
  })
  const unknownReason = buildFlowAiTerminalError({
    status: 'incomplete',
    incompleteReason: 'internal_provider_detail: sk-live-secret',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      total_tokens: 300,
      provider_message: '<script>alert(1)</script>',
    },
    generationConfig,
  })
  const failed = buildFlowAiTerminalError({
    status: 'failed',
    incompleteReason: 'provider_error: sk-live-secret',
    usage: { error: { code: 'secret_provider_code', message: 'sensitive detail' } },
    generationConfig,
  })

  assert.equal(maxOutputTokens.diagnostics.reason, 'max_output_tokens')
  assert.match(maxOutputTokens.message, /tokenbudget/u)
  assert.equal(unknownReason.diagnostics.reason, 'unknown')
  assert.notEqual(unknownReason.message, maxOutputTokens.message)
  assert.equal(failed.diagnostics.reason, 'unknown')
  assert.deepEqual(failed.diagnostics, {
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null,
    maxOutputTokens: FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS,
    reasoningEffort: FLOW_AI_DEFAULT_REASONING_EFFORT,
    reason: 'unknown',
  })

  for (const error of [maxOutputTokens, unknownReason, failed]) {
    assert.doesNotMatch(
      JSON.stringify(error),
      /sk-live-secret|script|provider_message|secret_provider_code|sensitive detail/u
    )
  }
})

test('rejects malformed or unsafe token counters instead of coercing them', () => {
  const invalidCounters = [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
    '123',
    { valueOf: () => 123 },
  ]

  for (const value of invalidCounters) {
    assert.deepEqual(normalizeFlowAiTokenUsage({
      input_tokens: value,
      output_tokens: value,
      total_tokens: value,
      output_tokens_details: { reasoning_tokens: value },
    }), {
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    })
  }
})

test('caps proposal collections during deterministic parsing', () => {
  const sourceUrls = Array.from(
    { length: FLOW_AI_MAX_PROPOSED_SOURCES + 1 },
    (_, index) => `https://www.elsakerhetsverket.se/flow-ai-source-${index}`
  )
  const proposal = validateFlowAiProposal({
    snapshot: makeSnapshot(),
    requestedMode: 'create',
    retrievedAt: '2026-09-02T12:00:00.000Z',
    retrievedSourceUrls: sourceUrls,
    rawProposal: {
      mode: 'create',
      summary: 'Avgränsat förslag.',
      warnings: Array.from({ length: 21 }, (_, index) => `Varning ${index}`),
      candidateChanges: Array.from(
        { length: FLOW_AI_MAX_PROPOSED_CHANGES + 1 },
        (_, index) => ({
          changeId: `change-${index}`,
          requestedOperation: 'add',
          entityType: 'action_type',
          semanticKey: `flow-${index}`,
          parentSemanticKey: null,
          title: `Flöde ${index}`,
          reason: 'Testar parserns hårda gräns.',
          risk: 'low',
          fieldsJson: JSON.stringify({ label: `Flöde ${index}`, isActive: true }),
          sourceIds: ['source-0'],
          requiresExpertReview: false,
        })
      ),
      sources: sourceUrls.map((url, index) => ({
        sourceId: `source-${index}`,
        title: `Källa ${index}`,
        publisher: 'Elsäkerhetsverket',
        url,
        sourceType: 'authority_guidance',
        reference: null,
        effectiveDate: null,
        claim: 'Verifierad testkälla.',
      })),
      testScenarios: Array.from(
        { length: FLOW_AI_MAX_TEST_SCENARIOS + 1 },
        (_, index) => ({
          scenarioId: `scenario-${index}`,
          title: `Scenario ${index}`,
          description: 'Kontrollerar svarstak.',
          answers: [],
          expectedDocumentKeys: [],
          expectedParticipantKeys: [],
          expectedReviewFlagKeys: [],
        })
      ),
    },
  })

  assert.equal(proposal.changes.length, FLOW_AI_MAX_PROPOSED_CHANGES)
  assert.equal(proposal.sources.length, FLOW_AI_MAX_PROPOSED_SOURCES)
  assert.equal(proposal.testScenarios.length, FLOW_AI_MAX_TEST_SCENARIOS)
  assert.equal(proposal.warnings.length, 20)
})

test('normalizes complete signed job metadata and rejects malformed bindings', () => {
  const hash = 'a'.repeat(64)
  const metadata = {
    app: 'renoapp_flow_ai',
    schema: '2',
    snapshot_fingerprint: `sha256:${'b'.repeat(64)}`,
    mode: 'review',
    target_action_id: 'action-1',
    target_action_key: 'electrical',
    admin_user_hash: hash,
    domains_hash: hash,
    instruction_hash: hash,
    max_output_tokens: String(FLOW_AI_DEFAULT_MAX_OUTPUT_TOKENS),
    reasoning_effort: FLOW_AI_DEFAULT_REASONING_EFFORT,
    started_at: '2026-09-02T12:00:00.000Z',
    nonce: 'nonce-1',
    signature: hash,
  }

  assert.deepEqual(normalizeFlowAiJobMetadata(metadata), metadata)

  for (const invalidMetadata of [
    null,
    { ...metadata, app: 'another_app' },
    { ...metadata, schema: '1' },
    { ...metadata, snapshot_fingerprint: hash },
    { ...metadata, mode: 'processing' },
    { ...metadata, target_action_id: '' },
    { ...metadata, mode: 'create', target_action_id: 'action-1', target_action_key: 'electrical' },
    { ...metadata, mode: 'review', target_action_id: '-', target_action_key: '-' },
    { ...metadata, admin_user_hash: 'not-a-hash' },
    { ...metadata, max_output_tokens: String(FLOW_AI_MIN_MAX_OUTPUT_TOKENS - 1) },
    { ...metadata, max_output_tokens: String(FLOW_AI_MAX_MAX_OUTPUT_TOKENS + 1) },
    { ...metadata, max_output_tokens: '64000.5' },
    { ...metadata, reasoning_effort: 'maximum' },
    { ...metadata, started_at: 'not-a-date' },
    { ...metadata, signature: '0'.repeat(63) },
  ]) {
    assert.throws(
      () => normalizeFlowAiJobMetadata(invalidMetadata),
      /FLOW_AI_RESPONSE_METADATA_INVALID/
    )
  }
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
