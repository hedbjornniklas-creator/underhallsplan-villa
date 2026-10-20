import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
// @ts-expect-error Native Node tests use explicit TypeScript extensions.
import { applyEbInspectionReusePlan, assertEbInspectionReuseEligible, assertEbInspectionReuseReport, buildEbInspectionReusePlan, parseEbInspectionReuseSource } from '../src/lib/eb/inspectionReuse.ts'
import type { CreateEbInspectionInput, EbInspectionReport, EbProjectListItem } from '../src/lib/eb/server'

const lockedAt = '2026-10-01T10:00:00Z'
const now = '2026-10-19T08:00:00Z'
type Row = Record<string, unknown>

function sourceFixture(): EbInspectionReport {
  const inspection = { inspectionId: 'source', projectId: 'project', variant: 'SLB', variantLabel: 'Slutbesiktning',
    sequenceNo: 1, status: 'completed', date: '2026-10-01', reportLockedAt: lockedAt,
    approvalStatus: 'not_approved', approvalNote: 'Gamla hinder', previousInspections: [],
    inspectorAppointedBy: 'client', defectNumberingExplanation: 'Egen förklaring', defectNoErrorPartsPolicy: 'not_listed',
    invoiceRecipientMatchesClient: false, invoiceName: 'Privat fakturamottagare', invoiceEmail: 'invoice@example.test',
    invitationDate: '2026-09-20', invitationSentAt: '2026-09-20T08:00:00Z', defaultRemedyDeadline: '2026-10-10',
    reportDistributionDate: '2026-10-02', warrantyPeriodYears: 2, warrantyEndDate: '2028-10-01',
  }
  const note = { id: 'note-a', projectId: 'project', inspectionId: 'source', disciplineId: 'discipline',
    noteNumber: 4, location: 'Bygg', room: 'Kök', placeDetail: 'Vägg', markerKey: 'E', statusKey: 'resolved',
    noteText: 'Spricka vid fönstret', remediationAssigneeId: 'contractor', responsibleParty: 'Byggfirman',
    tradeGroup: 'Bygg', investigationResponsibleParty: 'contractor', investigationResponsibleNote: 'Utred',
    investigationCostParty: 'contractor', investigationDueDate: '2026-10-10', deductionAmount: '1000', sortOrder: 400 }
  const section = { title: 'Rubrik', sbrPoint: null, source: 'manual', status: 'complete', isRelevant: true,
    contentMode: 'editable', updatedAt: lockedAt }
  return { project: { id: 'project', orgId: 'org', propertyId: 'property', title: 'Entreprenaden',
      status: 'active', inspections: [inspection], clientEmail: 'client@example.test', contractorEmail: 'builder@example.test', agreementItems: [] },
    inspection, disciplines: [{ id: 'discipline', key: 'bygg', label: 'Bygg', littera: 'BY SLB1', sortOrder: 10, isActive: true }],
    notes: [note, { ...note, id: 'note-b', noteNumber: 7, noteText: 'Dörren kärvar' }],
    images: [{ id: 'photo', inspectionId: 'source', noteId: 'note-a', filePath: 'source/eb-notes/a.jpg',
      thumbnailFilePath: 'source/eb-notes/thumb-a.jpg', label: 'Fönster', sortOrder: 10 },
      { id: 'photo', inspectionId: 'source', noteId: 'note-b', filePath: 'source/eb-notes/a.jpg',
      thumbnailFilePath: 'source/eb-notes/thumb-a.jpg', label: 'Fönster', sortOrder: 20 }],
    participants: [{ id: 'person', roleLabel: 'Entreprenör', companyName: 'Byggfirman', personName: 'Byggaren',
      email: 'builder@example.test', phone: '0700000000', attended: true, receivesInvitation: true,
      receivesReport: true, representsPartyKey: 'contractor', canRepresentParty: true, sortOrder: 20 }],
    checkpoints: [{ id: 'checkpoint', checkpointKey: 'window', templateKey: 'template', systemKey: 'generic',
      groupKey: 'walls', groupLabel: 'Väggar', title: 'Fönster', guidance: 'Kontrollera', verificationMethod: 'Visuellt',
      sourceUrl: null, photoRequired: true, status: 'deviation', comment: 'Tidigare avvikelse', noteId: 'note-a', sortOrder: 10 }],
    inspectionDocuments: [{ id: 'document', documentTypeId: 'document-type', title: 'Kvalitetsintyg', status: 'missing',
      documentDate: '2026-09-05', note: 'Tidigare dokumentkommentar' }],
    reportDraft: { schemaVersion: 2, templateKey: 'template', templateTitle: 'Min mall', templateVersion: 2,
      initializedAt: lockedAt, updatedAt: lockedAt, sourceSnapshot: { project: { invoiceName: 'secret' } },
      projectSourceRefreshBaseUpdatedAt: lockedAt,
      sections: ['scope', 'other_notes', 'marker_legend', 'summons', 'participants', 'approval_decision',
        'inspection_time', 'continued_final_inspection', 'warranty_end', 'remedy_deadline', 'after_inspection',
        'signature_certificate', 'distribution_list'].map(key => ({ ...section, key, text: `Sparad ${key}` })),
      noteHeadings: [{ id: 'heading', title: 'Kök', beforeNoteId: 'note-a', sortOrder: 10, updatedAt: lockedAt }] },
    branding: {}, markers: [], statuses: [], remediationAssignees: [], projectAttachments: [], suggestions: [],
  } as unknown as EbInspectionReport
}

function planFixture(includePreviousNotes = true, source = sourceFixture()) {
  let next = 0
  return buildEbInspectionReusePlan({ orgId: 'org', projectId: 'project', userId: 'user', targetInspectionId: 'target',
    targetSequenceNo: 2, source, privateInspection: source.inspection, participants: source.participants,
    noteSources: new Map([['note-a', { sourceSystem: 'eb_missing_document', sourceRecordId: 'document-type' }]]),
    includePreviousNotes, now, newId: () => `new-${++next}` })
}

test('reuse makes independent rows, remaps many-note photo/heading/checkpoint references and never changes the source', () => {
  const source = sourceFixture()
  const before = structuredClone(source)
  const plan = planFixture(true, source)
  const rows = (table: string) => plan.rows.find(group => group.table === table)!.rows
  const notes = rows('eb_notes')
  assert.equal(notes.length, 2)
  assert.equal(notes[0].status_key, 'open', 'ordinary editable notes, not an extra review workflow')
  assert.equal(notes[0].source_note_id, 'note-a')
  assert.equal(notes[0].note_number, 4)
  assert.equal(notes[0].investigation_due_date, null)
  assert.equal(notes[0].discipline_id, rows('eb_disciplines')[0].id)
  assert.equal(rows('eb_disciplines')[0].littera, 'BY SLB2')
  assert.deepEqual(notes[0].reuse_source, { inspectionId: 'source', inspectionDate: '2026-10-01', variant: 'SLB',
    sequenceNo: 1, noteId: 'note-a', noteNumber: 4 })
  assert.equal(notes[0].source_system, 'eb_missing_document')
  assert.equal(notes[0].source_record_id, 'document-type', 'auto-source key is DOCUMENT TYPE, not new document row id')
  assert.notEqual(rows('inspection_documents')[0].id, 'document')
  assert.equal(rows('inspection_documents')[0].status, 'missing')
  assert.equal(rows('inspection_documents')[0].document_date, '2026-09-05')
  assert.equal(rows('eb_participants')[0].attended, false)
  assert.equal(rows('eb_participants')[0].phone, '0700000000')
  assert.equal(rows('eb_inspection_checkpoints')[0].status, 'not_checked')
  assert.equal(rows('eb_inspection_checkpoints')[0].comment, 'Tidigare avvikelse')
  assert.equal(rows('eb_inspection_checkpoints')[0].note_id, notes[0].id)
  assert.equal(rows('inspection_images').length, 1)
  assert.equal(rows('inspection_images')[0].source_attachment_id, null)
  assert.equal(rows('eb_note_image_links').length, 2)
  assert.equal(plan.fileCopies.length, 2, 'one physical image plus thumbnail, not one copy per linked note')
  assert.ok(plan.fileCopies.every(file => file.to.startsWith('target/eb-notes/reused/')))
  assert.equal((rows('inspection_images')[0].label as string).split('\n')[0], 'Bild från tidigare slutbesiktning 1 · 2026-10-01')
  const draft = plan.detailPatch.report_draft as EbInspectionReport['reportDraft']
  assert.equal(draft.noteHeadings[0].beforeNoteId, notes[0].id)
  assert.notEqual(draft.noteHeadings[0].id, 'heading')
  assert.equal(draft.sourceSnapshot, null, 'shared project/private branding is freshly initialized for new work')
  assert.deepEqual(draft.sections.map(section => section.key), ['scope', 'other_notes', 'marker_legend'])
  for (const key of ['approval_status', 'approval_note', 'invitation_sent_at', 'invitation_subject', 'default_remedy_deadline',
    'warranty_end_date', 'report_locked_at', 'report_locked_by', 'report_distribution_date']) assert.equal(plan.detailPatch[key], null)
  assert.equal(plan.detailPatch.invoice_name, 'Privat fakturamottagare')
  assert.equal((plan.detailPatch.previous_inspections as Row[])[0].date, '2026-10-01')
  assert.ok(plan.rows.every(group => !/order|assignment|message|link_tokens|report_links/.test(group.table)))
  assert.deepEqual(source, before)
  ;(plan.detailPatch.previous_inspections as Row[])[0].label = 'Changed copy'
  assert.deepEqual(source, before, 'draft, history and captions are detached copies')
})

test('excluding previous notes also excludes photos, headings, note-derived text and checkpoint note links, not contacts or documents', () => {
  const plan = planFixture(false)
  for (const table of ['eb_notes', 'inspection_images', 'eb_note_image_links']) {
    assert.equal(plan.rows.find(group => group.table === table)!.rows.length, 0)
  }
  assert.equal(plan.fileCopies.length, 0)
  assert.ok(plan.rows.find(group => group.table === 'eb_participants')!.rows.length)
  assert.ok(plan.rows.find(group => group.table === 'inspection_documents')!.rows.length)
  assert.equal(plan.rows.find(group => group.table === 'eb_inspection_checkpoints')!.rows[0].note_id, null)
  const draft = plan.detailPatch.report_draft as EbInspectionReport['reportDraft']
  assert.deepEqual(draft.noteHeadings, [])
  assert.deepEqual(draft.sections.map(section => section.key), ['scope', 'other_notes'])
})

test('reusing an already historical image retains ORIGINAL capture provenance and exactly one origin caption', () => {
  const source = sourceFixture()
  const origin = { inspectionId: 'older', inspectionDate: '2026-08-01', variant: 'SLB' as const, sequenceNo: 1,
    noteId: 'old-note', noteNumber: 2, imageId: 'old-image' }
  for (const image of source.images) {
    image.reusedFrom = origin
    image.label = 'Bild från tidigare slutbesiktning 1 · 2026-08-01\nFönster'
  }
  const image = planFixture(true, source).rows.find(group => group.table === 'inspection_images')!.rows[0]
  assert.deepEqual(image.reuse_source, origin)
  assert.equal(image.label, 'Bild från tidigare slutbesiktning 1 · 2026-08-01\nFönster')
})

test('eligibility rejects foreign source, absent source, approved/unlocked source, other variants and corrupt snapshot scope', () => {
  const report = sourceFixture()
  const eligible = { projectId: 'project', targetVariant: 'SLB' as const, sourceInspectionId: 'source', source: report.inspection }
  assert.doesNotThrow(() => assertEbInspectionReuseEligible(eligible))
  for (const source of [undefined, { ...report.inspection, projectId: 'foreign' }, { ...report.inspection, inspectionId: 'foreign' }]) {
    assert.throws(() => assertEbInspectionReuseEligible({ ...eligible, source }), /SOURCE_NOT_FOUND/)
  }
  for (const source of [{ ...report.inspection, reportLockedAt: null }, { ...report.inspection, approvalStatus: 'approved' as const },
    { ...report.inspection, variant: 'EB' as const }]) {
    assert.throws(() => assertEbInspectionReuseEligible({ ...eligible, source }), /NOT_ELIGIBLE/)
  }
  for (const change of [{ orgId: 'foreign' }, { projectId: 'foreign' },
    { report: { ...report, inspection: { ...report.inspection, reportLockedAt: '2026-10-03T10:00:00Z' } } }]) {
    assert.throws(() => assertEbInspectionReuseReport({ orgId: 'org', projectId: 'project', source: report.inspection, report, ...change }), /SNAPSHOT_INVALID/)
  }
  assert.equal(parseEbInspectionReuseSource({ inspectionId: 'x' }), null)
  const unsafe = sourceFixture()
  unsafe.images[0].filePath = 'foreign/eb-notes/secret.jpg'
  assert.throws(() => planFixture(true, unsafe), /SNAPSHOT_INVALID/)
})

// Execute the actual creation + source-loading functions, replacing only storage
// and lookup boundaries. Tests cannot access Supabase or send any mail.
function creationFixture() {
  const report = sourceFixture()
  const sourceBefore = structuredClone(report)
  const writes: Array<{ table: string; action: string; rows: Row[]; filters: Array<[string, unknown]> }> = []
  const reads: Array<{ table: string; filters: Array<[string, unknown]>; select: string }> = []
  const files = new Set(['source/eb-notes/a.jpg', 'source/eb-notes/thumb-a.jpg'])
  const settings: { failTable?: string; failCopy?: boolean; changedSource?: boolean; noPublication?: boolean;
    invalidSnapshot?: boolean; migrationMissing?: boolean; oldCycle?: boolean; lookupCount: number; nextId: number } = { lookupCount: 0, nextId: 0 }
  const from = (table: string) => {
    const state = { action: 'select', rows: [] as Row[], filters: [] as Array<[string, unknown]>, select: '' }
    const execute = () => {
      if (state.action === 'select') {
        reads.push({ table, filters: [...state.filters], select: state.select })
        if (settings.migrationMissing && state.select.includes('reuse_source')) return { data: null, error: { code: '42703', message: 'reuse_source' } }
        if (table === 'inspection_report_links') return { data: settings.noPublication ? null :
          { snapshot_payload: settings.invalidSnapshot ? { broken: true } :
            { report: settings.oldCycle ? { ...report, inspection: { ...report.inspection, reportLockedAt: null },
              notes: [{ ...report.notes[0], noteText: 'OLD FROZEN CYCLE' }] } : report },
            created_at: '2026-09-20T08:00:00Z' }, error: null }
        if (table === 'inspection_lock_events') return { data: settings.oldCycle ? { performed_at: '2026-09-25T08:00:00Z' } : null, error: null }
        if (table === 'eb_participants') return { data: [{ id: 'person', role_label: 'Entreprenör', company_name: 'Byggfirman',
          org_no: '123', party_key: 'contractor', person_name: 'Byggaren', email: 'builder@example.test', phone: '0700000000',
          receives_invitation: true, attended: true, receives_report: true, represents_party_key: 'contractor',
          can_represent_party: true, sort_order: 20 }], error: null }
        if (table === 'eb_notes') return { data: [{ id: 'note-a', source_system: 'eb_missing_document', source_record_id: 'document-type' }], error: null }
        return { data: [], error: null }
      }
      if (settings.failTable === table && state.action === 'insert') return { data: null, error: { message: 'Injected write failure' } }
      writes.push({ table, action: state.action, rows: structuredClone(state.rows), filters: [...state.filters] })
      if (table === 'inspections' && state.action === 'insert') return { data: { id: 'target' }, error: null }
      return { data: null, error: null }
    }
    const query = {
      select: (columns: string) => { state.select = columns; return query },
      insert: (rows: Row | Row[]) => { state.action = 'insert'; state.rows = Array.isArray(rows) ? rows : [rows]; return query },
      update: (row: Row) => { state.action = 'update'; state.rows = [row]; return query },
      delete: () => { state.action = 'delete'; return query },
      eq: (key: string, value: unknown) => { state.filters.push([key, value]); return query },
      is: (key: string, value: unknown) => { state.filters.push([key, value]); return query },
      order: () => query, limit: () => query,
      single: async () => execute(), maybeSingle: async () => execute(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(execute()).then(resolve),
    }
    return query
  }
  const admin = { from, storage: { from: () => ({
    copy: async (from: string, to: string) => {
      assert.ok(files.has(from)); assert.ok(to.startsWith('target/eb-notes/'))
      if (settings.failCopy) return { error: { message: 'Injected copy failure' } }
      files.add(to); return { error: null }
    },
    remove: async (paths: string[]) => { for (const path of paths) { assert.ok(path.startsWith('target/eb-notes/')); files.delete(path) } return { error: null } },
  }) } }
  const dependencies = { exports: {}, createSupabaseAdminClient: () => admin,
    getEbProjectById: async () => {
      settings.lookupCount++
      const project = structuredClone(report.project)
      if (settings.lookupCount > 1) {
        if (settings.changedSource) project.inspections[0].reportLockedAt = null
        project.inspections.push({ ...report.inspection, inspectionId: 'target', reportLockedAt: null })
      }
      return project
    },
    resolveProjectPropertyId: async () => 'property',
    getEbInspectionVariantLabel: () => 'Slutbesiktning',
    seedDisciplinesForInspection: async () => { throw new Error('Reuse must not seed unrelated disciplines') },
    getEbInspectionReport: async (scope: Row) => {
      assert.equal(scope.readOnly, true, 'reading historical authoring source must never initialize/write a source draft')
      assert.ok(report.inspection.reportLockedAt); return structuredClone(report)
    },
    getEbInspectionReportFromSnapshot: (value: { report?: EbInspectionReport }) => value.report ?? null,
    assertEbInspectionReuseEligible, assertEbInspectionReuseReport, buildEbInspectionReusePlan, applyEbInspectionReusePlan,
    mapParticipant: (row: Row) => ({ ...report.participants[0], id: row.id, phone: row.phone, email: row.email }),
    randomUUID: () => `new-${++settings.nextId}`, EB_NOTE_IMAGE_BUCKET: 'inspection-images',
  }
  const source = readFileSync(new URL('../src/lib/eb/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
  const names = ['normalizeText', 'normalizeDate', 'normalizeTime', 'isMissingColumnError', 'loadEbInspectionReuseSource', 'createEbInspectionForProject']
  const code = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
    .map(node => node.getText(ast)).join('\n')
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const service = new Function(...Object.keys(dependencies), `${compiled}; return {createEbInspectionForProject}`)(...Object.values(dependencies)) as {
    createEbInspectionForProject: (input: CreateEbInspectionInput) => Promise<EbProjectListItem>
  }
  return { service, report, sourceBefore, writes, reads, files, settings }
}
const creationInput: CreateEbInspectionInput = { orgId: 'org', requestedByUserId: 'user', projectId: 'project',
  variant: 'SLB', parentInspectionId: 'source', inspectionDate: '2026-10-19', inspectionTime: '10:00',
  reusePreviousInspection: true, includePreviousNotes: true }

test('production source loader + creation succeeds, keeps all private contacts, uses scoped frozen source and creates fresh dated work', async () => {
  const f = creationFixture()
  const project = await f.service.createEbInspectionForProject(creationInput)
  assert.ok(project.inspections.some(inspection => inspection.inspectionId === 'target'))
  const participants = f.writes.find(write => write.table === 'eb_participants')!.rows
  assert.equal(participants[0].phone, '0700000000')
  assert.equal(participants[0].org_no, '123')
  const created = f.writes.find(write => write.table === 'inspections' && write.action === 'insert')!.rows[0]
  assert.equal(created.date, '2026-10-19')
  assert.equal(created.inspection_time, '10:00')
  assert.equal(created.status, 'draft')
  for (const read of f.reads.filter(read => ['inspection_report_links', 'eb_participants', 'eb_notes'].includes(read.table))) {
    assert.ok(read.filters.some(([key, value]) => key === 'org_id' && value === 'org'))
    assert.ok(read.filters.some(([key, value]) => key === 'inspection_id' && value === 'source'))
    if (read.table !== 'inspection_report_links') assert.ok(read.filters.some(([key, value]) => key === 'eb_project_id' && value === 'project'))
  }
  assert.equal(f.files.size, 4)
  assert.deepEqual(f.report, f.sourceBefore)
  assert.ok(f.writes.every(write => write.table !== 'inspection_report_links'), 'old links cannot be republished/revoked')
})

test('source without publication uses locked authoring report; missing/corrupt/foreign source fails BEFORE target creation', async () => {
  const f = creationFixture(); f.settings.noPublication = true
  await f.service.createEbInspectionForProject({ ...creationInput, includePreviousNotes: false })
  assert.ok(f.writes.some(write => write.table === 'eb_participants'))
  assert.equal(f.writes.filter(write => ['eb_notes', 'inspection_images'].includes(write.table)).length, 0)
  for (const scenario of ['invalidSnapshot', 'migrationMissing', 'foreign', 'unlocked'] as const) {
    const f = creationFixture()
    if (scenario === 'invalidSnapshot' || scenario === 'migrationMissing') f.settings[scenario] = true
    if (scenario === 'unlocked') f.report.inspection.reportLockedAt = null
    await assert.rejects(f.service.createEbInspectionForProject({ ...creationInput,
      parentInspectionId: scenario === 'foreign' ? 'foreign' : 'source' }), /EB_REUSE_/)
    assert.equal(f.writes.length, 0)
    assert.equal(f.files.size, 2)
  }
})

test('an older active link with a null legacy lock is not reused after an intervening unlock/relock', async () => {
  const f = creationFixture(); f.settings.oldCycle = true
  await f.service.createEbInspectionForProject(creationInput)
  const notes = f.writes.find(write => write.table === 'eb_notes' && write.action === 'insert')!.rows
  assert.equal(notes[0].note_text, 'Spricka vid fönstret', 'current locked authoring report, not an older still-active link')
  const audit = f.reads.find(read => read.table === 'inspection_lock_events')!
  assert.deepEqual(audit.filters, [['org_id', 'org'], ['inspection_id', 'source'], ['action', 'unlock']])
})

test('copy/write failure and source concurrently unlocked cause target-only rollback and remove every planned new file', async () => {
  for (const scenario of ['copy', 'notes', 'details', 'sourceChanged'] as const) {
    const f = creationFixture()
    if (scenario === 'copy') f.settings.failCopy = true
    if (scenario === 'notes') f.settings.failTable = 'eb_notes'
    if (scenario === 'details') f.settings.failTable = 'eb_inspection_details'
    if (scenario === 'sourceChanged') f.settings.changedSource = true
    await assert.rejects(f.service.createEbInspectionForProject(creationInput))
    const rollback = f.writes.find(write => write.table === 'inspections' && write.action === 'delete')
    assert.ok(rollback, scenario)
    assert.deepEqual(rollback.filters, [['id', 'target'], ['property_id', 'property']])
    assert.deepEqual([...f.files].sort(), ['source/eb-notes/a.jpg', 'source/eb-notes/thumb-a.jpg'])
    assert.deepEqual(f.report, f.sourceBefore)
  }
})

function extractServerFunctions(names: string[], dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL('../src/lib/eb/server.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('server.ts', source, ts.ScriptTarget.Latest, true)
  const code = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text))
    .map(node => node.getText(ast)).join('\n')
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const bindings = { exports: {}, ...dependencies }
  return new Function(...Object.keys(bindings), `${compiled}; return {${names.join(',')}}`)(...Object.values(bindings)) as
    Record<string, (...args: unknown[]) => Promise<unknown>>
}

test('existing report reads preserve ALL previous rich metadata while reuse_source SQL has not been deployed', async () => {
  const selections: Array<{ table: string; columns: string }> = []
  const rawNote: Row = { id: 'note', eb_project_id: 'project', inspection_id: 'source', note_text: 'Text',
    status_key: 'open', remediation_assignee_id: 'assignee', investigation_responsible_party: 'contractor',
    investigation_cost_party: 'client', investigation_responsible_note: 'Utred vidare', investigation_due_date: '2026-11-01',
    deduction_amount: '2000', trade_group: 'Bygg' }
  const rawImage = { id: 'image', inspection_id: 'source', eb_note_id: 'note', source_attachment_id: 'attachment',
    file_path: 'source/eb-notes/a.jpg', thumbnail_file_path: 'source/eb-notes/thumb.jpg' }
  const from = (table: string) => {
    let columns = ''
    const query = {
      select: (value: string) => { columns = value; return query }, eq: () => query, like: () => query, order: () => query,
      then: (resolve: (value: unknown) => unknown) => {
        selections.push({ table, columns })
        const result = columns.includes('reuse_source') ? { data: null, error: { code: '42703', message: 'reuse_source' } }
          : table === 'eb_note_image_links' ? { data: [{ eb_note_id: 'note', inspection_image_id: 'image' }], error: null }
          : { data: [Object.fromEntries(Object.entries(table === 'eb_notes' ? rawNote : rawImage)
              .filter(([key]) => columns.split(',').includes(key)))], error: null }
        return Promise.resolve(result).then(resolve)
      },
    }
    return query
  }
  const api = extractServerFunctions(['normalizeText', 'normalizePartyKey', 'isMissingColumnError', 'mapNote', 'mapNoteImage',
    'normalizeLegacyMissingDocumentNoteText', 'listEbNotes', 'listEbNoteImages'], {
    createSupabaseAdminClient: () => ({ from, storage: { from: () => ({ getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } }) }) } }),
    PARTY_KEY_VALUES: ['client', 'contractor', 'other'], EB_NOTE_IMAGE_BUCKET: 'inspection-images', parseEbInspectionReuseSource,
    isMissingRelationError: () => false,
    listEbNoteImagesWithoutSourceAttachment: () => { throw new Error('Should retain source attachment and thumbnail columns') },
  })
  const notes = await api.listEbNotes({ orgId: 'org', projectId: 'project', inspectionId: 'source', disciplines: [], markers: [], statuses: [] }) as EbInspectionReport['notes']
  assert.equal(notes[0].remediationAssigneeId, 'assignee')
  assert.equal(notes[0].investigationResponsibleParty, 'contractor')
  assert.equal(notes[0].investigationResponsibleNote, 'Utred vidare')
  assert.equal(notes[0].investigationDueDate, '2026-11-01')
  assert.equal(notes[0].deductionAmount, '2000')
  assert.equal(notes[0].reusedFrom, null)
  const images = await api.listEbNoteImages({ inspectionId: 'source' }) as EbInspectionReport['images']
  assert.equal(images[0].sourceAttachmentId, 'attachment')
  assert.equal(images[0].thumbnailFilePath, 'source/eb-notes/thumb.jpg')
  assert.equal(images[0].noteId, 'note')
  assert.equal(selections.filter(row => row.table === 'eb_notes').length, 2)
  assert.equal(selections.filter(row => row.table === 'inspection_images').length, 2)
})

test('saving copied missing-document selections repeatedly reuses the copied automatic note instead of creating duplicates', async () => {
  const copied = planFixture().rows.find(group => group.table === 'eb_notes')!.rows[0]
  const writes: Array<{ action: string; patch: Row }> = []
  const from = (table: string) => {
    let action = 'select', patch: Row = {}
    const query = { select: () => query, eq: () => query, in: () => query,
      update: (value: Row) => { action = 'update'; patch = value; return query },
      insert: () => { throw new Error('Copied automatic note must match by document type, never duplicate') },
      delete: () => { throw new Error('Missing document is still selected') },
      then: (resolve: (value: unknown) => unknown) => {
        assert.equal(table, 'eb_notes')
        if (action === 'update') { writes.push({ action, patch }); Object.assign(copied, patch) }
        return Promise.resolve({ data: action === 'select' ? [copied] : null, error: null }).then(resolve)
      },
    }
    return query
  }
  const api = extractServerFunctions(['normalizeText', 'isMissingColumnError', 'isHandoverDocumentResultLabel',
    'ebMissingDocumentNoteText', 'syncMissingDocumentNotes'], {
    createSupabaseAdminClient: () => ({ from }), EB_MISSING_DOCUMENT_NOTE_SOURCE: 'eb_missing_document',
    getNextEbNoteNumber: () => { throw new Error('No new note numbering when copied source matches') },
  })
  const input = { orgId: 'org', projectId: 'project', inspectionId: 'target', requestedByUserId: 'user', contractorName: 'Byggfirman',
    documents: [{ documentType: { id: 'document-type', label: 'Kvalitetsintyg', result_label: 'redovisad' },
      document: { status: 'missing', note: null } }] }
  await api.syncMissingDocumentNotes(input)
  await api.syncMissingDocumentNotes(input)
  assert.equal(writes.length, 1, 'second save is a no-op after first current explicit document review')
  assert.equal(copied.note_text, 'Kvalitetsintyg har inte redovisats vid besiktningen.')
})

test('bounded photo copying settles every in-flight sibling before reporting failure to the rollback owner', async () => {
  const plan = planFixture()
  plan.fileCopies = Array.from({ length: 9 }, (_, index) => ({ from: `old-${index}`, to: `new-${index}` }))
  let active = 0, peak = 0, settled = 0
  const started: string[] = []
  await assert.rejects(applyEbInspectionReusePlan(plan, {
    copyFile: async (from) => {
      started.push(from); active++; peak = Math.max(peak, active)
      try {
        if (from === 'old-0') throw new Error('Copy failed')
        await new Promise(resolve => setTimeout(resolve, 1))
      } finally { active--; settled++ }
    },
    insertRows: async () => { throw new Error('No database writes before complete photo copy') },
    updateDetails: async () => {}, finishDraft: async () => {},
  }), /Copy failed/)
  assert.equal(active, 0)
  assert.equal(settled, 4)
  assert.equal(started.length, 4)
  assert.ok(peak <= 4)
})

test('creation API forwards explicit reuse choices, rejects nonbooleans and maps source/migration failures without publishing or mail', async () => {
  const source = readFileSync(new URL('../src/app/api/eb/projects/[projectId]/inspections/route.ts', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const calls: CreateEbInspectionInput[] = []
  let fail = ''
  const dependencies = {
    'next/server': { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
    '@/lib/access/server': { requireModuleAccess: async (scope: Row) => {
      assert.equal(scope.moduleKey, 'construction_inspections')
    } },
    '@/lib/assignments/server': { requireOrgContext: async () => ({ orgId: 'org', userId: 'user' }) },
    '@/lib/eb/server': { isEbInspectionVariant: (value: string) => ['SLB', 'EB'].includes(value),
      createEbInspectionForProject: async (input: CreateEbInspectionInput) => {
        calls.push(input)
        if (fail) throw new Error(fail)
        return { id: 'project' }
      } },
  }
  const apiModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name in dependencies) return dependencies[name as keyof typeof dependencies]
    throw new Error(`Unexpected API dependency ${name}`)
  }, apiModule, apiModule.exports)
  const api = apiModule.exports as { POST: (request: Request, context: { params: Promise<{ projectId: string }> }) => Promise<Response> }
  const post = (body: Row) => api.POST(new Request('https://example.test/api/eb/projects/project/inspections', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), { params: Promise.resolve({ projectId: 'project' }) })
  assert.equal((await post({ variant: 'SLB', parentInspectionId: 'source', reusePreviousInspection: true, includePreviousNotes: false })).status, 201)
  assert.equal(calls[0].orgId, 'org')
  assert.equal(calls[0].reusePreviousInspection, true)
  assert.equal(calls[0].includePreviousNotes, false)
  assert.equal(calls[0].parentInspectionId, 'source')
  assert.equal((await post({ reusePreviousInspection: 'true' })).status, 400)
  assert.equal(calls.length, 1)
  for (const [error, status] of [['EB_REUSE_SOURCE_NOT_FOUND', 404], ['EB_REUSE_SOURCE_NOT_ELIGIBLE', 409],
    ['EB_REUSE_SOURCE_SNAPSHOT_INVALID', 409], ['EB_REUSE_MIGRATION_REQUIRED', 503]] as const) {
    fail = error
    assert.equal((await post({ variant: 'SLB', parentInspectionId: 'source', reusePreviousInspection: true })).status, status)
  }
})
