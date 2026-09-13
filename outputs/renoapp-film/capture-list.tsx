import React from 'react'
import { createRoot } from 'react-dom/client'
import Cases from '../../src/app/renoapp/app/cases/page'

const names = ['Anna Exempel', 'Erik Exempel', 'Kim Exempel', 'Alex Exempel']
const statuses = ['new_application', 'review', 'need_info', 'approved']
window.fetch = async () => new Response(JSON.stringify({ items: statuses.map((status, i) => ({
  id: `film-case-${i}`, caseNumber: `RA-2026-0912-0${i+1}`,
  title: ['K\u00f6ksrenovering', 'Riva v\u00e4gg', 'Badrumsrenovering', 'Elinstallationer'][i],
  status, riskLevel: null, submittedAt: '2026-09-12', updatedAt: '2026-09-12',
  brf: { id: 'film', name: 'Exempelf\u00f6reningen', slug: 'film' },
  actionType: null, applicant: { name: names[i], email: `person${i}@example.test` },
})) }), { headers: { 'Content-Type': 'application/json' } })
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-6xl px-10 py-8"><Cases /></main>)
