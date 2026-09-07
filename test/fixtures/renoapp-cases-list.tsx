import { createRoot } from 'react-dom/client'
import CasesPage from '../../src/app/renoapp/app/cases/page'

const statuses = ['draft', 'approved', 'review', 'rejected', 'need_info', 'new_application', 'conditional', 'submitted', 'review']
window.fetch = async () => Response.json({ items: statuses.map((status, index) => ({
  id: String(index), caseNumber: `RA-2026-0907-0${index}`,
  title: index === 0 ? 'RenoveringsansÃ¶kan' : 'Renovering: Riva vägg', status,
  submittedAt: `2026-09-0${index + 1}T12:00:00Z`, updatedAt: '2026-09-07',
  riskLevel: null, brf: { id: 'test', name: 'Test', slug: 'test' },
  actionType: null, applicant: { name: 'Testperson', email: null },
})) })

createRoot(document.getElementById('root')!).render(<CasesPage />)
