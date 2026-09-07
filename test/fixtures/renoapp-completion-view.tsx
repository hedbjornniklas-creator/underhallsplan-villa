import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import View, { type RenoAppCaseDetail } from '../../src/app/renoapp/app/cases/[id]/RenoAppCaseDecisionView'

const item: RenoAppCaseDetail = {
  id: 'case', caseNumber: 'RA-2026-0907-01', title: 'Riva vägg', description: 'Riva vägg mellan kök och vardagsrum.',
  status: 'review', riskLevel: null, submittedAt: '2026-09-01', updatedAt: '2026-09-07', blockedAt: null, blockedReason: null,
  brf: { id: 'brf', name: 'Testföreningen', slug: 'test' }, actionType: { id: 'wall', key: 'wall', label: 'Riva vägg' },
  applicant: { id: 'person', name: 'Testperson', email: 'applicant@example.test', phone: '0700000000' },
  unit: { id: 'unit', unitNumberInternal: '123', unitNumberSkatteverket: '1101', status: 'active' },
  checks: null, currentContacts: [], documents: [
    { id: 'drawing', documentTypeId: 'drawing-type', documentTypeLabel: 'Utlåtande från byggnadskonstruktör', fileName: 'Konstruktionsutlåtande version 2.pdf', status: 'uploaded', uploadedAt: '2026-09-07', note: null },
    { id: 'old-drawing', documentTypeId: 'drawing-type', documentTypeLabel: 'Utlåtande från byggnadskonstruktör', fileName: 'Tidigare utlåtande.pdf', status: 'uploaded', uploadedAt: '2026-09-06', note: null },
  ],
  underlag: [
    { id: 'document:drawing-type', category: 'document', label: 'Utlåtande från byggnadskonstruktör', checked: true, documentId: 'drawing', requirementDecision: 'requested',
      reviewGuidance: 'Kontrollera omfattningen.', summary: [], details: null,
      suggestionSources: [{ id: 'wall', type: 'action_type', actionTypeLabel: 'Riva vägg', questionLabel: null, answerLabel: null }] },
    { id: 'document:plumber-certificate', category: 'document', label: 'Auktoriserade företag Säkert vatten', checked: false, documentId: null, requirementDecision: 'requested',
      reviewGuidance: null, summary: [], details: null,
      suggestionSources: [{ id: 'plumbing', type: 'question_answer', actionTypeLabel: null, questionLabel: 'Påverkas vatteninstallationer?', answerLabel: 'Ja' }] },
    { id: 'participant:plumber', category: 'participant', label: 'VVS-entreprenör', checked: true, documentId: null, requirementDecision: 'requested',
      reviewGuidance: null, suggestionSources: [], summary: ['Behörighet kontrollerad'],
      details: { companyName: 'Testföretaget AB', orgNumber: '123456-7890', contactName: 'Testperson', email: 'company@example.test', phone: '0700000000', certificationReference: null, hasVerifiedAuthorization: true, acceptsResponsibility: true } },
  ],
  requirements: [], decisions: [], accessLinks: [], reviewFlags: [], messages: [], completion: null,
}

function Fixture() {
  const [current, setCurrent] = useState(item)
  const [corrections, setCorrections] = useState<string[]>([])
  const [reason, setReason] = useState('')
  return <main className="mx-auto max-w-6xl px-6 py-10 md:px-10"><div className="px-4 sm:px-8">
    <View item={current} selectedStatus="need_info" reason={reason} conditions="" decisionConfirmed={false} submitting={false}
      actionError={null} actionSuccess={null} onStatusChange={() => {}} onReasonChange={setReason} onConditionsChange={() => {}}
      onDecisionConfirmedChange={() => {}} correctionIds={corrections} onCorrectionChange={(id, checked) => setCorrections(values => checked ? [...values, id] : values.filter(value => value !== id))}
      onRequirementDecisionChange={(row, requirementDecision) => setCurrent(value => ({ ...value, underlag: value.underlag.map(entry => entry.id === row.id ? { ...entry, requirementDecision } : entry) }))}
      onSubmit={event => event.preventDefault()} onRetryDelivery={() => {}} />
  </div></main>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
