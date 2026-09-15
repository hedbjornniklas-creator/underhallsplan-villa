import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import View, { type RenoAppCaseDetail, type RenoAppCaseStatusAction } from '../../src/app/renoapp/app/cases/[id]/RenoAppCaseDecisionView'
import { selectCompletionItems } from '../../src/lib/renoapp/completion'

import { item } from './renoapp-case-item'

function Fixture() {
  const [current, setCurrent] = useState<RenoAppCaseDetail>(() => JSON.parse(sessionStorage.getItem('board-fixture') ?? 'null') ?? item)
  const [selectedStatus, setSelectedStatus] = useState<RenoAppCaseStatusAction>('approved')
  const [reason, setReason] = useState('')
  useEffect(() => { sessionStorage.setItem('board-fixture', JSON.stringify(current)) }, [current])
  return <div className="renoapp-scope"><main className="reno-portal-main">
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
  </main></div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
