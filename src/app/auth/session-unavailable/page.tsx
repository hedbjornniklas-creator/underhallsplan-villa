import DashboardAccessRecovery from '@/components/auth/DashboardAccessRecovery'
import { safeAuthReturnPath } from '@/lib/auth/returnPath'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Försök igen', robots: { index: false, follow: false } }

// Public destination for a failed refresh; never grants access to its return URL.
export default async function SessionUnavailablePage({ searchParams }: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const params = await searchParams
  return <DashboardAccessRecovery reason="unavailable" returnTo={safeAuthReturnPath(params.next, '/dashboard-v1')} />
}
