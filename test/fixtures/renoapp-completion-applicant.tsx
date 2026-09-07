import { createRoot } from 'react-dom/client'
import Applicant from '../../src/app/renoapp/brf/[slug]/apply/page'

const stored = sessionStorage.getItem('completion-fixture')
const draft = stored ? JSON.parse(stored) : {
  state: 'open', access: { email: 'applicant@example.test', expiresAt: '2099-01-01', lastUsedAt: null },
  brf: { id: 'brf', name: 'Test BRF', slug: 'test' },
  case: { id: 'case', caseNumber: 'RA-TEST', status: 'need_info', submittedAt: '2026-09-01', updatedAt: '2026-09-07' },
  completionDraft: { revision: 0, replyMessage: 'Saved earlier reply' },
  form: { applicantName: 'Testperson', applicantEmail: 'applicant@example.test', applicantPhone: '0700000000',
    unitNumberInternal: '1', unitNumberSkatteverket: '1101', description: 'Original renovation', actionTypeKeys: [], questionAnswers: {},
    contractorName: '', contractorOrgNumber: '', contractorEmail: '', contractorPhone: '', contractorHasRequiredCertification: false,
    participantEntries: [{ participantRoleId: 'plumber', companyName: 'Original plumber', orgNumber: '', contactName: '', email: '', phone: '', certificationReference: '', hasVerifiedAuthorization: false, acceptsResponsibility: false }],
  },
  documents: [{ id: 'old-file', fileName: 'Original drawing.pdf', completionRequestId: 'previous-round', documentTypeId: 'drawing', documentScope: 'general', participantRoleId: null, status: 'uploaded', uploadedAt: '2026-09-01', note: null }],
  completionRequest: { id: 'round-2', requestedAt: '2026-09-07', requestedDocuments: [], requestedParticipants: [
    { participantRoleId: 'plumber', key: 'plumber', label: 'VVS-entreprenör', description: null, reviewGuidance: null, roleKind: 'contractor', verificationInstructions: null, verificationUrl: null,
      insuranceRequired: false, requiresCompanyName: true, requiresOrgNumber: false, requiresContactName: false, requiresEmail: false, requiresPhone: false, requiresCertification: false, note: null },
  ] }, messages: [],
}
const persist = () => sessionStorage.setItem('completion-fixture', JSON.stringify(draft))
persist()
window.fetch = async (input, init) => {
  const url = String(input)
  if (url.includes('/public/applications/draft/')) return Response.json(draft)
  if (url.includes('/brf/test/public')) return Response.json({ brf: draft.brf, actionTypes: [], questionBank: [] })
  if (url === '/api/renoapp/public/applications' && init?.method === 'POST') {
    const body = JSON.parse(String(init.body))
    sessionStorage.setItem('completion-last-request', JSON.stringify(body))
    if (sessionStorage.getItem('completion-conflict')) return Response.json({ code: 'COMPLETION_DRAFT_CHANGED', error: 'Kompletteringen har sparats i en annan flik. Ladda om sidan.' }, { status: 409 })
    draft.form.participantEntries = body.participantEntries
    draft.completionDraft.replyMessage = body.replyMessage
    draft.completionDraft.revision++
    if (body.mode === 'submit') draft.case.status = 'review'
    persist()
    return Response.json({ caseId: 'case', caseNumber: 'RA-TEST', completionRevision: draft.completionDraft.revision,
      status: body.mode === 'submit' ? 'submitted' : 'draft', resumeUrl: '/renoapp/brf/test/apply?draft=fixture-secret', accessUrl: '', emailSent: false, emailError: null })
  }
  throw new Error(`Unmocked fixture request: ${url}`)
}
createRoot(document.getElementById('root')!).render(<Applicant />)
