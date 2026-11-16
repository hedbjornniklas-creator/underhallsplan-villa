import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import UppdragScope from '@/components/tasks/UppdragScope'
import CustomerContractSigning from '@/components/tasks/CustomerContractSigning'
import CustomerContractDelivery from '@/components/tasks/CustomerContractDelivery'
import ProjectQuestions from '@/components/tasks/ProjectQuestions'
import { ProjectSaveProtectionProvider, useProjectSaveNavigation } from '@/components/tasks/ProjectSaveProtection'
import { emptyQuestion, type QuestionWorkspace } from '@/lib/action-cases/projectQuestions'
import { uploadSignedContract } from '@/lib/action-cases/contractSignedUpload'
import { supabase } from '../helpers/gizmo-upload-storage-stub'
import { signingSnapshot, signingId as id } from './contract-signing'
import type { ContractSigningVersion } from '@/lib/action-cases/customerOffers'

const caseId = id(1), questionId = id(21), createdAt = '2026-11-16T09:00:00Z'
const version: ContractSigningVersion = { id: id(8), version: 1, revision: 7, createdAt, releasedAt: null, snapshot: signingSnapshot(), pdfSha256: 'a'.repeat(64), fileSizeBytes: 1000, files: [],
  signedCopyTask: { id: id(9), status: 'assigned', assigneeProfileId: id(10), dueAt: '2026-11-23T09:00:00Z' } }
const workspace: QuestionWorkspace = { userId: id(10), managerId: id(10), canManageParticipants: true, assignees: [], questions: [{ id: questionId, number: 1, revision: 1, createdAt, updatedAt: createdAt, body: { ...emptyQuestion(), title: 'TEST - Bilder och dokument', description: 'Fiktivt underlag, inga verkliga projektuppgifter.' }, events: [], tasks: [], participants: [], attachmentIds: [] }], privateFiles: [] }
let sequence = 50, uploadCalls = 0, completeCalls = 0, newDrafts = 0, failPhoto = true, failDownload = false
const actualFetch = window.fetch.bind(window), registered = new Map<string, string>()
const json = (value: unknown, status = 200) => Response.json(value, { status })
window.fetch = async (input, init) => {
  const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : null
  if (url.endsWith('/signed')) {
    if (body.operation === 'prepare') return json({ upload: { bucket: 'signed-test', filePath: 'signed-receipt.pdf', token: 'test', ticket: 'test' } })
    completeCalls++; return json({ revision: 7 })
  }
  if (url === '/api/action-cases') {
    const p = body.payload
    if (body.action === 'create_signed_upload') return json({ upload: { bucket: 'question-test', filePath: p.fileName, token: 'test', contentType: p.contentType || 'application/octet-stream' } })
    if (!registered.has(p.filePath)) registered.set(p.filePath, id(sequence++))
    const attachmentId = registered.get(p.filePath)!
    if (p.fileName === 'retry.jpg' && failPhoto) return json({ error: 'Fiktivt nätfel' }, 503)
    if (!workspace.privateFiles!.some(file => file.id === attachmentId)) workspace.privateFiles!.push({ id: attachmentId, questionId, actionCaseItemId: null, type: p.contentType.startsWith('image/') ? 'image' : 'document', title: null, fileName: p.fileName, contentType: p.contentType, fileSizeBytes: p.fileSize, createdAt, grantedParticipantIds: [] })
    return json({ attachmentId })
  }
  if (url.endsWith('/questions')) {
    if (!init?.method) return json(structuredClone(workspace))
    const q = workspace.questions[0]
    q.body = body.body; q.attachmentIds = body.fileIds; q.revision++
    return json({ questionId })
  }
  if (url.includes('/attachments/')) { if (failDownload) { failDownload = false; return json({ error: 'Fiktivt nätfel' }, 503) }; return actualFetch('/fixture-photo.png', init) }
  return actualFetch(input, init)
}
Object.assign(window, {
  gizmoUpload: async (_bucket: string, _path: string, file: File) => { uploadCalls++; if (file.name === 'retry.jpg' && failPhoto) return { error: { message: 'Fiktivt nätfel' } }; return { error: null } },
  gizmoFixture: { stats: () => ({ uploadCalls, completeCalls, newDrafts, attached: workspace.questions[0].attachmentIds }), allowRetry: () => { failPhoto = false }, failNextDownload: () => { failDownload = true } },
})

function View() {
  const [tab, setTab] = useState<'contract' | 'questions'>('contract'), [signed, setSigned] = useState<ContractSigningVersion>(version), [busy, setBusy] = useState('')
  const navigate = useProjectSaveNavigation()
  const action = async (operation: string, extra: Record<string, unknown> = {}) => {
    setBusy(operation)
    try {
      if (operation === 'upload_signed') {
        const file = extra.file as File
        await uploadSignedContract('/signed', { file, revision: 7 }, supabase.storage)
        setSigned(current => ({ ...current, delivery: { participantId: null, sharedAt: null, withdrawnAt: null, signedCopy: { fileName: file.name, fileSizeBytes: file.size, registeredAt: new Date().toISOString() } } }))
      }
      return true
    } finally { setBusy('') }
  }
  return <UppdragScope><main className="gizmo-workspace mx-auto max-w-5xl p-4 sm:p-6"><h1 className="text-2xl font-semibold">Gizmo · Fiktivt testprojekt</h1><nav className="my-5 flex gap-2"><button className="gizmo-button" onClick={() => void navigate?.(() => setTab('contract'))}>Avtal</button><button className="gizmo-button" onClick={() => void navigate?.(() => setTab('questions'))}>Frågor och beslut</button></nav>
    <div hidden={tab !== 'contract'}><h2 className="text-lg font-semibold">Avtalsstatus</h2><CustomerContractSigning caseId={caseId} available versions={[signed]} disabled={Boolean(busy)} accepted={false} busy={busy} revision={7} blockers={[]} onFreeze={async () => true} onNewDraft={async () => { newDrafts++; return true }} />
      <CustomerContractDelivery caseId={caseId} version={signed} available disabled={Boolean(busy)} busy={busy} customerUrl="" onAction={action} />
    </div>
    <ProjectQuestions caseId={caseId} active={tab === 'questions'} files={[]} onFiles={() => {}} onDirty={() => {}} contractVersions={[signed]} onOpenContract={() => setTab('contract')} />
  </main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<ProjectSaveProtectionProvider onLocate={() => {}}><View /></ProjectSaveProtectionProvider>)
