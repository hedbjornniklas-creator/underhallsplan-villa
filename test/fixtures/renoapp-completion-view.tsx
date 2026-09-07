import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import View, { type RenoAppCaseDetail, type RenoAppCaseStatusAction } from '../../src/app/renoapp/app/cases/[id]/RenoAppCaseDecisionView'
import { selectCompletionItems } from '../../src/lib/renoapp/completion'

const item: RenoAppCaseDetail = {
  id: 'case', caseNumber: 'RA-2026-0907-01', title: 'Riva vägg', description: 'Riva vägg mellan kök och vardagsrum.',
  status: 'review', riskLevel: null, submittedAt: '2026-09-01', updatedAt: '2026-09-07', blockedAt: null, blockedReason: null,
  brf: { id: 'brf', name: 'Testföreningen', slug: 'test' }, actionType: { id: 'wall', key: 'wall', label: 'Riva vägg' },
  applicant: { id: 'person', name: 'Testperson', email: 'applicant@example.test', phone: '0700000000' },
  unit: { id: 'unit', unitNumberInternal: '123', unitNumberSkatteverket: '1101', status: 'active' },
  currentContacts: [], documents: [
    { id: 'drawing', documentTypeId: 'drawing-type', documentTypeLabel: 'Utlåtande från byggnadskonstruktör', fileName: 'Konstruktionsutlåtande version 2.pdf', status: 'uploaded', uploadedAt: '2026-09-07', note: null },
    { id: 'old-drawing', documentTypeId: 'drawing-type', documentTypeLabel: 'Utlåtande från byggnadskonstruktör', fileName: 'Tidigare utlåtande.pdf', status: 'uploaded', uploadedAt: '2026-09-06', note: null },
  ],
  underlag: [
    { id: 'document:drawing-type', category: 'document', label: 'Utlåtande från byggnadskonstruktör', checked: true, documentId: 'drawing', requirementDecision: 'requested',
      reviewGuidance: 'Kontrollera omfattningen.', summary: [], details: null,
      suggestionSources: [{ id: 'wall', type: 'action_type', actionTypeLabel: 'Riva vägg', questionLabel: null, answerLabel: null }] },
    { id: 'document:plumber-certificate', category: 'document', label: 'Auktoriserade företag Säkert vatten', checked: false, documentId: null, requirementDecision: 'not_requested',
      reviewGuidance: null, summary: [], details: null,
      suggestionSources: [{ id: 'plumbing', type: 'question_answer', actionTypeLabel: null, questionLabel: 'Påverkas vatteninstallationer?', answerLabel: 'Ja' }] },
    { id: 'participant:plumber', category: 'participant', label: 'VVS-entreprenör', checked: true, documentId: null, requirementDecision: 'requested',
      reviewGuidance: null, suggestionSources: [], summary: ['Behörighet kontrollerad'],
      details: { companyName: 'Testföretaget AB', orgNumber: '123456-7890', contactName: 'Testperson', email: 'company@example.test', phone: '0700000000', certificationReference: null, hasVerifiedAuthorization: true, acceptsResponsibility: true } },
    { id: 'participant:builder', category: 'participant', label: 'Byggentreprenör', checked: false, documentId: null, requirementDecision: 'not_requested',
      reviewGuidance: null, suggestionSources: [], summary: [], details: null },
  ],
  requirements: [], decisions: [], accessLinks: [], reviewFlags: [], messages: [
    { id: 'reply', type: 'applicant_reply', authorRole: 'applicant', authorName: 'Testperson', message: 'Här kommer mitt utlåtande.', createdAt: '2026-09-07' },
    { id: 'request', type: 'request_for_info', authorRole: 'board', authorName: 'Styrelsemedlem', message: 'Skicka konstruktörens utlåtande.', createdAt: '2026-09-01' },
  ],
  completion: { id: 'round-1', items: [{ id: 'document:drawing-type', category: 'document', label: 'Utlåtande från byggnadskonstruktör', correction: false }],
    message: 'Lämna utlåtande', created_at: '2026-09-01', submitted_at: '2026-09-07', delivery_status: 'sent', delivery_error: null },
}

function Fixture() {
  const [current, setCurrent] = useState<RenoAppCaseDetail>(() => JSON.parse(sessionStorage.getItem('board-fixture') ?? 'null') ?? item)
  const [selectedStatus, setSelectedStatus] = useState<RenoAppCaseStatusAction>('approved')
  const [reason, setReason] = useState('')
  useEffect(() => { sessionStorage.setItem('board-fixture', JSON.stringify(current)) }, [current])
  return <main className="mx-auto max-w-6xl px-6 py-10 md:px-10"><div className="px-4 sm:px-8">
    <View item={current} selectedStatus={selectedStatus} reason={reason} conditions="" decisionConfirmed={false} submitting={false}
      actionError={null} actionSuccess={null} onStatusChange={setSelectedStatus} onReasonChange={setReason} onConditionsChange={() => {}}
      onDecisionConfirmedChange={() => {}}
      onRequirementDecisionChange={(row, requirementDecision) => setCurrent(value => ({ ...value, underlag: value.underlag.map(entry => entry.id === row.id ? { ...entry, requirementDecision } : entry) }))}
      onSubmit={event => {
        event.preventDefault()
        if (selectedStatus === 'need_info') setCurrent(value => ({ ...value, status: 'need_info', completion: {
          ...value.completion!, id: 'round-2', items: selectCompletionItems(value.underlag), submitted_at: null,
        } }))
      }} onRetryDelivery={() => {}} />
  </div></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
