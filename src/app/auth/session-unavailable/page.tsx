import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Försök igen', robots: { index: false, follow: false } }

// Public destination for a failed session refresh. The proxy keeps the original
// dashboard URL and 503 status, so a retry returns to its independent guard.
export default function SessionUnavailablePage() {
  return <DashboardAccessRecovery reason="unavailable" />
}
