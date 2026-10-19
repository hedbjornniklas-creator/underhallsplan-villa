import { createRoot } from 'react-dom/client'
import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'

const reason = new URLSearchParams(location.search).get('reason') === 'unavailable' ? 'unavailable' : 'forbidden'
createRoot(document.getElementById('root')!).render(<DashboardAccessRecovery reason={reason} />)
